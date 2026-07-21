export const dynamic = "force-dynamic";

type Player = { id: string; firstName: string };
type RuntimeEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
};

const positionIds = new Set(["st", "lf", "rf", "zm", "zdm", "lv", "iv", "rv", "tw"]);

async function config() {
  const cloudflare = await import("cloudflare:workers");
  const runtime = cloudflare.env as unknown as RuntimeEnv;
  const url = runtime.SUPABASE_URL?.replace(/\/$/, "");
  const key = runtime.SUPABASE_SECRET_KEY;
  return url && key ? { url, key } : null;
}

function headers(key: string, extra?: Record<string, string>) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...extra,
  };
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

export async function GET() {
  const supabase = await config();
  if (!supabase) {
    return Response.json({ lineup: {}, connected: false });
  }

  try {
    const response = await fetch(
      `${supabase.url}/rest/v1/lineup_positions?select=position_id,players&lineup_id=eq.default`,
      { headers: headers(supabase.key), cache: "no-store" },
    );

    if (!response.ok) {
      throw new Error(`Supabase responded with ${response.status}`);
    }

    const rows = (await response.json()) as Array<{ position_id: string; players: Player[] }>;
    const lineup = Object.fromEntries(
      rows
        .filter((row) => positionIds.has(row.position_id) && validPlayers(row.players))
        .map((row) => [row.position_id, row.players]),
    );

    return Response.json({ lineup, connected: true });
  } catch {
    return Response.json(
      { error: "Die Supabase-Aufstellung konnte nicht geladen werden." },
      { status: 502 },
    );
  }
}

export async function PATCH(request: Request) {
  const supabase = await config();
  if (!supabase) {
    return Response.json({ connected: false });
  }

  try {
    const payload = (await request.json()) as { positionId?: unknown; players?: unknown };
    if (typeof payload.positionId !== "string" || !positionIds.has(payload.positionId)) {
      return Response.json({ error: "Unbekannte Position." }, { status: 400 });
    }
    if (!validPlayers(payload.players)) {
      return Response.json({ error: "Ungültige Spielerliste." }, { status: 400 });
    }

    const players = payload.players.map((player) => ({
      id: player.id,
      firstName: player.firstName.trim(),
    }));
    const response = await fetch(`${supabase.url}/rest/v1/lineup_positions?on_conflict=lineup_id,position_id`, {
      method: "POST",
      headers: headers(supabase.key, {
        prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify({
        lineup_id: "default",
        position_id: payload.positionId,
        players,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Supabase responded with ${response.status}`);
    }

    return Response.json({ connected: true });
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
