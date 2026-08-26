// Hai thứ đỡ cho người học khi nghe một câu: phiên âm từng từ và bản dịch cả câu.
//
// Cả hai đều phải gọi mạng, nên phần quan trọng nhất ở đây là NHỚ LẠI: một video
// mười phút có hàng trăm câu và cả nghìn từ, mà từ thì lặp lại rất nhiều. Không
// nhớ lại thì mỗi lần bật phiên âm là một trận gọi mạng vô nghĩa.

// v2 bỏ các kết quả rỗng đã lưu từ thời endpoint chỉ có một nguồn trực tuyến.
// v3 bỏ cache rỗng của bản cũ và hỗ trợ lại từ ghép. Nếu giữ v2, các từ từng
// tra hụt sẽ mắc kẹt ở dấu chấm mãi dù endpoint mới đã đọc được chúng.
import { hasDigit, spellOut } from "./number-words.mjs";

export const ipaCacheKey = "lexilo:ipa-cache:v3";

/**
 * Dấu ghi "đã tra, không nguồn nào có" — phần lớn là tên riêng (Buli, Sian).
 *
 * Nhớ nó lại cùng một chỗ với phiên âm, thay vì thêm một kho riêng: nhờ vậy
 * missingWords tự động thôi hỏi lại, mà withIpa vẫn trả về phiên âm rỗng.
 */
export const NO_IPA = "∅";
export const translationCacheKey = "lexilo:sentence-vi:v1";
export const MAX_CACHE = 5000;

/**
 * Chuẩn hoá một chữ về khoá tra.
 *
 * PHẢI dùng chung cho cả lúc gửi đi tra lẫn lúc tra lại trong bộ nhớ. Trước đây
 * hai chỗ dùng hai luật khác nhau nên có những chữ không bao giờ khớp được: phụ
 * đề YouTube viết dấu lược cong (don’t), lúc gửi đi nó bị cắt thành hai chữ
 * "don" và "t", còn lúc hiện lên lại đi tìm "dont" — chẳng đời nào có. Mà dấu
 * lược cong thì nằm ở gần như mọi từ rút gọn.
 */
export function wordKey(token) {
  const key = String(token ?? "")
    .normalize("NFC")
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]/gu, "")
    .replace(/^[-']+|[-']+$/g, "");
  // Phải mở đầu bằng chữ cái mới tính là một từ: "2019" không có phiên âm để tra.
  // Luật này để ở ĐÂY chứ không để ở nơi gọi, vì chỉ cần hai nơi hiểu khác nhau
  // một chút là lại sinh ra những chữ không bao giờ khớp.
  return /^\p{L}/u.test(key) ? key : "";
}

/** Các từ cần tra phiên âm trong một câu, đã bỏ dấu câu và bỏ trùng. */
export function lookupWords(text) {
  const words = String(text ?? "")
    .replace(/[‘’ʼ]/g, "'")
    // Gạch dài không phải gạch nối trong từ: tách chữ ra, đừng dính thành "filmsand".
    .replace(/[–—]/g, " ")
    .split(/\s+/)
    // Chữ có số bên trong thì tra theo CÁCH ĐỌC nó: "6" tra "six", "7:30" tra
    // "seven" và "thirty". Trước đây mọi chữ không bắt đầu bằng chữ cái đều bị
    // loại thẳng, nên số chưa từng được gửi đi tra lần nào.
    .flatMap((token) => (hasDigit(token) ? spellOut(token) : [wordKey(token)]))
    .filter(Boolean);
  return [...new Set(words)];
}

/** Từ nào chưa có trong bộ nhớ và thật sự cần gọi mạng. */
export function missingWords(text, cache) {
  return lookupWords(text).filter((word) => !String((cache ?? {})[word] ?? "").trim());
}

/**
 * Ghép phiên âm vào từng từ của câu, GIỮ NGUYÊN dấu câu và chữ hoa.
 *
 * Trả về cả những từ chưa tra được, với ipa rỗng — giao diện cần hiện đủ câu chứ
 * không phải chỉ những từ may mắn có trong từ điển.
 */
