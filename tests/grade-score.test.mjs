import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CRITERIA, MAX_ERRORS, MAX_IMPROVEMENTS, SCORE_WEIGHTS, isCorrect, overallScore, splitFeedback } from "../lib/grade-score.mjs";
import { ERROR_TYPES, normaliseErrorType } from "../lib/error-taxonomy.mjs";
import { errorStats, statusOf, weakestErrors } from "../lib/error-mastery.mjs";

// AC01 — câu đúng nghĩa nhưng khác câu mẫu không bị đánh dấu sai.
test("AC01 · đúng ý thì đạt, dù ngữ pháp chưa hoàn hảo", () => {
  assert.equal(isCorrect({ meaning: 95, grammar: 60, vocabulary: 70, naturalness: 65 }), true);
  // Ngược lại: câu đẹp ngữ pháp nhưng lạc ý thì KHÔNG đạt.
  assert.equal(isCorrect({ meaning: 40, grammar: 100, vocabulary: 100, naturalness: 100 }), false);
});

test("trọng số cộng đúng 100% và ý nghĩa nặng nhất", () => {
  const total = CRITERIA.reduce((sum, key) => sum + SCORE_WEIGHTS[key], 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `tổng trọng số phải bằng 1, đang là ${total}`);
  for (const key of CRITERIA) if (key !== "meaning") assert.ok(SCORE_WEIGHTS.meaning > SCORE_WEIGHTS[key]);
});

test("điểm tổng tính từ chính bốn điểm người học nhìn thấy", () => {
  assert.equal(overallScore({ meaning: 100, grammar: 100, vocabulary: 100, naturalness: 100 }), 100);
  assert.equal(overallScore({ meaning: 0, grammar: 0, vocabulary: 0, naturalness: 0 }), 0);
  // 80×.35 + 60×.25 + 40×.20 + 20×.20 = 28 + 15 + 8 + 4 = 55
  assert.equal(overallScore({ meaning: 80, grammar: 60, vocabulary: 40, naturalness: 20 }), 55);
});

test("thiếu tiêu chí thì coi như 0, không thành NaN", () => {
  assert.equal(overallScore({ meaning: 100 }), 35);
  assert.equal(overallScore(undefined), 0);
});

// AC02 + AC04 — tối đa 3 lỗi, và LỖI tách khỏi GỢI Ý.
test("AC02 · AC04 · tách lỗi khỏi gợi ý và chặn trần mỗi loại", () => {
  const input = [
    ...Array.from({ length: 6 }, (_, i) => ({ kind: "error", wrong: `sai ${i}`, right: `đúng ${i}` })),
    ...Array.from({ length: 5 }, (_, i) => ({ kind: "improvement", wrong: `ổn ${i}`, right: `hay hơn ${i}` })),
  ];
  const { errors, improvements } = splitFeedback(input);
  assert.equal(errors.length, MAX_ERRORS);
  assert.equal(improvements.length, MAX_IMPROVEMENTS);
  assert.ok(errors.every((item) => item.kind === "error"));
  assert.ok(improvements.every((item) => item.kind === "improvement"));
});

test("mục trùng nhau chỉ tính một lần", () => {
  const { errors } = splitFeedback([
    { kind: "error", wrong: "I go", right: "I went" },
    { kind: "error", wrong: "I go", right: "I went" },
  ]);
  assert.equal(errors.length, 1);
});

test("không ghi kind thì mặc định là lỗi, không phải gợi ý", () => {
  const { errors, improvements } = splitFeedback([{ wrong: "a", right: "b" }]);
  assert.equal(errors.length, 1);
  assert.equal(improvements.length, 0);
});

// AC06 — nhãn lỗi lưu nhất quán để thống kê được.
test("AC06 · taxonomy V2 có đúng mười nhãn và tương thích bí danh cũ", () => {
  assert.deepEqual(ERROR_TYPES, ["tense", "grammar", "article", "preposition", "word_order", "vocabulary", "collocation", "meaning", "naturalness", "vietnamese_translation"]);
  assert.equal(normaliseErrorType("verb_tense"), "tense");
  assert.equal(normaliseErrorType("verb_form"), "grammar");
  assert.equal(normaliseErrorType("natural_expression"), "naturalness");
  assert.equal(normaliseErrorType("literal_translation"), "vietnamese_translation");
  assert.equal(normaliseErrorType("wrong_meaning"), "meaning");
});

test("route chấm bài không còn tự nhận điểm tổng từ mô hình", async () => {
  const route = await readFile(new URL("../app/api/ai/grade/route.ts", import.meta.url), "utf8");
  assert.match(route, /score: overallScore\(criteria\)/);
  assert.match(route, /correct: isCorrect\(criteria\)/);
  // issues cũ chỉ chứa lỗi thật, để thống kê không đếm lời gợi ý thành lỗi.
  assert.match(route, /issues: errors/);
});

