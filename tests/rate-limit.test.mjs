import assert from "node:assert/strict";
import test from "node:test";
import { createLimiter, limitMessage } from "../lib/rate-limit.mjs";

const T0 = Date.UTC(2026, 7, 19, 10, 0, 0);

test("cho qua khi còn trong hạn mức", () => {
  const limiter = createLimiter({ windowMs: 60_000, burst: 3, dailyQuota: 10 });
  for (let i = 0; i < 3; i += 1) assert.equal(limiter.take("a", T0 + i).ok, true, `lượt ${i + 1}`);
});

test("chặn khi gọi dồn dập, kèm số giây phải chờ", () => {
  const limiter = createLimiter({ windowMs: 60_000, burst: 3, dailyQuota: 10 });
  for (let i = 0; i < 3; i += 1) limiter.take("a", T0);
  const verdict = limiter.take("a", T0 + 10_000);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "burst");
  assert.equal(verdict.retryAfterSeconds, 50);
});

test("cửa sổ trượt mở lại sau khi hết hạn", () => {
  const limiter = createLimiter({ windowMs: 60_000, burst: 2, dailyQuota: 10 });
  limiter.take("a", T0);
  limiter.take("a", T0 + 1000);
  assert.equal(limiter.take("a", T0 + 2000).ok, false);
  assert.equal(limiter.take("a", T0 + 61_000).ok, true);
});

test("hạn mức ngày chặn cả khi gọi thưa", () => {
  const limiter = createLimiter({ windowMs: 1000, burst: 100, dailyQuota: 4 });
  for (let i = 0; i < 4; i += 1) assert.equal(limiter.take("a", T0 + i * 10_000).ok, true);
  const verdict = limiter.take("a", T0 + 100_000);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "quota");
  assert.equal(verdict.remainingToday, 0);
});

test("hạn mức ngày được cấp lại sang ngày mới", () => {
  const limiter = createLimiter({ windowMs: 1000, burst: 100, dailyQuota: 2 });
  limiter.take("a", T0);
  limiter.take("a", T0 + 2000);
  assert.equal(limiter.take("a", T0 + 4000).ok, false);
  assert.equal(limiter.take("a", T0 + 86_400_000).ok, true);
});

test("mỗi người một bộ đếm riêng", () => {
  const limiter = createLimiter({ windowMs: 60_000, burst: 1, dailyQuota: 10 });
  assert.equal(limiter.take("a", T0).ok, true);
  assert.equal(limiter.take("a", T0).ok, false);
  assert.equal(limiter.take("b", T0).ok, true);
});

test("refund trả lại lượt khi lỗi thuộc về phía máy chủ", () => {
  const limiter = createLimiter({ windowMs: 60_000, burst: 2, dailyQuota: 2 });
  limiter.take("a", T0);
  limiter.take("a", T0);
  assert.equal(limiter.take("a", T0).ok, false);
  limiter.refund("a", T0);
  assert.equal(limiter.take("a", T0).ok, true);
});

test("limitMessage: nói bằng tiếng Việt và chỉ ra lối đi tiếp", () => {
  assert.match(limitMessage("quota", 3600), /hết lượt AI của hôm nay/);
  assert.match(limitMessage("quota", 3600), /vẫn dùng được/);
  assert.match(limitMessage("burst", 12), /Chờ 12 giây/);
});
