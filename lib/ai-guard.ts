import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createLimiter, limitMessage } from "./rate-limit.mjs";

// Cổng chung cho mọi route AI: nhận diện người gọi, giới hạn số lượt, và ghi lại
// mức dùng vào bảng ai_usage.
//
// Đăng nhập chưa bắt buộc — ứng dụng vẫn chạy được hoàn toàn bằng localStorage —
// nên khách vãng lai vẫn gọi được, chỉ với hạn mức thấp hơn nhiều. Khi đã bắt
// buộc đăng nhập thì chỉ cần bỏ nhánh khách là xong.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function limitFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// Khách vãng lai bị khoá chặt vì chỉ nhận diện được bằng địa chỉ IP, mà IP thì
// chia sẻ được và đổi được.
const guestLimiter = createLimiter({
  windowMs: 60_000,
  burst: limitFromEnv("AI_GUEST_BURST", 4),
  dailyQuota: limitFromEnv("AI_GUEST_DAILY", 40),
});
const memberLimiter = createLimiter({
  windowMs: 60_000,
  burst: limitFromEnv("AI_MEMBER_BURST", 12),
  dailyQuota: limitFromEnv("AI_MEMBER_DAILY", 400),
});

export type Caller = { userId: string | null; token: string | null; key: string };

function bearer(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function callerAddress(request: Request) {
  // Cloudflare đặt CF-Connecting-IP và không cho client giả mạo header này.
  const forwarded = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return request.headers.get("cf-connecting-ip") || forwarded || "khong-ro";
}

/** Xác thực token nếu có. Token hỏng bị coi như khách, không phải lỗi. */
export async function identify(request: Request): Promise<Caller> {
  const token = bearer(request);
  if (!token || !url || !publishableKey) return { userId: null, token: null, key: `ip:${callerAddress(request)}` };
  try {
    const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return { userId: null, token: null, key: `ip:${callerAddress(request)}` };
    return { userId: data.user.id, token, key: `user:${data.user.id}` };
  } catch {
    return { userId: null, token: null, key: `ip:${callerAddress(request)}` };
  }
}

/** Trừ một lượt. Trả về NextResponse 429 nếu hết lượt, null nếu được đi tiếp. */
export function spend(caller: Caller, now = Date.now()) {
  const limiter = caller.userId ? memberLimiter : guestLimiter;
  const verdict = limiter.take(caller.key, now);
  if (verdict.ok) return null;
  return NextResponse.json(
    { error: limitMessage(verdict.reason, verdict.retryAfterSeconds) },
    { status: 429, headers: { "retry-after": String(verdict.retryAfterSeconds) } },
  );
}

/** Trả lại lượt khi hỏng vì phía chúng ta — người học không đáng bị trừ. */
export function refund(caller: Caller, now = Date.now()) {
  (caller.userId ? memberLimiter : guestLimiter).refund(caller.key, now);
}

type Usage = { feature: string; ok: boolean; promptChars: number; latencyMs: number; provider?: string; model?: string };

/**
 * Ghi lại một lượt dùng AI. Chỉ ghi được khi đã đăng nhập vì RLS đòi auth.uid()
 * khớp user_id. Ghi hỏng thì bỏ qua — không để việc thống kê làm hỏng bài học.
 */
export async function logUsage(caller: Caller, usage: Usage) {
  if (!caller.userId || !caller.token || !url || !publishableKey) return;
  try {
    const client = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${caller.token}` } },
    });
    await client.from("ai_usage").insert({
      user_id: caller.userId,
      feature: usage.feature,
      provider: usage.provider ?? null,
      model: usage.model ?? null,
      ok: usage.ok,
      prompt_chars: usage.promptChars,
      latency_ms: usage.latencyMs,
    });
  } catch {
    // Không làm gì: thống kê hỏng không được phép chặn người học.
  }
}
