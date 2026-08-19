// Tầng lưu trữ trên máy người dùng.
//
// Trước đây mọi thao tác localStorage nằm rải trong app/page.tsx. Gom về đây là
// bước đầu của repository layer: giao diện chỉ gọi hàm, không cần biết dữ liệu
// nằm ở localStorage hay sau này là Supabase.
//
// Nguyên tắc chung: mọi hàm ghi đều nuốt lỗi. Trình duyệt có thể hết dung lượng
// hoặc chặn localStorage ở chế độ ẩn danh, nhưng việc đó không được phép làm
// gián đoạn phiên học đang diễn ra.

import { localDateString } from "./srs.mjs";
import { isPdfVocabulary, isSeedWord, type ExamGoal, type Rating, type ReviewMode, type UsageDetail, type WordCard } from "./types";
import { appendEntry as appendLogEntry } from "./review-log.mjs";

export const localWordsKey = "lexilo:words:v1";
export const localWordsBackupKey = "lexilo:words:backup:v1";
export const weeklyImportKey = "lexilo:weekly-import:v1";
// Danh sách từ đã xoá. writeLocalWords chỉ gộp thêm chứ không bao giờ bớt (để một lần nạp
// lỗi không thổi bay cả kho), nên nếu không ghi nhận riêng thì từ đã xoá sẽ sống lại sau F5.
export const activeTabKey = "lexilo:tab:v1";
export const deletedIdsKey = "lexilo:deleted:v1";
export function readDeletedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(deletedIdsKey);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}
export function markDeleted(id: string) {
  try {
    const ids = readDeletedIds();
    ids.add(id);
    // Giữ 500 mục gần nhất là thừa đủ, tránh phình vô hạn.
    localStorage.setItem(deletedIdsKey, JSON.stringify([...ids].slice(-500)));
  } catch {
    // Bỏ qua khi trình duyệt chặn.
  }
}
export function readLocalWords(): WordCard[] {
  try {
    const raw = localStorage.getItem(localWordsKey) || localStorage.getItem(localWordsBackupKey);
    const parsed = raw ? (JSON.parse(raw) as WordCard[]) : [];
    if (!Array.isArray(parsed)) return [];
    const deleted = readDeletedIds();
    return parsed.filter((word) => word?.id && word.term && !deleted.has(word.id));
  } catch {
    return [];
  }
}
// Từ đã lên được Supabase sẽ quay về theo đúng id, nên gộp theo id là đủ để không nhân đôi.
// Tiến trình học được đắp lại sau cùng, áp cho cả từ cá nhân lẫn bộ PDF.
// Gợi ý "từ hay đi cùng chủ đề" trước đây lấy thẳng rel_trg của Datamuse nên lẫn
// tên riêng và từ hiếm (rescue → sar, lifeboat, firefighting). Thuật toán đã sửa,
// nhưng mergeEnrichment luôn giữ giá trị cũ nếu ô đã có dữ liệu, nên từ đã lưu
// trên máy phải được dọn một lần thì nút "Bổ sung từ thiếu" mới tra lại được.
// Bộ từ PDF không cần dọn vì luôn dựng lại từ file dữ liệu mỗi lần tải trang.
export const relatedResetKey = "lexilo:related-reset:v2";
// Dịch máy có lúc trả về tiếng Việt ở dạng tổ hợp (o + dấu mũ + dấu huyền rời).
// Trình duyệt dựng ra "sô ̀i", "quô ́c gia" với dấu trôi ra ngoài chữ. Chuẩn hoá NFC
// gộp chúng thành một ký tự. Route đã chuẩn hoá từ nguồn; hàm này vá dữ liệu đã lỡ
// lưu trước đó trên máy người dùng.
export function composeVietnamese(word: WordCard): WordCard {
  const fields = ["meaning", "example", "exampleVi", "definition", "collocation", "collocationVi", "cloze", "topic"] as const;
  let changed = false;
  const fixed = { ...word };
  for (const field of fields) {
    const value = word[field];
    if (typeof value !== "string" || !value) continue;
    const composed = value.normalize("NFC");
    if (composed !== value) {
      fixed[field] = composed;
      changed = true;
    }
  }
  const fixList = (list?: UsageDetail[]) =>
    list?.map((item) => {
      const next = { ...item, term: item.term.normalize("NFC"), meaningVi: item.meaningVi?.normalize("NFC") ?? item.meaningVi, example: item.example?.normalize("NFC") ?? item.example, exampleVi: item.exampleVi?.normalize("NFC") ?? item.exampleVi };
      if (next.term !== item.term || next.meaningVi !== item.meaningVi || next.example !== item.example || next.exampleVi !== item.exampleVi) changed = true;
      return next;
    });
  const details = { synonymDetails: fixList(word.synonymDetails), antonymDetails: fixList(word.antonymDetails), relatedDetails: fixList(word.relatedDetails) };
  return changed ? { ...fixed, ...details } : word;
}

