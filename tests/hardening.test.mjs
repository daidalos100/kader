import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("mobile and accessibility safeguards stay present", async () => {
  const [css, component] = await Promise.all([
    source("app/globals.css"),
    source("app/components/CoachingTool.tsx"),
  ]);
  for (const marker of [
    "@media (max-width: 820px)", "@media (max-width: 560px)", "@media (max-width: 380px)",
    "prefers-reduced-motion", "focus-visible", "safe-area-inset-left", "pointer: coarse", "overscroll-behavior-x: contain", "overscroll-behavior: contain", "min-height: 44px", "calendar-event-dialog", "100dvh", "touch-action: manipulation",
  ]) assert.match(css, new RegExp(marker.replace(/[()]/g, "\\$&")));
  for (const marker of ["aria-live=\"polite\"", "<dialog", "aria-labelledby", "role=\"status\""]) {
    assert.ok(component.includes(marker), `missing ${marker}`);
  }
  assert.ok(component.includes("Verlauf öffnen"));
  assert.ok(component.includes("aria-expanded={open}"));
  assert.ok(component.includes('aria-label="Teamkarten nach Position filtern"'));
  assert.ok(component.includes("player.secondaryPosition === positionFilter"));
  assert.ok(component.includes("const onKeyDown = (keyEvent: KeyboardEvent)"));
  assert.ok(component.includes("const onKeyDown = (event: KeyboardEvent)"));
  assert.ok(css.includes(".attendance-options { display: flex; flex-wrap: wrap; gap: 5px; }"));
  assert.ok(css.includes(".static-card, .static-card .fc-card-inner { height: 760px; }"));
});

test("security and conflict controls stay present", async () => {
  const [config, auth, login, stateRoute, migration, tacticsMigration] = await Promise.all([
    source("next.config.ts"), source("app/auth.ts"), source("app/login/page.tsx"),
    source("app/api/coaching-state/route.ts"), source("supabase/phase3-hardening.sql"),
    source("supabase/phase4-tactics.sql"),
  ]);
  for (const header of ["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Permissions-Policy"]) {
    assert.ok(config.includes(header), `missing ${header}`);
  }
  assert.ok(auth.includes("HMAC"));
  assert.ok(auth.includes("sessionMaxAgeSeconds"));
  assert.ok(auth.includes("60 * 60 * 24 * 14"));
  assert.ok(auth.includes("TRAINER_ACCESS_JSON"));
  assert.ok(auth.includes("TRAINER_SESSION_SECRET"));
  assert.ok(login.includes('autoComplete="username"'));
  assert.ok(login.includes('autoComplete="current-password"'));
  assert.ok((await source("app/api/auth/route.ts")).includes("auth/v1/token?grant_type=password"));
  assert.ok((await source("app/api/auth/route.ts")).includes("createTrainerSession(trainer)"));
  assert.ok(!login.includes('method: "DELETE"'), "opening the login page must not terminate an active session");
  assert.ok(stateRoute.includes("expectedRevision"));
  assert.ok(stateRoute.includes("status: 409"));
  for (const control of ["enable row level security", "apply_coaching_record", "consume_login_attempt", "coaching_history", "coaching_backups"]) {
    assert.ok(migration.includes(control), `missing ${control}`);
  }
  assert.ok(migration.includes("raise sqlstate 'PT409'"));
  assert.ok(!migration.includes("errcode = '40001'"), "serialization errors must not be used for user conflicts");
  assert.ok(tacticsMigration.includes("'tactic'"));
  assert.ok(tacticsMigration.includes("coaching_records_scope_check"));
});

test("active trainer sessions renew without weakening the cookie protections", async () => {
  const component = await source("app/components/CoachingTool.tsx");
  for (const marker of ["keepSessionAlive", "visibilitychange", "30 * 60 * 1000", 'window.location.assign("/login")']) {
    assert.ok(component.includes(marker), `missing ${marker}`);
  }
});

