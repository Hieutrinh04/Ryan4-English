// Nhật ký bài dịch: mỗi lần chấm ghi lại một lượt, kèm những nhãn lỗi mắc phải.
//
// Vì sao cần: hiện app chấm xong là quên. Người học biết câu vừa rồi sai gì nhưng
// không biết mình LẶP LẠI lỗi gì. "Tháng này bạn sai mạo từ 23 lần, nhiều gấp ba
// mọi lỗi khác" là thứ đổi được cách học; "câu này thiếu the" thì không.
//
// Ghi vào localStorage trước, đồng bộ lên Supabase sau khi đăng nhập (lib/cloud-sync.ts).
// Làm ngược lại thì người chưa đăng nhập — tức toàn bộ người dùng hôm nay — chẳng
// nhận được gì.

import { ERROR_LABELS, ERROR_TYPES, normaliseErrorType } from "./error-taxonomy.mjs";
import { localDay } from "./review-log.mjs";

export const attemptsKey = "lexilo:translation-log:v1";
// Một lượt dịch nặng hơn một lượt ôn thẻ nhiều lần nên giữ ít hơn.
export const MAX_ATTEMPTS = 4000;

/**
 * Đổi nhận xét của cách so câu mẫu sang nhãn lỗi chuẩn.
 *
 * "diff" cố tình bị bỏ: nó chỉ có nghĩa là bạn diễn đạt khác câu mẫu, mà khác câu
 * mẫu KHÔNG phải là sai. Đếm nó vào là dạy người học sợ viết khác đi.
 */
const NOTE_KIND_TO_TYPE = {
  form: "verb_form",
  article: "article",
  preposition: "preposition",
  target: "vocabulary",
};

export function typesFromNotes(notes) {
  return [...new Set((notes ?? []).map((note) => NOTE_KIND_TO_TYPE[note?.kind]).filter(Boolean))];
}

/** Nhãn lỗi từ kết quả chấm của mô hình ngôn ngữ. */
export function typesFromIssues(issues) {
  return [...new Set((issues ?? []).map((issue) => normaliseErrorType(issue?.type)))];
}

/** Dựng một dòng nhật ký. Tách khỏi phần ghi đĩa để test được. */
export function makeAttempt({ term, vietnamese, answer, reference, score, correct, gradedBy, errorTypes }, now = new Date()) {
  return {
    at: now.toISOString(),
    day: localDay(now),
    term: String(term ?? "").trim(),
    vi: String(vietnamese ?? "").trim(),
    answer: String(answer ?? "").trim(),
    reference: String(reference ?? "").trim(),
    score: Math.max(0, Math.min(100, Math.round(Number(score) || 0))),
    correct: Boolean(correct),
    // "llm" là mô hình chấm, "reference" là so với câu mẫu. Hai cách này khác nhau
    // về độ tin cậy nên phải phân biệt được khi đọc lại số liệu.
    gradedBy: gradedBy === "llm" ? "llm" : "reference",
    errorTypes: [...new Set((errorTypes ?? []).map(normaliseErrorType))],
  };
}

export function readAttempts() {
  try {
    const raw = localStorage.getItem(attemptsKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.day === "string") : [];
  } catch {
    return [];
  }
}

export function logAttempt(attempt) {
  const entries = [...readAttempts(), attempt].slice(-MAX_ATTEMPTS);
  try {
    localStorage.setItem(attemptsKey, JSON.stringify(entries));
  } catch {
    // Bỏ qua khi trình duyệt chặn; bài học vẫn phải chạy.
  }
  return entries;
}

export function attemptsSince(entries, days, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const from = localDay(cutoff);
  return (entries ?? []).filter((entry) => entry.day >= from);
}

