import { NextResponse } from "next/server";
import { identify } from "../../../../lib/ai-guard";
import { bankConfigured, createPremiumOrder } from "../../../../lib/payments";
import { premiumPlan } from "../../../../lib/pricing.mjs";

// Bấm "Nâng cấp lên Premium" → tạo đơn và trả về mã QR chuyển khoản.

export async function POST(request: Request) {
  const caller = await identify(request);
  if (!caller.userId) return NextResponse.json({ error: "Cần đăng nhập để thanh toán." }, { status: 401 });
  if (!bankConfigured()) return NextResponse.json({ error: "Chưa cấu hình thanh toán." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { planId?: string };
  const planId = String(body.planId ?? "").trim();
  if (!premiumPlan(planId)) return NextResponse.json({ error: "Gói không hợp lệ." }, { status: 400 });

  const result = await createPremiumOrder(caller.userId, planId);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json(result);
}
