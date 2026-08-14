// Sinh sẵn dữ liệu bổ sung cho bộ từ vựng PDF: định nghĩa Anh–Anh, đồng nghĩa,
// trái nghĩa, từ cùng chủ đề và chủ đề IELTS.
//
// Chạy một lần rồi commit kết quả — người dùng không phải tra lại 973 từ trên máy họ.
//     node scripts/enrich-vocabulary.mjs
// Script có thể dừng giữa chừng và chạy lại: từ nào đã có trong file sẽ được bỏ qua.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const vocabularyUrl = new URL("../public/vocabulary-1000.json", import.meta.url);
const areasUrl = new URL("../lib/ielts-areas.json", import.meta.url);
const outputUrl = new URL("../public/vocabulary-enrichment.json", import.meta.url);

const vocabulary = JSON.parse(readFileSync(vocabularyUrl, "utf8"));
const ieltsAreas = JSON.parse(readFileSync(areasUrl, "utf8"));
const store = existsSync(outputUrl) ? JSON.parse(readFileSync(outputUrl, "utf8")) : {};

const keywordPatterns = new Map();
function matchesKeyword(text, key) {
  let pattern = keywordPatterns.get(key);
  if (!pattern) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = key.length >= 5 ? new RegExp(`\\b${escaped}`, "i") : new RegExp(`\\b${escaped}(s|es)?\\b`, "i");
    keywordPatterns.set(key, pattern);
  }
  return pattern.test(text);
}
function ieltsApplications(word, definition, meaningVi, topic, triggers) {
  // Tên folder (ANIMAL, WEATHER…) là tín hiệu mạnh nên gộp vào nhóm trọng số cao.
  const strong = `${word} ${definition} ${meaningVi} ${topic}`;
  const weak = triggers.join(" ");
  const scored = ieltsAreas
    .map(([name, keys]) => ({ name, score: keys.reduce((total, key) => total + (matchesKeyword(strong, key) ? 2 : 0) + (matchesKeyword(weak, key) ? 1 : 0), 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((item) => item.name);
}

function lemmaOf(word) {
  const forms = new Set();
  if (/ies$/.test(word)) forms.add(word.replace(/ies$/, "y"));
  if (/(ses|xes|zes|ches|shes)$/.test(word)) forms.add(word.replace(/es$/, ""));
  if (/s$/.test(word) && !/ss$/.test(word)) forms.add(word.replace(/s$/, ""));
  forms.delete(word);
  return [...forms].filter((item) => item.length >= 3);
}
function uniqueWords(items, source) {
  return [...new Set(items.map((item) => item.trim().toLowerCase()).filter((item) => item && item !== source))].slice(0, 6);
}

async function datamuse(word, relation) {
  try {
    const response = await fetch(`https://api.datamuse.com/words?${relation}=${encodeURIComponent(word)}&max=8`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.map((item) => item.word?.trim() ?? "").filter(Boolean);
  } catch {
    return [];
  }
}
// Từ điển chặn tần suất khi gọi dồn: 404 là không có mục từ, còn 429/5xx thì phải chờ rồi thử lại.
async function definitionOf(word, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      if (response.status === 404) return "";
      if (!response.ok) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        continue;
      }
      const entries = await response.json();
      if (!Array.isArray(entries)) return "";
      const entry = entries.find((item) => item.word?.trim().toLowerCase() === word) ?? entries[0];
      return entry?.meanings?.[0]?.definitions?.[0]?.definition ?? "";
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  return "";
}

// Từ khoá trong file PDF có nhiễu OCR ("white (n, adj)", "bus bicycle") — tra bằng phần sạch.
function lookupForm(term) {
  const cleaned = term.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return cleaned.split("/")[0].trim().split(" ")[0] || cleaned;
}

async function enrich(item) {
  const key = item.term.trim().toLowerCase();
  const query = lookupForm(item.term);
  const [definition, synonymsRaw, antonymsRaw, triggers] = await Promise.all([definitionOf(query), datamuse(query, "rel_syn"), datamuse(query, "rel_ant"), datamuse(query, "rel_trg")]);
  let antonyms = antonymsRaw;
  if (!antonyms.length) {
    for (const form of lemmaOf(query)) {
      antonyms = await datamuse(form, "rel_ant");
      if (antonyms.length) break;
    }
  }
  const synonyms = uniqueWords(synonymsRaw, query);
  const related = uniqueWords(triggers, query).filter((word) => !synonyms.includes(word) && !antonyms.includes(word));
  return {
    key,
    value: {
      definition,
      synonyms,
      antonyms: uniqueWords(antonyms, query),
      related,
      ieltsTopics: ieltsApplications(query, definition, item.meaning, item.topic, triggers),
    },
  };
}

const unique = [];
const seen = new Set();
for (const item of vocabulary) {
  const key = item.term.trim().toLowerCase();
  if (!seen.has(key)) {
    seen.add(key);
    unique.push(item);
  }
}
const pending = unique.filter((item) => !store[item.term.trim().toLowerCase()]);
console.log(`Tổng ${unique.length} từ · đã có ${unique.length - pending.length} · cần xử lý ${pending.length}`);

const concurrency = 4;
let done = 0;
const started = Date.now();
for (let index = 0; index < pending.length; index += concurrency) {
  const batch = pending.slice(index, index + concurrency);
  const results = await Promise.all(batch.map(enrich));
  for (const { key, value } of results) store[key] = value;
  done += batch.length;
  if (done % 40 === 0 || done === pending.length) {
    const rate = done / ((Date.now() - started) / 1000);
    const remain = Math.round((pending.length - done) / rate);
    console.log(`  ${done}/${pending.length} · còn khoảng ${Math.floor(remain / 60)}p${remain % 60}s`);
    writeFileSync(outputUrl, JSON.stringify(store));
  }
}
writeFileSync(outputUrl, JSON.stringify(store));

// Vòng hai: chỉ lấy định nghĩa cho những từ còn trống, chạy chậm hơn để không bị chặn.
const termByKey = new Map(unique.map((item) => [item.term.trim().toLowerCase(), item]));
const missingDefinition = Object.entries(store).filter(([, value]) => !value.definition && !value.definitionChecked);
if (missingDefinition.length) {
  console.log(`\nVòng hai: tra định nghĩa cho ${missingDefinition.length} từ còn trống`);
  let filled = 0;
  for (let index = 0; index < missingDefinition.length; index += 2) {
    const batch = missingDefinition.slice(index, index + 2);
    await Promise.all(
      batch.map(async ([key, value]) => {
        const item = termByKey.get(key);
        const definition = await definitionOf(lookupForm(item?.term ?? key));
        value.definitionChecked = true;
        if (definition) {
          value.definition = definition;
          filled += 1;
        }
        // Chủ đề IELTS luôn tính lại theo bảng nhóm hiện tại.
        value.ieltsTopics = ieltsApplications(lookupForm(item?.term ?? key), value.definition, item?.meaning ?? "", item?.topic ?? "", value.related);
      }),
    );
    if ((index + 2) % 60 === 0) {
      console.log(`  ${Math.min(index + 2, missingDefinition.length)}/${missingDefinition.length} · đã bổ sung ${filled}`);
      writeFileSync(outputUrl, JSON.stringify(store));
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  writeFileSync(outputUrl, JSON.stringify(store));
  console.log(`  bổ sung thêm ${filled} định nghĩa`);
}

// Vòng cuối: tính lại chủ đề IELTS cho mọi từ theo bảng nhóm hiện tại. Không gọi mạng.
for (const [key, value] of Object.entries(store)) {
  const item = termByKey.get(key);
  value.ieltsTopics = ieltsApplications(lookupForm(item?.term ?? key), value.definition ?? "", item?.meaning ?? "", item?.topic ?? "", value.related ?? []);
}
writeFileSync(outputUrl, JSON.stringify(store));

const entries = Object.values(store);
console.log(`\nXong ${Object.keys(store).length} từ`);
console.log(`  có định nghĩa   : ${entries.filter((item) => item.definition).length}`);
console.log(`  có đồng nghĩa   : ${entries.filter((item) => item.synonyms.length).length}`);
console.log(`  có trái nghĩa   : ${entries.filter((item) => item.antonyms.length).length}`);
console.log(`  có từ cùng chủ đề: ${entries.filter((item) => item.related.length).length}`);
console.log(`  có chủ đề IELTS : ${entries.filter((item) => item.ieltsTopics.length).length}`);
