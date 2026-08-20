import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { CRITERIA, EXAMS, attemptsKey, bandFrom, countWords, makeAttempt, readAttempts, saveAttempt, summarise, toHalfBand, weakestCriterion } =
  await import("../lib/writing.mjs");

const full = { task: 6, coherence: 6, lexical: 7, grammar: 6 };

test("bốn tiêu chí đều có tên và mô tả", () => {
  assert.equal(CRITERIA.length, 4);
  for (const item of CRITERIA) assert.ok(item.key && item.label && item.hint);
  assert.deepEqual(CRITERIA.map((item) => item.key), ["task", "coherence", "lexical", "grammar"]);
});

test("countWords: đếm đúng, bỏ khoảng trắng thừa", () => {
  assert.equal(countWords("  The chart   shows two trends. "), 5);
  assert.equal(countWords(""), 0);
  assert.equal(countWords(null), 0);
});

test("toHalfBand: làm tròn tới nửa band, .25 lên .5", () => {
  assert.equal(toHalfBand(6.25), 6.5);
  assert.equal(toHalfBand(6.75), 7);
  assert.equal(toHalfBand(6.1), 6);
  assert.equal(toHalfBand(6.5), 6.5);
});

test("toHalfBand: chặn trong khoảng 0–9 và không trả NaN", () => {
  assert.equal(toHalfBand(99), 9);
  assert.equal(toHalfBand(-3), 0);
  assert.equal(toHalfBand("linh tinh"), 0);
  assert.equal(toHalfBand(undefined), 0);
});

test("bandFrom: trung bình cộng bốn tiêu chí, không phải lấy thấp nhất", () => {
  // 6+6+7+6 = 25 / 4 = 6.25 → 6.5
  assert.equal(bandFrom(full), 6.5);
  assert.equal(bandFrom({ task: 5, coherence: 5, lexical: 5, grammar: 5 }), 5);
});

test("bandFrom: thiếu tiêu chí thì bỏ qua, KHÔNG tính bằng 0", () => {
  // Chấm hụt một tiêu chí mà kéo cả band xuống thì con số thành vô nghĩa.
  assert.equal(bandFrom({ task: 7, coherence: 7 }), 7);
  assert.equal(bandFrom({}), 0);
  assert.equal(bandFrom(null), 0);
});

test("weakestCriterion: chỉ ra tiêu chí thấp nhất để sửa trước", () => {
  const worst = weakestCriterion({ task: 7, coherence: 5, lexical: 7, grammar: 6 });
  assert.equal(worst.key, "coherence");
  assert.equal(worst.score, 5);
  assert.equal(weakestCriterion({}), null);
});

test("makeAttempt: làm sạch và tự tính band nếu chưa có", () => {
  const attempt = makeAttempt({
    taskId: "t1",
    taskTitle: "Biểu đồ cột",
    exam: "khong-co-that",
    part: 9,
    answer: "The chart shows two clear trends over the period.",
    scores: full,
  });
  // Kỳ thi lạ quy về ielts, phần lạ quy về 1 — không tin giá trị gửi tới.
  assert.equal(attempt.exam, "ielts");
  assert.equal(attempt.part, 1);
  assert.equal(attempt.words, 9);
  assert.equal(attempt.band, 6.5);
});

test("makeAttempt: chỉ giữ đoạn trích, không lưu nguyên bài", () => {
  const attempt = makeAttempt({ answer: "a".repeat(5000), scores: full });
  assert.equal(attempt.excerpt.length, 300);
});

test("lưu và đọc lại lượt viết, bài mới nhất lên đầu", () => {
  store.clear();
  saveAttempt(makeAttempt({ taskTitle: "Bài cũ", answer: "one two", scores: full }));
  saveAttempt(makeAttempt({ taskTitle: "Bài mới", answer: "one two", scores: full }));
  assert.equal(readAttempts()[0].taskTitle, "Bài mới");
  assert.equal(readAttempts().length, 2);
});

test("dữ liệu hỏng trong localStorage không làm sập phần đọc", () => {
  store.clear();
  store.set(attemptsKey, "{không phải JSON");
  assert.deepEqual(readAttempts(), []);
});

test("summarise: band hiện tại lấy từ bài GẦN NHẤT, không phải trung bình", () => {
  // Người học tiến bộ thì trung bình cả đời kéo con số xuống và nhìn như không tiến.
  const attempts = [
    { at: "3", band: 7, scores: { task: 7, coherence: 7, lexical: 7, grammar: 7 } },
    { at: "2", band: 5, scores: { task: 5, coherence: 5, lexical: 5, grammar: 5 } },
    { at: "1", band: 5, scores: { task: 5, coherence: 5, lexical: 5, grammar: 5 } },
  ];
  const summary = summarise(attempts);
  assert.equal(summary.latest, 7);
  assert.equal(summary.best, 7);
  assert.notEqual(summary.average, 7);
  assert.equal(summary.count, 3);
});

