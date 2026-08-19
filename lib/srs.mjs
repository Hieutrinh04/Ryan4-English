// Lịch ôn Leitner và các phép tính ngày tháng đi kèm.
//
// Đây là NGUỒN DUY NHẤT của thuật toán. Trước đây lib/srs.ts có một bản
// computeNext() không được import ở đâu cả, còn thuật toán thật thì nằm trong
// app/page.tsx — hai bản không khớp nhau (bản trong lib trả về status, bản trong
// page trả về interval), và bài kiểm thử phải trích hàm ra khỏi mã nguồn bằng
// biểu thức chính quy để chạy. Giờ giao diện gọi module này, kiểm thử import
// thẳng, không còn chỗ nào lệch nhau được.

/** Số ngày chờ ứng với từng hộp. Hộp 0 không dùng, để chỉ số khớp số hộp. */
export const BOX_INTERVALS = [0, 1, 3, 7, 14, 30, 90];
export const MAX_BOX = 6;

/**
 * Hộp mới và số ngày chờ sau một lần đánh giá.
 * @param {{ box: number; intervalDays?: number }} card
 * @param {"again"|"hard"|"good"|"easy"} rating
 * @returns {{ box: number; interval: number }}
 */
export function scheduleFor(card, rating) {
  const box =
    rating === "again"
      ? card.box === MAX_BOX
        ? 2
        : 1
      : Math.min(MAX_BOX, card.box + (rating === "easy" ? 2 : rating === "good" ? 1 : 0));
  const base = BOX_INTERVALS[box];
  // Quên thì luôn gặp lại sau đúng 1 ngày. Nếu lấy số ngày theo hộp mới thì một từ
  // đã thuộc (hộp 6) tụt về hộp 2 sẽ được hẹn tận 3 ngày dù vừa quên xong.
  const interval =
    rating === "again"
      ? 1
      : rating === "hard"
        ? Math.max(1, Math.round((card.intervalDays ?? 1) * 0.6))
        : Math.round(base * (rating === "easy" ? 1.3 : 1));
  return { box, interval };
}

/**
 * Ngày theo lịch của máy người dùng. toISOString() trả ngày UTC, ở GMT+7 sẽ lùi
 * một ngày trong khoảng 00:00–07:00 sáng, khiến từ bị xếp nhầm sang hôm trước.
 */
export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 0 = Thứ Hai … 6 = Chủ Nhật, khớp thứ tự mảng dayNames trong giao diện. */
export function weekdayIndex(date = new Date()) {
  return (date.getDay() + 6) % 7;
}

/** Số ngày từ hôm nay tới ngày đã cho; âm nghĩa là đã quá hạn. */
export function daysUntil(date) {
  const target = new Date(`${date}T00:00:00`);
  const today = new Date(`${localDateString()}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/** Dời một ngày (dạng YYYY-MM-DD) đi mấy ngày, trả về cùng định dạng. */
function shiftDay(date, step) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + step);
  return localDateString(value);
}

/**
 * Chuỗi ngày học liên tiếp.
 * @param {string[]} days danh sách ngày đã học, dạng YYYY-MM-DD
 * @returns {{ current: number; best: number; studiedToday: boolean }}
 */
export function streakFrom(days) {
  if (!days.length) return { current: 0, best: 0, studiedToday: false };
  const set = new Set(days);
  const today = localDateString();
  const studiedToday = set.has(today);
  // Chuỗi vẫn được tính là đang chạy nếu hôm nay chưa học nhưng hôm qua có —
  // ngày hôm nay chưa kết thúc, chưa thể coi là đứt.
  let cursor = studiedToday ? today : shiftDay(today, -1);
  let current = 0;
  while (set.has(cursor)) {
    current += 1;
    cursor = shiftDay(cursor, -1);
  }
  let best = 0;
  let run = 0;
  let previous = "";
  for (const day of [...days].sort()) {
    run = previous && shiftDay(previous, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
  }
  return { current, best: Math.max(best, current), studiedToday };
}

/**
 * Trạng thái học của một từ, dùng chung cho nhãn hiển thị lẫn việc dựng hàng đợi.
 * @param {{ box: number; status?: string; reviewCount?: number; dueDate?: string }} word
 */
export function wordState(word) {
  if (word.box >= MAX_BOX || word.status === "mastered") return { key: "mastered", label: "✅ Đã thuộc" };
  if (!word.reviewCount && word.status === "new") return { key: "new", label: "🆕 Chưa học" };
  if (!word.dueDate || word.dueDate <= localDateString()) return { key: "due", label: "🔴 Cần ôn" };
  return { key: "waiting", label: "⏳ Chưa tới hạn" };
}

/** Từ cần đưa vào phiên hôm nay: đã tới hạn, hoặc chưa học lần nào. */
export function isDueForReview(word) {
  const key = wordState(word).key;
  return key === "due" || key === "new";
}
