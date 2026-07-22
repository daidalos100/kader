"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import SquadPlanner from "./SquadPlanner";
import type { CalendarEvent } from "../lib/calendar";

type Tab = "overview" | "calendar" | "lineup" | "players" | "stats";
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
};
type CoachingState = {
  roster: string[];
  profiles: Record<string, Partial<Profile>>;
  attendance: Record<string, Record<string, AttendanceStatus>>;
  matches: Record<string, MatchData>;
  diagnostics: Record<string, Diagnostic[]>;
};

const positionOptions = ["TW", "IV", "LV", "RV", "ZDM", "ZM", "LF", "RF", "ST"];
const emptyState: CoachingState = { roster: [], profiles: {}, attendance: {}, matches: {}, diagnostics: {} };

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
    diagnostics: state.diagnostics ?? {},
  };
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
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [notice, setNotice] = useState("");
  const [newRosterName, setNewRosterName] = useState("");
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
        return data as { state: unknown; setupRequired?: boolean };
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
        setState(normalizeState(coaching.state, lineupNames));
        setSetupRequired(Boolean(coaching.setupRequired));
      })
      .catch((error: Error) => {
        if (!cancelled) setNotice(error.message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function save(next: CoachingState) {
    setState(next);
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/coaching-state", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: next }),
      });
      const data = await response.json();
      if (!response.ok) {
        setSetupRequired(Boolean(data.setupRequired));
        throw new Error(data.error ?? "Speichern fehlgeschlagen.");
      }
      setSetupRequired(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
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
    });
  }

  function setAllPresent(eventId: string) {
    void save({
      ...state,
      attendance: { ...state.attendance, [eventId]: Object.fromEntries(profiles.map((player) => [player.id, "present"])) },
    });
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
    void save({ ...state, profiles: { ...state.profiles, [profile.id]: profile } });
  }

  function addRosterPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newRosterName.trim().replace(/\s+/g, " ").slice(0, 30);
    if (!name || state.roster.some((item) => item.localeCompare(name, "de", { sensitivity: "base" }) === 0)) return;
    setNewRosterName("");
    void save({ ...state, roster: [...state.roster, name].sort((a, b) => a.localeCompare(b, "de")) });
  }

  function updateMatch(eventId: string, patch: Partial<MatchData>) {
    const current = state.matches[eventId] ?? { result: "", entries: {} };
    void save({ ...state, matches: { ...state.matches, [eventId]: { ...current, ...patch } } });
  }

  function updateMatchEntry(eventId: string, id: string, patch: Partial<MatchEntry>) {
    const current = state.matches[eventId] ?? { result: "", entries: {} };
    const entry = current.entries[id] ?? { appearance: false, goals: 0, assists: 0 };
    updateMatch(eventId, { entries: { ...current.entries, [id]: { ...entry, ...patch } } });
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
    void save({ ...state, diagnostics: { ...state.diagnostics, [diagnosticPlayer.id]: history } });
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.assign("/login");
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

  return (
    <main className="coach-shell">
      <header className="coach-header">
        <button className="coach-brand" type="button" onClick={() => setTab("overview")}>
          <Image src="/brand/tsg-logo.png" alt="TSG Tübingen" width={68} height={68} priority unoptimized />
          <span><small>TSG TÜBINGEN · D1</small><strong>Coaching Tool</strong></span>
        </button>
        <nav aria-label="Hauptnavigation">
          {(["overview", "calendar", "lineup", "players", "stats"] as Tab[]).map((item) => (
            <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
              {{ overview: "Übersicht", calendar: "Kalender", lineup: "Aufstellung", players: "Team", stats: "Statistik" }[item]}
            </button>
          ))}
        </nav>
        <div className="coach-header-actions">
          <span className={saving ? "saving active" : "saving"}>{saving ? "Speichert …" : "Bereit"}</span>
          <button className="logout-button" type="button" onClick={logout}>Abmelden</button>
        </div>
      </header>

      {setupRequired && (
        <aside className="setup-banner">
          <strong>Einmalige Freigabe für Phase 2 fehlt.</strong>
          <span>Bitte die Datei <code>supabase/phase2.sql</code> einmal im Supabase SQL Editor ausführen. Kalender und Aufstellung funktionieren bereits.</span>
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

          {tab === "players" && (
            <section className="coach-view">
              <div className="view-heading compact team-heading"><div><p className="section-index">SPIELERPROFILE</p><h1>Teamkarten.</h1><p>Karte anklicken, um zwischen Profil und Leistungsseite zu wechseln.</p></div><form className="roster-form" onSubmit={addRosterPlayer}><label htmlFor="roster-name">Spieler:in ergänzen</label><div><input id="roster-name" value={newRosterName} onChange={(event) => setNewRosterName(event.target.value)} placeholder="Vorname" maxLength={30} /><button type="submit" disabled={!newRosterName.trim()}>Hinzufügen</button></div></form></div>
              {!profiles.length && <div className="empty-roster"><strong>Noch keine Spieler:innen im Team.</strong><p>Oben einen Vornamen ergänzen oder zuerst Namen in der allgemeinen Aufstellung eintragen.</p></div>}
              <div className="player-card-grid">
                {statsRows.map(({ player, appearances, goals, assists, participation }) => {
                  const history = state.diagnostics[player.id] ?? [];
                  return <PlayerCard key={player.id} profile={player} flipped={Boolean(flipped[player.id])} appearances={appearances} goals={goals} assists={assists} participation={participation} history={history} onFlip={() => setFlipped((current) => ({ ...current, [player.id]: !current[player.id] }))} onEdit={() => setEditingProfile(player)} onDiagnostic={() => setDiagnosticPlayer(player)} />;
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
                  {selectedEvent && <MatchEditor event={selectedEvent} profiles={profiles} data={state.matches[selectedEvent.id] ?? { result: "", entries: {} }} onResult={(result) => updateMatch(selectedEvent.id, { result })} onEntry={(id, patch) => updateMatchEntry(selectedEvent.id, id, patch)} />}
                </aside>
              </div>
            </section>
          )}
        </>
      )}

      {editingProfile && <ProfileDialog profile={editingProfile} onClose={() => setEditingProfile(null)} onSubmit={saveProfile} />}
      {diagnosticPlayer && <DiagnosticDialog profile={diagnosticPlayer} onClose={() => setDiagnosticPlayer(null)} onSubmit={addDiagnostic} />}
    </main>
  );
}

function EventCard({ event, active, onOpen }: { event: CalendarEvent; active?: boolean; onOpen: (event: CalendarEvent, target: "attendance" | "lineup" | "stats") => void }) {
  const target = event.type === "training" ? "attendance" : event.type === "other" ? "attendance" : "lineup";
  return <article className={`event-card type-${event.type}${active ? " active" : ""}`}><div className="event-card-top"><span>{eventLabel(event.type)}</span><time>{formatDate(event.start)}</time></div><h3>{event.title}</h3><p>{event.location || "Ort noch offen"}</p><button type="button" onClick={() => onOpen(event, target)}>{event.type === "training" ? "Teilnahme eintragen" : event.type === "other" ? "Termin öffnen" : "Kader planen"} →</button></article>;
}

function AttendancePanel({ event, profiles, attendance, onSet, onAll }: { event: CalendarEvent; profiles: Profile[]; attendance: Record<string, AttendanceStatus>; onSet: (eventId: string, id: string, status: AttendanceStatus) => void; onAll: (eventId: string) => void }) {
  return <><div className="detail-head"><div><p className="section-index">TRAININGSTEILNAHME</p><h2>{event.title}</h2><p>{formatDate(event.start)}</p></div><button className="text-button" onClick={() => onAll(event.id)}>Alle anwesend</button></div><div className="attendance-list">{profiles.map((player) => <div className="attendance-row" key={player.id}><div><Image src={`/api/player-image?name=${encodeURIComponent(player.firstName)}`} alt="" width={38} height={38} unoptimized /><strong>{player.firstName}</strong></div><div className="attendance-options">{(["present", "excused", "absent"] as AttendanceStatus[]).map((status) => <button key={status} className={`${status}${attendance[player.id] === status ? " selected" : ""}`} onClick={() => onSet(event.id, player.id, status)} aria-label={`${player.firstName}: ${{ present: "anwesend", excused: "entschuldigt", absent: "abwesend" }[status]}`}><span />{{ present: "Anwesend", excused: "Entschuldigt", absent: "Abwesend" }[status]}</button>)}</div></div>)}</div></>;
}

function PlayerCard({ profile, flipped, appearances, goals, assists, participation, history, onFlip, onEdit, onDiagnostic }: { profile: Profile; flipped: boolean; appearances: number; goals: number; assists: number; participation: number | null; history: Diagnostic[]; onFlip: () => void; onEdit: () => void; onDiagnostic: () => void }) {
  const latest = history[0]; const previous = history[1];
  return <article className={`fc-card${flipped ? " flipped" : ""}`}><div className="fc-card-inner"><div className="fc-face fc-front"><button className="card-flip-area" onClick={onFlip} aria-label={`${profile.firstName}: Leistungsseite anzeigen`}><div className="shirt-number">{profile.shirtNumber || "—"}</div><Image src={`/api/player-image?name=${encodeURIComponent(profile.firstName)}`} alt={profile.firstName} width={260} height={260} unoptimized /><div className="fc-name">{profile.firstName}</div><div className="fc-positions"><strong>{profile.primaryPosition || "POS"}</strong><span>{profile.secondaryPosition || "—"}</span></div><div className="fc-foot">Starker Fuß <strong>{{ left: "Links", right: "Rechts", both: "Beide", "": "—" }[profile.strongFoot]}</strong></div><p>{profile.personality || "Spielerpersönlichkeit noch nicht ergänzt."}</p></button><button className="card-edit" onClick={onEdit}>Profil bearbeiten</button></div><div className="fc-face fc-back"><button className="card-flip-area" onClick={onFlip} aria-label={`${profile.firstName}: Profilseite anzeigen`}><p className="section-index">SAISONWERTE</p><h3>{profile.firstName}</h3><div className="fc-metrics"><div><strong>{appearances}</strong><span>Einsätze</span></div><div><strong>{goals}</strong><span>Tore</span></div><div><strong>{assists}</strong><span>Assists</span></div><div><strong>{participation === null ? "—" : `${participation}%`}</strong><span>Training</span></div></div><div className="diagnostic-mini"><strong>Leistungsdiagnostik</strong>{latest ? <>{([['5 m', latest.sprint5, previous?.sprint5, 's'], ['10 m', latest.sprint10, previous?.sprint10, 's'], ['20 m', latest.sprint20, previous?.sprint20, 's'], ['Agility', latest.agility, previous?.agility, 's'], ['Ausdauer', latest.endurance, previous?.endurance, ''], ['Sprung', latest.jump, previous?.jump, 'cm']] as const).map(([label, value, before, unit]) => <div key={label}><span>{label}</span><b>{value ?? "—"}{value !== null ? unit : ""}</b><Delta current={value} previous={before ?? null} lowerIsBetter={label !== "Ausdauer" && label !== "Sprung"} /></div>)}</> : <p>Noch keine Messung erfasst.</p>}</div></button><button className="card-edit" onClick={onDiagnostic}>Diagnostik erfassen</button></div></div></article>;
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
  return <div className="match-panel"><p className="section-index">SPIELSTATISTIK</p><h2>{event.title}</h2><label>Ergebnis<input value={data.result} onChange={(e) => onResult(e.target.value.slice(0, 20))} placeholder="z. B. 3:1" /></label><div className="match-player-list">{profiles.map((player) => { const entry = data.entries[player.id] ?? { appearance: false, goals: 0, assists: 0 }; return <div key={player.id}><label className="appearance"><input type="checkbox" checked={entry.appearance} onChange={(e) => onEntry(player.id, { appearance: e.target.checked })} /><span>{player.firstName}</span></label><label>Tore<input type="number" min="0" max="30" value={entry.goals} onChange={(e) => onEntry(player.id, { goals: Math.max(0, Number(e.target.value)) })} /></label><label>Assists<input type="number" min="0" max="30" value={entry.assists} onChange={(e) => onEntry(player.id, { assists: Math.max(0, Number(e.target.value)) })} /></label></div>; })}</div></div>;
}

function ProfileDialog({ profile, onClose, onSubmit }: { profile: Profile; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><form className="coach-modal" onSubmit={onSubmit}><button className="close-dialog" type="button" onClick={onClose}>×</button><p className="section-index">SPIELERPROFIL</p><h2>{profile.firstName}</h2><div className="form-grid"><label>Trikotnummer<input name="shirtNumber" type="number" min="0" max="999" defaultValue={profile.shirtNumber} /></label><label>Hauptposition<select name="primaryPosition" defaultValue={profile.primaryPosition}><option value="">Bitte wählen</option>{positionOptions.map((position) => <option key={position}>{position}</option>)}</select></label><label>Ersatzposition<select name="secondaryPosition" defaultValue={profile.secondaryPosition}><option value="">Keine</option>{positionOptions.map((position) => <option key={position}>{position}</option>)}</select></label><label>Starker Fuß<select name="strongFoot" defaultValue={profile.strongFoot}><option value="">Bitte wählen</option><option value="left">Links</option><option value="right">Rechts</option><option value="both">Beide</option></select></label><label className="wide">Spielerpersönlichkeit<textarea name="personality" defaultValue={profile.personality} rows={4} placeholder="Stärken, Rolle im Team, Coaching-Hinweise …" /></label></div><button className="primary-button" type="submit">Profil speichern</button></form></div>;
}

function DiagnosticDialog({ profile, onClose, onSubmit }: { profile: Profile; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><form className="coach-modal" onSubmit={onSubmit}><button className="close-dialog" type="button" onClick={onClose}>×</button><p className="section-index">LEISTUNGSDIAGNOSTIK</p><h2>{profile.firstName}</h2><div className="form-grid diagnostic-form"><label>Datum<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><span /><label>Sprint 5 m (Sek.)<input name="sprint5" inputMode="decimal" /></label><label>Sprint 10 m (Sek.)<input name="sprint10" inputMode="decimal" /></label><label>Sprint 20 m (Sek.)<input name="sprint20" inputMode="decimal" /></label><label>Agility (Sek.)<input name="agility" inputMode="decimal" /></label><label>Ausdauerwert<input name="endurance" inputMode="decimal" /></label><label>Sprungkraft (cm)<input name="jump" inputMode="decimal" /></label></div><button className="primary-button" type="submit">Messung speichern</button></form></div>;
}
