export const lexicalTypeOptions = [
  { value: "word", label: "Từ đơn", hint: "Một từ độc lập" },
  { value: "chunk", label: "Cụm cố định", hint: "Một cụm dùng như một khối" },
  { value: "collocation", label: "Collocation", hint: "Những từ thường đi cùng nhau" },
  { value: "phrase", label: "Câu / thành ngữ", hint: "Một cách diễn đạt hoàn chỉnh" },
];

export function inferLexicalType(term = "", partOfSpeech = "") {
  const value = String(term).trim().replace(/\s+/g, " ");
  if (!value.includes(" ")) return "word";
  if (/[.!?]$/.test(value) || value.split(" ").length >= 6) return "phrase";
  if (/collocation/i.test(partOfSpeech)) return "collocation";
  return "chunk";
}

export function lexicalTypeLabel(type) {
  return lexicalTypeOptions.find((item) => item.value === type)?.label ?? "Từ đơn";
}
