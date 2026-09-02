// Bảng giá và hạn mức — nguồn sự thật duy nhất cho cả server lẫn client.
//
// BA BẬC, không tự động gia hạn (thanh toán bằng mã QR ngân hàng):
//
//   Free     — dùng trọn vòng lặp học hằng ngày, không giới hạn. Phần gọi mô
//              hình AI thì có hạn mức tháng.
//   Lite     — mở khoá phần AI dùng thường ngày. KHÔNG có bóc lời video.
//   Premium  — mở hết, kèm bóc lời video cho bài tự thêm.
//
// VÌ SAO CHIA THẾ NÀY — theo chi phí thật, không theo cảm tính:
//
//   • Vòng lặp hằng ngày (lưu từ, ôn Leitner, lật thẻ, tra nhanh, IPA, xếp bậc
//     CEFR, dịch câu, nghe chép video CÓ SẴN phụ đề) không gọi mô hình nào —
//     chi phí gần bằng 0. Thu tiền phần này là tự bóp vòng giữ chân người học.
//
//   • Bóc lời video CHƯA có phụ đề là khoản đắt nhất: mỗi video ~500₫ và ăn một
//     lượt trong hạn mức ~1.000 lượt/ngày của cả hệ thống. Nó chiếm khoảng 64%
//     tổng chi phí AI, nên đây là ranh giới cứng giữa Lite và Premium.
//
//   • Chấm bài viết là thứ người học soi chất lượng gắt nhất nhưng số lượt ít,
//     nên đặt trần ở CẢ Premium (30/tháng) để tiền mô hình không trôi mất.

/**
 * Gói bán được. Giữ nguyên id cũ "m1"/"m3"/"y1" cho Premium: các đơn hàng đã
 * lưu trong payment_orders tham chiếu tới chúng, đổi id là làm hỏng lịch sử.
 */
export const PAID_PLANS = {
  lite_m1: { id: "lite_m1", tier: "lite", label: "Lite · 1 tháng", months: 1, days: 30, priceVnd: 39_000 },
  lite_m3: { id: "lite_m3", tier: "lite", label: "Lite · 3 tháng", months: 3, days: 90, priceVnd: 99_000, save: 15 },
  lite_y1: { id: "lite_y1", tier: "lite", label: "Lite · 1 năm", months: 12, days: 365, priceVnd: 349_000, save: 25 },

  m1: { id: "m1", tier: "premium", label: "Premium · 1 tháng", months: 1, days: 30, priceVnd: 100_000 },
  m3: { id: "m3", tier: "premium", label: "Premium · 3 tháng", months: 3, days: 90, priceVnd: 199_000, save: 34 },
  y1: { id: "y1", tier: "premium", label: "Premium · 1 năm", months: 12, days: 365, priceVnd: 549_000, save: 54 },
};

/** Tên cũ, giữ lại cho nơi nào còn gọi. */
export const PREMIUM_PLANS = PAID_PLANS;

/**
 * Hạn mức MỖI THÁNG theo bậc. null = không giới hạn.
 *
 * Riêng "guest" (chưa đăng nhập) đếm theo NGÀY và theo IP, không theo tháng.
 */
export const PLAN_LIMITS = {
  guest: { aiLookups: 8, aiGrade: 1, aiSpeak: 2, prosody: 0, transcribe: 0 },
  free: { aiLookups: 20, aiGrade: 2, aiSpeak: 5, prosody: 5, transcribe: 0 },
  lite: { aiLookups: null, aiGrade: 10, aiSpeak: null, prosody: 30, transcribe: 0 },
  premium: { aiLookups: null, aiGrade: 30, aiSpeak: null, prosody: null, transcribe: 20 },
  admin: { aiLookups: null, aiGrade: null, aiSpeak: null, prosody: null, transcribe: null },
};

/** Tên cũ — vài chỗ còn đọc trực tiếp hạn mức của gói Free. */
export const FREE_MONTHLY = PLAN_LIMITS.free;
export const GUEST_DAILY = PLAN_LIMITS.guest;

/**
 * Mỗi tính năng AI đếm vào "xô" hạn mức nào.
 *
 * KHÔNG có trong bảng này = miễn phí, không đếm lượt. Đó là chủ ý với những
 * tính năng không gọi mô hình ngôn ngữ:
 *   glance      chạm từ để tra nhanh — Datamuse + Google Dịch
 *   ipa         phiên âm — từ điển CMU đóng gói sẵn
 *   level       xếp bậc CEFR — Oxford 5000 + Datamuse
 *   translate   dịch câu — Google Dịch
 */
export const FEATURE_BUCKET = {
  enrich: "aiLookups",
  suggest: "aiLookups",
  passage: "aiLookups",
  writing: "aiLookups",
  pronounce: "aiLookups",
  summary: "aiLookups",
  grade: "aiGrade",
  speaking: "aiSpeak",
  prosody: "prosody",
  transcribe: "transcribe",
};

/** Mọi xô hạn mức, để nơi khác duyệt qua mà không phải chép lại danh sách. */
export const BUCKETS = ["aiLookups", "aiGrade", "aiSpeak", "prosody", "transcribe"];

/** Nhãn tiếng Việt của từng xô, dùng trong thông báo hết lượt. */
export const BUCKET_LABEL = {
  aiLookups: "truy vấn AI",
  aiGrade: "chấm bài AI",
  aiSpeak: "luyện nói cùng AI",
  prosody: "chấm ngữ điệu",
  transcribe: "bóc lời video",
};

/** Xô hạn mức của một tính năng, hoặc null nếu miễn phí. */
export function bucketOf(feature) {
  return FEATURE_BUCKET[feature] ?? null;
}

/** Hạn mức của một bậc; bậc lạ thì coi như Free cho an toàn. */
export function limitsFor(plan) {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

/**
 * Trần của một tính năng ở một bậc. null = không giới hạn.
 * Tính năng miễn phí (không thuộc xô nào) cũng trả null.
 */
export function capFor(plan, feature) {
  const bucket = bucketOf(feature);
  if (!bucket) return null;
  return limitsFor(plan)[bucket] ?? null;
}

/** Bậc thấp nhất mở khoá được tính năng này — để mời nâng cấp đúng gói. */
export function firstPlanWith(feature) {
  const bucket = bucketOf(feature);
  if (!bucket) return "free";
  for (const plan of ["free", "lite", "premium"]) {
    const cap = PLAN_LIMITS[plan][bucket];
    if (cap === null || cap > 0) return plan;
  }
  return "premium";
}

/** Gói bán theo id, hoặc null. */
export function premiumPlan(id) {
  return PAID_PLANS[id] ?? null;
}

/** Định giá đơn hàng. */
export function priceOrder(planId) {
  const plan = premiumPlan(planId);
  if (!plan) return null;
  return {
    amountVnd: plan.priceVnd,
    days: plan.days,
    months: plan.months,
    tier: plan.tier,
    label: plan.label,
  };
}

/** Tiền VND cho người đọc: 100000 → "100.000₫". */
export function formatVnd(amount) {
  return `${Math.round(Number(amount) || 0).toLocaleString("vi-VN")}₫`;
}

/** Giá trung bình mỗi tháng, để hiện "≈ 46.000₫/tháng". */
export function perMonth(plan) {
  return Math.round(plan.priceVnd / plan.months);
}
