// Phần tính toán cho buổi luyện từ vựng: chọn chế độ, chấm câu trả lời, dựng đáp
// án nhiễu. Tách khỏi giao diện để kiểm thử được mà không cần dựng React.

import { clozeFor } from "./cloze.mjs";
import { baseForm } from "./translation-check.mjs";

/**
 * Các dạng biến thể thường gặp của một từ: số nhiều / ngôi thứ ba, quá khứ, V-ing.
 * Chỉ sinh từ từ đã biết, không đoán ngược từ chuỗi người học gõ vào.
 */
export function inflectionsOf(word) {
  const base = String(word ?? "").trim().toLowerCase();
  if (!base || /\s/.test(base)) return base ? [base] : [];
  const consonantY = /[^aeiou]y$/.test(base);
  const forms = [base];

  if (/(s|x|z|ch|sh)$/.test(base)) forms.push(`${base}es`);
  else if (consonantY) forms.push(`${base.slice(0, -1)}ies`);
  else forms.push(`${base}s`);

  // "stop" → "stopped": phụ âm–nguyên âm–phụ âm ở cuối thì gấp đôi phụ âm cuối.
  const doubled = /[^aeiou][aeiou][^aeiouwxy]$/.test(base) ? base + base.slice(-1) : base;

  if (/e$/.test(base)) forms.push(`${base}d`);
  else if (consonantY) forms.push(`${base.slice(0, -1)}ied`);
  else forms.push(`${doubled}ed`);

  // "make" → "making", "rescue" → "rescuing", nhưng "see" → "seeing".
  if (/e$/.test(base) && !/ee$/.test(base)) forms.push(`${base.slice(0, -1)}ing`);
  else forms.push(`${doubled}ing`);

  return [...new Set(forms)];
}

/** Sáu chế độ trong một buổi, đúng thứ tự hiện trên thanh tab. */
export const DRILL_MODES = [
  { value: "card", label: "Thẻ flashcard", icon: "▭", hint: "Lật thẻ rồi tự đánh giá đã thuộc hay chưa" },
  { value: "type", label: "Gõ từ", icon: "⌨", hint: "Gõ lại từ tiếng Anh từ trí nhớ" },
  { value: "listen", label: "Nghe", icon: "◖))", hint: "Nghe phát âm rồi gõ lại từ" },
  { value: "reverse", label: "Đảo ngược", icon: "⇄", hint: "Xem nghĩa tiếng Việt, chọn từ tiếng Anh đúng" },
  { value: "cloze", label: "Điền vào chỗ trống", icon: "⧉", hint: "Điền từ còn thiếu vào câu ví dụ" },
  { value: "mixed", label: "Hỗn hợp", icon: "⤨", hint: "Trộn ngẫu nhiên các cách trên cho khỏi đoán trước" },
];

/** Các chế độ mà "Hỗn hợp" bốc ngẫu nhiên. Không bốc "card" vì nó không chấm được. */
export const MIXED_POOL = ["type", "listen", "reverse", "cloze"];

