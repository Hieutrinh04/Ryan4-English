// Trạng thái thành thạo của TỪNG LOẠI LỖI, tính lại từ nhật ký bài làm.
//
// Cùng nguyên tắc với XP: không cộng dồn vào một ô riêng mà tính lại mỗi lần từ
// dữ liệu thật, nên con số không bao giờ lệch với việc người học đã làm.
//
// Điều kiện "thành thạo" đặt trên SỐ NGÀY KHÁC NHAU, không phải số lần liên tiếp.
// Làm đúng năm lần trong mười phút không chứng minh được gì về trí nhớ dài hạn —
// đây đúng là nguyên tắc lịch Leitner đang dùng cho từ vựng, áp sang cho lỗi.

import { ERROR_LABELS, ERROR_TYPES, normaliseErrorType } from "./error-taxonomy.mjs";

/** Số ngày khác nhau không tái phạm thì coi là đã sửa được. */
export const MASTERY_CLEAN_DAYS = 3;
/** Dưới ngần này lần mắc thì chưa đủ dữ liệu để gọi là điểm yếu. */
export const WEAK_MIN_HITS = 3;

export const MASTERY_LABELS = {
  weak: "Yếu",
  improving: "Đang tiến bộ",
  mastered: "Đã sửa được",
};

/**
 * Gom nhật ký theo loại lỗi.
 *
 * Mỗi bài làm được xem là một "lần gặp" của loại lỗi đó: nếu bài có nhãn lỗi thì
 * là tái phạm, nếu không có thì là một lần vượt qua. Chỉ tính những bài làm SAU
 * lần mắc đầu tiên — trước đó người học chưa từng gặp lỗi này nên không thể coi
 * là đã sửa được.
 */
export function errorStats(entries, now = new Date()) {
  const list = [...(entries ?? [])].map((entry) => ({
    ...entry,
    errorTypes: [...new Set((entry.errorTypes ?? []).map(normaliseErrorType))],
    assessedTypes: Array.isArray(entry.assessedTypes) ? [...new Set(entry.assessedTypes.map(normaliseErrorType))] : entry.assessedTypes,
  })).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const today = now.toISOString().slice(0, 10);

  return ERROR_TYPES.map((type) => {
    const firstHit = list.findIndex((entry) => (entry.errorTypes ?? []).includes(type));
    if (firstHit < 0) return null;

    const since = list.slice(firstHit);
    const hits = since.filter((entry) => (entry.errorTypes ?? []).includes(type));
    const hasAssessmentScopes = since.some((entry) => Array.isArray(entry.assessedTypes));
    const cleanDays = new Set(
      since.filter((entry) => {
        if ((entry.errorTypes ?? []).includes(type)) return false;
        // Nhật ký mới chỉ coi một lượt là bằng chứng sạch khi đúng loại lỗi đang
        // luyện. Nhật ký cũ chưa có assessedTypes vẫn giữ cách tính cũ.
        return !hasAssessmentScopes || (entry.assessedTypes ?? []).includes(type);
      }).map((entry) => entry.day),
    );
    // Ngày còn mắc lỗi không được tính là ngày sạch, kể cả khi hôm đó cũng có bài đúng.
    for (const entry of hits) cleanDays.delete(entry.day);

    const lastSeen = hits[hits.length - 1]?.day ?? null;
    const cleanSinceLast = [...cleanDays].filter((day) => !lastSeen || day > lastSeen).length;

    return {
      type,
      label: ERROR_LABELS[type] ?? type,
      occurrenceCount: hits.length,
      lastSeen,
      daysSinceLastSeen: lastSeen ? daysBetween(lastSeen, today) : null,
      cleanDays: cleanSinceLast,
      status: statusOf(hits.length, cleanSinceLast),
    };
  }).filter(Boolean);
}

function daysBetween(from, to) {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : null;
}

/** Ba trạng thái, xét theo số lần mắc và số ngày sạch sau lần mắc gần nhất. */
export function statusOf(occurrenceCount, cleanDays) {
  if (cleanDays >= MASTERY_CLEAN_DAYS) return "mastered";
  if (cleanDays >= 1) return "improving";
  return occurrenceCount >= WEAK_MIN_HITS ? "weak" : "improving";
}

/**
 * Những lỗi đáng luyện nhất, xếp theo mức độ cần chú ý.
 *
 * Lỗi đã sửa được thì bỏ hẳn khỏi danh sách — đưa vào chỉ làm loãng thứ người
 * học cần nhìn. Cùng trạng thái thì lỗi mắc nhiều hơn đứng trước.
 */
export function weakestErrors(entries, limit = 3, now = new Date()) {
  const order = { weak: 0, improving: 1 };
  return errorStats(entries, now)
    .filter((row) => row.status !== "mastered")
    .sort((a, b) => order[a.status] - order[b.status] || b.occurrenceCount - a.occurrenceCount)
    .slice(0, limit);
}
