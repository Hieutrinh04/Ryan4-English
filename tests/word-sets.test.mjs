import assert from "node:assert/strict";
import test from "node:test";

import { COLLECTIONS, deckStats, progressOf, searchSets, setsFor, splitLabel, weekdayLabel } from "../lib/word-sets.mjs";
import { localDateString } from "../lib/srs.mjs";

const homNay = localDateString();
const maiSau = "2099-01-01";

function tu(extra) {
  return { id: extra.id ?? extra.term, term: "x", box: 1, lapses: 0, status: "new", topic: "", ...extra };
}

test("COLLECTIONS: đủ bốn cách gom, mã không trùng", () => {
  assert.equal(COLLECTIONS.length, 4);
  assert.equal(new Set(COLLECTIONS.map((item) => item.id)).size, 4);
  for (const item of COLLECTIONS) assert.ok(item.label, `thiếu nhãn: ${item.id}`);
});

test("weekdayLabel: đọc được tên thứ từ tên tệp nhập", () => {
  assert.equal(weekdayLabel("01 Monday.xlsx"), "Thứ Hai");
  assert.equal(weekdayLabel("07 Sunday.xlsx"), "Chủ Nhật");
  assert.equal(weekdayLabel("03 wednesday.CSV"), "Thứ Tư");
  // Nguồn không phải bộ theo tuần thì không nhận nhầm.
  assert.equal(weekdayLabel("1000 từ vựng - MochiMochi"), "");
  assert.equal(weekdayLabel(""), "");
  assert.equal(weekdayLabel(undefined), "");
});

test("deckStats: đếm đúng bốn con số", () => {
  const stats = deckStats([
    tu({ id: "a", status: "new" }),
    tu({ id: "b", status: "review", reviewCount: 2, dueDate: homNay }),
    tu({ id: "c", status: "review", reviewCount: 2, dueDate: maiSau }),
    tu({ id: "d", box: 6, status: "mastered", reviewCount: 9 }),
  ]);
  assert.equal(stats.total, 4);
  // đã học = mọi từ trừ từ chưa học
  assert.equal(stats.learned, 3);
  // cần ôn chỉ đếm từ đã tới hạn, KHÔNG cộng từ chưa học vào
  assert.equal(stats.due, 1);
  assert.equal(stats.fresh, 1);
  assert.equal(stats.mastered, 1);
});

test("deckStats: từ chưa học không bị đếm là cần ôn", () => {
  // Gộp hai con số thì thẻ "cần ôn hôm nay" của người mới dùng hiện ra gần bằng
  // cả kho, thành ra không nói lên điều gì.
  const stats = deckStats([tu({ id: "a" }), tu({ id: "b" }), tu({ id: "c" })]);
  assert.equal(stats.due, 0);
  assert.equal(stats.fresh, 3);
});

test("deckStats: từ đã thuộc vẫn tính là đã học", () => {
  // Nếu trừ ra thì con số 'đã học' tụt xuống mỗi lần người học tiến bộ.
  const stats = deckStats([tu({ box: 6, status: "mastered", reviewCount: 9 })]);
  assert.equal(stats.learned, 1);
  assert.equal(stats.mastered, 1);
});

test("deckStats: danh sách rỗng hoặc sai kiểu trả về số 0, không phải NaN", () => {
  for (const input of [[], null, undefined, "abc"]) {
    const stats = deckStats(input);
    assert.deepEqual(stats, { total: 0, learned: 0, due: 0, fresh: 0, mastered: 0 });
  }
});

test("setsFor topic: gom theo chủ đề, một từ nhiều chủ đề vào cả hai bộ", () => {
  const sets = setsFor(
    [
      tu({ id: "a", topic: "JOB - NGHỀ NGHIỆP · TIME - THỜI GIAN" }),
      tu({ id: "b", topic: "JOB - NGHỀ NGHIỆP" }),
    ],
    "topic",
  );
  assert.deepEqual(sets.map((set) => set.label), ["JOB - NGHỀ NGHIỆP", "TIME - THỜI GIAN"]);
  assert.equal(sets[0].total, 2);
  assert.equal(sets[1].total, 1);
});

test("setsFor topic: bộ nhiều từ đứng trước, bằng nhau thì xếp theo tên", () => {
  const sets = setsFor([tu({ id: "a", topic: "ZOO" }), tu({ id: "b", topic: "ANIMAL" })], "topic");
  assert.deepEqual(sets.map((set) => set.label), ["ANIMAL", "ZOO"]);
});

