import assert from "node:assert/strict";
import test from "node:test";
import { paceOf, scoreShadowing, shadowingAdvice } from "../lib/shadowing.mjs";

test("nói đúng nguyên câu thì độ rõ lời đạt 100", () => {
  const result = scoreShadowing("The train leaves the station.", "the train leaves the station");
  assert.equal(result.clarity, 100);
  assert.deepEqual(result.missed, []);
  assert.deepEqual(result.swallowed, []);
});

test("dấu câu và chữ hoa không ảnh hưởng kết quả", () => {
  assert.equal(scoreShadowing("Hi! Are you Anna?", "hi are you anna").clarity, 100);
});

test("nuốt phụ âm cuối được nhận ra là sai đuôi, không phải mất từ", () => {
  const result = scoreShadowing("She works in a busy office.", "she work in a busy office");
  assert.deepEqual(result.swallowed, ["works"]);
  assert.deepEqual(result.missed, []);
  // Sai đuôi tính nửa điểm nên vẫn cao, nhưng không thể là 100.
  assert.ok(result.clarity > 80 && result.clarity < 100, `độ rõ lời bất thường: ${result.clarity}`);
});

test("bỏ hẳn một từ bị tính là chưa nghe ra", () => {
  const result = scoreShadowing("We booked a small hotel near the center.", "we booked a hotel near the center");
  assert.deepEqual(result.missed, ["small"]);
});

test("từ máy nghe thêm không bị trừ vào độ rõ lời", () => {
  const clean = scoreShadowing("My phone needs to charge.", "my phone needs to charge");
  const noisy = scoreShadowing("My phone needs to charge.", "um my phone needs to charge you know");
  assert.equal(noisy.clarity, clean.clarity);
  assert.ok(noisy.extra.length > 0);
});

test("không nói gì thì độ rõ lời bằng 0 và mọi từ đều chưa nghe ra", () => {
  const result = scoreShadowing("A small cat waited quietly.", "");
  assert.equal(result.clarity, 0);
  assert.equal(result.spokenCount, 0);
  assert.equal(result.missed.length, 5);
});

test("paceOf: phân loại tốc độ nói theo số từ mỗi phút", () => {
  assert.equal(paceOf(9, 4).verdict, "good");
  assert.equal(paceOf(9, 10).verdict, "slow");
  assert.equal(paceOf(9, 2).verdict, "fast");
  assert.equal(paceOf(9, 0).verdict, "unknown");
  assert.equal(paceOf(9, 4).wpm, 135);
});

test("lời khuyên chỉ ra đúng từ bị nuốt đuôi và giải thích hậu quả", () => {
  const result = scoreShadowing("She works in a busy office.", "she work in a busy office");
  const notes = shadowingAdvice(result, paceOf(6, 3));
  const text = notes.map((note) => note.text).join(" ");
  assert.match(text, /works/);
  assert.match(text, /mất số nhiều|mất thì/);
});

test("không thu được tiếng nào thì báo kiểm tra micro, không phán là nói sai", () => {
  const notes = shadowingAdvice(scoreShadowing("Hello there.", ""), paceOf(2, 0));
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /micro/);
});

test("luôn kèm câu nói rõ máy không chấm được giọng", () => {
  const notes = shadowingAdvice(scoreShadowing("Hello there.", "hello there"), paceOf(2, 1));
  assert.match(notes.map((note) => note.text).join(" "), /không chấm được giọng/);
});

test("marks: giữ nguyên thứ tự nói, từ thừa nằm đúng chỗ nó chen vào", () => {
  // Người học nói thừa "feature" giữa câu — phải thấy nó nằm ngay chỗ đó, chứ
  // dồn xuống cuối thì không hiểu vì sao câu bị sai.
  const result = scoreShadowing("episode is all about films", "episode feature is about films");
  assert.deepEqual(
    result.marks.map((mark) => `${mark.word}:${mark.status}`),
    ["episode:ok", "feature:extra", "is:ok", "all:missed", "about:ok", "films:ok"],
  );
  // words chỉ chứa từ của câu mẫu, không lẫn từ thừa vào phép chấm.
  assert.equal(result.words.length, 5);
  assert.deepEqual(result.extra, ["feature"]);
});

test("marks: câu mẫu rỗng trả về danh sách rỗng chứ không phải undefined", () => {
  assert.deepEqual(scoreShadowing("", "gì đó").marks, []);
});

test("marks: từ nói sai giữ lại chữ máy đã nghe để hiện khi rê chuột", () => {
  const result = scoreShadowing("do you go skateboarding", "do you go spike");
  const wrong = result.marks.find((mark) => mark.word === "skateboarding");
  assert.equal(wrong.status, "missed");
  assert.equal(wrong.heard, "spike");
});
