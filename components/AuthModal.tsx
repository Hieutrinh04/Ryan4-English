"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { authErrorMessage, cleanDisplayName, MIN_PASSWORD_LENGTH, normalizeEmail, passwordStrength, validateDisplayName, validateEmail, validatePassword } from "../lib/auth.mjs";
import { useEscape } from "./useEscape";

type Mode = "signin" | "signup" | "magic" | "forgot" | "recovery";

export default function AuthModal({ close, signedIn, signedInEmail, signedInName = "", startMode = "signin", syncStatus = "synced" }: {
  close: () => void;
  signedIn?: boolean;
  signedInEmail: string | null;
  signedInName?: string;
  startMode?: Mode;
  syncStatus?: "connecting" | "synced" | "demo";
}) {
  useEscape(close);
  const [mode, setMode] = useState<Mode>(startMode);
  const [name, setName] = useState(signedInName);
  const [email, setEmail] = useState(signedInEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [canResend, setCanResend] = useState(false);
  const strength = useMemo(() => passwordStrength(password), [password]);

  // Liên kết đặt lại mật khẩu tạo một phiên tạm và phát PASSWORD_RECOVERY.
  // Màn recovery phải được ưu tiên kể cả khi phiên đó đã làm signedInEmail có giá trị.
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("recovery");
    });
    return () => data.subscription.unsubscribe();
  }, []);

  function resetMessages() {
    setError("");
    setNote("");
    setCanResend(false);
    setConfirmationPending(false);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setPassword("");
    setConfirm("");
    setShowPassword(false);
    resetMessages();
  }

  function redirectTo() {
    return `${window.location.origin}${window.location.pathname}`;
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    resetMessages();
    if (!supabase) {
      setError("Chưa cấu hình kết nối Supabase cho ứng dụng.");
      return;
    }

    const cleanEmail = normalizeEmail(email);
    const cleanName = cleanDisplayName(name);
    const emailError = mode === "recovery" ? "" : validateEmail(cleanEmail);
    const nameError = mode === "signup" ? validateDisplayName(cleanName) : "";
    const passwordError = mode === "signin"
      ? (!password ? "Vui lòng nhập mật khẩu." : "")
      : mode === "signup" || mode === "recovery"
        ? validatePassword(password, confirm)
        : "";
    if (emailError || nameError || passwordError) {
      setError(emailError || nameError || passwordError);
      return;
    }

    setEmail(cleanEmail);
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: problem } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (problem) throw problem;
        window.location.reload();
        return;
      }
      if (mode === "signup") {
        const { data, error: problem } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: redirectTo(),
            data: { full_name: cleanName, name: cleanName },
          },
        });
        if (problem) throw problem;
        // Khi bật chống dò tài khoản, Supabase có thể trả về user giả với identities
        // rỗng thay vì báo lỗi nếu email đã tồn tại.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setError("Email này đã có tài khoản. Hãy chuyển sang đăng nhập.");
          return;
        }
        if (data.session) {
          window.location.reload();
          return;
        }
        setConfirmationPending(true);
        setCanResend(true);
        setNote(`Đã tạo tài khoản cho ${cleanEmail}. Hãy mở email và bấm liên kết xác nhận.`);
      }
      if (mode === "magic") {
        const { error: problem } = await supabase.auth.signInWithOtp({
          email: cleanEmail,
          options: { emailRedirectTo: redirectTo(), shouldCreateUser: false },
        });
        if (problem) throw problem;
        setConfirmationPending(true);
        setNote(`Đã gửi liên kết đăng nhập đến ${cleanEmail}.`);
      }
      if (mode === "forgot") {
        const { error: problem } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: redirectTo() });
        if (problem) throw problem;
        setConfirmationPending(true);
        setNote(`Nếu ${cleanEmail} đã đăng ký, bạn sẽ nhận được email đặt lại mật khẩu.`);
      }
      if (mode === "recovery") {
        const { error: problem } = await supabase.auth.updateUser({ password });
        if (problem) throw problem;
        setNote("Đã đổi mật khẩu. Bạn có thể tiếp tục sử dụng tài khoản.");
        setPassword("");
        setConfirm("");
        window.setTimeout(() => window.location.reload(), 700);
      }
    } catch (problem) {
      const code = String((problem as { code?: string })?.code ?? "").toLowerCase();
      const message = String((problem as { message?: string })?.message ?? "").toLowerCase();
      setCanResend(code.includes("email_not_confirmed") || message.includes("email not confirmed"));
      setError(authErrorMessage(problem));
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    resetMessages();
    if (!supabase) return setError("Chưa cấu hình kết nối Supabase cho ứng dụng.");
    const cleanEmail = normalizeEmail(email);
    const emailError = validateEmail(cleanEmail);
    if (emailError) return setError(emailError);
    setBusy(true);
    try {
      const { error: problem } = await supabase.auth.resend({ type: "signup", email: cleanEmail, options: { emailRedirectTo: redirectTo() } });
      if (problem) throw problem;
      setConfirmationPending(true);
      setCanResend(true);
      setNote(`Đã gửi lại email xác nhận đến ${cleanEmail}.`);
    } catch (problem) {
      setCanResend(true);
      setError(authErrorMessage(problem));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    resetMessages();
    try {
      const { error: problem } = await supabase?.auth.signOut() ?? { error: new Error("Supabase is not configured") };
      if (problem) throw problem;
      window.location.reload();
    } catch (problem) {
      setError(authErrorMessage(problem));
      setBusy(false);
    }
  }

  async function saveDisplayName() {
    resetMessages();
    if (!supabase) return setError("Chưa cấu hình kết nối Supabase cho ứng dụng.");
    const cleanName = cleanDisplayName(name);
    const nameError = validateDisplayName(cleanName);
    if (nameError) return setError(nameError);
    setBusy(true);
    try {
      const { error: problem } = await supabase.auth.updateUser({ data: { full_name: cleanName, name: cleanName } });
      if (problem) throw problem;
      setName(cleanName);
      setNote("Đã lưu tên hiển thị. Tên mới sẽ được dùng trên hồ sơ và bảng xếp hạng.");
    } catch (problem) {
      setError(authErrorMessage(problem));
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Mode, string> = {
    signin: "Đăng nhập",
    signup: "Tạo tài khoản",
    magic: "Đăng nhập bằng liên kết",
    forgot: "Quên mật khẩu",
    recovery: "Đặt mật khẩu mới",
  };
  const showAccount = Boolean(signedIn || signedInEmail) && mode !== "recovery";
  const needsPassword = mode === "signin" || mode === "signup" || mode === "recovery";
  const showcaseTitle = mode === "signup"
    ? "Bắt đầu một hành trình học có hệ thống."
    : mode === "forgot" || mode === "recovery"
      ? "Quay lại việc học chỉ trong vài bước."
      : "Tiếp tục từ đúng nơi bạn đã dừng lại.";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <form className={`modal auth-modal auth-modal-${mode}`} role="dialog" aria-modal="true" aria-labelledby="auth-title" onSubmit={run}>
        <aside className="auth-showcase" aria-hidden="true">
          <div className="auth-brand"><span>L</span><b>Lexilo</b></div>
          <div className="auth-showcase-copy">
            <span className="auth-kicker">HỌC LIỀN MẠCH</span>
            <h3>{showAccount ? "Mọi tiến bộ đều được lưu lại." : showcaseTitle}</h3>
            <p>Một tài khoản kết nối từ vựng, bài luyện và phản hồi AI trên mọi thiết bị.</p>
          </div>
          <div className="auth-benefits">
            <span><i>✓</i> Đồng bộ tiến độ học</span>
            <span><i>✓</i> Lưu toàn bộ kho từ vựng</span>
            <span><i>✓</i> Tiếp tục bài đang luyện</span>
          </div>
          <div className="auth-orbit"><i /><i /><i /></div>
        </aside>

        <section className="auth-form-panel">
          <div className="modal-head auth-head">
            <div>
              <span className="eyebrow">TÀI KHOẢN LEXILO</span>
              <h2 id="auth-title">{showAccount ? "Hồ sơ cá nhân" : titles[mode]}</h2>
              {!showAccount && <p>{mode === "signup" ? "Miễn phí để bắt đầu, không cần thẻ thanh toán." : mode === "signin" ? "Chào mừng bạn quay lại với Lexilo." : "Chúng mình sẽ giúp bạn truy cập lại tài khoản."}</p>}
            </div>
            <button type="button" onClick={close} aria-label="Đóng" disabled={busy}>×</button>
          </div>

          {showAccount ? (
            <>
            <div className="auth-account">
              <div className="auth-account-avatar">{(signedInName || signedInEmail || "L").trim().charAt(0).toUpperCase()}</div>
              <div><span>{signedInName || signedInEmail?.split("@")[0]}</span><b>{signedInEmail}</b></div>
              <small className={`sync-${syncStatus}`}><i />{syncStatus === "synced" ? "Dữ liệu đã được đồng bộ" : syncStatus === "connecting" ? "Đang đồng bộ dữ liệu" : "Đã đăng nhập · đồng bộ chưa sẵn sàng"}</small>
            </div>
            <div className="auth-profile-edit">
              <div className="auth-profile-label">
                <div><b>Tên hiển thị</b><small>Dùng trong lời chào, hồ sơ và bảng xếp hạng.</small></div>
                <span>{name.length}/40</span>
              </div>
              <div className="auth-profile-field">
                <input aria-label="Tên hiển thị" type="text" autoComplete="name" maxLength={40} value={name} onChange={(event) => { setName(event.target.value); resetMessages(); }} placeholder="Nhập tên bạn muốn hiển thị" />
                <button type="button" disabled={busy || cleanDisplayName(name) === cleanDisplayName(signedInName)} onClick={() => void saveDisplayName()}>{busy ? "Đang lưu…" : "Lưu tên"}</button>
              </div>
            </div>
            {error && <p className="auth-message auth-error" role="alert">{error}</p>}
            {note && <p className="auth-message auth-ok" role="status">{note}</p>}
            <div className="auth-account-actions">
              <button type="button" onClick={() => switchMode("recovery")}>Đổi mật khẩu</button>
              <button type="button" className="auth-logout" disabled={busy} onClick={() => void logout()}>{busy ? "Đang đăng xuất…" : "Đăng xuất"}</button>
            </div>
            </>
          ) : (
            <>
            {(mode === "signin" || mode === "signup") && (
              <div className="auth-tabs" role="tablist" aria-label="Chọn đăng nhập hoặc đăng ký">
                <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "active" : ""} onClick={() => switchMode("signin")}>Đăng nhập</button>
                <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} onClick={() => switchMode("signup")}>Đăng ký</button>
              </div>
            )}

            <p className="auth-copy">
              {confirmationPending
                ? "Liên kết có thể mất một vài phút để đến. Hãy kiểm tra cả thư mục Spam/Thư rác."
                : mode === "magic"
                  ? "Nhận liên kết đăng nhập qua email, không cần nhập mật khẩu."
                  : mode === "forgot"
                    ? "Nhập email đã đăng ký để nhận liên kết đặt lại mật khẩu."
                    : mode === "recovery"
                      ? "Tạo mật khẩu mới cho tài khoản của bạn."
                      : mode === "signup"
                        ? "Tạo tài khoản để lưu từ vựng và tiếp tục học trên mọi thiết bị."
                        : "Đăng nhập để đồng bộ từ vựng và toàn bộ tiến độ học."}
            </p>

            {!confirmationPending && mode === "signup" && (
              <label>
                Tên hiển thị
                <input type="text" required autoComplete="name" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Ryan" />
              </label>
            )}

            {!confirmationPending && mode !== "recovery" && (
              <label>
                Địa chỉ email
                <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ban@example.com" />
              </label>
            )}

            {!confirmationPending && needsPassword && (
              <label>
                {mode === "recovery" ? "Mật khẩu mới" : "Mật khẩu"}
                <span className="auth-password">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={mode === "signin" ? undefined : MIN_PASSWORD_LENGTH}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={mode === "signin" ? "Nhập mật khẩu" : `Ít nhất ${MIN_PASSWORD_LENGTH} ký tự`}
                  />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>{showPassword ? "Ẩn" : "Hiện"}</button>
                </span>
              </label>
            )}

            {!confirmationPending && (mode === "signup" || mode === "recovery") && (
              <>
                <div className={`auth-strength s${strength.score}`} aria-live="polite"><i /><i /><i /><span>{strength.label ? `Độ mạnh: ${strength.label}` : `Dùng ít nhất ${MIN_PASSWORD_LENGTH} ký tự`}</span></div>
                <label>
                  Nhập lại mật khẩu
                  <input type={showPassword ? "text" : "password"} required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
                </label>
              </>
            )}

            {error && <p className="auth-message auth-error" role="alert">{error}</p>}
            {note && <p className="auth-message auth-ok" role="status">{note}</p>}

            <div className="modal-actions">
              <button type="button" onClick={confirmationPending ? () => switchMode("signin") : close}>{confirmationPending ? "Về đăng nhập" : "Để sau"}</button>
              {!confirmationPending && (
                <button className="primary" disabled={busy}>
                  {busy ? "Đang xử lý…" : mode === "signin" ? "Đăng nhập" : mode === "signup" ? "Tạo tài khoản" : mode === "magic" ? "Gửi liên kết" : mode === "forgot" ? "Gửi liên kết đặt lại" : "Lưu mật khẩu mới"}
                </button>
              )}
            </div>

            {(canResend || (confirmationPending && mode === "signup")) && (
              <button className="auth-resend" type="button" disabled={busy} onClick={() => void resendConfirmation()}>{busy ? "Đang gửi…" : "Gửi lại email xác nhận"}</button>
            )}

            {!confirmationPending && mode !== "recovery" && (
              <div className="auth-alt">
                {mode === "signin" && <button type="button" onClick={() => switchMode("forgot")}>Quên mật khẩu?</button>}
                {mode !== "magic"
                  ? <button type="button" onClick={() => switchMode("magic")}>Đăng nhập bằng liên kết email</button>
                  : <button type="button" onClick={() => switchMode("signin")}>← Đăng nhập bằng mật khẩu</button>}
              </div>
            )}
            </>
          )}
        </section>
      </form>
    </div>
  );
}
