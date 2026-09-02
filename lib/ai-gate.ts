import { NextResponse } from "next/server";
import type { Caller } from "./ai-guard";
import { refund as burstRefund, spend as burstSpend } from "./ai-guard";
import { monthlyUsage, readEntitlement, type Bucket, type Entitlement } from "./entitlements";
import { BUCKET_LABEL, bucketOf, capFor, firstPlanWith } from "./pricing.mjs";

// Một cổng cho mọi route AI: đọc gói người gọi, chặn gọi dồn, và với gói Free thì
// chặn khi vượt hạn mức THÁNG (hoặc dùng tính năng chỉ-Premium).
//
//   const caller = await identify(request);
//   const g = await gate(caller, "grade");
//   if (g.denied) return g.denied;
//   try { ...; return ok }              // logUsage(ok:true) → tính vào hạn mức tháng
//   catch { await g.release(true); ...} // release(true) hoàn lại lượt gọi dồn

export type Gate = {
  entitlement: Entitlement;
  denied: NextResponse | null;
  release: (failed: boolean) => Promise<void>;
};

const upsell = (message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: message, code: "need_premium", ...extra }, { status: 402 });

export async function gate(caller: Caller, feature: string): Promise<Gate> {
  const entitlement = await readEntitlement(caller);
  const noop = async () => {};

  // Chặn gọi dồn dập / trần ngày theo gói (lớp chống lạm dụng, luôn chạy).
  const burst = burstSpend(caller, entitlement.plan);
  if (burst) return { entitlement, denied: burst, release: noop };

  const release: Gate["release"] = async (failed) => {
    if (failed) burstRefund(caller, entitlement.plan);
  };

  // admin: mở khoá tất cả, không đếm.
  if (entitlement.plan === "admin") return { entitlement, denied: null, release };

  const cap = capFor(entitlement.plan, feature);

  // null = không giới hạn ở bậc này (hoặc tính năng không tốn lượt nào).
  if (cap === null) return { entitlement, denied: null, release };

  // Trần bằng 0 = bậc này không có tính năng đó. Mời lên đúng bậc mở khoá được
  // nó, chứ không mời bừa lên Premium — Lite có thể đã đủ.
  if (cap === 0) {
    burstRefund(caller, entitlement.plan);
    const need = firstPlanWith(feature);
    const label = BUCKET_LABEL[bucketOf(feature) as Bucket] ?? "tính năng này";
    return {
      entitlement,
      denied: upsell(
        entitlement.plan === "guest"
          ? `Cần đăng nhập để dùng ${label}.`
          : `${label} có ở gói ${need === "lite" ? "Lite" : "Premium"}. Nâng cấp để mở khoá.`,
        { feature, need },
      ),
      release: noop,
    };
  }

  // Còn lại: có trần hữu hạn — đếm mức đã dùng trong tháng.
  const bucket = bucketOf(feature) as Bucket | null;
  if (bucket && caller.userId) {
    const used = await monthlyUsage(caller);
    if (used[bucket] >= cap) {
      burstRefund(caller, entitlement.plan);
      const label = BUCKET_LABEL[bucket] ?? "truy vấn AI";
      // Mời lên đúng bậc kế tiếp còn nới được trần này.
      const next = entitlement.plan === "free" ? "Lite" : "Premium";
      return {
        entitlement,
        denied: upsell(
          `Bạn đã dùng hết ${cap} lượt ${label} của tháng này. Nâng cấp ${next} để có thêm.`,
          { feature, bucket, used: used[bucket], cap, need: next.toLowerCase() },
        ),
        release: noop,
      };
    }
  }

  return { entitlement, denied: null, release };
}
