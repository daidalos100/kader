"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import SquadPlanner from "./SquadPlanner";
import TacticsBoard, { CustomTactic, TacticEntry, TacticLayout, TacticTemplate } from "./TacticsBoard";
import type { CalendarEvent } from "../lib/calendar";

type Tab = "overview" | "calendar" | "lineup" | "tactics" | "players" | "stats";
type AttendanceStatus = "present" | "excused" | "absent";
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
type MatchData = { result: string; entries: Record<string, MatchEntry> };
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
type CoachingState = {
  roster: string[];
  profiles: Record<string, Partial<Profile>>;
  attendance: Record<string, Record<string, AttendanceStatus>>;
  matches: Record<string, MatchData>;
  diagnostics: Record<string, Diagnostic[]>;
  tactics: Record<string, TacticEntry>;
};
type SaveOperation = { scope: string; key: string; value: unknown; expectedRevision: number };
type HistoryEntry = { id: number; scope: string; record_key: string; revision: number; changed_at: string; changed_by: string };

const positionOptions = ["TW", "IV", "LV", "RV", "ZDM", "ZM", "LF", "RF", "ST"];
const emptyState: CoachingState = { roster: [], profiles: {}, attendance: {}, matches: {}, diagnostics: {}, tactics: {} };
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
  return {
    roster: Array.isArray(state.roster) && state.roster.length ? state.roster : fallbackRoster,
    profiles: state.profiles ?? {}, attendance: state.attendance ?? {}, matches: state.matches ?? {},
    diagnostics: state.diagnostics ?? {}, tactics: normalizeTactics(state.tactics),
  };
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

