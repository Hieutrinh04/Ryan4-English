import { weekdayIndex, wordState } from "./srs.mjs";
import { studyDayIndex } from "./word-sets.mjs";

export const DAILY_REVIEW_LIMIT = 30;
export const DAILY_NEW_LIMIT = 8;

function prioritySort(a, b) {
  const dateOrder = String(a?.dueDate ?? "0000-00-00").localeCompare(String(b?.dueDate ?? "0000-00-00"));
  return dateOrder || Number(b?.lapses ?? 0) - Number(a?.lapses ?? 0) || String(a?.term ?? "").localeCompare(String(b?.term ?? ""));
}

/**
 * Hàng đợi dùng chung cho Trang chủ, Ôn tập hằng ngày và Luyện từ vựng.
 * Từ đến hạn luôn đứng trước; từ mới chỉ lấy đúng folder của hôm nay.
 */
export function buildDailyQueue(words, reviewLimit = DAILY_REVIEW_LIMIT, newLimit = DAILY_NEW_LIMIT) {
  const list = Array.isArray(words) ? words : [];
  const today = weekdayIndex();
  const reviews = list
    .filter((word) => wordState(word).key === "due")
    .sort(prioritySort)
    .slice(0, reviewLimit);
  const fresh = list
    .filter((word) => wordState(word).key === "new" && studyDayIndex(word) === today)
    .sort(prioritySort)
    .slice(0, newLimit);
  return [...reviews, ...fresh];
}

/** Toàn bộ folder, nhưng vẫn xếp từ đến hạn lên trước và không sửa mảng đầu vào. */
export function buildFullCollectionQueue(words) {
  const rank = (word) => wordState(word).key === "due" ? 0 : wordState(word).key === "new" ? 1 : 2;
  return [...(Array.isArray(words) ? words : [])].sort((a, b) => rank(a) - rank(b) || prioritySort(a, b));
}
