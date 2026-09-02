import { NextResponse } from "next/server";
import { estimateCefr, frequencyFromTags } from "../../../../lib/word-level.mjs";

// Xếp bậc CEFR ước lượng cho một loạt từ trong kho từ vựng.
//
// KHÔNG gọi mô hình ngôn ngữ. Phần lớn từ lõi có sẵn trong Oxford 5000 nên tra
// tại chỗ, không tốn lượt mạng nào; chỉ từ ngoài danh sách mới hỏi tần suất của
// Datamuse. Vì vậy route này rẻ và có thể chạy cho cả thư mục.

const MAX_TERMS = 200;
const DATAMUSE_CONCURRENCY = 6;

// Bậc CEFR là khái niệm cho TỪ ĐƠN. Cụm nhiều từ ("take for granted") thì bỏ
// qua — trả null — thay vì gán bừa bậc của một từ trong cụm.
function singleWord(term: string) {
  const cleaned = String(term ?? "")
    .toLowerCase()
    .split("/")[0]
    .trim()
    .replace(/[^a-z '-]/g, "")
    .trim();
  return cleaned.includes(" ") ? "" : cleaned;
}

async function frequencyOf(word: string): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(
      `https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=f&max=1`,
      { headers: { Accept: "application/json" }, signal: controller.signal },
    );
    if (!response.ok) return NaN;
    const data = (await response.json()) as { word?: string; tags?: string[] }[];
    const hit = data.find((item) => item.word?.toLowerCase() === word);
    return frequencyFromTags(hit?.tags ?? []);
  } catch {
    return NaN;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { terms?: unknown };
  const terms = Array.isArray(body.terms)
    ? [...new Set(body.terms.map((item) => String(item ?? "").trim()).filter(Boolean))].slice(0, MAX_TERMS)
    : [];
  if (!terms.length) return NextResponse.json({ error: "Chưa có từ nào để xếp cấp độ." }, { status: 400 });

  const levels: Record<string, string | null> = {};
  // Vòng 1: tra Oxford 5000 tại chỗ. Gom các từ chưa xác định được để hỏi tần suất.
  const needFrequency: { term: string; word: string }[] = [];
  for (const term of terms) {
    const word = singleWord(term);
    if (!word) { levels[term] = null; continue; }
    const local = estimateCefr(word);
    if (local) levels[term] = local.level;
    else needFrequency.push({ term, word });
  }

  // Vòng 2: hỏi tần suất Datamuse cho phần còn lại, theo lô nhỏ.
  for (let start = 0; start < needFrequency.length; start += DATAMUSE_CONCURRENCY) {
    const batch = needFrequency.slice(start, start + DATAMUSE_CONCURRENCY);
    const freqs = await Promise.all(batch.map((item) => frequencyOf(item.word)));
    batch.forEach((item, index) => {
      levels[item.term] = estimateCefr(item.word, freqs[index])?.level ?? null;
    });
  }

  return NextResponse.json({ levels });
}
