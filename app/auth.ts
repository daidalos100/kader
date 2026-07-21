import { cookies } from "next/headers";

type RuntimeEnv = { EDIT_PIN?: string };

export const sessionCookieName = "tsg_kader_session";

async function editPin() {
  const nodePin = (process.env as RuntimeEnv).EDIT_PIN;
  if (nodePin) return nodePin;
  if (process.env.VERCEL) return undefined;
  const cloudflare = await import("cloudflare:workers");
  return (cloudflare.env as unknown as RuntimeEnv).EDIT_PIN;
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function expectedSession() {
  const pin = await editPin();
  return pin ? digest(`tsg-kader:${pin}`) : null;
}

export async function pinIsValid(provided: string) {
  const pin = await editPin();
  if (!pin || !provided) return false;
  const [left, right] = await Promise.all([digest(provided), digest(pin)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function isAuthenticated() {
  const expected = await expectedSession();
  const current = (await cookies()).get(sessionCookieName)?.value;
  return Boolean(expected && current === expected);
}
