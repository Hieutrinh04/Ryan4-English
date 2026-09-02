"use client";

import { useCallback, useEffect, useState } from "react";
import { aiFetch } from "./supabase";

// Gói + mức dùng AI trong tháng của người đang đăng nhập.

/** cap = null nghĩa là bậc này không giới hạn xô đó. */
export type Meter = { used: number; cap: number | null };
export type Bucket = "aiLookups" | "aiGrade" | "aiSpeak" | "prosody" | "transcribe";
export type PlanTier = "guest" | "free" | "lite" | "premium" | "admin";

export type PlanInfo = {
  plan: PlanTier;
  premiumUntil: string | null;
  legacyLibrary: boolean;
  monthly: Record<Bucket, Meter>;
  plans: {
    id: string;
    tier: "lite" | "premium";
    label: string;
    months: number;
    days: number;
    priceVnd: number;
    save?: number;
  }[];
};

export function usePlan(userId: string | null) {
  const [info, setInfo] = useState<PlanInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await aiFetch("/api/me/entitlement");
      if (response.ok) setInfo((await response.json()) as PlanInfo);
    } catch {
      // Không lấy được thì coi như free — client không chặn gì thêm.
    }
  }, []);

  useEffect(() => {
    let alive = true;
    aiFetch("/api/me/entitlement")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (alive && data) setInfo(data as PlanInfo); })
      .catch(() => {});
    return () => { alive = false; };
  }, [userId]);

  return { plan: info, refresh };
}

export type CreatedOrder = {
  orderId: string;
  amountVnd: number;
  content: string;
  qrUrl: string;
  bank: { bankCode: string; accountNumber: string; accountName: string };
  label: string;
};

/** Tạo đơn Premium, trả về thông tin QR để hiện, hoặc chuỗi lỗi. */
export async function createOrder(planId: string): Promise<CreatedOrder | string> {
  const response = await aiFetch("/api/pay/create", { method: "POST", body: JSON.stringify({ planId }) });
  const data = (await response.json().catch(() => ({}))) as CreatedOrder & { error?: string };
  if (!response.ok || !data.orderId) return data.error ?? "Không tạo được đơn hàng.";
  return data;
}

/** Trạng thái đơn: 'pending' | 'paid' | ... */
export async function checkOrder(orderId: string): Promise<string> {
  try {
    const response = await aiFetch(`/api/pay/order/status?id=${encodeURIComponent(orderId)}`);
    const data = (await response.json()) as { status?: string };
    return data.status ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ── Quản trị ──────────────────────────────────────────────────────────────
export type AdminOrder = {
  id: string; email: string; kind: string; pack_id: string; amount_vnd: number;
  days: number; status: string; created_at: string; paid_at: string | null;
};

export async function adminGrant(email: string, opts: { days?: number; revoke?: boolean }): Promise<string> {
  const response = await aiFetch("/api/admin/grant", { method: "POST", body: JSON.stringify({ email, ...opts }) });
  const data = (await response.json().catch(() => ({}))) as { premiumUntil?: string; error?: string };
  if (!response.ok) return data.error ?? "Không thực hiện được.";
  return opts.revoke
    ? `Đã hạ ${email} về Free.`
    : `Đã bật Premium cho ${email} đến ${data.premiumUntil ? new Date(data.premiumUntil).toLocaleDateString("vi-VN") : "?"}.`;
}

export async function adminOrders(): Promise<AdminOrder[]> {
  try {
    const response = await aiFetch("/api/admin/orders");
    if (!response.ok) return [];
    const data = (await response.json()) as { orders?: AdminOrder[] };
    return data.orders ?? [];
  } catch {
    return [];
  }
}
