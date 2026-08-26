import { NextResponse } from "next/server";
import { dictionary } from "cmu-pronouncing-dictionary";
import { generateJson, hasLlm } from "../../../lib/llm";
import { identify, refund, spend } from "../../../lib/ai-guard";

// Tra phiên âm quốc tế cho một lô từ.
//
// Dùng từ điển mở, không gọi mô hình ngôn ngữ. Client nhớ lại kết quả nên mỗi từ
// chỉ tra một lần cho cả đời — xem lib/sentence-aids.mjs.
//
// Từ tra không ra vẫn trả về với chuỗi rỗng, để client nhớ là "đã tra, không có"
// và không hỏi lại mãi một từ vô vọng.

type Entry = { phonetic?: string; phonetics?: { text?: string }[] };

// Một đoạn ghép ba câu dài có thể qua 40 chữ khác nhau. Cắt ở 40 là lặng lẽ bỏ
// rơi phần đuôi, và vì client không nhớ chữ tra hụt nên nó hỏng lại y hệt ở mọi
// lần vào bài. Phần lớn chữ nằm sẵn trong CMU nên tra cục bộ, nâng mức này gần
// như không tốn gì.
const MAX_WORDS = 120;

// Số chữ tối đa hỏi mô hình trong một lượt. Tên riêng trong một đoạn rất ít, mà
// kết quả thì được nhớ vĩnh viễn, nên mức này đủ rộng và không tốn hạn mức mấy.
const MAX_GUESS = 8;

const ARPA: Record<string, string> = {
  AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "aʊ", AY: "aɪ", EH: "ɛ", ER: "ɝ", EY: "eɪ",
  IH: "ɪ", IY: "i", OW: "oʊ", OY: "ɔɪ", UH: "ʊ", UW: "u", B: "b", CH: "tʃ", D: "d",
  DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "dʒ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ",
  P: "p", R: "r", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ",
};

function ipaFromArpabet(value?: string) {
  if (!value) return "";
  const phones = value.split("#")[0].trim().split(/\s+/).filter(Boolean);
  const output = phones.map((phone) => {
    const match = /^([A-Z]+)([012])?$/.exec(phone);
    if (!match) return "";
    const [, base, stress] = match;
    let sound = ARPA[base] ?? "";
    if (base === "AH" && stress === "0") sound = "ə";
    if (base === "ER" && stress === "0") sound = "ɚ";
    return `${stress === "1" ? "ˈ" : stress === "2" ? "ˌ" : ""}${sound}`;
  }).join("");
  return output ? `/${output}/` : "";
}

/** "café" → "cafe": CMU chỉ lưu chữ không dấu, mà phụ đề thì viết có dấu. */
function plainLetters(word: string) {
  return word.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function localIpa(word: string) {
  const key = word.toLowerCase();
  const direct = ipaFromArpabet(dictionary[key] ?? dictionary[key.replace(/’/g, "'")] ?? dictionary[plainLetters(key)]);
  if (direct) return direct;
  // CMU lưu phần lớn từ đơn nhưng không có mọi tổ hợp gạch nối. Ghép các phần
  // vẫn chính xác và hữu ích hơn trả rỗng cho self-driving/American-English.
  if (key.includes("-")) {
    const parts = key.split("-").filter(Boolean).map((part) => ipaFromArpabet(dictionary[part]));
    if (parts.length > 1 && parts.every(Boolean)) return `/${parts.map((part) => part.slice(1, -1)).join(" · ")}/`;
  }
  return "";
}

// Ba kết quả khác nhau, và client cần phân biệt được cả ba:
//   found   → có phiên âm
//   missing → đã tra tới nơi, chắc chắn không nguồn nào có (thường là tên riêng)
//   error   → tra hỏng vì mạng; ĐỪNG nhớ, để lần sau còn thử lại
type Result = { kind: "found"; ipa: string } | { kind: "missing" } | { kind: "error" };

async function lookup(word: string): Promise<Result> {
  // Phần lớn từ nằm sẵn trong CMU: trả ngay, không chờ mạng và không tiêu bất kỳ
  // hạn mức AI nào. Nguồn trực tuyến chỉ bổ sung cho từ hiếm chưa có cục bộ.
  const local = localIpa(word);
  if (local) return { kind: "found", ipa: local };
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    // 404 nghĩa là nguồn đã tra và không có mục từ này — đó là câu trả lời dứt
    // khoát, khác hẳn với 5xx hay đứt mạng.
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok) return { kind: "error" };
    const data = (await response.json()) as Entry[];
    if (!Array.isArray(data)) return { kind: "missing" };
    const ipa = data.find((entry) => entry.phonetic)?.phonetic || data.flatMap((entry) => entry.phonetics ?? []).find((item) => item.text)?.text;
    const clean = String(ipa ?? "").trim();
    return clean ? { kind: "found", ipa: clean } : { kind: "missing" };
  } catch {
    return { kind: "error" };
  }
}