test("setsFor topic: chủ đề trống không thành một bộ vô danh", () => {
  const sets = setsFor([tu({ id: "a", topic: "" }), tu({ id: "b", topic: "  ·  " })], "topic");
  assert.deepEqual(sets, []);
});

test("setsFor ielts: gom theo nhóm chủ đề IELTS", () => {
  const sets = setsFor(
    [
      tu({ id: "a", ieltsTopics: ["Work & Career", "Education"] }),
      tu({ id: "b", ieltsTopics: ["Education"] }),
      tu({ id: "c" }),
    ],
    "ielts",
  );
  assert.deepEqual(sets.map((set) => set.label), ["Education", "Work & Career"]);
  assert.equal(sets[0].total, 2);
});

test("setsFor week: xếp theo thứ tự trong tuần chứ không theo số từ", () => {
  const sets = setsFor(
    [
      tu({ id: "a", source: "07 Sunday.xlsx" }),
      tu({ id: "b", source: "07 Sunday.xlsx" }),
      tu({ id: "c", source: "01 Monday.xlsx" }),
    ],
    "week",
  );
  assert.deepEqual(sets.map((set) => set.label), ["Thứ Hai", "Chủ Nhật"]);
  assert.equal(sets[0].total, 1);
});

test("setsFor mine: chỉ lấy từ người dùng tự thêm, gom thành một bộ", () => {
  const sets = setsFor(
    [
      tu({ id: "a", source: "01 Monday.xlsx" }),
      tu({ id: "b", source: "" }),
      tu({ id: "c" }),
    ],
    "mine",
  );
  assert.equal(sets.length, 1);
  assert.equal(sets[0].total, 2);
});

test("setsFor mine: bộ nhập sẵn ghi nguồn bằng chữ không bị coi là từ tự thêm", () => {
  // Bộ MochiMochi ghi nguồn bằng chữ, không có đuôi tệp. Đoán theo đuôi tệp thì
  // cả 983 từ chui hết vào "Từ tôi thêm".
  assert.deepEqual(setsFor([tu({ id: "a", source: "1000 từ vựng tiếng Anh cơ bản - MochiMochi" })], "mine"), []);
});

test("setsFor mine: chưa tự thêm từ nào thì không hiện bộ rỗng", () => {
  assert.deepEqual(setsFor([tu({ id: "a", source: "01 Monday.xlsx" })], "mine"), []);
});

test("setsFor: dữ liệu sai kiểu không làm sập", () => {
  for (const collection of ["topic", "ielts", "week", "mine"]) {
    assert.deepEqual(setsFor(null, collection), []);
    assert.deepEqual(setsFor("abc", collection), []);
  }
});

test("progressOf: làm tròn xuống để chưa xong không hiện thành 100%", () => {
  assert.equal(progressOf({ total: 100, learned: 99 }), 99);
  assert.equal(progressOf({ total: 3, learned: 2 }), 66);
  assert.equal(progressOf({ total: 4, learned: 4 }), 100);
  // Bộ rỗng chia cho 0 phải ra 0, không phải NaN.
  assert.equal(progressOf({ total: 0, learned: 0 }), 0);
  assert.equal(progressOf(null), 0);
});

test("splitLabel: tách tên tiếng Anh và tiếng Việt của chủ đề bộ PDF", () => {
  assert.deepEqual(splitLabel("FEELING - CẢM XÚC"), { main: "CẢM XÚC", sub: "FEELING" });
  assert.deepEqual(splitLabel("BODY PART - BỘ PHẬN CƠ THỂ"), { main: "BỘ PHẬN CƠ THỂ", sub: "BODY PART" });
  // Nhãn không theo dạng đó thì để nguyên, không cắt bừa.
  assert.deepEqual(splitLabel("Education"), { main: "Education", sub: "" });
  assert.deepEqual(splitLabel("Thứ Hai"), { main: "Thứ Hai", sub: "" });
  assert.deepEqual(splitLabel(""), { main: "", sub: "" });
});

test("searchSets: gõ không dấu vẫn tìm ra bộ có dấu", () => {
  const sets = [{ label: "FEELING - CẢM XÚC" }, { label: "ANIMAL - ĐỘNG VẬT" }, { label: "Education" }];
  assert.deepEqual(searchSets(sets, "cam xuc"), [sets[0]]);
  assert.deepEqual(searchSets(sets, "dong vat"), [sets[1]]);
  assert.deepEqual(searchSets(sets, "EDU"), [sets[2]]);
  assert.equal(searchSets(sets, "   ").length, 3);
  assert.equal(searchSets(sets, "").length, 3);
});
