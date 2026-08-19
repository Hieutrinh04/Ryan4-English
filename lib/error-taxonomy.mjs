// Bộ nhãn lỗi cố định cho bài dịch Việt → Anh.
//
// Vì sao phải cố định: Learning Engine cần đếm được "30 ngày qua bạn sai mạo từ
// bao nhiêu lần". Nếu mô hình ngôn ngữ tự đặt tên lỗi mỗi lần một kiểu ("thiếu
// the", "article missing", "mạo từ") thì không nhóm lại được. Danh sách này phải
// khớp đúng ràng buộc check của cột error_type trong supabase/schema.sql.

export const ERROR_TYPES = [
  "article",
  "preposition",
  "verb_form",
  "verb_tense",
  "word_order",
  "agreement",
  "vocabulary",
  "collocation",
  "spelling",
  "natural_expression",
  "other",
];

/** Nhãn tiếng Việt để hiện cho người học. */
export const ERROR_LABELS = {
  article: "Mạo từ",
  preposition: "Giới từ",
  verb_form: "Dạng động từ",
  verb_tense: "Thì của động từ",
  word_order: "Trật tự từ",
  agreement: "Hoà hợp chủ ngữ – động từ",
  vocabulary: "Chọn từ",
  collocation: "Cụm từ đi với nhau",
  spelling: "Chính tả",
  natural_expression: "Cách diễn đạt tự nhiên",
  other: "Khác",
};

/** Mô tả ngắn, dùng trong prompt để mô hình chọn đúng nhãn. */
export const ERROR_HINTS = {
  article: "thiếu, thừa hoặc dùng sai a/an/the",
  preposition: "sai hoặc thiếu giới từ",
  verb_form: "sai dạng động từ (V-ing, to V, V3…)",
  verb_tense: "sai thì",
  word_order: "sai trật tự từ trong câu",
  agreement: "chủ ngữ và động từ không hoà hợp, hoặc sai số ít/số nhiều",
  vocabulary: "chọn từ sai nghĩa",
  collocation: "từ đúng nghĩa nhưng không đi với nhau tự nhiên",
  spelling: "sai chính tả",
  natural_expression: "đúng ngữ pháp nhưng người bản ngữ không nói như vậy",
  other: "lỗi không thuộc các nhóm trên",
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
    tense: "verb_tense",
    verb: "verb_form",
    verb_agreement: "agreement",
    subject_verb_agreement: "agreement",
    plural: "agreement",
    word_choice: "vocabulary",
    wording: "natural_expression",
    naturalness: "natural_expression",
    fluency: "natural_expression",
    typo: "spelling",
  };
  return aliases[key] ?? "other";
}

/** Dòng liệt kê nhãn để nhét vào prompt, giữ prompt và lược đồ luôn khớp nhau. */
export function taxonomyPrompt() {
  return ERROR_TYPES.map((type) => `${type} (${ERROR_HINTS[type]})`).join(", ");
}
