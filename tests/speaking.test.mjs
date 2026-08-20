import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { LEVELS, SCENARIOS, filterScenarios, isComplete, makeSession, mergeGoals, readSessions, saveSession, sessionsKey, summarise } =
  await import("../lib/speaking.mjs");

test("mọi kịch bản có đủ trường cần để dựng hội thoại, mã không trùng", () => {
  for (const item of SCENARIOS) {
    // Thiếu bất kỳ trường nào thì mô hình không biết mình đóng vai gì.
    assert.ok(item.id && item.title && item.titleEn, `thiếu tên: ${item.id}`);
    assert.ok(item.setting && item.partner && item.you && item.starter, `thiếu bối cảnh: ${item.id}`);
    assert.ok(LEVELS.includes(item.level), `trình độ lạ ở ${item.id}`);
    assert.ok(Array.isArray(item.goals) && item.goals.length >= 2, `${item.id} cần ít nhất 2 mục tiêu`);
    assert.ok(item.icon, `thiếu biểu tượng: ${item.id}`);
  }
  assert.equal(new Set(SCENARIOS.map((item) => item.id)).size, SCENARIOS.length);
});

test("có kịch bản trải từ dễ tới khó, không dồn hết một mức", () => {
  const levels = new Set(SCENARIOS.map((item) => item.level));
  assert.ok(levels.size >= 3, `chỉ có ${levels.size} mức trình độ`);
});

test("filterScenarios: lọc đúng trình độ", () => {
  assert.ok(filterScenarios(SCENARIOS, "A1").every((item) => item.level === "A1"));
  assert.equal(filterScenarios(SCENARIOS, "all").length, SCENARIOS.length);
  assert.equal(filterScenarios(SCENARIOS, "").length, SCENARIOS.length);
  assert.deepEqual(filterScenarios(SCENARIOS, "Z9"), []);
});

test("mergeGoals: gộp mục tiêu mới vào, bỏ trùng và sắp thứ tự", () => {
  assert.deepEqual(mergeGoals([0], [2, 0], 3), [0, 2]);
  assert.deepEqual(mergeGoals([], [1], 3), [1]);
});

test("mergeGoals: bỏ chỉ số vô lý do mô hình trả về", () => {
  // Mô hình có thể trả về số âm, số vượt quá, hoặc chữ.
  assert.deepEqual(mergeGoals([], [-1, 99, "abc", 1.5, 0], 3), [0]);
  assert.deepEqual(mergeGoals([], null, 3), []);
  assert.deepEqual(mergeGoals(null, [0], 3), [0]);
});

test("isComplete: chỉ xong khi đủ hết mục tiêu", () => {
  assert.equal(isComplete([0, 1, 2], 3), true);
  assert.equal(isComplete([0, 1], 3), false);
  // Kịch bản không có mục tiêu nào thì không thể coi là đã xong.
  assert.equal(isComplete([], 0), false);
});

test("makeSession: làm sạch, trình độ lạ quy về A1", () => {
  const session = makeSession({ scenarioId: "x", title: "Thử", level: "Z9", turns: "4", goalsDone: 2, goalsTotal: 3, corrections: 1 });
  assert.equal(session.level, "A1");
  assert.equal(session.turns, 4);
  assert.equal(session.goalsDone, 2);
});

test("makeSession: số âm hoặc số lẻ không lọt vào", () => {
  const session = makeSession({ turns: -5, goalsDone: 1.7, goalsTotal: "abc" });
  assert.equal(session.turns, 0);
  assert.equal(session.goalsDone, 1);
  assert.equal(session.goalsTotal, 0);
});

test("lưu và đọc lại buổi nói, buổi mới nhất lên đầu", () => {
  store.clear();
  saveSession(makeSession({ scenarioId: "a", title: "Cũ" }));
  saveSession(makeSession({ scenarioId: "b", title: "Mới" }));
  assert.equal(readSessions()[0].title, "Mới");
  assert.equal(readSessions().length, 2);
});

test("dữ liệu hỏng trong localStorage không làm sập phần đọc", () => {
  store.clear();
  store.set(sessionsKey, "{không phải JSON");
  assert.deepEqual(readSessions(), []);
});

test("summarise: tính tỉ lệ mục tiêu đạt được trên tổng mục tiêu", () => {
  const summary = summarise([
    { at: "2", scenarioId: "a", turns: 5, goalsDone: 3, goalsTotal: 3, corrections: 2 },
    { at: "1", scenarioId: "b", turns: 4, goalsDone: 1, goalsTotal: 3, corrections: 1 },
  ]);
  assert.equal(summary.count, 2);
  assert.equal(summary.turns, 9);
  assert.equal(summary.goalRate, 67);
  assert.equal(summary.corrections, 3);
  assert.deepEqual(summary.done.sort(), ["a", "b"]);
});

test("summarise: cùng một kịch bản làm hai lần chỉ tính là một kịch bản đã làm", () => {
  const summary = summarise([
    { at: "2", scenarioId: "a", goalsDone: 1, goalsTotal: 2 },
    { at: "1", scenarioId: "a", goalsDone: 2, goalsTotal: 2 },
  ]);
  assert.deepEqual(summary.done, ["a"]);
});

test("summarise: chưa nói buổi nào thì mọi số là 0, không phải NaN", () => {
  const summary = summarise([]);
  assert.equal(summary.count, 0);
  assert.equal(summary.goalRate, 0);
  assert.deepEqual(summary.done, []);
});
