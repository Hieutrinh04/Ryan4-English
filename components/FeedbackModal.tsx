"use client";

import { useState, type FormEvent } from "react";
import Icon from "./Icon";
import { aiFetch } from "../lib/supabase";
import { useEscape } from "./useEscape";

// Góp ý cho hệ thống: gửi từ bất kỳ màn nào, không phải rời việc đang làm.

type Kind = "bug" | "idea" | "other";

const KINDS: { key: Kind; label: string; note: string; icon: "flag" | "target" | "list" }[] = [
  { key: "bug", label: "Báo lỗi", note: "Có gì đó chạy sai hoặc không bấm được", icon: "flag" },
  { key: "idea", label: "Ý tưởng", note: "Bạn muốn app có thêm thứ gì", icon: "target" },
  { key: "other", label: "Khác", note: "Nhận xét chung, câu hỏi, lời nhắn", icon: "list" },
];

const MIN = 5;
const MAX = 4000;

export default function FeedbackModal({ close, screen, signedInEmail }: {
  close: () => void;
  /** Màn đang mở lúc bấm Góp ý — gửi kèm để tái hiện lỗi mà không phải hỏi lại. */
  screen: string;
  signedInEmail: string | null;
}) {
  useEscape(close);
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (message.trim().length < MIN) {
      setError("Hãy viết dài hơn một chút để chúng tôi hiểu ý bạn.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const response = await aiFetch("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          kind,
          message: message.trim(),
          email: email.trim(),
          screen,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) setError(data.error ?? "Chưa gửi được. Bạn thử lại giúp nhé.");
      else setSent(true);
    } catch {
      setError("Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại nhé.");
    }
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="modal feedback-modal" role="dialog" aria-modal="true" aria-label="Góp ý cho hệ thống">
        <div className="modal-head">
          <div>
            <span className="eyebrow">GÓP Ý</span>
            <h2>{sent ? "Đã nhận, cảm ơn bạn!" : "Bạn thấy chỗ nào chưa ổn?"}</h2>
          </div>
          <button type="button" onClick={close} aria-label="Đóng">×</button>
        </div>

        {sent ? (
          <div className="feedback-done">
            <Icon name="check" size={30} />
            <p>Góp ý của bạn đã được ghi lại. Những gì sửa được sẽ xuất hiện ở mục <b>Cập nhật</b> cuối Trang chủ.</p>
            <button className="primary" onClick={close}>Quay lại học</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="feedback-kinds" role="group" aria-label="Loại góp ý">
              {KINDS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={item.key === kind ? "feedback-kind active" : "feedback-kind"}
                  aria-pressed={item.key === kind}
                  onClick={() => setKind(item.key)}
                >
                  <Icon name={item.icon} size={17} />
                  <b>{item.label}</b>
                  <small>{item.note}</small>
                </button>
              ))}
            </div>

            <label className="feedback-field">
              Nội dung
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value.slice(0, MAX))}
                rows={6}
                placeholder={kind === "bug"
                  ? "Bạn đang làm gì thì gặp lỗi? Bạn mong nó chạy thế nào?"
                  : kind === "idea"
                    ? "Bạn muốn thêm gì, và nó giúp bạn học tốt hơn ra sao?"
                    : "Viết bất cứ điều gì bạn muốn nhắn."}
              />
              <i className="feedback-count">{message.trim().length}/{MAX}</i>
            </label>

            {/* Đã đăng nhập thì lấy email của tài khoản, hỏi lại là thừa. */}
            {!signedInEmail && (
              <label className="feedback-field">
                Email để nhận trả lời <span className="muted">(không bắt buộc)</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ban@email.com" />
              </label>
            )}

            <p className="feedback-note">
              <Icon name="flag" size={13} /> Gửi kèm màn hình bạn đang mở và cỡ cửa sổ để chúng tôi tái hiện đúng tình huống.
            </p>
            {error && <p className="feedback-error" role="status">{error}</p>}
            <div className="modal-actions">
              <button type="button" onClick={close}>Huỷ</button>
              <button type="submit" className="primary" disabled={busy || message.trim().length < MIN}>
                {busy ? "Đang gửi…" : "Gửi góp ý"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
