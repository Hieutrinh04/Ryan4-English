-- RAG cho Lexilo: ký ức học tập riêng từng tài khoản, tìm kiếm hybrid
-- (cosine semantic + full-text lexical). Chạy file này trong Supabase SQL Editor.
--
-- Embedding dùng gemini-embedding-001 với 768 chiều. Nếu đổi số chiều trong code,
-- phải đổi đồng thời vector(768) ở bảng và hàm bên dưới.

create extension if not exists vector with schema extensions;

create table if not exists public.rag_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('translation_error', 'lesson', 'speaking_feedback')),
  source_id text not null,
  chunk_index int not null default 0 check (chunk_index >= 0),
  content text not null check (char_length(content) between 1 and 6000),
  content_hash text not null,
  metadata jsonb not null default '{}',
  embedding extensions.vector(768) not null,
  embedding_model text not null,
  content_search tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_type, source_id, chunk_index)
);

create index if not exists rag_chunks_owner_source_idx
  on public.rag_chunks (user_id, source_type, updated_at desc);
create index if not exists rag_chunks_content_search_idx
  on public.rag_chunks using gin (content_search);
-- HNSW phù hợp dữ liệu thay đổi liên tục hơn IVFFlat và không cần train lại index.
create index if not exists rag_chunks_embedding_hnsw_idx
  on public.rag_chunks using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.rag_retrieval_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  query_hash text not null,
  source_types text[] not null default '{}',
  results_count int not null default 0 check (results_count >= 0),
  top_score real,
  latency_ms int check (latency_ms >= 0),
  created_at timestamptz not null default now()
);
create index if not exists rag_retrieval_logs_user_date_idx
  on public.rag_retrieval_logs (user_id, created_at desc);

alter table public.rag_chunks enable row level security;
alter table public.rag_retrieval_logs enable row level security;

drop policy if exists rag_chunks_owner on public.rag_chunks;
create policy rag_chunks_owner on public.rag_chunks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists rag_retrieval_logs_owner on public.rag_retrieval_logs;
create policy rag_retrieval_logs_owner on public.rag_retrieval_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.match_rag_chunks(
  query_embedding extensions.vector(768),
  filter_user_id uuid,
  filter_source_types text[] default null,
  query_text text default '',
  match_count int default 5,
  match_threshold real default 0.42
)
returns table (
  id uuid,
  source_type text,
  source_id text,
  content text,
  metadata jsonb,
  similarity real,
  lexical_score real,
  score real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with semantic_candidates as (
    select
      c.id,
      c.source_type,
      c.source_id,
      c.content,
      c.metadata,
      c.content_search,
      (1 - (c.embedding <=> query_embedding))::real as similarity
    from public.rag_chunks c
    where c.user_id = filter_user_id
      and auth.uid() = filter_user_id
      and (filter_source_types is null or c.source_type = any(filter_source_types))
      and (1 - (c.embedding <=> query_embedding)) >= match_threshold
    order by c.embedding <=> query_embedding
    limit least(greatest(match_count * 12, 24), 120)
  ),
  reranked as (
    select
      s.*,
      case
        when btrim(query_text) = '' then 0::real
        else ts_rank_cd(s.content_search, plainto_tsquery('simple', query_text))::real
      end as lexical_score
    from semantic_candidates s
  )
  select
    r.id,
    r.source_type,
    r.source_id,
    r.content,
    r.metadata,
    r.similarity,
    r.lexical_score,
    (r.similarity * 0.84 + least(r.lexical_score * 5, 1) * 0.16)::real as score
  from reranked r
  order by score desc, similarity desc
  limit least(greatest(match_count, 1), 10);
$$;

revoke all on function public.match_rag_chunks(extensions.vector, uuid, text[], text, int, real) from public;
grant execute on function public.match_rag_chunks(extensions.vector, uuid, text[], text, int, real) to authenticated;

