// Chủ đề của thư viện nghe, xếp theo lối dailydictation: mở ra là thấy Truyện
// ngắn, Hội thoại, Tin tức, TED… chứ không phải một đống video trộn lẫn.
//
// CHỈ LƯU TÊN KÊNH, không nhúng sẵn mã video nào. Danh sách video đọc từ API
// chính thức lúc thêm, nên không bao giờ cũ. Và vì chỉ nhúng trình phát của
// YouTube chứ không tải video về, phần này không đụng tới bản quyền của ai.
//
// Mọi handle dưới đây đã được gọi thử bằng khoá thật và đều trả về kênh có
// video. Handle sai thì API trả rỗng mà KHÔNG báo lỗi, nên ship một danh sách
// chưa kiểm là ship ra một màn hình chết.

/**
 * @typedef {{
 *   id: string, name: string, blurb: string, levels: string, icon: string,
 *   channels: string[], match: string[]
 * }} Topic
 */

/**
 * Số sau mỗi kênh là SỐ BÀI DÙNG ĐƯỢC trên 50 video mới nhất, đo bằng đúng bộ
 * lọc của app (bỏ Shorts, giữ 1–13 phút). Đo chứ không đoán theo số video của
 * kênh: "Easy Stories in English" có 269 video nhưng toàn truyện dài, qua bộ lọc
 * chỉ còn 1 bài — ship nó là ship ra một chủ đề trống trơn.
 *
 * @type {Topic[]}
 */
export const TOPICS = [
  {
    id: "easy",
    name: "Tiếng Anh dễ nghe",
    blurb: "Nói chậm, câu ngắn, chủ đề đời thường — chỗ nên bắt đầu.",
    levels: "A1–A2",
    icon: "cup",
    // @LearnEasyEnglish 46/50 · @LearnEnglishFluently 22/22
    channels: ["@LearnEasyEnglish", "@LearnEnglishFluently"],
    match: ["learn easy english", "learn english"],
  },
  {
    id: "stories",
    name: "Truyện kể",
    blurb: "Diễn viên đọc truyện tranh, phát âm rõ và chậm.",
    levels: "A1–B1",
    icon: "book",
    // @StorylineOnline 26/50, dài giữa 9 phút
    channels: ["@StorylineOnline"],
    match: ["storylineonline", "storyline online"],
  },
  {
    id: "conversations",
    name: "Hội thoại",
    blurb: "Người thật nói chuyện ngoài đường, không phải giọng đọc bài.",
    levels: "A2–B2",
    icon: "headphones",
    // @EasyEnglishVideos 31/50, dài giữa 9 phút
    channels: ["@EasyEnglishVideos"],
    match: ["easy british english", "easy english"],
  },
  {
    id: "daily",
    name: "Tiếng Anh hằng ngày",
    blurb: "6 Minute English và các bài ngắn có phụ đề chuẩn của BBC.",
    levels: "A2–C1",
    icon: "list",
    // @bbclearningenglish 25/50, dài giữa 6 phút
    channels: ["@bbclearningenglish"],
    match: ["bbc learning english"],
  },
  {
    id: "news",
    name: "Tin tức",
    blurb: "Tin đọc chậm, rõ từng chữ — bản tin thật nhưng vừa sức.",
    levels: "A2–B2",
    icon: "flag",
    // @VOALearningEnglish 25/50, dài giữa 2 phút
    channels: ["@VOALearningEnglish"],
    match: ["voa learning english"],
  },
  {
    id: "ted",
    name: "TED",
    blurb: "Bài nói có dàn ý chặt, từ vựng học thuật.",
    levels: "B1–C1",
    icon: "sparkles",
    // @TEDEd 49/50, dài giữa 6 phút — kênh cho ra nhiều bài dùng được nhất.
    channels: ["@TEDEd"],
    match: ["ted-ed", "ted ed"],
  },
  {
    id: "science",
    name: "Khoa học",
    blurb: "Giải thích có hình, tốc độ nhanh — hợp khi đã nghe quen.",
    levels: "B2–C1",
    icon: "compass",
    // @kurzgesagt 43/50 · @NatGeo 20/50
    channels: ["@kurzgesagt", "@NatGeo"],
    match: ["kurzgesagt", "national geographic"],
  },
  {
    id: "ielts",
    name: "IELTS",
    blurb: "Chữa đề và mẹo nghe, giọng giám khảo quen thuộc.",
    levels: "B1–C1",
    icon: "target",
    // @IELTSAdvantage 20/50 · @E2IELTS 15/50
    channels: ["@IELTSAdvantage", "@E2IELTS"],
    match: ["ielts advantage", "e2 ielts"],
  },
  {
    id: "toefl",
    name: "TOEFL",
    blurb: "Bài giảng và hội thoại trong trường, đúng dạng đề thi.",
    levels: "B1–C2",
    icon: "trophy",
    // @TSTPrep 8/50 — thấp, nhưng là kênh TOEFL duy nhất đo được có bài vừa sức.
    channels: ["@TSTPrep"],
    match: ["tst prep"],
  },
];

