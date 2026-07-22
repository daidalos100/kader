export const dynamic = "force-dynamic";

import { isAuthenticated } from "../../auth";
import { getSupabaseConfig, supabaseHeaders } from "../../lib/supabase";

const STATE_ID = "d1-2026-27";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function GET() {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const { url, key } = await getSupabaseConfig();
  if (!url || !key) return Response.json({ state: {}, connected: false, setupRequired: true });

  try {
    const response = await fetch(
      `${url}/rest/v1/coaching_state?select=data,updated_at&id=eq.${STATE_ID}`,
      { headers: supabaseHeaders(key), cache: "no-store" },
    );
    if (!response.ok) {
      return Response.json({ state: {}, connected: true, setupRequired: true });
    }
    const rows = (await response.json()) as Array<{ data?: unknown; updated_at?: string }>;
    return Response.json({
      state: isRecord(rows[0]?.data) ? rows[0].data : {},
      connected: true,
      setupRequired: rows.length === 0,
      updatedAt: rows[0]?.updated_at,
    });
  } catch {
    return Response.json({ error: "Coaching-Daten konnten nicht geladen werden." }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const { url, key } = await getSupabaseConfig();
  if (!url || !key) return Response.json({ error: "Supabase ist nicht verbunden." }, { status: 503 });

  try {
    const body = (await request.json()) as { state?: unknown };
    if (!isRecord(body.state) || JSON.stringify(body.state).length > 1_500_000) {
      return Response.json({ error: "Ungültige Coaching-Daten." }, { status: 400 });
    }

    const response = await fetch(`${url}/rest/v1/coaching_state?on_conflict=id`, {
      method: "POST",
      headers: supabaseHeaders(key, { prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ id: STATE_ID, data: body.state, updated_at: new Date().toISOString() }),
    });
    if (!response.ok) {
      const setupRequired = response.status === 404 || response.status === 400;
      return Response.json(
        { error: setupRequired ? "Phase-2-Tabelle fehlt in Supabase." : "Speichern fehlgeschlagen.", setupRequired },
        { status: setupRequired ? 409 : 502 },
      );
    }
    return Response.json({ saved: true, connected: true, updatedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Ungültige Anfrage." }, { status: 400 });
    return Response.json({ error: "Coaching-Daten konnten nicht gespeichert werden." }, { status: 502 });
  }
}
