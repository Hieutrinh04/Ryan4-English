// Tách một dòng dán vào thành từ, loại từ và nghĩa.
//
// Giao diện hứa "App tự tách nghĩa", và thông báo lỗi của luồng nhập tệp cũng
// nói rõ định dạng "từ (loại từ): nghĩa". Trước đây phần dán lại lấy NGUYÊN cả
// dòng làm tên từ, nên dán "resilient (adj): kiên cường" sẽ tạo ra một thẻ tên
// là cả câu đó, nghĩa để trống, và không nhận ra nó trùng với "resilient" đã có.
//
// Dấu "/" KHÔNG phải dấu tách: "shopping cart / trolley" là một mục, đúng như
// gợi ý ngay trên ô nhập.

/** Các dấu ngăn giữa từ và nghĩa, thử theo thứ tự này. */
const SEPARATORS = [":", "\t", " – ", " — ", " = ", " - "];

function splitOnce(line) {
  for (const mark of SEPARATORS) {
    const at = line.indexOf(mark);
    // Bỏ qua dấu nằm ngay đầu dòng: khi đó vế trái rỗng, không phải tên từ.
    if (at > 0) return [line.slice(0, at), line.slice(at + mark.length)];
  }
  return [line, ""];
}

/** Bóc "(adj)" hoặc "(n, v)" ở cuối tên từ ra thành loại từ. */
function pullPartOfSpeech(term) {
  const match = term.match(/^(.*?)\s*\(([^)]{1,24})\)\s*$/);
  if (!match) return { term: term.trim(), partOfSpeech: "" };
  return { term: match[1].trim(), partOfSpeech: match[2].trim() };
}

/**
 * Một dòng → một mục. Trả về null nếu dòng không có gì đáng lấy.
 * @param {string} line
 */
export function parseLine(line) {
  const clean = String(line ?? "")
    // Bỏ dấu đầu dòng của danh sách: "-", "•", "1.", "2)"…
    .replace(/^[-•*\u2022]+\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();
  if (!clean) return null;

  const [left, right] = splitOnce(clean);
  const { term, partOfSpeech } = pullPartOfSpeech(left);
  if (!term) return null;
  return {
    term: term.replace(/\s+/g, " "),
    partOfSpeech,
    meaning: right.trim().replace(/\s+/g, " "),
  };
}

/**
 * Cả khối chữ → danh sách mục, đã bỏ dòng rỗng và trùng lặp trong chính khối đó.
 * @param {string} text
 * @param {number} [limit]
 */
export function parsePaste(text, limit = 200) {
  const seen = new Set();
  const items = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const item = parseLine(line);
    if (!item) continue;
    const key = item.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}
