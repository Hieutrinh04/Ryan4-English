// Kiểm thử phần chấm bài dịch Việt → Anh.
// Ca mẫu lấy đúng tình huống trong ảnh người dùng gửi: "Lila ngồi một mình ở góc
// thư viện." với câu mẫu "Lila sat alone in the corner of the library."
import assert from "node:assert/strict";
import test from "node:test";
import { alignTokens, baseForm, buildPassages, gradeTranslation, isMetaSentence, notesFor, themeOf, tokenize } from "../lib/translation-check.mjs";

const REFERENCE = "Lila sat alone in the corner of the library.";

test("baseForm: gộp các dạng của cùng một từ", () => {
  assert.equal(baseForm("sat"), baseForm("sit"));
  assert.equal(baseForm("went"), baseForm("go"));
  assert.equal(baseForm("libraries"), baseForm("library"));
  assert.equal(baseForm("walked"), baseForm("walk"));
  assert.equal(baseForm("stopped"), baseForm("stop"));
  assert.notEqual(baseForm("sit"), baseForm("set"));
});

test("tokenize: bỏ dấu câu, giữ dấu nháy", () => {
  assert.deepEqual(tokenize("Don't go!"), ["don't", "go"]);
  assert.deepEqual(tokenize("  A  b. "), ["a", "b"]);
});

test("gradeTranslation: câu trùng câu mẫu thì đạt 100%", () => {
  const result = gradeTranslation(REFERENCE, "Lila sat alone in the corner of the library.", "sit");
  assert.equal(result.accuracy, 100);
  assert.equal(result.matchesReference, true);
  assert.equal(result.verdict, "perfect");
  assert.deepEqual(result.notes, []);
});

test("gradeTranslation: bắt sai thì của động từ", () => {
  const result = gradeTranslation(REFERENCE, "Lila sit alone in the corner of the library.", "sit");
  const form = result.notes.find((item) => item.kind === "form");
  assert.ok(form, "phải có nhận xét về dạng từ");
  assert.match(form.text, /sit/);
  assert.match(form.text, /sat/);
  assert.equal(result.verdict, "errors");
});

test("gradeTranslation: bắt thiếu mạo từ và thiếu giới từ", () => {
  // Đúng lỗi trong ảnh: viết "at library" thay vì "in the corner of the library".
  const result = gradeTranslation(REFERENCE, "Lila sat alone at library.", "sit");
  const article = result.notes.find((item) => item.kind === "article");
  const preposition = result.notes.find((item) => item.kind === "preposition");
  assert.ok(article, "phải báo thiếu mạo từ the");
  assert.match(article.text, /the/);
  assert.ok(preposition, "phải báo thiếu giới từ in/of");
  assert.ok(result.accuracy < 100);
});

test("gradeTranslation: nhắc khi câu chưa dùng từ đang học", () => {
  const result = gradeTranslation("She blinked twice.", "She closed her eyes twice.", "blink");
  const target = result.notes.find((item) => item.kind === "target");
  assert.ok(target);
  assert.match(target.text, /blink/);
});

test("gradeTranslation: dùng đúng từ đang học ở dạng khác thì không nhắc", () => {
  const result = gradeTranslation("She blinked twice.", "She blinks twice.", "blink");
  assert.equal(result.notes.find((item) => item.kind === "target"), undefined);
});

test("gradeTranslation: viết thừa cũng bị trừ điểm", () => {
  const ngan = gradeTranslation("She blinked twice.", "She blinked twice.", "blink");
  const dai = gradeTranslation("She blinked twice.", "She blinked twice very quickly indeed today.", "blink");
  assert.equal(ngan.accuracy, 100);
  assert.ok(dai.accuracy < 100, "câu thừa từ không được vẫn 100%");
  assert.ok(dai.notes.some((item) => /thêm/.test(item.text)));
});

test("alignTokens: lệch một từ ở đầu không làm hỏng phần còn lại", () => {
  // So theo vị trí thì thêm một từ ở đầu sẽ đẩy lệch hết; so khớp dài nhất thì không.
  const operations = alignTokens(tokenize("the cat sat on the mat"), tokenize("well the cat sat on the mat"));
  assert.equal(operations.filter((item) => item.type === "same").length, 6);
  assert.equal(operations.filter((item) => item.type === "extra").length, 1);
});

