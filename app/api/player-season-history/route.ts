export const dynamic = "force-dynamic";

import { isAuthenticated } from "../../auth";
import { getSupabaseConfig, supabaseHeaders } from "../../lib/supabase";

type SeasonHistoryRow = {
  player_id?: unknown;
  season_id?: unknown;
  season_label?: unknown;
  team_label?: unknown;
  training_present_count?: unknown;
  training_rate_percent?: unknown;
  appearance_count?: unknown;
  appearance_opportunities?: unknown;
  goals?: unknown;
};

function privateJson(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("pragma", "no-cache");
  return Response.json(value, { ...init, headers });
}

function integerOrNull(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export async function GET() {
  if (!(await isAuthenticated())) return privateJson({ error: "Nicht angemeldet." }, { status: 401 });
  const { url, key } = await getSupabaseConfig();
  if (!url || !key) return privateJson({ records: [], connected: false, setupRequired: true });

  try {
    const response = await fetch(
      `${url}/rest/v1/player_season_history?select=player_id,season_id,season_label,team_label,training_present_count,training_rate_percent,appearance_count,appearance_opportunities,goals&order=season_id.desc`,
      { headers: supabaseHeaders(key), cache: "no-store" },
    );
    // Die Historie ist eine optionale Erweiterung. Bis die einmalige SQL-Migration
    // ausgeführt wurde, bleibt das Coaching Tool deshalb vollständig nutzbar.
    if (!response.ok) return privateJson({ records: [], connected: true, setupRequired: true });
    const rows = (await response.json()) as SeasonHistoryRow[];
    const records = rows.flatMap((row) => {
      if (typeof row.player_id !== "string" || typeof row.season_id !== "string" || typeof row.season_label !== "string" || typeof row.team_label !== "string") return [];
      return [{
        playerId: row.player_id,
        seasonId: row.season_id,
        seasonLabel: row.season_label,
        teamLabel: row.team_label,
        trainingPresentCount: integerOrNull(row.training_present_count),
        trainingRatePercent: integerOrNull(row.training_rate_percent),
        appearanceCount: integerOrNull(row.appearance_count),
        appearanceOpportunities: integerOrNull(row.appearance_opportunities),
        goals: integerOrNull(row.goals),
      }];
    });
    return privateJson({ records, connected: true, setupRequired: false });
  } catch (error) {
    console.error("player_season_history_read_failed", { message: error instanceof Error ? error.message : "unknown" });
    return privateJson({ records: [], connected: false, setupRequired: true });
  }
}
