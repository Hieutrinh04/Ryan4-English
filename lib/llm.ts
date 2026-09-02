// Gọi mô hình ngôn ngữ và bắt buộc trả về JSON.
//
// Hỗ trợ bốn nhà cung cấp, chọn theo khoá có trong .env.local:
//   ANTHROPIC_API_KEY   → Claude (ưu tiên nếu có: chất lượng cao + cache prompt rẻ)
//   GROQ_API_KEY        → Groq (free tier rộng, rất nhanh, độc lập Google)
//   GEMINI_API_KEY      → Google Gemini
//   OPENROUTER_API_KEY  → OpenRouter (chốt chặn cuối)
// Tất cả đều là biến phía server, KHÔNG có tiền tố NEXT_PUBLIC_ nên khoá không lộ
// ra trình duyệt. Mọi tính năng dùng hàm này đều phải có đường lui khi thiếu khoá
// hoặc gọi hỏng — app vẫn phải học được mà không cần mô hình ngôn ngữ.
//
// TỐI ƯU CHI PHÍ. Mỗi prompt được tách làm hai phần:
//   • system  — bộ quy tắc CỐ ĐỊNH, giống nhau ở mọi lượt gọi cùng loại.
//   • prompt  — dữ liệu THAY ĐỔI của riêng lượt này (câu người học viết, transcript…).
// Với Claude, phần system được đánh dấu cache_control: lần gọi thứ hai trở đi trong
// ~5 phút chỉ tính ~1/10 giá cho phần đó. Với Groq/OpenAI/Gemini, system nằm riêng
// nên vẫn gọn và rõ. Đầu ra (đắt gấp 5 lần đầu vào) bị chặn bằng maxTokens theo route.

const GEMINI_MODEL_DEFAULT = "gemini-3.6-flash";
const OPENROUTER_MODEL_DEFAULT = "google/gemini-2.5-flash";
// gpt-oss-120b: chất lượng tốt cho JSON, 200K token/ngày. Muốn nhiều lượt hơn nữa
// thì đặt GROQ_MODEL=llama-3.1-8b-instant (nhẹ hơn, hạn mức nhịp cao hơn).
const GROQ_MODEL_DEFAULT = "openai/gpt-oss-120b";
// Haiku 4.5: rẻ nhất dòng Claude ($1/1M vào, $5/1M ra) và đủ sức cho việc chấm bài
// JSON có cấu trúc. Đổi ANTHROPIC_MODEL=claude-sonnet-5 cho phần cần tinh tế hơn.
const ANTHROPIC_MODEL_DEFAULT = "claude-haiku-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

export class LlmError extends Error {}

type Options = {
  /** Bộ quy tắc cố định; tách khỏi `prompt` để cache được và giữ prompt gọn. */
  system?: string;
  temperature?: number;
  timeoutMs?: number;
  /** Trần token đầu ra. Đặt sát nhu cầu thật của route — đầu ra đắt gấp 5 đầu vào. */
  maxTokens?: number;
  thinking?: "low" | "high";
};
type Provider = "anthropic" | "groq" | "openrouter" | "gemini" | "none";

function keyFor(provider: Provider): string {
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (provider === "groq") return process.env.GROQ_API_KEY?.trim() ?? "";
  if (provider === "gemini") return process.env.GEMINI_API_KEY?.trim() ?? "";
  if (provider === "openrouter") return process.env.OPENROUTER_API_KEY?.trim() ?? "";
  return "";
}

/** Thứ tự thử: Claude → Groq → Gemini → OpenRouter, bỏ qua nhà cung cấp thiếu khoá. */
function providerChain(): Exclude<Provider, "none">[] {
  return (["anthropic", "groq", "gemini", "openrouter"] as const).filter((provider) => keyFor(provider));
}

export function activeProvider(): Provider {
  return providerChain()[0] ?? "none";
}
/** Tên mô hình đang dùng, để ghi vào ai_usage. */
export function activeModel(): string {
  return modelFor(activeProvider());
}
function modelFor(provider: Provider): string {
  if (provider === "anthropic") return process.env.ANTHROPIC_MODEL?.trim() || ANTHROPIC_MODEL_DEFAULT;
  if (provider === "groq") return process.env.GROQ_MODEL?.trim() || GROQ_MODEL_DEFAULT;
  if (provider === "openrouter") return process.env.OPENROUTER_MODEL?.trim() || OPENROUTER_MODEL_DEFAULT;
  if (provider === "gemini") return process.env.GEMINI_MODEL?.trim() || GEMINI_MODEL_DEFAULT;
  return "";
}

