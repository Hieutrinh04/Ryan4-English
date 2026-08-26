import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const {
  MAX_FOLDERS,
  addFolder,
  addWords,
  depthOf,
  descendantsOf,
  editFolder,
  emptyStore,
  folderDate,
  folderPath,
  foldersKey,
  foldersOf,
  foldersWithCounts,
  normaliseStore,
  readFolders,
  removeFolder,
  removeWords,
  saveFolders,
  toggleWord,
  wordsIn,
} = await import("../lib/folders.mjs");

const tu = (id) => ({ id, term: id, box: 1, lapses: 0 });
const idOf = (s, name) => s.list.find((item) => item.name === name).id;

test("tạo danh sách có tiêu đề, ghi chú và ngày tạo", () => {
  const after = addFolder(emptyStore(), "  Từ cần   ôn gấp  ", { note: "  Ôn trước kỳ thi  " });
  assert.equal(after.list.length, 1);
  // Khoảng trắng thừa bị gom lại, không để tiêu đề lộn xộn.
  assert.equal(after.list[0].name, "Từ cần ôn gấp");
  assert.equal(after.list[0].note, "Ôn trước kỳ thi");
  assert.equal(after.list[0].parentId, "");
  assert.ok(after.list[0].createdAt);
});

test("không ghi chú thì để trống, không phải undefined", () => {
  assert.equal(addFolder(emptyStore(), "Ôn gấp").list[0].note, "");
});

test("không tạo hai danh sách trùng tên trong cùng một cha", () => {
  let s = addFolder(emptyStore(), "Chuẩn bị thi");
  s = addFolder(s, "chuẩn bị THI");
  assert.equal(s.list.length, 1);
});

test("trùng tên nhưng khác cha thì vẫn tạo được", () => {
  // Đường dẫn đã tách chúng ra, cấm ở đây là cấm thừa.
  let s = addFolder(addFolder(emptyStore(), "Công việc"), "Du lịch");
  s = addFolder(s, "Từ mới", { parentId: idOf(s, "Công việc") });
  s = addFolder(s, "Từ mới", { parentId: idOf(s, "Du lịch") });
  assert.equal(s.list.filter((item) => item.name === "Từ mới").length, 2);
});

test("tên rỗng thì không tạo gì", () => {
  assert.equal(addFolder(emptyStore(), "   ").list.length, 0);
  assert.equal(addFolder(emptyStore(), null).list.length, 0);
});

test("chặn trần số danh sách", () => {
  let s = emptyStore();
  for (let i = 0; i < MAX_FOLDERS + 5; i += 1) s = addFolder(s, `Danh sách ${i}`);
  assert.equal(s.list.length, MAX_FOLDERS);
});

test("cho lồng ba tầng, tầng thứ tư thì chặn", () => {
  let s = addFolder(emptyStore(), "Gốc");
  s = addFolder(s, "Con", { parentId: idOf(s, "Gốc") });
  s = addFolder(s, "Cháu", { parentId: idOf(s, "Con") });
  assert.equal(depthOf(s, idOf(s, "Cháu")), 2);
  // Cháu đã chạm trần, không cho tạo chắt.
  s = addFolder(s, "Chắt", { parentId: idOf(s, "Cháu") });
  assert.equal(s.list.length, 3);
});

test("cha không tồn tại thì danh sách nằm ở gốc", () => {
  const s = addFolder(emptyStore(), "Lạc", { parentId: "khong-co" });
  assert.equal(s.list[0].parentId, "");
});

test("sửa tiêu đề và ghi chú", () => {
  let s = addFolder(addFolder(emptyStore(), "A"), "B");
  const idA = idOf(s, "A");
  s = editFolder(s, idA, { name: "A mới", note: "ghi chú mới" });
  assert.equal(s.list[0].name, "A mới");
  assert.equal(s.list[0].note, "ghi chú mới");
  s = editFolder(s, idA, { name: "B" });
  assert.equal(s.list[0].name, "A mới", "không được trùng tên anh em cùng cha");
});

test("sửa mỗi ghi chú thì giữ nguyên tiêu đề", () => {
  let s = addFolder(emptyStore(), "Ôn gấp", { note: "cũ" });
  s = editFolder(s, s.list[0].id, { note: "mới" });
  assert.equal(s.list[0].name, "Ôn gấp");
  assert.equal(s.list[0].note, "mới");
});

test("một từ nằm được trong nhiều danh sách", () => {
  let s = addFolder(addFolder(emptyStore(), "Ôn gấp"), "Chuẩn bị thi");
  const [a, b] = s.list.map((item) => item.id);
  s = toggleWord(s, a, "w1");
  s = toggleWord(s, b, "w1");
  assert.deepEqual(foldersOf(s, "w1").sort(), [a, b].sort());
});

test("bấm lần nữa thì bỏ từ khỏi danh sách", () => {
  let s = addFolder(emptyStore(), "Ôn gấp");
  const id = s.list[0].id;
  s = toggleWord(s, id, "w1");
  assert.deepEqual(foldersOf(s, "w1"), [id]);
  s = toggleWord(s, id, "w1");
  assert.deepEqual(foldersOf(s, "w1"), []);
});

