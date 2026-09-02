import assert from "node:assert/strict";
import test from "node:test";

import { endsCleanly, groupForPractice, splitForPractice, splitLongText, splitSentences } from "../lib/split-text.mjs";

test("splitSentences: tách theo dấu kết câu", () => {
  assert.deepEqual(splitSentences("Hello there. How are you? Fine!"), ["Hello there.", "How are you?", "Fine!"]);
  assert.deepEqual(splitSentences("Một câu thôi"), ["Một câu thôi"]);
  assert.deepEqual(splitSentences("   "), []);
  assert.deepEqual(splitSentences(null), []);
});

test("splitSentences: dấu nháy đóng sau dấu chấm vẫn thuộc về câu trước", () => {
  assert.deepEqual(splitSentences('He said "stop." Then he left.'), ['He said "stop."', "Then he left."]);
});

test("splitSentences: dấu chấm của chữ viết tắt không phải hết câu", () => {
  assert.deepEqual(splitSentences("Dr. Smith arrived."), ["Dr. Smith arrived."]);
  assert.deepEqual(splitSentences("It costs 5 vs. 6 dollars."), ["It costs 5 vs. 6 dollars."]);
});

test("splitSentences: dấu ba chấm là ý đang tiếp diễn, không cắt thành câu mới", () => {
  assert.deepEqual(
    splitSentences("The first thing I saw was ... Meta laid off 8,000 employees."),
    ["The first thing I saw was ... Meta laid off 8,000 employees."],
  );
  assert.equal(endsCleanly("The first thing I saw was ..."), false);
  assert.equal(endsCleanly("Wait…"), false);
});

test("splitLongText: câu ngắn thì để nguyên", () => {
  assert.deepEqual(splitLongText("Ba từ thôi", 30), ["Ba từ thôi"]);
  assert.deepEqual(splitLongText("", 30), []);
});

test("splitLongText: cắt ở ranh giới mệnh đề chứ không cắt giữa chừng", () => {
  // Đây là lỗi thật: bản cũ cắt đúng sau "in a", để "car" rơi sang mẩu sau.
  const cau = "Many people say they wouldn't feel safe in a car without a human driver, but there are concerns from other road users too";
  const chunks = splitLongText(cau, 16);
  assert.ok(chunks.length >= 2);
  // Mẩu đầu phải kết ở dấu phẩy trước "but", không kết bằng mạo từ.
  assert.ok(chunks[0].endsWith("driver,"), `mẩu đầu kết sai: "${chunks[0]}"`);
  assert.ok(!/\b(a|an|the|in|of|to)$/i.test(chunks[0]), "không được kết bằng từ chức năng");
});

test("splitLongText: ưu tiên dấu chấm phẩy hơn dấu phẩy", () => {
  const cau = "one two three four five, six seven eight; nine ten eleven twelve thirteen fourteen fifteen sixteen";
  const chunks = splitLongText(cau, 12);
  assert.ok(chunks[0].endsWith(";"), `mong đợi ngắt ở dấu chấm phẩy, nhận: "${chunks[0]}"`);
});

test("splitLongText: không có chỗ ngắt nào thì đành cắt theo số từ", () => {
  const cau = Array.from({ length: 25 }, (_, i) => `w${i}`).join(" ");
  const chunks = splitLongText(cau, 10);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].split(" ").length, 10);
});

test("splitLongText: mọi mẩu đều nằm trong giới hạn", () => {
  const cau = "The quick brown fox jumps over the lazy dog, and then it runs away, because the dog barks loudly at night";
  for (const chunk of splitLongText(cau, 12)) {
    assert.ok(chunk.split(/\s+/).length <= 12, `mẩu quá dài: "${chunk}"`);
  }
});

test("splitForPractice: câu trọn vẹn không bao giờ bị gộp hay cắt oan", () => {
  const doan = "Hello, this is 6 Minute English. I'm Phil. And I'm Pippa.";
  assert.deepEqual(splitForPractice(doan, 30), ["Hello, this is 6 Minute English.", "I'm Phil.", "And I'm Pippa."]);
});

test("splitForPractice: chỉ câu dài quá mức mới bị cắt tiếp", () => {
  const doan = "Short one. " + "word ".repeat(40).trim() + ", and more words here.";
  const out = splitForPractice(doan, 20);
  assert.equal(out[0], "Short one.");
  for (const chunk of out) assert.ok(chunk.split(/\s+/).length <= 20);
});

test("endsCleanly: nhận ra đoạn cụt", () => {
  assert.equal(endsCleanly("Trọn vẹn."), true);
  assert.equal(endsCleanly('Có nháy."'), true);
  assert.equal(endsCleanly("Hỏi thế?"), true);
  assert.equal(endsCleanly("cụt ở đây"), false);
  assert.equal(endsCleanly("dừng ở dấu phẩy,"), false);
});

test("groupForPractice: gom câu ngắn nhưng không bao giờ ghép nửa câu", () => {
  const doan = "I usually get up at quarter past six. I often have porridge.";
  assert.deepEqual(groupForPractice(doan, 30, 2), [doan]);
});

test("groupForPractice: dừng gom khi đủ số câu cho phép", () => {
  const doan = "One. Two. Three. Four.";
  assert.deepEqual(groupForPractice(doan, 30, 2), ["One. Two.", "Three. Four."]);
});

test("groupForPractice: mọi mục đều trọn câu hoặc trọn mệnh đề, không kết bằng từ chức năng", () => {
  const doan = "Many people say they wouldn't feel safe in a car without a human driver, but there are concerns from other road users too, and nobody knows the answer yet. How will driverless cars interact with them?";
  const muc = groupForPractice(doan, 20, 2);
  for (const item of muc) {
    assert.ok(item.split(/\s+/).length <= 20, `quá dài: "${item}"`);
    assert.ok(!/\b(a|an|the|in|of|to|for|with)$/i.test(item.trim()), `kết bằng từ chức năng: "${item}"`);
  }
});
