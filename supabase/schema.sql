-- Lược đồ Lexilo / Ryan English.
--
-- Bản này thay cho lược đồ cũ (words + word_states + review_logs + daily_stats).
-- Lược đồ cũ CHƯA TỪNG ĐƯỢC ÁP lên dự án Supabase nào, nên không có dữ liệu thật
-- cần migrate — đây là lúc rẻ nhất để sửa hai khiếm khuyết của nó:
--
--   1. Mỗi người đăng nhập là chép cả 983 từ mặc định vào bảng words của họ. Vài
--      nghìn người dùng là vài triệu dòng trùng nhau. Giờ tách vocabulary_catalog
--      (dữ liệu chung, một bản duy nhất) khỏi user_word_states (tiến trình riêng).
--   2. Chấm bài xong không lưu gì, nên không trả lời được "30 ngày qua bạn sai mạo
--      từ bao nhiêu lần". Giờ có translation_attempts và error_events.
--
-- Chạy MỘT LẦN trong Supabase SQL Editor. Nếu dự án đã có bảng words cũ không
-- thuộc Lexilo, xem supabase/apply-schema.sql trước khi chạy file này.

create extension if not exists "pgcrypto";

-- ── Từ vựng ────────────────────────────────────────────────────────────────

-- Bộ từ dựng sẵn, dùng chung cho mọi người. Không có user_id.
create table if not exists public.vocabulary_catalog (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  part_of_speech text,
  ipa text,
  meaning_vi text not null,
  definition_en text,
  example text,
  example_vi text,
  example_cloze text,
  topic text,
  source text,
  collocation text,
  collocation_vi text,
  synonyms text[] not null default '{}',
  antonyms text[] not null default '{}',
  related text[] not null default '{}',
  paraphrases text[] not null default '{}',
  ielts_topics text[] not null default '{}',
  synonym_details jsonb not null default '[]',
  antonym_details jsonb not null default '[]',
  related_details jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vocabulary_catalog_term_idx on public.vocabulary_catalog (lower(term));
create index if not exists vocabulary_catalog_topic_idx on public.vocabulary_catalog (topic);

-- Từ do chính người dùng thêm. Cùng cấu trúc nhưng có chủ sở hữu.
create table if not exists public.user_custom_words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  term text not null,
  part_of_speech text,
  ipa text,
  meaning_vi text not null,
  definition_en text,
  example text,
  example_vi text,
  example_cloze text,
  topic text,
  note text,
  collocation text,
  collocation_vi text,
  synonyms text[] not null default '{}',
  antonyms text[] not null default '{}',
  related text[] not null default '{}',
  paraphrases text[] not null default '{}',
  ielts_topics text[] not null default '{}',
  synonym_details jsonb not null default '[]',
  antonym_details jsonb not null default '[]',
  related_details jsonb not null default '[]',
  enrichment_checked_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists user_custom_words_term_idx
  on public.user_custom_words (user_id, lower(term)) where deleted_at is null;

-- ── Tiến trình học ─────────────────────────────────────────────────────────

-- Một dòng cho mỗi (người dùng × từ × chiều học). Từ có thể thuộc catalog chung
-- hoặc là từ riêng của người đó — đúng một trong hai, ràng buộc bằng check.
create table if not exists public.user_word_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_id uuid references public.vocabulary_catalog(id) on delete cascade,
  custom_word_id uuid references public.user_custom_words(id) on delete cascade,
  direction text not null default 'vi_en' check (direction in ('vi_en', 'en_vi')),
  box int not null default 1 check (box between 1 and 6),
  interval_days int not null default 0,
  due_date date not null default current_date,
  review_count int not null default 0,
  lapse_count int not null default 0,
  status text not null default 'new' check (status in ('new', 'learning', 'review', 'mastered')),
  starred boolean not null default false,
  study_day int check (study_day between 0 and 6),
  last_reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint user_word_states_one_source check (num_nonnulls(catalog_id, custom_word_id) = 1)
);
create unique index if not exists user_word_states_catalog_idx
  on public.user_word_states (user_id, catalog_id, direction) where catalog_id is not null;
create unique index if not exists user_word_states_custom_idx
  on public.user_word_states (user_id, custom_word_id, direction) where custom_word_id is not null;
-- Truy vấn nóng nhất: "hôm nay tôi cần ôn những từ nào".
create index if not exists user_word_states_due_idx on public.user_word_states (user_id, due_date, status);

-- ── Folder ─────────────────────────────────────────────────────────────────

-- Thay cho việc suy ra folder từ trường topic/source như hiện nay.
create table if not exists public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  description text,
  -- deck của hệ thống (bộ PDF theo chủ đề) có user_id null và is_public true.
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.deck_words (
  deck_id uuid not null references public.decks(id) on delete cascade,
  catalog_id uuid references public.vocabulary_catalog(id) on delete cascade,
  custom_word_id uuid references public.user_custom_words(id) on delete cascade,
  position int not null default 0,
  constraint deck_words_one_source check (num_nonnulls(catalog_id, custom_word_id) = 1)
);
create index if not exists deck_words_deck_idx on public.deck_words (deck_id, position);

