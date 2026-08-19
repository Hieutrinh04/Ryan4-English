import { NextResponse } from "next/server";
import { LlmError, generateJson, hasLlm } from "../../../../lib/llm";

// Sinh một đoạn văn tiếng Việt có mạch truyện từ danh sách từ trong folder, kèm câu
// tiếng Anh tương ứng để đối chiếu. Đây là thứ mà cách ghép câu ví dụ sẵn có không
// làm được: các câu ví dụ vốn rời rạc, ghép lại chỉ ra một danh sách chứ không phải
// đoạn văn. Không có khoá thì trả 503 và client tự lùi về cách ghép câu ví dụ.

type Sentence = { term: string; vi: string; en: string };

export async function POST(request: Request) {
  // mode "passage": một đoạn văn liền mạch. mode "sentences": mỗi từ một câu riêng,
  // độc lập nhau — hợp khi vừa dán một danh sách từ chẳng liên quan gì tới nhau.
  // avoid: câu người học vừa thấy và muốn đổi — nói rõ để mô hình viết câu khác hẳn.
  const { terms, topic, mode, avoid } = (await request.json()) as { terms?: string[]; topic?: string; mode?: "passage" | "sentences"; avoid?: string };
  const words = (terms ?? []).map((item) => String(item).trim()).filter(Boolean).slice(0, 12);
  const wantPassage = mode !== "sentences";
  if (!words.length) return NextResponse.json({ error: "Chưa có từ nào để viết ví dụ." }, { status: 400 });
  if (wantPassage && words.length < 2) return NextResponse.json({ error: "Cần ít nhất 2 từ để dựng đoạn văn." }, { status: 400 });
  if (!hasLlm()) return NextResponse.json({ error: "Chưa cấu hình OPENROUTER_API_KEY hoặc GEMINI_API_KEY." }, { status: 503 });

  const shared = `Ràng buộc:
- Mỗi câu dùng đúng MỘT từ trong danh sách dưới đây, theo đúng thứ tự đã cho.
- Mỗi từ xuất hiện đúng một lần, ở dạng tự nhiên trong câu (chia thì, số nhiều tuỳ ý).
- Câu tiếng Việt tự nhiên như người Việt viết, có dấu đầy đủ, KHÔNG nhắc đến bản thân từ tiếng Anh, không dùng dấu ngoặc kép quanh từ.
- Câu tiếng Anh là bản dịch chuẩn của chính câu tiếng Việt đó, đúng ngữ pháp, tự nhiên.
- Mỗi câu 8–18 chữ.
${topic ? `- Bối cảnh nên xoay quanh chủ đề: ${topic}.` : ""}
${avoid ? `- TRÁNH viết giống câu này, hãy đổi hẳn tình huống và cách diễn đạt: "${avoid}"` : ""}

Danh sách từ (theo thứ tự): ${words.join(", ")}

Trả về JSON thuần theo đúng dạng:
{"sentences":[{"term":"từ tiếng Anh","vi":"câu tiếng Việt","en":"câu tiếng Anh"}]}`;

  const prompt = wantPassage
    ? `Bạn soạn bài luyện dịch Việt–Anh cho người Việt học tiếng Anh trình độ trung cấp.

Viết MỘT đoạn văn tiếng Việt ngắn, có mạch truyện liền lạc: cùng một bối cảnh, cùng nhân vật, câu sau nối ý câu trước một cách tự nhiên. Không viết thành danh sách câu rời rạc.

${shared}`
    : `Bạn soạn ví dụ từ vựng cho người Việt học tiếng Anh trình độ trung cấp.

Với mỗi từ, viết MỘT câu ví dụ độc lập, đặt từ đó vào ngữ cảnh đời thường dễ hình dung. Các câu KHÔNG cần liên quan đến nhau — mỗi câu tự đứng một mình.

${shared}`;

  try {
    const data = await generateJson<{ sentences?: Sentence[] }>(prompt, { temperature: wantPassage ? 0.75 : 0.6, timeoutMs: 50000 });
    const sentences = (data.sentences ?? [])
      .map((item) => ({ term: String(item.term ?? "").trim(), vi: String(item.vi ?? "").normalize("NFC").trim(), en: String(item.en ?? "").trim() }))
      .filter((item) => item.term && item.vi && item.en);
    if (!sentences.length) return NextResponse.json({ error: "Mô hình trả về nội dung không dùng được." }, { status: 502 });
    return NextResponse.json({ sentences });
  } catch (error) {
    const message = error instanceof LlmError ? error.message : "Không dựng được đoạn văn.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