function numberValue(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

export default function CoachingTool() {
  const [tab, setTab] = useState<Tab>("overview");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [state, setState] = useState<CoachingState>(emptyState);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [diagnosticPlayer, setDiagnosticPlayer] = useState<Profile | null>(null);
  const [detailPlayer, setDetailPlayer] = useState<Profile | null>(null);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [notice, setNotice] = useState("");
  const [newRosterName, setNewRosterName] = useState("");
  const [positionFilter, setPositionFilter] = useState("all");
  const [referenceTime] = useState(() => Date.now());

  const profiles = useMemo(
    () => state.roster.map((name) => profileFor(name, state.profiles[playerId(name)])),
    [state.profiles, state.roster],
  );
  const upcoming = useMemo(() => events.filter((event) => new Date(event.end).getTime() >= referenceTime).slice(0, 40), [events, referenceTime]);
  const nextEvents = upcoming.slice(0, 4);
  const nextGame = upcoming.find((event) => event.type === "game" || event.type === "tournament");

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
        const data = await response.json() as { lineup?: Record<string, Array<{ firstName?: string }>> };
        return [...new Set(Object.values(data.lineup ?? {}).flat().map((player) => player.firstName?.trim()).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, "de"));
      }),
    ])
      .then(([calendarEvents, coaching, lineupNames]) => {
        if (cancelled) return;
        setEvents(calendarEvents);
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

  function openEvent(event: CalendarEvent, target: "attendance" | "lineup" | "stats") {
    setSelectedEvent(event);
    if (target === "lineup") setTab("lineup");
    else if (target === "stats") setTab("stats");
    else setTab("calendar");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setAttendance(eventId: string, id: string, status: AttendanceStatus) {
    void save({
      ...state,
      attendance: { ...state.attendance, [eventId]: { ...(state.attendance[eventId] ?? {}), [id]: status } },
    }, [operation("attendance", `${eventId}:${id}`, status)]);
  }

  function setAllPresent(eventId: string) {
    const nextAttendance = Object.fromEntries(profiles.map((player) => [player.id, "present"])) as Record<string, AttendanceStatus>;
    void save({
      ...state,
      attendance: { ...state.attendance, [eventId]: nextAttendance },
    }, profiles.map((player) => operation("attendance", `${eventId}:${player.id}`, "present")));
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

  function updateMatchEntry(eventId: string, id: string, patch: Partial<MatchEntry>) {
    const current = state.matches[eventId] ?? { result: "", entries: {} };
    const entry = current.entries[id] ?? { appearance: false, goals: 0, assists: 0 };
    const nextEntry = { ...entry, ...patch };
    void save(
      { ...state, matches: { ...state.matches, [eventId]: { ...current, entries: { ...current.entries, [id]: nextEntry } } } },
      [operation("match_entry", `${eventId}:${id}`, nextEntry)],
    );
  }

  function addDiagnostic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!diagnosticPlayer) return;
    const form = new FormData(event.currentTarget);
    const diagnostic: Diagnostic = {
      id: crypto.randomUUID(), date: String(form.get("date") || new Date().toISOString().slice(0, 10)),
      sprint5: numberValue(form.get("sprint5")), sprint10: numberValue(form.get("sprint10")),
      sprint20: numberValue(form.get("sprint20")), agility: numberValue(form.get("agility")),
      endurance: numberValue(form.get("endurance")), jump: numberValue(form.get("jump")),
    };
    const history = [...(state.diagnostics[diagnosticPlayer.id] ?? []), diagnostic].sort((a, b) => b.date.localeCompare(a.date));
    setDiagnosticPlayer(null);
    void save(
      { ...state, diagnostics: { ...state.diagnostics, [diagnosticPlayer.id]: history } },
      [operation("diagnostic", `${diagnosticPlayer.id}:${diagnostic.id}`, diagnostic)],
    );
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

  const statsRows = profiles.map((player) => {
    let appearances = 0; let goals = 0; let assists = 0; let present = 0; let recorded = 0;
    Object.values(state.matches).forEach((match) => {
      const entry = match.entries[player.id];
      if (entry?.appearance) appearances += 1;
      goals += entry?.goals ?? 0; assists += entry?.assists ?? 0;
    });
    Object.values(state.attendance).forEach((attendance) => {
      if (attendance[player.id]) recorded += 1;
      if (attendance[player.id] === "present") present += 1;
    });
    return { player, appearances, goals, assists, participation: recorded ? Math.round((present / recorded) * 100) : null };
  });
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
          {(["overview", "calendar", "lineup", "tactics", "players", "stats"] as Tab[]).map((item) => (
            <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
              {{ overview: "Übersicht", calendar: "Kalender", lineup: "Aufstellung", tactics: "Taktiken", players: "Team", stats: "Statistik" }[item]}
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
                  {nextGame ? <><span className="event-date">{formatDate(nextGame.start)}</span><h2>{nextGame.title}</h2><p>{nextGame.location || "Ort noch offen"}</p><div className="card-actions"><button onClick={() => openEvent(nextGame, "lineup")}>Kader planen</button><button className="secondary" onClick={() => openEvent(nextGame, "stats")}>Statistik</button></div></> : <p>Aktuell ist kein Spiel eingetragen.</p>}
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
                <div className="calendar-list">
                  {upcoming.map((event) => <EventCard key={event.id} event={event} active={selectedEvent?.id === event.id} onOpen={openEvent} />)}
                </div>
                <aside className="event-detail">
                  {selectedEvent ? selectedEvent.type === "training" ? (
                    <AttendancePanel event={selectedEvent} profiles={profiles} attendance={state.attendance[selectedEvent.id] ?? {}} onSet={setAttendance} onAll={setAllPresent} />
                  ) : (
                    <><p className="section-index">{eventLabel(selectedEvent.type)}</p><h2>{selectedEvent.title}</h2><p>{formatDate(selectedEvent.start)}</p><p>{selectedEvent.location}</p><div className="card-actions"><button onClick={() => openEvent(selectedEvent, "lineup")}>Kader planen</button><button className="secondary" onClick={() => openEvent(selectedEvent, "stats")}>Statistik erfassen</button></div></>
                  ) : <div className="empty-detail"><span>←</span><p>Termin auswählen, um Anwesenheit, Kader oder Statistik zu bearbeiten.</p></div>}
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
                  return <PlayerCard key={player.id} profile={player} flipped={Boolean(flipped[player.id])} appearances={appearances} goals={goals} assists={assists} participation={participation} history={history} bestDisciplineKeys={diagnosticBestByPlayer[player.id] ?? new Set()} onFlip={() => setFlipped((current) => ({ ...current, [player.id]: !current[player.id] }))} onEdit={() => setEditingProfile(player)} onDetails={() => setDetailPlayer(player)} />;
                })}
              </div>
            </section>
          )}

          {tab === "stats" && (
            <section className="coach-view">
              <div className="view-heading compact"><div><p className="section-index">SPIELE &amp; ENTWICKLUNG</p><h1>Statistik.</h1><p>Spielwerte werden pro Kalendertermin erfasst und automatisch summiert.</p></div></div>
              <div className="stats-layout">
                <div className="stats-table-wrap"><StatsTable rows={statsRows} /></div>
                <aside className="match-editor">
                  <label>Spiel auswählen<select value={selectedEvent?.id ?? ""} onChange={(event) => setSelectedEvent(events.find((item) => item.id === event.target.value) ?? null)}><option value="">Bitte wählen</option>{events.filter((item) => item.type === "game" || item.type === "tournament").map((item) => <option key={item.id} value={item.id}>{formatDate(item.start, false)} · {item.title}</option>)}</select></label>
                  {selectedEvent && <MatchEditor key={selectedEvent.id} event={selectedEvent} profiles={profiles} data={state.matches[selectedEvent.id] ?? { result: "", entries: {} }} onResult={(result) => updateMatch(selectedEvent.id, { result })} onEntry={(id, patch) => updateMatchEntry(selectedEvent.id, id, patch)} />}
                </aside>
              </div>
            </section>
          )}
        </>
      )}

      {editingProfile && <ProfileDialog profile={editingProfile} onClose={() => setEditingProfile(null)} onSubmit={saveProfile} />}
      {diagnosticPlayer && <DiagnosticDialog profile={diagnosticPlayer} onClose={() => setDiagnosticPlayer(null)} onSubmit={addDiagnostic} />}
      {detailPlayer && <DiagnosticDetailsDialog profile={detailPlayer} history={state.diagnostics[detailPlayer.id] ?? []} onClose={() => setDetailPlayer(null)} onEdit={() => { setDetailPlayer(null); setDiagnosticPlayer(detailPlayer); }} />}
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

