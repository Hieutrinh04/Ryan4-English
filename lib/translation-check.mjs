// Chấm bài dịch Việt → Anh bằng cách đối chiếu với câu mẫu.
//
// Giới hạn phải nói rõ: app không có mô hình ngôn ngữ, nên không thể phán một câu
// tiếng Anh bất kỳ là đúng hay sai ngữ pháp. Cái làm được là so với câu mẫu đi kèm
// mỗi từ vựng, chỉ ra chỗ lệch, và từ những chỗ lệch đó rút ra nhận xét chắc chắn:
// sai thì của động từ, thiếu mạo từ, thiếu giới từ, chưa dùng từ đang học. Những
// khác biệt còn lại chỉ được gọi là "khác câu mẫu", không gọi là sai.

const ARTICLES = new Set(["a", "an", "the"]);
const PREPOSITIONS = new Set(["in", "on", "at", "of", "to", "for", "with", "from", "by", "into", "about", "over", "under", "between", "during", "after", "before"]);

// Động từ bất quy tắc hay gặp, để nhận ra "sit/sat" là cùng một từ khác thì.
const IRREGULAR = [
  ["be", "am", "is", "are", "was", "were", "been"], ["begin", "began", "begun"], ["break", "broke", "broken"],
  ["bring", "brought"], ["build", "built"], ["buy", "bought"], ["catch", "caught"], ["choose", "chose", "chosen"],
  ["come", "came"], ["do", "does", "did", "done"], ["drink", "drank", "drunk"], ["drive", "drove", "driven"],
  ["eat", "ate", "eaten"], ["fall", "fell", "fallen"], ["feel", "felt"], ["find", "found"], ["fly", "flew", "flown"],
  ["forget", "forgot", "forgotten"], ["get", "got", "gotten"], ["give", "gave", "given"], ["go", "goes", "went", "gone"],
  ["grow", "grew", "grown"], ["have", "has", "had"], ["hear", "heard"], ["hold", "held"], ["keep", "kept"],
  ["know", "knew", "known"], ["leave", "left"], ["lose", "lost"], ["make", "made"], ["meet", "met"], ["pay", "paid"],
  ["put"], ["read"], ["ride", "rode", "ridden"], ["run", "ran"], ["say", "said"], ["see", "saw", "seen"],
  ["sell", "sold"], ["send", "sent"], ["sit", "sat"], ["sleep", "slept"], ["speak", "spoke", "spoken"],
  ["spend", "spent"], ["stand", "stood"], ["swim", "swam", "swum"], ["take", "took", "taken"], ["teach", "taught"],
  ["tell", "told"], ["think", "thought"], ["throw", "threw", "thrown"], ["understand", "understood"],
  ["wake", "woke", "woken"], ["wear", "wore", "worn"], ["win", "won"], ["write", "wrote", "written"],
];
const verbFamily = new Map();
for (const forms of IRREGULAR) for (const form of forms) verbFamily.set(form, forms[0]);

