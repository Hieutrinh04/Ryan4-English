// TỆP NÀY ĐƯỢC SINH RA TỰ ĐỘNG — ĐỪNG SỬA TAY.
// Nguồn: lib/youtube.mjs. Sinh lại bằng: npm run build:extension
//
// Tiện ích Chrome không nạp được tệp ngoài thư mục của nó, nên phải chép sang.
// Chép bằng lệnh để app và tiện ích không bao giờ cắt câu khác nhau.

function round(value) {
  return Math.max(0, Math.round(value * 100) / 100);
}

// Dọn phụ đề trước khi cắt thành câu: bỏ dòng không phải lời nói, và cắt phần
// đuôi im lặng của mỗi mốc.
//
// VÌ SAO CẦN: phụ đề YouTube khai độ dài HIỂN THỊ, không phải độ dài LỜI NÓI.
// Dòng chữ thường nằm lại trên màn hình rất lâu sau khi câu đã dứt — tới tận
// dòng kế tiếp, hoặc tới hết video nếu đó là dòng cuối. Lấy thẳng số đó làm mốc
// dừng thì học viên nghe xong câu rồi còn phải ngồi nghe nốt đoạn nhạc nền,
// đúng chỗ họ đang chờ để nhại lại.
//
// Luật ở đây chỉ RÚT NGẮN, không bao giờ kéo dài. Mốc sai theo hướng dài thì
// sửa được, còn kéo dài ra thì sẽ lấn sang câu kế tiếp — hỏng nặng hơn.

/**
 * Số hiệu cách cắt phụ đề hiện hành.
 *
 * Bài đã lưu mang mốc giờ được tính bằng mã tại thời điểm bắt phụ đề, và không
 * sửa lại được: mốc của từng dòng phụ đề đã bị gộp mất, chỉ còn mốc câu. Nên
 * phải đóng dấu để app nhận ra bài nào cắt bằng bản cũ mà nhắc lấy lại.
 *
 * Tăng số này mỗi khi cách tính mốc câu đổi.
 * 2 — mốc bám giờ thật của từng dòng phụ đề, thay cho lối trải đều trên cả cụm.
 * 3 — thôi gom lại lần nữa lúc nhập bài; bước gom đó nối câu rồi cắt theo tỉ lệ
 *     số từ, làm hỏng chính những mốc mà bản 2 vừa tính đúng.
 * 4 — chỉ cắt Ở RANH GIỚI DÒNG PHỤ ĐỀ. Cắt giữa dòng thì mốc chỉ là số chia đều
 *     theo từ, nên đoạn hụt mấy chữ cuối còn đoạn sau ôm thêm phần đầu câu trước.
 * 5 — đoạn phải đủ dài mới đóng. Đủ số câu thôi thì chưa: hội thoại nhiều câu
 *     rất ngắn, đóng ngay ở đó ra đoạn năm chữ, nhại chưa vào nhịp đã hết.
 * 6 — dấu ba chấm là ý đang tiếp diễn, không phải hết câu.
 * 7 — dùng timestamp từng từ khi json3 có tOffsetMs; transcript DOM mốc tròn
 *     giây dùng MỘT ranh giới chung ở giữa giây cho cuối câu trước/đầu câu sau,
 *     không còn vùng chồng khiến cuối đoạn trước lọt vào đầu đoạn kế tiếp.
 * 8 — không đóng đoạn chỉ vì đã gặp đủ dấu câu khi dòng hiện tại còn dang dở;
 *     dọn ký hiệu >>/[Music], bỏ cue lặp và sửa ranh giới xé tên riêng/cụm từ.
 * 9 — transcript DOM dùng thẳng mốc giây YouTube hiển thị, không tự cộng 0,5s
 *     khiến cuối câu trước phát lấn sang những từ đầu của câu kế tiếp.
 * 10 — giữ endMs thật khi hai cue YouTube chồng nhẹ. Bản 9 ép end về start của
 *      cue sau nên có video bị mất 2–3 từ cuối dù phụ đề đã khai đúng mốc kết.
 * 11 — chỉ cho phép chồng khi nguồn có timestamp TỪNG TỪ. Mốc mili-giây của cả
 *      dòng vẫn có thể là thời gian hiển thị, cộng đệm làm lọt 2–3 từ câu sau.
 */
export const CAPTION_VERSION = 11;

