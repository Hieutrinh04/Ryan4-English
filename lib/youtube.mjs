// Đọc một video YouTube thành bài luyện: lấy mã video, phụ đề, rồi cắt thành câu.
//
// KHÔNG tải và KHÔNG lưu video. App chỉ giữ mã video, tiêu đề và phần phụ đề đã
// cắt câu; lúc học thì nhúng trình phát của YouTube, video vẫn phát từ YouTube.
//
// Phần thuần tính toán nằm ở đây để kiểm thử được mà không cần gọi mạng.

import { MAX_CUE_OVERLAP, isSoundLabel, trimSilentTails } from "./caption-timing.mjs";
import { groupForPractice, hasAwkwardBoundary } from "./split-text.mjs";

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

/** Bỏ chỉ dẫn âm thanh/ký hiệu người nói nhưng giữ nguyên lời thực. */
export function cleanCaptionText(value) {
  return String(value ?? "")
    .replace(/(?:^|\s)>>(?=\s|$)/g, " ")
    .replace(/\[(?:music|applause|laughter|laughs?|cheering|cheers?|silence|noise|sound|inaudible)\]/gi, " ")
    .replace(/[♪♫]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function removeCueDuplicates(items) {
  const out = [];
  for (const raw of items) {
    const cue = { ...raw, text: cleanCaptionText(raw?.text) };
    if (!cue.text) continue;
    const previous = out[out.length - 1];
    if (previous && previous.text.toLowerCase() === cue.text.toLowerCase()) {
      // JSON3 tự động đôi khi lặp cùng một dòng ở hai event kế tiếp. Giữ một
      // bản và phủ trọn khoảng giờ thay vì bắt người học chép lại hai lần.
      previous.end = Math.max(Number(previous.end) || 0, Number(cue.end) || 0);
      continue;
    }
    out.push(cue);
  }
  return out;
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
    const segments = event.segs ?? [];
    const text = cleanCaptionText(segments.map((seg) => seg.utf8 ?? "").join(""));
    if (!text || text === "\n") continue;
    // Dòng chỉ mô tả âm thanh thì không có lời nào để nhại; giữ lại chỉ tạo ra
    // một thẻ câu bấm vào là nghe nhạc.
    if (isSoundLabel(text)) continue;
    const eventStartMs = Number(event.tStartMs) || 0;
    const eventEndMs = eventStartMs + (Number(event.dDurationMs) || 0);
    // Phụ đề tự động json3 thường cho tOffsetMs ở từng từ/cụm từ. Đây là mốc
    // chính xác nhất YouTube công khai cho trình phát, nên giữ nguyên các ranh
    // giới đó thay vì gộp cả hàng rồi đoán vị trí theo số từ.
    const textualSegments = segments
      .map((seg) => ({
        offsetMs: Number(seg?.tOffsetMs),
        hasOffset: seg?.tOffsetMs !== undefined && Number.isFinite(Number(seg.tOffsetMs)),
        text: cleanCaptionText(seg?.utf8),
      }))
      .filter((seg) => seg.text);
    const hasWordTiming = textualSegments.length > 1 && textualSegments.every((seg) => seg.hasOffset);
    if (hasWordTiming) {
      const timed = [];
      for (const seg of textualSegments) {
        const startMs = eventStartMs + Math.max(0, seg.offsetMs || 0);
        const previous = timed[timed.length - 1];
        // Có file đặt dấu câu và từ đứng trước cùng một offset. Chúng là một
        // mảnh âm thanh, gộp chữ lại để không tạo hai cue chồng thời gian.
        if (previous?.startMs === startMs) previous.text = `${previous.text} ${seg.text}`.replace(/\s+/g, " ").trim();
        else timed.push({ startMs, text: seg.text });
      }
      for (let index = 0; index < timed.length; index += 1) {
        const item = timed[index];
        const next = timed.slice(index + 1).find((candidate) => candidate.startMs > item.startMs);
        const endMs = Math.max(item.startMs + 50, next?.startMs ?? eventEndMs);
        cues.push({ start: item.startMs / 1000, end: endMs / 1000, text: item.text });
      }
    } else {
      const start = eventStartMs / 1000;
      cues.push({ start, end: eventEndMs / 1000, text });
    }
  }
  // Transcript đọc từ DOM chỉ hiện 0:16, 0:20... YouTube dùng chính số đang
  // hiện làm mốc bắt đầu của hàng mới. Bản cũ tự cộng 0,5s để lấy trung điểm
  // của giây, khiến câu trước phát lấn nửa giây và lọt cả "Today we are" của
  // hàng sau. Giữ nguyên ranh giới thô an toàn hơn: có thể dừng hơi sớm vài
  // phần trăm giây, nhưng tuyệt đối không nuốt lời của câu kế tiếp.
  if (payload?.timingPrecision === "second") {
    return trimSilentTails(removeCueDuplicates(cues));
  }
  // Chỉ timestamp TỪNG TỪ mới đủ chứng cứ để giữ phần cue chồng nhẹ. `endMs`
  // của một dòng transcript có độ phân giải mili-giây nhưng vẫn có thể chỉ là
  // thời gian chữ nằm trên màn hình; cộng đệm cho nó sẽ phát lọt 2–3 từ câu sau.
  if (payload?.timingPrecision === "word") {
    return trimSilentTails(removeCueDuplicates(cues), { nextStartPad: MAX_CUE_OVERLAP });
  }
  return trimSilentTails(removeCueDuplicates(cues));
}

const SENTENCE_END = /[.!?]["')\]]?$/;

/**
 * Gom các dòng phụ đề thành CÂU để luyện.
 *
 * Phụ đề YouTube cắt theo dòng hiển thị chứ không theo câu: một câu hay bị xé làm
 * đôi, và một dòng có khi chứa hai câu. Bài chép chính tả và bài nói nhại đều cần
 * đơn vị là câu, nên phải gom lại.
 *
 * LUẬT QUAN TRỌNG: chỉ cắt Ở RANH GIỚI DÒNG PHỤ ĐỀ.
 *
 * Bản trước cắt theo dấu câu rồi suy mốc bằng cách chia đều số từ trong dòng.
 * Khi chỗ cắt rơi vào GIỮA một dòng, mốc suy ra chỉ là ước lượng — nên đoạn thì
 * hụt mất mấy chữ cuối, đoạn thì ôm thêm phần đầu của câu sau. Cắt ở ranh giới
 * dòng thì mọi mốc đều là giờ thật của phụ đề, không có số nào do mình bịa ra.
 *
 * maxWords chặn trường hợp cả đoạn không có dấu chấm nào — thường gặp ở phụ đề
 * máy tự nghe — để không sinh ra một "câu" dài sáu dòng không ai chép nổi.
 */
export function sentencesFrom(cues, { maxWords = 30, maxSentences = 2, minWords = 10 } = {}) {
  const wordsOf = (value) => String(value ?? "").split(/\s+/).filter(Boolean);
  const endsThought = (value) => {
    const clean = String(value ?? "").trim();
    if (/(?:\.{2,}|…)["')\]]?$/.test(clean)) return false;
    return /[.!?]["')\]]?$/.test(clean);
  };
  const endsClause = (value) => /[,;:—–]["')\]]?$/.test(String(value ?? "").trim());
  // Cho phép vượt trần mềm khi ý chưa khép. Một đoạn 34 từ trọn nghĩa dễ nhại
  // hơn hai đoạn 20/14 từ mà đoạn đầu kết bằng "and", "because" hay dấu ba chấm.
  const hardWords = Math.max(maxWords, maxWords + Math.min(12, Math.max(4, Math.round(maxWords * 0.4))));

  const list = (cues ?? []).filter((cue) => String(cue?.text ?? "").trim());
  const sentences = [];
  const push = (start, end, text) => {
    const clean = String(text).replace(/\s+/g, " ").trim();
    if (clean) sentences.push({ index: sentences.length + 1, start: round(start), end: round(end), text: clean });
  };

  let group = [];
  let words = 0;

  const flush = () => {
    if (!group.length) return;
    const text = group.map((cue) => cue.text).join(" ");
    const head = group[0];
    const tail = group[group.length - 1];

    // Một dòng dài hơn cả trần từ thì buộc phải cắt bên trong nó — đây là chỗ
    // DUY NHẤT còn phải suy mốc. Một dòng chỉ dài vài giây nên sai số nhỏ, và
    // không cắt thì sinh ra một câu không ai chép nổi.
    if (group.length === 1 && words > maxWords) {
      const chunks = groupForPractice(text, maxWords, maxSentences);
      const total = wordsOf(text).length || 1;
      const span = Math.max(0, Number(tail.end) - Number(head.start));
      let used = 0;
      for (const chunk of chunks) {
        const count = wordsOf(chunk).length;
        const from = head.start + (span * used) / total;
        used += count;
        push(from, head.start + (span * used) / total, chunk);
      }
    } else {
      push(head.start, tail.end, text);
    }

    group = [];
    words = 0;
  };

  for (const cue of list) {
    const count = wordsOf(cue.text).length;
    const currentText = group.map((item) => item.text).join(" ");
    // Nếu ý hiện tại đã khép thì giữ trần mềm. Chỉ cho phép tràn khi nó còn dang
    // dở, và vẫn có trần cứng để phụ đề không dấu câu không dài vô tận.
    if (group.length && words + count > maxWords && (endsThought(currentText) || words + count > hardWords)) flush();
    group.push(cue);
    words += count;
    const text = group.map((item) => item.text).join(" ");
    const complete = endsThought(text);
    // Ưu tiên một ý đã trọn. Dấu phẩy chỉ được dùng làm chỗ lấy hơi khi đoạn đã
    // chạm trần mềm; dấu ba chấm không bao giờ tự đóng đoạn.
    if (
      (complete && words >= minWords) ||
      (words >= maxWords && endsClause(text)) ||
      words >= hardWords
    ) flush();
  }
  flush();

  // Kiểm tra lại TOÀN BỘ kết quả. Nếu một giới hạn cứng vẫn vô tình xé cụm
  // (đặc biệt tên riêng như "New / York City"), nối hai mục khi tổng độ dài vẫn
  // nằm trong ngưỡng khẩn cấp. Không nối vô hạn transcript không có dấu câu.
  const repaired = [];
  for (const sentence of sentences) {
    const previous = repaired[repaired.length - 1];
    const combinedWords = previous ? wordsOf(`${previous.text} ${sentence.text}`).length : 0;
    if (previous && combinedWords <= hardWords && hasAwkwardBoundary(previous.text, sentence.text)) {
      repaired[repaired.length - 1] = { ...previous, end: sentence.end, text: `${previous.text} ${sentence.text}`.replace(/\s+/g, " ").trim() };
    } else repaired.push({ ...sentence });
  }
  return repaired.map((sentence, position) => ({ ...sentence, index: position + 1 }));
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
