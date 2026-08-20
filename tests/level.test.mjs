import assert from "node:assert/strict";
import test from "node:test";
import { LEVELS, XP_RULES, levelFor, xpBreakdown, xpFrom } from "../lib/level.mjs";

test("chưa làm gì thì 0 XP, cấp 1", () => {
  assert.equal(xpFrom({}), 0);
  const level = levelFor(0);
  assert.equal(level.level, 1);
  assert.equal(level.xp, 0);
  assert.equal(level.percent, 0);
});

test("XP cộng đúng theo từng loại việc", () => {
  // 10 lượt ôn + 4 từ mới + 1 từ lên hộp 6 + 2 bài dịch + 15 phút luyện
  const xp = xpFrom({ reviews: 10, learned: 4, mastered: 1, attempts: 2, minutes: 15 });
  assert.equal(xp, 10 * 1 + 4 * 3 + 1 * 10 + 2 * 5 + 15 * 2);
});

test("số âm hoặc số lẻ không tạo ra XP ảo", () => {
  assert.equal(xpFrom({ reviews: -50 }), 0);
  assert.equal(xpFrom({ reviews: 2.9 }), 2);
  assert.equal(xpFrom({ reviews: "linh tinh" }), 0);
  assert.equal(xpFrom(null), 0);
});

test("mọi khoản XP đều quy được về một việc đã ghi lại", () => {
  // Không được có khoản nào kiểu "điểm đăng nhập" — thứ làm số tăng mà không
  // nói lên người học tiến bộ hay chưa.
  assert.deepEqual(XP_RULES.map((rule) => rule.key), ["reviews", "learned", "mastered", "attempts", "minutes"]);
  for (const rule of XP_RULES) assert.ok(rule.label && rule.xp > 0);
});

test("xpBreakdown: chỉ liệt kê khoản thật sự có, kèm số lượng", () => {
  const rows = xpBreakdown({ reviews: 10, learned: 0, attempts: 2 });
  assert.deepEqual(rows.map((row) => row.key), ["reviews", "attempts"]);
  assert.equal(rows[0].xp, 10);
  assert.equal(rows[1].xp, 10);
  assert.equal(rows[1].count, 2);
});

test("levelFor: lên cấp đúng mốc, không lệch một điểm", () => {
  assert.equal(levelFor(99).level, 1);
  assert.equal(levelFor(100).level, 2);
  assert.equal(levelFor(299).level, 2);
  assert.equal(levelFor(300).level, 3);
});

test("levelFor: tiến trình tới cấp kế tiếp tính trên đoạn giữa hai mốc", () => {
  // Cấp 2 từ 100 đến 300; ở 200 là đi được nửa đoạn.
  const level = levelFor(200);
  assert.equal(level.level, 2);
  assert.equal(level.into, 100);
  assert.equal(level.need, 200);
  assert.equal(level.percent, 50);
  assert.equal(level.next, 300);
});

test("levelFor: cấp cuối thì thanh tiến trình đầy, không hiện mốc không có thật", () => {
  const top = LEVELS.at(-1);
  const level = levelFor(top.from + 50_000);
  assert.equal(level.level, top.level);
  assert.equal(level.next, null);
  assert.equal(level.percent, 100);
});

test("mốc các cấp phải tăng dần, nếu không thì lên cấp rồi tụt lại", () => {
  for (let i = 1; i < LEVELS.length; i += 1) {
    assert.ok(LEVELS[i].from > LEVELS[i - 1].from, `mốc cấp ${LEVELS[i].level} không lớn hơn cấp trước`);
    assert.equal(LEVELS[i].level, LEVELS[i - 1].level + 1);
    assert.ok(LEVELS[i].name);
  }
});
