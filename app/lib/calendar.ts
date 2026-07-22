/* eslint-disable @typescript-eslint/no-explicit-any */
import ICAL from "ical.js";

export const CALENDAR_ID = "051d9666344c306ead2b296aebb5a6cca3f324c467efb84ed822ab29c359de56@group.calendar.google.com";
const CALENDAR_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CALENDAR_ID)}/public/basic.ics`;

export type CalendarEventType = "training" | "game" | "tournament" | "other";

export type CalendarEvent = {
  id: string;
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  type: CalendarEventType;
};

function classify(title: string, description: string): CalendarEventType {
  const value = `${title} ${description}`.toLocaleLowerCase("de-DE");
  if (value.includes("training")) return "training";
  if (/turnier|talentiade|cup|🏆/.test(value)) return "tournament";
  if (/rundenspiel|testspiel|freundschaftsspiel|\bspiel\b|\bvs\.?\b/.test(value)) return "game";
  return "other";
}

function toRecord(event: any, start: any, end: any): CalendarEvent {
  const startDate = start.toJSDate();
  const endDate = end.toJSDate();
  return {
    id: `${event.uid}::${startDate.toISOString()}`,
    uid: event.uid,
    title: event.summary || "Termin",
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    allDay: Boolean(start.isDate),
    location: event.location || "",
    description: event.description || "",
    type: classify(event.summary || "", event.description || ""),
  };
}

export async function getCalendarEvents() {
  const response = await fetch(CALENDAR_URL, {
    headers: { accept: "text/calendar" },
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`Kalender antwortet mit ${response.status}.`);

  const root = new ICAL.Component(ICAL.parse(await response.text()));
  const components = root.getAllSubcomponents("vevent");
  const from = Date.now() - 1000 * 60 * 60 * 24 * 45;
  const until = Date.now() + 1000 * 60 * 60 * 24 * 220;
  const results: CalendarEvent[] = [];

  for (const component of components) {
    if (component.hasProperty("recurrence-id")) continue;
    const event = new ICAL.Event(component);
    if (!event.isRecurring()) {
      const start = event.startDate.toJSDate().getTime();
      if (start >= from && start <= until) results.push(toRecord(event, event.startDate, event.endDate));
      continue;
    }

    const iterator = event.iterator();
    for (let index = 0; index < 600; index += 1) {
      const occurrence = iterator.next();
      if (!occurrence) break;
      const occurrenceTime = occurrence.toJSDate().getTime();
      if (occurrenceTime > until) break;
      if (occurrenceTime < from) continue;
      const details = event.getOccurrenceDetails(occurrence);
      results.push(toRecord(details.item, details.startDate, details.endDate));
    }
  }

  return results
    .filter((event, index, all) => all.findIndex((candidate) => candidate.id === event.id) === index)
    .sort((a, b) => a.start.localeCompare(b.start));
}
