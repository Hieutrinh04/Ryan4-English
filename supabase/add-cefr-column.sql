-- Thêm cột `cefr` để lưu bậc CEFR ước lượng (A1–C2) của từ vựng lên cloud, để lần
-- tải sau — kể cả trên máy khác — không phải xếp lại. Xem lib/word-level.mjs.
--
-- Chạy MỘT LẦN trong Supabase SQL Editor. An toàn nếu chạy lại (add column if not exists).
-- App dùng bảng `words`; lược đồ mới trong schema.sql dùng `user_custom_words`.
-- Chạy dòng khớp với bảng dự án của bạn (dòng kia sẽ báo "table does not exist" — bỏ qua).

alter table public.words add column if not exists cefr text;
alter table public.user_custom_words add column if not exists cefr text;
