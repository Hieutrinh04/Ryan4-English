create extension if not exists "pgcrypto";

create table public.words (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  term text not null, part_of_speech text, ipa text, meaning_vi text not null, definition_en text,
  example text not null, example_vi text, example_cloze text not null, topic text, source text, note text, is_starred boolean not null default false,
  study_day int check (study_day between 0 and 6),
  deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index words_user_term_active_idx on public.words(user_id, lower(term)) where deleted_at is null;

create table public.word_states (
  word_id uuid not null references public.words(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('en_vi','vi_en')), box int not null default 1 check (box between 1 and 6),
  ease numeric not null default 2.5, interval_days int not null default 0, due_date date not null default current_date,
  review_count int not null default 0, lapse_count int not null default 0,
  status text not null default 'new' check (status in ('new','learning','review','mastered')), last_reviewed_at timestamptz,
  primary key(word_id, direction)
);
create index word_states_due_idx on public.word_states(user_id, due_date, status);

create table public.review_logs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  word_id uuid not null references public.words(id) on delete cascade, reviewed_at timestamptz not null default now(),
  direction text not null check (direction in ('en_vi','vi_en')), rating text not null check (rating in ('again','hard','good','easy')),
  box_before int not null, box_after int not null, duration_ms int not null check (duration_ms >= 0)
);
create index review_logs_user_date_idx on public.review_logs(user_id, reviewed_at desc);

create table public.daily_stats (
  user_id uuid not null references auth.users(id) on delete cascade, date date not null,
  reviewed_count int not null default 0, new_count int not null default 0, correct_rate numeric not null default 0,
  study_seconds int not null default 0, primary key(user_id, date)
);

alter table public.words enable row level security;
alter table public.word_states enable row level security;
alter table public.review_logs enable row level security;
alter table public.daily_stats enable row level security;

create policy "users own words" on public.words for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own word states" on public.word_states for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own review logs" on public.review_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users own daily stats" on public.daily_stats for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Migration cho database đã tạo trước đó (chạy một lần, an toàn nếu lặp lại):
-- alter table public.words add column if not exists example_vi text;
-- alter table public.words add column if not exists study_day int check (study_day between 0 and 6);
