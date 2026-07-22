export const dynamic = "force-dynamic";

import { isAuthenticated } from "../../auth";
import { getSupabaseConfig, supabaseHeaders } from "../../lib/supabase";

const SEASON_ID = "d1-2026-27";

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
  const body = (await request.json().catch(() => null)) as { historyId?: unknown } | null;
  if (!body || !Number.isSafeInteger(body.historyId) || Number(body.historyId) < 1) {
    return privateJson({ error: "Ungültiger Verlaufseintrag." }, { status: 400 });
  }
  const { url, key } = await getSupabaseConfig();
  if (!url || !key) return privateJson({ error: "Supabase ist nicht verbunden." }, { status: 503 });
  try {
    const response = await fetch(`${url}/rest/v1/rpc/restore_coaching_history`, {
      method: "POST",
      headers: supabaseHeaders(key),
      cache: "no-store",
      body: JSON.stringify({ p_history_id: body.historyId, p_actor: "trainer (Wiederherstellung)" }),
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}`);
    return privateJson({ restored: true });
  } catch (error) {
    console.error("history_restore_failed", { message: error instanceof Error ? error.message : "unknown" });
    return privateJson({ error: "Der frühere Stand konnte nicht wiederhergestellt werden." }, { status: 502 });
  }
}
