export const dynamic = "force-dynamic";

import { isAuthenticated } from "../../auth";
import { getSupabaseConfig, supabaseHeaders } from "../../lib/supabase";

const SEASON_ID = "d1-2026-27";
const allowedScopes = new Set(["roster", "profile", "attendance", "match_meta", "match_entry", "diagnostic", "tactic"]);

type RecordRow = {
  scope: string;
  record_key: string;
  data: unknown;
  revision: number;
  updated_at: string;
};

type Operation = {
  scope: string;
  key: string;
  value: unknown;
  expectedRevision: number;
};

function privateJson(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("pragma", "no-cache");
  return Response.json(value, { ...init, headers });
}

function emptyState() {
  return { roster: [] as string[], profiles: {}, attendance: {}, matches: {}, diagnostics: {}, tactics: {} };
}

function splitCompositeKey(value: string) {
  const index = value.lastIndexOf(":");
  return index > 0 ? [value.slice(0, index), value.slice(index + 1)] : ["", ""];
}

function assembleState(rows: RecordRow[]) {
  const state = emptyState() as {
    roster: string[];
    profiles: Record<string, unknown>;
    attendance: Record<string, Record<string, unknown>>;
    matches: Record<string, { result: string; entries: Record<string, unknown>; goalEvents: unknown[] }>;
    diagnostics: Record<string, unknown[]>;
    tactics: Record<string, unknown>;
  };
  const revisions: Record<string, number> = {};

  for (const row of rows) {
    revisions[`${row.scope}:${row.record_key}`] = row.revision;
    if (row.scope === "roster" && typeof row.data === "string") state.roster.push(row.data);
    if (row.scope === "profile" && row.data && typeof row.data === "object") state.profiles[row.record_key] = row.data;
    if (row.scope === "attendance") {
      const [eventId, playerId] = splitCompositeKey(row.record_key);
      if (eventId && playerId && ["present", "excused", "absent"].includes(String(row.data))) {
        state.attendance[eventId] ??= {};
        state.attendance[eventId][playerId] = row.data;
      }
    }
    if (row.scope === "match_meta" && row.data && typeof row.data === "object") {
      const meta = row.data as { result?: unknown; goalEvents?: unknown };
      const result = String(meta.result ?? "").slice(0, 20);
      state.matches[row.record_key] ??= { result: "", entries: {}, goalEvents: [] };
      state.matches[row.record_key].result = result;
      state.matches[row.record_key].goalEvents = Array.isArray(meta.goalEvents) ? meta.goalEvents.filter((goal) => isRecord(goal) && goal.deleted !== true) : [];
    }
    if (row.scope === "match_entry" && row.data && typeof row.data === "object") {
      const [eventId, playerId] = splitCompositeKey(row.record_key);
      if (eventId && playerId) {
        state.matches[eventId] ??= { result: "", entries: {}, goalEvents: [] };
        state.matches[eventId].entries[playerId] = row.data;
      }
    }
    if (row.scope === "diagnostic" && row.data && typeof row.data === "object") {
      const [playerId] = splitCompositeKey(row.record_key);
      if (playerId) (state.diagnostics[playerId] ??= []).push(row.data);
    }
    if (row.scope === "tactic" && row.data && typeof row.data === "object") {
      const tactic = row.data as { deleted?: unknown };
      if (tactic.deleted !== true) state.tactics[row.record_key] = row.data;
    }
  }

  state.roster.sort((a, b) => a.localeCompare(b, "de"));
  Object.values(state.diagnostics).forEach((history) => {
    history.sort((a, b) => String((b as { date?: unknown }).date ?? "").localeCompare(String((a as { date?: unknown }).date ?? "")));
  });
  return { state, revisions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validTacticLayout(value: unknown) {
  if (!isRecord(value) || !isRecord(value.positions) || !isRecord(value.ball)) return false;
  const validPoint = (point: unknown) => isRecord(point) && typeof point.x === "number" && Number.isFinite(point.x) && point.x >= 0 && point.x <= 100 && typeof point.y === "number" && Number.isFinite(point.y) && point.y >= 0 && point.y <= 100;
  const positionMap = value.positions as Record<string, unknown>;
  return ["st", "lf", "rf", "zm", "zdm", "lv", "iv", "rv", "tw"].every((id) => validPoint(positionMap[id])) && validPoint(value.ball);
}

function validOperation(value: unknown): value is Operation {
  if (!isRecord(value)) return false;
  if (typeof value.scope !== "string" || !allowedScopes.has(value.scope)) return false;
  if (typeof value.key !== "string" || value.key.length < 1 || value.key.length > 700) return false;
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0) return false;
  const serialized = JSON.stringify(value.value);
  if (typeof serialized !== "string" || serialized.length > 25_000) return false;

  if (value.scope === "roster") return typeof value.value === "string" && value.value.trim().length > 0 && value.value.length <= 30;
  if (value.scope === "attendance") return ["present", "excused", "absent"].includes(String(value.value));
  if (value.scope === "match_meta") {
    if (!isRecord(value.value) || typeof value.value.result !== "string" || value.value.result.length > 20) return false;
    const goalEvents = value.value.goalEvents;
    if (goalEvents === undefined) return true;
    return Array.isArray(goalEvents) && goalEvents.length <= 60 && goalEvents.every((goal) => isRecord(goal) &&
      typeof goal.id === "string" && goal.id.length >= 8 && goal.id.length <= 80 &&
      typeof goal.scorerId === "string" && /^[a-z0-9-]{1,80}$/.test(goal.scorerId) &&
      (goal.assistId === null || (typeof goal.assistId === "string" && /^[a-z0-9-]{1,80}$/.test(goal.assistId))) &&
      typeof goal.createdAt === "string" && goal.createdAt.length <= 40);
  }
  if (value.scope === "match_entry") {
    return isRecord(value.value) && typeof value.value.appearance === "boolean" &&
      Number.isInteger(value.value.goals) && Number(value.value.goals) >= 0 && Number(value.value.goals) <= 30 &&
      Number.isInteger(value.value.assists) && Number(value.value.assists) >= 0 && Number(value.value.assists) <= 30;
  }
  if (value.scope === "profile") {
    if (!isRecord(value.value)) return false;
    const positions = new Set(["", "TW", "IV", "LV", "RV", "ZDM", "ZM", "LF", "RF", "ST"]);
    return typeof value.value.id === "string" && value.value.id === value.key &&
      typeof value.value.firstName === "string" && value.value.firstName.trim().length > 0 && value.value.firstName.length <= 30 &&
      typeof value.value.shirtNumber === "string" && /^\d{0,3}$/.test(value.value.shirtNumber) &&
      typeof value.value.primaryPosition === "string" && positions.has(value.value.primaryPosition) &&
      typeof value.value.secondaryPosition === "string" && positions.has(value.value.secondaryPosition) &&
      typeof value.value.strongFoot === "string" && ["", "left", "right", "both"].includes(value.value.strongFoot) &&
      typeof value.value.personality === "string" && value.value.personality.length <= 500;
  }
  if (value.scope === "diagnostic") {
    if (!isRecord(value.value) || typeof value.value.id !== "string" || typeof value.value.date !== "string") return false;
    const diagnostic = value.value;
    return ["sprint5", "sprint10", "sprint20", "agility", "endurance", "jump"].every((field) => {
      const item = diagnostic[field];
      return item === null || (typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 10_000);
    });
  }
  if (value.scope === "tactic") {
    if (["attack", "defense", "corner"].includes(value.key)) return validTacticLayout(value.value);
    if (!/^custom-[a-z0-9-]{8,80}$/.test(value.key) || !isRecord(value.value)) return false;
    const tactic = value.value;
    const templates = ["attack", "defense", "corner", "blank"];
    return tactic.id === value.key && typeof tactic.name === "string" && tactic.name.trim().length > 0 && tactic.name.length <= 40 && templates.includes(String(tactic.baseScenario)) && validTacticLayout(tactic.layout) && (tactic.deleted === undefined || typeof tactic.deleted === "boolean");
  }
  return false;
}

async function legacyState(url: string, key: string) {
  const response = await fetch(`${url}/rest/v1/coaching_state?select=data,updated_at&id=eq.${SEASON_ID}`, {
    headers: supabaseHeaders(key), cache: "no-store",
  });
  if (!response.ok) return { state: emptyState(), updatedAt: undefined };
  const rows = (await response.json()) as Array<{ data?: unknown; updated_at?: string }>;
  return { state: isRecord(rows[0]?.data) ? rows[0].data : emptyState(), updatedAt: rows[0]?.updated_at };
}

export async function GET() {
  if (!(await isAuthenticated())) return privateJson({ error: "Nicht angemeldet." }, { status: 401 });
  const { url, key } = await getSupabaseConfig();
  if (!url || !key) return privateJson({ state: emptyState(), connected: false, setupRequired: true });

  try {
    const response = await fetch(
      `${url}/rest/v1/coaching_records?select=scope,record_key,data,revision,updated_at&season_id=eq.${SEASON_ID}`,
      { headers: supabaseHeaders(key), cache: "no-store" },
    );
    if (!response.ok) {
      const legacy = await legacyState(url, key);
      return privateJson({ ...legacy, revisions: {}, connected: true, migrationRequired: true });
    }
    const rows = (await response.json()) as RecordRow[];
    const assembled = assembleState(rows);
    return privateJson({
      ...assembled,
      connected: true,
      migrationRequired: false,
      updatedAt: rows.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, ""),
    });
  } catch (error) {
    console.error("coaching_state_read_failed", { message: error instanceof Error ? error.message : "unknown" });
    return privateJson({ error: "Coaching-Daten konnten nicht geladen werden." }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  if (!(await isAuthenticated())) return privateJson({ error: "Nicht angemeldet." }, { status: 401 });
  const { url, key } = await getSupabaseConfig();
  if (!url || !key) return privateJson({ error: "Supabase ist nicht verbunden." }, { status: 503 });

  try {
    const body = (await request.json()) as { operations?: unknown };
    if (!Array.isArray(body.operations) || body.operations.length < 1 || body.operations.length > 40 || !body.operations.every(validOperation)) {
      return privateJson({ error: "Ungültige Änderung." }, { status: 400 });
    }

    const revisions: Record<string, number> = {};
    for (const operation of body.operations) {
      const response = await fetch(`${url}/rest/v1/rpc/apply_coaching_record`, {
        method: "POST",
        headers: supabaseHeaders(key),
        cache: "no-store",
        body: JSON.stringify({
          p_season_id: SEASON_ID,
          p_scope: operation.scope,
          p_record_key: operation.key,
          p_data: operation.value,
          p_expected_revision: operation.expectedRevision,
          p_actor: "trainer",
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        if (detail.includes("revision_conflict") || detail.includes("40001")) {
          return privateJson({ error: "Dieser Eintrag wurde zwischenzeitlich geändert. Die aktuellen Daten werden neu geladen.", conflict: true }, { status: 409 });
        }
        if (response.status === 404 || detail.includes("apply_coaching_record")) {
          return privateJson({ error: "Die Sicherheitsmigration Phase 3 fehlt noch.", migrationRequired: true }, { status: 409 });
        }
        if (detail.includes("invalid_scope") || detail.includes("coaching_records_scope_check")) {
          return privateJson({ error: "Die Supabase-Erweiterung für Taktiken fehlt noch.", migrationRequired: true }, { status: 409 });
        }
        throw new Error(`Supabase ${response.status}: ${detail.slice(0, 160)}`);
      }
      const result = (await response.json()) as Array<{ revision?: number }>;
      revisions[`${operation.scope}:${operation.key}`] = Number(result[0]?.revision ?? operation.expectedRevision + 1);
    }
    return privateJson({ saved: true, revisions });
  } catch (error) {
    console.error("coaching_state_write_failed", { message: error instanceof Error ? error.message : "unknown" });
    return privateJson({ error: "Coaching-Daten konnten nicht gespeichert werden." }, { status: 502 });
  }
}
