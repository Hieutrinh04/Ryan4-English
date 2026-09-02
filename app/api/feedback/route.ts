import { NextResponse } from "next/server";
import { identify } from "../../../lib/ai-guard";
import { isAdmin } from "../../../lib/admin";
import { adminClient } from "../../../lib/entitlements";
import { createLimiter } from "../../../lib/rate-limit.mjs";

// Nhận góp ý từ người dùng và trả lại danh sách cho màn Quản trị.
//
// Ghi bằng service role chứ không bằng token của người gửi, vì hai lý do: khách
// chưa đăng nhập cũng phải góp ý được, và bảng feedback cố ý không mở quyền đọc
// cho bất kỳ ai ngoài service role.

const KINDS = new Set(["bug", "idea", "other"]);

// Góp ý là việc người ta làm vài lần một tháng, không phải vài lần một phút.
// Chặn chặt để một tab mở sẵn không biến thành vòi xả rác vào bảng.
const limiter = createLimiter({ windowMs: 60_000, burst: 3, dailyQuota: 20 });

/** Cắt chuỗi về đúng độ dài bảng chấp nhận, tránh để cơ sở dữ liệu báo lỗi thay. */
function trim(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const caller = await identify(request);
  const verdict = limiter.take(caller.key, Date.now());
  if (!verdict.ok) {
    return NextResponse.json(
      { error: "Bạn vừa gửi góp ý xong. Chờ một lát rồi gửi tiếp nhé." },
      { status: 429, headers: { "retry-after": String(verdict.retryAfterSeconds) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Nội dung gửi lên không đọc được." }, { status: 400 });
  }

  const message = trim(body.message, 4000);
  if (message.length < 5) {
    return NextResponse.json({ error: "Hãy viết dài hơn một chút để chúng tôi hiểu ý bạn." }, { status: 400 });
  }
  const kind = KINDS.has(String(body.kind)) ? String(body.kind) : "other";
  // Email người dùng tự điền chỉ dùng khi chưa đăng nhập; đã đăng nhập thì lấy
  // email thật của tài khoản, không tin số liệu từ phía trình duyệt.
  const email = caller.email ?? (trim(body.email, 200) || null);

  const client = adminClient();
  if (!client) {
    return NextResponse.json(
      { error: "Máy chủ chưa cấu hình để nhận góp ý. Vui lòng thử lại sau." },
      { status: 503 },
    );
  }

  const { error } = await client.from("feedback").insert({
    user_id: caller.userId,
    email,
    kind,
    message,
    context: {
      screen: trim(body.screen, 80),
      viewport: trim(body.viewport, 20),
      agent: trim(request.headers.get("user-agent"), 300),
    },
  });
  if (error) {
    // Trả lượt lại: hỏng ở phía chúng ta thì người gửi không đáng bị tính lượt.
    limiter.refund(caller.key, Date.now());
    return NextResponse.json({ error: "Chưa lưu được góp ý. Bạn thử lại giúp nhé." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  const caller = await identify(request);
  if (!isAdmin(caller)) return NextResponse.json({ error: "Không có quyền." }, { status: 403 });
  const client = adminClient();
  if (!client) return NextResponse.json({ items: [] });
  const { data } = await client
    .from("feedback")
    .select("id, email, kind, message, context, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  return NextResponse.json({ items: data ?? [] });
}
