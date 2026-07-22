-- TSG D1 Coaching Tool – konfliktfreie Datensaetze, Verlauf und Backups
-- Kann mehrfach sicher ausgefuehrt werden.

create table if not exists public.coaching_records (
  season_id text not null,
  scope text not null check (scope in ('roster', 'profile', 'attendance', 'match_meta', 'match_entry', 'diagnostic')),
  record_key text not null,
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by text not null default 'trainer',
  primary key (season_id, scope, record_key)
);

create index if not exists coaching_records_scope_idx
  on public.coaching_records (season_id, scope);

create table if not exists public.coaching_history (
  id bigint generated always as identity primary key,
  season_id text not null,
  scope text not null,
  record_key text not null,
  before_data jsonb,
  after_data jsonb,
  revision bigint not null,
  changed_at timestamptz not null default now(),
  changed_by text not null default 'trainer'
);

create index if not exists coaching_history_recent_idx
  on public.coaching_history (season_id, changed_at desc);

create table if not exists public.coaching_backups (
  id bigint generated always as identity primary key,
  season_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  created_by text not null default 'automatic'
);

create index if not exists coaching_backups_recent_idx
  on public.coaching_backups (season_id, created_at desc);

create table if not exists public.login_rate_limits (
  client_hash text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);

alter table public.lineup_positions
  add column if not exists revision bigint not null default 1 check (revision > 0);

create table if not exists public.lineup_history (
  id bigint generated always as identity primary key,
  lineup_id text not null,
  position_id text not null,
  before_players jsonb,
  after_players jsonb,
  revision bigint not null,
  changed_at timestamptz not null default now(),
  changed_by text not null default 'trainer'
);

create index if not exists lineup_history_recent_idx
  on public.lineup_history (lineup_id, changed_at desc);

alter table public.coaching_records enable row level security;
alter table public.coaching_history enable row level security;
alter table public.coaching_backups enable row level security;
alter table public.login_rate_limits enable row level security;
alter table public.lineup_history enable row level security;

revoke all on public.coaching_records from anon, authenticated;
revoke all on public.coaching_history from anon, authenticated;
revoke all on public.coaching_backups from anon, authenticated;
revoke all on public.login_rate_limits from anon, authenticated;
revoke all on public.lineup_history from anon, authenticated;

create or replace function public.log_lineup_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lineup_history (
    lineup_id, position_id, before_players, after_players, revision, changed_by
  ) values (
    new.lineup_id, new.position_id, old.players, new.players, new.revision, 'trainer'
  );
  return new;
end;
$$;

drop trigger if exists lineup_position_audit on public.lineup_positions;
create trigger lineup_position_audit
after update on public.lineup_positions
for each row execute function public.log_lineup_change();

