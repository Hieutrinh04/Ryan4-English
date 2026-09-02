import type { Caller } from "./ai-guard";
import { adminClient } from "./entitlements";

// Quản trị viên: bạn (chủ app). Danh sách để trong .env.local, KHÔNG trong DB, để
// không ai tự nâng mình lên admin dù chiếm được quyền ghi bảng.
//
//   ADMIN_EMAILS=ban@gmail.com,dong-nghiep@gmail.com
//   (hoặc ADMIN_USER_IDS=uuid1,uuid2 nếu muốn khoá theo id)

function list(name: string) {
  return (process.env[name] ?? "")
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(caller: Caller): boolean {
  if (!caller.userId) return false;
  const emails = list("ADMIN_EMAILS");
  const ids = list("ADMIN_USER_IDS");
  return (
    (caller.email ? emails.includes(caller.email.toLowerCase()) : false) ||
    ids.includes(caller.userId.toLowerCase())
  );
}

/**
 * Bộ từ theo thứ + PDF là dữ liệu cá nhân từ phiên bản một người dùng cũ.
 * Có thể cấu hình chủ sở hữu riêng; nếu chưa cấu hình thì dùng danh sách admin
 * hiện tại để bản cài đang chạy không làm mất kho cũ của chủ ứng dụng.
 */
export function isLegacyLibraryOwner(caller: Caller): boolean {
  if (!caller.userId) return false;
  const emails = list("LEGACY_LIBRARY_EMAILS");
  const ids = list("LEGACY_LIBRARY_USER_IDS");
  if (!emails.length && !ids.length) return isAdmin(caller);
  return (
    (caller.email ? emails.includes(caller.email.toLowerCase()) : false) ||
    ids.includes(caller.userId.toLowerCase())
  );
}

/** Tìm user theo email (phân trang, dừng khi thấy). */
async function findUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const client = adminClient();
  if (!client) return null;
  const needle = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data.users.length) return null;
    const hit = data.users.find((user) => (user.email ?? "").toLowerCase() === needle);
    if (hit) return { id: hit.id, email: hit.email ?? needle };
    if (data.users.length < 200) return null;
  }
  return null;
}

export type GrantResult = { ok: true; email: string; premiumUntil: string } | { ok: false; error: string };

/** Bật/gia hạn Premium cho một tài khoản, cộng thêm `days` ngày kể từ hạn hiện tại. */
export async function grantPremium(email: string, days: number): Promise<GrantResult> {
  const client = adminClient();
  if (!client) return { ok: false, error: "Chưa cấu hình SUPABASE_SERVICE_ROLE_KEY." };
  const span = Math.max(1, Math.min(3650, Math.round(days) || 0));
  const user = await findUserByEmail(email);
  if (!user) return { ok: false, error: `Không tìm thấy tài khoản ${email}.` };

  await client.from("user_plans").upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data: current } = await client.from("user_plans").select("premium_until").eq("user_id", user.id).maybeSingle();
  const base = current?.premium_until && Date.parse(current.premium_until) > Date.now() ? Date.parse(current.premium_until) : Date.now();
  const until = new Date(base + span * 86_400_000).toISOString();

  const { error } = await client
    .from("user_plans")
    .update({ plan: "premium", premium_until: until, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Không cập nhật được gói." };

  await client.from("credit_ledger").insert({
    user_id: user.id, delta: 0, balance_after: 0, reason: "admin", ref: `grant:${span}d`,
  });
  return { ok: true, email: user.email, premiumUntil: until };
}

/** Hạ một tài khoản về Free ngay. */
export async function revokePremium(email: string): Promise<GrantResult> {
  const client = adminClient();
  if (!client) return { ok: false, error: "Chưa cấu hình SUPABASE_SERVICE_ROLE_KEY." };
  const user = await findUserByEmail(email);
  if (!user) return { ok: false, error: `Không tìm thấy tài khoản ${email}.` };
  await client
    .from("user_plans")
    .update({ plan: "free", premium_until: null, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  return { ok: true, email: user.email, premiumUntil: "" };
}

/** Đơn hàng gần đây, kèm email người mua. */
export async function recentOrders(limit = 40) {
  const client = adminClient();
  if (!client) return [];
  const { data } = await client
    .from("payment_orders")
    .select("id, user_id, kind, pack_id, amount_vnd, days, status, created_at, paid_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  const orders = data ?? [];
  if (!orders.length) return [];

  const ids = [...new Set(orders.map((order) => order.user_id))];
  const emails = new Map<string, string>();
  for (let page = 1; page <= 20 && emails.size < ids.length; page += 1) {
    const { data: users } = await client.auth.admin.listUsers({ page, perPage: 200 });
    for (const user of users?.users ?? []) if (user.email) emails.set(user.id, user.email);
    if (!users?.users.length || users.users.length < 200) break;
  }
  return orders.map((order) => ({ ...order, email: emails.get(order.user_id) ?? order.user_id.slice(0, 8) }));
}