/** Xáo tất định theo seed để thứ tự không đổi lại sau mỗi lần render. */
export function seededOrder(items, seed) {
  return items
    .map((item, position) => ({ item, key: Math.imul(position + seed + 1, 2654435761) >>> 0 }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item);
}

/** Chế độ thật của thẻ thứ `index`. Chỉ "mixed" mới đổi theo từng thẻ. */
export function modeForCard(mode, index, seed = 0) {
  if (mode !== "mixed") return mode;
  return MIXED_POOL[(Math.imul(index + seed + 1, 2654435761) >>> 0) % MIXED_POOL.length];
}

/**
 * So câu trả lời với đáp án.
 *
 * Bỏ qua chữ hoa, dấu câu và khoảng trắng thừa: người học gõ "she works" hay
 * "She works." đều là cùng một câu trả lời. Không bỏ qua sai chính tả — đây là
 * bài luyện viết đúng từ, gần đúng vẫn là chưa đúng.
 */
export function normalise(text) {
  return String(text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.,!?;:"“”'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Đáp án nào được chấp nhận cho một thẻ.
 *
 * Từ khoá trong bộ PDF hay có nhiễu: "actor/ actress", "white (n, adj)". Người
 * học gõ một nhánh bất kỳ đều phải được tính đúng, vì cả hai đều là đáp án thật.
 */
export function acceptedAnswers(term) {
  const raw = String(term ?? "").trim();
  const withoutBrackets = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const answers = [raw, withoutBrackets, ...withoutBrackets.split("/").map((part) => part.trim())];
  return [...new Set(answers.map(normalise).filter(Boolean))];
}

/**
 * @param {string} answer câu trả lời của người học
 * @param {string} term từ đang luyện
 * @param {boolean} allowInflections chấp nhận cả biến thể của từ
 *
 * allowInflections dành cho bài điền chỗ trống: chỗ trống nằm ở "rescued" nhưng
 * từ đang luyện là "rescue". Bắt gõ đúng "rescue" thì câu sai ngữ pháp, bắt gõ
 * đúng "rescued" thì trái với đề bài. Chấp nhận cả hai là cách duy nhất đúng.
 */
export function isCorrect(answer, term, allowInflections = false) {
  const given = normalise(answer);
  if (!given) return false;
  const answers = acceptedAnswers(term);
  if (answers.includes(given)) return true;
  if (!allowInflections) return false;
  // Hai đường: dạng đều thì sinh ra từ chính từ đang học; dạng bất quy tắc
  // ("made" cho "make") thì tra bảng động từ bất quy tắc sẵn có.
  return answers.some((accepted) => inflectionsOf(accepted).includes(given) || baseForm(given) === accepted);
}

/** Phiên âm có thật hay chỉ là chỗ dành sẵn ("/…/", "//") lúc chưa tra được. */
export function hasIpa(ipa) {
  const value = String(ipa ?? "").replace(/[/\s…·.]/g, "");
  return value.length > 0;
}

/** Câu khoét chỗ trống cho thẻ; ưu tiên câu đã khoét sẵn khi thêm từ. */
export function clozeOf(card) {
  if (card?.cloze?.includes("_____")) return card.cloze;
  return clozeFor(card?.term ?? "", card?.example ?? "");
}

/**
 * Câu ví dụ này là câu khuôn tự sinh khi chưa tra được ví dụ thật hay không.
 *
 * Hai khuôn trong app/page.tsx và lib/types.ts dùng chung cho MỌI từ, nên khoét
 * chỗ trống từ chúng ra 983 câu y hệt nhau: "I am learning how to use _____
 * naturally." Người học đọc câu đó không đoán được gì, và sang thẻ thứ hai là
 * thuộc lòng câu hỏi. Thà bỏ qua thẻ đó còn hơn.
 */
export function isTemplateExample(term, example) {
  const text = String(example ?? "").trim();
  if (!text) return true;
  const word = String(term ?? "").trim();
  return text === `I am learning how to use ${word} naturally.` || text === `I am learning the word ${word}.`;
}

/** Thẻ có đủ dữ liệu cho chế độ này không. Thiếu thì bỏ qua chứ không hiện ô trống. */
export function supportsMode(card, mode) {
  if (!card) return false;
  if (mode === "cloze") return !isTemplateExample(card.term, card.example) && clozeOf(card).includes("_____");
  if (mode === "reverse") return Boolean(card.meaning);
  if (mode === "type") return Boolean(card.meaning);
  return true;
}

/**
 * Bốn lựa chọn cho chế độ đảo ngược: một đáp án đúng và ba từ khác trong bộ.
 * Bộ quá nhỏ thì trả về ít hơn bốn, không lặp lại đáp án để lấp chỗ.
 */
export function choicesFor(card, pool, seed = 0, howMany = 4) {
  const others = seededOrder(
    (pool ?? []).filter((item) => item.id !== card.id && normalise(item.term) !== normalise(card.term)),
    seed,
  ).slice(0, howMany - 1);
  return seededOrder([card, ...others], seed + 7);
}

/**
 * Chế độ thật sự dùng cho thẻ này.
 *
 * Chế độ đơn: thẻ không đủ dữ liệu thì lùi về thẻ flashcard, vì hiện một ô trống
 * không có đáp án còn tệ hơn.
 * Hỗn hợp: bốc sang chế độ kế tiếp còn dùng được, thay vì lùi về flashcard — lùi
 * về flashcard hàng loạt sẽ biến "hỗn hợp" thành "lật thẻ".
 */
export function resolveMode(card, mode, index, seed = 0) {
  if (mode !== "mixed") return supportsMode(card, mode) ? mode : "card";
  const start = (Math.imul(index + seed + 1, 2654435761) >>> 0) % MIXED_POOL.length;
  for (let step = 0; step < MIXED_POOL.length; step += 1) {
    const candidate = MIXED_POOL[(start + step) % MIXED_POOL.length];
    if (supportsMode(card, candidate)) return candidate;
  }
  return "card";
}

/** Bộ thẻ này có thẻ nào dùng được chế độ đó không. */
export function deckSupports(cards, mode) {
  if (mode === "card" || mode === "mixed") return true;
  return (cards ?? []).some((card) => supportsMode(card, mode));
}

/**
 * Tổng kết cuối buổi.
 *
 * Chỉ tính những lượt CÓ chấm: thẻ lật qua mà không tự đánh giá thì không nói lên
 * điều gì, gộp vào sẽ kéo tỉ lệ đúng xuống một cách vô nghĩa.
 */
export function summarise(results) {
  const list = results ?? [];
  const answered = list.filter((item) => item.graded);
  const right = answered.filter((item) => item.correct).length;
  return {
    total: list.length,
    answered: answered.length,
    correct: right,
    wrong: answered.length - right,
    accuracy: answered.length ? Math.round((right / answered.length) * 100) : 0,
    wrongCards: answered.filter((item) => !item.correct).map((item) => item.id),
  };
}
