import assert from "node:assert/strict";
import test from "node:test";
import { buildShadowingLessons, minutesOf, paceOf, scoreShadowing, shadowingAdvice } from "../lib/shadowing.mjs";

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

test("buildShadowingLessons: gom các câu cùng bài thành một đoạn", () => {
  const lessons = buildShadowingLessons([
    { id: "a1", topic: "VOA", title: "Welcome!", level: "A1", sentence: "Hi! Are you Anna?", sourceName: "VOA" },
    { id: "a2", topic: "VOA", title: "Welcome!", level: "B1", sentence: "Yes! Hi there!", sourceName: "VOA" },
    { id: "b1", topic: "Du lịch", title: "Nhà ga", level: "A1", sentence: "The train leaves." },
  ]);
  assert.equal(lessons.length, 2);
  assert.equal(lessons[0].lines.length, 2);
  // Trình độ cả bài lấy theo câu khó nhất, nếu không người học chọn A1 lại gặp câu B1.
  assert.equal(lessons[0].level, "B1");
  assert.equal(lessons[0].sourceName, "VOA");
});

test("minutesOf: một lượt ngắn vẫn được ghi nhận là một phút", () => {
  assert.equal(minutesOf(12), 1);
  assert.equal(minutesOf(90), 2);
  assert.equal(minutesOf(0), 1);
});
