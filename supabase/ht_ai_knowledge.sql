-- Run this once in the Supabase SQL editor for the bronson project
-- (gpthswrobafxtmsuouph.supabase.co)
--
-- Knowledge base for the "Bronson AI" chat tab on /student-portal.
-- Every row is one chunk of source material (a call transcript, a module,
-- an SOP, an external training) that the AI can retrieve from and answer
-- questions against. Kept separate from ht_profiles / ht_submissions.

create table if not exists ht_ai_knowledge (
  id bigint generated always as identity primary key,
  title text not null,
  category text not null default 'General',
  content text not null,
  created_at timestamptz not null default now()
);

alter table ht_ai_knowledge enable row level security;

create policy "anyone can read ht_ai_knowledge" on ht_ai_knowledge
  for select to anon using (true);

create policy "anyone can insert ht_ai_knowledge" on ht_ai_knowledge
  for insert to anon with check (true);

create policy "anyone can update ht_ai_knowledge" on ht_ai_knowledge
  for update to anon using (true);

create policy "anyone can delete ht_ai_knowledge" on ht_ai_knowledge
  for delete to anon using (true);

-- Speeds up the websearch full-text lookups the chat endpoint runs
-- against title/content on every question.
create index if not exists ht_ai_knowledge_content_fts
  on ht_ai_knowledge using gin (to_tsvector('english', content));
create index if not exists ht_ai_knowledge_title_fts
  on ht_ai_knowledge using gin (to_tsvector('english', title));