test("sensitive API routes explicitly prevent shared caching", async () => {
  const routes = ["app/api/auth/route.ts", "app/api/coaching-state/route.ts", "app/api/history/route.ts"];
  for (const route of routes) assert.match(await source(route), /private, no-store/);
});

test("tactics stay draggable, tied to lineups and support custom scenarios", async () => {
  const [board, component, route] = await Promise.all([
    source("app/components/TacticsBoard.tsx"),
    source("app/components/CoachingTool.tsx"),
    source("app/api/coaching-state/route.ts"),
  ]);
  for (const marker of [
    'attack: "Angriff"', 'defense: "Verteidigung"', 'corner: "Ecke"',
    "tactics-ball", "onPointerDown", "onPointerCancel={cancelDraw}", "setPointerCapture(event.pointerId)", "onKeyDown", 'fetch("/api/lineup?lineupId=default"', "+ Neue Taktik", "onCreate", "onDuplicate", "onDelete", 'markerUnits="userSpaceOnUse"', 'markerWidth="2.8"',
  ]) assert.ok(board.includes(marker), `missing ${marker}`);
  assert.ok(board.includes("Taktik umbenennen"));
  assert.ok(component.includes('"overview", "matchday", "lineup", "tactics", "players", "stats", "calendar"'));
  assert.ok(component.includes('operation("tactic"'));
  assert.ok(route.includes('"tactic"'));
  assert.ok(route.includes('"attack", "defense", "corner"'));
  assert.ok(route.includes("custom-[a-z0-9-]"));
});

test("matchday capture records and reverses scorer and assist together", async () => {
  const [component, route, historyRoute] = await Promise.all([
    source("app/components/CoachingTool.tsx"), source("app/api/coaching-state/route.ts"), source("app/api/history/route.ts"),
  ]);
  for (const marker of ["MatchdayPanel", "TOR ERFASSEN", "OHNE ASSIST", "Rückgängig", "goalEvents", "recordGoal", "undoGoal"]) {
    assert.ok(component.includes(marker), `missing ${marker}`);
  }
  assert.ok(route.includes("goalEvents"));
  assert.ok(component.includes("restore_match_goal_events"));
  assert.ok(component.includes("Tore aus Verlauf wiederherstellen"));
  assert.ok(historyRoute.includes("restore_match_goal_events"));
  assert.ok(historyRoute.includes("goalEventsFrom"));
  assert.ok(historyRoute.includes("Torverlauf wiederhergestellt"));
});

test("saving a result preserves the individual goal events", async () => {
  const component = await source("app/components/CoachingTool.tsx");
  assert.ok(component.includes('operation("match_meta", eventId, { result: next.result, goalEvents: next.goalEvents ?? [] })'));
});

test("matchday capture offers every present player, independent of the lineup", async () => {
  const component = await source("app/components/CoachingTool.tsx");
  for (const marker of ["matchdayAvailablePlayers", 'attendance[player.id] === "present"', "Teilnahme laden", "Spieltag erfassen"]) {
    assert.ok(component.includes(marker), `missing ${marker}`);
  }
  assert.ok(!component.includes("Aufstellung noch nicht vorhanden."));
});

test("appearances are derived from saved matchday lineups", async () => {
  const [component, route] = await Promise.all([
    source("app/components/CoachingTool.tsx"), source("app/api/lineup/route.ts"),
  ]);
  for (const marker of ["eventLineups", "appearanceCounts", "eligibleEventLineupIds", "entry.firstName", "matchday-result"]) {
    assert.ok(component.includes(marker), `missing ${marker}`);
  }
  assert.ok(route.includes('params.get("eventLineups")'));
  assert.ok(route.includes("lineup_id=like.event-*"));
  assert.ok(component.includes("const seasonStart = calendarVisibleFrom"), "all D1 game dates from 07.07.2026 must count");
});

