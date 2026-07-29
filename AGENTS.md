# AGENTS.md

## Auftrag

Dieses Repository enthält das Coaching Tool der TSG Tübingen D1. Codex soll bestehende Funktionen stabil halten und die Anwendung schrittweise zu einer mandantenfähigen Plattform für mehrere Vereine, Teams und Saisons weiterentwickeln.

Die nächste größere Erweiterung ist das Modul **Training**. Vor Produktcode gelten die Architekturentscheidungen in `docs/TRAINING_MODULE_IMPLEMENTATION_PLAN.md`.

## Verbindliche Leitplanken

1. Keine Geheimnisse, Passwörter, Schlüssel, personenbezogenen Messwerte oder Kinderfotos in Quellcode, Tests, Logs oder Dokumentation eintragen.
2. Keine neuen fachlichen Datensätze über Vornamen oder Anzeigenamen identifizieren. Neue Tabellen verwenden UUIDs; bestehende String-IDs sind nur `legacy_key`.
3. Jede neue fachliche Tabelle ist mandantenfähig:
   - `organization_id` für Vereins-/Mandantengrenzen,
   - `team_id` für Teamdaten,
   - `season_id` für saisonabhängige Daten, soweit fachlich erforderlich.
4. Zugriffe werden serverseitig geprüft. Supabase RLS ist zusätzliche Pflicht, kein Ersatz für API-Autorisierung.
5. Bestehende Statistiken, Kalenderdaten, Aufstellungen, Anwesenheiten, Diagnostiken und Historien dürfen durch Training-Migrationen nicht verändert oder neu berechnet werden.
6. Keine direkte Produktänderung in `main` ohne erfolgreiche relevante Checks. Größere Arbeiten erfolgen in kleinen, prüfbaren Branches/PRs.
7. Keine neue Funktion in die bestehende Monolith-Komponente einbauen, wenn sie als eigenständiges Modul implementiert werden kann.
8. Das Projekt wird produktiv über Vercel ausgeliefert. Sites-/Cloudflare-Code ist Altlast bzw. optionaler Starter-Unterbau und darf nicht als aktueller Produktionsweg dokumentiert werden.
9. Mobile Nutzung, Tastaturbedienung, Fokusführung, 200-%-Zoom und reduzierte Bewegung sind Abnahmekriterien.
10. Keine KI-Vorschläge im Trainingsmodul, bevor Übungen strukturiert, versioniert und freigegeben gespeichert werden.

## Aktueller Stack

- Next.js 16 / React 19 / TypeScript strict
- Vercel für Produktion
- Supabase REST, Auth und PostgreSQL
- Google Calendar als derzeitige externe Terminquelle
- `@dnd-kit` für Drag-and-drop
- Node.js 22
- Regressionstests mit `node:test`

## Aktuelle Architektur

- UI-Schwerpunkt: `app/components/CoachingTool.tsx` (historisch gewachsener Monolith)
- Taktiktafel: `app/components/TacticsBoard.tsx`
- Zentrale Daten-API: `app/api/coaching-state/route.ts`
- Authentifizierung: `app/auth.ts`, `app/api/auth/route.ts`
- Supabase-Konfiguration: `app/lib/supabase.ts`
- Kalenderintegration: `app/lib/calendar.ts`
- Datenbankskripte: `supabase/*.sql`
- Regressionstests: `tests/hardening.test.mjs`
- Vercel-Build: `npm run build:vercel`

Der aktuelle generische Datenspeicher `coaching_records` und die feste Saisonkennung `d1-2026-27` sind nicht die Zielarchitektur für Multi-Tenancy.

## Zielstruktur für neue Module

Neue Trainingsfunktionen sollen schrittweise in klar getrennten Bereichen entstehen:

- `app/(coach)/training/` – Seiten und Routen
- `app/components/training/` – Training-spezifische UI
- `app/api/training/` – serverseitige Endpunkte
- `app/domain/training/` – Typen, Regeln, Statusübergänge
- `app/data/training/` – Repository-/Mapping-Schicht zu Supabase
- `supabase/migrations/` – nummerierte, wiederholbar überprüfbare Migrationen
- `tests/training/` – Fach- und API-Tests

Vorhandene Pfade nicht allein wegen dieser Zielstruktur verschieben. Erst neue Grenzen schaffen, anschließend kontrolliert extrahieren.

## Code-Konventionen