test("notesFor: khác biệt không chắc chắn chỉ được gọi là khác câu mẫu", () => {
  const operations = alignTokens(tokenize("She is very happy"), tokenize("She is really happy"));
  const notes = notesFor(operations, "happy");
  assert.ok(notes.every((item) => item.kind === "diff"), "không được kết luận là sai ngữ pháp");
});

test("isMetaSentence: loại câu khuôn nói VỀ từ thay vì dùng từ", () => {
  assert.equal(isMetaSentence("Từ “successful” xuất hiện hai lần trong bài đọc hôm nay.", "successful"), true);
  assert.equal(isMetaSentence("Tôi đang học cách dùng từ “trosers” một cách tự nhiên.", "trosers"), true);
  assert.equal(isMetaSentence("Nông dân dùng lưới để bảo vệ mùa màng khỏi côn trùng.", "insects"), false);
  assert.equal(isMetaSentence("Cô ấy cắt quả táo thành tám lát mỏng.", "apple"), false);
});

test("buildPassages: gom theo chủ đề, bỏ câu khuôn, cắt thành đoạn ngắn", () => {
  const tao = (term, topic, vi) => ({ word: { term, topic }, vi, en: `${term} sentence.` });
  const tasks = [
    tao("apple", "FRUIT", "Cô ấy cắt quả táo."),
    tao("dog", "ANIMAL", "Con chó chạy ra sân."),
    tao("pear", "FRUIT", "Quả lê còn cứng."),
    tao("trosers", "CLOTHES", 'Tôi đang học cách dùng từ “trosers” một cách tự nhiên.'),
    tao("cat", "ANIMAL", "Con mèo ngủ trên ghế."),
  ];
  const passages = buildPassages(tasks, { size: 6 });
  assert.equal(passages.length, 2, "hai chủ đề còn lại thành hai đoạn");
  assert.deepEqual(passages.map((item) => item.topic), ["FRUIT", "ANIMAL"]);
  assert.deepEqual(passages[0].tasks.map((item) => item.word.term), ["apple", "pear"]);
  assert.deepEqual(passages[1].tasks.map((item) => item.word.term), ["dog", "cat"]);
  assert.ok(passages.every((item) => item.tasks.every((task) => task.word.term !== "trosers")), "câu khuôn phải bị loại");
});

test("buildPassages: chủ đề dài bị cắt thành nhiều đoạn", () => {
  const tasks = Array.from({ length: 14 }, (_, position) => ({ word: { term: `w${position}`, topic: "FRUIT" }, vi: `Câu số ${position}.`, en: `Sentence ${position}.` }));
  const passages = buildPassages(tasks, { size: 6 });
  assert.deepEqual(passages.map((item) => item.tasks.length), [6, 6, 2]);
});

test("themeOf: xếp câu vào nhóm chủ đề theo từ khoá trong câu tiếng Anh", () => {
  const areas = [
    ["Emergency & Safety", ["rescue", "firefight", "fire", "ambulance"]],
    ["Sport & Leisure", ["baseball", "football", "match"]],
  ];
  assert.equal(themeOf({ word: { term: "rescue" }, en: "Firefighters rescued two children from the burning house." }, areas), "Emergency & Safety");
  assert.equal(themeOf({ word: { term: "baseball" }, en: "Do you play baseball?" }, areas), "Sport & Leisure");
  // Câu không khớp từ khoá nào thì để riêng, không nhét bừa vào một nhóm.
  assert.equal(themeOf({ word: { term: "reluctant" }, en: "I felt reluctant about the decision." }, areas), "Chủ đề chung");
});

test("themeOf: ranh giới từ phải là \b thật, không phải ký tự backspace", () => {
  // Lỗi đã gặp: viết `\b` trong template literal ra ký tự U+0008 nên regex không
  // bao giờ khớp và mọi câu đều rơi vào "Chủ đề chung".
  const areas = [["Animals", ["cat"]]];
  assert.equal(themeOf({ word: { term: "cat" }, en: "The cat sat on the mat." }, areas), "Animals");
  // "cat" nằm giữa từ khác thì không tính, đó là ý nghĩa của ranh giới từ.
  assert.equal(themeOf({ word: { term: "vacated" }, en: "They vacated the building." }, areas), "Chủ đề chung");
});

test("themeOf: ưu tiên chủ đề IELTS đã có sẵn trên từ", () => {
  assert.equal(themeOf({ word: { term: "x", ieltsTopics: ["Environment"] }, en: "Anything." }, [["Animals", ["anything"]]]), "Environment");
});
