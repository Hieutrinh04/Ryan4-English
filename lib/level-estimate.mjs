// Ước lượng trình độ của một bài từ chính lời thoại của nó.
//
// VÌ SAO ĐO CHỨ KHÔNG GÁN: trước đây tôi từ chối in nhãn A1–C1 lên thẻ vì
// YouTube không cho biết trình độ, mà bịa một chữ "B2" thì người học sẽ chọn
// bài dựa vào con số không có thật. Đo từ chính phụ đề thì khác: đó là số đếm
// được, kiểm chứng được, và nói rõ là ước lượng.
//
// ĐO CÁI GÌ: hai dấu hiệu đếm được thẳng từ chữ, không cần từ điển ngoài.
//   1. Số từ trung bình mỗi câu — câu càng dài càng khó theo kịp khi nghe.
//   2. Tỉ lệ từ dài (từ 8 chữ cái trở lên) — thay cho độ hiếm của từ vựng.
//
// GIỚI HẠN PHẢI NÓI RÕ: đây KHÔNG phải xếp loại CEFR chính thức. Nó không biết
// chủ đề khó hay dễ, không biết người nói nhanh hay chậm, không nghe được giọng
// vùng miền. Một bài đọc chậm rãi toàn từ dài vẫn dễ nghe hơn một bài nói nhanh
// toàn từ ngắn. Vì vậy giao diện luôn đánh dấu đây là ước lượng.

export const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

/** Ngưỡng chuyển bậc, viết thẳng ra để đọc là hiểu và sửa được. */
const BANDS = [
  { level: "A1", maxWords: 8, maxLong: 0.06 },
  { level: "A2", maxWords: 11, maxLong: 0.1 },
  { level: "B1", maxWords: 15, maxLong: 0.15 },
  { level: "B2", maxWords: 20, maxLong: 0.22 },
];

/** Số đo thô của một đoạn chữ. Tách riêng để kiểm thử được từng con số. */
export function textMetrics(text) {
  const clean = String(text ?? "").trim();
  if (!clean) return { words: 0, sentences: 0, wordsPerSentence: 0, longShare: 0 };

  const words = clean.split(/\s+/).map((word) => word.replace(/[^\p{L}'-]/gu, "")).filter(Boolean);
  // Đếm câu theo dấu kết; không có dấu nào thì cả đoạn tính là một câu.
  const sentences = Math.max(1, (clean.match(/[.!?]+/g) ?? []).length);
  if (!words.length) return { words: 0, sentences, wordsPerSentence: 0, longShare: 0 };

  const long = words.filter((word) => word.length >= 8).length;
  return {
    words: words.length,
    sentences,
    wordsPerSentence: Math.round((words.length / sentences) * 10) / 10,
    longShare: Math.round((long / words.length) * 1000) / 1000,
  };
}

/**
 * Trình độ ước lượng của một đoạn chữ.
 *
 * Lấy bậc CAO HƠN trong hai dấu hiệu: một bài câu ngắn nhưng đầy từ chuyên
 * ngành vẫn khó, và ngược lại. Chấm theo cái dễ hơn là hạ thấp bài thật sự khó.
 */
export function estimateLevel(text) {
  const metrics = textMetrics(text);
  // Quá ít chữ thì không đủ căn cứ; nói không biết còn hơn đoán liều.
  if (metrics.words < 20) return null;

  const byLength = BANDS.find((band) => metrics.wordsPerSentence <= band.maxWords)?.level ?? "C1";
  const byWords = BANDS.find((band) => metrics.longShare <= band.maxLong)?.level ?? "C1";
  return LEVELS[Math.max(LEVELS.indexOf(byLength), LEVELS.indexOf(byWords))];
}

/** Trình độ của một bài, tính từ toàn bộ lời thoại đã cắt câu. */
export function lessonLevel(lesson) {
  const sentences = Array.isArray(lesson?.sentences) ? lesson.sentences : [];
  if (!sentences.length) return null;
  return estimateLevel(sentences.map((item) => String(item?.text ?? "")).join(" "));
}

/** Bài này có nằm trong mức đang lọc không. Chưa đo được thì không lọt bộ lọc. */
export function matchesLevel(level, wanted) {
  if (!wanted) return true;
  return level === wanted;
}
