// Sửa nhiễu cấu trúc của bộ 983 từ được trích từ PDF.
//
// PDF có tiêu đề chủ đề nằm sát hàng cuối trang và số chú thích ở chân trang.
// Trình trích cũ đôi khi ghép chúng vào term/IPA/meaning. Hàm này chạy với cả
// dữ liệu dựng từ file lẫn dữ liệu PDF đã đồng bộ lên tài khoản từ trước.

const TERM_REPAIRS = new Map([
  ["blond (n, adj) body", "blond (n, adj)"],
  ["public school character", "public school"],
  ["weak school", "weak"],
  ["porridge body", "porridge"],
  ["roll vehicles automobile", "roll"],
  ["english mathematics", "English"],
  ["cube soccer", "cube"],
]);

const IPA_REPAIRS = new Map([
  ["roll vehicles automobile", "/roʊl/"],
  ["roll", "/roʊl/"],
  ["english mathematics", "/ˈɪŋɡlɪʃ/"],
  ["english", "/ˈɪŋɡlɪʃ/"],
  ["cube soccer", "/kjuːb/"],
  ["cube", "/kjuːb/"],
  ["entrance", "/ˈen.trəns/"],
  ["offended", "/əˈfendɪd/"],
]);

const FOOTNOTE_TERMS = new Set([
  "daughter", "buffalo", "bee", "ivory (n, adj)", "finger", "alert", "impartial", "shallow",
  "book", "savanna", "opera", "living room", "cooker", "cabbage", "coffee", "chicken nugget",
  "cry", "pants", "cuff", "upset", "irritated", "shameful", "blanch", "subway", "passport",
  "trapezoid", "billiards", "march", "petal", "clear", "thermometer",
]);

const MEANING_REPAIRS = new Map([
  ["father", "bố, cha"],
  ["parent", "bố hoặc mẹ; bố mẹ, phụ huynh"],
  ["grandfather", "ông nội, ông ngoại"],
  ["grandparent", "ông hoặc bà; ông bà"],
  ["honest", "trung thực, chân thật"],
  ["passive", "thụ động"],
  ["unscrupulous", "vô nguyên tắc, vô đạo đức"],
  ["chill", "làm lạnh, để lạnh"],
  ["weak school", "yếu đuối"],
]);

const POS_SUFFIX = /\s*\(((?:n|v|adj|adv|prep|pron|det|conj)(?:\s*,\s*(?:n|v|adj|adv|prep|pron|det|conj))*)\)\s*$/i;

export function cleanVocabularyIpa(value, term = "") {
  const key = String(term).trim().toLowerCase();
  if (IPA_REPAIRS.has(key)) return IPA_REPAIRS.get(key);
  const raw = String(value ?? "").trim();
  const pairs = [...raw.matchAll(/\/([^/\r\n]+)\//g)].map((match) => `/${match[1].trim()}/`);
  if (pairs.length) return pairs.join(" ");
  // Hai mục trong bản gốc chỉ thiếu dấu / đóng, không hề có tiêu đề đi kèm.
  if (raw.startsWith("/") && raw.length > 1) return `${raw.replace(/\/+$/, "")}/`;
  return raw || "/…/";
}

export function cleanVocabularyMeaning(value, term = "") {
  const key = String(term).trim().toLowerCase();
  if (MEANING_REPAIRS.has(key)) return MEANING_REPAIRS.get(key);
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  return FOOTNOTE_TERMS.has(key) ? raw.replace(/\s+\d+$/, "").trim() : raw;
}

/** Chuẩn hóa đúng phần người học nhìn thấy, giữ nguyên id và tiến độ ôn. */
export function sanitiseVocabularyCard(word) {
  if (!word || typeof word !== "object") return word;
  const originalTerm = String(word.term ?? "").replace(/\s+/g, " ").trim();
  const originalKey = originalTerm.toLowerCase();
  let term = TERM_REPAIRS.get(originalKey) ?? originalTerm;
  let partOfSpeech = String(word.partOfSpeech ?? "").trim();
  const match = term.match(POS_SUFFIX);
  if (match) {
    if (!partOfSpeech) partOfSpeech = match[1].replace(/\s*,\s*/g, ", ").toLowerCase();
    term = term.replace(POS_SUFFIX, "").trim();
  }
  return {
    ...word,
    term,
    partOfSpeech,
    ipa: cleanVocabularyIpa(word.ipa, originalTerm),
    meaning: cleanVocabularyMeaning(word.meaning, originalTerm),
  };
}

export function vocabularyQualityReport(words) {
  const list = (Array.isArray(words) ? words : []).map(sanitiseVocabularyCard);
  const malformed = list.filter((word) => {
    const term = String(word?.term ?? "");
    const ipa = String(word?.ipa ?? "");
    const meaning = String(word?.meaning ?? "");
    return !term || !meaning || !/^\/[^/]+\/(?:\s+\/[^/]+\/)*$/.test(ipa) || POS_SUFFIX.test(term) || /\b(?:BODY|CHARACTER|SCHOOL|VEHICLES|SUBJECT|SPORTS)\b/.test(term);
  });
  return { total: list.length, valid: list.length - malformed.length, malformed };
}