function EventCard({ event, active, onOpen }: { event: CalendarEvent; active?: boolean; onOpen: (event: CalendarEvent, target: "attendance" | "lineup" | "stats") => void }) {
  const target = event.type === "training" ? "attendance" : event.type === "other" ? "attendance" : "lineup";
  return <article className={`event-card type-${event.type}${active ? " active" : ""}`}><div className="event-card-top"><span>{eventLabel(event.type)}</span><time>{formatDate(event.start)}</time></div><h3>{event.title}</h3><p>{event.location || "Ort noch offen"}</p><button type="button" onClick={() => onOpen(event, target)}>{event.type === "training" ? "Teilnahme eintragen" : event.type === "other" ? "Termin öffnen" : "Kader planen"} →</button></article>;
}

function AttendancePanel({ event, profiles, attendance, onSet, onAll }: { event: CalendarEvent; profiles: Profile[]; attendance: Record<string, AttendanceStatus>; onSet: (eventId: string, id: string, status: AttendanceStatus) => void; onAll: (eventId: string) => void }) {
  return <><div className="detail-head"><div><p className="section-index">TRAININGSTEILNAHME</p><h2>{event.title}</h2><p>{formatDate(event.start)}</p></div><button className="text-button" onClick={() => onAll(event.id)}>Alle anwesend</button></div><div className="attendance-list">{profiles.map((player) => <div className="attendance-row" key={player.id}><div><Image src={`/api/player-image?name=${encodeURIComponent(player.firstName)}`} alt="" width={38} height={38} unoptimized /><strong>{player.firstName}</strong></div><div className="attendance-options">{(["present", "excused", "absent"] as AttendanceStatus[]).map((status) => <button key={status} className={`${status}${attendance[player.id] === status ? " selected" : ""}`} onClick={() => onSet(event.id, player.id, status)} aria-label={`${player.firstName}: ${{ present: "anwesend", excused: "entschuldigt", absent: "abwesend" }[status]}`}><span />{{ present: "Anwesend", excused: "Entschuldigt", absent: "Abwesend" }[status]}</button>)}</div></div>)}</div></>;
}

