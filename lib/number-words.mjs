// Đọc số thành chữ, để tra được phiên âm.
//
// Trong phụ đề, số viết bằng chữ số rất nhiều: "6 Minute English", "in 2019",
// "at 7:30". Phần tra phiên âm chỉ nhận chữ cái nên mọi con số đều rơi ra ngoài
// và người học không thấy cách đọc — mà đọc số lại là chỗ họ hay vấp nhất.
//
// Đây KHÔNG phải đoán: "6" đọc là "six" là chuyện xác định, tra ra phiên âm
// chuẩn của "six". Khác hẳn với việc ước lượng cách đọc một cái tên lạ.

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Số dưới 100. */
function underHundred(value) {
  if (value < 20) return [ONES[value]];
  const ten = Math.floor(value / 10);
  const one = value % 10;
  return one ? [TENS[ten], ONES[one]] : [TENS[ten]];
}

/** Số dưới 1000. */
function underThousand(value) {
  if (value < 100) return underHundred(value);
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  const words = [ONES[hundred], "hundred"];
  return rest ? [...words, ...underHundred(rest)] : words;
}

/**
 * Số nguyên thành danh sách chữ.
 * Chặn ở dưới một tỉ: dài hơn nữa thì trong phụ đề gần như không có, mà đọc ra
 * cũng thành một tràng chữ chẳng ai học được gì.
 */
export function numberToWords(value) {
  // Number(null) và Number("") đều ra 0, tức là số hợp lệ — phải chặn trước,
  // nếu không truyền vào null lại nhận về "zero".
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value.trim()))) return [];
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number >= 1e9) return [];
  if (number < 1000) return underThousand(number);

  const parts = [];
  const million = Math.floor(number / 1e6);
  const thousand = Math.floor((number % 1e6) / 1000);
  const rest = number % 1000;
  if (million) parts.push(...underThousand(million), "million");
  if (thousand) parts.push(...underThousand(thousand), "thousand");
  if (rest) parts.push(...underThousand(rest));
  return parts;
}

/**
 * Cách người ta thật sự đọc một con số trong câu.
 *
 * Năm bốn chữ số đọc theo cặp: 1990 là "nineteen ninety" chứ không ai đọc "one
 * thousand nine hundred ninety". Nhưng 2005 thì lại đọc "two thousand five", và
 * các năm 2000–2009 đều vậy — nên phải tách riêng khoảng đó.
 */
export function readNumber(token) {
  const raw = String(token ?? "").trim();
  const text = raw.replace(/,/g, "");
  if (!/^\d+$/.test(text)) return [];
  const number = Number(text);

  // Năm: bốn chữ số trong khoảng đời thường, đọc theo cặp. Có dấu phẩy ngăn
  // nghìn thì đó là một lượng chứ không phải năm — "1,500" là một nghìn rưỡi,
  // không ai đọc thành "fifteen hundred".
  if (!raw.includes(",") && text.length === 4 && number >= 1100 && number <= 2099) {
    const head = Math.floor(number / 100);
    const tail = number % 100;
    // 2000–2009 đọc trọn: "two thousand nine".
    if (head === 20 && tail < 10) return numberToWords(number);
    if (tail === 0) return [...underHundred(head), "hundred"];
    if (tail < 10) return [...underHundred(head), "oh", ONES[tail]];
    return [...underHundred(head), ...underHundred(tail)];
  }

  return numberToWords(number);
}

/**
 * Tách một chữ có lẫn số thành các phần đọc được.
 * "6" → ["six"] · "7:30" → ["seven","thirty"] · "COVID-19" → ["covid","nineteen"]
 */
export function spellOut(token) {
  const text = String(token ?? "").trim();
  if (!text) return [];
  const pieces = text.split(/([0-9]+)/).filter(Boolean);
  const out = [];
  for (const piece of pieces) {
    if (/^\d+$/.test(piece)) out.push(...readNumber(piece));
    else {
      // Bỏ gạch nối và dấu lược ở hai đầu: "COVID-" phải thành "covid".
      const letters = piece.replace(/[^\p{L}'-]/gu, "").replace(/^[-']+|[-']+$/g, "");
      if (letters) out.push(letters.toLowerCase());
    }
  }
  return out;
}

/** Chữ này có số bên trong không — tức có cần đọc ra chữ trước khi tra. */
export function hasDigit(token) {
  return /\d/.test(String(token ?? ""));
}
