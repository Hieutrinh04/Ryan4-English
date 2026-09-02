// Ước lượng bậc CEFR (A1–C2) của một từ tiếng Anh.
//
// VÌ SAO "ƯỚC LƯỢNG" CHỨ KHÔNG "GÁN": giống lib/level-estimate.mjs cho bài học —
// không có bảng chính thức nào phủ hết mọi từ, nên phải nói rõ đây là con số suy ra
// được, kiểm chứng được, không phải điểm CEFR thi thật.
//
// HAI NGUỒN, theo thứ tự ưu tiên:
//   1. Oxford 5000™ (lib/cefr-oxford.mjs) — ~5000 từ lõi, bậc do Oxford xếp.
//   2. Tần suất dùng thật (số lần trên một triệu từ, lấy từ Datamuse `md=f`) —
//      cho những từ ngoài danh sách. Từ càng hiếm thì bậc càng cao.

import { CEFR_OXFORD } from "./cefr-oxford.mjs";

export const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Ngưỡng tần suất (lần / triệu từ) → bậc. Chỉ dùng khi Oxford 5000 không có từ.
// Neo hiệu chỉnh: important ~310 (A1), house ~236 (A1), environment ~86 (A2),
// achieve ~40 (B1), certificate ~9 (B2), credential ~0.4 (C1).
const FREQ_BANDS = [
  { level: "A1", min: 110 },
  { level: "A2", min: 38 },
  { level: "B1", min: 11 },
  { level: "B2", min: 3.2 },
  { level: "C1", min: 0.7 },
];

/** Đếm âm tiết thô: mỗi cụm nguyên âm là một âm tiết. */
export function countSyllables(word) {
  const clean = String(word ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (clean.length <= 3) return 1;
  const groups = clean.replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Bậc suy từ riêng tần suất. Trả null khi không có số tần suất. */
export function levelFromFrequency(freqPerMillion, word = "") {
  const value = Number(freqPerMillion);
  if (!Number.isFinite(value) || value <= 0) return null;
  let level = FREQ_BANDS.find((band) => value >= band.min)?.level ?? "C2";
  // Từ nhiều âm tiết hiếm khi ở bậc đầu dù tần suất có vẻ cao — thường vì trùng
  // một dạng gốc phổ biến. Nâng đúng một bậc.
  if (countSyllables(word) >= 4 && CEFR_ORDER.indexOf(level) < 2) {
    level = CEFR_ORDER[CEFR_ORDER.indexOf(level) + 1];
  }
  return level;
}

/** Vài dạng gốc thô để tra Oxford: "certificates" → "certificate". */
function lemmaForms(word) {
  const base = word.toLowerCase().trim();
  const forms = [base];
  if (/ies$/.test(base)) forms.push(base.replace(/ies$/, "y"));
  if (/(ches|shes|xes|sses|zzes)$/.test(base)) forms.push(base.replace(/es$/, ""));
  if (/s$/.test(base) && !/ss$/.test(base)) forms.push(base.replace(/s$/, ""));
  if (/ing$/.test(base)) forms.push(base.replace(/ing$/, ""), base.replace(/ing$/, "e"));
  if (/ed$/.test(base)) forms.push(base.replace(/ed$/, ""), base.replace(/ed$/, "e"));
  if (/(ly|ness|ment|er|est)$/.test(base)) forms.push(base.replace(/(ly|ness|ment|er|est)$/, ""));
  return [...new Set(forms)].filter((form) => form.length >= 2);
}

/**
 * Bậc CEFR ước lượng của một từ.
 * @param {string} word
 * @param {number} [freqPerMillion] số lần trên một triệu từ (Datamuse `f:`)
 * @returns {{ level: string, source: "oxford" | "frequency" } | null}
 */
export function estimateCefr(word, freqPerMillion) {
  const raw = String(word ?? "").toLowerCase().trim();
  if (!raw || !/^[a-z][a-z '-]*$/.test(raw)) return null;
  for (const form of lemmaForms(raw)) {
    if (CEFR_OXFORD[form]) return { level: CEFR_OXFORD[form], source: "oxford" };
  }
  const byFreq = levelFromFrequency(freqPerMillion, raw);
  return byFreq ? { level: byFreq, source: "frequency" } : null;
}

/** Chênh bậc giữa hai mức: >0 nghĩa là `level` cao hơn `base`. */
export function bandGap(base, level) {
  const from = CEFR_ORDER.indexOf(base);
  const to = CEFR_ORDER.indexOf(level);
  return from < 0 || to < 0 ? 0 : to - from;
}

/**
 * Chọn các từ đồng nghĩa "đáng học lên" so với từ gốc: hoặc ở BẬC CEFR cao hơn,
 * hoặc HIẾM HƠN HẲN (cùng bậc nhưng ít gặp hơn → cách nói tinh tế hơn). Sắp theo
 * mức "nâng cấp" giảm dần, bỏ trùng và biến thể của chính từ gốc, tối đa `limit`.
 * @param {string} baseLevel   bậc CEFR của từ gốc
 * @param {number} baseFreq    tần suất từ gốc (lần / triệu từ)
 * @param {{ word: string, level: string | null, freq?: number }[]} scored
 * @param {number} [limit]
 * @returns {{ word: string, level: string }[]}
 */
export function higherBandWords(baseLevel, baseFreq, scored, limit = 6) {
  const base = CEFR_ORDER.indexOf(baseLevel);
  const bf = Number(baseFreq);
  const seen = new Set();
  return (scored ?? [])
    .map((item) => {
      const word = String(item?.word ?? "").toLowerCase().trim();
      const lvl = CEFR_ORDER.indexOf(item?.level);
      if (!word || seen.has(word) || lvl < 0) return null;
      const gap = base >= 0 ? lvl - base : 1;
      const f = Number(item?.freq);
      const rarer = Number.isFinite(f) && f > 0 && Number.isFinite(bf) && bf > 0 && f < bf * 0.6;
      // Giữ khi: bậc cao hơn, HOẶC (cùng bậc / kém một bậc nhưng hiếm hơn hẳn).
      if (gap <= 0 && !(rarer && gap >= -1)) return null;
      seen.add(word);
      // Bậc CEFR là tín hiệu chính. Hiếm hơn được cộng nhẹ, nhưng có trần để từ
      // quá hiếm không nhảy lên đầu danh sách.
      const rarityBonus = Number.isFinite(f) && f > 0 ? Math.min(2, Math.max(0, 3 - Math.log10(f + 1))) : 0;
      return { word, level: item.level, score: gap * 10 + (rarer ? 3 : 0) + rarityBonus };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ word, level }) => ({ word, level }));
}

/** Rút số tần suất từ mảng tags kiểu ["f:8.86","n"] của Datamuse. */
export function frequencyFromTags(tags) {
  const hit = (Array.isArray(tags) ? tags : []).find((tag) => /^f:/.test(String(tag)));
  return hit ? Number(String(hit).slice(2)) : NaN;
}
