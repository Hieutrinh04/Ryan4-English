import { adminClient } from "./entitlements";
import { priceOrder } from "./pricing.mjs";
import { bankQrUrl, transferMatchesOrder } from "./vietqr.mjs";

// Tạo đơn Premium và mã QR chuyển khoản; xác nhận đơn khi dịch vụ đọc biến động
// số dư (SePay / Casso…) gọi webhook về.
//
// Cần trong .env.local:
//   SUPABASE_SERVICE_ROLE_KEY   để webhook ghi user_plans / payment_orders
//   BANK_CODE                   mã ngân hàng ngắn: MB, VCB, TCB, ACB… (hoặc BIN)
//   BANK_ACCOUNT                số tài khoản nhận tiền
//   BANK_ACCOUNT_NAME           tên chủ tài khoản (hiện cho người chuyển)
//   BANK_WEBHOOK_KEY            khoá xác thực webhook (SePay gửi ở header Apikey)

export function bankConfigured() {
  return Boolean(process.env.BANK_CODE && process.env.BANK_ACCOUNT);
}

export function bankInfo() {
  return {
    bankCode: process.env.BANK_CODE ?? "",
    accountNumber: process.env.BANK_ACCOUNT ?? "",
    accountName: process.env.BANK_ACCOUNT_NAME ?? "",
  };
}

function newOrderId() {
  // Ngắn, dễ gõ tay, hợp làm nội dung chuyển khoản.
  return `LX${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

export type CreatedOrder = {
  orderId: string;
  amountVnd: number;
  content: string;
  qrUrl: string;
  bank: { bankCode: string; accountNumber: string; accountName: string };
  label: string;
};

/** Ghi đơn 'pending' và trả về mọi thứ để hiện màn quét QR. */
export async function createPremiumOrder(userId: string, planId: string): Promise<CreatedOrder | { error: string }> {
  const price = priceOrder(planId);
  if (!price) return { error: "Gói không hợp lệ." };
  if (!bankConfigured()) return { error: "Chưa cấu hình tài khoản nhận tiền." };
  const client = adminClient();
  if (!client) return { error: "Chưa cấu hình SUPABASE_SERVICE_ROLE_KEY." };

  const orderId = newOrderId();
  const { error } = await client.from("payment_orders").insert({
    id: orderId,
    user_id: userId,
    provider: "bank",
    kind: "premium",
    pack_id: planId,
    // tier quyết định bậc sẽ được bật khi webhook xác nhận đã trả. Không suy ra
    // từ pack_id ở phía SQL: bảng giá nằm ở lib/pricing.mjs, SQL không đọc được.
    tier: price.tier,
    amount_vnd: price.amountVnd,
    credits: 0,
    days: price.days,
    status: "pending",
  });
  if (error) return { error: "Không tạo được đơn hàng." };

  const bank = bankInfo();
  return {
    orderId,
    amountVnd: price.amountVnd,
    content: orderId,
    label: price.label,
    bank,
    qrUrl: bankQrUrl({
      bankCode: bank.bankCode,
      accountNumber: bank.accountNumber,
      accountName: bank.accountName,
      amountVnd: price.amountVnd,
      content: orderId,
    }),
  };
}

/** Trạng thái đơn cho client hỏi vòng trong lúc chờ chuyển khoản. */
export async function orderStatus(orderId: string, userId: string): Promise<"pending" | "paid" | "failed" | "expired" | "unknown"> {
  const client = adminClient();
  if (!client) return "unknown";
  const { data } = await client
    .from("payment_orders")
    .select("status")
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.status as "pending" | "paid" | "failed" | "expired") ?? "unknown";
}

/**
 * Một giao dịch báo về từ webhook ngân hàng. Tìm đơn 'pending' khớp nội dung +
 * số tiền rồi kích hoạt Premium. Idempotent nhờ apply_paid_order chỉ chạy khi đơn
 * còn 'pending'.
 */
export async function settleBankTransfer(tx: Record<string, unknown>): Promise<{ matched: boolean; orderId: string; applied: boolean }> {
  const miss = { matched: false, orderId: "", applied: false };
  const client = adminClient();
  if (!client) return miss;

  const content = String(tx.content ?? tx.description ?? "").toUpperCase();
  const codes = content.match(/LX[A-Z0-9]{6,12}/g) ?? [];
  if (!codes.length) return miss;

  for (const code of codes) {
    const { data: order } = await client
      .from("payment_orders")
      .select("id, amount_vnd, status")
      .eq("id", code)
      .maybeSingle();
    if (!order) continue;
    if (!transferMatchesOrder(order, tx)) continue;
    if (order.status === "paid") return { matched: true, orderId: code, applied: true };

    const { data: applied } = await client.rpc("apply_paid_order", {
      p_order: code,
      p_provider_ref: String(tx.referenceCode ?? tx.id ?? ""),
      p_raw: tx,
    });
    return { matched: true, orderId: code, applied: Boolean(applied) };
  }
  return miss;
}
