import { isAuthenticated } from "../../auth";

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

async function config() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  return { url, key };
}

function storageHeaders(key: string, extra?: Record<string, string>) {
  return {
    apikey: key,
    ...(key.startsWith("sb_") ? {} : { authorization: `Bearer ${key}` }),
    ...extra,
  };
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return new Response(null, { status: 401 });
  }

  const name = new URL(request.url).searchParams.get("name") ?? "";
  const slug = slugify(name);
  if (!slug) return new Response(null, { status: 400 });

  const { url, key } = await config();
  if (!url || !key) return new Response(null, { status: 503 });

  let response = await fetch(
    `${url}/storage/v1/object/player-images/${encodeURIComponent(slug)}.webp`,
    { headers: storageHeaders(key), cache: "no-store" },
  );

  if (!response.ok && slug !== "default" && (response.status === 400 || response.status === 404)) {
    response = await fetch(
      `${url}/storage/v1/object/player-images/default.webp`,
      { headers: storageHeaders(key), cache: "no-store" },
    );
  }
  if (!response.ok) return new Response(null, { status: 502 });

  return new Response(response.body, {
    headers: {
      "content-type": "image/webp",
      "cache-control": "private, no-store",
      ...(response.headers.get("etag") ? { etag: response.headers.get("etag")! } : {}),
      "x-content-type-options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return new Response(null, { status: 401 });

  const form = await request.formData().catch(() => null);
  const name = form?.get("name");
  const file = form?.get("file");
  const slug = slugify(typeof name === "string" ? name : "");
  if (!slug || !(file instanceof File) || file.type !== "image/webp" || file.size < 1 || file.size > 5_000_000) {
    return Response.json({ error: "Erlaubt ist nur eine WebP-Datei bis 5 MB." }, { status: 400 });
  }

  const { url, key } = await config();
  if (!url || !key) return Response.json({ error: "Supabase ist nicht verbunden." }, { status: 503 });

  const response = await fetch(
    `${url}/storage/v1/object/player-images/${encodeURIComponent(slug)}.webp`,
    {
      method: "POST",
      headers: storageHeaders(key, { "content-type": "image/webp", "x-upsert": "true" }),
      body: await file.arrayBuffer(),
    },
  );
  if (!response.ok) return Response.json({ error: "Bild konnte nicht in Supabase gespeichert werden." }, { status: 502 });
  return Response.json({ uploaded: true, name: slug });
}
