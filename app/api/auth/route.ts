import {
  anonymousClientHash, authMode, createPinSession, createTrainerSession, pinIsValid, sessionCookieName,
  sessionMaxAgeSeconds, trainerForEmail,
} from "../../auth";
import { getSupabaseConfig, supabaseHeaders } from "../../lib/supabase";

const memoryAttempts = new Map<string, { attempts: number; startedAt: number; blockedUntil: number }>();

function privateJson(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("pragma", "no-cache");
  return Response.json(value, { ...init, headers });
}

function sessionResponse() {
  return `Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${sessionMaxAgeSeconds}`;
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

function authHeaders(key: string, accessToken?: string) {
  return {
    apikey: key,
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    "content-type": "application/json",
  };
}

async function requestEmailLogin(email: string, origin: string) {
  const trainer = await trainerForEmail(email);
  const { url, key } = await getSupabaseConfig();
  if (!trainer || !url || !key) return { ok: false, status: 503 };

  const redirectTo = `${origin}/auth/callback`;
  const otp = await fetch(`${url}/auth/v1/otp`, {
    method: "POST",
    headers: authHeaders(key),
    cache: "no-store",
    body: JSON.stringify({ email: trainer.email, create_user: false, gotrue_meta_security: {}, redirect_to: redirectTo }),
  });
  if (otp.ok) return { ok: true, status: 200 };

  // Für eine freigegebene, aber noch nicht eingeladene Adresse wird genau einmal
  // ein Auth-Konto erzeugt. Nicht freigegebene Adressen gelangen nie hierher.
  const invitation = await fetch(`${url}/auth/v1/invite`, {
    method: "POST",
    headers: authHeaders(key),
    cache: "no-store",
    body: JSON.stringify({ email: trainer.email, data: { name: trainer.name, role: trainer.role }, redirect_to: redirectTo }),
  });
  return { ok: invitation.ok, status: invitation.status };
}

async function finishEmailLogin(accessToken: string) {
  if (accessToken.length < 40 || accessToken.length > 8_192) return null;
  const { url, key } = await getSupabaseConfig();
  if (!url || !key) return null;
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: authHeaders(key, accessToken),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const user = (await response.json().catch(() => null)) as { email?: unknown } | null;
  return typeof user?.email === "string" ? trainerForEmail(user.email) : null;
}

export async function GET() {
  return privateJson({ mode: await authMode() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { pin?: unknown; email?: unknown; accessToken?: unknown } | null;
  const mode = await authMode();
  const clientHash = await anonymousClientHash(request);

  if (mode === "otp") {
    if (typeof body?.accessToken === "string") {
      const trainer = await finishEmailLogin(body.accessToken);
      const rate = await consumeAttempt(clientHash, Boolean(trainer));
      if (!rate.allowed) return privateJson({ error: "Zu viele Versuche. Bitte später erneut versuchen." }, { status: 429, headers: { "retry-after": String(Math.max(1, rate.retryAfter)) } });
      if (!trainer) return privateJson({ error: "Der Anmeldelink ist ungültig oder abgelaufen." }, { status: 401 });
      const session = await createTrainerSession(trainer);
      if (!session) return privateJson({ error: "Zugang ist noch nicht vollständig konfiguriert." }, { status: 503 });
      return privateJson(
        { authorized: true, trainer: { name: trainer.name, role: trainer.role } },
        { headers: { "set-cookie": `${sessionCookieName}=${session}; ${sessionResponse()}` } },
      );
    }

    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const allowed = Boolean(email && await trainerForEmail(email));
    const rate = await consumeAttempt(clientHash, allowed);
    if (!rate.allowed) return privateJson({ error: "Zu viele Versuche. Bitte später erneut versuchen." }, { status: 429, headers: { "retry-after": String(Math.max(1, rate.retryAfter)) } });
    if (!allowed) return privateJson({ error: "Diese E-Mail-Adresse ist nicht für das Coaching Tool freigegeben." }, { status: 403 });
    const result = await requestEmailLogin(email, new URL(request.url).origin);
    if (!result.ok) return privateJson({ error: "Die Anmelde-E-Mail konnte gerade nicht versendet werden. Bitte erneut versuchen." }, { status: 502 });
    return privateJson({ dispatched: true });
  }

  const provided = typeof body?.pin === "string" ? body.pin : "";
  const valid = await pinIsValid(provided);
  const rate = await consumeAttempt(clientHash, valid);
  if (!rate.allowed) return privateJson({ error: "Zu viele Versuche. Bitte später erneut versuchen." }, { status: 429, headers: { "retry-after": String(Math.max(1, rate.retryAfter)) } });
  if (!valid) return privateJson({ error: "PIN ist nicht korrekt." }, { status: 401 });
  const session = await createPinSession();
  if (!session) return privateJson({ error: "Zugang ist noch nicht konfiguriert." }, { status: 503 });
  return privateJson(
    { authorized: true },
    { headers: { "set-cookie": `${sessionCookieName}=${session}; ${sessionResponse()}` } },
  );
}

export async function DELETE() {
  return privateJson(
    { authorized: false },
    { headers: { "set-cookie": `${sessionCookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` } },
  );
}
