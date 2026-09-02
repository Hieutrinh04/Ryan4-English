import test from "node:test";
import assert from "node:assert/strict";
import { lemmaCandidates, sensesFromDatamuse } from "../lib/dictionary-fallback.mjs";

test("tra dạng số nhiều sẽ thử lại dạng gốc", () => {
  assert.ok(lemmaCandidates("layoffs").includes("layoff"));
  assert.ok(lemmaCandidates("libraries").includes("library"));
});

test("kết quả Datamuse được đổi thành nghĩa dùng được trong ô tra", () => {
  const result = sensesFromDatamuse([{
    word: "layoffs",
    tags: ["n", "pron:L EY1 AO0 F S "],
    defs: ["n\tA dismissal of employees because of a shortage of work."],
  }], "layoffs");
  // Datamuse trả ARPABET; ô tra phải hiện IPA đọc được, không phải "L EY1 AO0 F S".
  assert.match(result.ipa, /^\/[^A-Z\d]+\/$/, `phải là IPA thường: ${result.ipa}`);
  assert.ok(result.ipa.includes("ˈ"), "có dấu trọng âm chính");
  assert.equal(result.senses[0].part, "noun");
  assert.match(result.senses[0].definition, /dismissal/);
});

test("kết quả rỗng không tạo nghĩa giả", () => {
  assert.equal(sensesFromDatamuse([], "unknown"), null);
});
