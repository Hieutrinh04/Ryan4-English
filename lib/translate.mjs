// Dịch Anh → Việt phía MÁY CHỦ.
//
// VÌ SAO Ở MÁY CHỦ: endpoint gtx của Google Dịch giờ chặn CORS với trình duyệt
// và chặn IP máy chủ (trả trang "Sorry..."). Nhưng endpoint
// clients5.google.com/translate_a/t?client=dict-chrome-ex thì vẫn cho gọi từ máy
// chủ, nhận nhiều "q" một lần, trả mảng kết quả — đúng chất lượng Google Dịch.
// MyMemory làm lớp dự phòng khi cái trên hỏng.

const GOOGLE = "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=vi";
const MYMEMORY = "https://api.mymemory.translated.net/get?langpair=en|vi&q=";

// Nhớ trong bộ nhớ isolate. Bản dịch của một từ/câu gần như không đổi.
const cache = new Map();

async function timed(url, ms = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Google (clients5) — một request, nhiều q, trả đúng thứ tự. Rỗng nếu hỏng. */
async function viaGoogle(texts) {
  const query = texts.map((text) => `&q=${encodeURIComponent(text)}`).join("");
  const data = await timed(GOOGLE + query);
  if (!Array.isArray(data) || data.length !== texts.length) return null;
  return data.map((item) => String(Array.isArray(item) ? item[0] : item ?? "").normalize("NFC").trim());
}

/** MyMemory — từng chuỗi một, chạy song song. */
async function viaMyMemory(text) {
  const data = await timed(MYMEMORY + encodeURIComponent(text));
  const vi = String(data?.responseData?.translatedText ?? "").normalize("NFC").trim();
  // MyMemory hay thêm "?" ở cuối khi dịch từ lẻ không phải câu hỏi.
  return /[?？]\s*$/.test(text) ? vi : vi.replace(/\s*[?？]+\s*$/, "");
}

/**
 * Dịch một loạt chuỗi Anh → Việt. Giữ nguyên thứ tự và số phần tử.
 * @param {string[]} texts
 * @returns {Promise<string[]>}
 */
export async function translateBatch(texts) {
  const clean = (Array.isArray(texts) ? texts : []).map((text) => String(text ?? "").replace(/\s+/g, " ").trim());
  const out = clean.map((text) => (text ? cache.get(text) ?? "" : ""));
  const todo = clean
    .map((text, index) => ({ text, index }))
    .filter((item) => item.text && !out[item.index]);
  if (!todo.length) return out;

  const google = await viaGoogle(todo.map((item) => item.text));
  await Promise.all(
    todo.map(async (item, position) => {
      const value = (google && google[position]) || (await viaMyMemory(item.text));
      const usable = value && value.toLowerCase() !== item.text.toLowerCase() ? value : "";
      out[item.index] = usable;
      if (usable) {
        if (cache.size > 5000) cache.clear();
        cache.set(item.text, usable);
      }
    }),
  );
  return out;
}

/** Dịch một chuỗi. Trả "" nếu không dịch được. */
export async function translateOne(text) {
  return (await translateBatch([text]))[0] ?? "";
}
