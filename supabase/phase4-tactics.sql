-- TSG D1 Coaching Tool – Taktiktafel freischalten
-- Einmal im Supabase SQL Editor ausführen. Kann sicher wiederholt werden.

alter table public.coaching_records
  drop constraint if exists coaching_records_scope_check;

alter table public.coaching_records
  add constraint coaching_records_scope_check
  check (scope in ('roster', 'profile', 'attendance', 'match_meta', 'match_entry', 'diagnostic', 'tactic'));

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
  if p_scope not in ('roster', 'profile', 'attendance', 'match_meta', 'match_entry', 'diagnostic', 'tactic') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;

  select r.revision into current_revision
  from public.coaching_records r
  where r.season_id = p_season_id and r.scope = p_scope and r.record_key = p_record_key
  for update;

  if current_revision is null then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise sqlstate 'PT409' using message = 'revision_conflict';
    end if;
    return query
      insert into public.coaching_records (season_id, scope, record_key, data, revision, updated_by)
      values (p_season_id, p_scope, p_record_key, p_data, 1, left(coalesce(p_actor, 'trainer'), 80))
      returning coaching_records.revision, coaching_records.updated_at;
  else
    if p_expected_revision is null or current_revision <> p_expected_revision then
      raise sqlstate 'PT409' using message = 'revision_conflict';
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

revoke all on function public.apply_coaching_record(text, text, text, jsonb, bigint, text)
  from public, anon, authenticated;
grant execute on function public.apply_coaching_record(text, text, text, jsonb, bigint, text)
  to service_role;
