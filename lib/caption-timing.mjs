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
 */
export const CAPTION_VERSION = 4;

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
