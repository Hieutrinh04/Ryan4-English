import test from "node:test";
import assert from "node:assert/strict";
import { parseLine, parsePaste } from "../lib/paste-parse.mjs";

test("tách được từ, loại từ và nghĩa", () => {
  assert.deepEqual(parseLine("resilient (adj): kiên cường"),
    { term: "resilient", partOfSpeech: "adj", meaning: "kiên cường" });
  assert.deepEqual(parseLine("mitigate (v): giảm nhẹ"),
    { term: "mitigate", partOfSpeech: "v", meaning: "giảm nhẹ" });
});

test("không có loại từ vẫn tách được nghĩa", () => {
  assert.deepEqual(parseLine("leadership skills: kỹ năng lãnh đạo"),
    { term: "leadership skills", partOfSpeech: "", meaning: "kỹ năng lãnh đạo" });
});

test("chỉ có mỗi từ thì nghĩa để trống, không bịa", () => {
  assert.deepEqual(parseLine("workshop"), { term: "workshop", partOfSpeech: "", meaning: "" });
});

test("dấu gạch chéo không phải dấu tách", () => {
  // Gợi ý ngay trên ô nhập nói rõ giữ nguyên dạng này.
  assert.deepEqual(parseLine("shopping cart / trolley"),
    { term: "shopping cart / trolley", partOfSpeech: "", meaning: "" });
});

test("bỏ dấu đầu dòng của danh sách", () => {
  assert.equal(parseLine("- resilient: kiên cường").term, "resilient");
  assert.equal(parseLine("1. resilient: kiên cường").term, "resilient");
  assert.equal(parseLine("• resilient: kiên cường").term, "resilient");
});

test("nhận cả gạch ngang dài và tab làm dấu tách", () => {
  assert.equal(parseLine("resilient – kiên cường").meaning, "kiên cường");
  assert.equal(parseLine("resilient\tkiên cường").meaning, "kiên cường");
});

test("dấu hai chấm ngay đầu dòng không tính là dấu tách", () => {
  assert.equal(parseLine(": kiên cường").term, ": kiên cường");
});

test("bỏ dòng rỗng và mục trùng trong cùng khối", () => {
  const items = parsePaste("resilient: kiên cường\n\nRESILIENT: khác\nmitigate: giảm nhẹ");
  assert.deepEqual(items.map((item) => item.term), ["resilient", "mitigate"]);
});

test("tôn trọng trần số mục", () => {
  const text = Array.from({ length: 300 }, (_, i) => `word${i}: nghĩa`).join("\n");
  assert.equal(parsePaste(text, 200).length, 200);
});
