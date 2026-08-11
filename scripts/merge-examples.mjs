// Gộp một lô câu ví dụ vào public/vocabulary-examples.json rồi báo cáo độ phủ.
// Dùng: node scripts/merge-examples.mjs <đường-dẫn-lô.json>
// Lô có dạng { "term": ["English sentence.", "Câu tiếng Việt."] }
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const target = new URL("../public/vocabulary-examples.json", import.meta.url);
const vocabulary = JSON.parse(readFileSync(new URL("../public/vocabulary-1000.json", import.meta.url), "utf8"));
const store = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : {};

const batchPath = process.argv[2];
if (batchPath) {
  const batch = JSON.parse(readFileSync(batchPath, "utf8"));
  for (const [term, pair] of Object.entries(batch)) {
    const key = term.trim().toLowerCase();
    if (!Array.isArray(pair) || pair.length !== 2 || !pair[0]?.trim() || !pair[1]?.trim()) throw new Error(`Cặp câu không hợp lệ cho "${term}"`);
    store[key] = [pair[0].trim(), pair[1].trim()];
  }
  writeFileSync(target, JSON.stringify(store, null, 0) + "\n");
}

const terms = [...new Set(vocabulary.map((item) => item.term.trim().toLowerCase()))];
const missing = terms.filter((term) => !store[term]);
const seen = new Map();
for (const [term, [en]] of Object.entries(store)) {
  const key = en.toLowerCase();
  seen.set(key, [...(seen.get(key) ?? []), term]);
}
const duplicates = [...seen.values()].filter((list) => list.length > 1);
const notContaining = Object.entries(store).filter(([term, [en]]) => !en.toLowerCase().includes(term.split("/")[0].trim().split(" ")[0]));

console.log(`Đã có: ${terms.length - missing.length}/${terms.length} từ`);
console.log(`Còn thiếu: ${missing.length}`);
if (duplicates.length) console.log(`⚠ Câu tiếng Anh bị trùng: ${duplicates.length} nhóm →`, duplicates.slice(0, 5));
if (notContaining.length) console.log(`⚠ Câu không chứa từ đang học: ${notContaining.length} →`, notContaining.slice(0, 5).map(([t]) => t));
if (missing.length) console.log("Thiếu (20 từ đầu):", missing.slice(0, 20).join(", "));
