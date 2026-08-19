// Kiểm thử nhật ký ôn tập và các chỉ số của màn Thống kê.
import assert from "node:assert/strict";
import test from "node:test";
import { advice, appendEntry, byDay, entriesSince, localDay, summarise, weakest, MAX_ENTRIES } from "../lib/review-log.mjs";

const NOW = new Date("2026-08-19T10:00:00");
const dayBack = (back) => {
  const date = new Date(NOW);
  date.setDate(date.getDate() - back);
  return date.toISOString();
};
const entry = (back, rating, id, extra = {}) => ({ at: dayBack(back), id, term: id, rating, boxBefore: 1, boxAfter: 2, ...extra });

test("localDay: lấy ngày theo lịch máy, không lệch múi giờ", () => {
  assert.equal(localDay(new Date("2026-08-19T23:30:00")), "2026-08-19");
  assert.equal(localDay(new Date("2026-01-01T00:10:00")), "2026-01-01");
});

test("entriesSince: 7 ngày gồm cả hôm nay, bỏ mục cũ hơn", () => {
  const entries = [entry(0, "good", "a"), entry(6, "good", "b"), entry(7, "good", "c"), entry(40, "good", "d")];
  const tuan = entriesSince(entries, 7, NOW).map((item) => item.id);
  assert.deepEqual(tuan, ["a", "b"], "ngày thứ 7 trở về trước không thuộc tuần này");
  assert.equal(entriesSince(entries, 30, NOW).length, 3);
});

test("summarise: đếm đúng từ mới, số lần quên và số từ bị quên", () => {
  const entries = [
    entry(0, "good", "a", { firstTime: true }),
    entry(0, "again", "b"),
    entry(1, "again", "b"),
    entry(1, "again", "d"),
    entry(1, "easy", "c", { firstTime: true }),
    entry(2, "hard", "d"),
  ];
  const s = summarise(entries);
  assert.equal(s.reviews, 6);
  assert.equal(s.learned, 2, "hai từ được ôn lần đầu");
  assert.equal(s.forgot, 3, "ba lượt bấm Quên");
  // Ba lượt quên nhưng chỉ hai từ: b bị quên hai lần. Hai con số này phải tách bạch,
  // nếu không thì một từ khó cứ quên đi quên lại sẽ bị đếm như nhiều từ khác nhau.
  assert.equal(s.forgotWords, 2, "chỉ hai từ khác nhau bị quên");
  assert.equal(s.accuracy, 33, "good + easy = 2 trên 6 lượt");
  assert.equal(s.activeDays, 3);
});

test("summarise: chỉ tính là thuộc khi thực sự vừa lên hộp 6", () => {
  const entries = [
    entry(0, "easy", "a", { boxBefore: 5, boxAfter: 6 }),
    entry(1, "good", "b", { boxBefore: 6, boxAfter: 6 }),
  ];
  assert.equal(summarise(entries).mastered, 1, "từ đã ở hộp 6 từ trước không được đếm lại");
});

test("summarise: nhật ký rỗng không chia cho 0", () => {
  const s = summarise([]);
  assert.equal(s.accuracy, 0);
  assert.equal(s.perDay, 0);
  assert.equal(s.reviews, 0);
});

test("weakest: xếp theo số lần quên, bỏ qua lượt nhớ được", () => {
  const entries = [entry(0, "again", "x"), entry(1, "again", "x"), entry(0, "again", "y"), entry(0, "good", "z")];
  const list = weakest(entries, 5);
  assert.deepEqual(list.map((item) => item.id), ["x", "y"]);
  assert.equal(list[0].times, 2);
});

test("byDay: đủ số cột kể cả ngày không học, đếm riêng lượt quên", () => {
  const rows = byDay([entry(0, "good", "a"), entry(0, "again", "b"), entry(2, "good", "c")], 7, NOW);
  assert.equal(rows.length, 7);
  assert.equal(rows[rows.length - 1].reviews, 2, "hôm nay 2 lượt");
  assert.equal(rows[rows.length - 1].forgot, 1);
  assert.equal(rows[rows.length - 2].reviews, 0, "hôm qua không học");
});

test("appendEntry: cắt bớt khi vượt trần, giữ lượt mới nhất", () => {
  const many = Array.from({ length: MAX_ENTRIES }, (_, index) => entry(0, "good", `w${index}`));
  const next = appendEntry(many, entry(0, "good", "moi-nhat"));
  assert.equal(next.length, MAX_ENTRIES);
  assert.equal(next[next.length - 1].id, "moi-nhat");
  assert.equal(next[0].id, "w1", "lượt cũ nhất bị bỏ");
});

test("advice: chưa đủ dữ liệu thì không phán bừa", () => {
  const tips = advice(summarise([entry(0, "again", "a")]), [], 0);
  assert.equal(tips.length, 1);
  assert.match(tips[0].text, /Chưa đủ dữ liệu/);
});

test("advice: tỉ lệ nhớ thấp thì khuyên giảm từ mới", () => {
  const entries = Array.from({ length: 30 }, (_, index) => entry(index % 5, index < 20 ? "again" : "good", `w${index}`));
  const tips = advice(summarise(entries), [], 2);
  assert.ok(tips.some((tip) => /Tỉ lệ nhớ .* là thấp/.test(tip.text)));
});

test("advice: học quá nặng trong ngày thì nhắc chia nhỏ", () => {
  const entries = Array.from({ length: 300 }, (_, index) => entry(index % 4, "good", `w${index}`));
  const tips = advice(summarise(entries), [], 3);
  assert.ok(tips.some((tip) => /chia nhỏ|Chia nhỏ/i.test(tip.text)));
});