-- ── Nhật ký học ────────────────────────────────────────────────────────────

create table if not exists public.review_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  word_state_id uuid not null references public.user_word_states(id) on delete cascade,
  rating text not null check (rating in ('again', 'hard', 'good', 'easy')),
  box_before int not null,
  box_after int not null,
  duration_ms int not null default 0 check (duration_ms >= 0),
  reviewed_at timestamptz not null default now()
);
create index if not exists review_logs_user_date_idx on public.review_logs (user_id, reviewed_at desc);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  item_count int not null default 0,
  correct_count int not null default 0,
  seconds int not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists study_sessions_user_idx on public.study_sessions (user_id, started_at desc);

-- ── Dịch Việt → Anh ────────────────────────────────────────────────────────

-- Bài do mô hình ngôn ngữ sinh ra, lưu lại để không phải sinh lại và để đối chiếu.
create table if not exists public.translation_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid references public.decks(id) on delete set null,
  source_vi text not null,
  reference_en text not null,
  target_words text[] not null default '{}',
  difficulty text,
  created_at timestamptz not null default now()
);

create table if not exists public.translation_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid references public.translation_exercises(id) on delete cascade,
  answer text not null,
  score int check (score between 0 and 100),
  is_correct boolean,
  corrected text,
  ai_comment text,
  -- graded_by: 'llm' khi mô hình chấm, 'reference' khi lùi về cách so câu mẫu.
  graded_by text not null default 'llm' check (graded_by in ('llm', 'reference')),
  provider text,
  model text,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index if not exists translation_attempts_user_idx on public.translation_attempts (user_id, created_at desc);

-- Bảng nuôi Learning Engine: mỗi lỗi cụ thể là một dòng, phân loại theo một bộ
-- nhãn cố định để đếm được "30 ngày qua sai mạo từ bao nhiêu lần".
create table if not exists public.error_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid references public.translation_attempts(id) on delete cascade,
  error_type text not null check (error_type in (
    'article', 'preposition', 'verb_form', 'verb_tense', 'word_order',
    'agreement', 'vocabulary', 'collocation', 'spelling', 'natural_expression', 'other'
  )),
  wrong_text text,
  correct_text text,
  explanation text,
  -- Từ vựng liên quan, để nối lỗi ngược về lịch ôn của chính từ đó.
  catalog_id uuid references public.vocabulary_catalog(id) on delete set null,
  custom_word_id uuid references public.user_custom_words(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists error_events_user_type_idx on public.error_events (user_id, error_type, created_at desc);

-- ── Nghe chép ──────────────────────────────────────────────────────────────

create table if not exists public.dictation_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id text not null,
  accuracy int check (accuracy between 0 and 100),
  hints int not null default 0,
  plays int not null default 0,
  rate numeric,
  duration_seconds int,
  created_at timestamptz not null default now()
);
create index if not exists dictation_attempts_user_idx on public.dictation_attempts (user_id, created_at desc);

-- ── Chi phí mô hình ngôn ngữ ───────────────────────────────────────────────

-- Không có bảng này thì không biết một người dùng tốn bao nhiêu, và không đặt
-- được hạn mức. Cần trước khi mở beta công khai.
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  feature text not null,
  provider text,
  model text,
  ok boolean not null default true,
  prompt_chars int not null default 0,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_day_idx on public.ai_usage (user_id, created_at desc);

-- ── Row level security ─────────────────────────────────────────────────────

alter table public.user_custom_words enable row level security;
alter table public.user_word_states enable row level security;
alter table public.review_logs enable row level security;
alter table public.study_sessions enable row level security;
alter table public.translation_exercises enable row level security;
alter table public.translation_attempts enable row level security;
alter table public.error_events enable row level security;
alter table public.dictation_attempts enable row level security;
alter table public.ai_usage enable row level security;
alter table public.decks enable row level security;
alter table public.deck_words enable row level security;
alter table public.vocabulary_catalog enable row level security;

do $$
declare
  t text;
begin
  -- Các bảng có cột user_id: mỗi người chỉ thấy dòng của mình.
  foreach t in array array[
    'user_custom_words', 'user_word_states', 'review_logs', 'study_sessions',
    'translation_exercises', 'translation_attempts', 'error_events',
    'dictation_attempts', 'ai_usage'
  ] loop
    execute format(
      'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_owner', t
    );
  end loop;
end $$;

-- Bộ từ dùng chung: ai đăng nhập cũng đọc được, chỉ service role mới ghi.
create policy vocabulary_catalog_read on public.vocabulary_catalog
  for select using (auth.role() = 'authenticated');

-- Deck: của mình hoặc deck công khai của hệ thống.
create policy decks_read on public.decks
  for select using (is_public or auth.uid() = user_id);
create policy decks_write on public.decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy deck_words_read on public.deck_words
  for select using (exists (
    select 1 from public.decks d where d.id = deck_id and (d.is_public or d.user_id = auth.uid())
  ));
create policy deck_words_write on public.deck_words
  for all using (exists (select 1 from public.decks d where d.id = deck_id and d.user_id = auth.uid()))
  with check (exists (select 1 from public.decks d where d.id = deck_id and d.user_id = auth.uid()));
