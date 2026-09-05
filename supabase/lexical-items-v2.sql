-- Chạy một lần cho dự án đã có bảng từ vựng.
alter table if exists public.words
  add column if not exists lexical_type text not null default 'word';
alter table if exists public.vocabulary_catalog
  add column if not exists lexical_type text not null default 'word';
alter table if exists public.user_custom_words
  add column if not exists lexical_type text not null default 'word';

do $$ begin
  alter table public.words add constraint words_lexical_type_check
    check (lexical_type in ('word', 'chunk', 'collocation', 'phrase'));
exception when duplicate_object or undefined_table then null; end $$;
do $$ begin
  alter table public.vocabulary_catalog add constraint vocabulary_catalog_lexical_type_check
    check (lexical_type in ('word', 'chunk', 'collocation', 'phrase'));
exception when duplicate_object or undefined_table then null; end $$;
do $$ begin
  alter table public.user_custom_words add constraint user_custom_words_lexical_type_check
    check (lexical_type in ('word', 'chunk', 'collocation', 'phrase'));
exception when duplicate_object or undefined_table then null; end $$;

update public.words set lexical_type = case when term like '% %' then 'chunk' else 'word' end
where lexical_type = 'word';
update public.vocabulary_catalog set lexical_type = case when term like '% %' then 'chunk' else 'word' end
where lexical_type = 'word';
update public.user_custom_words set lexical_type = case when term like '% %' then 'chunk' else 'word' end
where lexical_type = 'word';
