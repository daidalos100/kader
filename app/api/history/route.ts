export const dynamic = "force-dynamic";

import { currentTrainer, isAuthenticated } from "../../auth";
import { getSupabaseConfig, supabaseHeaders } from "../../lib/supabase";

const SEASON_ID = "d1-2026-27";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function goalEventsFrom(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.goalEvents) || value.goalEvents.length < 1) return null;
  const valid = value.goalEvents.every((goal) => isRecord(goal) &&
    typeof goal.id === "string" && goal.id.length >= 8 && goal.id.length <= 80 &&
    typeof goal.scorerId === "string" && /^[a-z0-9-]{1,80}$/.test(goal.scorerId) &&
    (goal.assistId === null || (typeof goal.assistId === "string" && /^[a-z0-9-]{1,80}$/.test(goal.assistId))) &&
    typeof goal.createdAt === "string" && goal.createdAt.length <= 40,
  );
  return valid ? value.goalEvents : null;
}

function privateJson(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  return Response.json(value, { ...init, headers });
}

export async function GET() {
  if (!(await isAuthenticated())) return privateJson({ error: "Nicht angemeldet." }, { status: 401 });
  const { url, key } = await getSupabaseConfig();
  if (!url || !key) return privateJson({ history: [], connected: false });
  try {
    const response = await fetch(
      `${url}/rest/v1/coaching_history?select=id,scope,record_key,revision,changed_at,changed_by&season_id=eq.${SEASON_ID}&order=changed_at.desc&limit=30`,
      { headers: supabaseHeaders(key), cache: "no-store" },
    );
    if (!response.ok) return privateJson({ history: [], migrationRequired: true });
    return privateJson({ history: await response.json(), connected: true });
  } catch (error) {
    console.error("history_read_failed", { message: error instanceof Error ? error.message : "unknown" });
    return privateJson({ error: "Änderungsverlauf konnte nicht geladen werden." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return privateJson({ error: "Nicht angemeldet." }, { status: 401 });
  const trainer = await currentTrainer();
  const actor = trainer?.name ?? "trainer";
  const body = (await request.json().catch(() => null)) as { historyId?: unknown; action?: unknown; eventId?: unknown } | null;
  const { url, key } = await getSupabaseConfig();
  if (!url || !key) return privateJson({ error: "Supabase ist nicht verbunden." }, { status: 503 });
  if (body?.action === "restore_match_goal_events") {
    if (trainer?.role !== "admin") return privateJson({ error: "Nur der Admin darf Tore aus dem Verlauf wiederherstellen." }, { status: 403 });
    if (typeof body.eventId !== "string" || body.eventId.length < 1 || body.eventId.length > 700) {
      return privateJson({ error: "Ungültiger Spieltermin." }, { status: 400 });
    }
    try {
      const historyFilters = new URLSearchParams({
        select: "before_data,after_data,changed_at",
        season_id: `eq.${SEASON_ID}`,
        scope: "eq.match_meta",
        record_key: `eq.${body.eventId}`,
        order: "changed_at.desc",
        limit: "100",
      });
      const historyResponse = await fetch(`${url}/rest/v1/coaching_history?${historyFilters.toString()}`, {
        headers: supabaseHeaders(key), cache: "no-store",
      });
      if (!historyResponse.ok) throw new Error(`Supabase ${historyResponse.status}`);
      const changes = (await historyResponse.json()) as Array<{ before_data?: unknown; after_data?: unknown }>;
      let recovered: unknown[] | null = null;
      let historicResult = "";
      for (const change of changes) {
        const candidates = [change.before_data, change.after_data];
        for (const candidate of candidates) {
          const goalEvents = goalEventsFrom(candidate);
          if (!goalEvents) continue;
          recovered = goalEvents;
          historicResult = isRecord(candidate) && typeof candidate.result === "string" ? candidate.result.slice(0, 20) : "";
          break;
        }
        if (recovered) break;
      }
      if (!recovered) return privateJson({ error: "Im Änderungsverlauf wurden keine vollständigen Torereignisse gefunden." }, { status: 404 });

      const recordFilters = new URLSearchParams({
        select: "data,revision",
        season_id: `eq.${SEASON_ID}`,
        scope: "eq.match_meta",
        record_key: `eq.${body.eventId}`,
        limit: "1",
      });
      const recordResponse = await fetch(`${url}/rest/v1/coaching_records?${recordFilters.toString()}`, {
        headers: supabaseHeaders(key), cache: "no-store",
      });
      if (!recordResponse.ok) throw new Error(`Supabase ${recordResponse.status}`);
      const records = (await recordResponse.json()) as Array<{ data?: unknown; revision?: unknown }>;
      const current = isRecord(records[0]?.data) ? records[0].data : {};
      const expectedRevision = typeof records[0]?.revision === "number" && Number.isSafeInteger(records[0]?.revision) ? records[0].revision : 0;
      const result = typeof current.result === "string" ? current.result.slice(0, 20) : historicResult;
      const saveResponse = await fetch(`${url}/rest/v1/rpc/apply_coaching_record`, {
        method: "POST",
        headers: supabaseHeaders(key),
        cache: "no-store",
        body: JSON.stringify({
          p_season_id: SEASON_ID,
          p_scope: "match_meta",
          p_record_key: body.eventId,
          p_data: { result, goalEvents: recovered },
          p_expected_revision: expectedRevision,
          p_actor: `${actor} (Torverlauf wiederhergestellt)`,
        }),
      });
      if (!saveResponse.ok) throw new Error(`Supabase ${saveResponse.status}`);
      return privateJson({ restored: true, restoredGoals: recovered.length });
    } catch (error) {
      console.error("match_goal_history_restore_failed", { message: error instanceof Error ? error.message : "unknown" });
      return privateJson({ error: "Die Torereignisse konnten nicht aus dem Verlauf wiederhergestellt werden." }, { status: 502 });
    }
  }
  if (body?.action === "reassign_legacy_julia") {
    if (trainer?.role !== "admin") return privateJson({ error: "Nur der Admin darf den Verlauf korrigieren." }, { status: 403 });
    const filters = new URLSearchParams({
      season_id: `eq.${SEASON_ID}`,
      changed_by: "eq.Frank",
      scope: "in.(tactic,match_meta,match_entry)",
      // Ausschließlich die vor der Login-Korrektur am 25.07. vorhandenen Einträge.
      changed_at: "lt.2026-07-24T22:00:00.000Z",
    });
    try {
      const response = await fetch(`${url}/rest/v1/coaching_history?${filters.toString()}`, {
        method: "PATCH",
        headers: supabaseHeaders(key, { prefer: "return=representation" }),
        cache: "no-store",
        body: JSON.stringify({ changed_by: "Julia" }),
      });
      if (!response.ok) throw new Error(`Supabase ${response.status}`);
      const corrected = (await response.json().catch(() => [])) as unknown[];
      return privateJson({ corrected: corrected.length });
    } catch (error) {
      console.error("history_reassign_failed", { message: error instanceof Error ? error.message : "unknown" });
      return privateJson({ error: "Die bisherigen Einträge konnten nicht zugeordnet werden." }, { status: 502 });
    }
  }
  if (!body || !Number.isSafeInteger(body.historyId) || Number(body.historyId) < 1) {
    return privateJson({ error: "Ungültiger Verlaufseintrag." }, { status: 400 });
  }
  try {
    const response = await fetch(`${url}/rest/v1/rpc/restore_coaching_history`, {
      method: "POST",
      headers: supabaseHeaders(key),
      cache: "no-store",
      body: JSON.stringify({ p_history_id: body.historyId, p_actor: `${actor} (Wiederherstellung)` }),
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}`);
    return privateJson({ restored: true });
  } catch (error) {
    console.error("history_restore_failed", { message: error instanceof Error ? error.message : "unknown" });
    return privateJson({ error: "Der frühere Stand konnte nicht wiederhergestellt werden." }, { status: 502 });
  }
}
