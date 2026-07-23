"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import SquadPlanner from "./SquadPlanner";
import TacticsBoard, { CustomTactic, TacticEntry, TacticLayout, TacticTemplate } from "./TacticsBoard";
import type { CalendarEvent } from "../lib/calendar";

type Tab = "overview" | "calendar" | "lineup" | "matchday" | "tactics" | "players" | "stats";
type AttendanceStatus = "present" | "excused" | "absent" | "not_selected";
type AbsenceReason = "Krankheit" | "Verletzung" | "Privat" | "Schul-Event";
type Profile = {
  id: string;
  firstName: string;
  shirtNumber: string;
  primaryPosition: string;
  secondaryPosition: string;
  strongFoot: "left" | "right" | "both" | "";
  personality: string;
};
type MatchEntry = { appearance: boolean; goals: number; assists: number };
type GoalEvent = { id: string; scorerId: string; assistId: string | null; createdAt: string; deleted?: boolean };
type MatchData = { result: string; entries: Record<string, MatchEntry>; goalEvents?: GoalEvent[] };
type MatchdayLineupPlayer = { player: Profile; position: string };
type SavedLineup = Record<string, Array<{ id?: string; firstName?: string }>>;
type Diagnostic = {
  id: string;
  date: string;
  sprint5: number | null;
  sprint10: number | null;
  sprint20: number | null;
  agility: number | null;
  endurance: number | null;
  jump: number | null;
  source?: string;
  ageGroup?: string;
  deleted?: boolean;
  metrics?: {
    sprint10: DiagnosticMetric;
    sprint20: DiagnosticMetric;
    agility: DiagnosticMetric;
    dribbling: DiagnosticMetric;
    shuttleRun: { level: number | null; rating: string | null };
    jump: { attempts: Array<number | string | null>; best: number | null; rating: string | null };
  };
};
type DiagnosticMetric = { attempts: Array<number | string | null>; best: number | null; percentile: number | null; category: string | null; rating: string | null };
type DiagnosticDisciplineKey = "sprint10" | "sprint20" | "agility" | "dribbling" | "shuttleRun" | "jump";
type SeasonStatKey = "appearances" | "training" | "goals" | "assists";
type StatSortKey = "player" | "appearances" | "goals" | "assists" | "training";
type StatEventDetail = { eventId: string; title: string; date: string; detail: string };
type CalendarEventOverride = Pick<CalendarEvent, "id" | "uid" | "title" | "start" | "end" | "allDay" | "location" | "description" | "type">;
type CoachingState = {
  roster: string[];
  profiles: Record<string, Partial<Profile>>;
  attendance: Record<string, Record<string, AttendanceStatus>>;
  attendanceReasons: Record<string, Record<string, AbsenceReason>>;
  matches: Record<string, MatchData>;
  diagnostics: Record<string, Diagnostic[]>;
  tactics: Record<string, TacticEntry>;
  calendarOverrides: Record<string, CalendarEventOverride>;
};
type SaveOperation = { scope: string; key: string; value: unknown; expectedRevision: number };
type HistoryEntry = { id: number; scope: string; record_key: string; revision: number; changed_at: string; changed_by: string };

const positionOptions = ["TW", "IV", "LV", "RV", "ZDM", "ZM", "LF", "RF", "ST"];
const seasonStart = new Date("2026-07-25T00:00:00+02:00").getTime();
const calendarVisibleFrom = new Date("2026-07-07T00:00:00+02:00").getTime();
const emptyState: CoachingState = { roster: [], profiles: {}, attendance: {}, attendanceReasons: {}, matches: {}, diagnostics: {}, tactics: {}, calendarOverrides: {} };
function playerId(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "-");
}

function profileFor(name: string, stored?: Partial<Profile>): Profile {
  return {
    id: playerId(name), firstName: name, shirtNumber: "", primaryPosition: "", secondaryPosition: "",
    strongFoot: "", personality: "", ...stored,
  };
}

function normalizeState(value: unknown, fallbackRoster: string[] = []): CoachingState {
  if (!value || typeof value !== "object") return { ...emptyState, roster: fallbackRoster };
  const state = value as Partial<CoachingState>;
  const visibleDiagnostics = Object.fromEntries(Object.entries(state.diagnostics ?? {}).map(([playerId, history]) => [
    playerId,
    Array.isArray(history) ? history.filter((diagnostic) => diagnostic && typeof diagnostic === "object" && (diagnostic as Diagnostic).deleted !== true) : [],
  ])) as Record<string, Diagnostic[]>;
  return {
    roster: Array.isArray(state.roster) && state.roster.length ? state.roster : fallbackRoster,
    profiles: state.profiles ?? {}, attendance: state.attendance ?? {}, attendanceReasons: state.attendanceReasons ?? {}, matches: state.matches ?? {},
    diagnostics: visibleDiagnostics, tactics: normalizeTactics(state.tactics), calendarOverrides: state.calendarOverrides ?? {},
  };
}

function localDateTimeValue(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function normalizeTactics(value: unknown): Record<string, TacticEntry> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, TacticEntry> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    if (item.layout && typeof item.layout === "object" && typeof item.name === "string" && typeof item.id === "string") {
      if (!item.deleted) result[key] = item as unknown as CustomTactic;
    } else if (item.positions && item.ball) {
      result[key] = item as unknown as TacticLayout;
    }
  }
  return result;
}

function formatDate(value: string, withTime = true) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short", day: "2-digit", month: "2-digit", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

function eventLabel(type: CalendarEvent["type"]) {
  return { training: "Training", game: "Spiel", tournament: "Turnier", other: "Termin" }[type];
}

function eventLineupId(event: CalendarEvent) {
  return `event-${event.id.replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 210)}`;
}

