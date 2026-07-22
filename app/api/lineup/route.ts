export const dynamic = "force-dynamic";

import { isAuthenticated } from "../../auth";
import { getSupabaseConfig, supabaseHeaders } from "../../lib/supabase";

type Player = { id: string; firstName: string };
const positionIds = new Set(["st", "lf", "rf", "zm", "zdm", "lv", "iv", "rv", "tw"]);

function validLineupId(value: string) {
  return value === "default" || /^event-[a-zA-Z0-9._:-]{8,220}$/.test(value);
}

function validPlayers(value: unknown): value is Player[] {
  return Array.isArray(value) && value.length <= 3 && value.every((player) => {
    if (!player || typeof player !== "object") return false;
    const candidate = player as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      candidate.id.length >= 8 &&
      typeof candidate.firstName === "string" &&
      candidate.firstName.trim().length > 0 &&
      candidate.firstName.trim().length <= 30
    );
  });
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  }
  const lineupId = new URL(request.url).searchParams.get("lineupId") ?? "default";
  if (!validLineupId(lineupId)) return Response.json({ error: "Ungültige Aufstellung." }, { status: 400 });

  const supabase = await getSupabaseConfig();
  if (!supabase.url || !supabase.key) {
    return Response.json({ lineup: {}, connected: false });
  }

  try {
    let response = await fetch(
      `${supabase.url}/rest/v1/lineup_positions?select=position_id,players,revision&lineup_id=eq.${encodeURIComponent(lineupId)}`,
      { headers: supabaseHeaders(supabase.key), cache: "no-store" },
    );

    if (!response.ok) {
      response = await fetch(
        `${supabase.url}/rest/v1/lineup_positions?select=position_id,players&lineup_id=eq.${encodeURIComponent(lineupId)}`,
        { headers: supabaseHeaders(supabase.key), cache: "no-store" },
      );
      if (!response.ok) throw new Error(`Supabase responded with ${response.status}`);
    }

    const rows = (await response.json()) as Array<{ position_id: string; players: Player[]; revision?: number }>;
    const lineup = Object.fromEntries(
      rows
        .filter((row) => positionIds.has(row.position_id) && validPlayers(row.players))
        .map((row) => [row.position_id, row.players]),
    );

    const revisions = Object.fromEntries(rows.map((row) => [row.position_id, Number(row.revision ?? 0)]));
    return Response.json({ lineup, revisions, connected: true, migrationRequired: rows.some((row) => row.revision === undefined) }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json(
      { error: "Die Supabase-Aufstellung konnte nicht geladen werden." },
      { status: 502 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  }
  const supabase = await getSupabaseConfig();
  if (!supabase.url || !supabase.key) {
    return Response.json({ connected: false });
  }
  try {
    const payload = (await request.json()) as { lineupId?: unknown; positionId?: unknown; players?: unknown; expectedRevision?: unknown };
    const lineupId = typeof payload.lineupId === "string" ? payload.lineupId : "default";
    if (!validLineupId(lineupId)) {
      return Response.json({ error: "Ungültige Aufstellung." }, { status: 400 });
    }
    if (typeof payload.positionId !== "string" || !positionIds.has(payload.positionId)) {
      return Response.json({ error: "Unbekannte Position." }, { status: 400 });
    }
    if (!validPlayers(payload.players)) {
      return Response.json({ error: "Ungültige Spielerliste." }, { status: 400 });
    }
    if (!Number.isSafeInteger(payload.expectedRevision) || Number(payload.expectedRevision) < 0) {
      return Response.json({ error: "Ungültige Revision." }, { status: 400 });
    }

    const players = payload.players.map((player) => ({
      id: player.id,
      firstName: player.firstName.trim(),
    }));
    const response = await fetch(`${supabase.url}/rest/v1/rpc/apply_lineup_position`, {
      method: "POST",
      headers: supabaseHeaders(supabase.key),
      body: JSON.stringify({
        p_lineup_id: lineupId,
        p_position_id: payload.positionId,
        p_players: players,
        p_expected_revision: payload.expectedRevision,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      if (detail.includes("revision_conflict") || detail.includes("40001")) {
        return Response.json({ error: "Diese Position wurde gerade von einem anderen Trainer geändert.", conflict: true }, { status: 409 });
      }
      if (response.status === 404 || detail.includes("apply_lineup_position")) {
        return Response.json({ error: "Die Sicherheitsmigration Phase 3 fehlt noch.", migrationRequired: true }, { status: 409 });
      }
      throw new Error(`Supabase responded with ${response.status}`);
    }

    const result = (await response.json()) as Array<{ revision?: number }>;
    return Response.json({ connected: true, revision: Number(result[0]?.revision ?? Number(payload.expectedRevision) + 1) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
    }
    return Response.json(
      { error: "Die Änderung konnte nicht in Supabase gespeichert werden." },
      { status: 502 },
    );
  }
}
