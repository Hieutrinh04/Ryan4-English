import { NextResponse } from "next/server";
import { LlmError, activeModel, activeProvider, generateJson, hasLlm } from "../../../../lib/llm";
import { identify, logUsage } from "../../../../lib/ai-guard";
import { gate } from "../../../../lib/ai-gate";
import { fallbackLessonSummary, normalizeLessonSummary } from "../../../../lib/lesson-summary.mjs";
import { rememberLesson } from "../../../../lib/rag";

type InputSentence = { index?: number; start?: number; end?: number; text?: string };

// Quy tắc cố định — tách khỏi transcript từng bài để cache được (xem lib/llm).
const SYSTEM = `Bạn là biên tập viên bài học tiếng Anh cho người Việt. Đọc transcript và tạo bản tổng quan ngắn, chính xác, KHÔNG bịa thông tin ngoài bài.

- summaryVi: tóm tắt tiếng Việt 3–5 câu.
- keyPoints: 3–5 ý chính tiếng Việt.
- vocabulary: 8–12 từ/cụm đáng học, term đúng nguyên văn, meaningVi theo ngữ cảnh, example là câu nguyên văn trong bài.
- phrases: 4–8 câu/cụm diễn đạt hay, text nguyên văn, meaningVi dịch tự nhiên, note cách dùng ngắn gọn.
- Mọi ví dụ phải THẬT SỰ xuất hiện trong transcript.

Trả JSON: {"summaryVi":"...","keyPoints":["..."],"vocabulary":[{"term":"...","meaningVi":"...","example":"..."}],"phrases":[{"text":"...","meaningVi":"...","note":"..."}]}`;

export async function POST(request: Request) {
  const body = (await request.json()) as { title?: string; sentences?: InputSentence[] };
  const title = String(body.title ?? "Bài học").trim().slice(0, 240);
  const sentences = (body.sentences ?? []).slice(0, 600).map((item, position) => ({
    index: Number(item.index) || position + 1,
    start: Number(item.start) || 0,
    end: Number(item.end) || 0,
    text: String(item.text ?? "").replace(/\s+/g, " ").trim().slice(0, 700),
  })).filter((item) => item.text);
  if (!sentences.length) return NextResponse.json({ error: "Bài chưa có transcript." }, { status: 400 });

  const fallback = fallbackLessonSummary(title, sentences);
  if (!hasLlm()) return NextResponse.json({ summary: fallback, generatedBy: "fallback" });

  const caller = await identify(request);
  const g = await gate(caller, "summary");
  if (g.denied) return g.denied;
  // 18000 ký tự ~ 3000 từ, đủ cho bài nói 15–20 phút. Dài hơn nữa thì cắt bớt
  // phần đuôi: tổng quan vẫn bám được mạch chính, mà không phải trả tiền cho cả
  // transcript khổng lồ mỗi lần mở bài.
  const transcript = sentences.map((item) => item.text).join(" ").slice(0, 18000);
  const prompt = `Tên bài: ${title}
Transcript: ${transcript}`;
  const startedAt = Date.now();
  const usage = (ok: boolean) => logUsage(caller, { feature: "summary", ok, promptChars: prompt.length, latencyMs: Date.now() - startedAt, provider: activeProvider(), model: activeModel() });
  try {
    const data = await generateJson<Record<string, unknown>>(prompt, { system: SYSTEM, temperature: 0.15, maxTokens: 2000, timeoutMs: 50000 });
    const [, indexedChunks] = await Promise.all([
      usage(true),
      rememberLesson(caller, { title, transcript }),
    ]);
    return NextResponse.json({ summary: normalizeLessonSummary(data, fallback), generatedBy: "ai", ragIndexed: indexedChunks });
  } catch (error) {
    await g.release(true);
    await usage(false);
    const warning = error instanceof LlmError ? error.message : "Không tạo được tóm tắt AI.";
    return NextResponse.json({ summary: fallback, generatedBy: "fallback", warning });
  }
}
