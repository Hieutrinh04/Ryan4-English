import { NextResponse } from "next/server";
import { LlmError, activeModel, activeProvider, generateJson, hasLlm } from "../../../../lib/llm";
import { identify, logUsage, refund, spend } from "../../../../lib/ai-guard";

// Nhận xét cách nói cho bài shadowing.
//
// Phần đo đạc đã làm xong ở lib/shadowing.mjs bằng chữ mà trình duyệt nghe được.
// Route này chỉ làm phần mà đo đạc không làm được: giải thích khẩu hình và cách
// sửa cho từng từ bị chệch. Không có khoá thì client vẫn có nhận xét từ
// shadowingAdvice, chỉ là không có phần hướng dẫn khẩu hình.

type Tip = { word?: string; ipa?: string; how?: string };
type Coaching = { comment?: string; tips?: Tip[] };

export async function POST(request: Request) {
  const { sentence, heard, missed, swallowed } = (await request.json()) as {
    sentence?: string; heard?: string; missed?: string[]; swallowed?: string[];
  };
  const target = (sentence ?? "").trim();
  const focus = [...new Set([...(swallowed ?? []), ...(missed ?? [])])].map((word) => String(word).trim()).filter(Boolean).slice(0, 8);
  if (!target) return NextResponse.json({ error: "Thiếu câu mẫu." }, { status: 400 });
  if (!focus.length) return NextResponse.json({ comment: "", tips: [] });
  if (!hasLlm()) return NextResponse.json({ error: "Chưa cấu hình OPENROUTER_API_KEY hoặc GEMINI_API_KEY." }, { status: 503 });

  const caller = await identify(request);
  const denied = spend(caller);
  if (denied) return denied;

  const prompt = `Bạn là giáo viên luyện phát âm tiếng Anh cho người Việt.

Câu mẫu: "${target}"
Máy nghe được người học nói: "${(heard ?? "").trim() || "(không rõ)"}"
Những từ bị chệch cần sửa: ${focus.join(", ")}

Nguyên tắc:
- Với MỖI từ trong danh sách trên, viết một hướng dẫn khẩu hình cụ thể, làm theo được ngay: lưỡi đặt đâu, môi thế nào, có bật hơi không, đuôi đọc ra sao.
- Nhắm đúng lỗi quen thuộc của người Việt: nuốt phụ âm cuối, không phân biệt /s/ và /ʃ/, /l/ và /n/, nguyên âm dài và ngắn, cụm phụ âm ở cuối từ.
- ipa: phiên âm quốc tế của riêng từ đó.
- how: viết bằng tiếng Việt có dấu, tối đa 2 câu, nói cách làm chứ không mô tả lý thuyết.
- comment: một câu nhận xét chung bằng tiếng Việt, chỉ ra điểm cần sửa trước nhất.
- KHÔNG phán người học phát âm chuẩn hay chưa chuẩn nói chung — bạn không nghe được giọng họ, chỉ thấy chữ máy nghe ra.

Trả về JSON thuần theo đúng dạng:
{"comment":"nhận xét chung bằng tiếng Việt","tips":[{"word":"works","ipa":"/wɜːks/","how":"hướng dẫn khẩu hình bằng tiếng Việt"}]}`;

  const startedAt = Date.now();
  const usage = (ok: boolean) => logUsage(caller, { feature: "pronounce", ok, promptChars: prompt.length, latencyMs: Date.now() - startedAt, provider: activeProvider(), model: activeModel() });
  try {
    const data = await generateJson<Coaching>(prompt, { temperature: 0.3, thinking: "low", timeoutMs: 40000 });
    const clean = (value?: string) => String(value ?? "").normalize("NFC").trim();
    const wanted = new Set(focus.map((word) => word.toLowerCase()));
    await usage(true);
    return NextResponse.json({
      comment: clean(data.comment),
      // Chỉ giữ hướng dẫn cho đúng những từ đã hỏi, tránh mô hình bịa thêm từ khác.
      tips: (data.tips ?? [])
        .map((tip) => ({ word: clean(tip.word), ipa: clean(tip.ipa), how: clean(tip.how) }))
        .filter((tip) => tip.how && wanted.has(tip.word.toLowerCase()))
        .slice(0, 8),
    });
  } catch (error) {
    refund(caller);
    await usage(false);
    const message = error instanceof LlmError ? error.message : "Không lấy được hướng dẫn phát âm.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