/** Chậm hơn mức này thì gần như chắc chắn là khoảng lặng, không phải nói chậm. */
export const MIN_WORDS_PER_SECOND = 1.2;
/** Chừa chỗ cho phụ âm cuối và nhịp ngắt tự nhiên cuối câu. */
export const TAIL_PAD = 0.6;
/** YouTube có thể cho hai cue hiển thị chồng nhẹ; đây không phải lời bị lặp. */
export const MAX_CUE_OVERLAP = 1.2;
/** Đoạn ngắn hơn mức này thì bấm nghe cũng không kịp nhận ra gì. */
const MIN_SPAN = 0.3;

/**
 * Nhận diện bài bản 8 lấy từ transcript DOM: từ câu thứ hai trở đi gần như mọi
 * mốc bắt đầu đều nằm ở nửa giây vì bản đó từng tự cộng 0,5s. Chỉ dùng dấu hiệu
 * này để phát tương thích; không sửa dữ liệu chính xác của nguồn word-timing.
 */
export function usesLegacyHalfSecondBoundaries(items, captionVersion) {
  if (Number(captionVersion) !== 8) return false;
  const starts = (Array.isArray(items) ? items : [])
    .slice(1)
    .map((item) => Number(item?.start))
    .filter(Number.isFinite);
  if (!starts.length) return false;
  const halfSecond = starts.filter((value) => Math.abs(value - (Math.floor(value) + 0.5)) < 0.02).length;
  return halfSecond / starts.length >= 0.75;
}

/** Mốc phát cuối câu; vá riêng phần +0,5s của bài bản 8 lấy từ transcript DOM. */
export function segmentPlaybackEnd(start, declaredEnd, nextStart, legacyHalfSecond = false, nextStartPad = 0) {
  const from = Number(start) || 0;
  const declared = Number(declaredEnd);
  let end = Number.isFinite(declared) && declared > from ? declared : from + MIN_SPAN;
  const next = Number(nextStart);
  if (Number.isFinite(next) && next > from) {
    const boundary = next - (legacyHalfSecond ? 0.5 : 0) + Math.max(0, Number(nextStartPad) || 0);
    end = Math.min(end, boundary);
  }
  return Math.max(from + 0.15, end);
}

export function countWords(value) {
  return String(value ?? "").split(/\s+/).filter(Boolean).length;
}

/**
 * Dòng phụ đề chỉ mô tả âm thanh, không có lời nào để nhại: "[Music]",
 * "[Applause]", "(laughs)", "♪♪".
 *
 * Chỉ tính khi nhãn chiếm TRỌN dòng. "(laughs)" nằm giữa một câu thật thì vẫn là
 * một phần của câu đó, bỏ đi là mất chữ.
 */
export function isSoundLabel(value) {
  const clean = String(value ?? "").trim();
  if (!clean) return true;
  return /^\[[^\]]*\]$/.test(clean) || /^\([^)]*\)$/.test(clean) || /^[♪♫\s]+$/.test(clean);
}

/**
 * Mốc kết thúc hợp lý cho một đoạn.
 *
 * Khi phụ đề có mốc kết thúc hợp lệ thì tin mốc đó. Ước lượng theo số từ chỉ là
 * phương án cuối cùng cho dữ liệu thật sự thiếu mốc; dùng nó để rút ngắn một
 * mốc hợp lệ sẽ cắt hụt người nói chậm. Mốc đoạn sau chỉ là hàng rào chống một
 * cue hiển thị quá lâu, và có thể cho phép chồng nhẹ khi nguồn có endMs thật.
 *
 * @param {number} start mốc bắt đầu, tính bằng giây
 * @param {number} declaredEnd mốc kết thúc phụ đề khai
 * @param {string} text lời của đoạn
 * @param {number} [nextStart] mốc bắt đầu của đoạn kế tiếp, nếu có
 * @returns {number}
 */
export function spokenEnd(start, declaredEnd, text, nextStart, nextStartPad = 0) {
  const from = Number(start) || 0;
  const declared = Number(declaredEnd);
  const bySpeech = from + countWords(text) / MIN_WORDS_PER_SECOND + TAIL_PAD;
  // Number(null) ra 0 chứ không ra NaN, nên chỉ kiểm isFinite là chưa đủ: thiếu
  // mốc kết thúc sẽ bị hiểu thành "kết thúc ở giây 0" và đoạn nào cũng cụt.
  // Mốc kết thúc nằm trước mốc bắt đầu cũng là dữ liệu hỏng, xử như thiếu.
  const hasDeclared = Number.isFinite(declared) && declared > from;
  // Nhãn âm thanh không phải lời nói nên không cần giữ suốt thời gian hiển thị.
  let end = hasDeclared && !isSoundLabel(text) ? declared : bySpeech;
  const next = Number(nextStart);
  if (Number.isFinite(next) && next > from) end = Math.min(end, next + Math.max(0, Number(nextStartPad) || 0));
  return Math.max(end, from + MIN_SPAN);
}

