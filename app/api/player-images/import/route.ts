import { isAuthenticated } from "../../../auth";

function headers(key: string, extra?: Record<string, string>) {
  return { apikey: key, ...(key.startsWith("sb_") ? {} : { authorization: `Bearer ${key}` }), ...extra };
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return Response.json({ error: "Supabase ist nicht konfiguriert." }, { status: 503 });
  const files = (await request.formData()).getAll("files").filter((item): item is File => item instanceof File);
  if (!files.length || files.length > 5) return Response.json({ error: "Es werden 1 bis 5 Bilder erwartet." }, { status: 400 });
  const uploaded: string[] = [];
  for (const file of files) {
    if (!/^[a-z0-9_-]+\.webp$/.test(file.name) || file.type !== "image/webp" || file.size > 1048576) {
      return Response.json({ error: `Ungültige Bilddatei: ${file.name}` }, { status: 400 });
    }
    const response = await fetch(`${url}/storage/v1/object/player-images/${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: headers(key, { "content-type": "image/webp", "x-upsert": "true" }),
      body: file,
    });
    if (!response.ok) return Response.json({ error: `Upload fehlgeschlagen: ${file.name}` }, { status: 502 });
    uploaded.push(file.name);
  }
  return Response.json({ uploaded });
}
