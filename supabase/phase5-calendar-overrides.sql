-- TSG D1 Coaching Tool – bearbeitbare Kalenderansicht freischalten
-- Einmal im Supabase SQL Editor ausführen. Kann sicher wiederholt werden.

alter table public.coaching_records
  drop constraint if exists coaching_records_scope_check;

alter table public.coaching_records
  add constraint coaching_records_scope_check
  check (scope in ('roster', 'profile', 'attendance', 'match_meta', 'match_entry', 'diagnostic', 'tactic', 'calendar_event'));
