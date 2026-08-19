import assert from "node:assert/strict";
import test from "node:test";
import {
  DRILL_MODES,
  MIXED_POOL,
  acceptedAnswers,
  choicesFor,
  clozeOf,
  inflectionsOf,
  isCorrect,
  modeForCard,
  normalise,
  seededOrder,
  summarise,
  supportsMode,
} from "../lib/vocab-drill.mjs";

const card = (over = {}) => ({
  id: "1",
  term: "brilliant",
  meaning: "xuất sắc",
  example: "She had a brilliant idea.",
  cloze: "She had a _____ idea.",
  ...over,
});

test("sáu chế độ đúng thứ tự trên thanh tab", () => {
  assert.deepEqual(DRILL_MODES.map((item) => item.value), ["card", "type", "listen", "reverse", "cloze", "mixed"]);
});

test("hỗn hợp không bốc chế độ thẻ vì thẻ không chấm được", () => {
  assert.ok(!MIXED_POOL.includes("card"));
  assert.ok(!MIXED_POOL.includes("mixed"));
});

test("modeForCard: chế độ thường thì giữ nguyên cho mọi thẻ", () => {
  for (let i = 0; i < 5; i += 1) assert.equal(modeForCard("type", i), "type");
});

test("modeForCard: hỗn hợp đổi theo thẻ nhưng luôn ra kết quả như nhau", () => {
  const first = Array.from({ length: 12 }, (_, i) => modeForCard("mixed", i));
  const again = Array.from({ length: 12 }, (_, i) => modeForCard("mixed", i));
  assert.deepEqual(first, again);
  for (const mode of first) assert.ok(MIXED_POOL.includes(mode), `chế độ lạ: ${mode}`);
  assert.ok(new Set(first).size > 1, "hỗn hợp mà chỉ ra một chế độ thì không phải hỗn hợp");
});

test("normalise: bỏ qua chữ hoa, dấu câu và khoảng trắng thừa", () => {
  assert.equal(normalise("  She   WORKS. "), "she works");
  assert.equal(normalise("“brilliant”"), "brilliant");
});

test("chấm đúng bất kể chữ hoa hay dấu câu", () => {
  assert.equal(isCorrect("Brilliant", "brilliant"), true);
  assert.equal(isCorrect("brilliant.", "brilliant"), true);
  assert.equal(isCorrect(" brilliant ", "brilliant"), true);
});

test("sai chính tả vẫn là sai — đây là bài luyện viết đúng từ", () => {
  assert.equal(isCorrect("briliant", "brilliant"), false);
  assert.equal(isCorrect("", "brilliant"), false);
});

test("từ khoá nhiễu OCR: gõ nhánh nào cũng được tính đúng", () => {
  assert.deepEqual(acceptedAnswers("actor/ actress"), ["actor/ actress", "actor/ actress", "actor", "actress"].filter((value, index, list) => list.indexOf(value) === index));
  assert.equal(isCorrect("actress", "actor/ actress"), true);
  assert.equal(isCorrect("actor", "actor/ actress"), true);
  assert.equal(isCorrect("white", "white (n, adj)"), true);
});

test("clozeOf: dùng câu đã khoét sẵn nếu có", () => {
  assert.equal(clozeOf(card()), "She had a _____ idea.");
});

test("clozeOf: chưa khoét sẵn thì tự khoét từ câu ví dụ", () => {
  const blanked = clozeOf(card({ cloze: undefined }));
  assert.match(blanked, /_____/);
  assert.ok(!blanked.includes("brilliant"));
});

test("supportsMode: bỏ qua thẻ thiếu dữ liệu thay vì hiện ô trống rỗng", () => {
  assert.equal(supportsMode(card(), "cloze"), true);
  // Câu ví dụ không chứa từ thì không khoét được chỗ nào.
  assert.equal(supportsMode(card({ cloze: undefined, example: "Không có từ đó ở đây." }), "cloze"), false);
  assert.equal(supportsMode(card({ meaning: "" }), "reverse"), false);
  assert.equal(supportsMode(card({ meaning: "" }), "type"), false);
  assert.equal(supportsMode(null, "card"), false);
});

test("choicesFor: bốn lựa chọn, có đúng một đáp án đúng", () => {
  const pool = [card(), card({ id: "2", term: "dull" }), card({ id: "3", term: "clever" }), card({ id: "4", term: "plain" }), card({ id: "5", term: "sharp" })];
  const choices = choicesFor(pool[0], pool, 3);
  assert.equal(choices.length, 4);
  assert.equal(choices.filter((item) => item.id === "1").length, 1);
});

