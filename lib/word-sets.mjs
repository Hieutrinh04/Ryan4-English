import { wordState } from "./srs.mjs";

// Chia kho từ thành các bộ để chọn học, và đếm tiến độ của từng bộ.
//
// Một từ nằm được trong nhiều bộ cùng lúc: "rescue" vừa thuộc chủ đề JOB, vừa
// thuộc nhóm IELTS "Work & Career", vừa nằm trong bộ Thứ Hai. Cho nên đây là
// bốn cách nhìn khác nhau vào cùng một kho, không phải bốn ngăn tách rời.

/** Bốn cách gom bộ, xếp theo thứ tự hiện trên thanh lọc. */
export const COLLECTIONS = [
  { id: "topic", label: "Theo chủ đề" },
  { id: "ielts", label: "Chủ đề IELTS" },
  { id: "week", label: "Theo tuần" },
  { id: "mine", label: "Từ tôi thêm" },
];

const WEEKDAYS = {
  monday: "Thứ Hai",
  tuesday: "Thứ Ba",
  wednesday: "Thứ Tư",
  thursday: "Thứ Năm",
  friday: "Thứ Sáu",
  saturday: "Thứ Bảy",
  sunday: "Chủ Nhật",
};

/** Nguồn của bộ từ theo tuần có dạng "01 Monday.xlsx" — lấy ra tên thứ tiếng Việt. */
export function weekdayLabel(source) {
  const match = /^(\d+)\s+([A-Za-z]+)\.(xlsx|csv)$/i.exec(String(source ?? "").trim());
  if (!match) return "";
  return WEEKDAYS[match[2].toLowerCase()] ?? "";
}

/** Thứ tự trong tuần, để bộ Thứ Hai luôn đứng trước Chủ Nhật dù đếm được bao nhiêu từ. */
function weekdayOrder(source) {
  const match = /^(\d+)\s/.exec(String(source ?? "").trim());
  return match ? Number(match[1]) : 99;
}

/**
 * Từ do người dùng tự thêm hoặc tra từ điển: chỉ những bộ nhập sẵn mới ghi
 * source, còn từ thêm tay thì để trống.
 *
 * Đừng đoán theo đuôi tệp. Lúc đầu tôi coi mọi nguồn không phải .xlsx là do
 * người dùng thêm, thế là cả 983 từ của bộ MochiMochi — nguồn ghi bằng chữ,
 * không có đuôi tệp — chui hết vào "Từ tôi thêm".
 */
function isMine(word) {
  return !String(word?.source ?? "").trim();
}

/**
 * Đếm trạng thái của một danh sách từ. Dùng cho cả toàn kho lẫn từng bộ.
 *
 * "Cần ôn" và "chưa học" phải là hai con số tách rời. Gộp lại thì thẻ "cần ôn
 * hôm nay" của một người mới dùng hiện ra gần bằng cả kho — 1156 từ — mà không
 * ai ôn 1156 từ trong một ngày, nên con số đó chẳng nói lên điều gì.
 */
export function deckStats(words) {
  const list = Array.isArray(words) ? words : [];
  let learned = 0;
  let due = 0;
  let fresh = 0;
  let mastered = 0;
  for (const word of list) {
    const key = wordState(word).key;
    if (key === "mastered") mastered += 1;
    // "Đã học" là đã từng đụng tới, kể cả từ đã thuộc — nếu trừ từ đã thuộc ra
    // thì con số này tụt xuống mỗi khi người học tiến bộ, nhìn rất vô lý.
    if (key !== "new") learned += 1;
    if (key === "due") due += 1;
    if (key === "new") fresh += 1;
  }
  return { total: list.length, learned, due, fresh, mastered };
}

function makeSet(id, label, words, extra = {}) {
  return { id, label, words, ...deckStats(words), ...extra };
}

/**
 * Các bộ từ của một cách gom.
 * Bộ rỗng bị loại: thẻ ghi "0 từ" chỉ tổ chỗ chứ không bấm vào được.
 */
export function setsFor(words, collection) {
  const list = Array.isArray(words) ? words : [];

  if (collection === "mine") {
    const mine = list.filter(isMine);
    return mine.length ? [makeSet("mine", "Từ tôi thêm", mine)] : [];
  }

  if (collection === "week") {
    const groups = new Map();
    for (const word of list) {
      const label = weekdayLabel(word?.source);
      if (!label) continue;
      const key = String(word.source).trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(word);
    }
    return [...groups.entries()]
      .sort((a, b) => weekdayOrder(a[0]) - weekdayOrder(b[0]))
      .map(([source, group]) => makeSet(source, weekdayLabel(source), group));
  }

  const groups = new Map();
  for (const word of list) {
    const labels =
      collection === "ielts"
        ? (Array.isArray(word?.ieltsTopics) ? word.ieltsTopics : [])
        : String(word?.topic ?? "").split(" · ");
    for (const raw of labels) {
      const label = String(raw ?? "").trim();
      if (!label) continue;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(word);
    }
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([label, group]) => makeSet(label, label, group));
}

/** Phần trăm đã học của một bộ, làm tròn xuống để 99% không hiện thành 100%. */
export function progressOf(set) {
  if (!set?.total) return 0;
  return Math.floor((set.learned / set.total) * 100);
}

/**
 * Chủ đề tiếng Anh của bộ PDF ghi kiểu "FEELING - CẢM XÚC". Tách đôi để hiện
 * tên tiếng Việt to, tên tiếng Anh nhỏ bên dưới.
 */
export function splitLabel(label) {
  const text = String(label ?? "").trim();
  const match = /^([A-Z][A-Z\s&']*?)\s+-\s+(.+)$/.exec(text);
  if (!match) return { main: text, sub: "" };
  return { main: match[2].trim(), sub: match[1].trim() };
}

/** Lọc bộ theo ô tìm kiếm; bỏ dấu để gõ "cam xuc" vẫn ra "CẢM XÚC". */
export function searchSets(sets, query) {
  const needle = plain(query);
  if (!needle) return sets;
  return sets.filter((set) => plain(set.label).includes(needle));
}

function plain(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();
}
