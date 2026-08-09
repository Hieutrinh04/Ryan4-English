export type Rating = "again" | "hard" | "good" | "easy";
export type SrsState = { box: number; intervalDays: number; lapseCount: number; status: "new" | "learning" | "review" | "mastered" };

const intervals = [0, 1, 3, 7, 14, 30, 90];

export function computeNext(state: SrsState, rating: Rating): SrsState {
  if (rating === "again") return { box: state.box === 6 ? 2 : 1, intervalDays: 1, lapseCount: state.lapseCount + 1, status: "learning" };
  if (rating === "hard") return { ...state, intervalDays: Math.max(1, Math.round(state.intervalDays * 0.6)), status: "learning" };
  const box = Math.min(6, state.box + (rating === "easy" ? 2 : 1));
  const intervalDays = Math.round(intervals[box] * (rating === "easy" ? 1.3 : 1));
  return { ...state, box, intervalDays, status: box === 6 ? "mastered" : "review" };
}
