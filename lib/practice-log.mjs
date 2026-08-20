// Thời gian luyện tập, tách theo từng kỹ năng và từng ngày.
//
// Trước đây chỉ đếm được thời gian nói (lib/speaking-log.mjs). Trang chủ cần một
// biểu đồ có tab cho từng kỹ năng, nên bộ đếm phải biết mỗi phút thuộc về kỹ năng
// nào. Dữ liệu cũ được chuyển thẳng vào kỹ năng "shadowing" khi đọc lần đầu.
//
// Tách khỏi lib/storage.ts để test Node nạp được: storage.ts kéo theo lib/types.ts
// và cả chuỗi phụ thuộc TypeScript.

import { localDateString } from "./srs.mjs";
import { speakingKey } from "./speaking-log.mjs";

export const practiceKey = "lexilo:practice:v1";
export const practiceMigratedKey = "lexilo:practice:migrated:v1";

/** Các kỹ năng được đếm giờ, đúng thứ tự hiện trên biểu đồ trang chủ. */
export const SKILLS = [
  { key: "vocab", label: "Từ vựng" },
  { key: "dictation", label: "Chép chính tả" },
  { key: "shadowing", label: "Nói nhại" },
  { key: "writing", label: "Luyện viết" },
  { key: "review", label: "Ôn thẻ" },
];

const SKILL_KEYS = SKILLS.map((skill) => skill.key);

function sanitise(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const clean = {};
  for (const [day, bySkill] of Object.entries(parsed)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !bySkill || typeof bySkill !== "object") continue;
    const row = {};
    for (const [skill, seconds] of Object.entries(bySkill))
      if (SKILL_KEYS.includes(skill) && typeof seconds === "number" && seconds > 0) row[skill] = seconds;
    if (Object.keys(row).length) clean[day] = row;
  }
  return clean;
}

/**
 * Chuyển bộ đếm cũ (chỉ có thời gian nói) sang bộ mới, đúng một lần.
 * Không xoá khoá cũ: nếu bản mới có lỗi thì dữ liệu gốc vẫn còn đó.
 */
function migrateSpeaking(store) {
  try {
    if (localStorage.getItem(practiceMigratedKey)) return store;
    const raw = localStorage.getItem(speakingKey);
    const old = raw ? JSON.parse(raw) : null;
    localStorage.setItem(practiceMigratedKey, new Date().toISOString());
    if (!old || typeof old !== "object") return store;
    const merged = { ...store };
    for (const [day, seconds] of Object.entries(old)) {
      if (typeof seconds !== "number" || seconds <= 0) continue;
      merged[day] = { ...merged[day], shadowing: (merged[day]?.shadowing ?? 0) + seconds };
    }
    localStorage.setItem(practiceKey, JSON.stringify(merged));
    return merged;
  } catch {
    return store;
  }
}

export function readPractice() {
  try {
    const raw = localStorage.getItem(practiceKey);
    return migrateSpeaking(sanitise(raw ? JSON.parse(raw) : {}));
  } catch {
    return {};
  }
}

/** Cộng số giây vừa luyện vào kỹ năng đó của hôm nay. Trả về bảng sau khi cộng. */
export function logPractice(skill, seconds) {
  const store = readPractice();
  if (!SKILL_KEYS.includes(skill) || !Number.isFinite(seconds) || seconds <= 0) return store;
  const today = localDateString();
  const next = { ...store, [today]: { ...store[today], [skill]: Math.round((store[today]?.[skill] ?? 0) + seconds) } };
  // Giữ hai năm gần nhất, đủ cho mọi thống kê hiện có.
  const trimmed = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)).slice(-730));
  try {
    localStorage.setItem(practiceKey, JSON.stringify(trimmed));
  } catch {
    // Bỏ qua khi trình duyệt chặn.
  }
  return trimmed;
}

/** Ngày sớm nhất còn nằm trong khoảng `days` ngày gần đây, tính cả hôm nay. */
function cutoff(days, now = new Date()) {
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return localDateString(from);
}

function secondsOf(row, skill) {
  if (!row) return 0;
  if (skill) return row[skill] ?? 0;
  return Object.values(row).reduce((total, value) => total + value, 0);
}

/** Tổng số phút trong khoảng; bỏ trống `skill` để cộng mọi kỹ năng. */
export function minutesInRange(store, days, skill, now = new Date()) {
  const from = cutoff(days, now);
  const seconds = Object.entries(store ?? {})
    .filter(([day]) => day >= from)
    .reduce((total, [, row]) => total + secondsOf(row, skill), 0);
  return Math.round(seconds / 60);
}

/**
 * Số phút từng ngày để vẽ biểu đồ. Luôn trả về đủ `days` điểm, kể cả ngày không
 * học — thiếu điểm thì đường biểu đồ nối tắt qua và trông như ngày đó vẫn học.
 */
export function minutesPerDay(store, days, skill, now = new Date()) {
  const rows = [];
  for (let step = days - 1; step >= 0; step -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - step);
    const day = localDateString(date);
    rows.push({ day, minutes: Math.round(secondsOf(store?.[day], skill) / 60) });
  }
  return rows;
}

/** Số phút của từng kỹ năng trong khoảng, xếp nhiều trước ít sau. */
export function minutesBySkill(store, days, now = new Date()) {
  return SKILLS.map((skill) => ({ ...skill, minutes: minutesInRange(store, days, skill.key, now) })).sort((a, b) => b.minutes - a.minutes);
}

/** Tổng số giờ và phút đã luyện từ trước tới nay, để hiện ở thẻ trang chủ. */
export function totalTime(store) {
  const seconds = Object.values(store ?? {}).reduce((total, row) => total + secondsOf(row), 0);
  const minutes = Math.round(seconds / 60);
  return { minutes, hours: Math.floor(minutes / 60), rest: minutes % 60 };
}
