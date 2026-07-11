-- Run this once in the Supabase SQL editor for the bronson project
-- (gpthswrobafxtmsuouph.supabase.co)

create table if not exists coaching_settings (
  id bigint generated always as identity primary key,
  zoom_link text not null default '',
  details text not null default '{}'
);

-- Seed the first row so id=1 exists
insert into coaching_settings (zoom_link, details)
values ('', '{}');

alter table coaching_settings enable row level security;

create policy "anyone can read coaching settings" on coaching_settings
  for select to anon using (true);

create policy "admin panel can update coaching settings" on coaching_settings
  for update to anon using (true);

create policy "admin can insert coaching settings" on coaching_settings
  for insert to anon with check (true);
