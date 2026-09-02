// Datamuse trả phiên âm theo bảng ARPABET (kiểu từ điển CMU): chữ hoa, kèm số
// trọng âm — "marks" ra "M AA1 R K S". Đó KHÔNG phải IPA. Ở đây đổi sang IPA đọc
// được để hiển thị cho người học.

const MAP = {
  AA: "ɑ", AE: "æ", AH: "ə", AO: "ɔ", AW: "aʊ", AY: "aɪ",
  B: "b", CH: "tʃ", D: "d", DH: "ð",
  EH: "e", ER: "ɜː", EY: "eɪ",
  F: "f", G: "ɡ", HH: "h",
  IH: "ɪ", IY: "iː", JH: "dʒ",
  K: "k", L: "l", M: "m", N: "n", NG: "ŋ",
  OW: "əʊ", OY: "ɔɪ",
  P: "p", R: "r", S: "s", SH: "ʃ",
  T: "t", TH: "θ",
  UH: "ʊ", UW: "uː",
  V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ",
};
const VOWELS = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);

/** Chuỗi này trông như ARPABET không? (có "AA1", hoặc toàn cụm chữ hoa cách nhau). */
export function looksLikeArpabet(text) {
  const value = String(text ?? "").replace(/[/[\]]/g, " ").trim();
  if (!value) return false;
  if (/[a-zɑæɔʊəɪʃʒŋθðˈˌ]/.test(value)) return false; // đã là IPA thường
  return /\b[A-Z]{1,2}\d\b/.test(value) || /^[A-Z]{1,3}(\s+[A-Z]{1,3}\d?){1,}$/.test(value);
}

/**
 * ARPABET → IPA. "M AA1 R K S" → "mɑrks", đặt ˈ trước âm tiết mang trọng âm chính.
 * @param {string} arpabet
 * @returns {string} chuỗi IPA (không có dấu //). "" nếu không đọc được.
 */
export function arpabetToIpa(arpabet) {
  const raw = String(arpabet ?? "").replace(/[/[\]]/g, " ").trim().toUpperCase();
  if (!raw) return "";
  const tokens = raw.split(/\s+/).filter(Boolean);
  const parts = tokens.map((token) => {
    const phone = token.replace(/\d+$/, "");
    const stress = (token.match(/(\d)$/) || [])[1] ?? "";
    // AH và ER đổi âm theo trọng âm: có nhấn → ʌ / ɜː, không nhấn → ə.
    let ipa = MAP[phone] ?? "";
    if (phone === "AH") ipa = stress === "1" || stress === "2" ? "ʌ" : "ə";
    if (phone === "ER") ipa = stress === "1" || stress === "2" ? "ɜː" : "ə";
    return { phone, stress, ipa };
  });
  if (!parts.some((part) => part.ipa)) return "";

  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].stress !== "1" && parts[i].stress !== "2") continue;
    const mark = parts[i].stress === "1" ? "ˈ" : "ˌ";
    // Kéo dấu trọng âm về trước một phụ âm đầu âm tiết (xấp xỉ maximal onset).
    const at = i > 0 && !VOWELS.has(parts[i - 1].phone) ? i - 1 : i;
    parts[at].ipa = mark + parts[at].ipa;
    parts[i].stress = "";
  }
  return parts.map((part) => part.ipa).join("").replace(/^ˈˌ|ˌˈ/, "ˈ");
}

/**
 * Chuẩn hoá một chuỗi IPA: nếu là ARPABET thì đổi sang IPA, luôn bọc trong //.
 * Trả "" nếu rỗng hoặc placeholder.
 * @param {string} ipa
 */
export function normalizeIpa(ipa) {
  const value = String(ipa ?? "").trim();
  if (!value || value === "/…/" || value === "//") return "";
  const inner = value.replace(/^\/+|\/+$/g, "").trim();
  if (looksLikeArpabet(inner)) {
    const converted = arpabetToIpa(inner);
    return converted ? `/${converted}/` : "";
  }
  return `/${inner}/`;
}
