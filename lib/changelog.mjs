// Nhật ký cập nhật hiện ở cuối Trang chủ.
//
// Danh sách này viết tay chứ không sinh từ git log: người học không quan tâm
// từng commit, họ quan tâm "app có gì mới cho tôi". Một bản phát hành ở đây
// gom nhiều commit lại thành vài câu nói được thành lời.
//
// Quy ước: bản mới nhất đứng đầu. Mỗi mục có `kind` để tô màu:
//   "new"     — thứ trước đây chưa có
//   "better"  — thứ đã có, nay làm tốt hơn
//   "fix"     — sửa lỗi

/** @typedef {{ kind: "new" | "better" | "fix", text: string }} ChangeItem */
/** @typedef {{ version: string, date: string, title: string, items: ChangeItem[] }} Release */

/** @type {Release[]} */
export const RELEASES = [
  {
    version: "1.6.0",
    date: "2026-09-02",
    title: "Trang chủ và Tiến độ sắp lại cho dễ đọc",
    items: [
      { kind: "better", text: "Trang chủ mở ra là thấy việc hôm nay trước: từ đến hạn ôn và kế hoạch 25–35 phút." },
      { kind: "better", text: "Tiến độ chia ba nhóm rõ ràng, bảng Leitner chi tiết thu gọn lại nên không còn rối mắt." },
      { kind: "better", text: "Chuỗi ngày học gộp về một chỗ duy nhất, kèm kỷ lục và lời nhắc giữ chuỗi." },
      { kind: "new", text: "Nút Góp ý ngay trên thanh trên cùng — gửi lỗi hoặc ý tưởng không cần rời màn hình." },
      { kind: "new", text: "Mục Cập nhật ở cuối Trang chủ để bạn biết app vừa thay đổi những gì." },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-08-30",
    title: "Gói Lite và cách tính phí",
    items: [
      { kind: "new", text: "Thêm gói Lite bên cạnh Premium: mở phần AI dùng hằng ngày với giá thấp hơn." },
      { kind: "new", text: "Thanh toán bằng mã QR ngân hàng, không tự động gia hạn." },
      { kind: "better", text: "Bảng so sánh gói lấy số thẳng từ hạn mức thật, nên không bao giờ quảng cáo sai." },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-08-27",
    title: "Nghe chép chính xác theo từng câu",
    items: [
      { kind: "fix", text: "Mốc câu bám đúng giờ thật của phụ đề thay vì trải đều, nên câu không còn lệch tiếng." },
      { kind: "fix", text: "Câu dừng đúng lúc dứt lời, không bắt bạn nghe hết đoạn nhạc nền." },
      { kind: "new", text: "Nhờ AI nghe hộ khi video không có phụ đề, làm được ngay trong tiện ích trình duyệt." },
      { kind: "better", text: "Thư viện Nghe chép xếp theo chủ đề bằng hàng chip, tìm bài nhanh hơn lưới thẻ cũ." },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-08-26",
    title: "Kho từ vựng ba tầng",
    items: [
      { kind: "new", text: "Danh sách từ do bạn tự tạo, lồng được danh sách con." },
      { kind: "better", text: "Kho từ vựng đi theo ba tầng: danh sách → thư mục → từ." },
      { kind: "better", text: "Bỏ video Shorts và hạ trần thời lượng xuống 13 phút để bài luyện vừa sức." },
    ],
  },
];

/** Nhãn tiếng Việt cho từng loại thay đổi. */
export const CHANGE_LABEL = { new: "Mới", better: "Cải thiện", fix: "Sửa lỗi" };

/** Bản mới nhất — dùng để chấm dấu "có gì mới" trên giao diện. */
export function latestRelease() {
  return RELEASES[0] ?? null;
}

/**
 * Người dùng đã xem bản mới nhất chưa.
 *
 * `seen` là chuỗi phiên bản đã lưu ở máy. So sánh bằng chuỗi chứ không phải
 * theo thứ tự số: chỉ cần biết "có đúng bản đang phát hành không".
 */
export function hasUnseenRelease(seen) {
  const latest = latestRelease();
  return Boolean(latest) && seen !== latest.version;
}
