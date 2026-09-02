import { NextResponse } from "next/server";
import { settleBankTransfer } from "../../../../../lib/payments";

// Webhook nhận biến động số dư từ dịch vụ đọc giao dịch ngân hàng (SePay / Casso).
//
// SePay: cấu hình webhook trỏ về URL này, đặt "API Key" — SePay gửi ở header
//   Authorization: Apikey <key>
// Body SePay:
//   { gateway, transactionDate, accountNumber, content, transferType: "in",
//     transferAmount, referenceCode, ... }
//
// Đặt BANK_WEBHOOK_KEY trong .env.local trùng với key trên SePay.

function authorized(request: Request) {
  const expected = process.env.BANK_WEBHOOK_KEY?.trim();
  if (!expected) return true; // chưa đặt key → chấp nhận (chỉ nên vậy khi test)
  const header = request.headers.get("authorization") ?? request.headers.get("x-api-key") ?? "";
  const token = header.replace(/^(Apikey|Bearer)\s+/i, "").trim();
  return token === expected;
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  let tx: Record<string, unknown>;
  try {
    tx = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, message: "Bad payload" }, { status: 400 });
  }

  try {
    const result = await settleBankTransfer(tx);
    // Luôn trả 200 để dịch vụ không gọi lại mãi; kết quả nằm ở "matched"/"applied".
    return NextResponse.json({ success: true, ...result });
  } catch {
    return NextResponse.json({ success: false, message: "Internal error" }, { status: 500 });
  }
}
