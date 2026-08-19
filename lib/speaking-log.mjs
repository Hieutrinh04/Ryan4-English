// Số giây luyện nói mỗi ngày.
//
// Số từ đã thuộc không nói lên bạn có nói được hay không. Đếm riêng thời gian đã
// thật sự mở miệng nói để phần thống kê phản ánh cả kỹ năng đó.
//
// Tách khỏi lib/storage.ts để chạy được trong test Node: storage.ts kéo theo
// lib/types.ts và cả chuỗi phụ thuộc TypeScript.

import { localDateString } from "./srs.mjs";

export const speakingKey = "lexilo:speaking:v1";

export function readSpeaking() {
  try {
    const raw = localStorage.getItem(speakingKey);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "number" && value > 0));
  } catch {
    return {};
  }
}

/** Cộng số giây vừa nói vào hôm nay. Trả về bảng sau khi cộng. */
export function logSpeaking(seconds) {
  const store = readSpeaking();
  if (!Number.isFinite(seconds) || seconds <= 0) return store;
  const today = localDateString();
  store[today] = Math.round((store[today] ?? 0) + seconds);
  // Giữ hai năm gần nhất, đủ cho mọi thống kê hiện có.
  const trimmed = Object.fromEntries(Object.entries(store).sort(([a], [b]) => a.localeCompare(b)).slice(-730));
  try {
    localStorage.setItem(speakingKey, JSON.stringify(trimmed));
  } catch {
    // Bỏ qua khi trình duyệt chặn.
  }
  return trimmed;
}

/** Tổng số phút đã nói trong `days` ngày gần nhất, tính cả hôm nay. */
export function speakingMinutes(store, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const from = localDateString(cutoff);
  const seconds = Object.entries(store ?? {})
    .filter(([day]) => day >= from)
    .reduce((total, [, value]) => total + value, 0);
  return Math.round(seconds / 60);
}