create or replace function public.apply_lineup_position(
  p_lineup_id text,
  p_position_id text,
  p_players jsonb,
  p_expected_revision bigint
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare current_revision bigint;
begin
  select l.revision into current_revision
  from public.lineup_positions l
  where l.lineup_id = p_lineup_id and l.position_id = p_position_id
  for update;

  if current_revision is null then
    if coalesce(p_expected_revision, 0) <> 0 then raise exception 'revision_conflict' using errcode = '40001'; end if;
    return query
      insert into public.lineup_positions (lineup_id, position_id, players, revision)
      values (p_lineup_id, p_position_id, p_players, 1)
      returning lineup_positions.revision, lineup_positions.updated_at;
  else
    if p_expected_revision is null or current_revision <> p_expected_revision then
      raise exception 'revision_conflict' using errcode = '40001';
    end if;
    return query
      update public.lineup_positions
      set players = p_players, revision = current_revision + 1, updated_at = now()
      where lineup_id = p_lineup_id and position_id = p_position_id
      returning lineup_positions.revision, lineup_positions.updated_at;
  end if;
end;
$$;

create or replace function public.log_coaching_record_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.coaching_history (
    season_id, scope, record_key, before_data, after_data, revision, changed_by
  ) values (
    coalesce(new.season_id, old.season_id),
    coalesce(new.scope, old.scope),
    coalesce(new.record_key, old.record_key),
    case when tg_op = 'INSERT' then null else old.data end,
    case when tg_op = 'DELETE' then null else new.data end,
    case when tg_op = 'DELETE' then old.revision + 1 else new.revision end,
    coalesce(new.updated_by, old.updated_by, 'trainer')
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists coaching_record_audit on public.coaching_records;
create trigger coaching_record_audit
after insert or update or delete on public.coaching_records
for each row execute function public.log_coaching_record_change();

create or replace function public.apply_coaching_record(
  p_season_id text,
  p_scope text,
  p_record_key text,
  p_data jsonb,
  p_expected_revision bigint,
  p_actor text default 'trainer'
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_revision bigint;
begin
  if p_scope not in ('roster', 'profile', 'attendance', 'match_meta', 'match_entry', 'diagnostic') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;

  select r.revision into current_revision
  from public.coaching_records r
  where r.season_id = p_season_id and r.scope = p_scope and r.record_key = p_record_key
  for update;

  if current_revision is null then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'revision_conflict' using errcode = '40001';
    end if;
    return query
      insert into public.coaching_records (season_id, scope, record_key, data, revision, updated_by)
      values (p_season_id, p_scope, p_record_key, p_data, 1, left(coalesce(p_actor, 'trainer'), 80))
      returning coaching_records.revision, coaching_records.updated_at;
  else
    if p_expected_revision is null or current_revision <> p_expected_revision then
      raise exception 'revision_conflict' using errcode = '40001';
    end if;
    return query
      update public.coaching_records
      set data = p_data,
          revision = current_revision + 1,
          updated_at = now(),
          updated_by = left(coalesce(p_actor, 'trainer'), 80)
      where season_id = p_season_id and scope = p_scope and record_key = p_record_key
      returning coaching_records.revision, coaching_records.updated_at;
  end if;
end;
$$;

create or replace function public.restore_coaching_history(
  p_history_id bigint,
  p_actor text default 'trainer'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.coaching_history%rowtype;
begin
  select * into item from public.coaching_history where id = p_history_id;
  if not found then raise exception 'history_not_found' using errcode = '22023'; end if;

  if item.before_data is null then
    update public.coaching_records set updated_by = left(coalesce(p_actor, 'trainer'), 80)
      where season_id = item.season_id and scope = item.scope and record_key = item.record_key;
    delete from public.coaching_records
      where season_id = item.season_id and scope = item.scope and record_key = item.record_key;
  else
    insert into public.coaching_records (season_id, scope, record_key, data, revision, updated_by)
    values (item.season_id, item.scope, item.record_key, item.before_data, 1, left(coalesce(p_actor, 'trainer'), 80))
    on conflict (season_id, scope, record_key) do update
      set data = excluded.data,
          revision = coaching_records.revision + 1,
          updated_at = now(),
          updated_by = excluded.updated_by;
  end if;
end;
$$;

create or replace function public.consume_login_attempt(
  p_client_hash text,
  p_success boolean
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.login_rate_limits%rowtype;
  now_at timestamptz := now();
begin
  select * into item from public.login_rate_limits where client_hash = p_client_hash for update;

  if found and item.blocked_until is not null and item.blocked_until > now_at then
    return query select false, greatest(1, ceil(extract(epoch from item.blocked_until - now_at))::integer);
    return;
  end if;

  if p_success then
    delete from public.login_rate_limits where client_hash = p_client_hash;
    return query select true, 0;
    return;
  end if;

  if not found or item.window_started_at < now_at - interval '15 minutes' then
    insert into public.login_rate_limits (client_hash, attempts, window_started_at, blocked_until)
    values (p_client_hash, 1, now_at, null)
    on conflict (client_hash) do update set attempts = 1, window_started_at = now_at, blocked_until = null;
    return query select true, 0;
    return;
  end if;

  update public.login_rate_limits
  set attempts = attempts + 1,
      blocked_until = case when attempts + 1 >= 5 then now_at + interval '15 minutes' else null end
  where client_hash = p_client_hash
  returning * into item;

  return query select item.attempts < 5,
    case when item.attempts >= 5 then 900 else 0 end;
end;
$$;

revoke all on function public.apply_coaching_record(text, text, text, jsonb, bigint, text) from public, anon, authenticated;
revoke all on function public.restore_coaching_history(bigint, text) from public, anon, authenticated;
revoke all on function public.consume_login_attempt(text, boolean) from public, anon, authenticated;
revoke all on function public.apply_lineup_position(text, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.apply_coaching_record(text, text, text, jsonb, bigint, text) to service_role;
grant execute on function public.restore_coaching_history(bigint, text) to service_role;
grant execute on function public.consume_login_attempt(text, boolean) to service_role;
grant execute on function public.apply_lineup_position(text, text, jsonb, bigint) to service_role;

-- Bestehenden Phase-2-Datenbestand einmalig und verlustfrei aufteilen.
do $$
declare legacy jsonb;
begin
  select data into legacy from public.coaching_state where id = 'd1-2026-27';
  if legacy is null then return; end if;

  insert into public.coaching_records (season_id, scope, record_key, data, updated_by)
  select 'd1-2026-27', 'profile', key, value, 'migration'
  from jsonb_each(coalesce(legacy->'profiles', '{}'::jsonb))
  on conflict do nothing;

  insert into public.coaching_records (season_id, scope, record_key, data, updated_by)
  select 'd1-2026-27', 'roster',
         coalesce((select p.key from jsonb_each(coalesce(legacy->'profiles', '{}'::jsonb)) p
                   where lower(p.value->>'firstName') = lower(r.value #>> '{}') limit 1),
                  md5(r.value #>> '{}')),
         r.value, 'migration'
  from jsonb_array_elements(coalesce(legacy->'roster', '[]'::jsonb)) r(value)
  on conflict do nothing;

  insert into public.coaching_records (season_id, scope, record_key, data, updated_by)
  select 'd1-2026-27', 'attendance', event_entry.key || ':' || player_entry.key,
         player_entry.value, 'migration'
  from jsonb_each(coalesce(legacy->'attendance', '{}'::jsonb)) event_entry
  cross join lateral jsonb_each(event_entry.value) player_entry
  on conflict do nothing;

  insert into public.coaching_records (season_id, scope, record_key, data, updated_by)
  select 'd1-2026-27', 'match_meta', event_entry.key,
         jsonb_build_object('result', coalesce(event_entry.value->>'result', '')), 'migration'
  from jsonb_each(coalesce(legacy->'matches', '{}'::jsonb)) event_entry
  on conflict do nothing;

  insert into public.coaching_records (season_id, scope, record_key, data, updated_by)
  select 'd1-2026-27', 'match_entry', event_entry.key || ':' || player_entry.key,
         player_entry.value, 'migration'
  from jsonb_each(coalesce(legacy->'matches', '{}'::jsonb)) event_entry
  cross join lateral jsonb_each(coalesce(event_entry.value->'entries', '{}'::jsonb)) player_entry
  on conflict do nothing;

  insert into public.coaching_records (season_id, scope, record_key, data, updated_by)
  select 'd1-2026-27', 'diagnostic', player_entry.key || ':' || (diagnostic.value->>'id'),
         diagnostic.value, 'migration'
  from jsonb_each(coalesce(legacy->'diagnostics', '{}'::jsonb)) player_entry
  cross join lateral jsonb_array_elements(player_entry.value) diagnostic(value)
  where diagnostic.value->>'id' is not null
  on conflict do nothing;
end $$;

comment on table public.coaching_records is 'Kleine, revisionsgesicherte Datensaetze des TSG D1 Coaching-Tools.';
comment on table public.coaching_history is 'Unveraenderlicher Aenderungsverlauf fuer Wiederherstellung und Nachvollziehbarkeit.';
