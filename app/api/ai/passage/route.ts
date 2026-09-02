import { NextResponse } from "next/server";
import { LlmError, activeModel, activeProvider, generateJson, hasLlm } from "../../../../lib/llm";
import { identify, logUsage } from "../../../../lib/ai-guard";
import { gate } from "../../../../lib/ai-gate";
import { containsTargetTerm } from "../../../../lib/translation-check.mjs";

// Sinh một đoạn văn tiếng Việt có mạch truyện từ danh sách từ trong folder, kèm câu
// tiếng Anh tương ứng để đối chiếu. Đây là thứ mà cách ghép câu ví dụ sẵn có không
// làm được: các câu ví dụ vốn rời rạc, ghép lại chỉ ra một danh sách chứ không phải
// đoạn văn. Không có khoá thì trả 503 và client tự lùi về cách ghép câu ví dụ.

type Sentence = { term: string; vi: string; en: string };

// Quy tắc cố định — tách khỏi dữ liệu từng lượt để cache được (xem lib/llm).
const SYSTEM = `Bạn soạn bài luyện dịch Việt–Anh cho người Việt học tiếng Anh trình độ trung cấp.

Quy tắc:
- Dùng đúng các từ trong danh sách được cho, theo đúng thứ tự, mỗi từ đúng một lần, ở dạng tự nhiên trong câu (chia thì, số nhiều tuỳ ý).
- Câu tiếng Việt tự nhiên, có dấu đầy đủ, mỗi câu 8–18 chữ, KHÔNG nhắc tới bản thân từ tiếng Anh, không dùng ngoặc kép quanh từ.
- Trường vi phải là câu THUẦN TIẾNG VIỆT và diễn đạt đúng nghĩa của từ khóa. TUYỆT ĐỐI không chép nguyên từ/cụm từ tiếng Anh trong danh sách vào vi vì sẽ làm lộ đáp án. Ví dụ term "run": đúng "Mỗi sáng tôi chạy quanh công viên để rèn luyện sức khỏe."; sai "Mỗi sáng tôi chạy quanh công viên để run sức khỏe."
- BẮT BUỘC đúng một dấu cách giữa mọi từ tiếng Việt (sai: "cùngbạn"; đúng: "cùng bạn"). Tự đọc lại và sửa hết lỗi dính từ, thiếu khoảng trắng, chính tả trước khi trả JSON.
- Câu tiếng Anh là bản dịch chuẩn của chính câu tiếng Việt đó, đúng ngữ pháp, tự nhiên.

Trả JSON: {"sentences":[{"term":"từ tiếng Anh","vi":"câu tiếng Việt","en":"câu tiếng Anh"}]}`;

export async function POST(request: Request) {
  // mode "passage": một đoạn văn liền mạch. mode "sentences": mỗi từ một câu riêng,
  // độc lập nhau — hợp khi vừa dán một danh sách từ chẳng liên quan gì tới nhau.
  // avoid: câu người học vừa thấy và muốn đổi — nói rõ để mô hình viết câu khác hẳn.
  const { terms, topic, mode, avoid } = (await request.json()) as { terms?: string[]; topic?: string; mode?: "passage" | "sentences"; avoid?: string };
  const words = (terms ?? []).map((item) => String(item).trim()).filter(Boolean).slice(0, 12);
  const wantPassage = mode !== "sentences";
  if (!words.length) return NextResponse.json({ error: "Chưa có từ nào để viết ví dụ." }, { status: 400 });
  if (wantPassage && words.length < 2) return NextResponse.json({ error: "Cần ít nhất 2 từ để dựng đoạn văn." }, { status: 400 });
  if (!hasLlm()) return NextResponse.json({ error: "Chưa cấu hình khoá mô hình AI." }, { status: 503 });

  const caller = await identify(request);
  const g = await gate(caller, "passage");
  if (g.denied) return g.denied;

  const prompt = `${wantPassage
    ? "Viết MỘT đoạn văn tiếng Việt ngắn, mạch truyện liền lạc: cùng bối cảnh, cùng nhân vật, câu sau nối ý câu trước. Không viết thành danh sách câu rời rạc."
    : "Với mỗi từ, viết MỘT câu ví dụ độc lập, đặt từ vào ngữ cảnh đời thường dễ hình dung. Các câu không cần liên quan nhau."}
${topic ? `Chủ đề: ${topic}.\n` : ""}${avoid ? `TRÁNH viết giống câu này, đổi hẳn tình huống: "${avoid}"\n` : ""}
Danh sách từ (theo thứ tự): ${words.join(", ")}`;

  const startedAt = Date.now();
  const usage = (ok: boolean) => logUsage(caller, { feature: "passage", ok, promptChars: prompt.length, latencyMs: Date.now() - startedAt, provider: activeProvider(), model: activeModel() });
  try {
    // Nội dung học tập cần ổn định hơn sáng tạo. Nhiệt độ cao khiến một số lần model
    // sinh tiếng Việt bị dính từ dù JSON vẫn hợp lệ.
    const generate = (instruction: string) => generateJson<{ sentences?: Sentence[] }>(instruction, { system: SYSTEM, temperature: wantPassage ? 0.25 : 0.2, maxTokens: 1400, timeoutMs: 50000 });
    const clean = (data: { sentences?: Sentence[] }) => (data.sentences ?? [])
      .map((item) => ({ term: String(item.term ?? "").trim(), vi: String(item.vi ?? "").normalize("NFC").trim(), en: String(item.en ?? "").trim() }))
      .filter((item) => item.term && item.vi && item.en);

    let sentences = clean(await generate(prompt));
    // Mô hình đôi khi vẫn trộn từ khóa tiếng Anh vào câu Việt dù prompt đã cấm.
    // Tự tạo lại toàn bộ một lần để giữ mạch ở mode passage; nếu lần hai vẫn sai
    // thì loại câu lỗi, không bao giờ đưa đề đã lộ đáp án xuống giao diện.
    if (sentences.some((item) => containsTargetTerm(item.vi, words))) {
      sentences = clean(await generate(`${prompt}\n\nBẢN TRƯỚC CÓ CÂU TIẾNG VIỆT CHỨA NGUYÊN TỪ KHÓA TIẾNG ANH. Hãy viết lại toàn bộ. Trường vi chỉ được dùng tiếng Việt và không được chứa bất kỳ mục nào trong danh sách từ.`));
    }
    sentences = sentences.filter((item) => !containsTargetTerm(item.vi, words));
    if (!sentences.length) {
      await g.release(true);
      await usage(false);
      return NextResponse.json({ error: "Mô hình trả về nội dung không dùng được." }, { status: 502 });
    }
    await usage(true);
    return NextResponse.json({ sentences });
  } catch (error) {
    // Mô hình hỏng là lỗi phía chúng ta, không trừ lượt của người học.
    await g.release(true);
    await usage(false);
    const message = error instanceof LlmError ? error.message : "Không dựng được đoạn văn.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
