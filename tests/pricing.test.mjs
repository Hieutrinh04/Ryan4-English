import assert from "node:assert/strict";
import test from "node:test";

import {
  BUCKETS,
  PAID_PLANS,
  PLAN_LIMITS,
  bucketOf,
  capFor,
  firstPlanWith,
  formatVnd,
  limitsFor,
  perMonth,
  premiumPlan,
  priceOrder,
} from "../lib/pricing.mjs";

test("bucketOf: tính năng không gọi mô hình thì không tốn lượt", () => {
  assert.equal(bucketOf("enrich"), "aiLookups");
  assert.equal(bucketOf("grade"), "aiGrade");
  assert.equal(bucketOf("speaking"), "aiSpeak");
  assert.equal(bucketOf("transcribe"), "transcribe");
  // Bốn thứ này chạy bằng từ điển / Google Dịch, không tốn tiền mô hình nào.
  for (const free of ["glance", "ipa", "level", "translate"]) {
    assert.equal(bucketOf(free), null, `${free} phải miễn phí`);
  }
});

test("BUCKETS liệt kê đúng các xô mà PLAN_LIMITS khai", () => {
  // Lệch nhau là hạn mức bị bỏ quên âm thầm — gate() sẽ cho qua vô hạn.
  for (const plan of Object.keys(PLAN_LIMITS)) {
    assert.deepEqual(
      Object.keys(PLAN_LIMITS[plan]).sort(),
      [...BUCKETS].sort(),
      `bậc ${plan} thiếu hoặc thừa xô hạn mức`,
    );
  }
});

test("capFor: null nghĩa là không giới hạn, 0 nghĩa là không có tính năng", () => {
  assert.equal(capFor("free", "grade"), 2);
  assert.equal(capFor("lite", "grade"), 10);
  assert.equal(capFor("premium", "grade"), 30);

  assert.equal(capFor("lite", "enrich"), null, "Lite tra AI không giới hạn");
  assert.equal(capFor("admin", "transcribe"), null);

  // Tính năng miễn phí luôn trả null ở mọi bậc.
  assert.equal(capFor("guest", "glance"), null);
});

test("bóc lời video là ranh giới cứng giữa Lite và Premium", () => {
  // Đây là khoản đắt nhất (~64% chi phí AI). Nếu Lite lỡ mở nó ra thì biên lợi
  // nhuận của gói 39k sập, nên khoá bằng test.
  assert.equal(capFor("free", "transcribe"), 0);
  assert.equal(capFor("lite", "transcribe"), 0);
  assert.ok(capFor("premium", "transcribe") > 0);
  assert.equal(firstPlanWith("transcribe"), "premium");
});

test("firstPlanWith: mời lên đúng bậc rẻ nhất mở khoá được", () => {
  assert.equal(firstPlanWith("enrich"), "free", "Free đã có tra AI, dù ít");
  assert.equal(firstPlanWith("prosody"), "free", "Free được nếm chấm ngữ điệu");
  assert.equal(firstPlanWith("transcribe"), "premium");
  assert.equal(firstPlanWith("glance"), "free");
});

test("priceOrder: trả đúng tiền, số ngày và bậc", () => {
  assert.deepEqual(priceOrder("lite_m1"), {
    amountVnd: 39_000, days: 30, months: 1, tier: "lite", label: "Lite · 1 tháng",
  });
  assert.equal(priceOrder("m1").tier, "premium");
  assert.equal(priceOrder("m1").amountVnd, 100_000);
  assert.equal(priceOrder("y1").days, 365);
  assert.equal(priceOrder("khong-co"), null);
});

test("mua dài hơn thì rẻ hơn tính theo tháng, ở cả hai bậc", () => {
  for (const tier of ["lite", "premium"]) {
    const perMonthPrices = Object.values(PAID_PLANS)
      .filter((plan) => plan.tier === tier)
      .map(perMonth);
    for (let i = 1; i < perMonthPrices.length; i += 1) {
      assert.ok(perMonthPrices[i] < perMonthPrices[i - 1], `bậc ${tier}: gói dài hơn phải rẻ hơn`);
    }
  }
});

test("Lite luôn rẻ hơn Premium ở cùng thời hạn", () => {
  for (const [lite, premium] of [["lite_m1", "m1"], ["lite_m3", "m3"], ["lite_y1", "y1"]]) {
    assert.ok(
      premiumPlan(lite).priceVnd < premiumPlan(premium).priceVnd,
      `${lite} phải rẻ hơn ${premium}`,
    );
    assert.equal(premiumPlan(lite).days, premiumPlan(premium).days, "cùng thời hạn");
  }
});

test("bậc cao hơn không bao giờ có hạn mức thấp hơn bậc dưới", () => {
  const rank = (cap) => (cap === null ? Infinity : cap);
  for (const bucket of BUCKETS) {
    const free = rank(PLAN_LIMITS.free[bucket]);
    const lite = rank(PLAN_LIMITS.lite[bucket]);
    const premium = rank(PLAN_LIMITS.premium[bucket]);
    assert.ok(lite >= free, `Lite phải >= Free ở ${bucket}`);
    assert.ok(premium >= lite, `Premium phải >= Lite ở ${bucket}`);
  }
});

test("limitsFor: bậc lạ thì rơi về Free chứ không mở toang", () => {
  assert.deepEqual(limitsFor("khong-ton-tai"), PLAN_LIMITS.free);
});

test("formatVnd: hiện tiền theo lối Việt", () => {
  assert.equal(formatVnd(39_000), "39.000₫");
  assert.equal(formatVnd(0), "0₫");
});
