-- Profiles (extends Supabase auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  ui_language text default 'vi' check (ui_language in ('vi', 'en')),
  daily_goal integer default 20,
  current_streak integer default 0,
  longest_streak integer default 0,
  last_activity_date date,
  created_at timestamptz default now()
);

-- Topics (seed data)
create table if not exists public.topics (
  id text primary key,
  name_en text not null,
  name_vi text not null,
  description_en text,
  description_vi text,
  icon text,                          -- emoji or icon name
  difficulty_level integer default 1, -- 1=beginner, 2=intermediate, 3=advanced
  display_order integer default 0,
  created_at timestamptz default now()
);

-- Flashcards (seed data — belongs to a Topic)
create table if not exists public.flashcards (
  id text primary key,
  topic_id text not null references topics(id) on delete cascade,
  word text not null,                  -- English word
  phonetic text,                       -- IPA pronunciation (was pronunciation)
  part_of_speech text,                 -- noun, verb, adj, etc.
  definition_en text,                  -- definition in English (was meaning_vi)
  definition_vi text not null,         -- Vietnamese meaning
  example_en text,                     -- Example in English (was example_sentence)
  example_vi text,                     -- Example translated to Vietnamese (was example_translation)
  audio_url text,                      -- URL to pronunciation audio (optional)
  display_order integer default 0,
  created_at timestamptz default now()
);

-- Learner Cards (per-user FSRS state for each flashcard)
create table if not exists public.learner_cards (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references profiles(id) on delete cascade,
  card_id text not null references flashcards(id) on delete cascade, -- was flashcard_id uuid
  state smallint default 0,            -- 0=New, 1=Learning, 2=Review, 3=Relearning
  due timestamptz default now(),
  stability real default 0,
  difficulty real default 0,
  elapsed_days integer default 0,
  scheduled_days integer default 0,
  reps integer default 0,
  lapses integer default 0,
  last_review timestamptz,
  created_at timestamptz default now(),
  unique(learner_id, card_id)
);

-- Review Logs (history of each review action)
create table if not exists public.review_logs (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references profiles(id) on delete cascade,
  learner_card_id uuid not null references learner_cards(id) on delete cascade,
  rating smallint not null,            -- 1=Again, 2=Hard, 3=Good, 4=Easy
  state smallint not null,             -- card state after review
  due timestamptz not null,
  stability real not null,
  difficulty real not null,
  elapsed_days integer not null,
  scheduled_days integer not null,
  reviewed_at timestamptz default now()
);

-- Writing Submissions
create table if not exists public.writing_submissions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references profiles(id) on delete cascade,
  prompt text not null,
  content text not null,
  ai_feedback jsonb,                   -- { overall_score, strengths, errors, suggestions, revised_text }
  word_count integer,
  created_at timestamptz default now()
);

-- Speaking Sessions (was conversation_sessions)
create table if not exists public.speaking_sessions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references profiles(id) on delete cascade,
  topic text,                          -- scenario topic
  dialogue_history jsonb default '[]', -- dialogue history (was messages)
  duration_seconds integer,
  created_at timestamptz default now()
);

-- Daily Progress (for streak & daily goal tracking)
create table if not exists public.daily_progress (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references profiles(id) on delete cascade,
  activity_date date not null default current_date,
  cards_reviewed integer default 0,
  cards_learned integer default 0,
  writing_count integer default 0,
  speaking_minutes integer default 0,
  exercises_completed integer default 0,
  goal_met boolean default false,
  unique(learner_id, activity_date)
);

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.learner_cards enable row level security;
alter table public.review_logs enable row level security;
alter table public.writing_submissions enable row level security;
alter table public.speaking_sessions enable row level security;
alter table public.daily_progress enable row level security;

-- Drop existing policies if any to avoid migration errors
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can manage own cards" on public.learner_cards;
drop policy if exists "Users can manage own reviews" on public.review_logs;
drop policy if exists "Users can manage own writing" on public.writing_submissions;
drop policy if exists "Users can manage own conversations" on public.speaking_sessions;
drop policy if exists "Users can manage own progress" on public.daily_progress;
drop policy if exists "Anyone can read topics" on public.topics;
drop policy if exists "Anyone can read flashcards" on public.flashcards;

-- RLS Policies: users can only access their own data
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

create policy "Users can manage own cards" on public.learner_cards for all using (auth.uid() = learner_id);
create policy "Users can manage own reviews" on public.review_logs for all using (auth.uid() = learner_id);
create policy "Users can manage own writing" on public.writing_submissions for all using (auth.uid() = learner_id);
create policy "Users can manage own conversations" on public.speaking_sessions for all using (auth.uid() = learner_id);
create policy "Users can manage own progress" on public.daily_progress for all using (auth.uid() = learner_id);

-- Topics and Flashcards are public (read-only for all users)
create policy "Anyone can read topics" on public.topics for select using (true);
create policy "Anyone can read flashcards" on public.flashcards for select using (true);
