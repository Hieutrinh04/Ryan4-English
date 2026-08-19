import { NextResponse } from "next/server";

// Tra nhanh một từ để hiện khi rê chuột: IPA, loại từ, nghĩa tiếng Việt và vài nghĩa
// chính. Nhẹ hơn hẳn /api/ai/enrich — chỉ hai lượt mạng, vì nó chạy mỗi lần rê chuột
// chứ không phải mỗi lần thêm từ.

type DictionaryEntry = {
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings?: { partOfSpeech?: string; definitions?: { definition?: string }[]; synonyms?: string[] }[];
};

async function translateWord(word: string) {
  try {
    const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(word)}`);
    if (!response.ok) return "";
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[0])) return "";
    const joined = (data[0] as unknown[]).map((part) => (Array.isArray(part) ? String(part[0] ?? "") : "")).join("");
    // Chuẩn hoá NFC như mọi chỗ khác, tránh dấu tiếng Việt bị rời ra.
    const value = joined.normalize("NFC").trim();
    return value.toLowerCase() === word.toLowerCase() ? "" : value;
  } catch {
    return "";
  }
}

export async function GET(request: Request) {
  const word = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  if (!word || !/^[a-z][a-z'-]{0,30}$/.test(word)) return NextResponse.json({ error: "Từ không hợp lệ." }, { status: 400 });

  const [entries, meaningVi] = await Promise.all([
    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
      .then((response) => (response.ok ? (response.json() as Promise<DictionaryEntry[]>) : []))
      .catch(() => [] as DictionaryEntry[]),
    translateWord(word),
  ]);

  const list = Array.isArray(entries) ? entries : [];
  const ipa = list.find((entry) => entry.phonetic)?.phonetic || list.flatMap((entry) => entry.phonetics ?? []).find((item) => item.text)?.text || "";
  // Gom theo loại từ, mỗi loại lấy nghĩa đầu tiên — vừa đủ để hiểu, không tràn màn hình.
  const senses: { part: string; definition: string; synonyms: string[] }[] = [];
  for (const entry of list)
    for (const meaning of entry.meanings ?? []) {
      const part = meaning.partOfSpeech ?? "";
      if (!part || senses.some((item) => item.part === part)) continue;
      const definition = meaning.definitions?.[0]?.definition ?? "";
      if (!definition) continue;
      senses.push({ part, definition, synonyms: (meaning.synonyms ?? []).slice(0, 5) });
      if (senses.length >= 4) break;
    }

  if (!meaningVi && !senses.length) return NextResponse.json({ error: "Không tra được từ này." }, { status: 404 });
  return NextResponse.json({ term: word, ipa, meaningVi, senses });
}
