-- Migration 006: performance indexes + RLS initplan optimization for LearnT.
-- Forward-only, idempotent. Does not alter app behavior.

-- Cover foreign keys reported by Supabase advisor.
create index if not exists idx_flashcards_topic_id on public.flashcards (topic_id);
create index if not exists idx_learner_cards_card_id on public.learner_cards (card_id);
create index if not exists idx_review_logs_learner_card_id on public.review_logs (learner_card_id);
create index if not exists idx_review_logs_learner_id on public.review_logs (learner_id);
create index if not exists idx_speaking_sessions_learner_id on public.speaking_sessions (learner_id);
create index if not exists idx_writing_submissions_learner_id on public.writing_submissions (learner_id);

-- Extra common access-path indexes for existing LearnT queries.
create index if not exists idx_learner_cards_learner_due on public.learner_cards (learner_id, due);
create index if not exists idx_daily_progress_learner_date on public.daily_progress (learner_id, activity_date);

-- Recreate RLS policies using (select auth.uid()) to avoid per-row initplan work.
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles for select using ((select auth.uid()) = id);
create policy "Users can update own profile" on public.profiles for update using ((select auth.uid()) = id);
create policy "Users can insert own profile" on public.profiles for insert with check ((select auth.uid()) = id);

drop policy if exists "Users can manage own cards" on public.learner_cards;
create policy "Users can manage own cards" on public.learner_cards for all using ((select auth.uid()) = learner_id) with check ((select auth.uid()) = learner_id);

drop policy if exists "Users can manage own reviews" on public.review_logs;
create policy "Users can manage own reviews" on public.review_logs for all using ((select auth.uid()) = learner_id) with check ((select auth.uid()) = learner_id);

drop policy if exists "Users can manage own writing" on public.writing_submissions;
create policy "Users can manage own writing" on public.writing_submissions for all using ((select auth.uid()) = learner_id) with check ((select auth.uid()) = learner_id);

drop policy if exists "Users can manage own conversations" on public.speaking_sessions;
create policy "Users can manage own conversations" on public.speaking_sessions for all using ((select auth.uid()) = learner_id) with check ((select auth.uid()) = learner_id);

drop policy if exists "Users can manage own progress" on public.daily_progress;
create policy "Users can manage own progress" on public.daily_progress for all using ((select auth.uid()) = learner_id) with check ((select auth.uid()) = learner_id);

drop policy if exists "Users can view own ai_configs" on public.ai_configs;
drop policy if exists "Users can insert own ai_configs" on public.ai_configs;
drop policy if exists "Users can update own ai_configs" on public.ai_configs;
drop policy if exists "Users can delete own ai_configs" on public.ai_configs;
create policy "Users can view own ai_configs" on public.ai_configs for select using ((select auth.uid()) = user_id);
create policy "Users can insert own ai_configs" on public.ai_configs for insert with check ((select auth.uid()) = user_id);
create policy "Users can update own ai_configs" on public.ai_configs for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own ai_configs" on public.ai_configs for delete using ((select auth.uid()) = user_id);
