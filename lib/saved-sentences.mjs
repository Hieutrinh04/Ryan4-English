// Câu người học tự đánh dấu để quay lại luyện.
//
// Lưu cả phần chữ chứ không chỉ lưu số câu: bài học có thể bị xoá khỏi máy, mà
// câu hay thì vẫn nên đọc lại được. Đổi lại phải chặn số lượng, nếu không một
// người dùng lâu năm sẽ nhét vài nghìn câu vào localStorage.

import { scopedStorageKey } from "./account-storage.mjs";

export const savedKey = "lexilo:saved-sentences:v1";

const MAX_SAVED = 300;

function text(value, limit) {
  return String(value ?? "").normalize("NFC").trim().slice(0, limit);
}

/** Khoá nhận dạng một câu: cùng bài và cùng vị trí thì là một câu. */
export function sentenceKey(lessonId, index) {
  return `${text(lessonId, 80)}#${Number(index) || 0}`;
}

export function makeSaved(input) {
  const index = Number(input?.index);
  return {
    key: sentenceKey(input?.lessonId, index),
    lessonId: text(input?.lessonId, 80),
    lessonTitle: text(input?.lessonTitle, 200),
    index: Number.isInteger(index) && index > 0 ? index : 0,
    start: Number.isFinite(Number(input?.start)) ? Math.max(0, Number(input.start)) : 0,
    text: text(input?.text, 400),
    translation: text(input?.translation, 400),
    at: new Date().toISOString(),
  };
}

export function readSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(scopedStorageKey(savedKey)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((item) => item && item.text) : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(scopedStorageKey(savedKey), JSON.stringify(list));
  } catch {
    // Hết chỗ lưu thì bỏ qua, phần đang hiện trên màn hình vẫn đúng.
  }
  return list;
}

/** Lưu một câu. Lưu lại câu đã có thì đẩy nó lên đầu chứ không tạo bản trùng. */
export function saveSentence(entry) {
  if (!entry?.text) return readSaved();
  const rest = readSaved().filter((item) => item.key !== entry.key);
  return write([entry, ...rest].slice(0, MAX_SAVED));
}

export function removeSentence(key) {
  return write(readSaved().filter((item) => item.key !== key));
}

/** Bấm lần nữa thì bỏ lưu — cùng một nút, hai chiều. */
export function toggleSentence(entry) {
  if (!entry?.text) return readSaved();
  const list = readSaved();
  return list.some((item) => item.key === entry.key) ? removeSentence(entry.key) : saveSentence(entry);
}

export function isSaved(list, lessonId, index) {
  const key = sentenceKey(lessonId, index);
  return (Array.isArray(list) ? list : []).some((item) => item?.key === key);
}

/** Nhóm theo bài để màn danh sách hiện được "bài nào, mấy câu". */
export function groupByLesson(list) {
  const groups = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    if (!item?.text) continue;
    const id = item.lessonId || "";
    if (!groups.has(id)) groups.set(id, { lessonId: id, title: item.lessonTitle || "Bài không tên", items: [] });
    groups.get(id).items.push(item);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    items: [...group.items].sort((a, b) => (a.index || 0) - (b.index || 0)),
  }));
}