- TypeScript strict; kein `any`, sofern eine validierbare Form möglich ist.
- Fachliche Zustände als explizite Union/Enum und zentrale Übergangsfunktion modellieren.
- Eingaben an jeder API-Grenze validieren.
- Server-Komponenten bevorzugen; Client-Komponenten nur für Interaktion.
- Datenbankzugriffe ausschließlich serverseitig.
- Datum/Uhrzeit als UTC speichern, mit IANA-Zeitzone anzeigen; Standard `Europe/Berlin`.
- Benutzertexte auf Deutsch, technische Namen im Code auf Englisch.
- UI-Texte und Statusbegriffe zentral halten.
- Änderungen klein halten; keine umfassende Umformatierung zusammen mit Fachänderungen.
- Responsive CSS inhaltsbasiert; keine festen Kartenhöhen, die bei Zoom Inhalte abschneiden.
- Dialoge: Fokus einschließen, Escape, Fokus-Rückgabe, sinnvolle ARIA-Beschriftung.

## Lokaler Start in VS Code

Voraussetzungen: Node.js 22, npm, Git.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Vercel-nahe Prüfung:

```bash
npm run lint
npm run test:regression
npm run build:vercel
```

`npm test` führt zusätzlich den historischen Sites/Vinext-Build aus und benötigt Linux/GNU-`timeout`. Für Vercel-Produktänderungen ist `build:vercel` der maßgebliche Produktions-Build.

## Umgebungsvariablen

Nur Namen und Zweck dokumentieren:

- `SUPABASE_URL` – Projekt-URL
- `SUPABASE_SECRET_KEY` – ausschließlich serverseitiger privilegierter Schlüssel
- `SUPABASE_PUBLISHABLE_KEY` – optionaler öffentlicher Schlüssel
- `TRAINER_ACCESS_JSON` – bestehende Trainer-Allowlist
- `TRAINER_SESSION_SECRET` – Signatur der Trainer-Sitzungen
- `EDIT_PIN` – Legacy-Fallback; nicht für neue Auth-Flows verwenden

Für die spätere Plattform ist die JSON-Allowlist durch Supabase Auth plus Membership-/Rollenmodell zu ersetzen.

## Datenbank- und Sicherheitsregeln

- Migrationen zuerst in einer nichtproduktiven Supabase-Umgebung testen.
- Jede Migration braucht Vorprüfung, Rückrollstrategie und Verifikation.
- Tabellen mit Kinder-/Teamdaten: RLS aktivieren, Policies explizit definieren.
- Tenant-ID nie aus einem unvalidierten Client-Body vertrauen; aus Session/Membership ableiten.
- Auditrelevante Änderungen mit Akteur, Zeitpunkt, Objekt und Aktion speichern.
- Übungen/Pläne, die verwendet wurden, versionieren statt still überschreiben.
- Löschungen bevorzugt archivieren/soft-delete, wenn Historien davon abhängen.

## Qualitätsdefinition

Eine Arbeit ist erst fertig, wenn:

- relevante Fachregeln automatisiert getestet sind,
- `npm run lint`, `npm run test:regression` und `npm run build:vercel` erfolgreich sind,
- mobile Ansichten 360/390/430 px, Tablet und Desktop geprüft wurden,
- Tastatur, Fokus, 200-%-Zoom und `prefers-reduced-motion` geprüft sind,
- Datenmigration und Rückwärtskompatibilität beschrieben sind,
- keine Secrets oder personenbezogenen Testdaten im Diff stehen,
- die Dokumentation bei Architektur- oder Env-Änderungen aktualisiert wurde.

## Bekannte Risiken und No-Gos

- `CoachingTool.tsx` weiter vergrößern.
- Neue Mandantenfähigkeit nur als zusätzlicher String im bestehenden JSON-State simulieren.
- Spieler über Vornamen matchen.
- Kalenderereignisse ohne stabile externe und interne ID duplizieren.
- Laufende Trainingsdaten bei Netzverlust nur im React-State halten.
- KI-Ausgabe ohne Freigabe als verbindlichen Trainingsplan speichern.
- Trainingsbewertungen für Ranglisten oder öffentliche Spielerbeurteilungen zweckentfremden.
- Produktions-Supabase-Schema per Dashboard verändern, ohne Migration im Repository nachzuführen.

## Verbindliche Planungsreferenzen

- `PROJECT_HANDOFF.md`
- `docs/TRAINING_MODULE_IMPLEMENTATION_PLAN.md`
- `README.md`
