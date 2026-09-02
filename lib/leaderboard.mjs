import { xpFrom } from "./level.mjs";

export const LEADERBOARD_PERIODS = [
  { key: "week", label: "Tuần" },
  { key: "month", label: "Tháng" },
];

export const LEADERBOARD_METRICS = [
  { key: "minutes", label: "Thời gian luyện" },
  { key: "xp", label: "Điểm XP" },
];

const localDay = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function periodStart(period, now = new Date()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  if (period === "month") date.setDate(1);
  else {
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
  }
  return localDay(date);
}

export function leaderboardSnapshot({ practice, reviews, attempts }, period, now = new Date()) {
  const start = periodStart(period, now);
  const periodReviews = (Array.isArray(reviews) ? reviews : []).filter((entry) => String(entry?.at ?? entry?.day ?? "").slice(0, 10) >= start);
  const periodAttempts = (Array.isArray(attempts) ? attempts : []).filter((entry) => String(entry?.day ?? entry?.at ?? "").slice(0, 10) >= start);
  const seconds = Object.entries(practice && typeof practice === "object" ? practice : {})
    .filter(([day]) => day >= start)
    .reduce((total, [, skills]) => total + Object.values(skills && typeof skills === "object" ? skills : {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0), 0);
  const minutes = Math.floor(seconds / 60);
  const reviewsCount = periodReviews.length;
  const learned = periodReviews.filter((entry) => entry?.firstTime).length;
  const mastered = periodReviews.filter((entry) => Number(entry?.boxAfter) === 6 && Number(entry?.boxBefore) !== 6).length;
  const attemptCount = periodAttempts.length;
  return {
    periodStart: start,
    minutes,
    reviews: reviewsCount,
    xp: xpFrom({ reviews: reviewsCount, learned, mastered, attempts: attemptCount, minutes }),
  };
}

export function safeDisplayName(value, userId = "") {
  const clean = String(value ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (clean && !clean.includes("@")) return clean;
  return userId ? `Người học ${userId.slice(0, 4).toUpperCase()}` : "Bạn";
}

export function rankLeaderboard(rows, metric = "minutes") {
  const key = metric === "xp" ? "xp" : "minutes";
  const clean = (Array.isArray(rows) ? rows : []).map((row) => ({
    userId: String(row?.user_id ?? row?.userId ?? ""),
    name: safeDisplayName(row?.display_name ?? row?.name, row?.user_id ?? row?.userId),
    minutes: Math.max(0, Math.floor(Number(row?.minutes) || 0)),
    xp: Math.max(0, Math.floor(Number(row?.xp) || 0)),
    reviews: Math.max(0, Math.floor(Number(row?.reviews) || 0)),
  })).filter((row) => row.userId);
  clean.sort((a, b) => b[key] - a[key] || b.reviews - a.reviews || a.name.localeCompare(b.name, "vi"));
  let previous = null;
  let rank = 0;
  return clean.map((row, index) => {
    if (row[key] !== previous) rank = index + 1;
    previous = row[key];
    return { ...row, rank };
  });
}
