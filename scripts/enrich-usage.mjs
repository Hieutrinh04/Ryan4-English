// Sinh ngữ cảnh (nghĩa tiếng Việt + câu ví dụ + bản dịch) cho các từ đồng nghĩa và
// trái nghĩa xuất hiện trong bộ từ vựng PDF.
//
// Tra theo TỪ RIÊNG BIỆT chứ không theo từng ô: 7010 ô chỉ gồm 2484 từ khác nhau,
// nên cách này cắt được phần lớn số lần gọi mạng. Kết quả lưu chung một file để
// app tự ghép lại, tránh nhân bản dữ liệu.
//     node scripts/enrich-usage.mjs
// Chạy lại được: từ nào đã có trong file sẽ bỏ qua.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const enrichmentUrl = new URL("../public/vocabulary-enrichment.json", import.meta.url);
const outputUrl = new URL("../public/usage-details.json", import.meta.url);
const enrichment = JSON.parse(readFileSync(enrichmentUrl, "utf8"));
const store = existsSync(outputUrl) ? JSON.parse(readFileSync(outputUrl, "utf8")) : {};

const terms = new Set();
for (const entry of Object.values(enrichment)) {
  for (const term of (entry.synonyms ?? []).slice(0, 4)) terms.add(term);
  for (const term of (entry.antonyms ?? []).slice(0, 4)) terms.add(term);
}

async function withRetry(run, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await run();
    if (result !== null) return result;
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  return null;
}
async function translate(text) {
  const result = await withRetry(async () => {
    try {
      const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(text)}`);
      if (!response.ok) return null;
      const data = await response.json();
      if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
      return data[0].map((part) => (Array.isArray(part) ? (part[0] ?? "") : "")).join("").trim();
    } catch {
      return null;
    }
  });
  return result ?? "";
}
async function dictionary(word) {
  const result = await withRetry(async () => {
    try {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      if (response.status === 404) return [];
      if (!response.ok) return null;
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return null;
    }
  });
  return result ?? [];
}

// Chỉ nhận câu hoàn chỉnh có chứa chính từ đó, giống bộ lọc bên route tra từ.
function pickExample(entries, word) {
  const candidates = entries.flatMap((entry) => (entry.meanings ?? []).flatMap((meaning) => (meaning.definitions ?? []).map((definition) => definition.example ?? "")));
  for (const raw of candidates) {
    if (!raw) continue;
    const text = raw.replace(/\s*[―—–]{1,2}\s*[^.!?]*$/, "").replace(/\s+/g, " ").trim();
    const count = text.split(/\s+/).length;
    if (!/^["'“]?[A-Z]/.test(text) || !/[.!?]["'”]?$/.test(text)) continue;
    if (count < 5 || count > 24) continue;
    if (!text.toLowerCase().includes(word.toLowerCase())) continue;
    return text;
  }
  return "";
}
function fallbackExample(word, part) {
  const capital = word.charAt(0).toUpperCase() + word.slice(1);
  if (part.includes("verb")) return `They decided to ${word} after discussing the problem.`;
  if (part.includes("adjective")) return `The result was ${word} for everyone involved.`;
  return `${capital} played an important role in the situation.`;
}

async function enrich(word) {
  const entries = await dictionary(word);
  const part = entries[0]?.meanings?.[0]?.partOfSpeech ?? "";
  const example = pickExample(entries, word) || fallbackExample(word, part);
  const [meaningVi, exampleVi] = await Promise.all([translate(word), translate(example)]);
  return { meaningVi: meaningVi || "Chưa có bản dịch", example, exampleVi: exampleVi || "Chưa có bản dịch câu." };
}

const pending = [...terms].filter((term) => !store[term]);
console.log(`Tổng ${terms.size} từ riêng biệt · đã có ${terms.size - pending.length} · cần xử lý ${pending.length}`);

const concurrency = 4;
let done = 0;
const started = Date.now();
for (let index = 0; index < pending.length; index += concurrency) {
  const batch = pending.slice(index, index + concurrency);
  const results = await Promise.all(batch.map(async (term) => [term, await enrich(term)]));
  for (const [term, value] of results) store[term] = value;
  done += batch.length;
  if (done % 100 === 0 || done >= pending.length) {
    const rate = done / ((Date.now() - started) / 1000);
    const remain = Math.round((pending.length - done) / rate);
    console.log(`  ${done}/${pending.length} · còn khoảng ${Math.floor(remain / 60)}p${remain % 60}s`);
    writeFileSync(outputUrl, JSON.stringify(store));
  }
}
writeFileSync(outputUrl, JSON.stringify(store));

const values = Object.values(store);
console.log(`\nXong ${values.length} từ`);
console.log(`  dịch được nghĩa : ${values.filter((item) => item.meaningVi !== "Chưa có bản dịch").length}`);
console.log(`  câu ví dụ thật  : ${values.filter((item) => !/played an important role|They decided to|The result was/.test(item.example)).length}`);
console.log(`  dịch được câu   : ${values.filter((item) => item.exampleVi !== "Chưa có bản dịch câu.").length}`);