// Dạng gốc thô sơ, đủ để nhận ra walk/walked/walking hay library/libraries là một.
export function baseForm(word) {
  const value = word.toLowerCase();
  if (verbFamily.has(value)) return verbFamily.get(value);
  if (/ies$/.test(value)) return `${value.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|zes)$/.test(value)) return value.slice(0, -2);
  if (/s$/.test(value) && !/(ss|us|is)$/.test(value)) return value.slice(0, -1);
  if (/ied$/.test(value)) return `${value.slice(0, -3)}y`;
  if (/ing$/.test(value)) return value.slice(0, -3).replace(/([^aeiou])\1$/, "$1");
  if (/ed$/.test(value)) return value.slice(0, -2).replace(/([^aeiou])\1$/, "$1");
  return value;
}

export function tokenize(text) {
  return (text ?? "").toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

// So khớp dài nhất giữa hai câu, rồi đọc ra các phép giữ/thiếu/thừa. So theo vị trí
// như phần chép chính tả thì chỉ cần lệch một từ ở đầu là cả câu bị coi là sai.
export function alignTokens(reference, answer) {
  const rows = reference.length;
  const columns = answer.length;
  const table = Array.from({ length: rows + 1 }, () => new Array(columns + 1).fill(0));
  for (let row = rows - 1; row >= 0; row--)
    for (let column = columns - 1; column >= 0; column--)
      table[row][column] = baseForm(reference[row]) === baseForm(answer[column])
        ? table[row + 1][column + 1] + 1
        : Math.max(table[row + 1][column], table[row][column + 1]);

  const operations = [];
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (baseForm(reference[row]) === baseForm(answer[column])) {
      // Cùng gốc nhưng khác chữ nghĩa là sai dạng: "sit" ở chỗ đáng lẽ là "sat".
      const exact = reference[row] === answer[column];
      operations.push({ type: exact ? "same" : "form", reference: reference[row], answer: answer[column] });
      row++;
      column++;
    } else if (table[row + 1][column] >= table[row][column + 1]) {
      operations.push({ type: "missing", reference: reference[row] });
      row++;
    } else {
      operations.push({ type: "extra", answer: answer[column] });
      column++;
    }
  }
  while (row < rows) operations.push({ type: "missing", reference: reference[row++] });
  while (column < columns) operations.push({ type: "extra", answer: answer[column++] });
  return operations;
}

function listOf(words) {
  return [...new Set(words)].join(", ");
}

// Chỉ rút nhận xét từ những gì chắc chắn. Khác biệt không thuộc các nhóm này được
// gộp vào một dòng "khác câu mẫu", vì có thể bạn dịch cách khác mà vẫn đúng.
export function notesFor(operations, targetWord) {
  const notes = [];
  const formErrors = operations.filter((item) => item.type === "form");
  const missing = operations.filter((item) => item.type === "missing").map((item) => item.reference);
  const extra = operations.filter((item) => item.type === "extra").map((item) => item.answer);

  for (const item of formErrors)
    notes.push({
      kind: "form",
      text: `Sai dạng từ: bạn viết **${item.answer}**, câu mẫu dùng **${item.reference}**. Cùng một từ nhưng khác dạng — hãy kiểm tra thì và số ít/số nhiều.`,
    });

  const missingArticles = missing.filter((word) => ARTICLES.has(word));
  if (missingArticles.length)
    notes.push({ kind: "article", text: `Thiếu mạo từ **${listOf(missingArticles)}**. Danh từ đếm được số ít trong tiếng Anh gần như luôn cần mạo từ, dù tiếng Việt không có.` });

  const missingPrepositions = missing.filter((word) => PREPOSITIONS.has(word));
  if (missingPrepositions.length)
    notes.push({ kind: "preposition", text: `Thiếu giới từ **${listOf(missingPrepositions)}**. Cụm chỉ nơi chốn và thời gian trong tiếng Anh phải có giới từ đi kèm.` });

  const target = targetWord ? baseForm(targetWord.split(/\s+/)[0]) : "";
  if (target && !operations.some((item) => item.type !== "missing" && item.answer && baseForm(item.answer) === target))
    notes.push({ kind: "target", text: `Bài này luyện từ **${targetWord}** nhưng câu của bạn chưa dùng đến nó.` });

  const otherMissing = missing.filter((word) => !ARTICLES.has(word) && !PREPOSITIONS.has(word));
  if (otherMissing.length) notes.push({ kind: "diff", text: `Câu mẫu còn có **${listOf(otherMissing)}** mà câu bạn không có. Nếu bạn diễn đạt cách khác thì vẫn có thể đúng — hãy đối chiếu câu mẫu bên dưới.` });
  if (extra.length) notes.push({ kind: "diff", text: `Câu bạn có thêm **${listOf(extra)}** so với câu mẫu.` });
  return notes;
}

export function gradeTranslation(reference, answer, targetWord) {
  const referenceTokens = tokenize(reference);
  const answerTokens = tokenize(answer);
  const operations = alignTokens(referenceTokens, answerTokens);
  const same = operations.filter((item) => item.type === "same").length;
  // Chia cho phần dài hơn để câu viết thừa cũng bị trừ điểm, không chỉ câu viết thiếu.
  const denominator = Math.max(referenceTokens.length, answerTokens.length, 1);
  const accuracy = Math.round((same / denominator) * 100);
  const notes = notesFor(operations, targetWord);
  const errorNotes = notes.filter((item) => item.kind !== "diff");
  return {
    accuracy,
    operations,
    notes,
    // "Khớp câu mẫu" khác với "đúng ngữ pháp" — không có mô hình ngôn ngữ thì chỉ
    // dám khẳng định điều thứ nhất.
    matchesReference: accuracy === 100,
    verdict: accuracy === 100 ? "perfect" : errorNotes.length ? "errors" : accuracy >= 60 ? "close" : "far",
  };
}

// ── Dựng đoạn đọc cho bài luyện dịch ────────────────────────────────────────
//
// Nói thẳng giới hạn: viết một đoạn văn kể chuyện thật sự, các câu nối ý được với
// nhau, là việc của mô hình ngôn ngữ — app này không có. Chèn bừa "Vì vậy", "Sau
// đó" vào giữa những câu không liên quan chỉ tạo ra mạch văn giả và còn khó đọc
// hơn. Nên ở đây làm ba việc chắc chắn có ích:
//   1. bỏ những câu nói VỀ từ thay vì DÙNG từ,
//   2. gom các câu cùng chủ đề lại với nhau,
//   3. cắt thành từng đoạn ngắn thay vì đổ cả trăm câu thành một khối.

// Câu khuôn tự dựng luôn trích chính từ đang học trong ngoặc kép: "Từ “successful”
// xuất hiện hai lần trong bài đọc hôm nay." Câu tiếng Việt tự nhiên không làm vậy.
export function isMetaSentence(vietnamese, term) {
  if (!vietnamese) return true;
  if (/[“"][^”"]*[”"]/.test(vietnamese) && term && vietnamese.toLowerCase().includes(term.toLowerCase())) return true;
  return /\b(từ|cụm từ)\s*[“"]/i.test(vietnamese);
}

export const PASSAGE_SIZE = 6;

// Xếp một câu vào nhóm chủ đề. Trường topic của từ tự thêm gần như luôn là "Từ vựng
// chung" và ieltsTopics thì trống, nên gom theo chúng chẳng đổi được gì. Chấm thẳng
// trên câu tiếng Anh bằng bảng chủ đề IELTS của app thì mới tách thật sự được:
// "Rising sea levels threaten coastal communities" và "Deforestation destroys
// wildlife habitats" cùng vào Environment, còn "Do you play baseball?" sang Sport.
// areas: [[tên nhóm, [từ khoá…]], …] — chính là lib/ielts-areas.json.
export const LEFTOVER_TOPIC = "Chủ đề chung";
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function themeOf(task, areas) {
  // Route tra từ trả về câu này khi không xếp được chủ đề — đó không phải tên chủ đề.
  const stated = task.word?.ieltsTopics?.[0];
  if (stated && !/^Chưa xác định/.test(stated)) return stated;
  const text = `${task.word?.term ?? ""} ${task.en ?? ""} ${task.word?.definition ?? ""}`.toLowerCase();
  let best = "";
  let bestScore = 0;
  for (const [name, keys] of areas ?? []) {
    let score = 0;
    // Chú ý: phải là "\\b" — viết "\b" trong template literal ra ký tự backspace,
    // không phải ranh giới từ, và regex sẽ không bao giờ khớp.
    for (const key of keys) if (new RegExp(`\\b${escapeRegExp(key)}`, "i").test(text)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  const topic = (task.word?.topic || "").split(" · ")[0];
  return best || (topic && topic !== "Từ vựng chung" ? topic : LEFTOVER_TOPIC);
}

// tasks: [{ word, vi, en }]. Trả về mảng đoạn, mỗi đoạn là { topic, tasks }.
/**
 * @param {{ word?: any; vi?: string; en?: string }[]} tasks
 * @param {{ areas?: [string, string[]][]; size?: number }} [options]
 */
export function buildPassages(tasks, options = {}) {
  const { areas = [], size = PASSAGE_SIZE } = options;
  const usable = tasks.filter((task) => !isMetaSentence(task.vi, task.word?.term));
  const byTopic = new Map();
  for (const task of usable) {
    const topic = themeOf(task, areas);
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic).push(task);
  }
  // Nhóm đông câu lên trước cho dễ đọc, nhưng "Chủ đề chung" là phần không xếp được
  // vào đâu nên luôn xuống cuối — nó thường đông nhất mà lại rời rạc nhất.
  const groups = [...byTopic.entries()].sort((a, b) => {
    const leftovers = Number(a[0] === LEFTOVER_TOPIC) - Number(b[0] === LEFTOVER_TOPIC);
    return leftovers || b[1].length - a[1].length;
  });
  const passages = [];
  for (const [topic, group] of groups)
    for (let start = 0; start < group.length; start += size) passages.push({ topic, tasks: group.slice(start, start + size) });
  return passages;
}
