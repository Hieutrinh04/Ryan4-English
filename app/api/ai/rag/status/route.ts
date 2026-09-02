import { NextResponse } from "next/server";
import { identify } from "../../../../../lib/ai-guard";
import { readRagStatus } from "../../../../../lib/rag";

export async function GET(request: Request) {
  const caller = await identify(request);
  if (!caller.userId) return NextResponse.json({ error: "Cần đăng nhập để dùng ký ức học tập." }, { status: 401 });
  return NextResponse.json(await readRagStatus(caller));
}
