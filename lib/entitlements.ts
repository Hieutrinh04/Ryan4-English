import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Caller } from "./ai-guard";
import { isAdmin } from "./admin";
import { BUCKETS, FEATURE_BUCKET } from "./pricing.mjs";

// Tầng phân quyền phía server: đọc gói của người gọi và đếm mức dùng AI trong
// tháng. Mọi thao tác GHI (bật Premium) đi qua service role — client chỉ đọc.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient | null {
  if (!url || !serviceKey) return null;
  admin ??= createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export function billingReady() {
  return Boolean(url && serviceKey);
}

export type Plan = "guest" | "free" | "lite" | "premium" | "admin";
export type Entitlement = { plan: Plan; premiumUntil: string | null };

/** Các bậc phải trả tiền — hết hạn thì rơi về free. */
const PAID_TIERS = new Set(["lite", "premium"]);

/** Gói hiện tại của người gọi. Tự hạ bậc đã hết hạn xuống free. */
export async function readEntitlement(caller: Caller): Promise<Entitlement> {
  if (isAdmin(caller)) return { plan: "admin", premiumUntil: null };
  if (!caller.userId) return { plan: "guest", premiumUntil: null };
  const client = adminClient();
  if (!client) return { plan: "free", premiumUntil: null };

  const { data } = await client
    .from("user_plans")
    .select("plan, premium_until")
    .eq("user_id", caller.userId)
    .maybeSingle();

  if (!data) return { plan: "free", premiumUntil: null };

  const paid = PAID_TIERS.has(data.plan);
  const active = paid && data.premium_until && Date.parse(data.premium_until) > Date.now();
  if (paid && !active) {
    await client.from("user_plans").update({ plan: "free", updated_at: new Date().toISOString() }).eq("user_id", caller.userId);
  }
  return { plan: active ? (data.plan as Plan) : "free", premiumUntil: data.premium_until ?? null };
}

// Khai tường minh chứ không suy từ BUCKETS: pricing.mjs không có kiểu, nên
// (typeof BUCKETS)[number] chỉ ra `string` và mọi chỗ tra bảng mất kiểm tra kiểu.
// Danh sách này phải khớp BUCKETS trong lib/pricing.mjs.
export type Bucket = "aiLookups" | "aiGrade" | "aiSpeak" | "prosody" | "transcribe";
export type MonthlyUsage = Record<Bucket, number>;

function emptyUsage(): MonthlyUsage {
  return Object.fromEntries((BUCKETS as Bucket[]).map((bucket) => [bucket, 0])) as MonthlyUsage;
}

/**
 * Số lượt AI đã dùng trong THÁNG DƯƠNG LỊCH này, gom theo xô hạn mức.
 *
 * Đếm mọi xô chứ không chỉ hai xô như trước: từ khi có bậc Lite, luyện nói,
 * chấm ngữ điệu và bóc lời video đều có trần riêng theo bậc.
 */
export async function monthlyUsage(caller: Caller): Promise<MonthlyUsage> {
  const usage = emptyUsage();
  if (!caller.userId) return usage;
  const client = adminClient();
  if (!client) return usage;

  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const { data } = await client
    .from("ai_usage")
    .select("feature")
    .eq("user_id", caller.userId)
    .eq("ok", true)
    .gte("created_at", start.toISOString());

  for (const row of data ?? []) {
    const bucket = FEATURE_BUCKET[row.feature as keyof typeof FEATURE_BUCKET] as Bucket | undefined;
    if (bucket && bucket in usage) usage[bucket] += 1;
  }
  return usage;
}
