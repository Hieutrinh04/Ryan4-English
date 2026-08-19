import assert from "node:assert/strict";
import test from "node:test";
import {
  attemptAdvice,
  attemptsSince,
  makeAttempt,
  summariseAttempts,
  trendOf,
  typesFromIssues,
  typesFromNotes,
} from "../lib/error-log.mjs";

const DAY = 86_400_000;
const NOW = new Date("2026-08-19T10:00:00");

function attempt(overrides = {}, offsetDays = 0) {
  const when = new Date(NOW.getTime() - offsetDays * DAY);
  return makeAttempt(
    { term: "office", vietnamese: "Cô ấy làm ở văn phòng.", answer: "She work in office.", reference: "She works in an office.", score: 70, correct: false, gradedBy: "llm", errorTypes: [], ...overrides },
    when,
  );
}

test("typesFromNotes: đổi nhận xét so câu mẫu sang nhãn chuẩn", () => {
  const types = typesFromNotes([{ kind: "form" }, { kind: "article" }, { kind: "preposition" }, { kind: "target" }]);
  assert.deepEqual(types, ["verb_form", "article", "preposition", "vocabulary"]);
});

test("typesFromNotes: bỏ qua 'diff' vì viết khác câu mẫu không phải là sai", () => {
  assert.deepEqual(typesFromNotes([{ kind: "diff" }, { kind: "diff" }]), []);
  assert.deepEqual(typesFromNotes([{ kind: "article" }, { kind: "diff" }]), ["article"]);
});

test("typesFromIssues: quy nhãn mô hình trả về và bỏ trùng", () => {
  assert.deepEqual(typesFromIssues([{ type: "Articles" }, { type: "article" }, { type: "tense" }]), ["article", "verb_tense"]);
});

test("makeAttempt: chuẩn hoá điểm, nhãn lỗi và cách chấm", () => {
  const entry = attempt({ score: 250, gradedBy: "linh tinh", errorTypes: ["Articles", "chưa rõ"] });
  assert.equal(entry.score, 100);
  assert.equal(entry.gradedBy, "reference");
  assert.deepEqual(entry.errorTypes, ["article", "other"]);
  assert.equal(entry.day, "2026-08-19");
});

test("attemptsSince: chỉ lấy các ngày trong quãng đang xét", () => {
  const entries = [attempt({}, 0), attempt({}, 3), attempt({}, 20)];
  assert.equal(attemptsSince(entries, 1, NOW).length, 1);
  assert.equal(attemptsSince(entries, 7, NOW).length, 2);
  assert.equal(attemptsSince(entries, 30, NOW).length, 3);
});

test("summariseAttempts: đếm và xếp hạng nhãn lỗi", () => {
  const entries = [
    attempt({ errorTypes: ["article"] }),
    attempt({ errorTypes: ["article", "verb_tense"] }),
    attempt({ errorTypes: ["article"] }),
    attempt({ errorTypes: ["verb_tense"] }),
    attempt({ errorTypes: [], correct: true, score: 100 }),
  ];
  const summary = summariseAttempts(entries);
  assert.equal(summary.attempts, 5);
  assert.equal(summary.totalErrors, 5);
  assert.equal(summary.byType[0].type, "article");
  assert.equal(summary.byType[0].count, 3);
  assert.equal(summary.byType[0].share, 60);
  assert.equal(summary.byType[1].type, "verb_tense");
  assert.equal(summary.cleanRuns, 1);
  assert.equal(summary.correct, 1);
  assert.equal(summary.correctRate, 20);
});

test("summariseAttempts: chưa có bài nào thì trả về số 0, không phải NaN", () => {
  const summary = summariseAttempts([]);
  assert.equal(summary.attempts, 0);
  assert.equal(summary.correctRate, 0);
  assert.equal(summary.avgScore, 0);
  assert.deepEqual(summary.byType, []);
});

test("trendOf: nhận ra một lỗi đang đỡ dần", () => {
  // Bốn bài đầu đều sai mạo từ, bốn bài sau thì không.
  const entries = [
    attempt({ errorTypes: ["article"] }, 8), attempt({ errorTypes: ["article"] }, 7),
    attempt({ errorTypes: ["article"] }, 6), attempt({ errorTypes: ["article"] }, 5),
    attempt({ errorTypes: [] }, 4), attempt({ errorTypes: [] }, 3),
    attempt({ errorTypes: [] }, 2), attempt({ errorTypes: [] }, 1),
  ];
  const trend = trendOf(entries, "article");
  assert.equal(trend.direction, "better");
  assert.equal(trend.change, -100);
});

test("trendOf: nhận ra một lỗi đang nặng thêm", () => {
  const entries = [
    attempt({ errorTypes: [] }, 8), attempt({ errorTypes: [] }, 7),
    attempt({ errorTypes: [] }, 6), attempt({ errorTypes: [] }, 5),
    attempt({ errorTypes: ["article"] }, 4), attempt({ errorTypes: ["article"] }, 3),
    attempt({ errorTypes: ["article"] }, 2), attempt({ errorTypes: ["article"] }, 1),
  ];
  assert.equal(trendOf(entries, "article").direction, "worse");
});

test("trendOf: ít dữ liệu quá thì không kết luận", () => {
  assert.equal(trendOf([attempt({ errorTypes: ["article"] })], "article"), null);
});

test("dưới 5 bài thì nói thẳng là chưa đủ dữ liệu", () => {
  const entries = [attempt({ errorTypes: ["article"] }), attempt({ errorTypes: ["article"] })];
  const notes = attemptAdvice(summariseAttempts(entries), entries);
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /chưa nói được/);
});

test("lời khuyên nêu đúng lỗi mắc nhiều nhất kèm tỉ lệ", () => {
  const entries = [
    attempt({ errorTypes: ["article"] }), attempt({ errorTypes: ["article"] }),
    attempt({ errorTypes: ["article"] }), attempt({ errorTypes: ["preposition"] }),
    attempt({ errorTypes: [], correct: true, score: 100 }),
  ];
  const text = attemptAdvice(summariseAttempts(entries), entries).map((note) => note.text).join(" ");
  assert.match(text, /mạo từ/i);
  assert.match(text, /3 lần/);
  assert.match(text, /75%/);
});

test("nói rõ bài nào chỉ được so với câu mẫu, vì cách đó khắt khe hơn thực tế", () => {
  const entries = [
    attempt({ gradedBy: "reference", errorTypes: ["article"] }), attempt({ gradedBy: "reference", errorTypes: ["article"] }),
    attempt({ gradedBy: "reference", errorTypes: ["article"] }), attempt({ gradedBy: "llm", errorTypes: [] }),
    attempt({ gradedBy: "llm", errorTypes: [] }),
  ];
  const text = attemptAdvice(summariseAttempts(entries), entries).map((note) => note.text).join(" ");
  assert.match(text, /2\/5 bài được mô hình ngôn ngữ chấm/);
  assert.match(text, /khắt khe hơn thực tế/);
});
