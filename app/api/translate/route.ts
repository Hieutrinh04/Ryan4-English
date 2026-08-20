import { NextResponse } from "next/server";
import { identify, spend } from "../../../lib/ai-guard";

// Dịch câu tiếng Anh sang tiếng Việt, theo lô.
//
// Không gọi mô hình ngôn ngữ: đây chỉ là dịch nghĩa để đối chiếu khi nghe, dùng
// từ điển dịch miễn phí là đủ và không tốn lượt AI. Gộp nhiều câu vào một lượt
// gọi vì mỗi câu một lượt thì mở một bài trăm câu là trăm lượt gọi.

const MAX_LINES = 40;

/** Chuẩn hoá NFC như mọi chỗ khác, nếu không dấu tiếng Việt sẽ rời khỏi chữ. */
function clean(text: string) {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

async function viaGoogle(lines: string[]) {
  const joined = lines.join("\n");
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(joined)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(String(response.status));
  const data = (await response.json()) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("dạng trả về lạ");
  const merged = (data[0] as unknown[]).map((part) => (Array.isArray(part) ? String(part[0] ?? "") : "")).join("");
  const out = merged.split("\n").map(clean);
  // Số dòng không khớp thì bỏ cả lô: ghép lệch một dòng là mọi câu sau đó đều
  // gắn sai bản dịch, mà nhìn vào không thấy sai ở đâu.
  if (out.length !== lines.length) throw new Error("số dòng trả về không khớp");
  return out;
}

async function viaMyMemory(lines: string[]) {
  return Promise.all(
    lines.map(async (line) => {
      try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(line)}&langpair=en|vi`;
        const response = await fetch(url);
        if (!response.ok) return "";
        const data = (await response.json()) as { responseData?: { translatedText?: string } };
        return clean(String(data.responseData?.translatedText ?? ""));
      } catch {
        return "";
      }
    }),
  );
}

export async function POST(request: Request) {
  const { texts } = (await request.json()) as { texts?: string[] };
  const lines = (texts ?? []).map((item) => clean(String(item ?? ""))).filter(Boolean).slice(0, MAX_LINES);
  if (!lines.length) return NextResponse.json({ translations: [] });

  const caller = await identify(request);
  const denied = spend(caller);
  if (denied) return denied;

  try {
    return NextResponse.json({ translations: await viaGoogle(lines), source: "google" });
  } catch {
    // Đường chính hỏng thì dịch từng câu một, chậm hơn nhưng còn hơn không có gì.
    const translations = await viaMyMemory(lines);
    if (!translations.some(Boolean)) return NextResponse.json({ error: "Không dịch được lúc này." }, { status: 502 });
    return NextResponse.json({ translations, source: "mymemory" });
  }
}
