import { NextResponse } from "next/server";
import { LlmError, activeModel, activeProvider, generateJson, hasLlm } from "../../../../lib/llm";
import { identify, logUsage, refund, spend } from "../../../../lib/ai-guard";

// Một lượt hội thoại theo tình huống: mô hình đóng vai đối phương, đáp lại lời
// người học, và cho biết đã đạt mục tiêu nào.
//
// Khác với chấm bài dịch hay chấm bài viết: ở đây KHÔNG có câu đúng để so, vì
// người học tự nghĩ ra câu. Cái chấm được là "đã làm xong việc mà tình huống đòi
// hỏi chưa", nên mô hình trả về danh sách mục tiêu đã đạt thay vì điểm số.

type Turn = { who?: string; text?: string };
type Reply = { reply?: string; goalsDone?: number[]; correction?: { wrong?: string; right?: string; why?: string } | null; ended?: boolean };

const MAX_TURNS = 30;

export async function POST(request: Request) {
  const { scenario, history, said } = (await request.json()) as {
    scenario?: { title?: string; setting?: string; partner?: string; you?: string; goals?: string[]; level?: string };
    history?: Turn[];
    said?: string;
  };

  const utterance = String(said ?? "").trim();
  const goals = (scenario?.goals ?? []).map((item) => String(item ?? "").trim()).filter(Boolean);
  if (!scenario?.setting || !goals.length) return NextResponse.json({ error: "Thiếu thông tin tình huống." }, { status: 400 });
  if (!utterance) return NextResponse.json({ error: "Chưa nghe được bạn nói gì." }, { status: 400 });
  if (!hasLlm()) return NextResponse.json({ error: "Chưa cấu hình OPENROUTER_API_KEY hoặc GEMINI_API_KEY." }, { status: 503 });

  const caller = await identify(request);
  const denied = spend(caller);
  if (denied) return denied;

  const lines = (history ?? [])
    .slice(-MAX_TURNS)
    .map((turn) => `${turn.who === "you" ? "Học viên" : "Bạn"}: ${String(turn.text ?? "").trim()}`)
    .filter((line) => line.length > 10)
    .join("\n");

  const prompt = `Bạn đang đóng vai trong một bài luyện nói tiếng Anh cho người Việt (trình độ ${scenario.level ?? "A1"}).

Bối cảnh: ${scenario.setting}
Bạn đóng vai: ${scenario.partner}
Học viên đóng vai: ${scenario.you}

Mục tiêu học viên cần làm xong trong hội thoại này:
${goals.map((goal, index) => `${index}. ${goal}`).join("\n")}

${lines ? `Hội thoại đã diễn ra:\n${lines}\n` : ""}
Học viên vừa nói: "${utterance}"

Nguyên tắc:
- reply: đáp lại BẰNG TIẾNG ANH, đúng vai của bạn, 1–2 câu, tự nhiên như người thật nói. Dùng từ vừa với trình độ ${scenario.level ?? "A1"}. Nếu học viên nói chưa rõ thì hỏi lại chứ đừng tự đoán.
- Đẩy hội thoại đi tới: hỏi lại hoặc nói thêm một ý để học viên có cái mà đáp.
- goalsDone: danh sách CHỈ SỐ những mục tiêu học viên ĐÃ làm xong tính tới lúc này, kể cả các lượt trước. Chỉ tính khi họ thật sự đã nói ra, không tính khi mới có ý định.
- Tính mục tiêu theo Ý ĐỊNH nói được ra, KHÔNG theo độ chuẩn ngữ pháp. Câu sai ngữ pháp mà vẫn hiểu được là làm xong mục tiêu — cứ ghi vào goalsDone rồi sửa riêng ở correction.
- correction: chỉ đưa khi câu vừa rồi có lỗi ĐÁNG sửa (sai ngữ pháp rõ, hoặc cách nói không tự nhiên tới mức gây hiểu nhầm). Câu chỉ hơi vụng thì để null — sửa mọi thứ sẽ làm người học ngại nói.
- correction.why viết bằng tiếng Việt có dấu, một câu ngắn.
- ended: true khi mọi mục tiêu đã xong và hội thoại kết thúc tự nhiên.

Trả về JSON thuần theo đúng dạng:
{"reply":"câu đáp bằng tiếng Anh","goalsDone":[0],"correction":{"wrong":"phần sai","right":"cách nói đúng","why":"lý do ngắn bằng tiếng Việt"},"ended":false}`;

  const startedAt = Date.now();
  const usage = (ok: boolean) =>
    logUsage(caller, { feature: "speaking", ok, promptChars: prompt.length, latencyMs: Date.now() - startedAt, provider: activeProvider(), model: activeModel() });

  try {
    const data = await generateJson<Reply>(prompt, { temperature: 0.7, thinking: "low", timeoutMs: 45000 });
    const clean = (value?: string) => String(value ?? "").normalize("NFC").trim();
    const reply = clean(data.reply);
    if (!reply) throw new LlmError("Mô hình không trả lời được.");

    const correction = data.correction && (clean(data.correction.right) || clean(data.correction.why))
      ? { wrong: clean(data.correction.wrong), right: clean(data.correction.right), why: clean(data.correction.why) }
      : null;

    await usage(true);
    return NextResponse.json({
      reply,
      // Chỉ số hợp lệ được lọc lại ở client bằng mergeGoals, nhưng chặn sẵn ở đây
      // để không gửi rác đi.
      goalsDone: (data.goalsDone ?? []).map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < goals.length),
      correction,
      ended: Boolean(data.ended),
    });
  } catch (error) {
    // Mô hình hỏng là lỗi phía chúng ta, không trừ lượt của người học.
    refund(caller);
    await usage(false);
    const message = error instanceof LlmError ? error.message : "Không tiếp tục được hội thoại.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