export function hasLlm() {
  return activeProvider() !== "none";
}

// 5xx là quá tải nhất thời — Gemini hay trả 503 "high demand" rồi lần sau lại
// chạy bình thường. Mã trạng thái được nhét vào thông báo để nhận ra ở đây.
const TRANSIENT = /Mô hình trả về (500|502|503|504|529)|phản hồi quá lâu|overloaded/i;
// 429 kèm các dấu hiệu hết hạn mức: thử lại sau 700ms chắc chắn vẫn hỏng và còn
// đốt thêm quota. Chờ theo phút mới hết, nên coi như lỗi cứng cho lượt gọi này.
const QUOTA = /Mô hình trả về 429|RESOURCE_EXHAUSTED|exceeded your current quota|rate-limited upstream|quota|too many requests/i;

/**
 * Lỗi tự nó hết sau vài giây: quá tải máy chủ, hết giờ chờ. KHÔNG tính 429 —
 * chạm hạn mức thì phải chờ cả phút, thử lại ngay chỉ tổ bắt người học đợi.
 */
export function isTransient(message: string) {
  return TRANSIENT.test(String(message ?? ""));
}

/** Chạm hạn mức / nhịp gọi của nhà cung cấp. */
export function isQuota(message: string) {
  return QUOTA.test(String(message ?? ""));
}

/**
 * Gộp lỗi thô của các nhà cung cấp thành một câu tiếng Việt cho người học.
 * Chuỗi JSON thô của Google/OpenRouter không nên hiện thẳng lên giao diện.
 */
export function friendlyLlmMessage(raw: string) {
  const text = String(raw ?? "");
  if (isQuota(text)) return "Lượt gọi AI miễn phí đang tạm hết. Thử lại sau khoảng một phút nhé.";
  if (isTransient(text)) return "Mô hình AI đang quá tải. Thử lại sau giây lát.";
  if (/Chưa cấu hình/.test(text)) return text;
  return "Chưa gọi được mô hình AI lúc này.";
}

const RETRY_DELAY_MS = 700;

export async function generateJson<T>(prompt: string, options: Options = {}): Promise<T> {
  const providers = providerChain();
  if (!providers.length) throw new LlmError("Chưa cấu hình ANTHROPIC_API_KEY, GROQ_API_KEY, GEMINI_API_KEY hoặc OPENROUTER_API_KEY.");

  let lastError: LlmError = new LlmError("Không gọi được mô hình ngôn ngữ.");
  let providerErrors: string[] = [];
  let sawQuota = false;
  let sawTransient = false;

  // Mỗi nhà cung cấp thử một lần rồi chuyển ngay sang dự phòng — thử ba lần cùng
  // một model từng bắt người học chờ hơn một phút khi model 429.
  //
  // Nhưng chỉ một vòng thì chưa đủ: có lúc cả hai cùng nghẽn một nhịp vì quá tải
  // máy chủ (503 "high demand"). Khi mọi lỗi đều là quá tải nhất thời thì chờ một
  // nhịp ngắn rồi đi thêm đúng một vòng nữa.
  //
  // Còn 429 chạm hạn mức thì KHÔNG lặp lại: phải chờ cả phút mới hết, thử lại
  // sau 700ms vừa chắc chắn hỏng vừa đốt thêm quota. Lỗi cứng (khoá sai, tên
  // model sai) cũng dừng ngay.
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
        if (isQuota(lastError.message)) sawQuota = true;
        else if (isTransient(lastError.message)) sawTransient = true;
        if (!isTransient(lastError.message)) everyErrorTransient = false;
      }
    }
    providerErrors = errors;
    if (!everyErrorTransient) break;
  }
  // Ghi lỗi thô ra log máy chủ để chủ app xem, nhưng chỉ ném ra câu tiếng Việt gọn.
  if (providerErrors.length) console.warn("[llm] mọi nhà cung cấp đều hỏng:", providerErrors.join(" | "));
  const summary = sawQuota
    ? friendlyLlmMessage("RESOURCE_EXHAUSTED")
    : sawTransient
      ? friendlyLlmMessage("Mô hình trả về 503")
      : friendlyLlmMessage(lastError.message);
  throw new LlmError(summary);
}

