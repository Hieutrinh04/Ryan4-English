// Tra một từ / cụm cho ô nghĩa nhanh: gọi /api/ai/glance (IPA + nghĩa tiếng Anh +
// từ đồng nghĩa + collocation + từ nâng cấp + BẢN DỊCH TIẾNG VIỆT, KHÔNG gọi mô
// hình). Bản dịch giờ do MÁY CHỦ làm (xem lib/translate.mjs) vì Google Dịch đã
// chặn CORS với trình duyệt. Kết quả nhớ trong phiên nên cùng một từ chỉ gọi một lần.

/** @typedef {{ part: string, definition: string, meaningVi: string, synonyms: string[] }} GlanceSense */
/** @typedef {{ en: string, vi: string }} Collocation */
/** @typedef {{ word: string, vi: string, level: string }} Upgrade */
/** @typedef {{ term: string, ipa: string, meaningVi: string, isPhrase: boolean, level: string|null, senses: GlanceSense[], collocations: Collocation[], upgrades: Upgrade[] }} Glance */

/** @type {Map<string, Glance>} */
const cache = new Map();
const phraseCache = new Map();

/** Dịch nguyên một cụm / câu tiếng Anh sang tiếng Việt (máy chủ lo). Nhớ theo phiên. */
export async function translatePhrase(text) {
  const key = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!key) return "";
  if (phraseCache.has(key)) return phraseCache.get(key);
  let value = "";
  try {
    const response = await fetch(`/api/ai/translate?q=${encodeURIComponent(key)}`);
    const data = await response.json().catch(() => ({}));
    value = typeof data.vi === "string" ? data.vi : "";
  } catch {
    value = "";
  }
  phraseCache.set(key, value);
  return value;
}

/**
 * Tra một từ và trả về kết quả đã kèm nghĩa tiếng Việt.
 * @param {string} word
 * @returns {Promise<Glance>}
 */
export async function fetchGlance(word) {
  const key = (word || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!key) throw new Error("Từ rỗng.");

  const hit = cache.get(key);
  if (hit) return hit;

  const response = await fetch(`/api/ai/glance?q=${encodeURIComponent(key)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || "Không tra được từ này.");
  }

  /** @type {Glance} */
  const result = {
    term: data.term ?? key,
    ipa: data.ipa ?? "",
    isPhrase: Boolean(data.isPhrase),
    level: data.level?.level ?? data.level ?? null,
    meaningVi: typeof data.meaningVi === "string" ? data.meaningVi : "",
    senses: (Array.isArray(data.senses) ? data.senses : []).map((sense) => ({
      part: sense.part ?? "",
      definition: sense.definition ?? "",
      synonyms: Array.isArray(sense.synonyms) ? sense.synonyms : [],
      meaningVi: sense.meaningVi ?? "",
    })),
    collocations: (Array.isArray(data.collocations) ? data.collocations : [])
      .map((item) => ({ en: String(item?.en ?? "").trim(), vi: String(item?.vi ?? "").trim() }))
      .filter((item) => item.en),
    upgrades: (Array.isArray(data.upgrades) ? data.upgrades : [])
      .map((item) => ({ word: String(item?.word ?? "").trim(), vi: String(item?.vi ?? "").trim(), level: String(item?.level ?? "").trim() }))
      .filter((item) => item.word && item.level),
  };

  cache.set(key, result);
  return result;
}
