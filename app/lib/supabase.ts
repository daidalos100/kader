type RuntimeEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
};

export async function getSupabaseConfig() {
  const nodeRuntime = process.env as RuntimeEnv;
  if (nodeRuntime.SUPABASE_URL || nodeRuntime.SUPABASE_SECRET_KEY || nodeRuntime.SUPABASE_PUBLISHABLE_KEY) {
    return {
      url: nodeRuntime.SUPABASE_URL?.trim().replace(/\/$/, ""),
      key: (nodeRuntime.SUPABASE_SECRET_KEY ?? nodeRuntime.SUPABASE_PUBLISHABLE_KEY)?.trim(),
    };
  }

  try {
    const cloudflare = await import("cloudflare:workers");
    const runtime = cloudflare.env as unknown as RuntimeEnv;
    return {
      url: runtime.SUPABASE_URL?.trim().replace(/\/$/, ""),
      key: (runtime.SUPABASE_SECRET_KEY ?? runtime.SUPABASE_PUBLISHABLE_KEY)?.trim(),
    };
  } catch {
    return { url: undefined, key: undefined };
  }
}

export function supabaseHeaders(key: string, extra?: Record<string, string>) {
  return {
    apikey: key,
    ...(key.startsWith("sb_") ? {} : { authorization: `Bearer ${key}` }),
    "content-type": "application/json",
    ...extra,
  };
}
