import { NextResponse } from "next/server";
import { identify, logUsage } from "../../../lib/ai-guard";
import { gate } from "../../../lib/ai-gate";
import { alignTranscript, videoIdFrom } from "../../../lib/youtube.mjs";

// Đọc lời thoại của một video YouTube KHÔNG CÓ PHỤ ĐỀ.
//
// Nhiều video hay lại chẳng có bản phụ đề nào — kể cả bản máy tự nghe. Chữ hiện
// trên hình thì có, nhưng đó là chữ in chết vào khung hình, máy không đọc được.
// Trước đây gặp video như vậy là bó tay, phải tự gõ tay cả bài.
//
// Gemini nhận thẳng địa chỉ YouTube làm đầu vào: Google tự lấy video, phía mình
// KHÔNG tải video về và KHÔNG lưu lại gì — đúng như phần còn lại của app.
//
// CHỈ LẤY CHỮ, KHÔNG LẤY MỐC GIỜ. Đã thử xin mốc và mốc trả về sai hẳn: một
// video dài 121 giây cho mốc cuối 61,7 giây, còn đoạn đầu gói 28 chữ trong 2,8
// giây — hơn mười chữ mỗi giây, không ai nói được như vậy. Mốc để app tự ước
// lượng bằng alignTranscript và nói rõ với người học rằng đó là ước lượng.

const MODEL_DEFAULT = "gemini-2.5-flash-lite";

// Video càng dài Gemini càng lâu và càng dễ bỏ sót đoạn cuối. Trần này khớp với
// trần của thư viện nên không có video nào lọt vào đây mà thư viện lại từ chối.
const MAX_SECONDS = 13 * 60;

const PROMPT = [
  "Transcribe the spoken English in this video.",
  "Output ONLY the transcript as plain sentences with normal punctuation.",
  "No timestamps, no speaker labels, no headings, no commentary.",
  "If a stretch has no speech, skip it silently.",
].join(" ");

export async function POST(request: Request) {
  const { url, seconds } = (await request.json()) as { url?: string; seconds?: number };
  const videoId = videoIdFrom(url) as string;
  if (!videoId) return NextResponse.json({ error: "Đường dẫn YouTube không hợp lệ." }, { status: 400 });

  const length = Number(seconds) || 0;
  if (length > MAX_SECONDS) {
    return NextResponse.json(
      { error: `Video dài hơn ${MAX_SECONDS / 60} phút. Cắt ngắn hoặc chọn video khác.` },
      { status: 400 },
    );
  }

  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return NextResponse.json({ error: "Chưa cấu hình GEMINI_API_KEY." }, { status: 503 });

  const caller = await identify(request);
  const g = await gate(caller, "transcribe");
  if (g.denied) return g.denied;

  const model = process.env.GEMINI_MODEL?.trim() || MODEL_DEFAULT;
  const started = Date.now();
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
                { text: PROMPT },
                { fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` } },
              ],
            },
          ],
        }),
      },
    );
    const data = (await response.json()) as {
      error?: { message?: string };
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    if (!response.ok || data.error) throw new Error(data.error?.message ?? "Gemini không đọc được video này.");

    const transcript = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    // Trả về vài chữ lẻ thì coi như hỏng: để lọt xuống sẽ thành một bài một câu,
    // và người học tưởng video chỉ có bấy nhiêu lời.
    if (transcript.split(" ").filter(Boolean).length < 20) {
      throw new Error("Không nghe ra lời thoại nào trong video này.");
    }

    void logUsage(caller, {
      feature: "transcribe",
      ok: true,
      promptChars: PROMPT.length,
      latencyMs: Date.now() - started,
      provider: "gemini",
      model,
    });
    // Trả luôn câu đã cắt: tiện ích trình duyệt không mang theo alignTranscript,
    // và cắt ở hai nơi thì sớm muộn hai bên ra kết quả khác nhau.
    const sentences = alignTranscript(transcript, length || 0) as unknown[];
    return NextResponse.json({ videoId, transcript, sentences, estimated: true });
  } catch (problem) {
    // Hỏng vì phía chúng ta hoặc phía Gemini thì trả lại lượt và điểm — người học
    // không bấm sai gì cả.
    await g.release(true);
    void logUsage(caller, {
      feature: "transcribe",
      ok: false,
      promptChars: PROMPT.length,
      latencyMs: Date.now() - started,
      provider: "gemini",
      model,
    });
    return NextResponse.json(
      { error: problem instanceof Error ? problem.message : "Không đọc được lời thoại." },
      { status: 502 },
    );
  }
}
