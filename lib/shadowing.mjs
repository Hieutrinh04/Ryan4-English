// Chấm bài nói nhại (shadowing).
//
// PHẢI NÓI RÕ GIỚI HẠN: trình duyệt chỉ cho biết máy NGHE RA chữ gì, không cho
// biết bạn phát âm chuẩn hay không. Hai thứ đó khác nhau. Một từ phát âm chưa
// chuẩn vẫn có thể được nghe ra đúng nhờ ngữ cảnh, và ngược lại phát âm chuẩn
// vẫn có thể bị nghe nhầm vì ồn hay vì máy quen giọng khác. Vì vậy con số ở đây
// gọi là "độ rõ lời" — mức độ máy nghe ra đúng chữ bạn định nói — chứ không gọi
// là "điểm phát âm". Gọi sai tên sẽ khiến người học tin vào một con số không có
// thật.
//
// Dù vậy độ rõ lời vẫn đáng luyện: nó chính là thứ quyết định người nghe có hiểu
// bạn hay không.

import { alignTokens, tokenize } from "./translation-check.mjs";

/** Đuôi hay bị nuốt: người Việt thường bỏ phụ âm cuối, làm mất luôn thì và số nhiều. */
const ENDING = /(s|es|ed|ing|d|t)$/;

/**
 * So câu mẫu với chữ máy nghe được.
 * - ok      : nghe ra đúng
 * - swallow : đúng gốc nhưng sai đuôi — thường là nuốt phụ âm cuối
 * - missed  : không nghe ra
 * Từ thừa (máy nghe ra chữ không có trong câu) để riêng, không trừ vào độ rõ lời
 * vì phần lớn là tiếng ồn hoặc máy đoán thêm.
 */
export function scoreShadowing(target, heard) {
  const reference = tokenize(target);
  const spoken = tokenize(heard);
  if (!reference.length) return { clarity: 0, words: [], missed: [], swallowed: [], extra: [], spokenCount: spoken.length };

  const operations = alignTokens(reference, spoken);
  const words = [];
  const extra = [];
  for (const operation of operations) {
    if (operation.type === "same") words.push({ word: operation.reference, status: "ok" });
    else if (operation.type === "form") words.push({ word: operation.reference, heard: operation.answer, status: "swallow" });
    else if (operation.type === "missing") words.push({ word: operation.reference, status: "missed" });
    else extra.push(operation.answer);
  }

  // Sai đuôi tính nửa điểm: ý đã tới nhưng người nghe mất thông tin thì và số nhiều.
  const earned = words.reduce((total, item) => total + (item.status === "ok" ? 1 : item.status === "swallow" ? 0.5 : 0), 0);
  return {
    clarity: Math.round((earned / reference.length) * 100),
    words,
    missed: words.filter((item) => item.status === "missed").map((item) => item.word),
    swallowed: words.filter((item) => item.status === "swallow").map((item) => item.word),
    extra,
    spokenCount: spoken.length,
  };
}

/** Tốc độ nói, tính theo số từ trong câu mẫu và thời gian thực tế đã nói. */
export function paceOf(wordCount, seconds) {
  if (!seconds || seconds <= 0 || !wordCount) return { wpm: 0, verdict: "unknown" };
  const wpm = Math.round((wordCount / seconds) * 60);
  // Người bản ngữ nói chuyện thường 140–160 wpm. Người mới nhại nên nhắm 110–150:
  // dưới nữa là đọc từng chữ, trên nữa là chạy theo âm mà bỏ mất phụ âm cuối.
  const verdict = wpm < 90 ? "slow" : wpm > 165 ? "fast" : "good";
  return { wpm, verdict };
}

const PACE_TEXT = {
  slow: "Bạn đang đọc từng chữ hơn là nói. Thử bám sát nhịp của câu mẫu, kể cả khi chưa kịp tròn tiếng.",
  fast: "Bạn nói nhanh hơn câu mẫu. Nhanh quá thường kéo theo nuốt phụ âm cuối — chậm lại một chút sẽ rõ hơn.",
  good: "Nhịp nói của bạn đang bám sát câu mẫu.",
};

/** Nhận xét bằng tiếng Việt, chỉ dựa trên những gì đo được thật. */
export function shadowingAdvice(result, pace) {
  const notes = [];
  if (!result.spokenCount) {
    notes.push({ kind: "warn", text: "Chưa ghi nhận được tiếng nói nào. Kiểm tra micro, hoặc nói to và gần máy hơn." });
    return notes;
  }

  const endings = result.swallowed.filter((word) => ENDING.test(word));
  if (endings.length) {
    notes.push({
      kind: "focus",
      // Đây là lỗi phổ biến nhất của người Việt nói tiếng Anh, và cũng là lỗi
      // làm mất nghĩa nhiều nhất: mất "-s" là mất số nhiều, mất "-ed" là mất thì.
      text: `Phụ âm cuối bị nuốt ở: ${endings.join(", ")}. Đọc bật hẳn đuôi ra — mất "-s" là mất số nhiều, mất "-ed" là mất thì quá khứ.`,
    });
  }
  const others = result.swallowed.filter((word) => !ENDING.test(word));
  if (others.length) notes.push({ kind: "focus", text: `Nghe chệch sang chữ khác ở: ${others.join(", ")}. Nghe lại câu mẫu ở tốc độ chậm rồi nói lại riêng mấy từ này.` });
  if (result.missed.length) notes.push({ kind: "focus", text: `Chưa nghe ra: ${result.missed.join(", ")}. Có thể bạn nói lướt qua, hoặc bỏ hẳn từ vì chạy theo nhịp.` });

  if (pace?.verdict && pace.verdict !== "unknown") notes.push({ kind: pace.verdict === "good" ? "good" : "info", text: PACE_TEXT[pace.verdict] });

  if (result.clarity >= 90 && !result.missed.length) {
    notes.push({ kind: "good", text: "Câu này máy nghe ra gần như trọn vẹn. Tăng tốc độ mẫu lên một nấc rồi nhại lại." });
  }
  notes.push({
    kind: "info",
    text: "Lưu ý: máy chỉ cho biết nó NGHE RA chữ gì, không chấm được giọng bạn chuẩn hay chưa. Nghe lại bản ghi của mình cạnh câu mẫu là cách đối chiếu đáng tin nhất.",
  });
  return notes;
}

/** Gom các câu cùng một bài thành đoạn để nhại liên tục, thay vì nhại từng câu rời. */
export function buildShadowingLessons(lessons) {
  const groups = new Map();
  for (const lesson of lessons) {
    const key = `${lesson.topic}::${lesson.title}`;
    const group = groups.get(key) ?? { id: key, topic: lesson.topic, title: lesson.title, level: lesson.level, lines: [], sourceName: lesson.sourceName, sourceUrl: lesson.sourceUrl, license: lesson.license };
    group.lines.push({ id: lesson.id, text: lesson.sentence });
    // Trình độ của cả bài lấy theo câu khó nhất trong bài.
    if (LEVELS.indexOf(lesson.level) > LEVELS.indexOf(group.level)) group.level = lesson.level;
    groups.set(key, group);
  }
  return [...groups.values()];
}

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

/** Số phút luyện nói, làm tròn lên để một lượt ngắn vẫn được ghi nhận. */
export function minutesOf(seconds) {
  return Math.max(1, Math.round(seconds / 60));
}