function PlayerCard({ profile, flipped, appearances, goals, assists, participation, history, bestDisciplineKeys, onFlip, onEdit, onDetails }: { profile: Profile; flipped: boolean; appearances: number; goals: number; assists: number; participation: number | null; history: Diagnostic[]; bestDisciplineKeys: Set<DiagnosticDisciplineKey>; onFlip: () => void; onEdit: () => void; onDetails: () => void }) {
  return <article className={`fc-card${flipped ? " flipped" : ""}`}><div className="fc-card-inner"><div className="fc-face fc-front"><button className="card-flip-area" onClick={onFlip} aria-label={`${profile.firstName}: Leistungsseite anzeigen`}><div className="shirt-number">{profile.shirtNumber || "—"}</div><Image src={`/api/player-image?name=${encodeURIComponent(profile.firstName)}`} alt={profile.firstName} width={260} height={260} unoptimized /><div className="fc-name">{profile.firstName}</div><div className="fc-positions"><strong>{profile.primaryPosition || "POS"}</strong><span>{profile.secondaryPosition || "—"}</span></div><div className="fc-foot">Starker Fuß <strong>{{ left: "Links", right: "Rechts", both: "Beide", "": "—" }[profile.strongFoot]}</strong></div><p>{profile.personality || "Spielerpersönlichkeit noch nicht ergänzt."}</p></button><button className="card-edit" onClick={onEdit}>Profil bearbeiten</button></div><div className="fc-face fc-back"><button className="card-flip-area" onClick={onFlip} aria-label={`${profile.firstName}: Profilseite anzeigen`}><p className="section-index">SAISONWERTE</p><h3>{profile.firstName}</h3><div className="fc-metrics"><div><strong>{appearances}</strong><span>Einsätze</span></div><div><strong>{goals}</strong><span>Tore</span></div><div><strong>{assists}</strong><span>Assists</span></div><div><strong>{participation === null ? "—" : `${participation}%`}</strong><span>Training</span></div></div><DiagnosticOverview latest={history[0]} bestDisciplineKeys={bestDisciplineKeys} /></button><button className="card-edit" onClick={onDetails}>Details ansehen</button></div></div></article>;
}

type DiagnosticStatus = "good" | "mid-good" | "average" | "below" | "critical" | "bad" | "neutral";

function diagnosticStatus(metric?: DiagnosticMetric | null): DiagnosticStatus {
  const category = String(metric?.category ?? "").trim().toUpperCase();
  if (/^A(?:\/B)?$/.test(category)) return "good";
  if (/^B(?:\/C)?$/.test(category)) return "average";
  if (category === "C") return "critical";
  const rating = `${metric?.rating ?? ""}`.toLowerCase();
  if (/ausgezeichnet|sehr gut|excellent|top/.test(rating)) return "good";
  if (/gut|befriedigend|durchschnittlich|mittel/.test(rating)) return "average";
  if (/ausreichend/.test(rating)) return "critical";
  if (/mangelhaft|unterdurchschnitt|schwach|schlecht|ungenügend/.test(rating)) return "bad";
  return "neutral";
}

function DiagnosticOverview({ latest, bestDisciplineKeys }: { latest?: Diagnostic; bestDisciplineKeys: Set<DiagnosticDisciplineKey> }) {
  const rows = latest?.metrics ? [
    ["sprint10", "10 m Sprint", latest.metrics.sprint10], ["sprint20", "20 m Sprint", latest.metrics.sprint20],
    ["agility", "Laufgewandtheit", latest.metrics.agility], ["dribbling", "Dribbling", latest.metrics.dribbling],
    ["shuttleRun", "Shuttle Run", { rating: latest.metrics.shuttleRun.rating, category: null } as DiagnosticMetric],
    ["jump", "Standweitsprung", { rating: latest.metrics.jump.rating, category: null } as DiagnosticMetric],
  ] as Array<[string, string, DiagnosticMetric]> : latest ? [
    ["sprint10", "10 m Sprint", null], ["sprint20", "20 m Sprint", null], ["agility", "Agility", null], ["shuttleRun", "Ausdauer", null], ["jump", "Sprungkraft", null],
  ] as Array<[string, string, DiagnosticMetric | null]> : [];
  return <div className="diagnostic-overview"><strong>Leistungsdiagnostik{latest?.ageGroup ? ` · ${latest.ageGroup}` : ""}</strong>{rows.length ? rows.map(([key, label, metric]) => <div key={key}><span className={`diagnostic-dot ${diagnosticStatus(metric)}`} aria-label={`${label}: ${diagnosticStatus(metric)}`} /><span>{label}{bestDisciplineKeys.has(key as DiagnosticDisciplineKey) && <span className="diagnostic-crown" title="Bester Wert im Team" aria-label="Bester Wert im Team"> 👑</span>}</span></div>) : <p>Noch keine Messung erfasst.</p>}</div>;
}

function DiagnosticMetricRow({ label, metric, unit, previous }: { label: string; metric: DiagnosticMetric; unit: string; previous: number | null }) {
  return <div><span><strong>{label}</strong><small>{metric.attempts.map((attempt, index) => `V${index + 1}: ${attempt ?? "—"}`).join(" · ")} · PR {metric.percentile === null ? "—" : `${Math.round(metric.percentile * 100)}%`} · {metric.category ?? "—"}</small></span><b>{metric.best ?? "—"}{metric.best !== null ? ` ${unit}` : ""}<small>{metric.rating ?? ""}</small></b><Delta current={metric.best} previous={previous} lowerIsBetter /></div>;
}

