export const dynamic = "force-dynamic";

import { isAuthenticated } from "../../auth";
import { CALENDAR_ID, getCalendarEvents } from "../../lib/calendar";

export async function GET() {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  try {
    return Response.json({
      calendarId: CALENDAR_ID,
      events: await getCalendarEvents(),
      syncedAt: new Date().toISOString(),
    });
  } catch {
    return Response.json(
      { error: "Der öffentliche Mannschaftskalender konnte gerade nicht geladen werden." },
      { status: 502 },
    );
  }
}
