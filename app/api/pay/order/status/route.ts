import { NextResponse } from "next/server";
import { identify } from "../../../../../lib/ai-guard";
import { orderStatus } from "../../../../../lib/payments";

// Client hỏi vòng trong lúc chờ người dùng quét QR chuyển khoản.

export async function GET(request: Request) {
  const caller = await identify(request);
  if (!caller.userId) return NextResponse.json({ status: "unknown" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return NextResponse.json({ status: "unknown" }, { status: 400 });
  return NextResponse.json({ status: await orderStatus(id, caller.userId) });
}
