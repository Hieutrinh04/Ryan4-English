import { NextResponse } from "next/server";
import { identify } from "../../../../lib/ai-guard";
import { monthlyUsage, readEntitlement, type Bucket } from "../../../../lib/entitlements";
import { BUCKETS, PAID_PLANS, limitsFor } from "../../../../lib/pricing.mjs";
import { isLegacyLibraryOwner } from "../../../../lib/admin";

// Gói + mức dùng AI còn lại trong tháng của người đang đăng nhập. Client gọi khi
// mở app và sau mỗi lần dùng tính năng AI.

export async function GET(request: Request) {
  const caller = await identify(request);
  const entitlement = await readEntitlement(caller);
  const usage = await monthlyUsage(caller);
  const limits = limitsFor(entitlement.plan);

  // Một đồng hồ cho mỗi xô hạn mức. cap = null nghĩa là không giới hạn ở bậc này;
  // client dựa vào đó để hiện "Không giới hạn" thay vì một thanh tiến trình.
  const monthly = Object.fromEntries(
    (BUCKETS as Bucket[]).map((bucket) => [
      bucket,
      { used: usage[bucket] ?? 0, cap: limits[bucket] ?? null },
    ]),
  );

  return NextResponse.json({
    plan: entitlement.plan,
    premiumUntil: entitlement.premiumUntil,
    legacyLibrary: isLegacyLibraryOwner(caller),
    monthly,
    plans: Object.values(PAID_PLANS),
  });
}