test("choicesFor: bộ nhỏ thì ít lựa chọn hơn, không lặp đáp án để lấp chỗ", () => {
  const pool = [card(), card({ id: "2", term: "dull" })];
  const choices = choicesFor(pool[0], pool, 1);
  assert.equal(choices.length, 2);
  assert.equal(new Set(choices.map((item) => item.id)).size, 2);
});

test("choicesFor: không lấy từ trùng tên làm đáp án nhiễu", () => {
  const pool = [card(), card({ id: "2", term: "Brilliant" }), card({ id: "3", term: "dull" })];
  const choices = choicesFor(pool[0], pool, 1);
  assert.deepEqual(choices.map((item) => item.id).sort(), ["1", "3"]);
});

test("seededOrder: cùng seed cho cùng thứ tự, khác seed cho thứ tự khác", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(seededOrder(items, 1), seededOrder(items, 1));
  assert.notDeepEqual(seededOrder(items, 1), seededOrder(items, 2));
  assert.deepEqual([...seededOrder(items, 5)].sort((a, b) => a - b), items);
});

test("summarise: thẻ flashcard không tính vào tỉ lệ đúng", () => {
  const results = [
    { id: "1", mode: "card", correct: false },
    { id: "2", mode: "type", correct: true },
    { id: "3", mode: "cloze", correct: false },
  ];
  const summary = summarise(results);
  assert.equal(summary.total, 3);
  assert.equal(summary.answered, 2);
  assert.equal(summary.correct, 1);
  assert.equal(summary.accuracy, 50);
  assert.deepEqual(summary.wrongCards, ["3"]);
});

test("summarise: chưa trả lời câu nào thì tỉ lệ là 0, không phải NaN", () => {
  assert.equal(summarise([]).accuracy, 0);
  assert.equal(summarise([{ id: "1", mode: "card", correct: false }]).accuracy, 0);
});

test("hasIpa: chỗ dành sẵn không được coi là phiên âm thật", async () => {
  const { hasIpa } = await import("../lib/vocab-drill.mjs");
  assert.equal(hasIpa("/…/"), false);
  assert.equal(hasIpa("//"), false);
  assert.equal(hasIpa(""), false);
  assert.equal(hasIpa(undefined), false);
  assert.equal(hasIpa("/ˈbrɪliənt/"), true);
});

test("điền chỗ trống chấp nhận biến thể của từ, chế độ khác thì không", () => {
  // Chỗ trống nằm ở "rescued" nhưng từ đang luyện là "rescue".
  assert.equal(isCorrect("rescued", "rescue", true), true);
  assert.equal(isCorrect("rescue", "rescue", true), true);
  assert.equal(isCorrect("rescuing", "rescue", true), true);
  // Chỉ nới lỏng ở bài điền chỗ trống, chế độ gõ từ vẫn đòi đúng dạng.
  assert.equal(isCorrect("rescued", "rescue"), false);
  // Biến thể là biến thể, không phải từ khác.
  assert.equal(isCorrect("save", "rescue", true), false);
});

test("inflectionsOf: các quy tắc chia thường gặp", () => {
  assert.deepEqual(inflectionsOf("walk"), ["walk", "walks", "walked", "walking"]);
  assert.deepEqual(inflectionsOf("study"), ["study", "studies", "studied", "studying"]);
  assert.deepEqual(inflectionsOf("watch"), ["watch", "watches", "watched", "watching"]);
  // Bỏ "e" câm trước -ing, nhưng "see" thì giữ.
  assert.ok(inflectionsOf("rescue").includes("rescuing"));
  assert.ok(inflectionsOf("make").includes("making"));
  assert.ok(inflectionsOf("see").includes("seeing"));
  // Gấp đôi phụ âm cuối sau nguyên âm ngắn.
  assert.ok(inflectionsOf("stop").includes("stopped"));
  assert.ok(inflectionsOf("stop").includes("stopping"));
});

test("động từ bất quy tắc được chấp nhận qua bảng tra sẵn có", () => {
  assert.equal(isCorrect("made", "make", true), true);
  assert.equal(isCorrect("saw", "see", true), true);
  assert.equal(isCorrect("wrote", "write", true), true);
});

test("nới lỏng biến thể không được kéo theo từ khác gần giống", () => {
  // "sit" và "site" là hai từ khác nhau, không phải hai dạng của một từ.
  assert.equal(isCorrect("sit", "site", true), false);
  assert.equal(isCorrect("site", "sit", true), false);
});
