// Bổ sung cụm nên học, nghĩa của cụm và paraphrase cho bộ từ vựng PDF.
//
// Không gọi mạng: cụm được dựng theo loại từ, còn nghĩa tiếng Việt của cụm ghép từ
// nghĩa sẵn có trong vocabulary-1000.json. Cách này chính xác hơn dịch máy cả cụm,
// vì dịch máy hay dịch sai chính từ đang học.
//     node scripts/enrich-collocations.mjs
import { readFileSync, writeFileSync } from "node:fs";

const vocabulary = JSON.parse(readFileSync(new URL("../public/vocabulary-1000.json", import.meta.url), "utf8"));
const outputUrl = new URL("../public/vocabulary-enrichment.json", import.meta.url);
const store = JSON.parse(readFileSync(outputUrl, "utf8"));

// Cụm đời thường viết tay, dùng chung với route tra từ.
const practicalPhrases = {
  weed: ["pull out weeds", "nhổ cỏ dại"],
  weeds: ["pull out weeds", "nhổ cỏ dại"],
  decision: ["make a decision", "đưa ra quyết định"],
  break: ["take a break", "nghỉ giải lao"],
  attention: ["pay attention to", "chú ý đến"],
  mistake: ["make a mistake", "phạm lỗi"],
  shower: ["take a shower", "đi tắm"],
  homework: ["do homework", "làm bài tập về nhà"],
  photo: ["take a photo", "chụp ảnh"],
  progress: ["make progress", "tiến bộ"],
  rescue: ["carry out a rescue mission", "thực hiện một nhiệm vụ giải cứu"],
  insect: ["protect crops from insects", "bảo vệ mùa màng khỏi côn trùng"],
  insects: ["protect crops from insects", "bảo vệ mùa màng khỏi côn trùng"],
  problem: ["deal with a problem", "xử lý một vấn đề"],
  opportunity: ["take advantage of an opportunity", "tận dụng một cơ hội"],
  responsibility: ["take responsibility for", "chịu trách nhiệm về"],
  effort: ["make an effort to", "nỗ lực để làm gì"],
  habit: ["develop a habit of", "hình thành thói quen"],
  effect: ["have an effect on", "có ảnh hưởng đến"],
};

// Nghĩa trong file PDF hay kèm rác OCR ("con trâu 2", "(parents: bố mẹ)") — cắt bớt để ghép cụm cho gọn.
function cleanMeaning(meaning) {
  return meaning
    .replace(/\([^)]*\)/g, " ")
    .replace(/\d+/g, " ")
    .split(/[;,]/)[0]
    .replace(/\s+/g, " ")
    .trim();
}
function cleanTerm(term) {
  const cleaned = term.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return cleaned.split("/")[0].trim();
}

// "a" hay "an" theo âm đầu. Vài từ viết bằng nguyên âm nhưng đọc như phụ âm và ngược lại.
const anExceptions = /^(hour|honest|honou?r|heir)/;
const aExceptions = /^(uni|use|user|euro|one|once)/;
function article(word) {
  if (anExceptions.test(word)) return "an";
  if (aExceptions.test(word)) return "a";
  return /^[aeiou]/.test(word) ? "an" : "a";
}

