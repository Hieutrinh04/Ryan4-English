import assert from "node:assert/strict";
import test from "node:test";
import { leaderboardSnapshot, periodStart, rankLeaderboard, safeDisplayName } from "../lib/leaderboard.mjs";

const now = new Date("2026-08-28T12:00:00+07:00");

test("periodStart: tuần bắt đầu từ thứ Hai và tháng từ ngày 1", () => {
  assert.equal(periodStart("week", now), "2026-08-24");
  assert.equal(periodStart("month", now), "2026-08-01");
});

test("leaderboardSnapshot: chỉ tính hoạt động trong kỳ", () => {
  const result = leaderboardSnapshot({
    practice: { "2026-08-23": { vocab: 600 }, "2026-08-24": { vocab: 120, shadowing: 60 } },
    reviews: [
      { at: "2026-08-23T10:00:00Z", firstTime: true, boxBefore: 1, boxAfter: 2 },
      { at: "2026-08-25T10:00:00Z", firstTime: true, boxBefore: 5, boxAfter: 6 },
    ],
    attempts: [{ day: "2026-08-26" }, { day: "2026-07-26" }],
  }, "week", now);
  assert.deepEqual(result, { periodStart: "2026-08-24", minutes: 3, reviews: 1, xp: 25 });
});

test("rankLeaderboard: xếp hạng đồng hạng và dùng lượt ôn để phá hoà", () => {
  const rows = rankLeaderboard([
    { user_id: "b", display_name: "Bình", minutes: 20, xp: 50, reviews: 9 },
    { user_id: "a", display_name: "An", minutes: 20, xp: 70, reviews: 3 },
    { user_id: "c", display_name: "Chi", minutes: 10, xp: 90, reviews: 12 },
  ], "minutes");
  assert.deepEqual(rows.map((row) => [row.name, row.rank]), [["Bình", 1], ["An", 1], ["Chi", 3]]);
  assert.equal(rankLeaderboard(rows, "xp")[0].name, "Chi");
});

test("safeDisplayName: không công khai email", () => {
  assert.equal(safeDisplayName("user@example.com", "abcd-123"), "Người học ABCD");
  assert.equal(safeDisplayName("  Trinh   Hieu  ", "abcd"), "Trinh Hieu");
  assert.equal(safeDisplayName("A".repeat(50), "abcd").length, 40);
});
