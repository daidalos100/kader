export const dynamic = "force-dynamic";

import { getSupabaseConfig, supabaseHeaders } from "../../lib/supabase";

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    const { url, key } = await getSupabaseConfig();
    if (!url || !key) throw new Error("configuration");
    const response = await fetch(`${url}/rest/v1/coaching_records?select=season_id&limit=1`, {
      headers: supabaseHeaders(key), cache: "no-store",
    });
    if (!response.ok) throw new Error("database");
    return Response.json({ status: "ok", checkedAt }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ status: "degraded", checkedAt }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
