"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { checkOrder, createOrder, type Bucket, type CreatedOrder, type PlanInfo } from "../lib/use-plan";
import { PLAN_LIMITS } from "../lib/pricing.mjs";

// Màn Nâng cấp: chọn bậc → chọn thời hạn → hiện QR chuyển khoản → chờ xác nhận.

function vnd(amount: number) {
  return `${Math.round(amount).toLocaleString("vi-VN")}₫`;
}

type Tier = "lite" | "premium";

const TIER_COPY: Record<Tier, { name: string; tagline: string }> = {
  lite: { name: "Lite", tagline: "Mở khoá phần AI dùng hằng ngày." },
  premium: { name: "Premium", tagline: "Mở hết, kèm bóc lời video bạn tự thêm." },
};

/**
 * Bảng so sánh lấy số THẲNG từ PLAN_LIMITS — cùng nguồn mà gate() dùng để chặn.
 * Nếu chép tay, chỉ cần sửa hạn mức một lần là bảng quảng cáo nói sai với thứ
 * người dùng thực sự nhận được.
 */
const ROWS: { bucket: Bucket; label: string }[] = [
  { bucket: "aiLookups", label: "Truy vấn AI · tra từ, gợi ý phát âm, sinh đoạn văn" },
  { bucket: "aiGrade", label: "Chấm bài viết AI" },
  { bucket: "aiSpeak", label: "Luyện nói cùng AI" },
  { bucket: "prosody", label: "Chấm ngữ điệu · Nói nhại" },
  { bucket: "transcribe", label: "Bóc lời video chưa có phụ đề" },
];

/** Những thứ miễn phí ở mọi bậc — nói rõ ra để người dùng biết mình không mất gì. */
const ALWAYS_FREE = [
  "Kho từ vựng không giới hạn",
  "Ôn tập Leitner, thẻ ghi nhớ, 6 kiểu luyện",
  "Tra nhanh, phiên âm IPA, xếp bậc CEFR, dịch câu",
  "Nghe chép với video đã có sẵn phụ đề",
];

function cell(cap: number | null | undefined) {
  if (cap === null || cap === undefined) return "Không giới hạn";
  if (cap === 0) return "–";
  return `${cap}/tháng`;
}

