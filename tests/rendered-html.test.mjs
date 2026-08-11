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
  const [page, vocabulary] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/vocabulary-1000.json", import.meta.url), "utf8"),
  ]);
  const items = JSON.parse(vocabulary);
  assert.equal(items.length, 983);
  assert.match(page, /function isPdfVocabulary/);
  assert.match(page, /Thư mục chủ đề/);
  assert.match(page, /Ôn chủ đề này/);
  assert.match(page, /words\.filter\(\(word\) => !isPdfVocabulary\(word\)\)/);
});
