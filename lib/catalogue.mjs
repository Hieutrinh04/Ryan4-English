import { catalogueEntry, groupByChannel } from "./youtube-list.mjs";

// Danh mục video của thư viện: những video bạn đã chọn đưa vào để luyện.
//
// Chỉ lưu MÃ video và phần thông tin hiển thị. Không lưu video, không lưu phụ đề
// — phụ đề lấy lúc mở bài. Nhờ vậy danh mục rất nhẹ dù có hàng trăm video.

export const catalogueKey = "lexilo:catalogue:v1";
const MAX_VIDEOS = 500;

export function readCatalogue() {
  try {
    const raw = JSON.parse(localStorage.getItem(catalogueKey) ?? "[]");
    return Array.isArray(raw) ? raw.filter((item) => item?.videoId && item?.title) : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(catalogueKey, JSON.stringify(list));
  } catch {
    // Hết chỗ lưu thì thôi; phần đang hiện trên màn hình vẫn đúng.
  }
  return list;
}

/**
 * Thêm một loạt video vào danh mục.
 * Video đã có thì GIỮ bản cũ chứ không đẩy lên đầu — thêm lại cả một playlist
 * mà xáo hết thứ tự thì người học mất dấu chỗ mình đang học dở.
 */
export function addToCatalogue(videos) {
  const current = readCatalogue();
  const seen = new Set(current.map((item) => item.videoId));
  const fresh = [];
  for (const video of Array.isArray(videos) ? videos : []) {
    const entry = video?.thumbnail ? video : catalogueEntry(video);
    if (!entry || seen.has(entry.videoId)) continue;
    seen.add(entry.videoId);
    fresh.push(entry);
  }
  return write([...current, ...fresh].slice(0, MAX_VIDEOS));
}

export function removeFromCatalogue(videoId) {
  return write(readCatalogue().filter((item) => item.videoId !== videoId));
}

/** Bao nhiêu video mới sẽ được thêm — để nói trước con số cho người dùng. */
export function countNew(videos, current) {
  const seen = new Set((Array.isArray(current) ? current : []).map((item) => item.videoId));
  let count = 0;
  for (const video of Array.isArray(videos) ? videos : []) {
    if (video?.videoId && !seen.has(video.videoId)) {
      seen.add(video.videoId);
      count += 1;
    }
  }
  return count;
}

/**
 * Ghép danh mục với các bài đã có phụ đề.
 * Video nào đã lấy được phụ đề thì mở học ngay; chưa thì phải lấy phụ đề trước.
 */
export function withLessonState(entries, lessons) {
  const ready = new Set((Array.isArray(lessons) ? lessons : []).map((item) => item.videoId));
  return (Array.isArray(entries) ? entries : []).map((entry) => ({ ...entry, ready: ready.has(entry.videoId) }));
}

export { groupByChannel };