export function clearLegacyRelated(words: WordCard[]) {
  try {
    if (localStorage.getItem(relatedResetKey)) return words;
    localStorage.setItem(relatedResetKey, new Date().toISOString());
  } catch {
    return words;
  }
  return words.map((word) =>
    isPdfVocabulary(word) || !word.related?.length
      ? word
      : { ...word, related: [], relatedDetails: [], enrichmentCheckedAt: undefined },
  );
}

export function mergeStoredWords(loaded: WordCard[]) {
  const deleted = readDeletedIds();
  const kept = loaded.filter((word) => !deleted.has(word.id));
  const ids = new Set(kept.map((word) => word.id));
  return applyProgress(clearLegacyRelated([...readLocalWords().filter((word) => !ids.has(word.id)), ...kept]).map(composeVietnamese));
}
export function writeLocalWords(words: WordCard[]) {
  try {
    const personal = words.filter((word) => !isPdfVocabulary(word) && !isSeedWord(word));
    const current = readLocalWords().filter((word) => !isSeedWord(word));
    // Không cho một lần nạp lỗi/rỗng xóa kho từ đã lưu trước đó.
    const merged = new Map(current.map((word) => [word.id, word]));
    for (const word of personal) merged.set(word.id, word);
    for (const id of readDeletedIds()) merged.delete(id);
    // Chốt chặn cuối: không bao giờ ghi chữ tiếng Việt dạng tổ hợp xuống máy, dù
    // nó đến từ đường nào (tra từ mới, bổ sung hàng loạt, đồng bộ cloud).
    const serialized = JSON.stringify([...merged.values()].map(composeVietnamese));
    localStorage.setItem(localWordsKey, serialized);
    localStorage.setItem(localWordsBackupKey, serialized);
  } catch {
    // Hết dung lượng hoặc trình duyệt chặn — bỏ qua, dữ liệu vẫn còn trong phiên hiện tại.
  }
}