export default function CoachingTool() {
  const [tab, setTab] = useState<Tab>("overview");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [state, setState] = useState<CoachingState>(emptyState);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [detailPlayer, setDetailPlayer] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [notice, setNotice] = useState("");
  const [newRosterName, setNewRosterName] = useState("");
  const [positionFilter, setPositionFilter] = useState("all");
  const [matchdayLineup, setMatchdayLineup] = useState<MatchdayLineupPlayer[]>([]);
  const [eventLineups, setEventLineups] = useState<Record<string, SavedLineup>>({});
  const [editingCalendarEvent, setEditingCalendarEvent] = useState<CalendarEvent | null>(null);
  const [referenceTime] = useState(() => Date.now());
  const calendarListRef = useRef<HTMLDivElement>(null);

  const profiles = useMemo(
    () => state.roster.map((name) => profileFor(name, state.profiles[playerId(name)])),
    [state.profiles, state.roster],
  );
  const calendarEvents = useMemo(() => events
    .map((event) => ({ ...event, ...(state.calendarOverrides[event.id] ?? {}) }))
    .filter((event) => new Date(event.start).getTime() >= calendarVisibleFrom)
    .sort((a, b) => a.start.localeCompare(b.start)), [events, state.calendarOverrides]);
  const upcoming = useMemo(() => calendarEvents.filter((event) => new Date(event.start).getTime() >= Math.max(referenceTime, seasonStart)).slice(0, 40), [calendarEvents, referenceTime]);
  const nextCalendarEventId = calendarEvents.find((event) => new Date(event.start).getTime() >= referenceTime)?.id ?? null;
  const nextEvents = upcoming.slice(0, 4);
  const nextGame = upcoming.find((event) => event.type === "game" || event.type === "tournament");
  const matchdayEvent = selectedEvent && (selectedEvent.type === "game" || selectedEvent.type === "tournament") ? selectedEvent : nextGame;
  const matchdayLineupId = matchdayEvent ? eventLineupId(matchdayEvent) : null;

  useEffect(() => {
    let cancelled = false;
    if (!matchdayLineupId) return;
    fetch(`/api/lineup?lineupId=${encodeURIComponent(matchdayLineupId)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { lineup?: SavedLineup } : { lineup: {} })
      .then((data) => {
        if (cancelled) return;
        const rank = ["st", "lf", "rf", "zm", "zdm", "lv", "iv", "rv", "tw"];
        const used = new Set<string>();
        const lineup = Object.entries(data.lineup ?? {})
          .sort(([left], [right]) => (rank.indexOf(left.toLowerCase()) + rank.length) % rank.length - (rank.indexOf(right.toLowerCase()) + rank.length) % rank.length)
          .flatMap(([position, players]) => players.map((item) => ({ position: position.toUpperCase(), name: item.firstName?.trim() ?? "" })))
          .flatMap(({ position, name }) => {
            const player = profiles.find((item) => item.firstName.localeCompare(name, "de", { sensitivity: "base" }) === 0);
            if (!player || used.has(player.id)) return [];
            used.add(player.id);
            return [{ player, position }];
          });
        setMatchdayLineup(lineup);
      })
      .catch(() => { if (!cancelled) setMatchdayLineup([]); });
    return () => { cancelled = true; };
  }, [matchdayLineupId, profiles]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/calendar", { cache: "no-store" }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Kalender konnte nicht geladen werden.");
        return data.events as CalendarEvent[];
      }),
      fetch("/api/coaching-state", { cache: "no-store" }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Daten konnten nicht geladen werden.");
        return data as { state: unknown; revisions?: Record<string, number>; migrationRequired?: boolean; connected?: boolean };
      }),
      fetch("/api/lineup?lineupId=default", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return [] as string[];
        const data = await response.json() as { lineup?: SavedLineup };
        return [...new Set(Object.values(data.lineup ?? {}).flat().map((player) => player.firstName?.trim()).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, "de"));
      }),
      fetch("/api/lineup?eventLineups=1", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return {} as Record<string, SavedLineup>;
        const data = await response.json() as { lineups?: Record<string, SavedLineup> };
        return data.lineups ?? {};
      }),
    ])
      .then(([calendarEvents, coaching, lineupNames, savedEventLineups]) => {
        if (cancelled) return;
        setEvents(calendarEvents);
        setEventLineups(savedEventLineups);
        const normalized = normalizeState(coaching.state, lineupNames);
        setState(normalized);
        const nextRevisions = coaching.revisions ?? {};
        setRevisions(nextRevisions);
        setMigrationRequired(Boolean(coaching.migrationRequired));
      })
      .catch((error: Error) => {
        if (!cancelled) setNotice(error.message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (tab !== "calendar" || !nextCalendarEventId) return;
    const frame = window.requestAnimationFrame(() => {
      const list = calendarListRef.current;
      const anchor = list?.querySelector<HTMLElement>("#next-calendar-event");
      if (list && anchor) list.scrollTop = Math.max(0, anchor.offsetTop - 10);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tab, nextCalendarEventId, calendarEvents.length]);

  async function refreshCoachingState() {
    const response = await fetch("/api/coaching-state", { cache: "no-store" });
    const data = await response.json() as { state?: unknown; revisions?: Record<string, number>; migrationRequired?: boolean; error?: string };
    if (!response.ok) throw new Error(data.error ?? "Daten konnten nicht neu geladen werden.");
    setState(normalizeState(data.state));
    setRevisions(data.revisions ?? {});
    setMigrationRequired(Boolean(data.migrationRequired));
  }

  function operation(scope: string, key: string, value: unknown): SaveOperation {
    return { scope, key, value, expectedRevision: revisions[`${scope}:${key}`] ?? 0 };
  }

  async function save(next: CoachingState, operations: SaveOperation[]) {
    setState(next);
    setPendingSaves((count) => count + 1);
    setNotice("");
    try {
      const response = await fetch("/api/coaching-state", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ operations }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMigrationRequired(Boolean(data.migrationRequired));
        if (data.conflict) await refreshCoachingState();
        throw new Error(data.error ?? "Speichern fehlgeschlagen.");
      }
      setRevisions((current) => ({ ...current, ...(data.revisions ?? {}) }));
      setMigrationRequired(false);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
      return false;
    } finally {
      setPendingSaves((count) => Math.max(0, count - 1));
    }
  }

  function openEvent(event: CalendarEvent, target: "attendance" | "lineup" | "matchday" | "stats") {
    setSelectedEvent(event);
    if (target === "lineup") setTab("lineup");
    else if (target === "matchday") setTab("matchday");
    else if (target === "stats") setTab("stats");
    else setTab("calendar");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setAttendance(eventId: string, id: string, status: AttendanceStatus, reason?: AbsenceReason) {
    const record = status === "excused" && reason ? { status, reason } : status;
    void save({
      ...state,
      attendance: { ...state.attendance, [eventId]: { ...(state.attendance[eventId] ?? {}), [id]: status } },
      attendanceReasons: status === "excused" && reason ? { ...state.attendanceReasons, [eventId]: { ...(state.attendanceReasons[eventId] ?? {}), [id]: reason } } : state.attendanceReasons,
    }, [operation("attendance", `${eventId}:${id}`, record)]);
  }

  function setAllPresent(eventId: string) {
    const nextAttendance = Object.fromEntries(profiles.map((player) => [player.id, "present"])) as Record<string, AttendanceStatus>;
    void save({
      ...state,
      attendance: { ...state.attendance, [eventId]: nextAttendance },
    }, profiles.map((player) => operation("attendance", `${eventId}:${player.id}`, "present")));
  }

  function saveCalendarEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingCalendarEvent) return;
    const form = new FormData(event.currentTarget);
    const start = new Date(String(form.get("start") ?? ""));
    const end = new Date(String(form.get("end") ?? ""));
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) { setNotice("Bitte einen gültigen Zeitraum angeben."); return; }
    const updated: CalendarEventOverride = {
      ...editingCalendarEvent,
      title: String(form.get("title") ?? "").trim().slice(0, 120) || "Termin",
      start: start.toISOString(), end: end.toISOString(), location: String(form.get("location") ?? "").trim().slice(0, 160),
      description: String(form.get("description") ?? "").trim().slice(0, 1000), type: String(form.get("type") ?? "other") as CalendarEvent["type"], allDay: false,
    };
    setEditingCalendarEvent(null);
    setSelectedEvent(updated);
    void save({ ...state, calendarOverrides: { ...state.calendarOverrides, [updated.id]: updated } }, [operation("calendar_event", updated.id, updated)]);
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProfile) return;
    const form = new FormData(event.currentTarget);
    const profile: Profile = {
      ...editingProfile,
      shirtNumber: String(form.get("shirtNumber") ?? "").slice(0, 3),
      primaryPosition: String(form.get("primaryPosition") ?? ""),
      secondaryPosition: String(form.get("secondaryPosition") ?? ""),
      strongFoot: String(form.get("strongFoot") ?? "") as Profile["strongFoot"],
      personality: String(form.get("personality") ?? "").trim().slice(0, 500),
    };
    setEditingProfile(null);
    void save({ ...state, profiles: { ...state.profiles, [profile.id]: profile } }, [operation("profile", profile.id, profile)]);
  }

  function addRosterPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newRosterName.trim().replace(/\s+/g, " ").slice(0, 30);
    if (!name || state.roster.some((item) => item.localeCompare(name, "de", { sensitivity: "base" }) === 0)) return;
    setNewRosterName("");
    void save(
      { ...state, roster: [...state.roster, name].sort((a, b) => a.localeCompare(b, "de")) },
      [operation("roster", playerId(name), name)],
    );
  }

  function updateMatch(eventId: string, patch: Partial<MatchData>) {
    const current = state.matches[eventId] ?? { result: "", entries: {} };
    const next = { ...current, ...patch };
    void save(
      { ...state, matches: { ...state.matches, [eventId]: next } },
      [operation("match_meta", eventId, { result: next.result })],
    );
  }

    async function recordGoal(eventId: string, scorerId: string, assistId: string | null) {
    const current = state.matches[eventId] ?? { result: "", entries: {}, goalEvents: [] };
    const scorer = current.entries[scorerId] ?? { appearance: false, goals: 0, assists: 0 };
    const assist = assistId ? current.entries[assistId] ?? { appearance: false, goals: 0, assists: 0 } : null;
    const goal: GoalEvent = { id: crypto.randomUUID(), scorerId, assistId, createdAt: new Date().toISOString() };
    const entries = { ...current.entries, [scorerId]: { ...scorer, goals: scorer.goals + 1 } };
    if (assistId && assist) entries[assistId] = { ...assist, assists: assist.assists + 1 };
    const next = { ...current, entries, goalEvents: [...(current.goalEvents ?? []), goal] };
    const operations = [operation("match_meta", eventId, { result: next.result, goalEvents: next.goalEvents }), operation("match_entry", `${eventId}:${scorerId}`, entries[scorerId])];
    if (assistId) operations.push(operation("match_entry", `${eventId}:${assistId}`, entries[assistId]));
    return save({ ...state, matches: { ...state.matches, [eventId]: next } }, operations);
  }

  async function undoGoal(eventId: string, goal: GoalEvent) {
    const current = state.matches[eventId] ?? { result: "", entries: {}, goalEvents: [] };
    const scorer = current.entries[goal.scorerId];
    if (!scorer) return false;
    const entries = { ...current.entries, [goal.scorerId]: { ...scorer, goals: Math.max(0, scorer.goals - 1) } };
    if (goal.assistId && entries[goal.assistId]) entries[goal.assistId] = { ...entries[goal.assistId], assists: Math.max(0, entries[goal.assistId].assists - 1) };
    const next = { ...current, entries, goalEvents: (current.goalEvents ?? []).filter((item) => item.id !== goal.id) };
    const operations = [operation("match_meta", eventId, { result: next.result, goalEvents: next.goalEvents }), operation("match_entry", `${eventId}:${goal.scorerId}`, entries[goal.scorerId])];
    if (goal.assistId && entries[goal.assistId]) operations.push(operation("match_entry", `${eventId}:${goal.assistId}`, entries[goal.assistId]));
    return save({ ...state, matches: { ...state.matches, [eventId]: next } }, operations);
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.assign("/login");
  }

  async function saveTactic(scenario: string, layout: TacticLayout) {
    const current = state.tactics[scenario];
    const value: TacticEntry = current && "layout" in current ? { ...current, layout, deleted: false } : layout;
    const next = { ...state, tactics: { ...state.tactics, [scenario]: value } };
    const saved = await save(next, [operation("tactic", scenario, value)]);
    if (!saved) throw new Error("Taktik konnte nicht gespeichert werden.");
  }

  function newTacticId() {
    return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  async function createTactic(name: string, baseScenario: TacticTemplate, layout: TacticLayout) {
    const id = newTacticId();
    const value: CustomTactic = { id, name, layout, baseScenario, createdAt: new Date().toISOString() };
    const next = { ...state, tactics: { ...state.tactics, [id]: value } };
    if (!await save(next, [operation("tactic", id, value)])) throw new Error("Taktik konnte nicht angelegt werden.");
    return id;
  }

  async function renameTactic(id: string, name: string) {
    const current = state.tactics[id];
    if (!current || !("layout" in current)) return;
    const value = { ...current, name, deleted: false };
    if (!await save({ ...state, tactics: { ...state.tactics, [id]: value } }, [operation("tactic", id, value)])) throw new Error("Taktik konnte nicht umbenannt werden.");
  }

  async function duplicateTactic(id: string, layout: TacticLayout) {
    const current = state.tactics[id];
    if (!current || !("layout" in current)) throw new Error("Taktik konnte nicht dupliziert werden.");
    const newId = newTacticId();
    const value: CustomTactic = { ...current, id: newId, name: `${current.name} Kopie`.slice(0, 40), layout, createdAt: new Date().toISOString(), deleted: false };
    if (!await save({ ...state, tactics: { ...state.tactics, [newId]: value } }, [operation("tactic", newId, value)])) throw new Error("Taktik konnte nicht dupliziert werden.");
    return newId;
  }

  async function deleteTactic(id: string) {
    const current = state.tactics[id];
    if (!current || !("layout" in current)) return;
    const value = { ...current, deleted: true };
    if (!await save({ ...state, tactics: { ...state.tactics, [id]: value } }, [operation("tactic", id, value)])) throw new Error("Taktik konnte nicht gelöscht werden.");
  }

  const gameEvents = useMemo(() => calendarEvents
    .filter((event) => (event.type === "game" || event.type === "tournament") && new Date(event.start).getTime() >= seasonStart), [calendarEvents]);
  const eligibleEventLineupIds = useMemo(() => gameEvents.map(eventLineupId), [gameEvents]);
  const calendarEventById = useMemo(() => new Map(calendarEvents.map((event) => [event.id, event])), [calendarEvents]);
  const appearanceEventsByPlayer = useMemo(() => {
    const appearances: Record<string, StatEventDetail[]> = {};
    gameEvents.forEach((event) => {
      const lineupId = eventLineupId(event);
      const used = new Set<string>();
      Object.values(eventLineups[lineupId] ?? {}).flat().forEach((entry) => {
        const player = profiles.find((item) => item.id === entry.id)
          ?? profiles.find((item) => item.firstName.localeCompare(entry.firstName?.trim() ?? "", "de", { sensitivity: "base" }) === 0);
        if (player) used.add(player.id);
      });
      const lineupSaved = used.size > 0;
      profiles.forEach((player) => {
        const attendanceStatus = state.attendance[event.id]?.[player.id];
        const detail = used.has(player.id) ? "Im Kader" : attendanceStatus === "not_selected" ? "Nicht im Kader" : lineupSaved ? "Nicht im Kader" : "Noch nicht geplant";
        (appearances[player.id] ??= []).push({ eventId: event.id, title: event.title, date: formatDate(event.start, false), detail });
      });
    });
    return appearances;
  }, [gameEvents, eventLineups, profiles, state.attendance]);
  const appearanceCounts = useMemo(() => Object.fromEntries(Object.entries(appearanceEventsByPlayer).map(([id, events]) => [id, events.filter((event) => event.detail === "Im Kader").length])), [appearanceEventsByPlayer]);
  const totalMatches = eligibleEventLineupIds.filter((lineupId) => Object.values(eventLineups[lineupId] ?? {}).some((players) => players.length > 0)).length;
  const statsRows = profiles.map((player) => {
    let appearances = 0; let goals = 0; let assists = 0; let present = 0; let recorded = 0;
    const goalEvents: StatEventDetail[] = [];
    const assistEvents: StatEventDetail[] = [];
    const trainingEvents: StatEventDetail[] = calendarEvents.filter((event) => event.type === "training").map((event) => {
      const status = state.attendance[event.id]?.[player.id];
      const reason = status === "excused" ? state.attendanceReasons[event.id]?.[player.id] : undefined;
      if (status) {
        recorded += 1;
        if (status === "present") present += 1;
      }
      return { eventId: event.id, title: event.title, date: formatDate(event.start, false), detail: status === "present" ? "Anwesend" : status === "excused" ? `Entschuldigt${reason ? ` (${reason})` : ""}` : status === "not_selected" ? "Nicht im Kader" : status === "absent" ? "Abwesend" : "Noch nicht erfasst" };
    });
    Object.entries(state.matches).forEach(([eventId, match]) => {
      const entry = match.entries[player.id];
      goals += entry?.goals ?? 0; assists += entry?.assists ?? 0;
      const event = calendarEventById.get(eventId);
      if (entry?.goals) goalEvents.push({ eventId, title: event?.title ?? "Spiel", date: event ? formatDate(event.start, false) : "Spieltag", detail: `${entry.goals} ${entry.goals === 1 ? "Tor" : "Tore"}` });
      if (entry?.assists) assistEvents.push({ eventId, title: event?.title ?? "Spiel", date: event ? formatDate(event.start, false) : "Spieltag", detail: `${entry.assists} ${entry.assists === 1 ? "Assist" : "Assists"}` });
    });
    appearances = appearanceCounts[player.id] ?? 0;
    return { player, appearances, goals, assists, participation: recorded ? Math.round((present / recorded) * 100) : null, appearanceEvents: appearanceEventsByPlayer[player.id] ?? [], goalEvents, assistEvents, trainingEvents };
  });
  const seasonStatBestByPlayer = useMemo(() => {
    const keys: SeasonStatKey[] = ["appearances", "training", "goals", "assists"];
    const winners: Record<string, Set<SeasonStatKey>> = {};
    keys.forEach((key) => {
      const values = statsRows.map((row) => ({ playerId: row.player.id, value: key === "training" ? row.participation : row[key] })).filter((item): item is { playerId: string; value: number } => typeof item.value === "number" && Number.isFinite(item.value));
      if (!values.length) return;
      const best = Math.max(...values.map((item) => item.value));
      values.filter((item) => item.value === best && best > 0).forEach((item) => { (winners[item.playerId] ??= new Set()).add(key); });
    });
    return winners;
  }, [statsRows]);
  const sortedCardRows = [...statsRows]
    .filter(({ player }) => positionFilter === "all"
      || (positionFilter === "unassigned" && !player.primaryPosition && !player.secondaryPosition)
      || player.primaryPosition === positionFilter
      || player.secondaryPosition === positionFilter)
    .sort((a, b) => {
      const aRank = positionOptions.indexOf(a.player.primaryPosition);
      const bRank = positionOptions.indexOf(b.player.primaryPosition);
      const rankDifference = (aRank < 0 ? positionOptions.length : aRank) - (bRank < 0 ? positionOptions.length : bRank);
      return rankDifference || a.player.firstName.localeCompare(b.player.firstName, "de");
    });
  const hasUnassignedPlayers = profiles.some((player) => !player.primaryPosition && !player.secondaryPosition);
  const diagnosticBestByPlayer = useMemo(() => {
    const candidates: Record<DiagnosticDisciplineKey, Array<{ playerId: string; value: number }>> = {
      sprint10: [], sprint20: [], agility: [], dribbling: [], shuttleRun: [], jump: [],
    };
    profiles.forEach((player) => {
      const latest = state.diagnostics[player.id]?.[0];
      if (!latest?.metrics) return;
      const metrics: Array<[DiagnosticDisciplineKey, number | null]> = [
        ["sprint10", latest.metrics.sprint10.best], ["sprint20", latest.metrics.sprint20.best],
        ["agility", latest.metrics.agility.best], ["dribbling", latest.metrics.dribbling.best],
        ["shuttleRun", latest.metrics.shuttleRun.level], ["jump", latest.metrics.jump.best],
      ];
      metrics.forEach(([key, value]) => { if (value !== null && Number.isFinite(value)) candidates[key].push({ playerId: player.id, value }); });
    });
    const winners: Record<string, Set<DiagnosticDisciplineKey>> = {};
    (Object.keys(candidates) as DiagnosticDisciplineKey[]).forEach((key) => {
      const values = candidates[key]; if (!values.length) return;
      const target = key === "shuttleRun" || key === "jump" ? Math.max(...values.map((item) => item.value)) : Math.min(...values.map((item) => item.value));
      values.filter((item) => Math.abs(item.value - target) < 0.0001).forEach((item) => { (winners[item.playerId] ??= new Set()).add(key); });
    });
    return winners;
  }, [profiles, state.diagnostics]);

  return (
    <main className="coach-shell">
      <header className="coach-header">
        <button className="coach-brand" type="button" onClick={() => setTab("overview")}>
          <Image src="/brand/tsg-logo.png" alt="TSG Tübingen" width={68} height={68} priority unoptimized />
          <span><small>TSG TÜBINGEN · D1</small><strong>Coaching Tool</strong></span>
        </button>
        <nav aria-label="Hauptnavigation">
          {(["overview", "matchday", "lineup", "tactics", "players", "stats", "calendar"] as Tab[]).map((item) => (
            <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
              {{ overview: "Übersicht", calendar: "Kalender", lineup: "Aufstellung", matchday: "Spieltag", tactics: "Taktiken", players: "Team", stats: "Statistiken" }[item]}
            </button>
          ))}
        </nav>
        <div className="coach-header-actions">
          <span className={pendingSaves ? "saving active" : "saving"} aria-live="polite">{pendingSaves ? "Speichert …" : "Gespeichert"}</span>
          <button className="logout-button" type="button" onClick={logout}>Abmelden</button>
        </div>
      </header>

      {migrationRequired && (
        <aside className="setup-banner">
          <strong>Einmalige Datenbankfreigabe fehlt.</strong>
          <span>Bitte die aktuelle SQL-Migration einmal im Supabase SQL Editor ausführen. Bestehende Daten bleiben erhalten.</span>
        </aside>
      )}
      {notice && <p className="coach-notice" role="status">{notice}</p>}

      {loading ? <div className="coach-loading">Coaching-Daten werden geladen …</div> : (
        <>
          {tab === "overview" && (
            <section className="coach-view">
              <div className="view-heading">
                <div><p className="section-index">SAISON 2026/27</p><h1>Alles im Blick.</h1><p>Termine, Kader, Anwesenheit und Entwicklung an einem Ort.</p></div>
                <Image className="overview-claim" src="/brand/allez-tsg.png" alt="Allez TSG" width={270} height={65} unoptimized />
              </div>
              <div className="overview-grid">
                <article className="next-event-card">
                  <p className="section-index">NÄCHSTER WETTKAMPF</p>
                  {nextGame ? <><span className="event-date">{formatDate(nextGame.start)}</span><h2>{nextGame.title}</h2><p>{nextGame.location || "Ort noch offen"}</p><div className="card-actions"><button onClick={() => openEvent(nextGame, "lineup")}>Kader planen</button><button className="secondary" onClick={() => openEvent(nextGame, "attendance")}>Teilnahme eintragen</button><button className="secondary" onClick={() => openEvent(nextGame, "matchday")}>Spieltag</button></div></> : <p>Aktuell ist kein Spiel eingetragen.</p>}
                </article>
                <div className="overview-metrics">
                  <article><strong>{profiles.length}</strong><span>Spieler:innen</span></article>
                  <article><strong>{upcoming.filter((event) => event.type === "training").length}</strong><span>kommende Trainings</span></article>
                  <article><strong>{Object.keys(state.matches).length}</strong><span>erfasste Spiele</span></article>
                  <article><strong>{Object.keys(state.attendance).length}</strong><span>Anwesenheitslisten</span></article>
                </div>
              </div>
              <div className="section-heading"><div><p className="section-index">DIE NÄCHSTEN TERMINE</p><h2>Kalender</h2></div><button className="text-button" onClick={() => setTab("calendar")}>Alle anzeigen →</button></div>
              <div className="event-strip">{nextEvents.map((event) => <EventCard key={event.id} event={event} onOpen={openEvent} />)}</div>
              {!migrationRequired && <HistoryPanel onRestored={refreshCoachingState} />}
            </section>
          )}

          {tab === "calendar" && (
            <section className="coach-view">
              <div className="view-heading compact"><div><p className="section-index">GOOGLE KALENDER · LIVE</p><h1>Termine &amp; Teilnahme.</h1><p>Spiele und Trainings werden automatisch aus dem D1-Kalender übernommen.</p></div></div>
              <div className="calendar-layout">
                <div className="calendar-list" ref={calendarListRef}>
                  {calendarEvents.length ? calendarEvents.map((event) => <EventCard key={event.id} event={event} active={selectedEvent?.id === event.id} anchor={event.id === nextCalendarEventId} onOpen={openEvent} />) : <p className="calendar-empty">Ab dem 07.07.2026 sind noch keine Termine im Kalender.</p>}
                </div>
                <aside className="event-detail">
                  {selectedEvent ? <><AttendancePanel event={selectedEvent} profiles={profiles} attendance={state.attendance[selectedEvent.id] ?? {}} reasons={state.attendanceReasons[selectedEvent.id] ?? {}} onSet={setAttendance} onAll={setAllPresent} onEdit={() => setEditingCalendarEvent(selectedEvent)} />{(selectedEvent.type === "game" || selectedEvent.type === "tournament") && <div className="card-actions"><button onClick={() => openEvent(selectedEvent, "lineup")}>Kader planen</button><button className="secondary" onClick={() => openEvent(selectedEvent, "matchday")}>Spieltag erfassen</button></div>}</> : <div className="empty-detail"><span>←</span><p>Termin auswählen, um Teilnahme, Kader oder Statistik zu bearbeiten.</p></div>}
                </aside>
              </div>
            </section>
          )}

          {tab === "lineup" && (
            <section className="coach-view lineup-view">
              <div className="module-switcher">
                <div><p className="section-index">KADERPLANUNG</p><strong>{selectedEvent ? selectedEvent.title : "Allgemeine Aufstellung"}</strong></div>
                {selectedEvent && <button className="text-button" onClick={() => setSelectedEvent(null)}>Allgemeine Aufstellung öffnen</button>}
              </div>
              <SquadPlanner embedded lineupId={selectedEvent ? eventLineupId(selectedEvent) : "default"} eventTitle={selectedEvent?.title} />
            </section>
          )}

          {tab === "matchday" && (
            <section className="coach-view matchday-view">
              <MatchdayPanel key={matchdayEvent?.id ?? "no-match"}
                event={matchdayEvent ?? null}
                lineup={matchdayLineup}
                profiles={profiles}
                data={matchdayEvent ? state.matches[matchdayEvent.id] ?? { result: "", entries: {}, goalEvents: [] } : null}
                onChooseEvent={(event) => setSelectedEvent(event)}
                events={upcoming.filter((event) => event.type === "game" || event.type === "tournament")}
                onGoal={recordGoal}
                onUndo={undoGoal}
                onResult={(result) => matchdayEvent && updateMatch(matchdayEvent.id, { result })}
              />
            </section>
          )}

          {tab === "tactics" && (
            <section className="coach-view tactics-view">
              <div className="view-heading compact">
                <div><p className="section-index">SPIELPRINZIPIEN</p><h1>Taktiken.</h1><p>Angriff, Verteidigung und Ecke mit dem aktuellen Spieltagskader visualisieren und präsentieren.</p></div>
              </div>
              <TacticsBoard
                lineupId={nextGame ? eventLineupId(nextGame) : "default"}
                eventTitle={nextGame ? `${nextGame.title} · ${formatDate(nextGame.start, false)}` : "Allgemeine Aufstellung"}
                tactics={state.tactics}
                onSave={saveTactic}
                onCreate={createTactic}
                onRename={renameTactic}
                onDuplicate={duplicateTactic}
                onDelete={deleteTactic}
              />
            </section>
          )}

          {tab === "players" && (
            <section className="coach-view">
              <div className="view-heading compact team-heading"><div><p className="section-index">SPIELERPROFILE</p><h1>Teamkarten.</h1><p>Karte anklicken, um zwischen Profil und Leistungsseite zu wechseln.</p></div><form className="roster-form" onSubmit={addRosterPlayer}><label htmlFor="roster-name">Spieler:in ergänzen</label><div><input id="roster-name" value={newRosterName} onChange={(event) => setNewRosterName(event.target.value)} placeholder="Vorname" maxLength={30} /><button type="submit" disabled={!newRosterName.trim()}>Hinzufügen</button></div></form></div>
              {!profiles.length && <div className="empty-roster"><strong>Noch keine Spieler:innen im Team.</strong><p>Oben einen Vornamen ergänzen oder zuerst Namen in der allgemeinen Aufstellung eintragen.</p></div>}
              {!!profiles.length && <div className="position-filter-bar">
                <div className="position-filters" role="group" aria-label="Teamkarten nach Position filtern">
                  {[{ value: "all", label: "Alle" }, ...positionOptions.map((position) => ({ value: position, label: position })), ...(hasUnassignedPlayers ? [{ value: "unassigned", label: "Ohne Position" }] : [])].map((filter) => (
                    <button key={filter.value} type="button" className={positionFilter === filter.value ? "active" : ""} aria-pressed={positionFilter === filter.value} onClick={() => setPositionFilter(filter.value)}>{filter.label}</button>
                  ))}
                </div>
                <span>{sortedCardRows.length} Spieler</span>
              </div>}
              {!!profiles.length && !sortedCardRows.length && <div className="empty-roster compact"><strong>Keine Spieler für diese Position.</strong><p>Der Filter berücksichtigt Haupt- und Ersatzposition.</p></div>}
              <div className="player-card-grid">
                {sortedCardRows.map(({ player, appearances, goals, assists, participation }) => {
                  const history = state.diagnostics[player.id] ?? [];
                  const appearanceRate = totalMatches ? Math.round((appearances / totalMatches) * 100) : null;
                  return <StaticPlayerCard key={player.id} profile={player} appearanceRate={appearanceRate} goals={goals} assists={assists} participation={participation} bestSeasonStatKeys={seasonStatBestByPlayer[player.id] ?? new Set()} history={history} bestDisciplineKeys={diagnosticBestByPlayer[player.id] ?? new Set()} onEdit={() => setEditingProfile(player)} onDetails={() => setDetailPlayer(player)} />;
                })}
              </div>
            </section>
          )}

          {tab === "stats" && (
            <section className="coach-view">
              <div className="view-heading compact"><div><p className="section-index">SPIELE &amp; ENTWICKLUNG</p><h1>Statistik.</h1><p>Spielwerte werden pro Kalendertermin erfasst und automatisch summiert.</p></div></div>
              <div className="stats-table-wrap"><StatsTable rows={statsRows} totalMatches={totalMatches} /></div>
            </section>
          )}
        </>
      )}

      {editingCalendarEvent && <CalendarEventDialog event={editingCalendarEvent} onClose={() => setEditingCalendarEvent(null)} onSubmit={saveCalendarEvent} />}

      {editingProfile && <ProfileDialog profile={editingProfile} onClose={() => setEditingProfile(null)} onSubmit={saveProfile} />}
      {detailPlayer && <DiagnosticDetailsDialog profile={detailPlayer} history={state.diagnostics[detailPlayer.id] ?? []} bestDisciplineKeys={diagnosticBestByPlayer[detailPlayer.id] ?? new Set()} onClose={() => setDetailPlayer(null)} />}
    </main>
  );
}

function historyLabel(entry: HistoryEntry) {
  const labels: Record<string, string> = {
    roster: "Teamliste", profile: "Spielerprofil", attendance: "Trainingsteilnahme",
    match_meta: "Spielergebnis", match_entry: "Spielstatistik", diagnostic: "Leistungsdiagnostik", tactic: "Taktik",
  };
  const subject = entry.scope === "profile" || entry.scope === "roster" || entry.scope === "diagnostic"
    ? entry.record_key.split(":")[0].replace(/-/g, " ")
    : "";
  return `${labels[entry.scope] ?? "Eintrag"}${subject ? ` · ${subject}` : ""}`;
}

function HistoryPanel({ onRestored }: { onRestored: () => Promise<void> }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/history", { cache: "no-store" });
      const data = await response.json() as { history?: HistoryEntry[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Verlauf konnte nicht geladen werden.");
      setEntries(data.history ?? []);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    setError("");
    if (nextOpen && !loaded) {
      try { await load(); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Verlauf konnte nicht geladen werden."); }
    }
  }

  async function restore(entry: HistoryEntry) {
    if (!window.confirm("Diesen Eintrag auf den unmittelbar vorherigen Stand zurücksetzen?")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/history", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ historyId: entry.id }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Wiederherstellung fehlgeschlagen.");
      await Promise.all([onRestored(), load()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Wiederherstellung fehlgeschlagen.");
    } finally { setBusy(false); }
  }

  return <section className={`history-panel${open ? " open" : ""}`} aria-labelledby="history-title">
    <div className="history-summary">
      <div><p className="section-index" id="history-title">SICHERUNG &amp; VERLAUF</p><p>Änderungen und Backups bei Bedarf öffnen.</p></div>
      <button className="history-toggle" type="button" aria-expanded={open} aria-controls="history-content" onClick={() => void toggle()}>
        {open ? "Verlauf schließen" : "Verlauf öffnen"}<span aria-hidden="true">{open ? "↑" : "↓"}</span>
      </button>
    </div>
    {open && <div className="history-content" id="history-content">
      <div className="history-content-head"><h2>Letzte Änderungen</h2><a className="text-button" href="/api/backup" download>Backup herunterladen ↓</a></div>
      {error && <p className="coach-notice" role="status">{error}</p>}
      {loading ? <p className="history-empty" role="status">Verlauf wird geladen …</p> : !entries.length && !error ? <p className="history-empty">Noch keine Änderungen im neuen Verlauf.</p> : <ol className="history-list">
        {entries.slice(0, 10).map((entry) => <li key={entry.id}><div><strong>{historyLabel(entry)}</strong><time dateTime={entry.changed_at}>{new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date(entry.changed_at))}</time></div><button type="button" disabled={busy} onClick={() => void restore(entry)}>Rückgängig</button></li>)}
      </ol>}
    </div>}
  </section>;
}

function EventCard({ event, active, anchor, onOpen }: { event: CalendarEvent; active?: boolean; anchor?: boolean; onOpen: (event: CalendarEvent, target: "attendance" | "lineup" | "stats") => void }) {
  const hasLineup = event.type === "game" || event.type === "tournament";
  return <article id={anchor ? "next-calendar-event" : undefined} className={`event-card type-${event.type}${active ? " active" : ""}${anchor ? " calendar-next-anchor" : ""}`}><div className="event-card-top"><span>{anchor ? "Nächster Termin" : eventLabel(event.type)}</span><time>{formatDate(event.start)}</time></div><h3>{event.title}</h3><p>{event.location || "Ort noch offen"}</p><div className="event-card-actions">{hasLineup && <button type="button" className="primary-action" onClick={() => onOpen(event, "lineup")}>Kader planen →</button>}<button type="button" onClick={() => onOpen(event, "attendance")}>Teilnahme eintragen →</button></div></article>;
}

function AttendancePanel({ event, profiles, attendance, reasons, onSet, onAll, onEdit }: { event: CalendarEvent; profiles: Profile[]; attendance: Record<string, AttendanceStatus>; reasons: Record<string, AbsenceReason>; onSet: (eventId: string, id: string, status: AttendanceStatus, reason?: AbsenceReason) => void; onAll: (eventId: string) => void; onEdit: () => void }) {
  const [reasonPlayer, setReasonPlayer] = useState<string | null>(null);
  const absenceReasons: AbsenceReason[] = ["Krankheit", "Verletzung", "Privat", "Schul-Event"];
  const statuses = (event.type === "game" || event.type === "tournament" ? ["present", "excused", "absent", "not_selected"] : ["present", "excused", "absent"]) as AttendanceStatus[];
  const labels: Record<AttendanceStatus, string> = { present: "Anwesend", excused: "Entschuldigt", absent: "Abwesend", not_selected: "Nicht im Kader" };
  return <><div className="detail-head"><div><p className="section-index">TEILNAHME</p><h2>{event.title}</h2><p>{formatDate(event.start)}</p></div><div className="detail-actions"><button className="text-button" type="button" onClick={onEdit}>Termin bearbeiten</button><button className="text-button" onClick={() => onAll(event.id)}>Alle anwesend</button></div></div><div className="attendance-list">{profiles.map((player) => <div className="attendance-row" key={player.id}><div><Image src={`/api/player-image?name=${encodeURIComponent(player.firstName)}`} alt="" width={38} height={38} unoptimized /><strong>{player.firstName}</strong>{attendance[player.id] === "excused" && reasons[player.id] && <small className="attendance-reason">{reasons[player.id]}</small>}</div><div className="attendance-options">{statuses.map((status) => <button key={status} className={`${status}${attendance[player.id] === status ? " selected" : ""}`} onClick={() => status === "excused" ? setReasonPlayer(player.id) : onSet(event.id, player.id, status)} aria-label={`${player.firstName}: ${labels[status].toLocaleLowerCase("de-DE")}`}><span />{labels[status]}</button>)}{reasonPlayer === player.id && <select className="attendance-reason-select" aria-label={`${player.firstName}: Grund auswählen`} value={reasons[player.id] ?? ""} onChange={(event) => { const reason = event.target.value as AbsenceReason; if (reason) { onSet(event.currentTarget.name || "", player.id, "excused", reason); setReasonPlayer(null); } }} name={event.id}><option value="">Grund wählen</option>{absenceReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select>}</div></div>)}</div></>;
}

function CalendarEventDialog({ event, onClose, onSubmit }: { event: CalendarEvent; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  useEffect(() => {
    const onKeyDown = (keyEvent: KeyboardEvent) => { if (keyEvent.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(mouseEvent) => { if (mouseEvent.target === mouseEvent.currentTarget) onClose(); }}><div className="coach-modal calendar-event-dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-event-title"><button className="close-dialog" type="button" aria-label="Schließen" onClick={onClose}>×</button><p className="section-index">KALENDER · COACHING TOOL</p><h2 id="calendar-event-title">Termin bearbeiten</h2><p className="calendar-edit-note">Änderungen gelten im Coaching Tool. Der öffentliche Google-Kalender bleibt unverändert.</p><form onSubmit={onSubmit}><label>Titel<input name="title" defaultValue={event.title} maxLength={120} required /></label><div className="form-grid"><label>Beginn<input name="start" type="datetime-local" defaultValue={localDateTimeValue(event.start)} required /></label><label>Ende<input name="end" type="datetime-local" defaultValue={localDateTimeValue(event.end)} required /></label></div><div className="form-grid"><label>Art<select name="type" defaultValue={event.type}><option value="training">Training</option><option value="game">Spiel</option><option value="tournament">Turnier</option><option value="other">Termin</option></select></label><label>Ort<input name="location" defaultValue={event.location} maxLength={160} /></label></div><label>Notiz<textarea name="description" defaultValue={event.description} maxLength={1000} /></label><div className="modal-actions"><button className="text-button" type="button" onClick={onClose}>Abbrechen</button><button className="primary-button" type="submit">Termin speichern</button></div></form></div></div>;
}

function seasonStatus(key: SeasonStatKey, value: number | null): "good" | "average" | "critical" | "neutral" {
  if (value === null) return "neutral";
  if (key === "training") return value >= 80 ? "good" : value >= 60 ? "average" : "critical";
  return value > 0 ? "good" : "neutral";
}

function SeasonMetric({ label, value, keyName, best, progress }: { label: string; value: string | number; keyName: SeasonStatKey; best: boolean; progress?: number | null }) {
  const numeric = typeof value === "number" ? value : value === "—" ? null : Number.parseFloat(value);
  return <div className="season-metric"><div className="season-metric-value"><span className={`diagnostic-dot ${seasonStatus(keyName, Number.isFinite(numeric) ? numeric : null)}`} aria-hidden="true" /><strong>{value}</strong></div><span>{label}</span></div>;
}

function PlayerCard({ profile, flipped, appearances, appearanceRate, goals, assists, participation, bestSeasonStatKeys, history, bestDisciplineKeys, onFlip, onEdit, onDetails }: { profile: Profile; flipped: boolean; appearances: number; appearanceRate: number | null; goals: number; assists: number; participation: number | null; bestSeasonStatKeys: Set<SeasonStatKey>; history: Diagnostic[]; bestDisciplineKeys: Set<DiagnosticDisciplineKey>; onFlip: () => void; onEdit: () => void; onDetails: () => void }) {
  return <article className={`fc-card${flipped ? " flipped" : ""}`}><div className="fc-card-inner"><div className="fc-face fc-front"><button type="button" className="card-flip-area" onClick={onFlip} aria-label={`${profile.firstName}: Leistungsseite anzeigen`}><div className="shirt-number">{profile.shirtNumber || "—"}</div><Image src={`/api/player-image?name=${encodeURIComponent(profile.firstName)}`} alt={profile.firstName} width={260} height={260} unoptimized /><div className="fc-name">{profile.firstName}</div><div className="fc-positions"><strong>{profile.primaryPosition || "POS"}</strong><span>{profile.secondaryPosition || "—"}</span></div><div className="fc-foot">Starker Fuß <strong>{{ left: "Links", right: "Rechts", both: "Beide", "": "—" }[profile.strongFoot]}</strong></div><p>{profile.personality || "Spielerpersönlichkeit noch nicht ergänzt."}</p></button><button type="button" className="card-edit" onClick={(event) => { event.stopPropagation(); onEdit(); }}>Profil bearbeiten</button></div><div className="fc-face fc-back"><button type="button" className="card-flip-area" onClick={onFlip} aria-label={`${profile.firstName}: Profilseite anzeigen`}><p className="section-index">SAISONWERTE</p><h3>{profile.firstName}</h3><div className="fc-metrics"><SeasonMetric label="Einsätze" value={appearanceRate === null ? "—" : `${appearanceRate}%`} keyName="appearances" best={bestSeasonStatKeys.has("appearances")} progress={appearanceRate} /><SeasonMetric label="Training" value={participation === null ? "—" : `${participation}%`} keyName="training" best={bestSeasonStatKeys.has("training")} progress={participation} /><SeasonMetric label="Tore" value={goals} keyName="goals" best={bestSeasonStatKeys.has("goals")} /><SeasonMetric label="Assists" value={assists} keyName="assists" best={bestSeasonStatKeys.has("assists")} /></div><DiagnosticOverview latest={history[0]} bestDisciplineKeys={bestDisciplineKeys} /></button><button type="button" className="card-edit diagnostic-details-button" onClick={(event) => { event.stopPropagation(); onDetails(); }}>Details ansehen</button></div></div></article>;
}

function StaticPlayerCard({ profile, appearanceRate, goals, assists, participation, bestSeasonStatKeys, history, bestDisciplineKeys, onEdit, onDetails }: { profile: Profile; appearanceRate: number | null; goals: number; assists: number; participation: number | null; bestSeasonStatKeys: Set<SeasonStatKey>; history: Diagnostic[]; bestDisciplineKeys: Set<DiagnosticDisciplineKey>; onEdit: () => void; onDetails: () => void }) {
  return <article className="fc-card static-card"><div className="fc-card-inner"><section className="fc-face static-face"><div className="static-card-content"><div className="shirt-number">{profile.shirtNumber || "—"}</div><Image src={`/api/player-image?name=${encodeURIComponent(profile.firstName)}&v=20260723`} alt={profile.firstName} width={260} height={260} unoptimized /><div className="fc-name">{profile.firstName}</div><div className="fc-positions"><strong>{profile.primaryPosition || "POS"}</strong><span>{profile.secondaryPosition || "—"}</span></div><div className="fc-foot">Starker Fuß <strong>{{ left: "Links", right: "Rechts", both: "Beide", "": "—" }[profile.strongFoot]}</strong></div><p className="section-index">SAISONWERTE</p><div className="fc-metrics"><SeasonMetric label="Einsätze" value={appearanceRate === null ? "—" : `${appearanceRate}%`} keyName="appearances" best={bestSeasonStatKeys.has("appearances")} progress={appearanceRate} /><SeasonMetric label="Training" value={participation === null ? "—" : `${participation}%`} keyName="training" best={bestSeasonStatKeys.has("training")} progress={participation} /><SeasonMetric label="Tore" value={goals} keyName="goals" best={bestSeasonStatKeys.has("goals")} /><SeasonMetric label="Assists" value={assists} keyName="assists" best={bestSeasonStatKeys.has("assists")} /></div><DiagnosticOverview latest={history[0]} previous={history[1]} bestDisciplineKeys={bestDisciplineKeys} compact /></div><div className="static-card-actions"><button type="button" className="card-edit" onClick={onEdit}>Profil</button><button type="button" className="card-edit diagnostic-details-button" onClick={onDetails}>Leistung</button></div></section></div></article>;
}

type DiagnosticStatus = "good" | "mid-good" | "average" | "below" | "critical" | "bad" | "neutral";

function diagnosticStatus(metric?: DiagnosticMetric | null): DiagnosticStatus {
  const category = String(metric?.category ?? "").trim().toUpperCase();
  if (/^A(?:\/B)?$/.test(category)) return "good";
  if (category === "B") return "average";
  if (category === "B/C") return "average";
  if (category === "C") return "critical";
  const rating = `${metric?.rating ?? ""}`.toLowerCase();
  if (/ausgezeichnet|sehr gut|excellent|top/.test(rating)) return "good";
  if (/^gut$/.test(rating)) return "mid-good";
  if (/befriedigend/.test(rating)) return "below";
  if (/durchschnittlich|mittel/.test(rating)) return "average";
  if (/ausreichend/.test(rating)) return "critical";
  if (/mangelhaft|unterdurchschnitt|schwach|schlecht|ungenügend/.test(rating)) return "bad";
  return "neutral";
}

function metricFor(diagnostic: Diagnostic | undefined, key: DiagnosticDisciplineKey): DiagnosticMetric | null {
  if (!diagnostic?.metrics) return null;
  if (key === "shuttleRun") return { attempts: [], best: diagnostic.metrics.shuttleRun.level, percentile: null, category: null, rating: diagnostic.metrics.shuttleRun.rating };
  if (key === "jump") return { attempts: diagnostic.metrics.jump.attempts, best: diagnostic.metrics.jump.best, percentile: null, category: null, rating: diagnostic.metrics.jump.rating };
  return diagnostic.metrics[key];
}

function hasMetric(metric: DiagnosticMetric | null) { return Boolean(metric && (metric.best !== null || metric.attempts.some((value) => value !== null) || metric.rating)); }

function Trend({ current, previous, lowerIsBetter, unit }: { current: number | null; previous: number | null; lowerIsBetter: boolean; unit?: string }) {
  if (current === null || previous === null) return null;
  const delta = current - previous;
  const threshold = unit === "s" ? .01 : .005;
  const direction = Math.abs(delta) <= threshold ? "neutral" : (lowerIsBetter ? delta < 0 : delta > 0) ? "positive" : "negative";
  const arrow = direction === "positive" ? "↑" : direction === "negative" ? "↓" : "→";
  const amount = Math.abs(delta).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return <span className={`diagnostic-trend ${direction}`} title={direction === "positive" ? "Besser als U11" : direction === "negative" ? "Schwächer als U11" : "Unverändert gegenüber U11"}>{arrow} {amount}{unit ? ` ${unit}` : ""}</span>;
}

function DiagnosticOverview({ latest, previous, bestDisciplineKeys, compact = false }: { latest?: Diagnostic; previous?: Diagnostic; bestDisciplineKeys: Set<DiagnosticDisciplineKey>; compact?: boolean }) {
  const rows = ([
    ["sprint10", "10 m Sprint", "10 m", true, "s"], ["sprint20", "20 m Sprint", "20 m", true, "s"],
    ["agility", "Laufgewandtheit", "Agility", true, "s"], ["dribbling", "Dribbling", "Dribbling", true, "s"],
    ["shuttleRun", "Shuttle Run", "Shuttle", false, ""], ["jump", "Standweitsprung", "Sprung", false, "m"],
  ] as const).map(([key, label, shortLabel, lowerIsBetter, unit]) => ({ key, label, shortLabel, lowerIsBetter, unit, metric: metricFor(latest, key), previous: metricFor(previous, key) })).filter((row) => hasMetric(row.metric));
  return <div className={`diagnostic-overview${compact ? " diagnostic-overview-compact" : ""}`}><strong>Leistungsdiagnostik{latest?.ageGroup ? ` · ${latest.ageGroup}` : ""}</strong>{rows.length ? rows.map((row) => <div key={row.key}><span className={`diagnostic-dot ${diagnosticStatus(row.metric)}`} aria-label={`${row.label}: ${diagnosticStatus(row.metric)}`} /><span>{compact ? row.shortLabel : row.label}{bestDisciplineKeys.has(row.key) && <span className="diagnostic-crown" title="Bester Wert im Team" aria-label="Bester Wert im Team">👑</span>}</span>{!compact && <Trend current={row.metric?.best ?? null} previous={row.previous?.best ?? null} lowerIsBetter={row.lowerIsBetter} unit={row.unit} />}</div>) : <p>Noch keine Messung erfasst.</p>}</div>;
}

function DiagnosticMetricRow({ label, metric, unit, previous, lowerIsBetter, best }: { label: string; metric: DiagnosticMetric; unit: string; previous: number | null; lowerIsBetter: boolean; best?: boolean }) {
  return <div><span className="diagnostic-detail-label"><span className={`diagnostic-dot ${diagnosticStatus(metric)}`} /><strong>{label}{best && <span className="diagnostic-crown" title="Bester Wert im Team">👑</span>}</strong><small>{metric.attempts.length ? `${metric.attempts.map((attempt, index) => `V${index + 1}: ${attempt ?? "—"}`).join(" · ")} · ` : ""}{metric.percentile === null ? "" : `PR ${Math.round(metric.percentile * 100)}% · `}{metric.category ?? ""}</small></span><b>{metric.best ?? "—"}{metric.best !== null && unit ? ` ${unit}` : ""}<small>{metric.rating ?? ""}</small><Trend current={metric.best} previous={previous} lowerIsBetter={lowerIsBetter} unit={unit} /></b></div>;
}

function DiagnosticDetailsDialog({ profile, history, bestDisciplineKeys, onClose }: { profile: Profile; history: Diagnostic[]; bestDisciplineKeys: Set<DiagnosticDisciplineKey>; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="diagnostic-details-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="coach-modal diagnostic-details-dialog"><button className="close-dialog" type="button" aria-label="Dialog schließen" onClick={onClose}>×</button><p className="section-index">LEISTUNGSDIAGNOSTIK</p><h2 id="diagnostic-details-title">{profile.firstName}</h2>{history.length ? <div className="diagnostic-detail-list">{history.map((diagnostic, index) => <DiagnosticDetailRecord key={diagnostic.id} diagnostic={diagnostic} previous={history[index + 1]} bestDisciplineKeys={index === 0 ? bestDisciplineKeys : new Set()} />)}</div> : <p className="history-empty">Noch keine Leistungsdiagnostik erfasst.</p>}</section></div>;
}

function DiagnosticDetailRecord({ diagnostic, previous, bestDisciplineKeys }: { diagnostic: Diagnostic; previous?: Diagnostic; bestDisciplineKeys: Set<DiagnosticDisciplineKey> }) {
  const rows = ([
    ["sprint10", "10 m Sprint", "s", true], ["sprint20", "20 m Sprint", "s", true], ["agility", "Laufgewandtheit", "s", true], ["dribbling", "Dribbling", "s", true], ["shuttleRun", "Shuttle Run", "", false], ["jump", "Standweitsprung", "m", false],
  ] as const).map(([key, label, unit, lowerIsBetter]) => ({ key, label, unit, lowerIsBetter, metric: metricFor(diagnostic, key), previous: metricFor(previous, key) })).filter((row) => hasMetric(row.metric));
  return <section className="diagnostic-detail-record"><div className="diagnostic-detail-record-head"><strong>{diagnostic.ageGroup || "Leistungsdiagnostik"}</strong><time>{diagnostic.date}</time></div>{diagnostic.metrics ? rows.map((row) => <DiagnosticMetricRow key={row.key} label={row.label} metric={row.metric!} unit={row.unit} previous={row.previous?.best ?? null} lowerIsBetter={row.lowerIsBetter} best={bestDisciplineKeys.has(row.key)} />) : <>{([['5 m Sprint', diagnostic.sprint5, previous?.sprint5, 's'], ['10 m Sprint', diagnostic.sprint10, previous?.sprint10, 's'], ['20 m Sprint', diagnostic.sprint20, previous?.sprint20, 's'], ['Agility', diagnostic.agility, previous?.agility, 's'], ['Ausdauer', diagnostic.endurance, previous?.endurance, ''], ['Sprungkraft', diagnostic.jump, previous?.jump, 'cm']] as const).map(([label, value, before, unit]) => <div key={label}><span><strong>{label}</strong></span><b>{value ?? "—"}{value !== null ? ` ${unit}` : ""}</b><Trend current={value} previous={before ?? null} lowerIsBetter={!['Ausdauer', 'Sprungkraft'].includes(label)} unit={unit} /></div>)}</>}</section>;
}

function StatsTable({ rows, totalMatches }: { rows: Array<{ player: Profile; appearances: number; goals: number; assists: number; participation: number | null; appearanceEvents: StatEventDetail[]; goalEvents: StatEventDetail[]; assistEvents: StatEventDetail[]; trainingEvents: StatEventDetail[] }>; totalMatches: number }) {
  const [sortKey, setSortKey] = useState<StatSortKey>("player");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [detail, setDetail] = useState<{ player: Profile; label: string; value: string; events: StatEventDetail[] } | null>(null);
  const bestGoals = Math.max(0, ...rows.map((row) => row.goals));
  const bestAssists = Math.max(0, ...rows.map((row) => row.assists));
  const rateStatus = (value: number | null) => value === null ? "neutral" : value >= 80 ? "good" : value >= 60 ? "average" : "critical";
  const changeSort = (key: StatSortKey) => {
    if (key === sortKey) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDirection(key === "player" ? "asc" : "desc"); }
  };
  const sortedRows = [...rows].sort((left, right) => {
    const leftValue = sortKey === "player" ? left.player.firstName : sortKey === "training" ? left.participation ?? -1 : left[sortKey];
    const rightValue = sortKey === "player" ? right.player.firstName : sortKey === "training" ? right.participation ?? -1 : right[sortKey];
    const result = typeof leftValue === "string" && typeof rightValue === "string" ? leftValue.localeCompare(rightValue, "de") : Number(leftValue) - Number(rightValue);
    return result === 0 ? left.player.firstName.localeCompare(right.player.firstName, "de") : sortDirection === "asc" ? result : -result;
  });
  const header = (key: StatSortKey, label: string) => <th aria-sort={sortKey === key ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" className={`stats-sort-button${sortKey === key ? " active" : ""}`} onClick={() => changeSort(key)}>{label}<span aria-hidden="true">{sortKey === key ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</span></button></th>;
  return <><table className="stats-table"><thead><tr>{header("player", "Spieler:in")}{header("appearances", "Einsätze")}{header("goals", "Tore")}{header("assists", "Assists")}{header("training", "Training")}</tr></thead><tbody>{sortedRows.map((row) => {
    const appearanceRate = totalMatches ? Math.round((row.appearances / totalMatches) * 100) : null;
    const trainingStatus = rateStatus(row.participation);
    const appearanceStatus = rateStatus(appearanceRate);
    return <tr key={row.player.id}><td><Image src={`/api/player-image?name=${encodeURIComponent(row.player.firstName)}`} alt="" width={36} height={36} unoptimized /><strong>{row.player.firstName}</strong></td><td><button type="button" className={`stat-value stats-value-button stat-${appearanceStatus}`} onClick={() => setDetail({ player: row.player, label: "Einsätze", value: appearanceRate === null ? "—" : `${appearanceRate}%`, events: row.appearanceEvents })} title={appearanceRate === null ? "Noch keine Spieltage erfasst" : `${appearanceRate}% Einsatzquote`}><i aria-hidden="true" />{appearanceRate === null ? "—" : `${appearanceRate}%`}</button></td><td><button type="button" className="stat-value stats-value-button" onClick={() => setDetail({ player: row.player, label: "Tore", value: String(row.goals), events: row.goalEvents })}>{row.goals}{bestGoals > 0 && row.goals === bestGoals && <span className="stat-crown" title="Beste Torschützin / bester Torschütze" aria-label="Beste Torschützin / bester Torschütze">👑</span>}</button></td><td><button type="button" className="stat-value stats-value-button" onClick={() => setDetail({ player: row.player, label: "Assists", value: String(row.assists), events: row.assistEvents })}>{row.assists}{bestAssists > 0 && row.assists === bestAssists && <span className="stat-crown" title="Beste Assistgeberin / bester Assistgeber" aria-label="Beste Assistgeberin / bester Assistgeber">👑</span>}</button></td><td><button type="button" className={`stat-value stats-value-button stat-${trainingStatus}`} onClick={() => setDetail({ player: row.player, label: "Training", value: row.participation === null ? "—" : `${row.participation}%`, events: row.trainingEvents })} title={row.participation === null ? "Noch keine Trainings erfasst" : `${row.participation}% Trainingsteilnahme`}><i aria-hidden="true" />{row.participation === null ? "—" : `${row.participation}%`}</button></td></tr>;
  })}</tbody></table>{detail && <StatDetailsDialog {...detail} onClose={() => setDetail(null)} />}</>;
}

function StatDetailsDialog({ player, label, value, events, onClose }: { player: Profile; label: string; value: string; events: StatEventDetail[]; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="stat-details-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="coach-modal stat-details-dialog"><button className="close-dialog" type="button" aria-label="Dialog schließen" onClick={onClose}>×</button><p className="section-index">STATISTIK · DETAILS</p><h2 id="stat-details-title">{player.firstName} · {label}</h2><strong className="stat-details-value">{value}</strong>{events.length ? <ul>{events.map((event) => <li key={`${event.eventId}-${event.detail}`}><time>{event.date}</time><div><strong>{event.title}</strong><span>{event.detail}</span></div></li>)}</ul> : <p className="history-empty">Noch keine Einträge vorhanden.</p>}<div className="modal-actions"><button className="primary-button" type="button" onClick={onClose}>Schließen</button></div></section></div>;
}

function MatchdayPanel({ event, events, lineup, profiles, data, onChooseEvent, onGoal, onUndo, onResult }: { event: CalendarEvent | null; events: CalendarEvent[]; lineup: MatchdayLineupPlayer[]; profiles: Profile[]; data: MatchData | null; onChooseEvent: (event: CalendarEvent) => void; onGoal: (eventId: string, scorerId: string, assistId: string | null) => Promise<boolean>; onUndo: (eventId: string, goal: GoalEvent) => Promise<boolean>; onResult: (result: string) => void }) {
  const [step, setStep] = useState<"start" | "scorer" | "assist">("start");
  const [scorerId, setScorerId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    document.body.classList.toggle("matchday-focus", focusMode);
    return () => document.body.classList.remove("matchday-focus");
  }, [focusMode]);
  const players = lineup;
  const nameFor = (id: string) => profiles.find((player) => player.id === id)?.firstName ?? "Spieler:in";
  async function chooseScorer(id: string) { setScorerId(id); setStep("assist"); }
  async function completeGoal(assistId: string | null) {
    if (!event || !scorerId || saving) return;
    setSaving(true);
    const saved = await onGoal(event.id, scorerId, assistId);
    setSaving(false);
    if (saved) { setScorerId(null); setStep("start"); }
  }
  async function undo(goal: GoalEvent) {
    if (!event || saving) return;
    setSaving(true);
    await onUndo(event.id, goal);
    setSaving(false);
  }
  const goalEvents = [...(data?.goalEvents ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return <><div className="matchday-heading"><div><p className="section-index">LIVE-ERFASSUNG</p><h1>Spieltag.</h1><p>{event ? `${event.title} · ${formatDate(event.start, false)}` : "Spiel auswählen und die Aufstellung laden."}</p></div><div className="matchday-heading-actions"><label>Spiel<select value={event?.id ?? ""} onChange={(change) => { const next = events.find((item) => item.id === change.target.value); if (next) onChooseEvent(next); }}><option value="">Spiel wählen</option>{events.map((item) => <option key={item.id} value={item.id}>{formatDate(item.start, false)} · {item.title}</option>)}</select></label><button type="button" className="matchday-focus-button" onClick={() => setFocusMode((active) => !active)}>{focusMode ? "Fokus schließen" : "Fokusmodus"}</button></div></div>{!event ? <div className="matchday-empty"><strong>Kein Spiel ausgewählt.</strong><p>Über Kalender oder Auswahl oben den Spieltag öffnen.</p></div> : !players.length ? <div className="matchday-empty"><strong>Aufstellung noch nicht vorhanden.</strong><p>Bitte zuerst den Kader für dieses Spiel in der Aufstellung festlegen.</p></div> : <div className="matchday-layout"><section className="matchday-capture"><div className={`matchday-step ${step}`}><p className="section-index">{step === "start" ? "TORE UND ASSISTS EINGEBEN" : step === "scorer" ? "TOR ERFASSEN" : "ASSIST ERFASSEN"}</p>{step !== "start" && <h2>{step === "scorer" ? "Torschütze wählen" : "Assist wählen"}</h2>}{step === "start" ? <><button className="matchday-start" type="button" onClick={() => setStep("scorer")}>TOR ERFASSEN</button><label className="matchday-result">Ergebnis<input defaultValue={data?.result ?? ""} onBlur={(input) => onResult(input.target.value.trim().slice(0, 20))} placeholder="z. B. 3:1" /></label></> : <><div className="matchday-player-grid">{players.filter((item) => step !== "assist" || item.player.id !== scorerId).map((item) => <button className="matchday-player-button" type="button" disabled={saving} key={item.player.id} onClick={() => step === "scorer" ? chooseScorer(item.player.id) : completeGoal(item.player.id)}><Image src={`/api/player-image?name=${encodeURIComponent(item.player.firstName)}&v=20260723`} alt="" width={96} height={96} unoptimized /><span>{item.player.firstName}</span><small>{item.position}</small></button>)}</div>{step === "assist" && <div className="matchday-actions"><button className="matchday-no-assist" type="button" disabled={saving} onClick={() => completeGoal(null)}>OHNE ASSIST</button><button className="text-button" type="button" disabled={saving} onClick={() => { setScorerId(null); setStep("scorer"); }}>Zurück</button></div>}</>}</div></section><aside className="matchday-history"><p className="section-index">ERFASSTE TORE</p><h2>{goalEvents.length}</h2>{goalEvents.length ? <div>{goalEvents.map((goal) => <article key={goal.id}><p><strong>{nameFor(goal.scorerId)}</strong><span>{goal.assistId ? `Assist: ${nameFor(goal.assistId)}` : "ohne Assist"}</span></p><button type="button" disabled={saving} onClick={() => undo(goal)}>Rückgängig</button></article>)}</div> : <p>Noch kein Tor erfasst.</p>}</aside></div>}</>;
}

function ProfileDialog({ profile, onClose, onSubmit }: { profile: Profile; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={dialogRef} className="modal-backdrop" aria-labelledby="profile-dialog-title" onCancel={(e) => { e.preventDefault(); onClose(); }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><form className="coach-modal" onSubmit={onSubmit}><button className="close-dialog" type="button" aria-label="Dialog schließen" onClick={onClose}>×</button><p className="section-index">SPIELERPROFIL</p><h2 id="profile-dialog-title">{profile.firstName}</h2><div className="form-grid"><label>Trikotnummer<input autoFocus name="shirtNumber" type="number" min="0" max="999" defaultValue={profile.shirtNumber} /></label><label>Hauptposition<select name="primaryPosition" defaultValue={profile.primaryPosition}><option value="">Bitte wählen</option>{positionOptions.map((position) => <option key={position}>{position}</option>)}</select></label><label>Ersatzposition<select name="secondaryPosition" defaultValue={profile.secondaryPosition}><option value="">Keine</option>{positionOptions.map((position) => <option key={position}>{position}</option>)}</select></label><label>Starker Fuß<select name="strongFoot" defaultValue={profile.strongFoot}><option value="">Bitte wählen</option><option value="left">Links</option><option value="right">Rechts</option><option value="both">Beide</option></select></label><label className="wide">Spielerpersönlichkeit<textarea name="personality" defaultValue={profile.personality} rows={4} placeholder="Stärken, Rolle im Team, Coaching-Hinweise …" /></label></div><button className="primary-button" type="submit">Profil speichern</button></form></dialog>;
}
