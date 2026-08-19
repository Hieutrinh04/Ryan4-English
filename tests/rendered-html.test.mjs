import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Lexilo application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Lexilo — Học từ vựng thông minh<\/title>/i);
  assert.match(html, /Điều hướng chính/);
  assert.match(html, /Học theo từng ngày/);
  assert.match(html, /Bảng theo dõi Leitner/);
});

test("keeps personal vocabulary and the PDF collection separated", async () => {
  const [page, vocabulary, types] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/vocabulary-1000.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/types.ts", import.meta.url), "utf8"),
  ]);
  const items = JSON.parse(vocabulary);
  assert.equal(items.length, 983);
  // Vị từ này đã chuyển sang lib/types.ts; giao diện chỉ import và dùng.
  assert.match(types, /export function isPdfVocabulary/);
  assert.match(page, /isPdfVocabulary/);
  assert.match(page, /Thư mục học/);
  assert.match(page, /Học folder này/);
  // Điều cần giữ là Practice nhận TOÀN BỘ words, không phải danh sách đã lọc bỏ bộ
  // PDF. Cho phép có thêm prop khác đứng trước (key, intent…) — khớp cứng cả thứ tự
  // prop thì thêm một prop là test đỏ dù ý nghĩa không đổi.
  assert.match(page, /<Practice[^>]*\swords=\{words\}/);
  assert.match(page, /words\.filter\(\(word\) => !isPdfVocabulary\(word\)\)/);
});

test("duplicate-word validation does not reference the lookup-only variable", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = page.lastIndexOf("function submit(e: FormEvent)");
  const end = page.indexOf("  return (", start);
  const submitBody = page.slice(start, end);
  assert.doesNotMatch(submitBody, /\bword\.toLowerCase\(\)/);
  assert.match(submitBody, /if \(duplicate\)/);
});

test("imports the seven weekday workbooks without sheet topics or duplicate terms", async () => {
  const raw = await readFile(new URL("../public/weekly-vocabulary.json", import.meta.url), "utf8");
  const words = JSON.parse(raw);
  assert.equal(words.length, 174);
  assert.deepEqual(
    Array.from({ length: 7 }, (_, studyDay) => words.filter((word) => word.studyDay === studyDay).length),
    [17, 22, 41, 28, 25, 22, 19],
  );
  assert.deepEqual([...new Set(words.map((word) => word.topic))], ["Từ vựng chung"]);
  const normalizedTerms = words.map((word) => word.term.trim().toLowerCase().replace(/\s+/g, " "));
  assert.equal(new Set(normalizedTerms).size, normalizedTerms.length);
  assert.deepEqual(
    [...new Set(words.map((word) => word.source))],
    ["01 Monday.xlsx", "02 Tuesday.xlsx", "03 Wednesday.xlsx", "04 Thursday.xlsx", "05 Friday.xlsx", "06 Saturday.xlsx", "07 Sunday.xlsx"],
  );
});

test("supports pasting a daily vocabulary list with preview and duplicate filtering", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /function BulkAddWords/);
  assert.match(page, /Dán danh sách từ/);
  assert.match(page, /normalizedExisting\.has\(normalized\) \|\| seen\.has\(normalized\)/);
  assert.match(page, /shopping cart \/ trolley/);
  assert.match(page, /studyDay/);
});

test("studies every word when a folder is selected", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = page.indexOf("function buildCollectionQueue");
  const end = page.indexOf("function LearningPlan", start);
  const queueBuilder = page.slice(start, end);
  assert.doesNotMatch(queueBuilder, /\.slice\(/);
  assert.doesNotMatch(queueBuilder, /mastered/);
  assert.match(page, /học toàn bộ trong một phiên/);
});

test("fills Vietnamese meanings for words pasted as a list", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /meaning_vi\?: string/);
  assert.match(page, /meaning: keepText\(word\.meaning, data\.meaning_vi/);
  assert.match(page, /meaning_vi: enriched\.meaning/);
  assert.match(page, /word\.meaning === "Chưa bổ sung nghĩa"/);
});

test("keeps enrichment results when cloud sync fails and accepts slash alternatives", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/enrich/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /fallbackSaveError/);
  assert.doesNotMatch(page.slice(page.indexOf("if (saveError)"), page.indexOf("function resumeSession")), /throw saveError/);
  assert.match(route, /word\.split\("\/"\)\[0\]/);
  assert.match(route, /gạch nối và dấu \//);
});

test("provides unique contextual examples for every weekday vocabulary item", async () => {
  const [vocabularyRaw, examplesRaw, page] = await Promise.all([
    readFile(new URL("../public/weekly-vocabulary.json", import.meta.url), "utf8"),
    readFile(new URL("../public/weekly-examples.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  const vocabulary = JSON.parse(vocabularyRaw);
  const examples = JSON.parse(examplesRaw);
  assert.equal(Object.keys(examples).length, vocabulary.length);
  assert.equal(new Set(Object.values(examples).map(([english]) => english.toLowerCase())).size, vocabulary.length);
  for (const word of vocabulary) {
    const pair = examples[word.term.trim().toLowerCase()];
    assert.ok(pair?.[0]?.trim(), `Missing English example for ${word.term}`);
    assert.ok(pair?.[1]?.trim(), `Missing Vietnamese example for ${word.term}`);
    assert.doesNotMatch(pair[0], /I am learning how to use|The report uses|Our teacher explained|The article shows how|We discussed/);
  }
  assert.match(page, /fetch\("\/weekly-examples\.json"\)/);
  assert.match(page, /example: word\.example, exampleVi: word\.exampleVi, cloze: word\.cloze/);
});

test("paginates large vocabulary folders without limiting study queues", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const PAGE_SIZE = 25/);
  assert.match(page, /const pagedVisible = visible\.slice/);
  assert.match(page, /aria-label="Phân trang từ vựng"/);
  assert.match(page, /Hiển thị \{/);
  const queueStart = page.indexOf("function buildCollectionQueue");
  const queueEnd = page.indexOf("function LearningPlan", queueStart);
  assert.doesNotMatch(page.slice(queueStart, queueEnd), /PAGE_SIZE|\.slice\(/);
});

test("shows Vietnamese meanings and bilingual contexts for related vocabulary", async () => {
  const [page, route, schema] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/enrich/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
  ]);
  assert.match(route, /async function usageDetails/);
  assert.match(route, /synonym_details:synonymDetails/);
  assert.match(route, /antonym_details:antonymDetails/);
  assert.match(route, /related_details:relatedDetails/);
  assert.match(page, /item\.meaningVi/);
  assert.match(page, /item\.exampleVi/);
  assert.match(page, /Bấm “Bổ sung từ thiếu”/);
  assert.match(page, /Ngữ cảnh từ đồng nghĩa/);
  assert.match(page, /Từ hay đi cùng chủ đề/);
  assert.match(page, /usagePreview\("Ngữ cảnh từ cùng chủ đề", relatedDetails\)/);
  assert.match(schema, /synonym_details jsonb/);
});

test("falls back to a second dictionary when adding a common new word", async () => {
  const route = await readFile(new URL("../app/api/ai/enrich/route.ts", import.meta.url), "utf8");
  assert.match(route, /async function lookupDatamuseEntry/);
  assert.match(route, /return lookupDatamuseEntry\(word\)/);
  assert.match(route, /sp=\$\{encodeURIComponent\(word\)\}&md=dpr/);
});
