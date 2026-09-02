/**
 * Làm sạch câu tiếng Việt lấy từ PDF mà không xóa nhầm khoảng trắng giữa từ.
 *
 * Một số bản PDF tách phụ âm cuối thành một token riêng, ví dụ "chuyế n".
 * Chỉ nối khi phụ âm thực sự đứng một mình (sau nó là khoảng trắng, dấu câu
 * hoặc hết câu). Không dùng \b vì ranh giới từ của JavaScript không hiểu đầy
 * đủ chữ có dấu và từng biến "nhỏ của" thành "nhỏcủa".
 */
export function cleanStudyVietnamese(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/([A-Za-zÀ-ỹĐđ])\s+([nmptc])(?=\s|[,.;:!?]|$)/gu, "$1$2")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
