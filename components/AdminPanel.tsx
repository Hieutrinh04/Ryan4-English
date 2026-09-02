"use client";

import { useEffect, useState } from "react";
import Icon from "./Icon";
import { adminGrant, adminOrders, type AdminOrder } from "../lib/use-plan";

// Bảng quản trị (chỉ hiện với tài khoản trong ADMIN_EMAILS): bật Premium theo
// email và xem đơn hàng gần đây.

function vnd(amount: number) {
  return `${Math.round(amount).toLocaleString("vi-VN")}₫`;
}

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [days, setDays] = useState(30);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [orders, setOrders] = useState<AdminOrder[]>([]);

  const loadOrders = () => void adminOrders().then(setOrders);
  useEffect(loadOrders, []);

  async function run(revoke: boolean) {
    if (!email.includes("@")) { setNote("Nhập email hợp lệ."); return; }
    setBusy(revoke ? "revoke" : "grant");
    setNote(await adminGrant(email.trim(), revoke ? { revoke: true } : { days }));
    setBusy("");
    loadOrders();
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal admin-modal" role="dialog" aria-modal="true" aria-label="Quản trị">
        <div className="modal-head">
          <h2><Icon name="sparkles" size={18} /> Quản trị Premium</h2>
          <button onClick={onClose} aria-label="Đóng">×</button>
        </div>

        <div className="admin-grant">
          <label>
            <span>Email tài khoản</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nguoidung@gmail.com" autoComplete="off" />
          </label>
          <label className="admin-days">
            <span>Số ngày</span>
            <input type="number" min={1} max={3650} value={days} onChange={(event) => setDays(Number(event.target.value) || 30)} />
          </label>
          <div className="admin-actions">
            <button className="primary" disabled={Boolean(busy)} onClick={() => run(false)}>
              {busy === "grant" ? "Đang bật…" : "Bật / gia hạn Premium"}
            </button>
            <button className="admin-revoke" disabled={Boolean(busy)} onClick={() => run(true)}>
              {busy === "revoke" ? "Đang hạ…" : "Hạ về Free"}
            </button>
          </div>
          {note && <p className="admin-note" role="status">{note}</p>}
        </div>

        <h3>Đơn hàng gần đây</h3>
        <div className="admin-orders">
          {orders.length === 0 ? (
            <p className="admin-empty">Chưa có đơn nào.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Thời gian</th><th>Email</th><th>Gói</th><th>Tiền</th><th>Trạng thái</th></tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>{new Date(order.created_at).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td>{order.email}</td>
                    <td>{order.pack_id} · {order.days}d</td>
                    <td>{vnd(order.amount_vnd)}</td>
                    <td><span className={`admin-status s-${order.status}`}>{order.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