test("thêm và bỏ hàng loạt, từ đã có không bị lặp", () => {
  let s = addFolder(emptyStore(), "Ôn gấp");
  const id = s.list[0].id;
  s = addWords(s, id, ["w1", "w2"]);
  s = addWords(s, id, ["w2", "w3"]);
  assert.deepEqual(s.members[id], ["w1", "w2", "w3"]);
  s = removeWords(s, id, ["w1", "w3"]);
  assert.deepEqual(s.members[id], ["w2"]);
});

test("thao tác lên danh sách không tồn tại thì không làm gì", () => {
  const s = addFolder(emptyStore(), "Ôn gấp");
  assert.deepEqual(toggleWord(s, "khong-co", "w1"), s);
  assert.deepEqual(addWords(s, "khong-co", ["w1"]), s);
  assert.deepEqual(editFolder(s, "khong-co", { name: "X" }), s);
});

test("xoá danh sách thì xoá luôn danh sách con, KHÔNG đụng tới từ vựng", () => {
  let s = addFolder(emptyStore(), "Gốc");
  const goc = idOf(s, "Gốc");
  s = addFolder(s, "Con", { parentId: goc });
  const con = idOf(s, "Con");
  s = addWords(addWords(s, goc, ["w1"]), con, ["w2"]);
  assert.deepEqual(descendantsOf(s, goc), [con]);
  s = removeFolder(s, goc);
  assert.deepEqual(s.list, []);
  assert.equal(s.members[goc], undefined);
  assert.equal(s.members[con], undefined);
});

test("wordsIn: lấy đúng từ trong danh sách, giữ thứ tự của kho từ", () => {
  let s = addFolder(emptyStore(), "Ôn gấp");
  const id = s.list[0].id;
  s = addWords(s, id, ["w3", "w1"]);
  const words = [tu("w1"), tu("w2"), tu("w3")];
  assert.deepEqual(wordsIn(s, id, words).map((word) => word.id), ["w1", "w3"]);
  assert.deepEqual(wordsIn(s, "khong-co", words), []);
});

test("đếm theo từ CÒN THẬT, không đếm mã của từ đã xoá", () => {
  let s = addFolder(emptyStore(), "Ôn gấp");
  const id = s.list[0].id;
  s = addWords(s, id, ["w1", "w2", "da-xoa"]);
  const counts = foldersWithCounts(s, [tu("w1"), tu("w2")]);
  assert.equal(counts[0].count, 2);
});

test("chỉ liệt kê danh sách con trực tiếp của đúng cha đó", () => {
  let s = addFolder(addFolder(emptyStore(), "Gốc"), "Gốc khác");
  s = addFolder(s, "Con", { parentId: idOf(s, "Gốc") });
  assert.deepEqual(foldersWithCounts(s, []).map((f) => f.name), ["Gốc", "Gốc khác"]);
  const goc = foldersWithCounts(s, [], idOf(s, "Gốc"));
  assert.deepEqual(goc.map((f) => f.name), ["Con"]);
  assert.equal(foldersWithCounts(s, [])[0].childCount, 1);
});

test("folderPath: dựng được đường dẫn từ gốc xuống", () => {
  let s = addFolder(emptyStore(), "Gốc");
  s = addFolder(s, "Con", { parentId: idOf(s, "Gốc") });
  assert.deepEqual(folderPath(s, idOf(s, "Con")).map((f) => f.name), ["Gốc", "Con"]);
  assert.deepEqual(folderPath(s, "khong-co"), []);
});

test("folderDate: viết ngày theo lối Việt", () => {
  assert.equal(folderDate("2026-08-15T09:00:00.000Z"), "15 tháng 8, 2026");
  assert.equal(folderDate("không phải ngày"), "");
  assert.equal(folderDate(null), "");
});

test("dữ liệu hỏng trong máy không làm sập phần đọc", () => {
  store.clear();
  store.set(foldersKey, "{không phải JSON");
  assert.deepEqual(readFolders(), emptyStore());
  store.set(foldersKey, JSON.stringify([1, 2, 3]));
  assert.deepEqual(readFolders(), emptyStore());
});

test("bỏ thành viên của danh sách đã biến mất, để kho khỏi phình mãi", () => {
  const bẩn = { list: [{ id: "f1", name: "Còn" }], members: { f1: ["w1"], "da-xoa": ["w9"] } };
  const sạch = normaliseStore(bẩn);
  assert.deepEqual(Object.keys(sạch.members), ["f1"]);
});

test("cha đã biến mất thì con lên gốc chứ không trôi mất", () => {
  const sạch = normaliseStore({ list: [{ id: "f2", name: "Mồ côi", parentId: "da-xoa" }], members: {} });
  assert.equal(sạch.list[0].parentId, "");
});

test("danh sách tự nhận mình làm cha thì đưa về gốc", () => {
  // Vòng lặp cha con sẽ treo phần dựng đường dẫn.
  const sạch = normaliseStore({ list: [{ id: "f3", name: "Vòng", parentId: "f3" }], members: {} });
  assert.equal(sạch.list[0].parentId, "");
});

test("lưu rồi đọc lại giữ nguyên danh sách, ghi chú và thành viên", () => {
  store.clear();
  let s = addFolder(emptyStore(), "Ôn gấp", { note: "trước kỳ thi" });
  s = addWords(s, s.list[0].id, ["w1"]);
  saveFolders(s);
  const lại = readFolders();
  assert.equal(lại.list[0].name, "Ôn gấp");
  assert.equal(lại.list[0].note, "trước kỳ thi");
  assert.deepEqual(lại.members[lại.list[0].id], ["w1"]);
});
