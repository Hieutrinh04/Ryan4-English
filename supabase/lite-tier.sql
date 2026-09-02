-- Thêm bậc Lite vào hệ phân quyền.
--
-- Chạy MỘT LẦN trong Supabase SQL Editor, SAU supabase/plans-schema.sql.
-- Toàn bộ file này chạy lại nhiều lần vẫn an toàn.
--
-- Ba việc:
--   1. Cho phép giá trị 'lite' trong user_plans.plan.
--   2. Thêm cột tier vào payment_orders để đơn hàng nhớ mình bán bậc nào.
--   3. Sửa apply_paid_order() để bật đúng bậc đã mua, thay vì luôn bật 'premium'.

-- ── 1. Nới ràng buộc bậc ───────────────────────────────────────────────────
alter table public.user_plans drop constraint if exists user_plans_plan_check;
alter table public.user_plans
  add constraint user_plans_plan_check check (plan in ('free', 'lite', 'premium'));

-- ── 2. Đơn hàng nhớ bậc ────────────────────────────────────────────────────
-- Mặc định 'premium' để mọi đơn CŨ vẫn hiểu đúng: trước khi có Lite thì mọi đơn
-- đều là Premium.
alter table public.payment_orders
  add column if not exists tier text not null default 'premium'
  check (tier in ('lite', 'premium'));

-- ── 3. Bật đúng bậc đã mua ─────────────────────────────────────────────────
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
  v_plan text;
  v_active_tier text;
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
      values (o.user_id, o.credits, coalesce(v_balance, o.credits),
              case when o.kind = 'premium' then 'premium_grant' else 'purchase' end,
              o.id);
  end if;

  if o.days > 0 then
    -- Bậc đang có hiệu lực, nếu còn hạn.
    select case when premium_until is not null and premium_until > now() then plan else 'free' end
      into v_active_tier
      from public.user_plans where user_id = o.user_id;

    -- KHÔNG hạ bậc: người đang dùng Premium mà mua thêm Lite thì được cộng ngày
    -- nhưng vẫn giữ Premium. Nếu không, một đơn Lite rẻ tiền sẽ cắt mất quyền
    -- họ đã trả tiền để có.
    v_plan := case
      when v_active_tier = 'premium' or o.tier = 'premium' then 'premium'
      else 'lite'
    end;

    select greatest(coalesce(premium_until, now()), now()) + make_interval(days => o.days)
      into v_until from public.user_plans where user_id = o.user_id;

    update public.user_plans
      set plan = v_plan, premium_until = v_until,
          monthly_credits_at = coalesce(monthly_credits_at, now()), updated_at = now()
      where user_id = o.user_id;
  end if;

  return true;
end;
$$;
