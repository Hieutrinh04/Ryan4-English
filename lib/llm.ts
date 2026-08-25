// Gọi mô hình ngôn ngữ và bắt buộc trả về JSON.
//
// Hỗ trợ hai nhà cung cấp, chọn theo khoá có trong .env.local:
//   OPENROUTER_API_KEY  → OpenRouter (được ưu tiên nếu có cả hai)
//   GEMINI_API_KEY      → Google Gemini
// Cả hai đều là biến phía server, KHÔNG có tiền tố NEXT_PUBLIC_ nên khoá không lộ
// ra trình duyệt. Mọi tính năng dùng hàm này đều phải có đường lui khi thiếu khoá
// hoặc gọi hỏng — app vẫn phải học được mà không cần mô hình ngôn ngữ.

// Tài khoản Gemini mới dùng dòng 3.6. Luôn đặt thinkingLevel thấp cho các tác vụ
// JSON ngắn; nếu để mặc định, model có thể dành gần hết token cho suy luận nội bộ
// và không kịp trả nội dung cho giao diện.
const GEMINI_MODEL_DEFAULT = "gemini-3.6-flash";
const OPENROUTER_MODEL_DEFAULT = "google/gemini-2.5-flash";

export class LlmError extends Error {}

type Options = { temperature?: number; timeoutMs?: number; thinking?: "low" | "high" };
type Provider = "openrouter" | "gemini" | "none";

export function activeProvider(): Provider {
  // Gemini trực tiếp thường nhanh và ổn định hơn model miễn phí qua OpenRouter.
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  if (process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  return "none";
}
/** Tên mô hình đang dùng, để ghi vào ai_usage. */
export function activeModel(): string {
  const provider = activeProvider();
  if (provider === "openrouter") return process.env.OPENROUTER_MODEL || OPENROUTER_MODEL_DEFAULT;
  if (provider === "gemini") return process.env.GEMINI_MODEL?.trim() || GEMINI_MODEL_DEFAULT;
  return "";
}

export function hasLlm() {
  return activeProvider() !== "none";
}

// 429 và 5xx là quá tải nhất thời — Gemini hay trả 503 "high demand" rồi lần sau
// lại chạy bình thường. Mã trạng thái được nhét vào thông báo để nhận ra ở đây.
const TRANSIENT = /Mô hình trả về (429|500|502|503|504)|phản hồi quá lâu/;

/**
 * Lỗi tự nó hết sau vài giây: quá tải, chạm nhịp gọi, hết giờ chờ.
 *
 * Khác hẳn lỗi thật (khoá sai, tên model sai, hết hạn mức): loại đó thử lại bao
 * nhiêu lần cũng hỏng, chỉ tổ bắt người học ngồi chờ.
 */
export function isTransient(message: string) {
  return TRANSIENT.test(String(message ?? ""));
}

const RETRY_DELAY_MS = 700;

export async function generateJson<T>(prompt: string, options: Options = {}): Promise<T> {
  const providers: Provider[] = [];
  if (process.env.GEMINI_API_KEY?.trim()) providers.push("gemini");
  if (process.env.OPENROUTER_API_KEY?.trim()) providers.push("openrouter");
  if (!providers.length) throw new LlmError("Chưa cấu hình OPENROUTER_API_KEY hoặc GEMINI_API_KEY.");

  let lastError: LlmError = new LlmError("Không gọi được mô hình ngôn ngữ.");
  let providerErrors: string[] = [];

  // Mỗi nhà cung cấp thử một lần rồi chuyển ngay sang dự phòng — thử ba lần cùng
  // một model từng bắt người học chờ hơn một phút khi model 429.
  //
  // Nhưng chỉ một vòng thì chưa đủ: có lúc CẢ HAI cùng nghẽn một nhịp (Gemini
  // 503 "high demand" trong khi OpenRouter 429), đo được cứ ba lần gọi thì hỏng
  // một. Vậy nên khi mọi lỗi đều thuộc loại nhất thời thì chờ một nhịp ngắn rồi
  // đi thêm đúng một vòng nữa. Lỗi thật — khoá sai, hết hạn mức — thì dừng ngay,
  // vì thử lại cũng chẳng khác gì.
  for (let round = 0; round < 2; round += 1) {
    if (round > 0) await new Promise((done) => setTimeout(done, RETRY_DELAY_MS));
    const errors: string[] = [];
    let everyErrorTransient = true;
    for (const provider of providers) {
      try {
        return await callOnce<T>(prompt, { ...options, timeoutMs: Math.min(options.timeoutMs ?? 25000, 25000) }, provider);
      } catch (error) {
        lastError = error instanceof LlmError ? error : new LlmError(String(error));
        errors.push(`${provider}: ${lastError.message}`);
        if (!isTransient(lastError.message)) everyErrorTransient = false;
      }
    }
    providerErrors = errors;
    if (!everyErrorTransient) break;
  }
  throw new LlmError(providerErrors.length ? providerErrors.join(" | ") : lastError.message);
}

async function callOnce<T>(prompt: string, options: Options = {}, forcedProvider?: Provider): Promise<T> {
  const { temperature = 0.4, timeoutMs = 45000, thinking } = options;
  const provider = forcedProvider ?? activeProvider();
  if (provider === "none") throw new LlmError("Chưa cấu hình OPENROUTER_API_KEY hoặc GEMINI_API_KEY.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const request = provider === "openrouter" ? openRouterRequest(prompt, temperature) : geminiRequest(prompt, temperature, thinking);
    const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal: controller.signal });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new LlmError(`Mô hình trả về ${response.status}. ${detail.slice(0, 160)}`);
    }
    const data = (await response.json()) as unknown;
    const text = provider === "openrouter" ? openRouterText(data) : geminiText(data);
    if (!text) throw new LlmError("Mô hình không trả về nội dung.");
    // Đã yêu cầu JSON nhưng thỉnh thoảng vẫn có rào ```json.
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
    return JSON.parse(cleaned) as T;
  } catch (error) {
    if (error instanceof LlmError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new LlmError("Mô hình phản hồi quá lâu.");
    throw new LlmError(error instanceof Error ? error.message : "Không gọi được mô hình ngôn ngữ.");
  } finally {
    clearTimeout(timer);
  }
}

function openRouterRequest(prompt: string, temperature: number) {
  return {
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY?.trim() ?? ""}`,
      // OpenRouter dùng hai header này để ghi nhận nguồn gọi; không bắt buộc.
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "Lexilo",
    },
    body: {
      model: process.env.OPENROUTER_MODEL?.trim() || OPENROUTER_MODEL_DEFAULT,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature,
    },
  };
}
function geminiRequest(prompt: string, temperature: number, thinking: "low" | "high" = "low") {
  const model = process.env.GEMINI_MODEL?.trim() || GEMINI_MODEL_DEFAULT;
  // Dòng Gemini 2.5 Flash Lite không nhận `thinkingLevel`; gửi trường này làm
  // toàn bộ request bị 400 dù khóa và hạn mức vẫn hợp lệ.
  const generationConfig: Record<string, unknown> = { temperature, responseMimeType: "application/json", maxOutputTokens: 3000 };
  if (!model.startsWith("gemini-2.5-flash-lite")) generationConfig.thinkingConfig = { thinkingLevel: thinking };
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY?.trim() ?? "")}`,
    headers: { "Content-Type": "application/json" },
    body: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig,
    },
  };
}
function openRouterText(data: unknown) {
  return (data as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
}
function geminiText(data: unknown) {
  return (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
