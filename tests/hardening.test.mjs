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
    "prefers-reduced-motion", "focus-visible", "safe-area-inset-left", "pointer: coarse",
  ]) assert.match(css, new RegExp(marker.replace(/[()]/g, "\\$&")));
  for (const marker of ["aria-live=\"polite\"", "<dialog", "aria-labelledby", "role=\"status\""]) {
    assert.ok(component.includes(marker), `missing ${marker}`);
  }
  assert.ok(component.includes("Verlauf öffnen"));
  assert.ok(component.includes("aria-expanded={open}"));
  assert.ok(component.includes('aria-label="Teamkarten nach Position filtern"'));
  assert.ok(component.includes("player.secondaryPosition === positionFilter"));
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
  assert.ok(login.includes('inputMode="text"'));
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

test("sensitive API routes explicitly prevent shared caching", async () => {
  const routes = ["app/api/auth/route.ts", "app/api/coaching-state/route.ts", "app/api/history/route.ts"];
  for (const route of routes) assert.match(await source(route), /private, no-store/);
});

test("tactics stay fixed, draggable and tied to lineups", async () => {
  const [board, component, route] = await Promise.all([
    source("app/components/TacticsBoard.tsx"),
    source("app/components/CoachingTool.tsx"),
    source("app/api/coaching-state/route.ts"),
  ]);
  for (const marker of [
    'attack: "Angriff"', 'defense: "Verteidigung"', 'corner: "Ecke"',
    "tactics-ball", "onPointerDown", "onKeyDown", 'fetch("/api/lineup?lineupId=default"',
  ]) assert.ok(board.includes(marker), `missing ${marker}`);
  assert.ok(!board.includes("Taktik hinzufügen"));
  assert.ok(component.includes('"overview", "calendar", "lineup", "tactics", "players", "stats"'));
  assert.ok(component.includes('operation("tactic"'));
  assert.ok(route.includes('"tactic"'));
  assert.ok(route.includes('"attack", "defense", "corner"'));
});
