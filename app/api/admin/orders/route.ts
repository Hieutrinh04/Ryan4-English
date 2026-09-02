import { NextResponse } from "next/server";
import { identify } from "../../../../lib/ai-guard";
import { isAdmin, recentOrders } from "../../../../lib/admin";

export async function GET(request: Request) {
  const caller = await identify(request);
  if (!isAdmin(caller)) return NextResponse.json({ error: "Không có quyền." }, { status: 403 });
  return NextResponse.json({ orders: await recentOrders(50) });
}