export const OTHER_TOPIC = {
  id: "other",
  name: "Video của bạn",
  blurb: "Video bạn tự thêm, chưa thuộc chủ đề nào.",
  levels: "",
  icon: "star",
};

/** @param {string} id @returns {Topic | null} */
export function topicById(id) {
  return TOPICS.find((topic) => topic.id === String(id ?? "")) ?? null;
}

function tidy(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Suy chủ đề của một video.
 *
 * Ưu tiên chủ đề đã lưu sẵn trên video; chưa có thì đoán theo tên kênh. Nhờ vậy
 * hàng trăm video người dùng thêm từ trước khi có chủ đề vẫn được xếp vào đúng
 * ngăn, không phải thêm lại từ đầu.
 *
 * @param {{topic?: string, channel?: string}} video
 * @returns {string} mã chủ đề, hoặc "other" nếu không nhận ra
 */
export function topicOf(video) {
  const saved = String(video?.topic ?? "");
  if (saved && topicById(saved)) return saved;
  const channel = tidy(video?.channel);
  if (!channel) return OTHER_TOPIC.id;
  const hit = TOPICS.find((topic) => topic.match.some((name) => channel.includes(name)));
  return hit ? hit.id : OTHER_TOPIC.id;
}

/**
 * Xếp cả danh mục vào các chủ đề, kèm số bài đã lấy được phụ đề.
 *
 * Chủ đề rỗng vẫn giữ lại: người học cần thấy có chủ đề đó để bấm nạp, chứ
 * không phải đoán rằng app không hỗ trợ.
 *
 * @param {{videoId?: string, topic?: string, channel?: string}[]} videos
 * @param {{videoId?: string}[]} lessons
 * @returns {(Topic & {count: number, ready: number})[]}
 */
export function topicShelves(videos, lessons) {
  const list = Array.isArray(videos) ? videos : [];
  const done = new Set((Array.isArray(lessons) ? lessons : []).map((item) => item?.videoId));
  const counts = new Map();
  for (const video of list) {
    const id = topicOf(video);
    const row = counts.get(id) ?? { count: 0, ready: 0 };
    row.count += 1;
    if (done.has(video?.videoId)) row.ready += 1;
    counts.set(id, row);
  }
  const shelves = TOPICS.map((topic) => ({ ...topic, ...(counts.get(topic.id) ?? { count: 0, ready: 0 }) }));
  const other = counts.get(OTHER_TOPIC.id);
  // "Video của bạn" chỉ hiện khi thật sự có video lạc ngoài mọi chủ đề.
  if (other) shelves.push({ ...OTHER_TOPIC, channels: [], match: [], ...other });
  return shelves;
}

/** Video thuộc một chủ đề. @param {{topic?: string, channel?: string}[]} videos @param {string} id */
export function videosInTopic(videos, id) {
  return (Array.isArray(videos) ? videos : []).filter((video) => topicOf(video) === String(id ?? ""));
}