export function withIpa(text, cache) {
  const store = cache ?? {};
  return String(text ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (hasDigit(token)) return numberRow(token, store);
      const key = wordKey(token);
      const stored = String(store[key] ?? "");
      // isWord : dấu câu đứng một mình (gạch dài, ba chấm) không phải là chữ.
      // checked: đã tra tới nơi rồi. Thiếu cờ này thì giao diện không phân biệt
      //          được "đang tra" với "tra rồi, không nguồn nào có" — tên riêng
      //          như Buli sẽ treo dấu "…" mãi mãi.
      return {
        word: token,
        ipa: stored === NO_IPA ? "" : stored,
        isWord: Boolean(key),
        checked: Boolean(stored),
      };
    });
}

/**
 * Ghép phiên âm của nhiều chữ thành một: ["/sɪks/","/ˈmɪnət/"] → "/sɪks ˈmɪnət/".
 * Bỏ gạch chéo của từng phần rồi bọc lại một lần; nối thẳng sẽ ra "/sɪks//ˈmɪnət/".
 */
export function joinIpa(parts) {
  const inner = (Array.isArray(parts) ? parts : [])
    .map((part) => String(part ?? "").trim().replace(/^\/|\/$/g, "").trim())
    .filter(Boolean);
  return inner.length ? `/${inner.join(" ")}/` : "";
}

/** Một chữ có số: phiên âm là phần đọc của nó ghép lại. */
function numberRow(token, store) {
  const parts = spellOut(token);
  const found = parts.map((part) => String(store[wordKey(part)] ?? ""));
  // Thiếu một phần thì chưa hiện gì: hiện nửa vời còn khó hiểu hơn để trống.
  const done = parts.length > 0 && found.every((item) => item && item !== NO_IPA);
  return {
    word: token,
    ipa: done ? joinIpa(found) : "",
    isWord: parts.length > 0,
    checked: parts.length > 0 && found.every(Boolean),
  };
}

function readMap(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string"));
  } catch {
    return {};
  }
}

function writeMap(key, map) {
  // Cắt bớt khi quá đầy: giữ phần thêm sau cùng, vì đó là bài đang học.
  const entries = Object.entries(map);
  const kept = entries.length > MAX_CACHE ? Object.fromEntries(entries.slice(-MAX_CACHE)) : map;
  try {
    localStorage.setItem(key, JSON.stringify(kept));
  } catch {
    // Trình duyệt chặn lưu thì vẫn học được, chỉ là lần sau phải tra lại.
  }
  return kept;
}

export function readIpaCache() {
  return readMap(ipaCacheKey);
}

/**
 * Nhớ lại phiên âm vừa tra, và nhớ cả những chữ chắc chắn không có.
 *
 * `missing` chỉ gồm chữ mà máy chủ đã tra tới nơi và khẳng định không nguồn nào
 * có. Chữ tra hỏng vì mạng thì máy chủ KHÔNG nhắc tới, nên không lọt vào đây —
 * nhớ một lần hỏng nghĩa là chữ đó mất phiên âm vĩnh viễn trên máy người học.
 */
export function saveIpa(found, missing = []) {
  const next = { ...readIpaCache() };
  for (const [word, ipa] of Object.entries(found ?? {})) {
    const value = String(ipa ?? "").trim();
    if (value) next[wordKey(word)] = value;
  }
  for (const word of Array.isArray(missing) ? missing : []) {
    const key = wordKey(word);
    // Đừng ghi đè phiên âm đã có bằng dấu "không có".
    if (key && !next[key]) next[key] = NO_IPA;
  }
  return writeMap(ipaCacheKey, next);
}

export function readTranslationCache() {
  return readMap(translationCacheKey);
}

export function saveTranslation(text, vietnamese) {
  const key = String(text ?? "").trim();
  if (!key || !vietnamese) return readTranslationCache();
  return writeMap(translationCacheKey, { ...readTranslationCache(), [key]: String(vietnamese) });
}
