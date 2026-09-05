// Kiểm thử bộ lọc câu ví dụ. Hàm được trích thẳng từ route để bài kiểm thử không
// lệch với mã đang chạy, giống cách làm ở tests/study-logic.test.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { exampleUsesVocabulary, vocabularyForms } from "../lib/example-match.mjs";

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
const { isSentenceShape, isUsableSentence, sentenceScore, cleanExample } = new Function("exampleUsesVocabulary", `${stripped}; return { ${names.join(", ")} };`)(exampleUsesVocabulary);

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

test("isUsableSentence: không nhầm danh từ closets với động từ closeted", () => {
  assert.equal(isUsableSentence("The bedrooms have large closets for winter coats.", "closets", "noun"), true);
  assert.equal(isUsableSentence("The ambassador was closeted with the prime minister all afternoon.", "closets", "noun"), false);
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

// Thẻ "closets" (danh từ số nhiều) từng nhận câu ví dụ dùng "closeted" (động từ,
// nghĩa hoàn toàn khác). Nó lọt vì metadata ghi nhầm partOfSpeech là "verb", và
// bộ so khớp khi đó chia động từ từ MỌI dạng danh từ suy ra được — kể cả dạng số
// ít "closet" — nên "closeted" được coi là hợp lệ.
test("không chấp nhận câu dùng dạng chia của một từ loại khác", () => {
  const sai = "The ambassador has been closeted with the prime minister all afternoon.";
  const dung = "The bedrooms have large closets for winter coats.";

  // Dù metadata ghi nhầm là động từ, thẻ số nhiều vẫn không nhận câu "closeted".
  assert.equal(exampleUsesVocabulary(sai, "closets", "verb"), false);
  assert.equal(exampleUsesVocabulary(dung, "closets", "verb"), true);
  assert.equal(exampleUsesVocabulary(dung, "closets", "noun"), true);

  // Thẻ động từ thật thì vẫn nhận đúng các dạng chia của CHÍNH nó.
  assert.equal(exampleUsesVocabulary(sai, "closet", "verb"), true);
  assert.equal(exampleUsesVocabulary("I am studying English tonight.", "study", "verb"), true);
  assert.equal(exampleUsesVocabulary("He walked home alone.", "walk", "verb"), true);

  // Dạng chia chỉ sinh từ chính chữ đang học, không từ dạng số ít của nó.
  assert.ok(!vocabularyForms("closets", "verb").includes("closeted"));
  assert.ok(vocabularyForms("closet", "verb").includes("closeted"));
});
