import {
  anonymousClientHash, createSession, pinIsValid, sessionCookieName, sessionMaxAgeSeconds,
} from "../../auth";
import { getSupabaseConfig, supabaseHeaders } from "../../lib/supabase";

const memoryAttempts = new Map<string, { attempts: number; startedAt: number; blockedUntil: number }>();

function privateJson(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("pragma", "no-cache");
  return Response.json(value, { ...init, headers });
}

function memoryRateLimit(clientHash: string, success: boolean) {
  const now = Date.now();
  if (memoryAttempts.size > 5_000) memoryAttempts.clear();
  const current = memoryAttempts.get(clientHash);
  if (current?.blockedUntil && current.blockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((current.blockedUntil - now) / 1000) };
  }
  if (success) {
    memoryAttempts.delete(clientHash);
    return { allowed: true, retryAfter: 0 };
  }
  const item = !current || current.startedAt < now - 900_000
    ? { attempts: 1, startedAt: now, blockedUntil: 0 }
    : { ...current, attempts: current.attempts + 1 };
  if (item.attempts >= 5) item.blockedUntil = now + 900_000;
  memoryAttempts.set(clientHash, item);
  return { allowed: item.attempts < 5, retryAfter: item.attempts >= 5 ? 900 : 0 };
}

async function consumeAttempt(clientHash: string, success: boolean) {
  const { url, key } = await getSupabaseConfig();
  if (url && key) {
    try {
      const response = await fetch(`${url}/rest/v1/rpc/consume_login_attempt`, {
        method: "POST",
        headers: supabaseHeaders(key),
        cache: "no-store",
        body: JSON.stringify({ p_client_hash: clientHash, p_success: success }),
      });
      if (response.ok) {
        const result = (await response.json()) as Array<{ allowed?: boolean; retry_after_seconds?: number }>;
        return { allowed: Boolean(result[0]?.allowed), retryAfter: Number(result[0]?.retry_after_seconds ?? 0) };
      }
    } catch (error) {
      console.error("login_rate_limit_fallback", { message: error instanceof Error ? error.message : "unknown" });
    }
  }
  return memoryRateLimit(clientHash, success);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { pin?: unknown } | null;
  const provided = body && typeof body.pin === "string" ? body.pin : "";
  const [clientHash, valid] = await Promise.all([anonymousClientHash(request), pinIsValid(provided)]);
  const rate = await consumeAttempt(clientHash, valid);
  if (!rate.allowed) {
    return privateJson(
      { error: "Zu viele Versuche. Bitte später erneut versuchen." },
      { status: 429, headers: { "retry-after": String(Math.max(1, rate.retryAfter)) } },
    );
  }
  if (!valid) return privateJson({ error: "PIN ist nicht korrekt." }, { status: 401 });

  const session = await createSession();
  if (!session) return privateJson({ error: "Zugang ist noch nicht konfiguriert." }, { status: 503 });

  return privateJson(
    { authorized: true },
    { headers: { "set-cookie": `${sessionCookieName}=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${sessionMaxAgeSeconds}` } },
  );
}

export async function DELETE() {
  return privateJson(
    { authorized: false },
    { headers: { "set-cookie": `${sessionCookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` } },
  );
}
