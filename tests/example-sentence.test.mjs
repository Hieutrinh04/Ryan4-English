// Kiểm thử bộ lọc câu ví dụ. Hàm được trích thẳng từ route để bài kiểm thử không
// lệch với mã đang chạy, giống cách làm ở tests/study-logic.test.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/ai/enrich/route.ts", import.meta.url), "utf8");

function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `không tìm thấy hàm ${name}`);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`không tìm được điểm kết thúc của ${name}`);
}

const names = ["isSentenceShape", "isUsableSentence", "sentenceScore", "cleanExample"];
const stripped = names.map(extract).join("\n").replace(/:\s*string/g, "");
const { isSentenceShape, isUsableSentence, sentenceScore, cleanExample } = new Function(`${stripped}; return { ${names.join(", ")} };`)();

test("isUsableSentence: nhận câu thật có chứa từ đang học", () => {
  assert.equal(isUsableSentence("I don't like such sports as boxing and hockey.", "hockey"), true);
  assert.equal(isUsableSentence("Ziri served pancakes with maple syrup.", "maple"), true);
  assert.equal(isUsableSentence("Look in the closet!", "closet"), true);
});

test("isUsableSentence: loại đoạn nhiều câu", () => {
  // Đúng lỗi đã gặp: mục từ điển của "closet" nhét cả hai câu vào một ví dụ.
  const doan = "The ambassador has been closeted with the prime minister. We're all worried what will be announced.";
  assert.equal(isUsableSentence(doan, "closet"), false);
});

test("isUsableSentence: loại câu không chứa từ đang học", () => {
  assert.equal(isUsableSentence("The weather is nice today.", "hockey"), false);
});

test("isUsableSentence: loại mẩu câu cụt và câu quá dài", () => {
  assert.equal(isUsableSentence("a maple tree", "maple"), false, "không viết hoa, không có dấu kết câu");
  assert.equal(isUsableSentence("Maple.", "maple"), false, "quá ngắn");
  assert.equal(isUsableSentence(`Maple ${"very ".repeat(30)}syrup.`, "maple"), false, "quá dài");
});

test("isUsableSentence: khớp cả dạng số nhiều của từ", () => {
  assert.equal(isUsableSentence("Astronauts wear spacesuits every day.", "astronauts"), true);
  assert.equal(isUsableSentence("Lychees taste a lot like grapes.", "lychee"), true);
});

test("sentenceScore: chuộng câu 8–14 chữ", () => {
  const vua = "I don't like such sports as boxing and hockey.";
  const ngan = "That's a maple.";
  assert.ok(sentenceScore(vua) > sentenceScore(ngan));
  assert.equal(sentenceScore("One two three four five six seven eight nine ten."), 3);
  assert.equal(sentenceScore("One two three four five six."), 2);
  assert.equal(sentenceScore("One two three four."), 1);
});

test("isSentenceShape: không đòi câu phải chứa từ đang học", () => {
  // Câu đi kèm một nghĩa trong từ điển vốn thuộc về nghĩa đó và thường dùng dạng gốc:
  // tra "fixed" nhưng câu của nghĩa "triệt sản" lại viết "fix".
  const cauCuaNghia = "Rover stopped digging under the fence after we had the vet fix him.";
  assert.equal(isSentenceShape(cauCuaNghia), true);
  assert.equal(isUsableSentence(cauCuaNghia, "fixed"), false, "bộ lọc kho ngữ liệu vẫn đòi đúng từ");
  assert.equal(isSentenceShape("The ambassador was closeted. We were worried."), false, "vẫn loại đoạn nhiều câu");
});

test("cleanExample: cắt phần trích nguồn phía sau dấu gạch dài", () => {
  assert.equal(cleanExample("She blinked twice. — Some Author"), "She blinked twice.");
  assert.equal(cleanExample("  Look   in the closet!  "), "Look in the closet!");
});
