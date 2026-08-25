import { NextResponse } from "next/server";
import { LlmError, activeModel, activeProvider, generateJson, hasLlm } from "../../../../lib/llm";
import { identify, logUsage, refund, spend } from "../../../../lib/ai-guard";
import { normaliseErrorType, taxonomyPrompt } from "../../../../lib/error-taxonomy.mjs";

// Chấm bài dịch Việt → Anh bằng Gemini. Khác hẳn cách so câu mẫu ở
// lib/translation-check.mjs: ở đây một cách dịch đúng nhưng khác câu mẫu vẫn được
// công nhận là đúng. Không có khoá thì trả lỗi rõ ràng; client tuyệt đối không
// được biến độ giống câu mẫu thành điểm đúng/sai.

type Issue = { wrong?: string; right?: string; why?: string; type?: string };
type Grade = { correct?: boolean; score?: number; suggestion?: string; issues?: Issue[]; comment?: string; criteria?: Record<string, number> };

export async function POST(request: Request) {
  const { vietnamese, answer, term, reference } = (await request.json()) as { vietnamese?: string; answer?: string; term?: string; reference?: string };
  const source = (vietnamese ?? "").trim();
  const written = (answer ?? "").trim();
  if (!source || !written) return NextResponse.json({ error: "Thiếu câu tiếng Việt hoặc câu người học viết." }, { status: 400 });
  if (!hasLlm()) return NextResponse.json({ error: "Chưa cấu hình OPENROUTER_API_KEY hoặc GEMINI_API_KEY." }, { status: 503 });

  const caller = await identify(request);
  const denied = spend(caller);
  if (denied) return denied;

  const prompt = `Bạn là giáo viên tiếng Anh, chấm bài dịch Việt–Anh cho người Việt.

Câu tiếng Việt cần dịch: "${source}"
${term ? `Từ đang luyện: ${term}` : ""}
${reference ? `Một bản dịch tham khảo: "${reference}"` : ""}
Câu người học viết: "${written}"

Nguyên tắc chấm:
- Nếu câu người học đúng ngữ pháp và truyền đạt đúng nghĩa thì PHẢI công nhận là đúng, kể cả khi diễn đạt khác hẳn bản tham khảo. Bản tham khảo chỉ là một cách dịch, không phải đáp án duy nhất.
- Chấp nhận cách nói tương đương theo ngữ cảnh, ví dụ "I get up at 6 am" là bản dịch đúng của "Tôi thức dậy lúc sáu giờ sáng", dù bản tham khảo dùng "wake up", "six" và "in the morning".
- Không trừ điểm vì viết số thay cho chữ (6/six), dùng dạng rút gọn, bỏ cụm thời gian đã được biểu đạt rõ, hoặc chọn từ/cấu trúc đồng nghĩa tự nhiên.
- Chỉ liệt kê lỗi thật: sai ngữ pháp, sai nghĩa, dùng từ không tự nhiên. Không bắt bẻ chuyện chọn từ đồng nghĩa khác.
- Giải thích ngắn gọn bằng tiếng Việt, đúng trọng tâm, để người học sửa được lần sau.
- Chấm độc lập 4 tiêu chí từ 0–100: meaning (đủ và đúng ý), grammar (ngữ pháp), vocabulary (dùng từ), naturalness (tự nhiên). Không cho điểm cao chỉ vì có nhiều từ giống câu mẫu.
- score: 0–100, là điểm tổng hợp; ý nghĩa và ngữ pháp có trọng số cao nhất.
- comment phải nêu rõ một điểm làm tốt và ưu tiên sửa quan trọng nhất. issues phải chỉ đúng cụm sai, cách sửa và lý do; tối đa 6 lỗi có giá trị học tập, không lặp lỗi.
- Toàn bộ phần tiếng Việt phải viết bằng tiếng Việt có dấu, không lẫn ký tự tiếng nước khác.
- Mỗi lỗi phải gắn một nhãn "type" lấy ĐÚNG từ danh sách sau, không tự đặt tên khác:
  ${taxonomyPrompt()}

Trả về JSON thuần theo đúng dạng:
{"correct":true,"score":95,"criteria":{"meaning":98,"grammar":92,"vocabulary":95,"naturalness":94},"suggestion":"bản dịch chuẩn của câu trên","issues":[{"type":"article","wrong":"phần sai trong câu người học","right":"phần đúng","why":"giải thích ngắn bằng tiếng Việt"}],"comment":"nhận xét có điểm tốt và ưu tiên cải thiện bằng tiếng Việt"}`;

  const startedAt = Date.now();
  try {
    const data = await generateJson<Grade>(prompt, { temperature: 0.2, thinking: "low", timeoutMs: 45000 });
    await logUsage(caller, { feature: "grade", ok: true, promptChars: prompt.length, latencyMs: Date.now() - startedAt, provider: activeProvider(), model: activeModel() });
    const clean = (value?: string) => String(value ?? "").normalize("NFC").trim();
    return NextResponse.json({
      correct: Boolean(data.correct),
      score: Math.max(0, Math.min(100, Math.round(Number(data.score) || 0))),
      suggestion: clean(data.suggestion),
      comment: clean(data.comment),
      criteria: Object.fromEntries(["meaning", "grammar", "vocabulary", "naturalness"].map((key) => [key, Math.max(0, Math.min(100, Math.round(Number(data.criteria?.[key]) || 0)))])),
      // Nhãn lỗi được quy về bộ cố định để sau này đếm và nhóm được theo kỹ năng.
      issues: (data.issues ?? [])
        .map((item) => ({ type: normaliseErrorType(item.type), wrong: clean(item.wrong), right: clean(item.right), why: clean(item.why) }))
        .filter((item) => item.why || item.right)
        .slice(0, 6),
    });
  } catch (error) {
    // Mô hình hỏng là lỗi phía chúng ta, không trừ lượt của người học.
    refund(caller);
    await logUsage(caller, { feature: "grade", ok: false, promptChars: prompt.length, latencyMs: Date.now() - startedAt, provider: activeProvider(), model: activeModel() });
    const message = error instanceof LlmError ? error.message : "Không chấm được bài.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