// Tiến trình học (hộp Leitner, lịch ôn, số lần ôn) của MỌI từ, kể cả bộ PDF vốn không lưu nội dung từ.
export type WordProgress = Pick<WordCard, "box" | "lapses" | "dueDate" | "status" | "intervalDays" | "reviewCount" | "lastReviewedAt" | "starred" | "studyDay">;
export const progressKey = "lexilo:progress:v1";
export function readProgress(): Record<string, WordProgress> {
  try {
    const raw = localStorage.getItem(progressKey);
    const parsed = raw ? (JSON.parse(raw) as Record<string, WordProgress>) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
export function hasProgress(word: WordCard) {
  return word.box > 1 || !!word.reviewCount || !!word.lapses || !!word.starred || !!word.dueDate || (!!word.status && word.status !== "new") || typeof word.studyDay === "number";
}
export function writeProgress(words: WordCard[]) {
  try {
    // Chỉ ghi từ đã học để file không phình theo cả 983 từ chưa đụng tới.
    const store: Record<string, WordProgress> = {};
    for (const word of words) {
      if (!hasProgress(word)) continue;
      store[word.id] = { box: word.box, lapses: word.lapses, dueDate: word.dueDate, status: word.status, intervalDays: word.intervalDays, reviewCount: word.reviewCount, lastReviewedAt: word.lastReviewedAt, starred: word.starred, studyDay: word.studyDay };
    }
    localStorage.setItem(progressKey, JSON.stringify(store));
  } catch {
    // Bỏ qua như trên.
  }
}
export function applyProgress(words: WordCard[]) {
  const store = readProgress();
  return words.map((word) => {
    const saved = store[word.id];
    if (!saved) return word;
    const merged = { ...word, ...saved };
    // Với bộ Excel theo tuần, tên file là nguồn xác định folder; tiến độ cũ chỉ giữ
    // Leitner/trạng thái và không được chuyển từ sang một ngày khác.
    return word.source?.endsWith(".xlsx") ? { ...merged, studyDay: word.studyDay } : merged;
  });
}

// Ngày thi mục tiêu, để đếm ngược trên trang chủ.
export const examKey = "lexilo:exam:v1";
export function readExam(): ExamGoal | null {
  try {
    const raw = localStorage.getItem(examKey);
    const parsed = raw ? (JSON.parse(raw) as ExamGoal) : null;
    return parsed?.date ? parsed : null;
  } catch {
    return null;
  }
}
export function writeExam(goal: ExamGoal | null) {
  try {
    if (goal) localStorage.setItem(examKey, JSON.stringify(goal));
    else localStorage.removeItem(examKey);
  } catch {
    // Bỏ qua khi trình duyệt chặn.
  }
}


// Chuỗi ngày học: lưu danh sách ngày có ít nhất một thẻ được chấm.
export const streakKey = "lexilo:streak:v1";
// Nhật ký ôn tập theo thời gian. Thẻ từ chỉ giữ tổng số lượt và tổng số lần quên,
// không có ngày tháng, nên không trả lời được "tuần này học được bao nhiêu từ mới".
export const reviewLogKey = "lexilo:reviews:v1";
export type ReviewEntry = { at: string; id: string; term: string; rating: Rating; boxBefore: number; boxAfter: number; firstTime: boolean };
export function readReviewLog(): ReviewEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(reviewLogKey) || "[]") as ReviewEntry[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.at === "string") : [];
  } catch {
    return [];
  }
}
export function logReview(entry: ReviewEntry) {
  try {
    localStorage.setItem(reviewLogKey, JSON.stringify(appendLogEntry(readReviewLog(), entry)));
  } catch {
    // Hết dung lượng thì bỏ qua — không được để việc ghi nhật ký chặn phiên học.
  }
}
export function readStudyDays(): string[] {
  try {
    const raw = localStorage.getItem(streakKey);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(parsed) ? [...new Set(parsed.filter((item) => typeof item === "string"))].sort() : [];
  } catch {
    return [];
  }
}
export function markStudiedToday(): string[] {
  const days = readStudyDays();
  const today = localDateString();
  if (days.includes(today)) return days;
  // Giữ hai năm gần nhất là đủ cho mọi thống kê hiện có.
  const next = [...days, today].slice(-730);
  try {
    localStorage.setItem(streakKey, JSON.stringify(next));
  } catch {
    // Bỏ qua khi trình duyệt chặn.
  }
  return next;
}


// Phiên ôn đang dở, để đóng tab rồi quay lại vẫn học tiếp đúng chỗ.
export type StoredSession = { ids: string[]; index: number; mode: ReviewMode };
export const sessionKey = "lexilo:session:v1";
export function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(sessionKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return Array.isArray(parsed?.ids) && parsed.ids.length && typeof parsed.index === "number" ? parsed : null;
  } catch {
    return null;
  }
}
export function writeSession(session: StoredSession | null) {
  try {
    if (session) localStorage.setItem(sessionKey, JSON.stringify(session));
    else localStorage.removeItem(sessionKey);
  } catch {
    // Bỏ qua như trên.
  }
}

