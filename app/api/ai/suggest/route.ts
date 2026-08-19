import { NextResponse } from "next/server";

// Gợi ý từ theo tiền tố đang gõ, dùng endpoint /sug của Datamuse — nó được làm riêng
// cho ô gõ tự động nên thứ tự đã hợp lý sẵn, không cần tự xếp lại.
// Gõ "rescue" ra rescue, rescuer, rescued, rescuers, rescues, rescue party…
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  // Dưới 2 ký tự thì gợi ý vô nghĩa, mà lại gọi mạng mỗi lần gõ.
  if (query.length < 2) return NextResponse.json({ words: [] });
  if (!/^[a-z][a-z' -]{0,40}$/.test(query)) return NextResponse.json({ words: [] });
  try {
    const response = await fetch(`https://api.datamuse.com/sug?s=${encodeURIComponent(query)}&max=10`);
    if (!response.ok) return NextResponse.json({ words: [] });
    const data = (await response.json()) as { word?: string }[];
    const words = data
      .map((item) => (item.word ?? "").trim().toLowerCase())
      // Bỏ ký tự lạ và số; giữ cụm nhiều chữ vì "rescue party" cũng đáng học.
      .filter((word) => /^[a-z][a-z' -]*$/.test(word))
      .filter((word, index, list) => list.indexOf(word) === index)
      .slice(0, 8);
    return NextResponse.json({ words });
  } catch {
    // Gợi ý là tiện ích phụ — hỏng thì im lặng, không được chặn việc gõ từ.
    return NextResponse.json({ words: [] });
  }
}
