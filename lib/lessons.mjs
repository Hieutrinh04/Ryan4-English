// Kho bài nghe lấy từ video.
//
// Bài đi vào app qua phần neo của địa chỉ (#lesson=…) do tiện ích mở ra. Dữ liệu
// đến từ địa chỉ nên KHÔNG được tin: phải kiểm từng trường rồi mới lưu. Một bài
// hỏng lọt vào kho sẽ làm hỏng cả màn hình học, và người dùng không biết vì sao.
//
// App chỉ giữ mã video và phần lời. Video không được tải về và không được lưu.

export const lessonsKey = "lexilo:lessons:v1";
export const MAX_LESSONS = 200;
export const MAX_SENTENCES = 2000;

function text(value, limit) {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, limit);
}

function seconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0;
}

/**
 * Kiểm và làm sạch một bài do tiện ích gửi sang.
 * Trả về null nếu thiếu thứ không thể thiếu: mã video hoặc câu nào để học.
 */
export function sanitiseLesson(input) {
  const videoId = text(input?.videoId, 20);
  if (!/^[\w-]{11}$/.test(videoId)) return null;

  const sentences = (Array.isArray(input?.sentences) ? input.sentences : [])
    .slice(0, MAX_SENTENCES)
    .map((item, position) => ({
      index: position + 1,
      start: seconds(item?.start),
      end: seconds(item?.end),
      text: text(item?.text, 400),
    }))
    .filter((item) => item.text);
  if (!sentences.length) return null;

  return {
    id: `yt-${videoId}`,
    videoId,
    title: text(input?.title, 200) || "Video không tên",
    author: text(input?.author, 120),
    seconds: Math.round(seconds(input?.seconds)),
    // Ghi lại nguồn để sau này biết bài nào lấy tự động, bài nào dán tay.
    source: input?.source === "extension" ? "extension" : "paste",
    estimated: Boolean(input?.estimated),
    sentences,
    addedAt: new Date().toISOString(),
  };
}

/** Đọc phần neo địa chỉ do tiện ích mở ra. Hỏng thì trả null, không ném lỗi. */
export function lessonFromHash(hash, decode) {
  const match = String(hash ?? "").match(/[#&]lesson=([^&]+)/);
  if (!match) return null;
  try {
    const json = decode(decodeURIComponent(match[1]));
    return sanitiseLesson(JSON.parse(json));
  } catch {
    return null;
  }
}

export function readLessons() {
  try {
    const raw = localStorage.getItem(lessonsKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.videoId && Array.isArray(item?.sentences)) : [];
  } catch {
    return [];
  }
}

/**
 * Lưu một bài. Cùng video thì THAY bài cũ chứ không thêm bản trùng — người học
 * lấy lại một video thường là vì muốn bản phụ đề tốt hơn.
 */
export function saveLesson(lesson) {
  const clean = sanitiseLesson(lesson);
  if (!clean) return readLessons();
  const rest = readLessons().filter((item) => item.id !== clean.id);
  const next = [clean, ...rest].slice(0, MAX_LESSONS);
  try {
    localStorage.setItem(lessonsKey, JSON.stringify(next));
  } catch {
    // Trình duyệt chặn lưu thì vẫn học được bài này trong phiên hiện tại.
  }
  return next;
}

export function removeLesson(id) {
  const next = readLessons().filter((item) => item.id !== id);
  try {
    localStorage.setItem(lessonsKey, JSON.stringify(next));
  } catch {
    // Bỏ qua.
  }
  return next;
}

/** Câu đang phát ở giây thứ `at`, để làm nổi câu đó trong danh sách. */
export function sentenceAt(sentences, at) {
  const list = sentences ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) if (at >= list[i].start) return list[i];
  return list[0] ?? null;
}

// ── Tiến độ từng câu ────────────────────────────────────────────────────────
// Tách khỏi bản thân bài học: bài có thể được lấy lại (bản phụ đề tốt hơn) mà
// tiến độ vẫn phải còn. Đếm riêng cho từng cách luyện vì chép chính tả xong một
// câu không có nghĩa là đã nói nhại được câu đó.
export const lessonProgressKey = "lexilo:lesson-progress:v1";

export function readLessonProgress() {
  try {
    const raw = localStorage.getItem(lessonProgressKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Đánh dấu một câu đã làm xong. Trả về bảng tiến độ sau khi cập nhật. */
export function markSentence(lessonId, mode, index) {
  const store = readLessonProgress();
  const id = String(lessonId ?? "");
  const which = mode === "shadowing" ? "shadowing" : "dictation";
  const position = Number(index);
  if (!id || !Number.isInteger(position) || position < 1) return store;

  const forLesson = store[id] ?? {};
  const done = new Set(Array.isArray(forLesson[which]) ? forLesson[which] : []);
  done.add(position);
  const next = { ...store, [id]: { ...forLesson, [which]: [...done].sort((a, b) => a - b) } };
  try {
    localStorage.setItem(lessonProgressKey, JSON.stringify(next));
  } catch {
    // Trình duyệt chặn lưu thì vẫn học được, chỉ mất tiến độ.
  }
  return next;
}

/** Những câu đã làm xong của một bài, theo cách luyện. */
export function doneSentences(store, lessonId, mode) {
  const which = mode === "shadowing" ? "shadowing" : "dictation";
  const list = store?.[String(lessonId ?? "")]?.[which];
  return Array.isArray(list) ? list : [];
}

export function clearLessonProgress(lessonId) {
  const store = readLessonProgress();
  delete store[String(lessonId ?? "")];
  try {
    localStorage.setItem(lessonProgressKey, JSON.stringify(store));
  } catch {
    // Bỏ qua.
  }
  return store;
}
