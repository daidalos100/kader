export const dynamic = "force-dynamic";

import { isAuthenticated } from "../../auth";
import { getSupabaseConfig, supabaseHeaders } from "../../lib/supabase";

type StoredPlayer = { firstName?: unknown };
type LineupRow = { players?: StoredPlayer[] };
type StorageObject = { name?: string };

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function displayNameFromSlug(value: string) {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function GET() {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const { url, key } = await getSupabaseConfig();
  if (!url || !key) return Response.json({ players: [], connected: false });

  try {
    const [stateResponse, lineupResponse, storageResponse] = await Promise.all([
      fetch(`${url}/rest/v1/coaching_state?select=data&id=eq.d1-2026-27`, {
        headers: supabaseHeaders(key), cache: "no-store",
      }),
      fetch(`${url}/rest/v1/lineup_positions?select=players&lineup_id=eq.default`, {
        headers: supabaseHeaders(key), cache: "no-store",
      }),
      fetch(`${url}/storage/v1/object/list/player-images`, {
        method: "POST",
        headers: supabaseHeaders(key),
        body: JSON.stringify({ prefix: "", limit: 200, offset: 0, sortBy: { column: "name", order: "asc" } }),
        cache: "no-store",
      }),
    ]);

    const exactNames = new Map<string, string>();
    if (stateResponse.ok) {
      const rows = (await stateResponse.json()) as Array<{ data?: { roster?: unknown; profiles?: unknown } }>;
      const data = rows[0]?.data;
      if (Array.isArray(data?.roster)) {
        data.roster.forEach((name) => {
          if (typeof name === "string" && name.trim()) exactNames.set(slugify(name), name.trim());
        });
      }
      if (data?.profiles && typeof data.profiles === "object") {
        Object.values(data.profiles as Record<string, StoredPlayer>).forEach((profile) => {
          if (typeof profile?.firstName === "string" && profile.firstName.trim()) {
            exactNames.set(slugify(profile.firstName), profile.firstName.trim());
          }
        });
      }
    }

    if (lineupResponse.ok) {
      const rows = (await lineupResponse.json()) as LineupRow[];
      rows.flatMap((row) => Array.isArray(row.players) ? row.players : []).forEach((player) => {
        if (typeof player.firstName === "string" && player.firstName.trim()) {
          exactNames.set(slugify(player.firstName), player.firstName.trim());
        }
      });
    }

    if (storageResponse.ok) {
      const objects = (await storageResponse.json()) as StorageObject[];
      objects.forEach((object) => {
        const match = object.name?.match(/^(.+)\.webp$/i);
        const slug = match?.[1];
        if (slug && slug !== "default" && !exactNames.has(slug)) {
          exactNames.set(slug, displayNameFromSlug(slug));
        }
      });
    }

    const players = [...exactNames.entries()]
      .map(([id, firstName]) => ({ id, firstName }))
      .sort((a, b) => a.firstName.localeCompare(b.firstName, "de"));

    return Response.json({ players, connected: true });
  } catch {
    return Response.json({ error: "Die Spielerliste konnte nicht geladen werden." }, { status: 502 });
  }
}
