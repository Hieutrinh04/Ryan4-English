// Bộ nhãn lỗi cố định cho bài dịch Việt → Anh.
//
// Vì sao phải cố định: Learning Engine cần đếm được "30 ngày qua bạn sai mạo từ
// bao nhiêu lần". Nếu mô hình ngôn ngữ tự đặt tên lỗi mỗi lần một kiểu ("thiếu
// the", "article missing", "mạo từ") thì không nhóm lại được. Danh sách này phải
// khớp đúng ràng buộc check của cột error_type trong supabase/schema.sql.

export const ERROR_TYPES = [
  "tense",
  "grammar",
  "article",
  "preposition",
  "word_order",
  "vocabulary",
  "collocation",
  "meaning",
  "naturalness",
  "vietnamese_translation",
];

/** Nhãn tiếng Việt để hiện cho người học. */
export const ERROR_LABELS = {
  article: "Mạo từ",
  preposition: "Giới từ",
  tense: "Thì của động từ",
  grammar: "Ngữ pháp",
  word_order: "Trật tự từ",
  vocabulary: "Chọn từ",
  collocation: "Cụm từ đi với nhau",
  naturalness: "Cách diễn đạt tự nhiên",
  meaning: "Sai ý câu",
  vietnamese_translation: "Dịch từng chữ từ tiếng Việt",
};

/** Mô tả ngắn, dùng trong prompt để mô hình chọn đúng nhãn. */
export const ERROR_HINTS = {
  article: "thiếu, thừa hoặc dùng sai a/an/the",
  preposition: "sai hoặc thiếu giới từ",
  tense: "sai thì hoặc mốc thời gian của động từ",
  grammar: "sai cấu trúc, dạng động từ, hòa hợp hoặc chính tả ngữ pháp",
  word_order: "sai trật tự từ trong câu",
  vocabulary: "chọn từ sai nghĩa",
  collocation: "từ đúng nghĩa nhưng không đi với nhau tự nhiên",
  naturalness: "đúng ngữ pháp nhưng người bản ngữ không nói như vậy",
  meaning: "câu viết ra không còn đúng ý câu tiếng Việt",
  vietnamese_translation: "dịch máy móc từng chữ theo tiếng Việt, ra câu người bản ngữ không nói",
};

/** Quy nhãn lạ do mô hình trả về về nhãn hợp lệ gần nhất; không đoán được thì "other". */
export function normaliseErrorType(value) {
  const key = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (ERROR_TYPES.includes(key)) return key;
  // Vài biến thể hay gặp khi mô hình tự diễn đạt.
  const aliases = {
    articles: "article",
    determiner: "article",
    prepositions: "preposition",
    verb_tense: "tense",
    verb: "grammar",
    verb_form: "grammar",
    verb_agreement: "grammar",
    subject_verb_agreement: "grammar",
    agreement: "grammar",
    plural: "grammar",
    spelling: "grammar",
    word_choice: "vocabulary",
    wording: "naturalness",
    natural_expression: "naturalness",
    wrong_meaning: "meaning",
    mistranslation: "meaning",
    semantics: "meaning",
    literal_translation: "vietnamese_translation",
    word_for_word: "vietnamese_translation",
    vietnamese: "vietnamese_translation",
    vietlish: "vietnamese_translation",
    fluency: "naturalness",
    typo: "grammar",
    other: "grammar",
  };
  return aliases[key] ?? "grammar";
}

/** Dòng liệt kê nhãn để nhét vào prompt, giữ prompt và lược đồ luôn khớp nhau. */
export function taxonomyPrompt() {
  return ERROR_TYPES.map((type) => `${type} (${ERROR_HINTS[type]})`).join(", ");
}
