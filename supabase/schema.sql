create table if not exists public.lineup_positions (
  lineup_id text not null,
  position_id text not null check (
    position_id in ('st', 'lf', 'rf', 'zm', 'zdm', 'lv', 'iv', 'rv', 'tw')
  ),
  players jsonb not null default '[]'::jsonb check (
    jsonb_typeof(players) = 'array' and jsonb_array_length(players) <= 3
  ),
  updated_at timestamptz not null default now(),
  primary key (lineup_id, position_id)
);

alter table public.lineup_positions enable row level security;

comment on table public.lineup_positions is
  'TSG Neunerfeld: bis zu drei geordnete Vornamen je Position. Zugriff ausschließlich serverseitig.';

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
