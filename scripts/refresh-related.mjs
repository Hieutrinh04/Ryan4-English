// Tính lại trường "từ hay đi cùng chủ đề" cho bộ từ vựng PDF bằng bộ lọc mới.
//
// Dữ liệu cũ lấy thẳng rel_trg của Datamuse nên đầy danh từ riêng và từ hiếm:
// baker → eddy, holmes, oregon · butcher → patsy, eastenders · balcony → balconies.
// Xem lib/topical-words.mjs để biết cách lọc.
//     node scripts/refresh-related.mjs
// Chạy lại được, và chỉ đụng vào trường `related` — định nghĩa, đồng/trái nghĩa và
// chủ đề IELTS giữ nguyên (chủ đề IELTS vốn tính trên danh sách gợi ý đầy đủ, bỏ
// bớt sẽ làm hụt độ phủ mà không lợi gì).
import { readFileSync, writeFileSync } from "node:fs";
import { MIN_SUGGESTIONS, topicNeighbours, topicalWords } from "../lib/topical-words.mjs";

const vocabularyUrl = new URL("../public/vocabulary-1000.json", import.meta.url);
const storeUrl = new URL("../public/vocabulary-enrichment.json", import.meta.url);
const vocabulary = JSON.parse(readFileSync(vocabularyUrl, "utf8"));
const store = JSON.parse(readFileSync(storeUrl, "utf8"));

// Từ khoá trong file PDF có nhiễu OCR ("white (n, adj)", "bus bicycle") — tra bằng phần sạch.
function lookupForm(term) {
  const cleaned = term.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return cleaned.split("/")[0].trim().split(" ")[0] || cleaned;
}

async function triggerCandidates(word) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`https://api.datamuse.com/words?rel_trg=${encodeURIComponent(word)}&md=fp&max=20`);
      if (response.ok) return await response.json();
    } catch {
      // thử lại
    }
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  return null;
}

const termByKey = new Map();
const itemByKey = new Map();
const folderByTopic = new Map();
for (const item of vocabulary) {
  const key = item.term.trim().toLowerCase();
  if (!termByKey.has(key)) {
    termByKey.set(key, item.term);
    itemByKey.set(key, item);
  }
  if (!folderByTopic.has(item.topic)) folderByTopic.set(item.topic, []);
  folderByTopic.get(item.topic).push(item);
}

const keys = Object.keys(store);
console.log(`Tính lại từ cùng chủ đề cho ${keys.length} từ`);

const before = keys.filter((key) => store[key].related?.length).length;
let done = 0;
let failed = 0;
const samples = [];
const started = Date.now();
const concurrency = 4;

for (let index = 0; index < keys.length; index += concurrency) {
  const batch = keys.slice(index, index + concurrency);
  await Promise.all(
    batch.map(async (key) => {
      const query = lookupForm(termByKey.get(key) ?? key);
      const raw = await triggerCandidates(query);
      // Không gọi được thì giữ nguyên dữ liệu cũ, đừng xoá trắng.
      if (raw === null) {
        failed += 1;
        return;
      }
      const entry = store[key];
      const synonyms = entry.synonyms ?? [];
      const antonyms = entry.antonyms ?? [];
      const next = topicalWords(raw, query, 12)
        .filter((word) => !synonyms.includes(word) && !antonyms.includes(word))
        .slice(0, 6);
      // Từ hẹp nghĩa (trái cây, rau củ) hay bị lọc sạch — mượn thêm từ cùng folder.
      const item = itemByKey.get(key);
      const folder = folderByTopic.get(item?.topic) ?? [];
      if (next.length < MIN_SUGGESTIONS && folder.length > 1)
        next.push(...topicNeighbours(item?.term ?? key, folder, [...next, ...synonyms, ...antonyms], MIN_SUGGESTIONS - next.length));
      if (samples.length < 12 && (entry.related ?? []).join(",") !== next.join(","))
        samples.push(`  ${key.padEnd(18)} cũ: ${(entry.related ?? []).join(", ") || "—"}\n  ${" ".repeat(18)} mới: ${next.join(", ") || "—"}`);
      entry.related = next;
    }),
  );
  done += batch.length;
  if (done % 80 === 0 || done >= keys.length) {
    const rate = done / ((Date.now() - started) / 1000);
    const remain = Math.round((keys.length - done) / rate);
    console.log(`  ${done}/${keys.length} · còn khoảng ${Math.floor(remain / 60)}p${remain % 60}s`);
    writeFileSync(storeUrl, JSON.stringify(store));
  }
}
writeFileSync(storeUrl, JSON.stringify(store));

const after = keys.filter((key) => store[key].related?.length).length;
console.log(`\nXong. Có từ cùng chủ đề: ${before} → ${after}${failed ? ` · ${failed} từ không gọi được, giữ nguyên` : ""}`);
console.log(`Trung bình mỗi từ: ${(keys.reduce((total, key) => total + (store[key].related?.length ?? 0), 0) / keys.length).toFixed(1)} gợi ý`);
console.log(`\nVài thay đổi tiêu biểu:\n${samples.join("\n")}`);
