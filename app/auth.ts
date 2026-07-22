import { cookies } from "next/headers";

type RuntimeEnv = { EDIT_PIN?: string };

export const sessionCookieName = "tsg_kader_session";
export const sessionMaxAgeSeconds = 60 * 60 * 12;

async function editPin() {
  const nodePin = (process.env as RuntimeEnv).EDIT_PIN?.trim();
  if (nodePin) return nodePin;
  if (process.env.VERCEL) return undefined;
  const cloudflare = await import("cloudflare:workers");
  return (cloudflare.env as unknown as RuntimeEnv).EDIT_PIN?.trim();
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digest(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function safeEqual(left: string, right: string) {
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function pinIsValid(provided: string) {
  const pin = await editPin();
  if (!pin || !provided || provided.length > 128) return false;
  const [left, right] = await Promise.all([digest(provided), digest(pin)]);
  return safeEqual(left, right);
}

export async function createSession() {
  const pin = await editPin();
  if (!pin) return null;
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const payload = `${Date.now()}.${nonce}`;
  return `${payload}.${await sign(payload, pin)}`;
}

async function validSession(value?: string) {
  const pin = await editPin();
  if (!pin || !value || value.length > 256) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const issuedAt = Number(parts[0]);
  if (!Number.isFinite(issuedAt) || issuedAt > Date.now() + 300_000 || Date.now() - issuedAt > sessionMaxAgeSeconds * 1000) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  return safeEqual(parts[2], await sign(payload, pin));
}

export async function isAuthenticated() {
  return validSession((await cookies()).get(sessionCookieName)?.value);
}

export async function anonymousClientHash(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  const pin = await editPin();
  return digest(`tsg-kader-rate:${pin ?? "unconfigured"}:${address}`);
}