export async function POST(request: Request) {
  const { words } = (await request.json()) as { words?: string[] };
  // Nhận cả chữ có dấu (café) và có số (covid-19). Lọc theo bảng chữ a–z là loại
  // đúng những chữ mà giao diện vẫn hiện ra, nên chúng mắc kẹt không có phiên âm.
  const list = [...new Set((words ?? []).map((item) => String(item ?? "").trim().toLowerCase()))]
    .filter((word) => /^\p{L}[\p{L}\p{N}'-]{0,30}$/u.test(word))
    .slice(0, MAX_WORDS);
  if (!list.length) return NextResponse.json({ ipa: {} });

  const results = await Promise.all(list.map(async (word) => [word, await lookup(word)] as const));
  const ipa: Record<string, string> = {};
  const missing: string[] = [];
  for (const [word, result] of results) {
    if (result.kind === "found") ipa[word] = result.ipa;
    else if (result.kind === "missing") missing.push(word);
    // kind === "error": không nhắc tới trong câu trả lời, client sẽ hỏi lại sau.
  }

  // Tầng cuối: hỏi mô hình. Chỉ dành cho chữ mà CẢ HAI từ điển đều không có —
  // gần như luôn là tên riêng (Pippa, Sian). Đây đúng là chỗ quy tắc đọc theo
  // mặt chữ sai nhiều nhất, nên tự suy ra từ chính tả còn tệ hơn là hỏi.
  //
  // Kết quả trả về ở khoá riêng "estimated" chứ không trộn vào "ipa": nó là
  // phỏng đoán, và giao diện phải nói rõ điều đó với người học.
  const estimated: Record<string, string> = {};
  const askable = missing.slice(0, MAX_GUESS);
  if (askable.length && hasLlm()) {
    const caller = await identify(request);
    if (!spend(caller)) {
      try {
        const data = await generateJson<{ ipa?: Record<string, string> }>(
          `Cho biết phiên âm IPA kiểu Mỹ của các chữ sau. Phần lớn là tên riêng.
Mỗi chữ một phiên âm, đặt giữa hai dấu gạch chéo, có dấu nhấn.
Chữ nào bạn thực sự không biết cách đọc thì bỏ hẳn khỏi kết quả, đừng đoán bừa.

Danh sách: ${askable.join(", ")}

Trả về JSON thuần: {"ipa":{"chữ":"/phiên âm/"}}`,
          { temperature: 0, timeoutMs: 20000 },
        );
        for (const [word, value] of Object.entries(data.ipa ?? {})) {
          const key = String(word).trim().toLowerCase();
          const clean = String(value ?? "").trim();
          if (askable.includes(key) && /^\/.+\/$/.test(clean)) estimated[key] = clean;
        }
      } catch {
        // Hỏi không được thì thôi: chữ đó vẫn nằm trong missing như trước.
        refund(caller);
      }
    }
  }

  return NextResponse.json({
    ipa,
    // Chữ đã đoán được thì không còn là "chắc chắn không có" nữa.
    missing: missing.filter((word) => !estimated[word]),
    estimated,
  });
}