async function callOnce<T>(prompt: string, options: Options = {}, forcedProvider?: Provider): Promise<T> {
  const { system, temperature = 0.4, timeoutMs = 45000, maxTokens = 2000, thinking } = options;
  const provider = forcedProvider ?? activeProvider();
  if (provider === "none") throw new LlmError("Chưa cấu hình ANTHROPIC_API_KEY, GROQ_API_KEY, GEMINI_API_KEY hoặc OPENROUTER_API_KEY.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const request =
      provider === "anthropic" ? anthropicRequest(prompt, system, temperature, maxTokens)
      : provider === "groq" ? groqRequest(prompt, system, temperature, maxTokens)
      : provider === "openrouter" ? openRouterRequest(prompt, system, temperature, maxTokens)
      : geminiRequest(prompt, system, temperature, maxTokens, thinking);
    const response = await fetch(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal: controller.signal });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new LlmError(`Mô hình trả về ${response.status}. ${detail.slice(0, 200)}`);
    }
    const data = (await response.json()) as unknown;
    const text =
      provider === "anthropic" ? anthropicText(data)
      : provider === "gemini" ? geminiText(data)
      : openRouterText(data); // Groq và OpenRouter cùng khuôn OpenAI chat completions.
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

function anthropicRequest(prompt: string, system: string | undefined, temperature: number, maxTokens: number) {
  // Phần system được đánh dấu cache_control để lần gọi sau tính giá ~1/10.
  // Ép JSON bằng câu lệnh trong system + yêu cầu bắt đầu trả lời bằng "{".
  const systemBlocks = [
    { type: "text", text: (system ? `${system}\n\n` : "") + "Chỉ trả về một đối tượng JSON hợp lệ, không kèm chữ nào khác, không rào ```.", cache_control: { type: "ephemeral" } },
  ];
  return {
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY?.trim() ?? "",
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: {
      model: process.env.ANTHROPIC_MODEL?.trim() || ANTHROPIC_MODEL_DEFAULT,
      max_tokens: maxTokens,
      temperature,
      system: systemBlocks,
      messages: [{ role: "user", content: prompt }],
    },
  };
}
function groqRequest(prompt: string, system: string | undefined, temperature: number, maxTokens: number) {
  return {
    url: "https://api.groq.com/openai/v1/chat/completions",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY?.trim() ?? ""}`,
    },
    body: {
      model: process.env.GROQ_MODEL?.trim() || GROQ_MODEL_DEFAULT,
      messages: chatMessages(prompt, system),
      response_format: { type: "json_object" },
      temperature,
      max_tokens: maxTokens,
    },
  };
}
function openRouterRequest(prompt: string, system: string | undefined, temperature: number, maxTokens: number) {
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
      messages: chatMessages(prompt, system),
      response_format: { type: "json_object" },
      temperature,
      max_tokens: maxTokens,
    },
  };
}
function geminiRequest(prompt: string, system: string | undefined, temperature: number, maxTokens: number, thinking: "low" | "high" = "low") {
  const model = process.env.GEMINI_MODEL?.trim() || GEMINI_MODEL_DEFAULT;
  // Dòng Gemini 2.5 Flash Lite không nhận `thinkingLevel`; gửi trường này làm
  // toàn bộ request bị 400 dù khóa và hạn mức vẫn hợp lệ.
  const generationConfig: Record<string, unknown> = { temperature, responseMimeType: "application/json", maxOutputTokens: maxTokens };
  if (!model.startsWith("gemini-2.5-flash-lite")) generationConfig.thinkingConfig = { thinkingLevel: thinking };
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig,
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY?.trim() ?? "")}`,
    headers: { "Content-Type": "application/json" },
    body,
  };
}

/** Khuôn messages cho các API kiểu OpenAI (Groq, OpenRouter). */
function chatMessages(prompt: string, system?: string) {
  const messages: { role: string; content: string }[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  return messages;
}

function anthropicText(data: unknown) {
  const blocks = (data as { content?: { type?: string; text?: string }[] }).content ?? [];
  return blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
}
function openRouterText(data: unknown) {
  return (data as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
}
function geminiText(data: unknown) {
  return (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
