-- Chạy file này MỘT LẦN trong Supabase SQL Editor để tạo đúng lược đồ Lexilo.
--
-- Bối cảnh: dự án Supabase hiện tại có sẵn một bảng "words" KHÁC (cột id, word, example,
-- created_at) không thuộc Lexilo, và chưa có word_states / review_logs / daily_stats.
-- Vì vậy ứng dụng không đọc/ghi được và luôn rơi về chế độ chỉ lưu trên máy.
--
-- Trước khi chạy, hãy tự kiểm tra bảng "words" cũ có dữ liệu bạn cần giữ không:
--     select count(*) from public.words;
-- Lệnh drop bên dưới XOÁ VĨNH VIỄN bảng đó. Nếu muốn giữ lại, đổi thành:
--     alter table public.words rename to words_old;

drop table if exists public.words cascade;

\i schema.sql
-- Nếu SQL Editor không hỗ trợ \i, hãy dán toàn bộ nội dung file schema.sql vào đây và chạy.
