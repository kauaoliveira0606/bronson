-- Run this once in the Supabase SQL editor for the bronson project
-- (gpthswrobafxtmsuouph.supabase.co)
--
-- Dedicated tables for the high-ticket student-portal (/student-portal).
-- Kept fully separate from `profiles` / `proof_submissions`, which belong
-- to the low-ticket free-course portal (base44).

create table if not exists ht_profiles (
  id bigint generated always as identity primary key,
  email text unique not null,
  name text not null default '',
  avatar_url text,
  approved boolean not null default false,
  points integer not null default 0,
  created_at timestamptz not null default now()
);

-- Safe to re-run: adds name/avatar_url if this table already existed
-- from an earlier version of this migration.
alter table ht_profiles add column if not exists name text not null default '';
alter table ht_profiles add column if not exists avatar_url text;

alter table ht_profiles enable row level security;

create policy "anyone can read ht_profiles" on ht_profiles
  for select to anon using (true);

create policy "anyone can insert ht_profiles" on ht_profiles
  for insert to anon with check (true);

create policy "anyone can update ht_profiles" on ht_profiles
  for update to anon using (true);

create policy "anyone can delete ht_profiles" on ht_profiles
  for delete to anon using (true);


create table if not exists ht_submissions (
  id bigint generated always as identity primary key,
  email text not null,
  name text not null default '',
  category text not null default '',
  description text not null default '',
  proof_url text,
  points_value integer not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table ht_submissions enable row level security;

create policy "anyone can read ht_submissions" on ht_submissions
  for select to anon using (true);

create policy "anyone can insert ht_submissions" on ht_submissions
  for insert to anon with check (true);

create policy "anyone can update ht_submissions" on ht_submissions
  for update to anon using (true);
