-- Hệ thống lỗi cá nhân V2.
--
-- Chạy tay một lần trên Supabase SQL Editor, giống supabase/lite-tier.sql.
--
-- Chuẩn hóa nhãn cũ về taxonomy V2 trước khi đặt lại ràng buộc.

-- CHẠY CẢ FILE MỘT LẦN. Bọc trong một giao dịch vì bước 1 gỡ ràng buộc cũ rồi mới
-- đặt ràng buộc mới: nếu dừng giữa chừng, bảng sẽ nằm không có ràng buộc nào và
-- dữ liệu rác lọt vào được. Có giao dịch thì hoặc xong hết, hoặc không đổi gì.
--
-- Chạy lại nhiều lần vô hại: mọi bước đều "if exists" hoặc "if not exists".

begin;

-- ── 1. Hai nhãn mới ────────────────────────────────────────────────────────
-- meaning: câu viết ra không còn đúng ý câu tiếng Việt.
-- vietnamese_translation: dịch máy móc từng chữ, ra câu người bản ngữ không nói.
alter table public.error_events drop constraint if exists error_events_error_type_check;
update public.error_events set error_type = case
  when error_type = 'verb_tense' then 'tense'
  when error_type in ('verb_form','agreement','spelling','other') then 'grammar'
  when error_type = 'natural_expression' then 'naturalness'
  else error_type end;
alter table public.error_events add constraint error_events_error_type_check
  check (error_type in (
    'tense', 'grammar', 'article', 'preposition', 'word_order',
    'vocabulary', 'collocation', 'meaning', 'naturalness', 'vietnamese_translation'
  ));

-- ── 2. Lỗi đến từ kỹ năng nào ──────────────────────────────────────────────
-- Hiện chỉ bài viết ghi lỗi. Cột này để Nghe và Nói ghi vào cùng một kho, thay vì
-- mỗi kỹ năng dựng một bảng riêng rồi không thống kê chung được.
alter table public.error_events add column if not exists source_skill text
  not null default 'writing'
  check (source_skill in ('writing', 'speaking', 'listening', 'vocab'));

-- ── 3. Quy tắc và câu mẫu ──────────────────────────────────────────────────
-- Người học cần áp được vào câu MỚI, nên chỉ nói "chỗ này sai" là chưa đủ.
alter table public.error_events add column if not exists rule text;
alter table public.error_events add column if not exists example text;

create index if not exists error_events_user_skill_idx
  on public.error_events (user_id, source_skill, created_at desc);

-- ── 4. Trạng thái thành thạo theo từng loại lỗi ────────────────────────────
-- Một dòng cho mỗi (người học × loại lỗi). Số liệu tính lại được từ error_events,
-- bảng này chỉ là bản kết đọng để truy vấn nhanh và để sinh bài luyện.
--
-- mastered đòi ĐÚNG Ở NHIỀU NGÀY KHÁC NHAU, không phải đúng nhiều lần liên tiếp:
-- làm đúng năm lần trong mười phút không nói lên điều gì về trí nhớ dài hạn.
create table if not exists public.error_mastery (
  user_id uuid not null references auth.users (id) on delete cascade,
  error_type text not null,
  occurrence_count integer not null default 0,
  clean_days integer not null default 0,
  last_seen date,
  status text not null default 'improving' check (status in ('weak', 'improving', 'mastered')),
  updated_at timestamptz not null default now(),
  primary key (user_id, error_type)
);

alter table public.error_mastery enable row level security;

drop policy if exists error_mastery_own on public.error_mastery;
create policy error_mastery_own on public.error_mastery
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Mỗi lỗi mới cập nhật ngay bản kết đọng. Không đợi Dashboard mở mới tính nên
-- lỗi từ Nói, Nghe và Viết đều xuất hiện nhất quán trên mọi thiết bị.
create or replace function public.refresh_error_mastery_from_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.error_mastery (user_id, error_type, occurrence_count, last_seen, status, updated_at)
  values (new.user_id, new.error_type, 1, new.created_at::date, 'improving', now())
  on conflict (user_id, error_type) do update
    set occurrence_count = public.error_mastery.occurrence_count + 1,
        last_seen = greatest(public.error_mastery.last_seen, excluded.last_seen),
        status = case
          when public.error_mastery.occurrence_count + 1 >= 3 then 'weak'
          else 'improving'
        end,
        clean_days = 0,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists error_events_refresh_mastery on public.error_events;
create trigger error_events_refresh_mastery
after insert on public.error_events
for each row execute function public.refresh_error_mastery_from_event();

commit;
