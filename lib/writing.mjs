// Bài luyện viết theo dạng đề thi: chấm theo bốn tiêu chí rồi quy ra band.
//
// Bốn tiêu chí là cách chấm công khai của IELTS Writing. Điểm chung là TRUNG BÌNH
// CỘNG của bốn tiêu chí, làm tròn tới nửa band — không phải trung bình rồi làm
// tròn xuống, cũng không phải lấy tiêu chí thấp nhất.
//
// Nói rõ giới hạn: đây là điểm ƯỚC LƯỢNG do mô hình ngôn ngữ chấm, không phải
// điểm thi thật. Giao diện phải gọi đúng tên là "band ước lượng".

export const CRITERIA = [
  { key: "task", label: "Trả lời đúng yêu cầu", hint: "Có làm đúng việc đề bảo không, có đủ ý không" },
  { key: "coherence", label: "Mạch lạc và liên kết", hint: "Bố cục đoạn, cách nối ý" },
  { key: "lexical", label: "Vốn từ", hint: "Dùng từ đa dạng và chính xác" },
  { key: "grammar", label: "Ngữ pháp", hint: "Cấu trúc câu đa dạng và đúng" },
];

export const EXAMS = [
  { key: "ielts", label: "IELTS", bandMax: 9 },
  { key: "toeic", label: "TOEIC", bandMax: 5 },
  { key: "vstep", label: "VSTEP", bandMax: 10 },
];

/** Số từ trong bài. Đề thi nào cũng có mức tối thiểu, thiếu là bị trừ. */
export function countWords(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Làm tròn tới nửa band.
 * IELTS làm tròn .25 lên .5 và .75 lên band tròn kế tiếp, nên chỉ cần nhân đôi,
 * làm tròn thường, rồi chia đôi.
 */
export function toHalfBand(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(Math.max(0, Math.min(9, number)) * 2) / 2;
}

/**
 * Band chung từ bốn tiêu chí.
 * Thiếu tiêu chí nào thì bỏ qua tiêu chí đó thay vì tính nó bằng 0 — chấm hụt một
 * tiêu chí mà kéo cả band xuống thì con số thành vô nghĩa.
 */
export function bandFrom(scores) {
  const values = CRITERIA.map((item) => Number(scores?.[item.key])).filter((value) => Number.isFinite(value) && value >= 0);
  if (!values.length) return 0;
  return toHalfBand(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** Tiêu chí yếu nhất — thứ nên sửa trước nếu muốn lên band. */
export function weakestCriterion(scores) {
  let worst = null;
  for (const item of CRITERIA) {
    const value = Number(scores?.[item.key]);
    if (!Number.isFinite(value)) continue;
    if (!worst || value < worst.score) worst = { ...item, score: value };
  }
  return worst;
}

export const attemptsKey = "lexilo:writing:v1";
export const MAX_ATTEMPTS = 500;

/** Một lượt viết đã chấm, làm sạch trước khi lưu. */
export function makeAttempt({ taskId, taskTitle, exam, part, answer, scores, band, comment }, now = new Date()) {
  return {
    at: now.toISOString(),
    taskId: String(taskId ?? ""),
    taskTitle: String(taskTitle ?? "").slice(0, 200),
    exam: EXAMS.some((item) => item.key === exam) ? exam : "ielts",
    part: part === 2 ? 2 : 1,
    words: countWords(answer),
    // Không lưu nguyên bài viết: nó dài, và phần đáng giữ lại là điểm và nhận xét.
    excerpt: String(answer ?? "").trim().slice(0, 300),
    scores: Object.fromEntries(CRITERIA.map((item) => [item.key, Number(scores?.[item.key]) || 0])),
    band: toHalfBand(band ?? bandFrom(scores)),
    comment: String(comment ?? "").slice(0, 600),
  };
}

export function readAttempts() {
  try {
    const raw = localStorage.getItem(attemptsKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.at === "string") : [];
  } catch {
    return [];
  }
}

export function saveAttempt(attempt) {
  const next = [attempt, ...readAttempts()].slice(0, MAX_ATTEMPTS);
  try {
    localStorage.setItem(attemptsKey, JSON.stringify(next));
  } catch {
    // Trình duyệt chặn lưu thì bài vẫn chấm được, chỉ mất lịch sử.
  }
  return next;
}

/**
 * Tổng hợp tiến độ.
 * Band hiện tại lấy từ bài GẦN NHẤT chứ không phải trung bình mọi bài: người học
 * tiến bộ thì trung bình cả đời kéo tụt con số xuống và nhìn như không tiến.
 */
export function summarise(attempts) {
  const list = attempts ?? [];
  if (!list.length) return { count: 0, latest: 0, best: 0, average: 0, byCriterion: [], trend: 0 };

  const bands = list.map((item) => Number(item.band) || 0);
  const average = toHalfBand(bands.reduce((sum, value) => sum + value, 0) / bands.length);
  const byCriterion = CRITERIA.map((item) => {
    const values = list.map((entry) => Number(entry.scores?.[item.key])).filter(Number.isFinite);
    return { ...item, score: values.length ? toHalfBand(values.reduce((sum, value) => sum + value, 0) / values.length) : 0 };
  });

  // So bài gần nhất với bài liền trước, chỉ để nói "lên/xuống", không suy diễn thêm.
  // KHÔNG dùng toHalfBand ở đây: nó chặn về 0–9 vì dành cho điểm band, mà hiệu số
  // thì âm được — chặn xong thì mọi lần tụt điểm đều hiện thành 0.
  const trend = list.length > 1 ? Math.round((bands[0] - bands[1]) * 2) / 2 : 0;
  return { count: list.length, latest: bands[0], best: Math.max(...bands), average, byCriterion, trend };
}