/**
 * Áp luật trên cho cả một dãy đoạn đã xếp theo thời gian.
 * @template {{start?: number, end?: number, text?: string}} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function trimSilentTails(items, { nextStartPad = 0 } = {}) {
  const list = Array.isArray(items) ? items : [];
  return list.map((item, index) => {
    const next = list[index + 1];
    const end = spokenEnd(item?.start, item?.end, item?.text, next ? Number(next.start) : undefined, nextStartPad);
    return { ...item, end: Math.round(end * 100) / 100 };
  });
}

// Cắt lời thoại thành đoạn để luyện.
//
// Phụ đề YouTube về dưới dạng từng dòng ngắn cắt tuỳ tiện — một câu có thể nằm
// vắt qua bốn dòng. Muốn luyện được thì phải ghép lại rồi cắt theo ĐƠN VỊ NGHĨA.
//
// Cách cũ đếm đủ 30 từ là chặt, bất kể đang đứng ở đâu, nên sinh ra những đoạn
// kết thúc giữa chừng như "…they wouldn't feel safe in a", còn đoạn sau mở đầu
// bằng "car without a human driver". Nhại một mẩu cụt như vậy không học được gì:
// người học không biết ngữ điệu câu lên hay xuống, mà máy chấm cũng chệch.

/** Viết tắt hay gặp — dấu chấm ở đây KHÔNG phải hết câu. */
const ABBREVIATIONS = /\b(mr|mrs|ms|dr|prof|st|vs|etc|eg|ie|approx|no|fig|jr|sr|inc|ltd|u\.s|u\.k)\.$/i;

/**
 * Tách một đoạn chữ thành các câu trọn vẹn.
 * Giữ nguyên dấu câu; không đụng tới khoảng trắng bên trong câu.
 */
