export const MIN_PASSWORD_LENGTH = 8;

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function cleanDisplayName(value) {
  return String(value ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return "Vui lòng nhập địa chỉ email.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Địa chỉ email chưa đúng định dạng.";
  return "";
}

export function validateDisplayName(value) {
  const name = cleanDisplayName(value);
  if (name.length < 2) return "Tên hiển thị cần ít nhất 2 ký tự.";
  return "";
}

export function validatePassword(value, confirmation) {
  const password = String(value ?? "");
  if (password.length < MIN_PASSWORD_LENGTH) return `Mật khẩu cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
  if (confirmation !== undefined && password !== confirmation) return "Hai ô mật khẩu chưa khớp.";
  return "";
}

export function passwordStrength(value) {
  const password = String(value ?? "");
  if (!password) return { score: 0, label: "" };
  let score = password.length >= MIN_PASSWORD_LENGTH ? 1 : 0;
  if (/[a-z]/i.test(password) && /\d/.test(password)) score += 1;
  if (/[^a-z0-9]/i.test(password) || password.length >= 12) score += 1;
  return score <= 1
    ? { score: 1, label: "Yếu" }
    : score === 2
      ? { score: 2, label: "Khá" }
      : { score: 3, label: "Mạnh" };
}

export function authErrorMessage(problem) {
  const code = String(problem?.code ?? "").toLowerCase();
  const message = String(problem?.message ?? problem ?? "").toLowerCase();
  const text = `${code} ${message}`;
  if (text.includes("email_address_invalid") || text.includes("invalid email")) return "Địa chỉ email chưa đúng định dạng.";
  if (text.includes("invalid login credentials")) return "Email hoặc mật khẩu không đúng.";
  if (text.includes("email not confirmed") || text.includes("email_not_confirmed")) return "Email chưa được xác nhận. Hãy mở email xác nhận hoặc gửi lại liên kết.";
  if (text.includes("user already registered") || text.includes("user_already_exists")) return "Email này đã có tài khoản. Hãy chuyển sang đăng nhập.";
  if (text.includes("signup is disabled") || text.includes("signup_disabled")) return "Hệ thống đang tạm khóa đăng ký tài khoản mới.";
  if (text.includes("rate limit") || text.includes("over_email_send_rate_limit")) return "Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.";
  if (text.includes("weak_password") || text.includes("password should be at least")) return `Mật khẩu chưa đủ mạnh. Hãy dùng ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
  if (text.includes("same_password")) return "Mật khẩu mới phải khác mật khẩu hiện tại.";
  if (text.includes("otp_expired") || text.includes("token has expired")) return "Liên kết đã hết hạn. Vui lòng yêu cầu một liên kết mới.";
  if (text.includes("signups not allowed for otp") || text.includes("user not found")) return "Email này chưa có tài khoản. Hãy đăng ký trước.";
  if (text.includes("session") && (text.includes("missing") || text.includes("expired"))) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (text.includes("network") || text.includes("fetch")) return "Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.";
  return "Không thể hoàn tất thao tác. Vui lòng thử lại.";
}

export function initialsFor(name, email = "") {
  const source = cleanDisplayName(name) || normalizeEmail(email).split("@")[0] || "LX";
  const words = source.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words.at(-1)[0]}` : source.slice(0, 2)).toUpperCase();
}
