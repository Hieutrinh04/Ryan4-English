import { NextResponse } from "next/server";
import { identify, spend } from "../../../lib/ai-guard";

// Tra phiên âm quốc tế cho một lô từ.
//
// Dùng từ điển mở, không gọi mô hình ngôn ngữ. Client nhớ lại kết quả nên mỗi từ
// chỉ tra một lần cho cả đời — xem lib/sentence-aids.mjs.
//
// Từ tra không ra vẫn trả về với chuỗi rỗng, để client nhớ là "đã tra, không có"
// và không hỏi lại mãi một từ vô vọng.

type Entry = { phonetic?: string; phonetics?: { text?: string }[] };

const MAX_WORDS = 40;

async function lookup(word: string) {
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!response.ok) return "";
    const data = (await response.json()) as Entry[];
    if (!Array.isArray(data)) return "";
    const ipa = data.find((entry) => entry.phonetic)?.phonetic || data.flatMap((entry) => entry.phonetics ?? []).find((item) => item.text)?.text;
    return String(ipa ?? "").trim();
  } catch {
    return "";
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
