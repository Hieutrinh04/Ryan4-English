# Lexilo — tiện ích lấy bài từ YouTube

Lấy phụ đề của video YouTube đang mở rồi tạo bài nghe chép chính tả và nói nhại trong Lexilo.

## Vì sao cần một tiện ích riêng

Máy chủ không tải được phụ đề YouTube. Đây là kết quả đo thật, không phải phỏng đoán:

| Cách thử | Kết quả |
| --- | --- |
| `captions.download` của YouTube Data API | `401` — *"API keys are not supported by this API"*, chỉ chủ kênh mới tải được, và phải bằng OAuth |
| Đường dẫn phụ đề lấy từ trang xem | `200` nhưng thân rỗng — chữ ký gắn với IP và phiên của người đang xem |
| InnerTube (`youtubei/v1/player`) | `400` với client di động, `UNPLAYABLE` với client web |

Đã thử từ cả máy chủ lẫn máy người dùng, đều vậy.

Tiện ích thì chạy **bên trong trang YouTube**, cùng địa chỉ IP và cùng phiên đăng nhập,
nên yêu cầu được phục vụ bình thường. Đó là chỗ chặn duy nhất mà tiện ích gỡ được.

## Cài đặt (chế độ nhà phát triển)

1. Mở `chrome://extensions`
2. Bật **Developer mode** ở góc trên bên phải
3. Bấm **Load unpacked** rồi chọn thư mục `extension/` này
4. Nếu Lexilo không chạy ở `http://localhost:3000`, mở phần cài đặt của tiện ích và điền địa chỉ đúng

## Cách dùng

1. Mở một video YouTube có phụ đề
2. Bấm biểu tượng Lexilo trên thanh công cụ
3. Chọn bản phụ đề (ưu tiên sẵn bản tiếng Anh do người thật làm, không phải bản máy tự nghe)
4. Bấm **Tạo bài trong Lexilo** — một thẻ Lexilo mở ra kèm bài đã cắt câu

## Video không được tải hay lưu

Tiện ích chỉ gửi sang Lexilo: mã video, tiêu đề, tên kênh, thời lượng, và phần lời đã cắt câu.
Lúc học thì Lexilo nhúng trình phát của YouTube — video vẫn phát từ máy chủ YouTube.

Bài đi qua phần neo của địa chỉ (`#lesson=…`), không qua máy chủ trung gian nào.

## Sửa mã

`extension/youtube.js` **được sinh tự động** từ `lib/youtube.mjs`. Đừng sửa tay.
Sửa bản gốc rồi chạy:

```bash
npm run build:extension
```

`tests/extension-sync.test.mjs` kiểm hai bản cắt câu ra kết quả giống hệt nhau — để bài
lấy từ tiện ích không bao giờ khác bài tạo trong app.
