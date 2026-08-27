// Đọc một video YouTube thành bài luyện: lấy mã video, phụ đề, rồi cắt thành câu.
//
// KHÔNG tải và KHÔNG lưu video. App chỉ giữ mã video, tiêu đề và phần phụ đề đã
// cắt câu; lúc học thì nhúng trình phát của YouTube, video vẫn phát từ YouTube.
//
// Phần thuần tính toán nằm ở đây để kiểm thử được mà không cần gọi mạng.

import { isSoundLabel, trimSilentTails } from "./caption-timing.mjs";
import { groupForPractice } from "./split-text.mjs";

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

/**
 * Đổi định dạng json3 của YouTube thành các đoạn { start, end, text } tính bằng giây.
 *
 * dDurationMs là độ dài HIỂN THỊ của dòng phụ đề, không phải độ dài lời nói —
 * dòng chữ hay nằm lại rất lâu sau khi câu đã dứt. Cắt đuôi im lặng ngay tại đây
 * để mọi thứ ở sau chỉ còn thấy mốc thật.
 */
export function cuesFromJson3(payload) {
  const events = payload?.events ?? [];
  const cues = [];
  for (const event of events) {
    const text = (event.segs ?? []).map((seg) => seg.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!text || text === "\n") continue;
    // Dòng chỉ mô tả âm thanh thì không có lời nào để nhại; giữ lại chỉ tạo ra
    // một thẻ câu bấm vào là nghe nhạc.
    if (isSoundLabel(text)) continue;
    const start = (event.tStartMs ?? 0) / 1000;
    cues.push({ start, end: start + (event.dDurationMs ?? 0) / 1000, text });
  }
  return trimSilentTails(cues);
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
  let group = [];
  let sentenceCount = 0;

  const wordsOf = (text) => String(text ?? "").split(/\s+/).filter(Boolean);

  const flush = () => {
    const text = group.map((cue) => cue.text).join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      // Mốc giờ của TỪNG TỪ, nội suy bên trong dòng phụ đề chứa nó.
      //
      // Cách cũ trải đều số từ trên cả cụm rồi chia tỉ lệ. Cụm có thể dài chục
      // giây và có khoảng nghỉ giữa hai câu, nên mốc cắt trôi khỏi chỗ người ta
      // thật sự nói: câu một đọc xong "I'm Phil." rồi mà tiếng vẫn chạy sang đầu
      // câu hai. Từng dòng phụ đề chỉ dài một hai giây nên nội suy trong phạm vi
      // một dòng thì sai số nhỏ hẳn, và mốc luôn bám vào giờ thật của phụ đề.
      const marks = [];
      for (const cue of group) {
        const words = wordsOf(cue.text);
        const span = Math.max(0, Number(cue.end) - Number(cue.start));
        for (let at = 0; at < words.length; at += 1) {
          marks.push({
            start: cue.start + (span * at) / words.length,
            end: cue.start + (span * (at + 1)) / words.length,
          });
        }
      }
      // Cắt theo ranh giới câu và mệnh đề, không phải cứ đủ số từ là chặt. Cắt
      // theo số từ sinh ra đoạn kết thúc giữa chừng như "…feel safe in a", còn
      // đoạn sau mở đầu bằng "car without a human driver".
      const chunks = groupForPractice(text, maxWords, maxSentences);
      let used = 0;
      for (const chunk of chunks) {
        const count = wordsOf(chunk).length;
        // Kẹp chỉ số phòng khi số từ sau khi gom lệch so với trước: thà mốc hơi
        // lệch còn hơn đọc trúng ô trống rồi ra NaN.
        const first = marks[Math.min(used, marks.length - 1)];
        const last = marks[Math.min(used + count - 1, marks.length - 1)];
        used += count;
        sentences.push({ index: sentences.length + 1, start: round(first?.start ?? 0), end: round(last?.end ?? 0), text: chunk });
      }
    }
    group = [];
    sentenceCount = 0;
  };

  for (const cue of cues ?? []) {
    group.push(cue);
    const words = group.reduce((total, item) => total + wordsOf(item.text).length, 0);
    sentenceCount += (cue.text.match(/[.!?]["')\]]?(?:\s|$)/g) ?? []).length;
    if (sentenceCount >= maxSentences || words >= maxWords) flush();
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
