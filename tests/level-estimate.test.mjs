import assert from "node:assert/strict";
import test from "node:test";

import { LEVELS, estimateLevel, lessonLevel, matchesLevel, textMetrics } from "../lib/level-estimate.mjs";

test("textMetrics: đếm từ, câu và tỉ lệ từ dài", () => {
  const metrics = textMetrics("I go home. She reads books every single evening.");
  assert.equal(metrics.sentences, 2);
  assert.equal(metrics.words, 9);
  assert.equal(metrics.wordsPerSentence, 4.5);
});

test("textMetrics: không có dấu kết câu thì cả đoạn tính là một câu", () => {
  const metrics = textMetrics("one two three four five");
  assert.equal(metrics.sentences, 1);
  assert.equal(metrics.wordsPerSentence, 5);
});

test("textMetrics: đoạn rỗng trả về số 0, không phải NaN", () => {
  for (const input of ["", "   ", null, undefined]) {
    assert.deepEqual(textMetrics(input), { words: 0, sentences: 0, wordsPerSentence: 0, longShare: 0 });
  }
});

test("estimateLevel: câu ngắn từ ngắn ra bậc thấp", () => {
  const de = "I get up. I eat rice. I go to school. My mum works. We play ball. The dog runs fast. I like it.";
  assert.equal(estimateLevel(de), "A1");
});

test("estimateLevel: câu dài và nhiều từ dài ra bậc cao", () => {
  const kho =
    "The unprecedented environmental transformation currently affecting metropolitan infrastructure demonstrates considerable " +
    "institutional vulnerability, particularly when governmental organisations underestimate technological interdependencies " +
    "throughout international manufacturing establishments.";
  assert.ok(["B2", "C1"].includes(estimateLevel(kho)), `nhận: ${estimateLevel(kho)}`);
});

test("estimateLevel: lấy bậc cao hơn trong hai dấu hiệu", () => {
  // Câu rất ngắn nhưng toàn từ chuyên ngành: vẫn phải bị coi là khó.
  const nganMaKho =
    "Photosynthesis matters. Biodiversity decreases. Infrastructure deteriorates. Institutions collaborate. " +
    "Technologies accelerate. Manufacturing establishments consolidate. Environmental organisations coordinate. " +
    "Interdependencies multiply. Vulnerabilities accumulate. Transformations continue.";
  const level = estimateLevel(nganMaKho);
  assert.ok(LEVELS.indexOf(level) >= LEVELS.indexOf("B1"), `chấm quá dễ: ${level}`);
});

test("estimateLevel: quá ít chữ thì nói không biết, không đoán liều", () => {
  assert.equal(estimateLevel("Hello there."), null);
  assert.equal(estimateLevel(""), null);
  assert.equal(estimateLevel(null), null);
});

test("lessonLevel: tính trên toàn bộ lời thoại của bài", () => {
  const bai = {
    sentences: Array.from({ length: 6 }, () => ({ text: "I go to the shop and buy some bread." })),
  };
  assert.ok(LEVELS.includes(lessonLevel(bai)));
  assert.equal(lessonLevel({ sentences: [] }), null);
  assert.equal(lessonLevel(null), null);
});

test("matchesLevel: không lọc thì nhận hết, có lọc thì phải khớp", () => {
  assert.equal(matchesLevel("B1", ""), true);
  assert.equal(matchesLevel("B1", "B1"), true);
  assert.equal(matchesLevel("B1", "A2"), false);
  // Bài chưa đo được trình độ thì không lọt bộ lọc theo mức.
  assert.equal(matchesLevel(null, "A1"), false);
  assert.equal(matchesLevel(null, ""), true);
});
