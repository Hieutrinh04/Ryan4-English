// Điểm kinh nghiệm và cấp độ.
//
// Nguyên tắc: XP phải quy ra được từ việc ĐÃ LÀM THẬT và đã ghi lại ở đâu đó
// (nhật ký ôn thẻ, nhật ký bài dịch, bộ đếm thời gian luyện). Không có điểm
// thưởng đăng nhập, không có điểm "vì đã mở app" — điểm kiểu đó làm con số tăng
// nhưng không nói lên bạn giỏi lên hay chưa, và người học sẽ sớm nhận ra.
//
// Vì XP được TÍNH LẠI từ nhật ký chứ không cộng dồn vào một ô riêng, nó luôn
// khớp với dữ liệu thật và không bao giờ lệch.

/** Mỗi việc đáng bao nhiêu XP, và vì sao. */
export const XP_RULES = [
  { key: "reviews", xp: 1, label: "mỗi lượt ôn thẻ" },
  { key: "learned", xp: 3, label: "mỗi từ mới học lần đầu" },
  { key: "mastered", xp: 10, label: "mỗi từ lên hộp 6" },
  { key: "attempts", xp: 5, label: "mỗi bài dịch đã chấm" },
  { key: "minutes", xp: 2, label: "mỗi phút luyện nghe, nói, viết" },
];

const XP_BY_KEY = Object.fromEntries(XP_RULES.map((rule) => [rule.key, rule.xp]));

/**
 * Tổng XP từ số liệu thật.
 * @param {{ reviews?: number; learned?: number; mastered?: number; attempts?: number; minutes?: number }} counts
 */
export function xpFrom(counts) {
  return XP_RULES.reduce((total, rule) => {
    const value = Number(counts?.[rule.key]) || 0;
    return total + Math.max(0, Math.floor(value)) * rule.xp;
  }, 0);
}

/** Chi tiết từng khoản XP, để người học bấm vào xem điểm ở đâu ra. */
export function xpBreakdown(counts) {
  return XP_RULES.map((rule) => {
    const count = Math.max(0, Math.floor(Number(counts?.[rule.key]) || 0));
    return { ...rule, count, xp: count * XP_BY_KEY[rule.key] };
  }).filter((row) => row.count > 0);
}

/**
 * Mốc XP của từng cấp. Khoảng cách giãn dần để cấp đầu đạt nhanh (thấy tiến bộ
 * ngay trong buổi đầu) còn cấp sau thì đáng giá.
 */
export const LEVELS = [
  { level: 1, from: 0, name: "Mới bắt đầu" },
  { level: 2, from: 100, name: "Chăm chỉ" },
  { level: 3, from: 300, name: "Đều đặn" },
  { level: 4, from: 700, name: "Vững vàng" },
  { level: 5, from: 1500, name: "Thành thạo" },
  { level: 6, from: 3000, name: "Kỳ cựu" },
  { level: 7, from: 6000, name: "Lão luyện" },
  { level: 8, from: 12000, name: "Bậc thầy" },
];

/**
 * Cấp hiện tại và tiến trình tới cấp kế tiếp.
 * @returns {{ level: number; name: string; xp: number; into: number; need: number; percent: number; next: number|null }}
 */
export function levelFor(xp) {
  const total = Math.max(0, Math.floor(Number(xp) || 0));
  let current = LEVELS[0];
  for (const step of LEVELS) if (total >= step.from) current = step;
  const next = LEVELS.find((step) => step.from > current.from) ?? null;
  // Cấp cuối thì thanh tiến trình đầy, không hiện mốc không tồn tại.
  if (!next) return { level: current.level, name: current.name, xp: total, into: 0, need: 0, percent: 100, next: null };
  const into = total - current.from;
  const need = next.from - current.from;
  return { level: current.level, name: current.name, xp: total, into, need, percent: Math.round((into / need) * 100), next: next.from };
}
