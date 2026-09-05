import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Caller } from "./ai-guard";
import { chunkRagText, formatRagContext, normalizeRagText, normalizeVector } from "./rag-core.mjs";
import { normaliseErrorType } from "./error-taxonomy.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const EMBEDDING_DIMENSIONS = 768;
const EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL?.trim() || "gemini-embedding-001";
const EMBEDDING_TIMEOUT_MS = 18_000;
const QUERY_CACHE_LIMIT = 256;
const MATCH_THRESHOLD = Math.min(0.9, Math.max(0.1, Number(process.env.RAG_MATCH_THRESHOLD) || 0.42));

type RagSource = "translation_error" | "lesson" | "speaking_feedback";
type RagMatch = {
  id: string;
  source_type: RagSource;
  source_id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
  lexical_score: number;
  score: number;
};

type RagDocument = {
  sourceType: RagSource;
  sourceId: string;
  title?: string;
  content: string;
  metadata?: Record<string, unknown>;
};

const queryEmbeddingCache = new Map<string, number[]>();

function embeddingKey() {
  return process.env.RAG_EMBEDDING_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || "";
}

function clientFor(caller: Caller): SupabaseClient | null {
  if (!url || !publishableKey || !caller.token || !caller.userId) return null;
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${caller.token}` } },
  });
}

export function ragConfigured(caller?: Caller) {
  return Boolean(url && publishableKey && embeddingKey() && (!caller || (caller.userId && caller.token)));
}

export async function readRagStatus(caller: Caller) {
  const client = clientFor(caller);
  if (!caller.userId || !caller.token) return { configured: Boolean(embeddingKey()), databaseReady: false, authenticated: false, chunks: 0, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS };
  if (!client || !embeddingKey()) return { configured: false, databaseReady: false, authenticated: true, chunks: 0, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS };
  const { count, error } = await client.from("rag_chunks").select("id", { count: "exact", head: true }).eq("user_id", caller.userId);
  return {
    configured: true,
    databaseReady: !error,
    authenticated: true,
    chunks: error ? 0 : count ?? 0,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    ...(error ? { reason: "Chưa áp dụng supabase/rag-schema.sql." } : {}),
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function embedTexts(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY", titles?: string | string[]) {
  const key = embeddingKey();
  if (!key || !texts.length) return [];
  const modelPath = EMBEDDING_MODEL.startsWith("models/") ? EMBEDDING_MODEL : `models/${EMBEDDING_MODEL}`;
  const result: number[][] = [];

  // Batch nhỏ tránh vượt kích thước request khi transcript dài.
  for (let start = 0; start < texts.length; start += 20) {
    const batch = texts.slice(start, start + 20);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${modelPath}:batchEmbedContents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            requests: batch.map((text, position) => {
              const title = Array.isArray(titles) ? titles[start + position] : titles;
              return ({
              model: modelPath,
              content: { parts: [{ text: normalizeRagText(text).slice(0, 6000) }] },
              taskType,
              ...(taskType === "RETRIEVAL_DOCUMENT" && title ? { title: normalizeRagText(title).slice(0, 180) } : {}),
              outputDimensionality: EMBEDDING_DIMENSIONS,
              });
            }),
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(`embedding ${response.status}`);
      const data = (await response.json()) as { embeddings?: { values?: number[] }[] };
      const vectors = (data.embeddings ?? []).map((item) => normalizeVector(item.values));
      if (vectors.length !== batch.length || vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) throw new Error("embedding sai số chiều");
      result.push(...vectors);
    } finally {
      clearTimeout(timer);
    }
  }
  return result;
}

async function queryEmbedding(query: string) {
  const normalized = normalizeRagText(query).slice(0, 2400);
  const cacheKey = `${EMBEDDING_MODEL}:${normalized}`;
  const cached = queryEmbeddingCache.get(cacheKey);
  if (cached) return cached;
  const [vector] = await embedTexts([normalized], "RETRIEVAL_QUERY");
  if (vector) {
    queryEmbeddingCache.set(cacheKey, vector);
    if (queryEmbeddingCache.size > QUERY_CACHE_LIMIT) queryEmbeddingCache.delete(queryEmbeddingCache.keys().next().value as string);
  }
  return vector ?? [];
}

async function upsertDocuments(caller: Caller, documents: RagDocument[]) {
  const client = clientFor(caller);
  if (!client || !caller.userId || !embeddingKey() || !documents.length) return 0;
  const prepared = (await Promise.all(documents.map(async (document) => {
    const chunks = chunkRagText(document.content);
    const hashes = await Promise.all(chunks.map(sha256));
    return { document, chunks, hashes };
  }))).filter((item) => item.chunks.length);
  if (!prepared.length) return 0;

  // Đọc hash hiện có trước: mở lại cùng bài học không được gọi embedding lần nữa.
  const existing = new Map<string, string>();
  for (const sourceType of [...new Set(prepared.map((item) => item.document.sourceType))]) {
    const ids = prepared.filter((item) => item.document.sourceType === sourceType).map((item) => item.document.sourceId);
    const { data } = await client
      .from("rag_chunks")
      .select("source_id,chunk_index,content_hash")
      .eq("user_id", caller.userId)
      .eq("source_type", sourceType)
      .in("source_id", ids);
    for (const row of data ?? []) existing.set(`${sourceType}:${row.source_id}:${row.chunk_index}`, row.content_hash);
  }

  const changed = prepared.flatMap(({ document, chunks, hashes }) => chunks.map((content, chunkIndex) => ({
    document,
    content,
    contentHash: hashes[chunkIndex],
    chunkIndex,
  })).filter((item) => existing.get(`${document.sourceType}:${document.sourceId}:${item.chunkIndex}`) !== item.contentHash));

  const vectors = await embedTexts(changed.map((item) => item.content), "RETRIEVAL_DOCUMENT", changed.map((item) => item.document.title ?? item.document.sourceType));
  const rows: Record<string, unknown>[] = changed.map((item, position) => ({
    user_id: caller.userId,
    source_type: item.document.sourceType,
    source_id: item.document.sourceId,
    chunk_index: item.chunkIndex,
    content: item.content,
    content_hash: item.contentHash,
    metadata: { ...(item.document.metadata ?? {}), ...(item.document.title ? { title: item.document.title } : {}) },
    // pgvector nhận literal JSON dạng "[0.1,...]" ổn định qua PostgREST.
    embedding: JSON.stringify(vectors[position]),
    embedding_model: EMBEDDING_MODEL,
    updated_at: new Date().toISOString(),
  }));
  // Khi tài liệu ngắn đi, xóa phần đuôi cũ để retrieval không đọc nội dung đã bỏ.
  await Promise.all(prepared.map(({ document, chunks }) => client
    .from("rag_chunks")
    .delete()
    .eq("user_id", caller.userId)
    .eq("source_type", document.sourceType)
    .eq("source_id", document.sourceId)
    .gte("chunk_index", chunks.length)));
  if (!rows.length) return 0;
  const { error } = await client.from("rag_chunks").upsert(rows, { onConflict: "user_id,source_type,source_id,chunk_index" });
  if (error) throw error;
  return rows.length;
}

async function bootstrapTranslationErrors(caller: Caller, client: SupabaseClient) {
  if (!caller.userId) return 0;
  const { count, error: countError } = await client
    .from("rag_chunks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", caller.userId)
    .eq("source_type", "translation_error");
  if (countError || (count ?? 0) > 0) return 0;

  const { data, error } = await client
    .from("error_events")
    .select("id,error_type,wrong_text,correct_text,explanation,created_at")
    .eq("user_id", caller.userId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error || !data?.length) return 0;
  return upsertDocuments(caller, data.map((item) => ({
    sourceType: "translation_error" as const,
    sourceId: `error:${item.id}`,
    title: String(item.error_type ?? "Lỗi dịch"),
    content: `Loại lỗi: ${item.error_type}. Cách viết sai: ${item.wrong_text ?? ""}. Cách sửa: ${item.correct_text ?? ""}. Giải thích: ${item.explanation ?? ""}.`,
    metadata: { errorType: item.error_type, createdAt: item.created_at },
  })));
}

async function runSearch(client: SupabaseClient, caller: Caller, query: string, vector: number[], sourceTypes: RagSource[], limit: number) {
  const { data, error } = await client.rpc("match_rag_chunks", {
    query_embedding: vector,
    filter_user_id: caller.userId,
    filter_source_types: sourceTypes,
    query_text: normalizeRagText(query).slice(0, 2400),
    match_count: Math.min(Math.max(limit, 1), 10),
    match_threshold: MATCH_THRESHOLD,
  });
  if (error) throw error;
  return (data ?? []) as RagMatch[];
}

async function recentErrorFallback(client: SupabaseClient, caller: Caller, limit: number): Promise<RagMatch[]> {
  if (!caller.userId) return [];
  const { data } = await client
    .from("error_events")
    .select("id,error_type,wrong_text,correct_text,explanation,created_at")
    .eq("user_id", caller.userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 6));
  return (data ?? []).map((item) => ({
    id: String(item.id),
    source_type: "translation_error" as const,
    source_id: `error:${item.id}`,
    content: `Loại lỗi: ${item.error_type}. Cách viết sai: ${item.wrong_text ?? ""}. Cách sửa: ${item.correct_text ?? ""}. Giải thích: ${item.explanation ?? ""}.`,
    metadata: { title: item.error_type, createdAt: item.created_at },
    similarity: 0,
    lexical_score: 0,
    score: 0,
  }));
}

/** Truy xuất hybrid semantic + lexical. Mọi lỗi đều rơi về context rỗng. */
export async function retrieveRagContext(caller: Caller, query: string, sourceTypes: RagSource[] = ["translation_error", "lesson"], limit = 5) {
  const client = clientFor(caller);
  if (!client || !caller.userId || !embeddingKey() || !normalizeRagText(query)) return { context: "", matches: [] as RagMatch[] };
  const startedAt = Date.now();
  try {
    const vector = await queryEmbedding(query);
    if (!vector.length) return { context: "", matches: [] as RagMatch[] };
    let matches = await runSearch(client, caller, query, vector, sourceTypes, limit);
    if (!matches.length && sourceTypes.includes("translation_error")) {
      const indexed = await bootstrapTranslationErrors(caller, client);
      if (indexed) matches = await runSearch(client, caller, query, vector, sourceTypes, limit);
    }
    await client.from("rag_retrieval_logs").insert({
      user_id: caller.userId,
      query_hash: await sha256(normalizeRagText(query)),
      source_types: sourceTypes,
      results_count: matches.length,
      top_score: matches[0]?.score ?? null,
      latency_ms: Date.now() - startedAt,
    });
    return { context: formatRagContext(matches), matches };
  } catch (error) {
    console.warn("[rag] retrieval unavailable:", error instanceof Error ? error.message : "unknown");
    // Trong lúc chưa áp migration, vẫn dùng vài lỗi gần nhất làm ngữ cảnh có cấu
    // trúc. Đây không phải semantic search nhưng giữ được cá nhân hóa và không làm
    // hỏng route; sau khi có pgvector, nhánh hybrid phía trên tự động thay thế.
    const matches = sourceTypes.includes("translation_error") ? await recentErrorFallback(client, caller, limit).catch(() => []) : [];
    return { context: formatRagContext(matches), matches };
  }
}

export async function rememberTranslationFeedback(caller: Caller, input: {
  vietnamese: string;
  answer: string;
  reference?: string;
  term?: string;
  score: number;
  suggestion?: string;
  issues: { type: string; wrong: string; right: string; why: string; rule?: string; example?: string }[];
}) {
  if (!caller.userId || !input.issues.length || input.score >= 95) return 0;
  try {
    const sourceId = `grade:${(await sha256(`${input.vietnamese}\u0000${input.answer}`)).slice(0, 32)}`;
    const fixes = input.issues.map((issue) => `${issue.type}: “${issue.wrong}” → “${issue.right}” (${issue.why})${issue.rule ? ` Quy tắc: ${issue.rule}.` : ""}${issue.example ? ` Ví dụ: ${issue.example}.` : ""}`).join("; ");
    return await upsertDocuments(caller, [{
      sourceType: "translation_error",
      sourceId,
      title: input.term || "Bài dịch",
      content: `Câu tiếng Việt: ${input.vietnamese}. Người học viết: ${input.answer}. Cách sửa gợi ý: ${input.suggestion || input.reference || ""}. Những lỗi đã xác nhận: ${fixes}.`,
      metadata: { term: input.term || null, score: input.score, errorTypes: input.issues.map((issue) => issue.type) },
    }]);
  } catch (error) {
    console.warn("[rag] cannot remember translation feedback:", error instanceof Error ? error.message : "unknown");
    return 0;
  }
}

export async function rememberSpeakingFeedback(caller: Caller, input: { scenario: string; said: string; wrong: string; right: string; why: string; rule?: string; example?: string }) {
  if (!caller.userId || !input.right) return 0;
  try {
    const sourceId = `speaking:${(await sha256(`${input.scenario}\u0000${input.said}`)).slice(0, 32)}`;
    return await upsertDocuments(caller, [{
      sourceType: "speaking_feedback",
      sourceId,
      title: input.scenario,
      content: `Trong tình huống ${input.scenario}, người học nói: ${input.said}. Phần cần sửa: “${input.wrong}” → “${input.right}”. Giải thích: ${input.why}.${input.rule ? ` Quy tắc: ${input.rule}.` : ""}${input.example ? ` Ví dụ chuyển giao: ${input.example}.` : ""}`,
      metadata: { title: input.scenario },
    }]);
  } catch {
    return 0;
  }
}

/** Ghi lỗi Nói vào cùng kho lỗi với Viết. RAG là ký ức diễn giải; error_events là
 * nguồn số liệu có cấu trúc cho Dashboard, Error Practice và trạng thái mastery. */
export async function rememberPersonalError(caller: Caller, input: {
  sourceSkill: "speaking" | "listening" | "writing" | "vocab";
  type?: string;
  wrong?: string;
  right?: string;
  why?: string;
  rule?: string;
  example?: string;
}) {
  const client = clientFor(caller);
  if (!client || !caller.userId || (!input.right && !input.why)) return 0;
  const event = {
    user_id: caller.userId,
    attempt_id: null,
    error_type: normaliseErrorType(input.type),
    wrong_text: input.wrong?.trim() || null,
    correct_text: input.right?.trim() || null,
    explanation: input.why?.trim() || null,
    source_skill: input.sourceSkill,
    rule: input.rule?.trim() || null,
    example: input.example?.trim() || null,
  };
  try {
    const { error } = await client.from("error_events").insert(event);
    if (!error) return 1;
    // Cho phép app tiếp tục hoạt động trong giai đoạn database chưa chạy migration V2.
    const { source_skill: _skill, rule: _rule, example: _example, ...legacy } = event;
    const fallback = await client.from("error_events").insert(legacy);
    return fallback.error ? 0 : 1;
  } catch {
    return 0;
  }
}

export async function rememberLesson(caller: Caller, input: { title: string; transcript: string }) {
  if (!caller.userId || normalizeRagText(input.transcript).length < 80) return 0;
  try {
    const sourceId = `lesson:${(await sha256(`${input.title}\u0000${input.transcript.slice(0, 2000)}`)).slice(0, 32)}`;
    return await upsertDocuments(caller, [{ sourceType: "lesson", sourceId, title: input.title, content: input.transcript, metadata: { title: input.title } }]);
  } catch (error) {
    console.warn("[rag] cannot index lesson:", error instanceof Error ? error.message : "unknown");
    return 0;
  }
}
