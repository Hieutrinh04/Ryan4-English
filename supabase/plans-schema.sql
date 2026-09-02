-- Phân quyền & thanh toán cho Lexilo.
--
-- Chạy MỘT LẦN trong Supabase SQL Editor, SAU supabase/schema.sql.
--
-- Ba bảng:
--   user_plans      — mỗi người một dòng: gói hiện tại + số điểm AI còn lại.
--   credit_ledger   — sổ cái điểm: mỗi lần cộng/trừ là một dòng, để đối soát.
--   payment_orders  — đơn hàng: tạo lúc bấm mua, cổng thanh toán xác nhận qua IPN.
--
-- Người dùng CHỈ ĐỌC được ba bảng này. Mọi thao tác GHI (cộng điểm, bật Premium,
-- đánh dấu đơn đã trả) đi qua service role ở webhook — client không tự sửa được.

-- ── user_plans ─────────────────────────────────────────────────────────────
create table if not exists public.user_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  premium_until timestamptz,
  credits int not null default 0 check (credits >= 0),
  -- Mốc đã cộng điểm tặng Premium gần nhất, để mỗi kỳ chỉ cộng một lần.
  monthly_credits_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── credit_ledger ──────────────────────────────────────────────────────────
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta int not null,                 -- + khi nạp/tặng, - khi tiêu
  balance_after int not null,
  reason text not null,               -- 'purchase' | 'premium_grant' | 'spend' | 'refund' | 'admin'
  feature text,                       -- tính năng đã tiêu điểm, nếu có
  ref text,                           -- mã đơn hàng hoặc mã tham chiếu
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

-- ── payment_orders ─────────────────────────────────────────────────────────
create table if not exists public.payment_orders (
  id text primary key,                -- mã đơn, cũng là nội dung chuyển khoản
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'bank',
  kind text not null check (kind in ('premium', 'credits')),
  pack_id text not null,
  amount_vnd int not null,
  credits int not null default 0,     -- điểm sẽ cộng khi thành công
  days int not null default 0,        -- số ngày Premium sẽ cộng
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'expired')),
  provider_ref text,                  -- mã giao dịch bên cổng thanh toán
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  raw jsonb
);
create index if not exists payment_orders_user_idx on public.payment_orders (user_id, created_at desc);

-- ── RLS: người dùng chỉ ĐỌC dòng của mình ─────────────────────────────────
alter table public.user_plans enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.payment_orders enable row level security;

create policy user_plans_read on public.user_plans
  for select using (auth.uid() = user_id);
create policy credit_ledger_read on public.credit_ledger
  for select using (auth.uid() = user_id);
create policy payment_orders_read on public.payment_orders
  for select using (auth.uid() = user_id);
-- Không có policy INSERT/UPDATE/DELETE → chỉ service role ghi được.

-- ── Tiêu điểm một cách nguyên tử ──────────────────────────────────────────
-- Trả về số dư mới nếu đủ điểm, hoặc -1 nếu không đủ. Khoá dòng để hai lượt gọi
-- song song không cùng trừ một số điểm.
create or replace function public.spend_credits(p_user uuid, p_amount int, p_feature text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  if p_amount <= 0 then
    return -1;
  end if;

  insert into public.user_plans (user_id) values (p_user)
    on conflict (user_id) do nothing;

  select credits into v_balance from public.user_plans
    where user_id = p_user for update;

  if v_balance is null or v_balance < p_amount then
    return -1;
  end if;

  v_balance := v_balance - p_amount;
  update public.user_plans set credits = v_balance, updated_at = now()
    where user_id = p_user;
  insert into public.credit_ledger (user_id, delta, balance_after, reason, feature)
    values (p_user, -p_amount, v_balance, 'spend', p_feature);

  return v_balance;
end;
$$;

-- Cộng điểm + (tuỳ chọn) gia hạn Premium khi một đơn hàng được xác nhận đã trả.
-- Gọi từ webhook bằng service role. Chống cộng hai lần bằng cách chỉ chạy khi đơn
-- đang ở trạng thái 'pending'.
create or replace function public.apply_paid_order(p_order text, p_provider_ref text, p_raw jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.payment_orders;
  v_balance int;
  v_until timestamptz;
begin
  select * into o from public.payment_orders where id = p_order for update;
  if o.id is null or o.status <> 'pending' then
    return false;
  end if;

  update public.payment_orders
    set status = 'paid', paid_at = now(), provider_ref = p_provider_ref, raw = p_raw
    where id = p_order;

  insert into public.user_plans (user_id) values (o.user_id)
    on conflict (user_id) do nothing;

  if o.credits > 0 then
    update public.user_plans set credits = credits + o.credits, updated_at = now()
      where user_id = o.user_id
      returning credits into v_balance;
    insert into public.credit_ledger (user_id, delta, balance_after, reason, ref)
      values (o.user_id, o.credits,
              coalesce(v_balance, o.credits),
              case when o.kind = 'premium' then 'premium_grant' else 'purchase' end,
              o.id);
  end if;

  if o.days > 0 then
    select greatest(coalesce(premium_until, now()), now()) + make_interval(days => o.days)
      into v_until from public.user_plans where user_id = o.user_id;
    update public.user_plans
      set plan = 'premium', premium_until = v_until,
          monthly_credits_at = coalesce(monthly_credits_at, now()), updated_at = now()
      where user_id = o.user_id;
  end if;

  return true;
end;
$$;

-- Hết hạn Premium: chạy định kỳ (pg_cron) hoặc kiểm lười ở server.
create or replace function public.expire_premium()
returns void
language sql
security definer
set search_path = public
as $$
  update public.user_plans set plan = 'free', updated_at = now()
  where plan = 'premium' and premium_until is not null and premium_until < now();
$$;
