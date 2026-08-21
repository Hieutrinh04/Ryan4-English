import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { groupByLesson, isSaved, makeSaved, readSaved, removeSentence, saveSentence, savedKey, sentenceKey, toggleSentence } =
  await import("../lib/saved-sentences.mjs");

const cau = (extra = {}) =>
  makeSaved({ lessonId: "yt-abc", lessonTitle: "Bài thử", index: 1, start: 3, text: "How are you?", translation: "Bạn khỏe không?", ...extra });

test("sentenceKey: cùng bài cùng vị trí là một câu", () => {
  assert.equal(sentenceKey("yt-abc", 2), "yt-abc#2");
  assert.notEqual(sentenceKey("yt-abc", 2), sentenceKey("yt-xyz", 2));
  assert.equal(sentenceKey(undefined, undefined), "#0");
});

test("makeSaved: làm sạch dữ liệu vào", () => {
  const item = cau();
  assert.equal(item.key, "yt-abc#1");
  assert.equal(item.text, "How are you?");
  assert.ok(item.at);
  // Số câu vô lý quy về 0 chứ không để lọt số âm hay số lẻ.
  assert.equal(makeSaved({ index: -3 }).index, 0);
  assert.equal(makeSaved({ index: 1.7 }).index, 0);
  assert.equal(makeSaved({ start: "abc" }).start, 0);
});

test("makeSaved: cắt chữ quá dài để không phình localStorage", () => {
  const item = makeSaved({ lessonId: "a", index: 1, text: "x".repeat(900) });
  assert.equal(item.text.length, 400);
});

test("lưu và đọc lại, câu mới lên đầu", () => {
  store.clear();
  saveSentence(cau({ index: 1, text: "Câu một" }));
  saveSentence(cau({ index: 2, text: "Câu hai" }));
  const list = readSaved();
  assert.equal(list.length, 2);
  assert.equal(list[0].text, "Câu hai");
});

test("lưu lại câu đã có thì đẩy lên đầu, không tạo bản trùng", () => {
  store.clear();
  saveSentence(cau({ index: 1, text: "Câu một" }));
  saveSentence(cau({ index: 2, text: "Câu hai" }));
  saveSentence(cau({ index: 1, text: "Câu một" }));
  const list = readSaved();
  assert.equal(list.length, 2);
  assert.equal(list[0].index, 1);
});

test("câu rỗng không được lưu", () => {
  store.clear();
  saveSentence(makeSaved({ lessonId: "a", index: 1, text: "   " }));
  assert.deepEqual(readSaved(), []);
});

test("toggleSentence: bấm lần nữa thì bỏ lưu", () => {
  store.clear();
  const item = cau();
  toggleSentence(item);
  assert.equal(readSaved().length, 1);
  toggleSentence(item);
  assert.deepEqual(readSaved(), []);
});

test("isSaved: nhận ra câu đã lưu của đúng bài", () => {
  const list = [cau({ index: 4 })];
  assert.equal(isSaved(list, "yt-abc", 4), true);
  assert.equal(isSaved(list, "yt-abc", 5), false);
  assert.equal(isSaved(list, "yt-khac", 4), false);
  assert.equal(isSaved(null, "yt-abc", 4), false);
});

test("removeSentence: chỉ xoá đúng câu được chỉ", () => {
  store.clear();
  saveSentence(cau({ index: 1 }));
  saveSentence(cau({ index: 2 }));
  removeSentence("yt-abc#1");
  assert.deepEqual(readSaved().map((item) => item.index), [2]);
});

test("chỉ giữ tối đa 300 câu, câu cũ nhất rơi ra", () => {
  store.clear();
  for (let index = 1; index <= 310; index += 1) saveSentence(cau({ index, text: `Câu ${index}` }));
  const list = readSaved();
  assert.equal(list.length, 300);
  assert.equal(list[0].index, 310);
  assert.equal(list.some((item) => item.index === 1), false);
});

test("dữ liệu hỏng trong localStorage không làm sập phần đọc", () => {
  store.clear();
  store.set(savedKey, "{không phải JSON");
  assert.deepEqual(readSaved(), []);
  store.set(savedKey, '{"a":1}');
  assert.deepEqual(readSaved(), []);
});

test("groupByLesson: gom theo bài, trong bài xếp theo số câu", () => {
  const groups = groupByLesson([
    cau({ index: 5, text: "năm" }),
    cau({ index: 2, text: "hai" }),
    cau({ lessonId: "yt-xyz", lessonTitle: "Bài khác", index: 1, text: "khác" }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, "Bài thử");
  assert.deepEqual(groups[0].items.map((item) => item.index), [2, 5]);
  assert.equal(groups[1].items.length, 1);
});

test("groupByLesson: dữ liệu sai kiểu trả về danh sách rỗng", () => {
  assert.deepEqual(groupByLesson(null), []);
  assert.deepEqual(groupByLesson([null, {}]), []);
});