// Khung cụm chọn theo chủ đề của folder, vì cùng là danh từ nhưng nghề nghiệp,
// trái cây hay bộ phận cơ thể lại đi với động từ hoàn toàn khác nhau.
const topicFrames = [
  [/^JOB/, (t, m) => [`work as ${article(t)} ${t}`, `làm nghề ${m}`]],
  [/^(FRUIT|VEGETABLE|FOOD)/, (t, m) => [`buy fresh ${t}`, `mua ${m} tươi`]],
  [/^DRINK/, (t, m) => [`order ${article(t)} ${t}`, `gọi một ${m}`]],
  [/^ANIMAL/, (t, m) => [`look after ${article(t)} ${t}`, `chăm sóc ${m}`]],
  [/^COLOR/, (t, m) => [`paint the wall ${t}`, `sơn tường ${m}`]],
  [/^BODY PART/, (t, m) => [`hurt my ${t}`, `bị đau ${m}`]],
  [/^CLOTHES/, (t, m) => [`wear ${article(t)} ${t}`, `mặc ${m}`]],
  [/^SCHOOL OBJECT/, (t, m) => [`bring ${article(t)} ${t} to class`, `mang ${m} tới lớp`]],
  [/^SCHOOL/, (t, m) => [`go to ${t}`, `đi ${m}`]],
  [/^SUBJECT/, (t, m) => [`study ${t}`, `học môn ${m}`]],
  [/^SPORTS/, (t, m) => [`play ${t}`, `chơi ${m}`]],
  [/^VEHICLES/, (t, m) => [`travel by ${t}`, `đi bằng ${m}`]],
  [/^SHAPE/, (t, m) => [`draw ${article(t)} ${t}`, `vẽ ${m}`]],
  [/^PLANTS/, (t, m) => [`grow ${t}`, `trồng ${m}`]],
  [/^HOUSE/, (t, m) => [`clean the ${t}`, `dọn ${m}`]],
  [/^NATURE/, (t, m) => [`protect the ${t}`, `bảo vệ ${m}`]],
  [/^WEATHER/, (t, m) => [`check the ${t}`, `xem ${m}`]],
  [/^LEISURE/, (t, m) => [`enjoy ${t}`, `tận hưởng ${m}`]],
  [/^TIME/, (t, m) => [`every ${t}`, `mỗi ${m}`]],
  [/^FAMILY/, (t, m) => [`live with my ${t}`, `sống cùng ${m}`]],
  [/^TRAVEL/, (t, m) => [`plan the ${t}`, `lên kế hoạch cho ${m}`]],
];

// Khung cụm theo loại từ, mỗi khung có sẵn bản tiếng Việt tương ứng.
function phraseFor(term, partOfSpeech, meaningVi, topic) {
  const practical = practicalPhrases[term];
  if (practical) return { phrase: practical[0], phraseVi: practical[1] };
  const part = (partOfSpeech || "").toLowerCase();
  // Động từ và tính từ đi theo loại từ trước, vì khung của chúng đúng ở mọi chủ đề.
  if (part.startsWith("v")) return { phrase: `learn how to ${term}`, phraseVi: `học cách ${meaningVi}` };
  if (part.startsWith("adj")) return { phrase: `feel ${term} about`, phraseVi: `cảm thấy ${meaningVi} về` };
  if (part.startsWith("adv")) return { phrase: `speak ${term}`, phraseVi: `nói một cách ${meaningVi}` };
  const frame = topicFrames.find(([pattern]) => pattern.test(topic ?? ""));
  if (frame) {
    const [phrase, phraseVi] = frame[1](term, meaningVi);
    return { phrase, phraseVi };
  }
  const plural = /s$/.test(term) && !/(ss|us|is)$/.test(term);
  if (plural) return { phrase: `deal with ${term}`, phraseVi: `xử lý ${meaningVi}` };
  return { phrase: `the importance of ${term}`, phraseVi: `tầm quan trọng của ${meaningVi}` };
}

let filled = 0;
const seen = new Set();
for (const item of vocabulary) {
  const key = item.term.trim().toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  const entry = store[key];
  if (!entry) continue;
  const term = cleanTerm(item.term);
  const meaningVi = cleanMeaning(item.meaning) || item.meaning;
  const { phrase, phraseVi } = phraseFor(term, item.partOfSpeech, meaningVi, item.topic);
  entry.collocation = phrase;
  entry.collocationVi = phraseVi;
  // Paraphrase: cụm vừa dựng cộng các từ đồng nghĩa kèm nghĩa tiếng Việt của từ gốc.
  entry.paraphrases = [...new Set([phrase, ...(entry.synonyms ?? []).map((synonym) => `${synonym} (${meaningVi})`)])].slice(0, 5);
  filled += 1;
}
writeFileSync(outputUrl, JSON.stringify(store));

const values = Object.values(store);
console.log(`Đã xử lý ${filled} từ`);
console.log(`  có cụm nên học : ${values.filter((item) => item.collocation).length}`);
console.log(`  có nghĩa của cụm: ${values.filter((item) => item.collocationVi).length}`);
console.log(`  có paraphrase  : ${values.filter((item) => item.paraphrases?.length).length}`);
console.log("\nVí dụ:");
for (const key of ["accountant", "apple", "elephant", "eye", "walk", "happy", "football", "rainbow", "mother"]) {
  if (store[key]) console.log(`  ${key}: "${store[key].collocation}" → "${store[key].collocationVi}"`);
}
