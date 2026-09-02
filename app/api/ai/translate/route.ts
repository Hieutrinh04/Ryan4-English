import { NextResponse } from "next/server";
import { translateOne } from "../../../../lib/translate.mjs";

// Dịch một cụm / câu Anh → Việt cho tính năng "bôi đen để dịch" trong bài học.
// KHÔNG gọi mô hình ngôn ngữ. Dịch phía máy chủ vì Google Dịch đã chặn CORS.

export async function GET(request: Request) {
  const text = new URL(request.url).searchParams.get("q")?.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return NextResponse.json({ vi: "" });
  if (text.length > 400) return NextResponse.json({ error: "Đoạn quá dài để dịch." }, { status: 400 });
  const vi = await translateOne(text);
  return NextResponse.json({ vi });
}
