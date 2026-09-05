// Công thức điểm cho bài viết, và ranh giới giữa LỖI và GỢI Ý.
//
// Trước đây prompt chỉ nói "meaning và grammar nặng nhất" rồi để mô hình tự cân,
// nên cùng một bài chấm hai lần ra hai điểm khác nhau mà không giải thích được vì
// sao. Nay bốn điểm thành phần do mô hình chấm, còn điểm tổng do CHÚNG TA tính —
// mô hình không được trả về điểm tổng nữa.

/** Trọng số: ý nghĩa nặng nhất vì mục tiêu của người học là giao tiếp được. */
export const SCORE_WEIGHTS = {
  meaning: 0.35,
  grammar: 0.25,
  vocabulary: 0.20,
  naturalness: 0.20,
};

export const CRITERIA = Object.keys(SCORE_WEIGHTS);

/** Nhãn tiếng Việt của từng tiêu chí, dùng chung cho mọi nơi hiển thị. */
export const CRITERION_LABELS = {
  meaning: "Ý nghĩa",
  grammar: "Ngữ pháp",
  vocabulary: "Từ vựng",
  naturalness: "Tự nhiên",
};

const clamp100 = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

/** Bốn điểm thành phần, luôn đủ bốn khoá và luôn nằm trong 0–100. */
export function normaliseCriteria(raw) {
  return Object.fromEntries(CRITERIA.map((key) => [key, clamp100(raw?.[key])]));
}

/**
 * Điểm tổng từ bốn điểm thành phần.
 *
 * Tính ở đây chứ không hỏi mô hình: điểm phải cộng lại đúng từ những con số
 * người học nhìn thấy, nếu không thì bảng điểm thành phần chỉ là trang trí.
 */
export function overallScore(criteria) {
  const scores = normaliseCriteria(criteria);
  const total = CRITERIA.reduce((sum, key) => sum + scores[key] * SCORE_WEIGHTS[key], 0);
  return Math.round(total);
}

/**
 * "Đúng" hay chưa.
 *
 * Ngưỡng đặt trên Ý NGHĨA chứ không trên điểm tổng: câu truyền đạt đúng ý mà sai
 * một mạo từ vẫn là dịch được, còn câu đẹp ngữ pháp nhưng lạc ý thì không. Đây
 * chính là điều tài liệu V2 đòi — không đánh sai câu chỉ vì khác câu mẫu.
 */
export const MEANING_PASS = 70;
export function isCorrect(criteria) {
  return normaliseCriteria(criteria).meaning >= MEANING_PASS;
}

/** Trần số mục mỗi loại. Nhiều hơn thì người học không nhớ nổi mục nào. */
export const MAX_ERRORS = 3;
export const MAX_IMPROVEMENTS = 2;
export const MAX_CHUNKS = 3;

/**
 * Tách phản hồi làm hai loại.
 *
 * LỖI là chỗ sai, phải sửa. GỢI Ý là chỗ đã đúng nhưng có cách nói tự nhiên hơn.
 * Gộp chung một danh sách khiến người học tưởng mình sai nhiều gấp đôi thực tế —
 * và người học A1–B2 bỏ cuộc vì thấy toàn màu đỏ, không phải vì thiếu thông tin.
 */
export function splitFeedback(items) {
  const list = Array.isArray(items) ? items : [];
  const errors = [];
  const improvements = [];
  for (const item of list) {
    if (!item) continue;
    const target = item.kind === "improvement" ? improvements : errors;
    if (!target.some((seen) => seen.wrong === item.wrong && seen.right === item.right)) target.push(item);
  }
  return {
    errors: errors.slice(0, MAX_ERRORS),
    improvements: improvements.slice(0, MAX_IMPROVEMENTS),
  };
}
