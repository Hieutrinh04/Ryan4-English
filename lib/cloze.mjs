// Khoét chỗ trống tại từ đang học trong một câu ví dụ.
//
// Tách khỏi app/page.tsx để kiểm thử import thẳng thay vì trích hàm ra khỏi mã
// nguồn bằng biểu thức chính quy.

/**
 * Thay từ đang học trong câu bằng "_____".
 *
 * Từ khoá trong file PDF dính nhiễu OCR ("white (n, adj)", "bus bicycle",
 * "actor/ actress") nên phải thử dần: chuỗi đầy đủ → bản đã bỏ ngoặc → phần
 * trước dấu / → từng từ thành phần, dài trước ngắn sau. Không khớp được gì thì
 * trả nguyên câu, thà không khoét còn hơn khoét nhầm chỗ.
 *
 * @param {string} term từ đang học
 * @param {string} example câu ví dụ
 */
export function clozeFor(term, example) {
  const cleaned = term.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const candidates = [
    term.trim(),
    cleaned,
    cleaned.split("/")[0].trim(),
    ...cleaned
      .split(/[\s/]+/)
      .filter((word) => word.length >= 3)
      .sort((a, b) => b.length - a.length),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Thử ranh giới từ trước; không được mới chấp nhận khớp giữa từ, vì có những
    // từ khoá chỉ xuất hiện dưới dạng biến thể ("fly" trong "flying").
    for (const pattern of [`\\b${escaped}\\b`, escaped]) {
      const blanked = example.replace(new RegExp(pattern, "i"), "_____");
      if (blanked !== example) return blanked;
    }
  }
  return example;
}