// AC03 — mỗi lỗi có giải thích, quy tắc và ví dụ.
test("AC03 · prompt đòi đủ why, rule và example", async () => {
  const route = await readFile(new URL("../app/api/ai/grade/route.ts", import.meta.url), "utf8");
  for (const field of ["why", "rule", "example"])
    assert.ok(route.includes(`${field}:`), `route chấm bài không đọc trường ${field}`);
});

// Trạng thái thành thạo.
const mk = (day, types) => ({ at: `${day}T09:00:00Z`, day, errorTypes: types, score: 80, correct: !types.length });

test("thành thạo tính theo SỐ NGÀY khác nhau, không theo số lần liên tiếp", () => {
  // Năm bài đúng liên tiếp trong CÙNG một ngày: chưa đủ để gọi là đã sửa được.
  const oneDay = [mk("2026-08-20", ["article"]), ...Array.from({ length: 5 }, () => mk("2026-08-21", []))];
  const [article] = errorStats(oneDay, new Date("2026-08-22"));
  assert.equal(article.cleanDays, 1);
  assert.notEqual(article.status, "mastered");

  // Ba NGÀY khác nhau không tái phạm thì đạt.
  const threeDays = [mk("2026-08-20", ["article"]), mk("2026-08-21", []), mk("2026-08-22", []), mk("2026-08-23", [])];
  assert.equal(errorStats(threeDays, new Date("2026-08-24"))[0].status, "mastered");
});

test("ngày vẫn còn mắc lỗi không được tính là ngày sạch", () => {
  const log = [mk("2026-08-20", ["article"]), mk("2026-08-21", []), mk("2026-08-21", ["article"]), mk("2026-08-22", [])];
  const [article] = errorStats(log, new Date("2026-08-23"));
  assert.equal(article.lastSeen, "2026-08-21");
  assert.equal(article.cleanDays, 1);
});

test("chỉ tính từ lần mắc đầu tiên trở đi", () => {
  // Mười bài sạch TRƯỚC khi lần đầu mắc lỗi không biến nó thành đã sửa được.
  const log = [...Array.from({ length: 10 }, (_, i) => mk(`2026-08-${10 + i}`, [])), mk("2026-08-25", ["article"])];
  const [article] = errorStats(log, new Date("2026-08-26"));
  assert.equal(article.cleanDays, 0);
  assert.equal(article.status, "improving");
});

test("ngưỡng ba trạng thái", () => {
  assert.equal(statusOf(5, 0), "weak");
  assert.equal(statusOf(1, 0), "improving");
  assert.equal(statusOf(5, 1), "improving");
  assert.equal(statusOf(5, 3), "mastered");
});

// AC08 — mở được bài luyện từ mỗi lỗi, nên phải có danh sách lỗi đáng luyện.
test("AC08 · lỗi đã sửa được không còn nằm trong danh sách cần luyện", () => {
  const log = [
    mk("2026-08-20", ["article", "verb_tense"]), mk("2026-08-21", ["verb_tense"]),
    mk("2026-08-22", ["verb_tense"]), mk("2026-08-23", []), mk("2026-08-24", []),
  ];
  const weak = weakestErrors(log, 3, new Date("2026-08-25"));
  const types = weak.map((row) => row.type);
  assert.ok(types.includes("tense"), "lỗi còn mắc gần đây phải nằm trong danh sách");
  assert.ok(!types.includes("article"), "lỗi đã ba ngày không tái phạm thì bỏ ra");
});

test("AC08 · giao diện có thể mở Error Practice trực tiếp từ từng lỗi", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Luyện lỗi này/);
  assert.match(page, /function ErrorPractice/);
  assert.match(page, /practiceForError\(attempts, errorPractice\.type\)/);
});

test("feedback V2 hiển thị đủ bốn tiêu chí và tách lỗi khỏi gợi ý", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const label of ["Đúng nghĩa", "Ngữ pháp", "Từ vựng", "Tự nhiên", "Lỗi cần sửa", "Gợi ý diễn đạt hay hơn", "Cụm nên học"])
    assert.ok(page.includes(label), `thiếu mục phản hồi: ${label}`);
});

test("mastery mới chỉ nhận lượt sạch khi đúng loại lỗi đang luyện", () => {
  const log = [
    { ...mk("2026-08-20", ["article"]), assessedTypes: ["article"] },
    { ...mk("2026-08-21", []), assessedTypes: ["preposition"] },
    { ...mk("2026-08-22", []), assessedTypes: ["article"] },
  ];
  const [article] = errorStats(log, new Date("2026-08-23"));
  assert.equal(article.cleanDays, 1);
});
