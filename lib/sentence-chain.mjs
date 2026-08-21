// Ghép câu kế tiếp.
//
// Nói được từng câu rời không có nghĩa là nói được cả đoạn: chỗ khó nằm ở mối
// nối giữa hai câu, nơi phải giữ hơi và giữ nhịp. Nên sau khi xong một câu,
// người học ghép thêm câu sau vào và nói liền một mạch.
//
// Giới hạn hai câu ghép thêm. Dài hơn nữa thì thành đọc diễn văn, mà phần nhận
// dạng giọng nói cũng bắt đầu rơi rụng, chấm ra điểm không còn đáng tin.

export const MAX_CHAIN = 2;

/** Còn câu phía sau để ghép, và chưa chạm mức tối đa. */
export function canChain(sentences, index, chain) {
  const list = Array.isArray(sentences) ? sentences : [];
  const at = Number(index) || 0;
  const depth = Number(chain) || 0;
  return depth < MAX_CHAIN && at + depth + 1 < list.length;
}

/**
 * Đoạn đang luyện: câu hiện tại cộng thêm `chain` câu phía sau.
 * chain = 0 nghĩa là chỉ một câu, tức y như trước khi có tính năng này.
 */
export function chainOf(sentences, index, chain) {
  const list = Array.isArray(sentences) ? sentences : [];
  const at = Math.max(0, Number(index) || 0);
  const head = list[at];
  if (!head) return null;

  const depth = Math.max(0, Math.min(Number(chain) || 0, MAX_CHAIN));
  const parts = [];
  for (let step = 0; step <= depth; step += 1) {
    const item = list[at + step];
    if (!item) break;
    parts.push(item);
  }

  const tail = parts[parts.length - 1];
  const text = parts.map((item) => String(item.text ?? "").trim()).filter(Boolean).join(" ");
  return {
    parts,
    count: parts.length,
    words: countWords(text),
    text,
    start: Number(head.start) || 0,
    end: Number(tail.end) || Number(head.end) || 0,
  };
}

/**
 * Mức ghép hợp lệ khi chuyển sang câu khác.
 * Nhảy tới câu áp chót mà vẫn giữ mức ghép 2 thì đoạn sẽ thiếu câu — kéo về cho vừa.
 */
export function clampChain(sentences, index, chain) {
  const list = Array.isArray(sentences) ? sentences : [];
  const at = Math.max(0, Number(index) || 0);
  const wanted = Math.max(0, Math.min(Number(chain) || 0, MAX_CHAIN));
  return Math.min(wanted, Math.max(0, list.length - 1 - at));
}

/** Đếm từ của một đoạn. Để ở đây thay vì viết thẳng trong giao diện — biểu thức
 * chính quy nằm trong JSX rất dễ bị hỏng lúc sửa mà không ai thấy. */
export function countWords(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}
