import { expectedSession, pinIsValid, sessionCookieName } from "../../auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { pin?: unknown } | null;
  if (!body || typeof body.pin !== "string" || !(await pinIsValid(body.pin))) {
    return Response.json({ error: "PIN ist nicht korrekt." }, { status: 401 });
  }

  const session = await expectedSession();
  if (!session) {
    return Response.json({ error: "Zugang ist noch nicht konfiguriert." }, { status: 503 });
  }

  return Response.json(
    { authorized: true },
    {
      headers: {
        "set-cookie": `${sessionCookieName}=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
      },
    },
  );
}

export async function DELETE() {
  return Response.json(
    { authorized: false },
    { headers: { "set-cookie": `${sessionCookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` } },
  );
}

