import { NextResponse } from "next/server";
import { LlmError, activeModel, activeProvider, generateJson, hasLlm } from "../../../../lib/llm";
import { identify, logUsage } from "../../../../lib/ai-guard";
import { gate } from "../../../../lib/ai-gate";
import { CRITERIA, bandFrom, countWords, toHalfBand } from "../../../../lib/writing.mjs";

// Chấm một bài viết theo bốn tiêu chí rồi quy ra band.
//
// Nói rõ giới hạn ngay từ đây: đây là điểm ƯỚC LƯỢNG do mô hình ngôn ngữ chấm.
// Nó có ích để biết mình đang quanh mức nào và yếu tiêu chí gì, nhưng KHÔNG phải
// điểm thi thật và không thay được giám khảo.

type Fix = { wrong?: string; right?: string; why?: string };
type Graded = {
  scores?: Record<string, number>;
  comment?: string;
  strengths?: string[];
  improvements?: string[];
  fixes?: Fix[];
};

const MIN_WORDS = 30;
const MAX_WORDS = 1200;

// Quy tắc cố định — tách khỏi bài viết từng lượt để cache được (xem lib/llm).
const SYSTEM = `Bạn là giáo viên chấm bài viết tiếng Anh cho người Việt luyện thi.

Chấm 4 tiêu chí, mỗi tiêu chí 0–9, cho phép nửa điểm:
- task: có làm đúng việc đề yêu cầu, đủ ý, không lạc đề. Thiếu số từ thì phải trừ.
- coherence: bố cục đoạn, thứ tự ý, cách nối ý.
- lexical: vốn từ đa dạng, dùng đúng chỗ, ít lặp từ.
- grammar: cấu trúc câu đa dạng, mức mắc lỗi.

Nguyên tắc:
- Chấm đúng thực tế, không nới tay động viên.
- comment: 2–3 câu tiếng Việt, nói thẳng điều cần sửa trước nhất.
- strengths, improvements: mỗi mục một câu tiếng Việt ngắn, tối đa 3 mục.
- fixes: tối đa 6 lỗi, trích đúng đoạn sai + cách sửa + lý do ngắn tiếng Việt.
- Mọi phần tiếng Việt viết có dấu đầy đủ.

Trả JSON: {"scores":{"task":6,"coherence":6.5,"lexical":6,"grammar":5.5},"comment":"nhận xét tiếng Việt","strengths":["điểm mạnh"],"improvements":["điểm cần sửa"],"fixes":[{"wrong":"đoạn sai","right":"cách viết đúng","why":"lý do ngắn tiếng Việt"}]}`;

export async function POST(request: Request) {
  const { prompt: taskPrompt, answer, part, exam } = (await request.json()) as {
    prompt?: string;
    answer?: string;
    part?: number;
    exam?: string;
  };
  const essay = String(answer ?? "").trim();
  const task = String(taskPrompt ?? "").trim();
  const words = countWords(essay) as number;

  if (!task || !essay) return NextResponse.json({ error: "Thiếu đề bài hoặc bài viết." }, { status: 400 });
  if (words < MIN_WORDS) return NextResponse.json({ error: `Bài mới có ${words} từ. Viết ít nhất ${MIN_WORDS} từ rồi hãy chấm.` }, { status: 400 });
  if (words > MAX_WORDS) return NextResponse.json({ error: `Bài dài ${words} từ, vượt mức chấm được (${MAX_WORDS}).` }, { status: 400 });
  if (!hasLlm()) return NextResponse.json({ error: "Chưa cấu hình khoá mô hình AI." }, { status: 503 });

  const caller = await identify(request);
  const g = await gate(caller, "writing");
  if (g.denied) return g.denied;

  const isTask2 = Number(part) === 2;
  const expected = isTask2 ? 250 : 150;

  const llmPrompt = `Kỳ thi: ${String(exam ?? "IELTS").toUpperCase()}
Đề bài: "${task}"
Bài viết của học viên (${words} từ, đề yêu cầu tối thiểu ${expected} từ):
"""
${essay}
"""`;

  const startedAt = Date.now();
  const usage = (ok: boolean) =>
    logUsage(caller, { feature: "writing", ok, promptChars: llmPrompt.length, latencyMs: Date.now() - startedAt, provider: activeProvider(), model: activeModel() });

  try {
    const data = await generateJson<Graded>(llmPrompt, { system: SYSTEM, temperature: 0.2, maxTokens: 1600, timeoutMs: 60000 });
    const clean = (value?: string) => String(value ?? "").normalize("NFC").trim();

    // Chỉ nhận đúng bốn tiêu chí đã định, mỗi cái kẹp trong 0–9 và làm tròn nửa
    // điểm — mô hình hay trả về 6.3 hoặc một tiêu chí tự đặt tên.
    const scores = Object.fromEntries(
      (CRITERIA as { key: string }[]).map((item) => [item.key, toHalfBand(data.scores?.[item.key]) as number]),
    );
    const list = (values?: string[]) => (values ?? []).map(clean).filter(Boolean).slice(0, 3);

    await usage(true);
    return NextResponse.json({
      scores,
      band: bandFrom(scores),
      words,
      comment: clean(data.comment),
      strengths: list(data.strengths),
      improvements: list(data.improvements),
      fixes: (data.fixes ?? [])
        .map((fix) => ({ wrong: clean(fix.wrong), right: clean(fix.right), why: clean(fix.why) }))
        .filter((fix) => fix.why || fix.right)
        .slice(0, 6),
    });
  } catch (error) {
    // Mô hình hỏng là lỗi phía chúng ta, không trừ lượt của người học.
    await g.release(true);
    await usage(false);
    const message = error instanceof LlmError ? error.message : "Không chấm được bài viết.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
