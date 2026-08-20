// TỆP NÀY ĐƯỢC SINH RA TỰ ĐỘNG — ĐỪNG SỬA TAY.
// Nguồn: lib/youtube.mjs. Sinh lại bằng: npm run build:extension
//
// Tiện ích Chrome không nạp được tệp ngoài thư mục của nó, nên phải chép sang.
// Chép bằng lệnh để app và tiện ích không bao giờ cắt câu khác nhau.

function round(value) {
  return Math.max(0, Math.round(value * 100) / 100);
}

/**
 * Cắt đúng một mảng JSON nằm sau `marker` trong trang HTML.
 * Không dùng biểu thức chính quy vì bên trong còn mảng, chuỗi và dấu ngoặc lồng nhau.
 */
export function sliceJsonArray(text, marker) {
  const at = String(text ?? "").indexOf(marker);
  if (at < 0) return null;
  const start = text.indexOf("[", at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Chọn bản phụ đề tiếng Anh; ưu tiên bản người thật làm hơn bản máy tự nghe. */
export function pickEnglishTrack(tracks) {
  const list = (tracks ?? []).filter((track) => String(track?.languageCode ?? "").startsWith("en"));
  return list.find((track) => track.kind !== "asr") ?? list[0] ?? null;
}

export function cuesFromJson3(payload) {
  const events = payload?.events ?? [];
  const cues = [];
  for (const event of events) {
    const text = (event.segs ?? []).map((seg) => seg.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!text || text === "\n") continue;
    const start = (event.tStartMs ?? 0) / 1000;
    cues.push({ start, end: start + (event.dDurationMs ?? 0) / 1000, text });
  }
  return cues;
}

/**
 * Gom các đoạn phụ đề thành CÂU.
 *
 * Phụ đề YouTube cắt theo dòng hiển thị chứ không theo câu: một câu hay bị xé làm
 * đôi, và một dòng có khi chứa hai câu. Bài chép chính tả và bài nói nhại đều cần
 * đơn vị là câu, nên phải gom lại rồi cắt theo dấu kết câu.
 *
 * maxWords chặn trường hợp cả đoạn không có dấu chấm nào — thường gặp ở phụ đề
 * máy tự nghe — để không sinh ra một "câu" dài sáu dòng không ai chép nổi.
 */
export function sentencesFrom(cues, { maxWords = 30, maxSentences = 2 } = {}) {
  const sentences = [];
  let buffer = "";
  let start = 0;
  let end = 0;
  let sentenceCount = 0;

  const flush = () => {
    const text = buffer.replace(/\s+/g, " ").trim();
    if (text) {
      const words = text.split(/\s+/).filter(Boolean);
      const chunks = [];
      for (let at = 0; at < words.length; at += maxWords) chunks.push(words.slice(at, at + maxWords).join(" "));
      const duration = Math.max(0, end - start);
      let used = 0;
      for (const chunk of chunks) {
        const count = chunk.split(/\s+/).length;
        const chunkStart = start + duration * (used / words.length);
        used += count;
        const chunkEnd = start + duration * (used / words.length);
        sentences.push({ index: sentences.length + 1, start: round(chunkStart), end: round(chunkEnd), text: chunk });
      }
    }
    buffer = "";
    sentenceCount = 0;
  };

  for (const cue of cues ?? []) {
    if (!buffer) start = cue.start;
    end = cue.end;
    buffer = buffer ? `${buffer} ${cue.text}` : cue.text;
    const words = buffer.split(/\s+/).filter(Boolean);
    sentenceCount += (cue.text.match(/[.!?]["')\]]?(?:\s|$)/g) ?? []).length;
    if (sentenceCount >= maxSentences || words.length >= maxWords) flush();
  }
  flush();
  return sentences;
}
