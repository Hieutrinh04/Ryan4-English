import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { sanitiseVocabularyCard, vocabularyQualityReport } from "../lib/vocabulary-quality.mjs";

const vocabulary = JSON.parse(await readFile(new URL("../public/vocabulary-1000.json", import.meta.url), "utf8"));
const examples = JSON.parse(await readFile(new URL("../public/vocabulary-examples.json", import.meta.url), "utf8"));

test("toàn bộ 983 từ qua kiểm tra cấu trúc trước khi hiển thị", () => {
  const report = vocabularyQualityReport(vocabulary);
  assert.equal(report.total, 983);
  assert.equal(report.valid, report.total, report.malformed.map((word) => word.term).join(", "));
});

test("mọi từ trong bộ PDF đều có câu ví dụ riêng", () => {
  const missing = vocabulary.filter((word) => !examples[word.term.trim().toLowerCase()]);
  assert.deepEqual(missing.map((word) => word.term), []);
});

test("swallow không còn dính chủ đề màu sắc vào IPA", () => {
  const raw = vocabulary.find((word) => word.term === "swallow");
  const word = sanitiseVocabularyCard(raw);
  assert.equal(word.ipa, "/ˈswɑː.loʊ/");
  assert.equal(word.meaning, "chim nhạn, én");
  assert.equal(word.topic, "ANIMAL - ĐỘNG VẬT");
});

test("tên từ, loại từ và số chú thích PDF được tách đúng", () => {
  const color = sanitiseVocabularyCard(vocabulary.find((word) => word.term.startsWith("white")));
  const daughter = sanitiseVocabularyCard(vocabulary.find((word) => word.term === "daughter"));
  const roll = sanitiseVocabularyCard(vocabulary.find((word) => word.term.startsWith("roll VEHICLES")));
  assert.deepEqual([color.term, color.partOfSpeech], ["white", "n, adj"]);
  assert.equal(daughter.meaning, "con gái");
  assert.deepEqual([roll.term, roll.ipa], ["roll", "/roʊl/"]);
});
