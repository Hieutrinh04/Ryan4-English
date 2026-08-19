import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase = url && publishableKey
  ? createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

/**
 * Gọi route AI kèm token đăng nhập nếu có.
 *
 * Route AI giới hạn số lượt theo người gọi. Không có token thì server chỉ nhận ra
 * được địa chỉ IP và áp hạn mức khách — thấp hơn nhiều. Gắn token vào đây để người
 * đã đăng nhập nhận đúng hạn mức của mình, và để lượt dùng được ghi vào ai_usage.
 */
export async function aiFetch(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  try {
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } catch {
    // Chưa đăng nhập được thì vẫn gọi tiếp với hạn mức khách.
  }
  return fetch(url, { ...init, headers });
}
