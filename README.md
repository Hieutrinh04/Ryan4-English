# Lexilo

Ứng dụng học từ vựng tiếng Anh theo hộp Leitner, có sẵn bộ 983 từ theo chủ đề và
các chế độ luyện tập kiểu Quizlet. Giao diện tiếng Việt.

## Chạy thử

```bash
npm install
npm run dev
```

Mở http://localhost:3000. Không cần cấu hình gì — app chạy được ngay ở chế độ lưu
trên máy.

## Tính năng

**Ôn tập theo lịch Leitner** — 6 hộp, khoảng cách ôn giãn dần 1/3/7/14/30/90 ngày.
Mỗi thẻ chấm bốn mức Quên / Khó / Được / Dễ, quên thì gặp lại ngay hôm sau.
Phiên ôn có 5 kiểu thẻ đổi được giữa chừng: Việt→Anh, Anh→Việt, trắc nghiệm,
nghe viết, và trộn.

**Luyện tập** — Thẻ ghi nhớ (có đếm thẻ, xáo trộn, tự động phát, theo dõi
đã biết/đang học), Học (chia vòng 7 từ, từ trắc nghiệm lên tự gõ, lưu tiến độ),
Kiểm tra (trộn 4 dạng câu, chấm điểm cuối bài), Nối cặp, Nghe và viết,
Chép chính tả.

**Tổ chức từ vựng** — Từ tự thêm xếp theo ngày học trong tuần; bộ 983 từ chia
theo 27 thư mục chủ đề. Nhập từ Excel hoặc dán danh sách, xuất CSV/Quizlet.

**Tra từ tự động** — Thêm một từ là app tự điền IPA, nghĩa, định nghĩa Anh–Anh,
câu ví dụ kèm bản dịch, cụm nên học, đồng/trái nghĩa và chủ đề IELTS.

**Theo dõi** — Đếm ngược ngày thi, chuỗi ngày học liên tiếp, bảng Leitner theo
nhóm, nhắc ôn các từ đến hạn.

## Dữ liệu

Mặc định mọi thứ lưu trong `localStorage` của trình duyệt. Muốn đồng bộ nhiều
thiết bị thì tạo một dự án Supabase, chạy [`supabase/schema.sql`](supabase/schema.sql)
rồi đặt biến môi trường trong `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

### Góp ý của người dùng

Nút **Góp ý** ở thanh trên cùng và cuối Trang chủ ghi vào bảng `feedback`:

1. Chạy [`supabase/feedback.sql`](supabase/feedback.sql) trong Supabase SQL Editor.
2. Đặt `SUPABASE_SERVICE_ROLE_KEY` — route ghi bằng service role để khách chưa
   đăng nhập cũng góp ý được, và để bảng không phải mở quyền đọc cho ai.
3. Đọc lại qua `GET /api/feedback` khi tài khoản nằm trong `ADMIN_EMAILS`.

Chưa cấu hình thì nút vẫn hiện nhưng báo "máy chủ chưa cấu hình để nhận góp ý"
thay vì lỗi trắng màn.

### Ký ức học tập RAG

Để AI truy xuất lỗi dịch cũ và nội dung bài học liên quan theo từng tài khoản:

1. Chạy [`supabase/rag-schema.sql`](supabase/rag-schema.sql) trong Supabase SQL Editor.
2. Đặt `GEMINI_API_KEY`; mặc định app dùng `gemini-embedding-001` với 768 chiều.
3. Có thể kiểm tra trạng thái khi đã đăng nhập qua `GET /api/ai/rag/status`.

RAG có đường lui an toàn: nếu chưa chạy migration hoặc embedding tạm lỗi, chấm bài,
luyện nói và tóm tắt vẫn chạy bằng ngữ cảnh trực tiếp như trước.

Các file dữ liệu dựng sẵn trong `public/`:

| File | Nội dung |
|---|---|
| `vocabulary-1000.json` | 983 từ theo 27 chủ đề |
| `vocabulary-examples.json` | Câu ví dụ riêng cho từng từ kèm bản dịch |
| `vocabulary-enrichment.json` | Định nghĩa, đồng/trái nghĩa, cụm, chủ đề IELTS |
| `usage-details.json` | Ngữ cảnh cho 2484 từ đồng/trái nghĩa |

Sinh lại bằng các script trong `scripts/` (gọi ra từ điển và Datamuse, mất vài phút).

## Lệnh

```bash
npm run dev     # máy chủ phát triển
npm run build   # dựng bản production
npm test        # dựng rồi chạy toàn bộ kiểm thử
npm run lint    # kiểm tra mã
```

## Công nghệ

React 19 + [vinext](https://github.com/cloudflare/vinext) trên Cloudflare Workers,
Supabase (tuỳ chọn), không dùng thư viện UI ngoài.
