import { NextResponse } from "next/server";
import { identify } from "../../../../lib/ai-guard";
import { grantPremium, isAdmin, revokePremium } from "../../../../lib/admin";

// Chủ app bật / gia hạn / huỷ Premium cho một tài khoản theo email.
//   POST { email, days }        → cộng thêm `days` ngày Premium
//   POST { email, revoke: true} → hạ về Free ngay

export async function POST(request: Request) {
  const caller = await identify(request);
  if (!isAdmin(caller)) return NextResponse.json({ error: "Không có quyền." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { email?: string; days?: number; revoke?: boolean };
  const email = String(body.email ?? "").trim();
  if (!email || !email.includes("@")) return NextResponse.json({ error: "Thiếu email hợp lệ." }, { status: 400 });

  const result = body.revoke
    ? await revokePremium(email)
    : await grantPremium(email, Number(body.days) || 30);

  return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: 400 });
}
