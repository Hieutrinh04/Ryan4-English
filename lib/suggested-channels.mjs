// Kênh gợi ý sẵn cho thư viện.
//
// Để thư viện có nội dung ngay từ lần mở đầu tiên, thay vì một màn hình trống
// bắt người dùng tự đi tìm link. Chỉ lưu TÊN KÊNH — danh sách video được đọc từ
// API chính thức lúc thêm, nên không bao giờ cũ và không phải nhúng sẵn mã video
// nào vào mã nguồn.
//
// Mỗi handle dưới đây đã được gọi thử bằng khoá thật và đều trả về video. Handle
// sai thì API trả rỗng mà không báo lỗi, nên ship một danh sách chưa kiểm là
// ship ra một màn hình chết.

export const SUGGESTED_CHANNELS = [
  {
    handle: "@bbclearningenglish",
    name: "BBC Learning English",
    levels: "A2–C1",
    blurb: "6 Minute English và các bài ngắn có phụ đề chuẩn.",
  },
  {
    handle: "@VOALearningEnglish",
    name: "VOA Learning English",
    levels: "A1–B1",
    blurb: "Nói chậm, rõ từng chữ — hợp khi mới bắt đầu nghe.",
  },
  {
    handle: "@EasyEnglishVideos",
    name: "Easy British English",
    levels: "A2–B2",
    blurb: "Phỏng vấn người đi đường, tiếng Anh đời thường.",
  },
  {
    handle: "@englishwithlucy",
    name: "English with Lucy",
    levels: "A2–C1",
    blurb: "Phát âm và cách dùng từ, giọng Anh-Anh.",
  },
  {
    handle: "@TEDEd",
    name: "TED-Ed",
    levels: "B1–C1",
    blurb: "Bài giảng ngắn có hình minh hoạ, nhiều chủ đề.",
  },
  {
    handle: "@kurzgesagt",
    name: "Kurzgesagt – In a Nutshell",
    levels: "B2–C1",
    blurb: "Khoa học kể bằng hình, nhịp nói nhanh.",
  },
  {
    handle: "@NatGeo",
    name: "National Geographic",
    levels: "B2–C1",
    blurb: "Thiên nhiên và khám phá, giọng kể chuyện.",
  },
];

/** Kênh nạp sẵn lần đầu: chọn kênh dễ nghe nhất, không phải kênh nhiều video nhất. */
export const DEFAULT_CHANNEL = SUGGESTED_CHANNELS[0];

/** Đường dẫn kênh để gửi sang API. */
export function channelUrl(handle) {
  const name = String(handle ?? "").trim();
  return /^@[\w.-]{2,}$/.test(name) ? `https://www.youtube.com/${name}` : "";
}

/** Kênh nào đã có video trong danh mục rồi — để không mời thêm lần nữa. */
export function alreadyAdded(channels, catalogue) {
  const names = new Set((Array.isArray(catalogue) ? catalogue : []).map((item) => String(item?.channel ?? "").toLowerCase()));
  return (Array.isArray(channels) ? channels : []).map((channel) => ({
    ...channel,
    added: names.has(String(channel.name).toLowerCase()),
  }));
}
