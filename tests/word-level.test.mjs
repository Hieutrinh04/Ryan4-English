import test from "node:test";
import assert from "node:assert/strict";
import {
  bandGap,
  countSyllables,
  estimateCefr,
  frequencyFromTags,
  higherBandWords,
  levelFromFrequency,
} from "../lib/word-level.mjs";

test("estimateCefr: từ lõi lấy đúng bậc Oxford, không cần tần suất", () => {
  assert.deepEqual(estimateCefr("house"), { level: "A1", source: "oxford" });
  assert.deepEqual(estimateCefr("certificate"), { level: "B2", source: "oxford" });
  assert.equal(estimateCefr("obtain").level, "B2");
});

test("estimateCefr: dạng chia vẫn tra được về dạng gốc", () => {
  assert.equal(estimateCefr("certificates").source, "oxford");
  assert.equal(estimateCefr("obtaining").level, "B2");
});

test("estimateCefr: từ ngoài Oxford 5000 thì ước lượng theo tần suất", () => {
  const rare = estimateCefr("credential", 0.37);
  assert.equal(rare.source, "frequency");
  assert.ok(["C1", "C2"].includes(rare.level));
  const common = estimateCefr("zzznotaword", 400);
  assert.equal(common.level, "A1");
});

test("estimateCefr: không có tần suất và không nằm trong danh sách → null", () => {
  assert.equal(estimateCefr("credential"), null);
  assert.equal(estimateCefr("!!!"), null);
  assert.equal(estimateCefr(""), null);
});

test("levelFromFrequency: từ nhiều âm tiết được nâng bậc dù tần suất cao", () => {
  assert.equal(levelFromFrequency(200, "cat"), "A1");
  assert.equal(levelFromFrequency(200, "opportunity"), "A2");
  assert.equal(levelFromFrequency(0.1, "whatever"), "C2");
});

test("countSyllables đếm cụm nguyên âm", () => {
  assert.equal(countSyllables("cat"), 1);
  assert.equal(countSyllables("water"), 2);
  assert.equal(countSyllables("opportunity"), 5);
});

test("bandGap: dương khi bậc sau cao hơn", () => {
  assert.equal(bandGap("A2", "B2"), 2);
  assert.equal(bandGap("B1", "A1"), -2);
  assert.equal(bandGap("B1", "xx"), 0);
});

test("higherBandWords: giữ từ bậc cao hơn, sắp theo mức nâng cấp, bỏ trùng", () => {
  const out = higherBandWords("A2", 100, [
    { word: "big", level: "A1", freq: 90 },
    { word: "obtain", level: "B2", freq: 40 },
    { word: "get", level: "A2", freq: 400 },
    { word: "acquire", level: "C1", freq: 12 },
    { word: "obtain", level: "B2", freq: 40 },
    { word: "grasp", level: "B1", freq: 8 },
  ]);
  // acquire (C1) và obtain (B2) là nâng cấp rõ nhất; big/get bị loại (thấp/bằng bậc, không hiếm hơn).
  assert.deepEqual(out.map((item) => item.word), ["acquire", "obtain", "grasp"]);
});

test("higherBandWords: cùng bậc nhưng hiếm hơn hẳn vẫn được coi là nâng cấp", () => {
  const out = higherBandWords("B1", 50, [
    { word: "common-syn", level: "B1", freq: 80 },
    { word: "rare-syn", level: "B1", freq: 5 },
  ]);
  assert.deepEqual(out.map((item) => item.word), ["rare-syn"]);
});

test("higherBandWords: không có tần suất thì chỉ xét bậc CEFR", () => {
  const out = higherBandWords("A2", NaN, [
    { word: "lower", level: "A1" },
    { word: "higher", level: "B2" },
  ]);
  assert.deepEqual(out.map((item) => item.word), ["higher"]);
});

test("frequencyFromTags rút số f:", () => {
  assert.equal(frequencyFromTags(["n", "f:8.86"]), 8.86);
  assert.ok(Number.isNaN(frequencyFromTags(["n"])));
});
