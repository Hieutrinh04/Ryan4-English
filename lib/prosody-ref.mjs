// Lấy và NHỚ hình mẫu ngữ điệu của một câu do người trong video nói.
//
// Gọi /api/ai/prosody (Gemini nghe đoạn video) tốn một lượt AI, nhưng kết quả
// cùng một câu thì không đổi — nên nhớ lại theo (videoId, số câu) và chỉ gọi một
// lần cho mỗi câu, kể cả khi người học nhại đi nhại lại.

const cacheKey = "lexilo:prosody-ref:v1";
const MAX_ENTRIES = 400;

/** @typedef {{stressedWords:string[], pauseAfter:string[], finalPitch:string, pitchRange:string, pace:string, summary:string}} ProsodyRef */

function readAll() {
  try {
    const raw = localStorage.getItem(cacheKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  const entries = Object.entries(map);
  const kept = entries.length > MAX_ENTRIES ? Object.fromEntries(entries.slice(-MAX_ENTRIES)) : map;
  try {
    localStorage.setItem(cacheKey, JSON.stringify(kept));
  } catch {
    // Trình duyệt chặn lưu thì lần sau phải gọi lại, không sao.
  }
}

function keyOf(videoId, sentenceIndex) {
  return `${String(videoId ?? "").trim()}#${Number(sentenceIndex) || 0}`;
}

/** Đã có sẵn trong máy chưa? Trả về hình mẫu hoặc null. */
export function readProsodyRef(videoId, sentenceIndex) {
  const hit = readAll()[keyOf(videoId, sentenceIndex)];
  return hit && Array.isArray(hit.stressedWords) ? hit : null;
}

/**
 * Lấy hình mẫu ngữ điệu cho một câu. Ưu tiên bộ nhớ; chưa có thì gọi API.
 * Trả về null nếu chưa cấu hình Gemini hoặc gọi hỏng — khi đó bên gọi tự chấm
 * bằng ước lượng từ văn bản.
 * @returns {Promise<ProsodyRef | null>}
 */
export async function fetchProsodyRef({ videoId, sentenceIndex, start, end, sentence }) {
  const cached = readProsodyRef(videoId, sentenceIndex);
  if (cached) return cached;
  if (!videoId || !String(sentence ?? "").trim()) return null;
  try {
    const response = await fetch("/api/ai/prosody", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoId, start, end, sentence }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error || !Array.isArray(data.stressedWords) || !data.stressedWords.length) return null;
    const ref = {
      stressedWords: data.stressedWords,
      pauseAfter: Array.isArray(data.pauseAfter) ? data.pauseAfter : [],
      finalPitch: data.finalPitch ?? "fall",
      pitchRange: data.pitchRange ?? "medium",
      pace: data.pace ?? "medium",
      summary: String(data.summary ?? ""),
    };
    const all = readAll();
    all[keyOf(videoId, sentenceIndex)] = ref;
    writeAll(all);
    return ref;
  } catch {
    return null;
  }
}
