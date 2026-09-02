-- Bảng xếp hạng Lexilo. Chạy một lần trong Supabase SQL Editor.
-- Mỗi người chỉ được ghi điểm của chính mình; mọi người được đọc bảng điểm.

create table if not exists public.leaderboard_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_type text not null check (period_type in ('week', 'month')),
  period_start date not null,
  display_name text not null check (char_length(display_name) between 1 and 32),
  xp int not null default 0 check (xp >= 0),
  minutes int not null default 0 check (minutes >= 0),
  reviews int not null default 0 check (reviews >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_type, period_start)
);

create index if not exists leaderboard_scores_period_idx
  on public.leaderboard_scores (period_type, period_start, xp desc, minutes desc);

alter table public.leaderboard_scores enable row level security;

drop policy if exists leaderboard_scores_read on public.leaderboard_scores;
create policy leaderboard_scores_read on public.leaderboard_scores
  for select using (true);

drop policy if exists leaderboard_scores_owner_insert on public.leaderboard_scores;
create policy leaderboard_scores_owner_insert on public.leaderboard_scores
  for insert with check (auth.uid() = user_id);

drop policy if exists leaderboard_scores_owner_update on public.leaderboard_scores;
create policy leaderboard_scores_owner_update on public.leaderboard_scores
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