export default function Upgrade({ plan, signedIn, onClose, onNeedSignIn, onPaid }: {
  plan: PlanInfo | null;
  signedIn: boolean;
  onClose: () => void;
  onNeedSignIn: () => void;
  onPaid: () => void;
}) {
  const plans = plan?.plans ?? [];
  const current = plan?.plan ?? "free";

  // Người đang dùng Lite thì mặc định xem Premium — họ đã trả tiền rồi, mời lại
  // đúng thứ họ đang có là vô nghĩa.
  const [tier, setTier] = useState<Tier>(current === "lite" ? "premium" : "premium");
  const [months, setMonths] = useState(3);
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paid, setPaid] = useState(false);
  const poll = useRef<number | null>(null);

  const tierPlans = useMemo(() => plans.filter((item) => item.tier === tier), [plans, tier]);
  const selected = tierPlans.find((item) => item.months === months) ?? tierPlans[0];

  const alreadyHas = current === tier || (current === "premium" && tier === "lite");

  // Chờ chuyển khoản: hỏi trạng thái đơn mỗi 4 giây.
  useEffect(() => {
    if (!order || paid) return;
    poll.current = window.setInterval(async () => {
      const status = await checkOrder(order.orderId);
      if (status === "paid") {
        setPaid(true);
        onPaid();
        if (poll.current) window.clearInterval(poll.current);
      }
    }, 4000);
    return () => { if (poll.current) window.clearInterval(poll.current); };
  }, [order, paid, onPaid]);

  async function start() {
    if (!signedIn) { onNeedSignIn(); return; }
    if (!selected) return;
    setError("");
    setBusy(true);
    const result = await createOrder(selected.id);
    setBusy(false);
    if (typeof result === "string") setError(result);
    else setOrder(result);
  }

  const currentLabel =
    current === "admin" ? "Quản trị"
      : current === "premium" ? "Premium"
        : current === "lite" ? "Lite"
          : current === "guest" ? "Khách" : "Free";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal upgrade-modal" role="dialog" aria-modal="true" aria-label="Nâng cấp tài khoản">
        <div className="modal-head">
          <h2>{order ? "Quét mã QR để thanh toán" : "Nâng cấp tài khoản"}</h2>
          <button onClick={onClose} aria-label="Đóng">×</button>
        </div>

        {paid ? (
          <div className="upgrade-done">
            <Icon name="check" size={30} />
            <p>Thanh toán thành công! Tài khoản của bạn đã được nâng cấp.</p>
            <button className="primary" onClick={onClose}>Bắt đầu học</button>
          </div>
        ) : order ? (
          <div className="qr-pay">
            <p className="qr-checking"><i className="spin" /> Đang chờ xác nhận thanh toán…</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="qr-image" src={order.qrUrl} alt="Mã QR chuyển khoản" width={260} height={260} />
            <dl className="qr-info">
              <div><dt>Ngân hàng</dt><dd>{order.bank.bankCode}{order.bank.accountName ? ` · ${order.bank.accountName}` : ""}</dd></div>
              <div><dt>Số tài khoản</dt><dd>{order.bank.accountNumber}</dd></div>
              <div><dt>Số tiền</dt><dd>{vnd(order.amountVnd)}</dd></div>
              <div><dt>Nội dung</dt><dd className="qr-code">{order.content}</dd></div>
            </dl>
            <p className="qr-note">
              <Icon name="flag" size={13} /> Chuyển khoản đúng <b>số tiền</b> và <b>nội dung</b> ở trên. Hệ thống tự xác nhận trong vài chục giây.
            </p>
            <button className="qr-back" onClick={() => setOrder(null)}>← Chọn gói khác</button>
          </div>
        ) : (
          <>
            {plan && (
              <p className="upgrade-status">
                Gói hiện tại: <b>{currentLabel}</b>
                {(current === "premium" || current === "lite") && plan.premiumUntil && (
                  <> · đến {new Date(plan.premiumUntil).toLocaleDateString("vi-VN")}</>
                )}
                {plan.monthly?.aiLookups?.cap != null && (
                  <> · Truy vấn AI tháng này: {plan.monthly.aiLookups.used}/{plan.monthly.aiLookups.cap}</>
                )}
              </p>
            )}

            <div className="tier-picker" role="group" aria-label="Chọn gói">
              {(["lite", "premium"] as Tier[]).map((item) => {
                // "từ X/tháng" phải là mức RẺ NHẤT TÍNH THEO THÁNG (gói năm),
                // không phải gói có tổng tiền nhỏ nhất (gói một tháng).
                const cheapest = plans
                  .filter((p) => p.tier === item)
                  .sort((a, b) => a.priceVnd / a.months - b.priceVnd / b.months)[0];
                return (
                  <button
                    key={item}
                    className={item === tier ? "tier-card active" : "tier-card"}
                    aria-pressed={item === tier}
                    onClick={() => setTier(item)}
                  >
                    <b>{TIER_COPY[item].name}</b>
                    <small>{TIER_COPY[item].tagline}</small>
                    {cheapest && <em>từ {vnd(cheapest.priceVnd / cheapest.months)}/tháng</em>}
                  </button>
                );
              })}
            </div>

            <div className="plan-tabs" role="group" aria-label="Thời hạn">
              {tierPlans.map((item) => (
                <button
                  key={item.id}
                  className={item.months === months ? "active" : ""}
                  onClick={() => setMonths(item.months)}
                >
                  {item.months === 12 ? "1 năm" : `${item.months} tháng`}
                  {item.save ? <em>-{item.save}%</em> : null}
                </button>
              ))}
            </div>

            {selected && (
              <div className="plan-price">
                <b>{vnd(selected.priceVnd)}</b>
                <span>{selected.months > 1 ? `≈ ${vnd(selected.priceVnd / selected.months)}/tháng` : "/tháng"}</span>
              </div>
            )}
            <p className="upgrade-noauto"><Icon name="check" size={13} /> Không tự động gia hạn · Thanh toán qua mã QR ngân hàng</p>

            {error && <p className="upgrade-error" role="status">{error}</p>}
            <button className="primary upgrade-go" disabled={busy || alreadyHas || !selected} onClick={start}>
              {alreadyHas
                ? `Bạn đang dùng ${currentLabel}`
                : busy ? "Đang tạo đơn…" : `Nâng cấp lên ${TIER_COPY[tier].name}`}
            </button>

            <div className="plan-compare">
              <h3>So sánh các gói</h3>
              <div className="plan-compare-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Tính năng</th>
                      <th scope="col">Free</th>
                      <th scope="col" className={tier === "lite" ? "is-on" : ""}>Lite</th>
                      <th scope="col" className={tier === "premium" ? "is-on" : ""}>Premium</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row) => (
                      <tr key={row.bucket}>
                        <th scope="row">{row.label}</th>
                        <td>{cell(PLAN_LIMITS.free[row.bucket])}</td>
                        <td className={tier === "lite" ? "is-on" : ""}>{cell(PLAN_LIMITS.lite[row.bucket])}</td>
                        <td className={tier === "premium" ? "is-on" : ""}>{cell(PLAN_LIMITS.premium[row.bucket])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="plan-free-list">
                <li className="plan-free-head">Miễn phí ở mọi gói, không giới hạn:</li>
                {ALWAYS_FREE.map((line) => (
                  <li key={line}><Icon name="check" size={13} /> {line}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
