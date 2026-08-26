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