test("summarise: xu hướng so bài gần nhất với bài liền trước", () => {
  assert.equal(summarise([{ at: "2", band: 7 }, { at: "1", band: 6 }]).trend, 1);
  assert.equal(summarise([{ at: "2", band: 6 }, { at: "1", band: 6.5 }]).trend, -0.5);
  // Mới một bài thì chưa nói được xu hướng.
  assert.equal(summarise([{ at: "1", band: 6 }]).trend, 0);
});

test("summarise: chưa có bài nào thì mọi số là 0, không phải NaN", () => {
  const summary = summarise([]);
  assert.equal(summary.count, 0);
  assert.equal(summary.latest, 0);
  assert.equal(summary.average, 0);
  assert.deepEqual(summary.byCriterion, []);
});

test("mỗi kỳ thi có thang điểm riêng", () => {
  assert.deepEqual(EXAMS.map((item) => item.key), ["ielts", "toeic", "vstep"]);
  for (const exam of EXAMS) assert.ok(exam.label && exam.bandMax > 0);
});

// ── Đề bài ──────────────────────────────────────────────────────────────────
const tasksModule = await import("../lib/writing-tasks.mjs");
const { TASK1_MIN_WORDS, TASK2_MIN_WORDS, TASKS, filterTasks, groupByPart, minWordsOf } = tasksModule;

test("mọi đề đều có đủ trường bắt buộc và mã không trùng", () => {
  for (const task of TASKS) {
    assert.ok(task.id && task.title && task.prompt, `đề thiếu trường: ${task.id}`);
    assert.ok(EXAMS.some((exam) => exam.key === task.exam), `kỳ thi lạ ở ${task.id}`);
    assert.ok(task.part === 1 || task.part === 2, `phần lạ ở ${task.id}`);
  }
  assert.equal(new Set(TASKS.map((task) => task.id)).size, TASKS.length);
});

test("đề Task 1 của IELTS phải có biểu đồ, Task 2 thì không cần", () => {
  for (const task of TASKS) {
    if (task.exam === "ielts" && task.part === 1) {
      assert.ok(task.chart, `đề ${task.id} thiếu biểu đồ`);
      assert.ok(task.chart.xLabels.length > 0 && task.chart.series.length > 0);
      // Mỗi chuỗi số phải khớp số nhãn, lệch là biểu đồ vẽ sai.
      for (const series of task.chart.series) {
        assert.equal(series.values.length, task.chart.xLabels.length, `${task.id}: chuỗi ${series.name} lệch số điểm`);
        for (const value of series.values) assert.ok(Number.isFinite(value), `${task.id}: có giá trị không phải số`);
      }
    }
  }
});

test("minWordsOf: Task 2 đòi nhiều từ hơn Task 1", () => {
  assert.equal(minWordsOf({ part: 1 }), TASK1_MIN_WORDS);
  assert.equal(minWordsOf({ part: 2 }), TASK2_MIN_WORDS);
  assert.ok(TASK2_MIN_WORDS > TASK1_MIN_WORDS);
  // Không truyền gì thì lấy mức thấp hơn, không làm người học tưởng bị thiếu.
  assert.equal(minWordsOf(null), TASK1_MIN_WORDS);
});

test("filterTasks: lọc đúng kỳ thi và phần", () => {
  assert.ok(filterTasks(TASKS, { exam: "ielts" }).every((task) => task.exam === "ielts"));
  assert.ok(filterTasks(TASKS, { exam: "ielts", part: 2 }).every((task) => task.part === 2));
  // part = 0 nghĩa là lấy cả hai phần.
  assert.ok(filterTasks(TASKS, { exam: "ielts", part: 0 }).length >= filterTasks(TASKS, { exam: "ielts", part: 1 }).length);
  assert.deepEqual(filterTasks(TASKS, { exam: "khong-co-that" }), []);
});

test("groupByPart: chia thành từng khối, phần 1 trước phần 2", () => {
  const groups = groupByPart(filterTasks(TASKS, { exam: "ielts" }));
  assert.deepEqual(groups.map((group) => group.part), [1, 2]);
  assert.ok(groups[0].tasks.length > 0);
  assert.deepEqual(groupByPart([]), []);
});
