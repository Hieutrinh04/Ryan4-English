// Kiểm thử bộ lọc "từ hay đi cùng chủ đề". Dữ liệu mẫu là kết quả thật của Datamuse
// cho "rescue", "baker" và "blink" — chính ba trường hợp gợi ý sai đã gặp.
import assert from "node:assert/strict";
import test from "node:test";
import { rootOf, topicNeighbours, topicalWords } from "../lib/topical-words.mjs";

const rescue = [
  { word: "firefighting", tags: ["n", "f:0.200267"] },
  { word: "downed", tags: ["adj", "f:0.692575"] },
  { word: "lifeboat", tags: ["n", "v", "f:0.501433"] },
  { word: "sar", tags: ["n", "f:1.272023"] },
  { word: "salvage", tags: ["n", "v", "f:2.734978"] },
  { word: "helicopter", tags: ["n", "v", "f:3.321216"] },
  { word: "stranded", tags: ["adj", "f:2.710290"] },
  { word: "trapped", tags: ["adj", "f:7.107586"] },
];

test("topicalWords: bỏ từ hiếm và viết tắt, giữ từ thông dụng", () => {
  const result = topicalWords(rescue, "rescue");
  assert.deepEqual(result, ["salvage", "helicopter", "stranded", "trapped"]);
});

test("topicalWords: bỏ danh từ riêng dù tần suất cao", () => {
  const items = [
    { word: "eminem", tags: ["n", "prop", "f:0.049898"] },
    { word: "aldrin", tags: ["n", "prop", "f:4.5"] },
    { word: "bedroom", tags: ["n", "f:12.198848"] },
  ];
  assert.deepEqual(topicalWords(items, "closet"), ["bedroom"]);
});

test("topicalWords: bỏ biến thể của chính từ đang học và từ trùng gốc", () => {
  const items = [
    { word: "blinking", tags: ["n", "adj", "f:1.538833"] },
    { word: "crops", tags: ["n", "f:17.6"] },
    { word: "crop", tags: ["n", "v", "f:17.5"] },
    { word: "eyelid", tags: ["n", "f:1.522957"] },
  ];
  // "blinking" là dạng của "blink"; "crop" trùng gốc với "crops" đã lấy trước đó.
  assert.deepEqual(topicalWords(items, "blink"), ["crops", "eyelid"]);
});

test("topicalWords: bỏ mục không có nhãn loại từ hoặc không phải một từ đơn", () => {
  const items = [
    { word: "st. john", tags: ["n", "f:9.0"] },
    { word: "3d", tags: ["n", "f:9.0"] },
    { word: "xyz", tags: ["f:9.0"] },
    { word: "shelter", tags: ["n", "f:9.0"] },
  ];
  assert.deepEqual(topicalWords(items, "rescue"), ["shelter"]);
});

test("topicalWords: tôn trọng giới hạn số lượng", () => {
  assert.equal(topicalWords(rescue, "rescue", 2).length, 2);
});

test("rootOf: nhận ra hai từ là biến thể của nhau", () => {
  assert.equal(rootOf("balconies"), rootOf("balcony"));
  assert.equal(rootOf("blinking"), rootOf("blink"));
  assert.equal(rootOf("crops"), rootOf("crop"));
  assert.equal(rootOf("rescued"), rootOf("rescue"));
  assert.equal(rootOf("volcanoes"), rootOf("volcano"));
  assert.notEqual(rootOf("meat"), rootOf("knife"));
});

test("topicNeighbours: mượn từ cùng folder, gần nhất trước, không trùng", () => {
  const folder = [
    { term: "apple", number: 1 },
    { term: "banana", number: 2 },
    { term: "pear", number: 3 },
    { term: "grape", number: 4 },
    { term: "starfruit (n)", number: 5 },
  ];
  assert.deepEqual(topicNeighbours("banana", folder, [], 3), ["apple", "pear", "grape"]);
  // Nhiễu OCR trong tên folder được gỡ, và từ đã có thì không lấy lại.
  assert.deepEqual(topicNeighbours("grape", folder, ["pear"], 2), ["starfruit", "banana"]);
  assert.deepEqual(topicNeighbours("apple", folder, [], 0), []);
});
