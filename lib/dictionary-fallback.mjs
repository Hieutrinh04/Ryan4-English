import { normalizeIpa } from "./arpabet.mjs";

/** Các dạng gốc có khả năng cao, chỉ dùng khi nguồn không biết đúng từ đã nhập. */
export function lemmaCandidates(word) {
  const value = String(word ?? "").trim().toLowerCase();
  const forms = new Set();
  if (/ies$/.test(value)) forms.add(value.replace(/ies$/, "y"));
  if (/(ses|xes|zes|ches|shes)$/.test(value)) forms.add(value.replace(/es$/, ""));
  if (/s$/.test(value) && !/(ss|us|is)$/.test(value)) forms.add(value.replace(/s$/, ""));
  if (/ing$/.test(value)) {
    forms.add(value.replace(/ing$/, ""));
    forms.add(value.replace(/ing$/, "e"));
  }
  if (/ed$/.test(value)) {
    forms.add(value.replace(/ed$/, ""));
    forms.add(value.replace(/ed$/, "e"));
  }
  forms.delete(value);
  return [...forms].filter((item) => item.length >= 3);
}

function partName(shortPart) {
  const value = String(shortPart ?? "").toLowerCase();
  if (value === "n") return "noun";
  if (value === "v") return "verb";
  if (value === "adj") return "adjective";
  if (value === "adv") return "adverb";
  return value;
}

/** Đổi kết quả md=dpr của Datamuse sang cấu trúc ô tra nhanh đang dùng. */
export function sensesFromDatamuse(entries, requestedWord) {
  const key = String(requestedWord ?? "").trim().toLowerCase();
  const list = Array.isArray(entries) ? entries : [];
  const entry = list.find((item) => String(item?.word ?? "").trim().toLowerCase() === key) ?? list[0];
  if (!entry || !Array.isArray(entry.defs)) return null;
  const senses = [];
  for (const rawValue of entry.defs) {
    const raw = String(rawValue ?? "");
    const separator = raw.indexOf("\t");
    const part = partName(separator >= 0 ? raw.slice(0, separator) : "");
    const definition = (separator >= 0 ? raw.slice(separator + 1) : raw).trim();
    if (!definition || senses.some((item) => item.part === part)) continue;
    senses.push({ part, definition, synonyms: [] });
    if (senses.length >= 4) break;
  }
  if (!senses.length) return null;
  // Datamuse `pron:` là ARPABET ("M AA1 R K S"), không phải IPA — đổi lại.
  const pronunciation = (entry.tags ?? []).find((tag) => String(tag).startsWith("pron:"));
  return {
    ipa: pronunciation ? normalizeIpa(String(pronunciation).slice(5)) : "",
    senses,
  };
}

// Từ chức năng — không tự nó tạo thành collocation đáng học.
const FUNCTION_WORDS = new Set([
  "the", "a", "an", "of", "to", "and", "or", "but", "in", "on", "at", "by", "for",
  "with", "as", "is", "are", "was", "were", "be", "been", "it", "its", "this", "that",
  "these", "those", "s", "not", "no", "i", "you", "he", "she", "we", "they", "his",
  "her", "their", "our", "your", "my", "me", "him", "them", "which", "who", "what",
]);

function cleanCandidates(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((item) => String(item?.word ?? "").trim().toLowerCase())
    .filter((word) => word && /^[a-z][a-z'-]*$/.test(word) && !FUNCTION_WORDS.has(word));
}

/**
 * Dựng collocation từ kết quả bigram của Datamuse.
 * @param {unknown} before - rel_bgb: từ hay đứng NGAY TRƯỚC
 * @param {unknown} after  - rel_bga: từ hay đứng NGAY SAU
 * @param {string} word
 * @returns {{ before: string[], after: string[] }}
 */
export function collocationsFrom(before, after, word) {
  const head = String(word ?? "").trim().toLowerCase();
  return {
    before: cleanCandidates(before).slice(0, 6).map((left) => `${left} ${head}`),
    after: cleanCandidates(after).slice(0, 6).map((right) => `${head} ${right}`),
  };
}
