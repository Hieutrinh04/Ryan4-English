import { NextResponse } from "next/server";
import { identify, logUsage } from "../../../../lib/ai-guard";
import { gate } from "../../../../lib/ai-gate";

// Phân tích NGỮ ĐIỆU của một câu do CHÍNH người trong video nói.
//
// Trình phát YouTube là iframe khác nguồn nên không lấy được tiếng ra Web Audio.
// Nhưng Gemini nhận thẳng địa chỉ YouTube kèm mốc giờ: Google tự lấy đoạn video,
// phía mình KHÔNG tải và KHÔNG lưu gì — đúng như /api/transcribe.
//
// Trả về HÌNH MẪU ngữ điệu (không phải điểm): từ nào người nói nhấn, ngắt hơi ở
// đâu, cuối câu lên hay xuống giọng, biên độ cao độ rộng hay hẹp, nói nhanh hay
// chậm. Client đối chiếu bản ghi của người học với hình mẫu này (xem lib/prosody).
//
// Kết quả cùng một câu thì không đổi, nên client nhớ lại theo (videoId, số câu)
// và chỉ gọi một lần.

const MODEL_DEFAULT = "gemini-2.5-flash";

type Ref = {
  stressedWords?: string[];
  pauseAfter?: string[];
  finalPitch?: string;
  pitchRange?: string;
  pace?: string;
  summary?: string;
};

const PITCH = new Set(["fall", "rise", "flat"]);
const RANGE = new Set(["narrow", "medium", "wide"]);
const PACE = new Set(["slow", "medium", "fast"]);

function clampSeconds(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
}

export async function POST(request: Request) {
  const { videoId, start, end, sentence } = (await request.json()) as {
    videoId?: string;
    start?: number;
    end?: number;
    sentence?: string;
  };
  const id = String(videoId ?? "").trim();
  const line = String(sentence ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(id) || !line) {
    return NextResponse.json({ error: "Thiếu video hoặc câu mẫu." }, { status: 400 });
  }

  const key = process.env.GEMINI_API_KEY?.trim();
  // Không có khoá Gemini thì client tự chấm ngữ điệu bằng ước lượng từ văn bản.
  if (!key) return NextResponse.json({ error: "Chưa cấu hình GEMINI_API_KEY." }, { status: 503 });

  const from = clampSeconds(start, 0);
  // Nới hai đầu một chút cho Gemini bắt trọn câu, kể cả khi mốc lệch nhẹ.
  const startOffset = Math.max(0, from - 1);
  const endOffset = Math.max(startOffset + 2, clampSeconds(end, from + 6) + 1);

  const caller = await identify(request);
  const g = await gate(caller, "prosody");
  if (g.denied) return g.denied;

  const model = process.env.GEMINI_MODEL?.trim() || MODEL_DEFAULT;
  const prompt = [
    "You are a phonetics teacher analysing English intonation.",
    `Listen to how the speaker in this video says the sentence: "${line}"`,
    "Focus ONLY on that sentence, roughly between the given start and end offsets.",
    "Describe the speaker's delivery, not the meaning. Return ONLY JSON:",
    '{"stressedWords":["..."],"pauseAfter":["..."],"finalPitch":"fall|rise|flat","pitchRange":"narrow|medium|wide","pace":"slow|medium|fast","summary":"one short Vietnamese sentence about the melody"}',
    "- stressedWords: the words the speaker emphasises most (usually 1 per thought group). Use the exact words from the sentence.",
    "- pauseAfter: words after which the speaker clearly pauses or takes a breath. [] if none.",
    "- finalPitch: pitch direction on the last stressed syllable.",
    "- summary: tiếng Việt có dấu, tối đa 1 câu.",
  ].join("\n");

  const startedAt = Date.now();
  const usage = (ok: boolean) =>
    logUsage(caller, {
      feature: "prosody",
      ok,
      promptChars: prompt.length,
      latencyMs: Date.now() - startedAt,
      provider: "gemini",
      model,
    });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  fileData: { fileUri: `https://www.youtube.com/watch?v=${id}` },
                  videoMetadata: { startOffset: `${startOffset}s`, endOffset: `${endOffset}s` },
                },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 700 },
        }),
      },
    );
    const data = (await response.json()) as {
      error?: { message?: string };
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    if (!response.ok || data.error) throw new Error(data.error?.message ?? "Gemini không nghe được đoạn này.");

    const text = (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("").trim();
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "")) as Ref;

    const words = new Set(line.toLowerCase().replace(/[^a-z\s'-]/g, "").split(/\s+/).filter(Boolean));
    const keepWords = (list: unknown) =>
      (Array.isArray(list) ? list : [])
        .map((item) => String(item ?? "").toLowerCase().replace(/[^a-z'-]/g, ""))
        .filter((item) => words.has(item))
        .slice(0, 8);

    const clean = {
      stressedWords: keepWords(parsed.stressedWords),
      pauseAfter: keepWords(parsed.pauseAfter),
      finalPitch: PITCH.has(String(parsed.finalPitch)) ? String(parsed.finalPitch) : "fall",
      pitchRange: RANGE.has(String(parsed.pitchRange)) ? String(parsed.pitchRange) : "medium",
      pace: PACE.has(String(parsed.pace)) ? String(parsed.pace) : "medium",
      summary: String(parsed.summary ?? "").normalize("NFC").trim().slice(0, 160),
    };
    if (!clean.stressedWords.length) throw new Error("Không phân tích được ngữ điệu đoạn này.");

    await usage(true);
    return NextResponse.json({ videoId: id, sentence: line, ...clean });
  } catch (problem) {
    await g.release(true);
    await usage(false);
    return NextResponse.json(
      { error: problem instanceof Error ? problem.message : "Không phân tích được ngữ điệu." },
      { status: 502 },
    );
  }
}
