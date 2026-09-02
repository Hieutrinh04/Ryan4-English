import { NextResponse } from "next/server";
import { LlmError, activeModel, activeProvider, generateJson, hasLlm } from "../../../../lib/llm";
import { identify, logUsage } from "../../../../lib/ai-guard";
import { gate } from "../../../../lib/ai-gate";

// Nhận xét cách nói cho bài shadowing.
//
// Phần đo đạc đã làm xong ở lib/shadowing.mjs bằng chữ mà trình duyệt nghe được.
// Route này làm phần đo đạc không làm được:
//   • khẩu hình từng từ bị chệch (dựa trên chữ máy nghe ra)
//   • CHỖ NỐI ÂM trong câu và cách nối — thứ quyết định câu nghe có "Tây" không,
//     và là chỗ người Việt hay đọc rời từng từ nhất
// Không có khoá thì client vẫn có nhận xét từ shadowingAdvice.

type Tip = { word?: string; ipa?: string; how?: string };
type Link = { pair?: string; blend?: string; rule?: string; how?: string };
type Coaching = { comment?: string; tips?: Tip[]; links?: Link[] };

// Quy tắc cố định — tách khỏi câu từng lượt để cache được (xem lib/llm).
const SYSTEM = `Bạn là giáo viên luyện phát âm tiếng Anh cho người Việt.

tips (khẩu hình): với MỖI từ cần sửa, một hướng dẫn làm theo được ngay — lưỡi đặt đâu, môi thế nào, bật hơi không, đuôi đọc ra sao. Nhắm lỗi quen của người Việt: nuốt phụ âm cuối, lẫn /s/–/ʃ/, /l/–/n/, nguyên âm dài–ngắn, cụm phụ âm cuối từ. ipa: phiên âm riêng từ đó. how: tiếng Việt có dấu, tối đa 2 câu. Không có từ nào cần sửa thì tips = [].

links (nối âm): xét CẢ CÂU, tìm chỗ người bản ngữ nối liền hai từ (tối đa 6, ưu tiên chỗ người Việt hay đọc rời).
- pair: đúng hai từ LIỀN NHAU trong câu ("want to", "this is").
- rule: tên kiểu nối ngắn gọn ("phụ âm → nguyên âm", "nguyên âm → nguyên âm (chèn /j/)", "hai phụ âm giống nhau", "/t/+/j/ → /tʃ/", "nuốt /t/ /d/ giữa hai phụ âm", "nối /r/"…).
- blend: cách đọc dính liền, phiên âm hoặc mô phỏng ("/wɒn.tə/", "wanna").
- how: tiếng Việt có dấu, 1–2 câu, chỉ đúng thao tác.
Câu quá ngắn hoặc không có chỗ nối đáng nói thì links = [].

comment: một câu tiếng Việt, chỉ ra điểm cần sửa trước nhất. KHÔNG phán người học phát âm chuẩn hay chưa — bạn không nghe được giọng họ.

Trả JSON: {"comment":"...","tips":[{"word":"works","ipa":"/wɜːks/","how":"..."}],"links":[{"pair":"want to","rule":"nuốt /t/ giữa hai phụ âm","blend":"/wɒnə/","how":"..."}]}`;

export async function POST(request: Request) {
  const { sentence, heard, missed, swallowed } = (await request.json()) as {
    sentence?: string; heard?: string; missed?: string[]; swallowed?: string[];
  };
  const target = (sentence ?? "").trim();
  const focus = [...new Set([...(swallowed ?? []), ...(missed ?? [])])].map((word) => String(word).trim()).filter(Boolean).slice(0, 8);
  if (!target) return NextResponse.json({ error: "Thiếu câu mẫu." }, { status: 400 });
  if (!hasLlm()) return NextResponse.json({ error: "Chưa cấu hình khoá mô hình AI." }, { status: 503 });

  const caller = await identify(request);
  const g = await gate(caller, "pronounce");
  if (g.denied) return g.denied;

  const focusLine = focus.length
    ? `Những từ bị chệch cần sửa: ${focus.join(", ")}`
    : "Máy đã nhận đủ các từ — tips = [].";

  const prompt = `Câu mẫu: "${target}"
Máy nghe được người học nói: "${(heard ?? "").trim() || "(không rõ)"}"
${focusLine}`;

  const startedAt = Date.now();
  const usage = (ok: boolean) => logUsage(caller, { feature: "pronounce", ok, promptChars: prompt.length, latencyMs: Date.now() - startedAt, provider: activeProvider(), model: activeModel() });
  try {
    const data = await generateJson<Coaching>(prompt, { system: SYSTEM, temperature: 0.3, maxTokens: 1200, timeoutMs: 40000 });
    const clean = (value?: string) => String(value ?? "").normalize("NFC").trim();
    const wanted = new Set(focus.map((word) => word.toLowerCase()));
    // Cặp từ phải THẬT SỰ nằm liền nhau trong câu, mô hình hay ghép hai từ ở xa.
    const adjacent = new Set<string>();
    const words = target.toLowerCase().replace(/[^a-z\s'-]/g, "").split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length - 1; i += 1) adjacent.add(`${words[i]} ${words[i + 1]}`);

    await usage(true);
    return NextResponse.json({
      comment: clean(data.comment),
      // Chỉ giữ hướng dẫn cho đúng những từ đã hỏi, tránh mô hình bịa thêm từ khác.
      tips: (data.tips ?? [])
        .map((tip) => ({ word: clean(tip.word), ipa: clean(tip.ipa), how: clean(tip.how) }))
        .filter((tip) => tip.how && wanted.has(tip.word.toLowerCase()))
        .slice(0, 8),
      links: (data.links ?? [])
        .map((link) => ({ pair: clean(link.pair), rule: clean(link.rule), blend: clean(link.blend), how: clean(link.how) }))
        .filter((link) => link.how && link.pair && adjacent.has(link.pair.toLowerCase()))
        .slice(0, 6),
    });
  } catch (error) {
    await g.release(true);
    await usage(false);
    const message = error instanceof LlmError ? error.message : "Không lấy được hướng dẫn phát âm.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
