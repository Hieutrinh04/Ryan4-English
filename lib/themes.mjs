// Bộ giao diện: bốn tông màu × hai độ sáng.
//
// Toàn bộ màu nền, viền và màu nhấn đều dựng từ MỘT góc màu (hue) duy nhất, nên
// thêm một tông mới chỉ là thêm một con số — không phải chép lại cả bảng màu.
// Màu ý nghĩa (xanh lá = đúng, hồng = sai, cam = cần chú ý) cố tình KHÔNG đổi
// theo tông: chúng mang nghĩa, không phải màu thương hiệu.

export const themeKey = "lexilo:theme";

/**
 * hue: góc màu trên vòng màu, dùng cho mọi biến màu phụ thuộc tông.
 * mode: quyết định bảng sáng hay tối.
 */
export const THEMES = [
  { id: "sang", label: "Sáng", mode: "light", hue: 250 },
  { id: "toi", label: "Tối", mode: "dark", hue: 250 },
  { id: "tim-sang", label: "Tím Sáng", mode: "light", hue: 285 },
  { id: "tim-toi", label: "Tím Tối", mode: "dark", hue: 285 },
  { id: "hong-sang", label: "Hồng Sáng", mode: "light", hue: 335 },
  { id: "hong-toi", label: "Hồng Tối", mode: "dark", hue: 335 },
  { id: "xanh-sang", label: "Xanh Sáng", mode: "light", hue: 205 },
  { id: "xanh-toi", label: "Xanh Tối", mode: "dark", hue: 205 },
];

export const DEFAULT_THEME = "toi";

// Lấy thẳng theo chỉ số chứ không tìm lại: hàm này phải LUÔN trả về một giao diện,
// tìm bằng find thì kiểu trả về vẫn có thể là undefined và mọi nơi gọi phải kiểm tra.
const FALLBACK = THEMES[1];

export function themeById(id) {
  return THEMES.find((theme) => theme.id === id) ?? FALLBACK;
}

/**
 * Đọc lựa chọn đã lưu.
 *
 * Bản cũ chỉ lưu "light" hoặc "dark"; quy về "sang" và "toi" để người đang dùng
 * không bị nhảy về giao diện mặc định sau khi cập nhật.
 */
export function normaliseTheme(stored) {
  const value = String(stored ?? "").trim();
  if (value === "light") return "sang";
  if (value === "dark") return "toi";
  return THEMES.some((theme) => theme.id === value) ? value : DEFAULT_THEME;
}

export function readTheme() {
  try {
    return normaliseTheme(localStorage.getItem(themeKey));
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeTheme(id) {
  const theme = themeById(id);
  try {
    localStorage.setItem(themeKey, theme.id);
  } catch {
    // Trình duyệt chặn lưu thì vẫn đổi được cho phiên này.
  }
  return theme;
}

/** Gắn tông màu và độ sáng lên thẻ <html>. CSS đọc hai thuộc tính này. */
export function applyTheme(id, root) {
  const theme = themeById(id);
  const element = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!element) return theme;
  element.dataset.theme = theme.mode;
  element.dataset.hue = String(theme.hue);
  return theme;
}

/** Gom theo tông màu để menu xếp thành từng cặp Sáng / Tối. */
export function themeGroups() {
  const order = [];
  for (const theme of THEMES) if (!order.includes(theme.hue)) order.push(theme.hue);
  return order.map((hue) => THEMES.filter((theme) => theme.hue === hue));
}
