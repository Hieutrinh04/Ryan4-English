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

/**
 * Tiến độ của một video: đã xong bao nhiêu câu trên tổng số.
 * Chưa lấy được phụ đề thì chưa có gì để đếm.
 */
export function videoProgress(lesson, progress, mode = "shadowing") {
  if (!lesson) return { done: 0, total: 0, percent: 0 };
  const total = Array.isArray(lesson.sentences) ? lesson.sentences.length : 0;
  const list = progress?.[lesson.id]?.[mode === "dictation" ? "dictation" : "shadowing"];
  const done = Math.min(Array.isArray(list) ? list.length : 0, total);
  // Làm tròn xuống: 99% không được hiện thành 100% khi vẫn còn câu chưa làm.
  return { done, total, percent: total ? Math.floor((done / total) * 100) : 0 };
}

/**
 * Chia danh mục thành các kệ theo TRẠNG THÁI HỌC, không theo kênh.
 *
 * Xếp theo kênh thì người học mở lên phải tự nhớ hôm qua đang dở bài nào. Xếp
 * theo trạng thái thì việc cần làm tiếp nằm ngay hàng đầu.
 *
 * Video chưa lấy được phụ đề để riêng một kệ chứ không trộn vào "bài mới": bấm
 * vào nó không học được, mà mở YouTube — gộp chung là hứa sai.
 */
export function shelves(videos, lessons, progress, mode = "shadowing") {
  const byId = new Map((Array.isArray(lessons) ? lessons : []).map((item) => [item.videoId, item]));
  const doing = [];
  const fresh = [];
  const finished = [];
  const noCaption = [];

  for (const video of Array.isArray(videos) ? videos : []) {
    if (!video?.videoId) continue;
    const lesson = byId.get(video.videoId);
    if (!lesson) {
      noCaption.push({ ...video, lesson: null, ...videoProgress(null) });
      continue;
    }
    const state = videoProgress(lesson, progress, mode);
    const entry = { ...video, lesson, ...state };
    if (!state.total || !state.done) fresh.push(entry);
    else if (state.done >= state.total) finished.push(entry);
    else doing.push(entry);
  }

  // Đang dở thì bài gần xong nhất lên trước: sắp xong rồi thì làm nốt cho gọn.
  doing.sort((a, b) => b.percent - a.percent);
  return { doing, fresh, finished, noCaption };
}
