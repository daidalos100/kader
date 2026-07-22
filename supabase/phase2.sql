create table if not exists public.coaching_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);

insert into public.coaching_state (id, data)
values ('d1-2026-27', '{}'::jsonb)
on conflict (id) do nothing;

alter table public.coaching_state enable row level security;

comment on table public.coaching_state is
  'TSG D1 Coaching-Tool: Trainerdaten für Profile, Anwesenheit, Spiele und Diagnostik. Zugriff ausschließlich serverseitig.';
