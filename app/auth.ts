import { cookies } from "next/headers";

type RuntimeEnv = {
  EDIT_PIN?: string;
  TRAINER_ACCESS_JSON?: string;
  TRAINER_SESSION_SECRET?: string;
};

export type TrainerRole = "admin" | "trainer";
export type Trainer = { email: string; name: string; role: TrainerRole };
export type AuthMode = "pin" | "otp";

export const sessionCookieName = "tsg_kader_session";
export const sessionMaxAgeSeconds = 60 * 60 * 12;

async function runtimeEnv(): Promise<RuntimeEnv> {
  const node = process.env as RuntimeEnv;
  if (node.TRAINER_ACCESS_JSON || node.TRAINER_SESSION_SECRET || node.EDIT_PIN || process.env.VERCEL) return node;
  try {
    const cloudflare = await import("cloudflare:workers");
    return cloudflare.env as unknown as RuntimeEnv;
  } catch {
    return node;
  }
}

async function editPin() {
  return (await runtimeEnv()).EDIT_PIN?.trim();
}

async function trainerSessionSecret() {
  return (await runtimeEnv()).TRAINER_SESSION_SECRET?.trim();
}

function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

export async function trainerAccess(): Promise<Trainer[]> {
  const source = (await runtimeEnv()).TRAINER_ACCESS_JSON?.trim();
  if (!source) return [];
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!Array.isArray(parsed) || parsed.length > 20) return [];
    const trainers = parsed.flatMap((item): Trainer[] => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const email = typeof value.email === "string" ? normalizeEmail(value.email) : "";
      const name = typeof value.name === "string" ? value.name.trim().slice(0, 80) : "";
      const role = value.role === "admin" ? "admin" : "trainer";
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && name ? [{ email, name, role }] : [];
    });
    return trainers.filter((trainer, index) => trainers.findIndex((item) => item.email === trainer.email) === index);
  } catch {
    return [];
  }
}

export async function authMode(): Promise<AuthMode> {
  return (await trainerAccess()).length > 0 && Boolean(await trainerSessionSecret()) ? "otp" : "pin";
}

export async function trainerForEmail(email: string) {
  const normalized = normalizeEmail(email);
  return (await trainerAccess()).find((trainer) => trainer.email === normalized) ?? null;
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

function encode(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value: string): unknown {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function pinIsValid(provided: string) {
  const pin = await editPin();
  if (!pin || !provided || provided.length > 128) return false;
  const [left, right] = await Promise.all([digest(provided), digest(pin)]);
  return safeEqual(left, right);
}

export async function createPinSession() {
  const pin = await editPin();
  if (!pin) return null;
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const payload = `${Date.now()}.${nonce}`;
  return `${payload}.${await sign(payload, pin)}`;
}

export async function createTrainerSession(trainer: Trainer) {
  const secret = await trainerSessionSecret();
  if (!secret) return null;
  const payload = encode({ issuedAt: Date.now(), email: trainer.email, nonce: hex(crypto.getRandomValues(new Uint8Array(16)).buffer) });
  return `v2.${payload}.${await sign(payload, secret)}`;
}

async function validPinSession(value?: string) {
  const pin = await editPin();
  if (!pin || !value || value.length > 256) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const issuedAt = Number(parts[0]);
  if (!Number.isFinite(issuedAt) || issuedAt > Date.now() + 300_000 || Date.now() - issuedAt > sessionMaxAgeSeconds * 1000) return false;
  return safeEqual(parts[2], await sign(`${parts[0]}.${parts[1]}`, pin));
}

export async function currentTrainer(): Promise<Trainer | null> {
  if ((await authMode()) !== "otp") return null;
  const secret = await trainerSessionSecret();
  const value = (await cookies()).get(sessionCookieName)?.value;
  if (!secret || !value || value.length > 2_048) return null;
  const [version, payload, signature] = value.split(".");
  if (version !== "v2" || !payload || !signature || !safeEqual(signature, await sign(payload, secret))) return null;
  try {
    const decoded = decode(payload);
    if (!decoded || typeof decoded !== "object") return null;
    const value = decoded as Record<string, unknown>;
    if (typeof value.issuedAt !== "number" || typeof value.email !== "string") return null;
    if (value.issuedAt > Date.now() + 300_000 || Date.now() - value.issuedAt > sessionMaxAgeSeconds * 1000) return null;
    return trainerForEmail(value.email);
  } catch {
    return null;
  }
}

export async function isAuthenticated() {
  if ((await authMode()) === "otp") return Boolean(await currentTrainer());
  return validPinSession((await cookies()).get(sessionCookieName)?.value);
}

export async function anonymousClientHash(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  const secret = await trainerSessionSecret() ?? await editPin() ?? "unconfigured";
  return digest(`tsg-kader-rate:${secret}:${address}`);
}