export function splitSentences(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const out = [];
  let buffer = "";
  // Dấu ba chấm diễn tả ngập ngừng hoặc ý còn tiếp ("the first thing I saw was
  // ... Meta laid off..."). Che nó trước khi tách để dấu chấm cuối không bị coi
  // là hết câu, rồi khôi phục nguyên ký tự sau đó.
  const protectedText = clean
    .replace(/\.{2,}/g, (value) => "\uE000".repeat(value.length))
    .replace(/…/g, "\uE001");
  const parts = protectedText.split(/(?<=[.!?]["'”’)\]]?)\s+/);
  for (const raw of parts) {
    const part = raw.replace(/\uE000/g, ".").replace(/\uE001/g, "…");
    buffer = buffer ? `${buffer} ${part}` : part;
    // Dấu chấm của chữ viết tắt hoặc của số thứ tự thì chưa phải hết câu.
    if (ABBREVIATIONS.test(buffer) || /\b\d+\.$/.test(buffer)) continue;
    out.push(buffer);
    buffer = "";
  }
  if (buffer) out.push(buffer);
  return out;
}

/** Chỗ có thể ngắt trong một câu dài, xếp theo mức độ "được phép ngắt". */
const BREAKS = [
  // Ngắt mạnh: dấu chấm phẩy, hai chấm, gạch dài — gần như một câu mới.
  { test: (word) => /[;:—–]$/.test(word), rank: 0 },
  // Dấu phẩy đứng ngay trước liên từ nối hai mệnh đề.
  { test: (word, next) => /,$/.test(word) && /^(and|but|so|or|yet|because|which|while|although|though)$/i.test(next ?? ""), rank: 1 },
  { test: (word) => /,$/.test(word), rank: 2 },
  // Liên từ đứng một mình, không có dấu phẩy.
  { test: (word, next) => /^(and|but|so|or|because|which|while|although|though|that)$/i.test(next ?? ""), rank: 3 },
];

/** Điểm ngắt tốt nhất trong khoảng cho phép: ưu tiên ngắt mạnh, rồi tới gần giữa. */
function bestBreak(words, minAt, maxAt) {
  let best = null;
  const middle = (minAt + maxAt) / 2;
  for (let at = minAt; at <= maxAt && at < words.length - 1; at += 1) {
    for (const rule of BREAKS) {
      if (!rule.test(words[at], words[at + 1])) continue;
      const score = { at, rank: rule.rank, gap: Math.abs(at - middle) };
      if (!best || score.rank < best.rank || (score.rank === best.rank && score.gap < best.gap)) best = score;
      break;
    }
  }
  return best ? best.at : -1;
}

/**
 * Cắt một câu quá dài thành các mẩu, ưu tiên ngắt ở ranh giới mệnh đề.
 *
 * Chỉ khi không tìm được chỗ ngắt nào mới đành cắt theo số từ — thà một mẩu cụt
 * còn hơn một đoạn dài tới mức không nhại nổi một hơi.
 */
export function splitLongText(text, maxWords = 30) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const limit = Math.max(4, Number(maxWords) || 30);
  if (words.length <= limit) return words.length ? [words.join(" ")] : [];

  const out = [];
  let rest = words;
  while (rest.length > limit) {
    // Tìm chỗ ngắt trong nửa sau của phần cho phép: cắt quá sớm thì ra mẩu vụn.
    const at = bestBreak(rest, Math.max(3, Math.floor(limit * 0.45)), limit - 1);
    const cut = at >= 0 ? at + 1 : limit;
    out.push(rest.slice(0, cut).join(" "));
    rest = rest.slice(cut);
  }
  if (rest.length) out.push(rest.join(" "));
  return out;
}

/**
 * Cắt cả một đoạn lời thoại thành các mẩu vừa để luyện.
 * Câu trọn vẹn luôn được giữ nguyên; chỉ câu dài quá mức mới bị cắt tiếp.
 */
export function splitForPractice(text, maxWords = 30) {
  return splitSentences(text).flatMap((sentence) => splitLongText(sentence, maxWords));
}

/**
 * Cắt rồi GOM lại thành các mục vừa để luyện.
 *
 * Hai việc khác nhau và đều cần: câu dài quá thì cắt, mà câu ngắn quá thì gom —
 * nhại riêng một câu ba từ thì chẳng luyện được nhịp nào. Điểm mấu chốt là chỉ
 * gom NGUYÊN câu với nhau, không bao giờ ghép nửa câu này với nửa câu kia.
 *
 * maxSentences chặn việc gom quá nhiều câu vào một mục: dài thì khó nhại, mà
 * trong hội thoại còn dễ trộn lời của hai người vào làm một.
 */
export function groupForPractice(text, maxWords = 30, maxSentences = 2) {
  const pieces = splitForPractice(text, maxWords);
  const out = [];
  let current = "";
  let count = 0;

  for (const piece of pieces) {
    const words = piece.split(/\s+/).filter(Boolean).length;
    const currentWords = current ? current.split(/\s+/).filter(Boolean).length : 0;
    if (current && (count >= maxSentences || currentWords + words > maxWords)) {
      out.push(current);
      current = "";
      count = 0;
    }
    current = current ? `${current} ${piece}` : piece;
    if (endsCleanly(piece)) count += 1;
  }
  if (current) out.push(current);
  return out;
}

/** Đoạn có kết thúc trọn vẹn không — dùng để kiểm tra chất lượng phần cắt. */
export function endsCleanly(text) {
  const clean = String(text ?? "").trim();
  if (/(?:\.{2,}|…)["'”’)\]]?$/.test(clean)) return false;
  return /[.!?]["'”’)\]]?$/.test(clean);
}

/**
 * Ranh giới có đang xé một cụm/câu làm đôi hay không.
 *
 * Phụ đề tự động thường cắt đúng lúc đổi dòng, kể cả giữa "New York City" hay
 * sau mạo từ/giới từ. Không thể chỉ nhìn chữ hoa ở đầu đoạn sau: tên riêng vẫn
 * viết hoa dù nó rõ ràng thuộc cùng câu. Danh sách dưới đây chỉ chứa những từ
 * gần như luôn cần một thành phần theo sau, vì vậy nối lại an toàn hơn việc để
 * người học luyện một mẩu cụt.
 */
const HANGING_WORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our", "their",
  "some", "any", "each", "every", "no", "another", "such",
  "and", "but", "or", "so", "because", "although", "though", "while", "if", "when", "which", "who", "whose",
  "of", "to", "for", "from", "with", "without", "in", "on", "at", "by", "about", "into", "through", "during",
  "before", "after", "above", "below", "between", "under", "over", "around", "towards",
  "is", "am", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  // Tiền tố thường gặp của tên địa lý/tổ chức nhiều từ.
  "new", "north", "south", "east", "west", "los", "las", "san", "santa", "saint", "st", "united", "hong",
]);

export function hasAwkwardBoundary(left, right) {
  const before = String(left ?? "").trim();
  const after = String(right ?? "").trim();
  if (!before || !after || endsCleanly(before)) return false;
  if (/(?:[,;:—–]|\.{2,}|…)["'”’)\]]?$/.test(before)) return true;
  if (/^[\p{Ll}]/u.test(after)) return true;
  const last = before.match(/([\p{L}']+)[^\p{L}']*$/u)?.[1]?.toLowerCase() ?? "";
  return HANGING_WORDS.has(last);
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
