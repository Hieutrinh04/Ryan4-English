-- Góp ý của người dùng.
--
-- Chạy tay một lần trên Supabase SQL Editor, giống supabase/lite-tier.sql.
--
-- Nguyên tắc: người dùng CHỈ được ghi vào, không được đọc lại của người khác và
-- không sửa/xoá được sau khi gửi. Việc đọc để xử lý là của service role (màn
-- Quản trị), nên ở đây không mở policy select cho ai.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  -- Giữ email tại thời điểm gửi: tài khoản có thể đổi email hoặc bị xoá, mà
  -- góp ý thì vẫn cần liên hệ lại được.
  email text,
  kind text not null default 'other' check (kind in ('bug', 'idea', 'other')),
  message text not null check (char_length(message) between 5 and 4000),
  -- Bối cảnh lúc gửi: màn đang mở, cỡ màn hình, trình duyệt. Giúp tái hiện lỗi
  -- mà không phải hỏi lại người dùng.
  context jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new', 'seen', 'done')),
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_status_idx on public.feedback (status, created_at desc);

alter table public.feedback enable row level security;

-- Người đã đăng nhập gửi được góp ý mang tên mình. Khách vãng lai đi qua
-- service role ở route /api/feedback nên không cần policy riêng.
drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback
  for insert with check (auth.uid() = user_id);

-- Cố ý KHÔNG có policy select/update/delete: chỉ service role đọc và xử lý.
