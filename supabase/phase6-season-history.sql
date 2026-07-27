-- TSG D1 Coaching Tool – Schema für historische Saisonwerte
-- Einmal im Supabase SQL Editor ausführen. Das Skript ist sicher wiederholbar.
-- Der private, personenbezogene Einmal-Import wird bewusst nicht versioniert.

create table if not exists public.player_season_history (
  player_id text not null,
  season_id text not null,
  season_label text not null,
  team_label text not null,
  training_present_count integer,
  training_rate_percent integer check (training_rate_percent between 0 and 100),
  appearance_count integer,
  appearance_opportunities integer,
  goals integer,
  source text not null,
  imported_at timestamptz not null default now(),
  primary key (player_id, season_id),
  check (training_present_count is null or training_present_count >= 0),
  check (appearance_count is null or appearance_count >= 0),
  check (appearance_opportunities is null or appearance_opportunities >= 0),
  check (appearance_count is null or appearance_opportunities is null or appearance_count <= appearance_opportunities),
  check (goals is null or goals >= 0)
);

alter table public.player_season_history enable row level security;

-- Die Anwendung liest diese Tabelle ausschließlich serverseitig mit dem Supabase Secret Key.
-- Daher ist bewusst keine öffentliche Policy erforderlich.