function DiagnosticDetailsDialog({ profile, history, onClose, onEdit }: { profile: Profile; history: Diagnostic[]; onClose: () => void; onEdit: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="diagnostic-details-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="coach-modal diagnostic-details-dialog"><button className="close-dialog" type="button" aria-label="Dialog schließen" onClick={onClose}>×</button><p className="section-index">LEISTUNGSDIAGNOSTIK</p><h2 id="diagnostic-details-title">{profile.firstName}</h2>{history.length ? <div className="diagnostic-detail-list">{history.map((diagnostic, index) => <DiagnosticDetailRecord key={diagnostic.id} diagnostic={diagnostic} previous={history[index + 1]} />)}</div> : <p className="history-empty">Noch keine Leistungsdiagnostik erfasst.</p>}<div className="modal-actions"><button className="text-button" type="button" onClick={onClose}>Schließen</button><button className="primary-button" type="button" onClick={onEdit}>Diagnostik erfassen</button></div></section></div>;
}

function DiagnosticDetailRecord({ diagnostic, previous }: { diagnostic: Diagnostic; previous?: Diagnostic }) {
  return <section className="diagnostic-detail-record"><div className="diagnostic-detail-record-head"><strong>{diagnostic.ageGroup || "Leistungsdiagnostik"}</strong><time>{diagnostic.date}</time></div>{diagnostic.metrics ? <><DiagnosticMetricRow label="10 m Sprint" metric={diagnostic.metrics.sprint10} unit="s" previous={previous?.metrics?.sprint10?.best ?? null} /><DiagnosticMetricRow label="20 m Sprint" metric={diagnostic.metrics.sprint20} unit="s" previous={previous?.metrics?.sprint20?.best ?? null} /><DiagnosticMetricRow label="Laufgewandtheit" metric={diagnostic.metrics.agility} unit="s" previous={previous?.metrics?.agility?.best ?? null} /><DiagnosticMetricRow label="Dribbling" metric={diagnostic.metrics.dribbling} unit="s" previous={previous?.metrics?.dribbling?.best ?? null} /><div><span><strong>Shuttle Run</strong><small>Level {diagnostic.metrics.shuttleRun.level ?? "—"}</small></span><b>{diagnostic.metrics.shuttleRun.rating ?? "—"}</b></div><div><span><strong>Standweitsprung</strong><small>{diagnostic.metrics.jump.attempts.map((attempt, index) => `V${index + 1}: ${attempt ?? "—"}`).join(" · ")}</small></span><b>{diagnostic.metrics.jump.best ?? "—"} m<small>{diagnostic.metrics.jump.rating ?? ""}</small></b></div></> : <>{([['5 m Sprint', diagnostic.sprint5, previous?.sprint5, 's'], ['10 m Sprint', diagnostic.sprint10, previous?.sprint10, 's'], ['20 m Sprint', diagnostic.sprint20, previous?.sprint20, 's'], ['Agility', diagnostic.agility, previous?.agility, 's'], ['Ausdauer', diagnostic.endurance, previous?.endurance, ''], ['Sprungkraft', diagnostic.jump, previous?.jump, 'cm']] as const).map(([label, value, before, unit]) => <div key={label}><span><strong>{label}</strong></span><b>{value ?? "—"}{value !== null ? ` ${unit}` : ""}</b><Delta current={value} previous={before ?? null} lowerIsBetter={!['Ausdauer', 'Sprungkraft'].includes(label)} /></div>)}</>}</section>;
}

function Delta({ current, previous, lowerIsBetter }: { current: number | null; previous: number | null; lowerIsBetter: boolean }) {
  if (current === null || previous === null || current === previous) return <em />;
  const delta = current - previous; const positive = lowerIsBetter ? delta < 0 : delta > 0;
  return <em className={positive ? "delta-positive" : "delta-negative"}>({delta > 0 ? "+" : ""}{delta.toFixed(2)})</em>;
}

function StatsTable({ rows }: { rows: Array<{ player: Profile; appearances: number; goals: number; assists: number; participation: number | null }> }) {
  return <table className="stats-table"><thead><tr><th>Spieler:in</th><th>Einsätze</th><th>Tore</th><th>Assists</th><th>Training</th></tr></thead><tbody>{rows.map((row) => <tr key={row.player.id}><td><Image src={`/api/player-image?name=${encodeURIComponent(row.player.firstName)}`} alt="" width={36} height={36} unoptimized /><strong>{row.player.firstName}</strong></td><td>{row.appearances}</td><td>{row.goals}</td><td>{row.assists}</td><td>{row.participation === null ? "—" : `${row.participation}%`}</td></tr>)}</tbody></table>;
}

function MatchEditor({ event, profiles, data, onResult, onEntry }: { event: CalendarEvent; profiles: Profile[]; data: MatchData; onResult: (value: string) => void; onEntry: (id: string, patch: Partial<MatchEntry>) => void }) {
  return <div className="match-panel"><p className="section-index">SPIELSTATISTIK</p><h2>{event.title}</h2><label>Ergebnis<input defaultValue={data.result} onBlur={(e) => onResult(e.target.value.trim().slice(0, 20))} placeholder="z. B. 3:1" /></label><div className="match-player-list">{profiles.map((player) => { const entry = data.entries[player.id] ?? { appearance: false, goals: 0, assists: 0 }; return <div key={player.id}><label className="appearance"><input type="checkbox" checked={entry.appearance} onChange={(e) => onEntry(player.id, { appearance: e.target.checked })} /><span>{player.firstName}</span></label><label>Tore<input type="number" min="0" max="30" defaultValue={entry.goals} onBlur={(e) => onEntry(player.id, { goals: Math.min(30, Math.max(0, Number(e.target.value) || 0)) })} /></label><label>Assists<input type="number" min="0" max="30" defaultValue={entry.assists} onBlur={(e) => onEntry(player.id, { assists: Math.min(30, Math.max(0, Number(e.target.value) || 0)) })} /></label></div>; })}</div></div>;
}

function ProfileDialog({ profile, onClose, onSubmit }: { profile: Profile; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={dialogRef} className="modal-backdrop" aria-labelledby="profile-dialog-title" onCancel={(e) => { e.preventDefault(); onClose(); }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><form className="coach-modal" onSubmit={onSubmit}><button className="close-dialog" type="button" aria-label="Dialog schließen" onClick={onClose}>×</button><p className="section-index">SPIELERPROFIL</p><h2 id="profile-dialog-title">{profile.firstName}</h2><div className="form-grid"><label>Trikotnummer<input autoFocus name="shirtNumber" type="number" min="0" max="999" defaultValue={profile.shirtNumber} /></label><label>Hauptposition<select name="primaryPosition" defaultValue={profile.primaryPosition}><option value="">Bitte wählen</option>{positionOptions.map((position) => <option key={position}>{position}</option>)}</select></label><label>Ersatzposition<select name="secondaryPosition" defaultValue={profile.secondaryPosition}><option value="">Keine</option>{positionOptions.map((position) => <option key={position}>{position}</option>)}</select></label><label>Starker Fuß<select name="strongFoot" defaultValue={profile.strongFoot}><option value="">Bitte wählen</option><option value="left">Links</option><option value="right">Rechts</option><option value="both">Beide</option></select></label><label className="wide">Spielerpersönlichkeit<textarea name="personality" defaultValue={profile.personality} rows={4} placeholder="Stärken, Rolle im Team, Coaching-Hinweise …" /></label></div><button className="primary-button" type="submit">Profil speichern</button></form></dialog>;
}

function DiagnosticDialog({ profile, onClose, onSubmit }: { profile: Profile; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={dialogRef} className="modal-backdrop" aria-labelledby="diagnostic-dialog-title" onCancel={(e) => { e.preventDefault(); onClose(); }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><form className="coach-modal" onSubmit={onSubmit}><button className="close-dialog" type="button" aria-label="Dialog schließen" onClick={onClose}>×</button><p className="section-index">LEISTUNGSDIAGNOSTIK</p><h2 id="diagnostic-dialog-title">{profile.firstName}</h2><div className="form-grid diagnostic-form"><label>Datum<input autoFocus name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><span /><label>Sprint 5 m (Sek.)<input name="sprint5" inputMode="decimal" /></label><label>Sprint 10 m (Sek.)<input name="sprint10" inputMode="decimal" /></label><label>Sprint 20 m (Sek.)<input name="sprint20" inputMode="decimal" /></label><label>Agility (Sek.)<input name="agility" inputMode="decimal" /></label><label>Ausdauerwert<input name="endurance" inputMode="decimal" /></label><label>Sprungkraft (cm)<input name="jump" inputMode="decimal" /></label></div><button className="primary-button" type="submit">Messung speichern</button></form></dialog>;
}