test("calendar keeps its chronology from 07.07.2026 and stores local event overrides", async () => {
  const [calendar, component, route, migration] = await Promise.all([
    source("app/lib/calendar.ts"), source("app/components/CoachingTool.tsx"), source("app/api/coaching-state/route.ts"), source("supabase/phase5-calendar-overrides.sql"),
  ]);
  assert.ok(calendar.includes("24 * 365"));
  assert.ok(component.includes("mobile-calendar-detail"));
  assert.ok(component.includes("scrollIntoView"));
  for (const marker of ["calendarVisibleFrom", "next-calendar-event", "calendarOverrides", "Termin bearbeiten", "Google-Kalender bleibt unverändert", "TEILNAHME", "not_selected", "Nicht im Kader", "Noch nicht erfasst", "Entschuldigt${reason"]) assert.ok(component.includes(marker), `missing ${marker}`);
  assert.ok(route.includes('"calendar_event"'));
  assert.ok(migration.includes("calendar_event"));
});

test("overview keeps a matchday active until 21:00 local time", async () => {
  const component = await source("app/components/CoachingTool.tsx");
  for (const marker of ["function overviewReferenceTime", "cutoff.setHours(21, 0, 0, 0)", "overviewReferenceTime()", "setInterval(refreshReferenceTime, 60 * 1000)"]) {
    assert.ok(component.includes(marker), `missing ${marker}`);
  }
});

test("diagnostic cards support imported metrics without embedding player data", async () => {
  const [component, route] = await Promise.all([
    source("app/components/CoachingTool.tsx"), source("app/api/coaching-state/route.ts"),
  ]);
  for (const marker of ["DiagnosticMetric", "metrics", "dribbling", "shuttleRun", "Standweitsprung"]) {
    assert.ok(component.includes(marker), `missing ${marker}`);
  }
  assert.ok(!component.includes("excel-u13-2026-"), "private player measurements must not be embedded in source code");
  assert.ok(component.includes("visibleDiagnostics"));
  assert.ok(route.includes("diagnostic.deleted !== true"));
});

test("statistics show percentage appearances and event-level details", async () => {
  const component = await source("app/components/CoachingTool.tsx");
  for (const marker of ["StatDetailsDialog", "appearanceEvents", "trainingEvents", "`${appearanceRate}%`", "stats-value-button", "defaultSort", "trainingDifference", "appearanceDifference", "goalDifference", "assistDifference"]) {
    assert.ok(component.includes(marker), `missing ${marker}`);
  }
});

test("statistics awards stay derived from saved training, lineup and match data", async () => {
  const [component, css] = await Promise.all([
    source("app/components/CoachingTool.tsx"), source("app/globals.css"),
  ]);
  for (const marker of ["scoreFromResult", "defensiveLineupPlayers", "recordedTrainingStatuses", "🌱 Comeback", "📈 Aufwärtstrend", "⛓️ Kette", "🧱 Bollwerk", "⭐ Scorer-Held", "✨ mit", "dreamDuos", "StatsAwardLegend", "⚽", "🎯", "🔥"]) {
    assert.ok(component.includes(marker), `missing ${marker}`);
  }
  assert.ok(component.includes("const orderedAwards"));
  assert.ok(component.includes('header("award", "Award")'));
  assert.ok(component.includes("awardCountFor"));
  for (const marker of ["stats-award-cell", "stats-award-dream-duo", "stats-award-legend"]) {
    assert.ok(css.includes(marker), `missing ${marker}`);
  }
});

test("player card back keeps details accessible on constrained screens", async () => {
  const [css, component] = await Promise.all([
    source("app/globals.css"), source("app/components/CoachingTool.tsx"),
  ]);
  for (const marker of ["Details ansehen", "DiagnosticDetailsDialog", "role=\"dialog\"", "diagnostic-details-dialog", "diagnostic-dot", "diagnostic-crown", "critical", "overflow-y: auto", ".fc-card { height: 690px"]) {
    assert.ok(css.includes(marker) || component.includes(marker), `missing ${marker}`);
  }
});
