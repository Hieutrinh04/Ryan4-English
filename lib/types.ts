// Kiểu dữ liệu dùng chung của Lexilo.
//
// Tách khỏi app/page.tsx để tầng lưu trữ và các module khác dùng được mà không
// phải import ngược vào file giao diện.

export type Rating = "again" | "hard" | "good" | "easy";
export type ReviewMode = "card" | "vi_en" | "en_vi" | "quiz" | "listen" | "mixed";
export type ExamGoal = { date: string; label: string };

export type WordCard = {
  id: string;
  term: string;
  ipa: string;
  meaning: string;
  example: string;
  exampleVi?: string;
  cloze: string;
  definition: string;
  topic: string;
  box: number;
  lapses: number;
  starred?: boolean;
  direction?: "vi_en" | "en_vi";
  dueDate?: string;
  status?: "new" | "learning" | "review" | "mastered";
  intervalDays?: number;
  reviewCount?: number;
  partOfSpeech?: string;
  note?: string;
  collocation?: string;
  collocationVi?: string;
  synonyms?: string[];
  antonyms?: string[];
  related?: string[];
  synonymDetails?: UsageDetail[];
  antonymDetails?: UsageDetail[];
  relatedDetails?: UsageDetail[];
  paraphrases?: string[];
  ieltsTopics?: string[];
  addedDate?: string;
  studyDay?: number;
  lastReviewedAt?: string;
  source?: string;
  enrichmentCheckedAt?: string;
};
export type UsageDetail = { term: string; meaningVi: string; example: string; exampleVi: string };

export type ImportedVocabulary = { number: number; term: string; partOfSpeech: string; ipa: string; meaning: string; topic: string; source: string };
export type WeeklyVocabulary = { id: string; term: string; meaning: string; partOfSpeech: string; studyDay: number; topic: string; source: string };

// Định nghĩa, đồng/trái nghĩa, từ cùng chủ đề và chủ đề IELTS của bộ PDF, sinh sẵn bằng
// scripts/enrich-vocabulary.mjs để người dùng không phải tra lại 973 từ trên máy mình.
export type EnrichmentMap = Record<string, { definition?: string; synonyms?: string[]; antonyms?: string[]; related?: string[]; ieltsTopics?: string[]; collocation?: string; collocationVi?: string; paraphrases?: string[] }>;

// Ngữ cảnh của từng từ đồng/trái nghĩa, lưu chung một bảng tra theo từ vì các từ này
// lặp lại rất nhiều giữa các mục từ. App tự ghép lại thành danh sách cho mỗi từ.
export type UsageMap = Record<string, { meaningVi: string; example: string; exampleVi: string }>;
// Ghép nghĩa tiếng Việt vào sau mỗi từ khi đã có ngữ cảnh: "dynamic (năng động) · quiet (im lặng)".
// Thẻ ôn tập cần gọn nên chỉ hiện nghĩa, phần câu ví dụ để dành cho màn chi tiết.
export function withMeanings(terms: string[], details: UsageDetail[] | undefined) {
  const byTerm = new Map((details ?? []).map((item) => [item.term, item.meaningVi]));
  return terms.map((term) => (byTerm.get(term) ? `${term} (${byTerm.get(term)})` : term)).join(" · ");
}

export function detailsFrom(terms: string[] | undefined, usage: UsageMap): UsageDetail[] {
  return (terms ?? [])
    .slice(0, 4)
    .map((term) => (usage[term] ? { term, ...usage[term] } : null))
    .filter((item): item is UsageDetail => item !== null);
}

// Câu ví dụ riêng cho từng từ, soạn sẵn trong public/vocabulary-examples.json: term → [câu tiếng Anh, bản dịch].
export type ExampleMap = Record<string, [string, string]>;

// Bộ từ PDF dựng lại từ file dữ liệu mỗi lần tải trang nên không được lưu xuống
// máy như từ người dùng tự thêm; nhiều chỗ cần phân biệt hai loại này.
export function isPdfVocabulary(word: Pick<WordCard, "id" | "source">) {
  return word.source?.includes("MochiMochi") || word.id.startsWith("pdf-");
}

// Năm từ mẫu dựng sẵn lúc chưa có dữ liệu; không lưu và không tính vào thống kê.
export function isSeedWord(word: Pick<WordCard, "id">) {
  return ["1", "2", "3", "4", "5"].includes(word.id);
}

// Câu ví dụ mặc định, chỉ dùng cho từ chưa có câu riêng trong bộ dữ liệu.
export const fallbackExample = (term: string) => `I am learning the word ${term}.`;
export const fallbackExampleVi = (term: string) => `Tôi đang học từ “${term}”.`;

/** Câu ví dụ của một từ, lấy từ public/vocabulary-examples.json. */
export function exampleFor(term: string, examples: ExampleMap) {
  const found = examples[term.trim().toLowerCase()];
  return found ? { example: found[0], exampleVi: found[1] } : { example: fallbackExample(term), exampleVi: fallbackExampleVi(term) };
}
