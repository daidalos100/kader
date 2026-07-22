import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

async function builtWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const context = { waitUntil() {}, passThroughOnException() {} };
const assets = { fetch: async () => new Response("Not found", { status: 404 }) };

test("renders development preview metadata", async () => {
  const worker = await builtWorker();

  const response = await worker.fetch(
    new Request("http://localhost/login", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: assets,
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("PIN gate issues a short-lived signed secure session", async () => {
  process.env.EDIT_PIN = "test-AllezTSG!";
  const worker = await builtWorker();
  const env = { ASSETS: assets, EDIT_PIN: "test-AllezTSG!" };
  const wrong = await worker.fetch(new Request("http://localhost/api/auth", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
    body: JSON.stringify({ pin: "wrong" }),
  }), env, context);
  assert.equal(wrong.status, 401);
  assert.match(wrong.headers.get("cache-control") ?? "", /private.*no-store/);

  const valid = await worker.fetch(new Request("http://localhost/api/auth", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
    body: JSON.stringify({ pin: "test-AllezTSG!" }),
  }), env, context);
  assert.equal(valid.status, 200);
  const cookie = valid.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Max-Age=43200/i);
  delete process.env.EDIT_PIN;
});

test("private APIs reject unauthenticated requests", async () => {
  process.env.EDIT_PIN = "test-AllezTSG!";
  const worker = await builtWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/coaching-state"),
    { ASSETS: assets, EDIT_PIN: "test-AllezTSG!" },
    context,
  );
  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control") ?? "", /private.*no-store/);
  delete process.env.EDIT_PIN;
});
