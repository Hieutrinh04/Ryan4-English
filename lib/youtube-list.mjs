// Đọc một playlist hoặc một kênh YouTube thành danh mục video để luyện.
//
// Vẫn KHÔNG tải video. Chỉ lấy phần thông tin mà YouTube cho phép lấy qua API
// chính thức — tiêu đề, tên kênh, thời lượng, ảnh bìa — rồi lúc học thì nhúng
// trình phát của họ. Video luôn phát từ máy chủ YouTube.
//
// Phần thuần tính toán để ở đây để kiểm thử được mà không cần gọi mạng.

/** Mã playlist từ mọi dạng link thường gặp, hoặc chính mã dán thẳng vào. */
export function playlistIdFrom(input) {
  const text = String(input ?? "").trim();
  if (!text) return "";
  // Mã playlist bắt đầu bằng PL, UU, LL, FL, RD… và dài hơn 12 ký tự.
  if (/^(PL|UU|LL|FL|OL|RD)[\w-]{10,}$/.test(text)) return text;
  try {
    const url = new URL(text.startsWith("http") ? text : `https://${text}`);
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(url.hostname.replace(/^www\.|^m\./, ""))) return "";
    const list = url.searchParams.get("list");
    return list && /^[\w-]{12,}$/.test(list) ? list : "";
  } catch {
    return "";
  }
}

/**
 * Kênh: trả về { handle } hoặc { channelId }.
 *
 * Hai dạng phải tách riêng vì API gọi khác nhau — forHandle với @tên, id với
 * mã UC…. Đoán nhầm thì API trả rỗng mà không báo lỗi gì, rất khó lần ra.
 */
export function channelRefFrom(input) {
  const text = String(input ?? "").trim();
  if (!text) return null;
  if (/^UC[\w-]{20,}$/.test(text)) return { channelId: text };
  if (/^@[\w.-]{2,}$/.test(text)) return { handle: text };
  try {
    const url = new URL(text.startsWith("http") ? text : `https://${text}`);
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(url.hostname.replace(/^www\.|^m\./, ""))) return null;
    const path = url.pathname.replace(/\/$/, "");
    const handle = path.match(/^\/(@[\w.-]{2,})/);
    if (handle) return { handle: handle[1] };
    const byId = path.match(/^\/channel\/(UC[\w-]{20,})/);
    if (byId) return { channelId: byId[1] };
    return null;
  } catch {
    return null;
  }
}

/** Playlist "uploads" của một kênh: đổi UC… thành UU… — đây là quy ước của YouTube. */
export function uploadsPlaylistId(channelId) {
  const id = String(channelId ?? "").trim();
  return /^UC[\w-]{20,}$/.test(id) ? `UU${id.slice(2)}` : "";
}

/** Một thẻ video trong danh mục. Chỉ giữ đúng thứ cần để hiện và để mở bài. */
export function catalogueEntry(input) {
  const videoId = String(input?.videoId ?? "").trim();
  if (!/^[\w-]{11}$/.test(videoId)) return null;
  const title = String(input?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title || title === "Private video" || title === "Deleted video") return null;
  return {
    videoId,
    title,
    channel: String(input?.channel ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
    seconds: Math.max(0, Math.round(Number(input?.seconds) || 0)),
    // Ảnh bìa lấy thẳng từ YouTube theo mã video, không tải về lưu.
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    addedAt: new Date().toISOString(),
  };
}

/** Bỏ video quá ngắn hoặc quá dài: ngắn quá không đủ câu, dài quá thì nản. */
/**
 * Video dạng Shorts — clip dọc rất ngắn, không dùng để luyện nói nhại được.
 *
 * YouTube không có trường nào đánh dấu Shorts trong phần dữ liệu cơ bản, nên
 * nhận theo hai dấu hiệu cùng lúc:
 *   - Thẻ #short/#shorts trong tiêu đề, kiểu đặt tên gần như bắt buộc của dạng này.
 *   - Thời lượng từ 60 giây trở xuống. Đây là mức Shorts cổ điển; YouTube sau
 *     này cho tới 3 phút, nhưng cắt ở 3 phút sẽ giết luôn nhiều bài học thật
 *     dài 2–3 phút, nên chấp nhận sót vài cái hơn là chặn nhầm.
 */
export function looksLikeShort(entry) {
  const title = String(entry?.title ?? "");
  if (/#shorts?\b/i.test(title)) return true;
  const seconds = Number(entry?.seconds) || 0;
  return seconds > 0 && seconds <= 60;
}

/**
 * Trần thời lượng: 13 phút.
 *
 * Một bài 13 phút đã là khoảng 100 phân đoạn để nhại — quá đủ cho một buổi. Dài
 * hơn nữa thì gần như chắc chắn bỏ dở giữa chừng, mà bài bỏ dở nằm mãi trong kệ
 * "Tiếp tục học" lại làm nản thêm.
 */
export const MAX_PRACTICE_SECONDS = 13 * 60;

/**
 * Video dùng được để luyện.
 * Bỏ Shorts, bỏ clip quá ngắn không đủ câu, và bỏ video quá dài dễ làm bỏ dở.
 */
export function usableForPractice(entry, { minSeconds = 60, maxSeconds = MAX_PRACTICE_SECONDS } = {}) {
  if (looksLikeShort(entry)) return false;
  const seconds = Number(entry?.seconds) || 0;
  // Thời lượng 0 nghĩa là chưa đọc được (video đang phát trực tiếp) — vẫn giữ lại.
  return seconds === 0 || (seconds > minSeconds && seconds <= maxSeconds);
}

/** Gom danh mục theo kênh để hiện thành từng khối như thư viện mẫu. */
export function groupByChannel(entries) {
  const groups = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry?.videoId) continue;
    const key = entry.channel || "Khác";
    if (!groups.has(key)) groups.set(key, { channel: key, videos: [] });
    groups.get(key).videos.push(entry);
  }
  return [...groups.values()].sort((a, b) => b.videos.length - a.videos.length);
}

/** Thời lượng gọn để hiện trên thẻ: "6 phút", "1 giờ 12 phút". */
export function readableLength(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return "";
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours && minutes) return `${hours} giờ ${minutes} phút`;
  if (hours) return `${hours} giờ`;
  return `${Math.max(1, minutes)} phút`;
}
