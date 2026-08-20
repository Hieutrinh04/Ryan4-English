import { NextResponse } from "next/server";
import { identify, spend } from "../../../lib/ai-guard";
import { dictionary } from "cmu-pronouncing-dictionary";

// Tra phiên âm quốc tế cho một lô từ.
//
// Dùng từ điển mở, không gọi mô hình ngôn ngữ. Client nhớ lại kết quả nên mỗi từ
// chỉ tra một lần cho cả đời — xem lib/sentence-aids.mjs.
//
// Từ tra không ra vẫn trả về với chuỗi rỗng, để client nhớ là "đã tra, không có"
// và không hỏi lại mãi một từ vô vọng.

type Entry = { phonetic?: string; phonetics?: { text?: string }[] };

const MAX_WORDS = 40;

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

function localIpa(word: string) {
  const key = word.toLowerCase();
  return ipaFromArpabet(dictionary[key] ?? dictionary[key.replace(/’/g, "'")]);
}

async function lookup(word: string) {
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!response.ok) return localIpa(word);
    const data = (await response.json()) as Entry[];
    if (!Array.isArray(data)) return localIpa(word);
    const ipa = data.find((entry) => entry.phonetic)?.phonetic || data.flatMap((entry) => entry.phonetics ?? []).find((item) => item.text)?.text;
    return String(ipa ?? "").trim() || localIpa(word);
  } catch {
    return localIpa(word);
  }
}

export async function POST(request: Request) {
  const { words } = (await request.json()) as { words?: string[] };
  const list = [...new Set((words ?? []).map((item) => String(item ?? "").trim().toLowerCase()))]
    .filter((word) => /^[a-z][a-z'-]{0,30}$/.test(word))
    .slice(0, MAX_WORDS);
  if (!list.length) return NextResponse.json({ ipa: {} });

  const caller = await identify(request);
  const denied = spend(caller);
  if (denied) return denied;

  const results = await Promise.all(list.map(async (word) => [word, await lookup(word)] as const));
  return NextResponse.json({ ipa: Object.fromEntries(results) });
}
