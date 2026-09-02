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
