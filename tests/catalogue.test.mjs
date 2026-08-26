import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { addToCatalogue, catalogueKey, countNew, readCatalogue, removeFromCatalogue, withLessonState } =
  await import("../lib/catalogue.mjs");

const video = (id, extra = {}) => ({ videoId: id.padEnd(11, "x").slice(0, 11), title: `Bài ${id}`, channel: "BBC", seconds: 300, ...extra });

test("thêm video vào danh mục rồi đọc lại", () => {
  store.clear();
  addToCatalogue([video("a"), video("b")]);
  assert.equal(readCatalogue().length, 2);
  assert.equal(readCatalogue()[0].title, "Bài a");
});

test("thêm lại playlist cũ không tạo bản trùng và KHÔNG xáo thứ tự", () => {
  store.clear();
  addToCatalogue([video("a"), video("b")]);
  addToCatalogue([video("b"), video("c")]);
  const list = readCatalogue();
  // Thêm lại cả playlist mà xáo thứ tự thì người học mất dấu chỗ đang học dở.
  assert.deepEqual(list.map((item) => item.title), ["Bài a", "Bài b", "Bài c"]);
});

test("video hỏng không lọt vào danh mục", () => {
  store.clear();
  addToCatalogue([{ videoId: "ngắn", title: "x" }, { videoId: "aaaaaaaaaaa", title: "Private video" }, null]);
  assert.deepEqual(readCatalogue(), []);
});

test("xoá được một video khỏi danh mục", () => {
  store.clear();
  addToCatalogue([video("a"), video("b")]);
  removeFromCatalogue("axxxxxxxxxx");
  assert.deepEqual(readCatalogue().map((item) => item.title), ["Bài b"]);
});

test("dữ liệu hỏng trong localStorage không làm sập phần đọc", () => {
  store.clear();
  store.set(catalogueKey, "{không phải JSON");
  assert.deepEqual(readCatalogue(), []);
  store.set(catalogueKey, JSON.stringify([{ videoId: "aaaaaaaaaaa" }, { title: "thiếu mã" }]));
  assert.deepEqual(readCatalogue(), []);
});

test("countNew: nói trước sẽ thêm bao nhiêu video mới", () => {
  const current = [video("a")];
  assert.equal(countNew([video("a"), video("b"), video("c")], current), 2);
  // Trùng ngay trong lô gửi vào cũng chỉ tính một lần.
  assert.equal(countNew([video("d"), video("d")], current), 1);
  assert.equal(countNew([], current), 0);
  assert.equal(countNew(null, null), 0);
});

test("withLessonState: đánh dấu video đã có phụ đề để mở học ngay", () => {
  const entries = [video("a"), video("b")];
  const marked = withLessonState(entries, [{ videoId: "axxxxxxxxxx" }]);
  assert.equal(marked[0].ready, true);
  assert.equal(marked[1].ready, false);
  assert.deepEqual(withLessonState(null, null), []);
});
