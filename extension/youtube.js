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

/** Chậm hơn mức này thì gần như chắc chắn là khoảng lặng, không phải nói chậm. */
export const MIN_WORDS_PER_SECOND = 1.2;
/** Chừa chỗ cho phụ âm cuối và nhịp ngắt tự nhiên cuối câu. */
export const TAIL_PAD = 0.6;
/** Đoạn ngắn hơn mức này thì bấm nghe cũng không kịp nhận ra gì. */
const MIN_SPAN = 0.3;

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
 * Lấy cái sớm nhất trong ba mốc: mốc phụ đề khai, mốc suy ra từ tốc độ nói, và
 * mốc bắt đầu của đoạn kế tiếp.
 *
 * @param {number} start mốc bắt đầu, tính bằng giây
 * @param {number} declaredEnd mốc kết thúc phụ đề khai
 * @param {string} text lời của đoạn
 * @param {number} [nextStart] mốc bắt đầu của đoạn kế tiếp, nếu có
 * @returns {number}
 */
export function spokenEnd(start, declaredEnd, text, nextStart) {
  const from = Number(start) || 0;
  const declared = Number(declaredEnd);
  const bySpeech = from + countWords(text) / MIN_WORDS_PER_SECOND + TAIL_PAD;
  // Number(null) ra 0 chứ không ra NaN, nên chỉ kiểm isFinite là chưa đủ: thiếu
  // mốc kết thúc sẽ bị hiểu thành "kết thúc ở giây 0" và đoạn nào cũng cụt.
  // Mốc kết thúc nằm trước mốc bắt đầu cũng là dữ liệu hỏng, xử như thiếu.
  const hasDeclared = Number.isFinite(declared) && declared > from;
  let end = hasDeclared ? Math.min(declared, bySpeech) : bySpeech;
  const next = Number(nextStart);
  if (Number.isFinite(next) && next > from) end = Math.min(end, next);
  return Math.max(end, from + MIN_SPAN);
}

/**
 * Áp luật trên cho cả một dãy đoạn đã xếp theo thời gian.
 * @template {{start?: number, end?: number, text?: string}} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function trimSilentTails(items) {
  const list = Array.isArray(items) ? items : [];
  return list.map((item, index) => {
    const next = list[index + 1];
    const end = spokenEnd(item?.start, item?.end, item?.text, next ? Number(next.start) : undefined);
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
  const parts = clean.split(/(?<=[.!?]["'”’)\]]?)\s+/);
  for (const part of parts) {
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
  return /[.!?]["'”’)\]]?$/.test(String(text ?? "").trim());
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
    // Dòng chỉ mô tả âm thanh thì không có lời nào để nhại; giữ lại chỉ tạo ra
    // một thẻ câu bấm vào là nghe nhạc.
    if (isSoundLabel(text)) continue;
    const start = (event.tStartMs ?? 0) / 1000;
    cues.push({ start, end: start + (event.dDurationMs ?? 0) / 1000, text });
  }
  return trimSilentTails(cues);
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