/** Tổng hợp một quãng: bao nhiêu lượt, đúng bao nhiêu, hay sai nhãn nào nhất. */
export function summariseAttempts(entries) {
  const list = entries ?? [];
  const counts = new Map();
  for (const entry of list)
    for (const type of entry.errorTypes ?? []) counts.set(type, (counts.get(type) ?? 0) + 1);

  const totalErrors = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const byType = [...counts.entries()]
    .map(([type, count]) => ({ type, label: ERROR_LABELS[type] ?? type, count, share: Math.round((count / Math.max(1, totalErrors)) * 100) }))
    // Xếp theo số lần, cùng số lần thì theo thứ tự nhãn để kết quả ổn định.
    .sort((a, b) => b.count - a.count || ERROR_TYPES.indexOf(a.type) - ERROR_TYPES.indexOf(b.type));

  const scored = list.filter((entry) => entry.score > 0 || entry.correct);
  return {
    attempts: list.length,
    correct: list.filter((entry) => entry.correct).length,
    correctRate: list.length ? Math.round((list.filter((entry) => entry.correct).length / list.length) * 100) : 0,
    avgScore: scored.length ? Math.round(scored.reduce((sum, entry) => sum + entry.score, 0) / scored.length) : 0,
    cleanRuns: list.filter((entry) => !(entry.errorTypes ?? []).length).length,
    totalErrors,
    byType,
    days: new Set(list.map((entry) => entry.day)).size,
  };
}

/**
 * Một nhãn lỗi đang đỡ dần hay nặng thêm: so nửa đầu quãng với nửa sau.
 * Trả về null khi chưa đủ dữ liệu để nói điều gì chắc chắn.
 */
export function trendOf(entries, type) {
  const list = [...(entries ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  if (list.length < 8) return null;
  const middle = Math.floor(list.length / 2);
  const rate = (part) => part.filter((entry) => (entry.errorTypes ?? []).includes(type)).length / Math.max(1, part.length);
  const before = rate(list.slice(0, middle));
  const after = rate(list.slice(middle));
  const change = Math.round((after - before) * 100);
  if (Math.abs(change) < 10) return { type, change, direction: "flat" };
  return { type, change, direction: change < 0 ? "better" : "worse" };
}

/** Lời khuyên bằng tiếng Việt, chỉ nói những gì số liệu đủ sức khẳng định. */
export function attemptAdvice(summary, entries) {
  if (summary.attempts < 5)
    return [{ kind: "info", text: `Mới có ${summary.attempts} bài dịch trong quãng này. Làm thêm vài bài nữa rồi quay lại — dưới 5 bài thì chưa nói được bạn hay sai gì.` }];

  const notes = [];
  const top = summary.byType[0];
  if (top && top.count >= 3) {
    const trend = trendOf(entries, top.type);
    const direction =
      trend?.direction === "better" ? " Tin tốt: nửa sau quãng này bạn mắc ít hơn hẳn nửa đầu."
      : trend?.direction === "worse" ? " Và lỗi này đang nặng thêm chứ chưa đỡ."
      : "";
    notes.push({
      kind: "focus",
      text: `Lỗi bạn mắc nhiều nhất là ${top.label.toLowerCase()}: ${top.count} lần, chiếm ${top.share}% tổng số lỗi.${direction}`,
    });
  }

  const second = summary.byType[1];
  if (second && second.count >= 3) notes.push({ kind: "focus", text: `Kế đó là ${second.label.toLowerCase()}: ${second.count} lần.` });

  if (summary.cleanRuns) {
    notes.push({
      kind: summary.cleanRuns * 2 >= summary.attempts ? "good" : "info",
      text: `${summary.cleanRuns}/${summary.attempts} bài không mắc lỗi nào, điểm trung bình ${summary.avgScore}/100.`,
    });
  }

  const byLlm = (entries ?? []).filter((entry) => entry.gradedBy === "llm").length;
  if (byLlm < (entries ?? []).length)
    notes.push({
      kind: "info",
      // Nói rõ vì hai cách chấm khác hẳn nhau: so câu mẫu coi mọi khác biệt là lệch,
      // kể cả khi bạn dịch đúng theo cách khác.
      text: `${byLlm}/${(entries ?? []).length} bài được mô hình ngôn ngữ chấm; số còn lại chỉ so với câu mẫu nên khắt khe hơn thực tế.`,
    });

  return notes;
}
