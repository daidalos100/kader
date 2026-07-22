export const dynamic = "force-dynamic";

import { isAuthenticated } from "../../auth";
import { getSupabaseConfig, supabaseHeaders } from "../../lib/supabase";

const SEASON_ID = "d1-2026-27";

async function snapshot() {
  const { url, key } = await getSupabaseConfig();
  if (!url || !key) throw new Error("Supabase ist nicht verbunden.");
  const [recordsResponse, lineupResponse] = await Promise.all([
    fetch(`${url}/rest/v1/coaching_records?select=scope,record_key,data,revision,updated_at&season_id=eq.${SEASON_ID}`, {
      headers: supabaseHeaders(key), cache: "no-store",
    }),
    fetch(`${url}/rest/v1/lineup_positions?select=lineup_id,position_id,players,revision,updated_at`, {
      headers: supabaseHeaders(key), cache: "no-store",
    }),
  ]);
  if (!recordsResponse.ok || !lineupResponse.ok) throw new Error("Sicherheitsmigration fehlt.");
  return {
    seasonId: SEASON_ID,
    exportedAt: new Date().toISOString(),
    records: await recordsResponse.json(),
    lineups: await lineupResponse.json(),
  };
}

export async function GET() {
  if (!(await isAuthenticated())) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  try {
    const payload = await snapshot();
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="tsg-d1-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        "cache-control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Backup fehlgeschlagen." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorizedCron = Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
  if (!authorizedCron && !(await isAuthenticated())) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  try {
    const payload = await snapshot();
    const { url, key } = await getSupabaseConfig();
    const response = await fetch(`${url}/rest/v1/coaching_backups`, {
      method: "POST",
      headers: supabaseHeaders(key!, { prefer: "return=minimal" }),
      body: JSON.stringify({ season_id: SEASON_ID, payload, created_by: authorizedCron ? "vercel-cron" : "trainer" }),
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}`);
    return Response.json({ backedUp: true }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("backup_failed", { message: error instanceof Error ? error.message : "unknown" });
    return Response.json({ error: "Backup konnte nicht erstellt werden." }, { status: 502 });
  }
}
