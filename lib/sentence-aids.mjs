// Hai thứ đỡ cho người học khi nghe một câu: phiên âm từng từ và bản dịch cả câu.
//
// Cả hai đều phải gọi mạng, nên phần quan trọng nhất ở đây là NHỚ LẠI: một video
// mười phút có hàng trăm câu và cả nghìn từ, mà từ thì lặp lại rất nhiều. Không
// nhớ lại thì mỗi lần bật phiên âm là một trận gọi mạng vô nghĩa.

// v2 bỏ các kết quả rỗng đã lưu từ thời endpoint chỉ có một nguồn trực tuyến.
export const ipaCacheKey = "lexilo:ipa-cache:v2";
export const translationCacheKey = "lexilo:sentence-vi:v1";
export const MAX_CACHE = 5000;

/** Các từ cần tra phiên âm trong một câu, đã bỏ dấu câu và bỏ trùng. */
export function lookupWords(text) {
  const words = String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[-']+|[-']+$/g, ""))
    .filter((word) => /^[a-z][a-z'-]*$/.test(word));
  return [...new Set(words)];
}

/** Từ nào chưa có trong bộ nhớ và thật sự cần gọi mạng. */
export function missingWords(text, cache) {
  return lookupWords(text).filter((word) => !(word in (cache ?? {})));
}

/**
 * Ghép phiên âm vào từng từ của câu, GIỮ NGUYÊN dấu câu và chữ hoa.
 *
 * Trả về cả những từ chưa tra được, với ipa rỗng — giao diện cần hiện đủ câu chứ
 * không phải chỉ những từ may mắn có trong từ điển.
 */
export function withIpa(text, cache) {
  const store = cache ?? {};
  return String(text ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const key = token.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "").replace(/^[-']+|[-']+$/g, "");
      return { word: token, ipa: store[key] || "" };
    });
}

function readMap(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string"));
  } catch {
    return {};
  }
}

function writeMap(key, map) {
  // Cắt bớt khi quá đầy: giữ phần thêm sau cùng, vì đó là bài đang học.
  const entries = Object.entries(map);
  const kept = entries.length > MAX_CACHE ? Object.fromEntries(entries.slice(-MAX_CACHE)) : map;
  try {
    localStorage.setItem(key, JSON.stringify(kept));
  } catch {
    // Trình duyệt chặn lưu thì vẫn học được, chỉ là lần sau phải tra lại.
  }
  return kept;
}

export function readIpaCache() {
  return readMap(ipaCacheKey);
}

/** Nhớ lại phiên âm vừa tra. Từ tra không ra cũng nhớ, để khỏi hỏi lại mãi. */
export function saveIpa(found) {
  const next = { ...readIpaCache() };
  for (const [word, ipa] of Object.entries(found ?? {})) next[String(word).toLowerCase()] = String(ipa ?? "");
  return writeMap(ipaCacheKey, next);
}

export function readTranslationCache() {
  return readMap(translationCacheKey);
}

export function saveTranslation(text, vietnamese) {
  const key = String(text ?? "").trim();
  if (!key || !vietnamese) return readTranslationCache();
  return writeMap(translationCacheKey, { ...readTranslationCache(), [key]: String(vietnamese) });
}
