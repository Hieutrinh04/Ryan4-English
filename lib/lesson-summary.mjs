const STOP_WORDS = new Set(`a an the and or but if then than so because as at by for from in into of on onto to up with without is am are was were be been being do does did have has had can could may might must should would will this that these those it its i you he she we they me him her us them my your his our their not no yes very just also about there here what when where who how all any some more most much many one two first last new good get got make made like really`.split(/\s+/));

export function transcriptOf(sentences = []) {
  return sentences.map((item) => String(item?.text ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
}

function wordsOf(text) {
  return String(text).toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

export function fallbackVocabulary(sentences = [], limit = 10) {
  const frequency = new Map();
  for (const sentence of sentences) {
    const unique = new Set(wordsOf(sentence?.text));
    for (const word of unique) {
      if (word.length < 5 || STOP_WORDS.has(word)) continue;
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
    }
  }
  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => ({
      term,
      meaningVi: "",
      example: sentences.find((item) => wordsOf(item?.text).includes(term))?.text ?? "",
    }));
}

export function fallbackPhrases(sentences = [], limit = 6) {
  const useful = sentences
    .map((item) => String(item?.text ?? "").replace(/\s+/g, " ").trim())
    .filter((text) => {
      const count = wordsOf(text).length;
      return count >= 5 && count <= 22;
    });
  const step = Math.max(1, Math.floor(useful.length / Math.max(1, limit)));
  return useful.filter((_, index) => index % step === 0).slice(0, limit).map((text) => ({ text, meaningVi: "", note: "Câu diễn đạt tự nhiên trong bài." }));
}

export function fallbackLessonSummary(title, sentences = []) {
  const clean = sentences.map((item) => String(item?.text ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const sample = clean.slice(0, 3).join(" ");
  return {
    summaryVi: sample ? `Bài “${title}” trình bày nội dung qua phần hội thoại/lời kể trong video. Bạn có thể đọc transcript và nghe liền mạch để nắm mạch bài trước khi luyện từng câu.` : "Bài chưa có đủ nội dung để tạo tóm tắt.",
    keyPoints: clean.slice(0, 3),
    vocabulary: fallbackVocabulary(sentences),
    phrases: fallbackPhrases(sentences),
  };
}

function cleanString(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalizeLessonSummary(data, fallback) {
  const summaryVi = cleanString(data?.summaryVi, 1200) || fallback.summaryVi;
  const keyPoints = (Array.isArray(data?.keyPoints) ? data.keyPoints : []).map((item) => cleanString(item, 300)).filter(Boolean).slice(0, 5);
  const vocabulary = (Array.isArray(data?.vocabulary) ? data.vocabulary : []).map((item) => ({
    term: cleanString(item?.term, 80),
    meaningVi: cleanString(item?.meaningVi, 220),
    example: cleanString(item?.example, 400),
  })).filter((item) => item.term).slice(0, 12);
  const phrases = (Array.isArray(data?.phrases) ? data.phrases : []).map((item) => ({
    text: cleanString(item?.text, 400),
    meaningVi: cleanString(item?.meaningVi, 400),
    note: cleanString(item?.note ?? item?.why, 300),
  })).filter((item) => item.text).slice(0, 8);
  return {
    summaryVi,
    keyPoints: keyPoints.length ? keyPoints : fallback.keyPoints,
    vocabulary: vocabulary.length ? vocabulary : fallback.vocabulary,
    phrases: phrases.length ? phrases : fallback.phrases,
  };
}
