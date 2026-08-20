// Đọc một video YouTube thành bài luyện: lấy mã video, phụ đề, rồi cắt thành câu.
//
// KHÔNG tải và KHÔNG lưu video. App chỉ giữ mã video, tiêu đề và phần phụ đề đã
// cắt câu; lúc học thì nhúng trình phát của YouTube, video vẫn phát từ YouTube.
//
// Phần thuần tính toán nằm ở đây để kiểm thử được mà không cần gọi mạng.

/** Lấy mã video từ mọi dạng đường dẫn YouTube thường gặp. */
export function videoIdFrom(input) {
  const text = String(input ?? "").trim();
  if (!text) return "";
  // Người dùng dán thẳng mã video cũng chấp nhận.
  if (/^[\w-]{11}$/.test(text)) return text;
  let url;
  try {
    url = new URL(text.startsWith("http") ? text : `https://${text}`);
  } catch {
    return "";
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") return check(url.pathname.slice(1));
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return "";
  if (url.pathname === "/watch") return check(url.searchParams.get("v"));
  const match = url.pathname.match(/^\/(embed|shorts|live|v)\/([^/?]+)/);
  return match ? check(match[2]) : "";
}

function check(id) {
  const value = String(id ?? "").trim();
  return /^[\w-]{11}$/.test(value) ? value : "";
}

/** Đường dẫn nhúng, dùng cho thẻ iframe của trình phát YouTube. */
export function embedUrl(videoId, { start = 0 } = {}) {
  const params = new URLSearchParams({ enablejsapi: "1", rel: "0", modestbranding: "1" });
  if (start > 0) params.set("start", String(Math.floor(start)));
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params}`;
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

/** Đổi định dạng json3 của YouTube thành các đoạn { start, end, text } tính bằng giây. */
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

const SENTENCE_END = /[.!?]["')\]]?$/;

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

function round(value) {
  return Math.max(0, Math.round(value * 100) / 100);
}

/** Số chữ cái của từng từ, để vẽ ô trống như bài chép chính tả. */
export function wordShapes(text) {
  return String(text ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({ word, letters: word.replace(/[^\p{L}\p{N}']/gu, "").length }));
}

/** Danh từ riêng gợi ý sẵn: người học không thể đoán tên riêng khi nghe. */
export function properNouns(text) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const found = words
    .map((word, position) => ({ word: word.replace(/[^\p{L}\p{N}'-]/gu, ""), position }))
    .filter(({ word, position }) => word.length > 1 && /^\p{Lu}/u.test(word) && position > 0 && !SENTENCE_END.test(words[position - 1] ?? ""))
    .map(({ word }) => word);
  return [...new Set(found)];
}

function normalise(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Chấm một câu chép chính tả: bao nhiêu phần trăm từ khớp đúng.
 *
 * So theo tập hợp từ chứ không theo vị trí: gõ thiếu một từ ở đầu mà so theo vị
 * trí thì cả câu thành sai, dù người học nghe đúng gần hết.
 */
export function scoreDictation(target, typed) {
  const want = normalise(target).split(" ").filter(Boolean);
  const got = normalise(typed).split(" ").filter(Boolean);
  if (!want.length) return { matched: 0, total: 0, percent: 0, words: [] };
  const pool = [...got];
  const words = want.map((word) => {
    const at = pool.indexOf(word);
    if (at >= 0) {
      pool.splice(at, 1);
      return { word, ok: true };
    }
    return { word, ok: false };
  });
  const matched = words.filter((item) => item.ok).length;
  return { matched, total: want.length, percent: Math.round((matched / want.length) * 100), words };
}

/**
 * Cắt lời thoại dán tay thành câu và ƯỚC LƯỢNG mốc thời gian.
 *
 * Nói rõ đây là ước lượng: chia đều thời lượng video theo độ dài từng câu. Người
 * nói không đều nhịp nên mốc này sẽ lệch dần, nhất là ở video có nhạc hoặc quãng
 * lặng. Đủ tốt để tua tới gần đúng chỗ rồi nghe lại, KHÔNG đủ chính xác để coi là
 * phụ đề thật — giao diện phải cho người học chỉnh lại được.
 *
 * @param {string} transcript lời thoại dán vào
 * @param {number} seconds thời lượng video, lấy từ trang video
 * @param {number} leadIn số giây đầu thường là nhạc hiệu, không có lời
 */
export function alignTranscript(transcript, seconds, { leadIn = 0, maxWords = 30 } = {}) {
  const text = String(transcript ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];

  // Cắt theo dấu kết câu, giữ lại dấu câu ở cuối mỗi câu.
  const pieces = text.match(/[^.!?]+[.!?]*["')\]]?\s*/g) ?? [text];
  const chunks = [];
  for (const piece of pieces) {
    const sentence = piece.trim();
    if (!sentence) continue;
    const words = sentence.split(" ").filter(Boolean);
    // Câu quá dài thì cắt nhỏ, giống cách xử lý phụ đề không có dấu chấm.
    if (words.length <= maxWords) chunks.push(sentence);
    else for (let at = 0; at < words.length; at += maxWords) chunks.push(words.slice(at, at + maxWords).join(" "));
  }

  const total = chunks.reduce((sum, sentence) => sum + sentence.length, 0);
  const usable = Math.max(0, (Number(seconds) || 0) - leadIn);
  let cursor = leadIn;
  return chunks.map((sentence, position) => {
    const share = total > 0 && usable > 0 ? (sentence.length / total) * usable : 0;
    const start = Math.round(cursor * 100) / 100;
    cursor += share;
    return {
      index: position + 1,
      start,
      end: Math.round(cursor * 100) / 100,
      text: sentence,
      // Đánh dấu để giao diện nói rõ mốc giờ này là ước lượng, không phải phụ đề thật.
      estimated: true,
    };
  });
}

/**
 * Đổi thời lượng dạng ISO 8601 của YouTube ("PT14M4S") sang số giây.
 * Video dài có thể có cả giờ ("PT1H2M3S"); video ngắn có khi chỉ có giây ("PT45S").
 */
export function secondsFromIso(duration) {
  const match = String(duration ?? "").match(/^P(?:([\d.]+)D)?T(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/);
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return Math.round((Number(days) || 0) * 86400 + (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0));
}
