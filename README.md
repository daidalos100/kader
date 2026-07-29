# TSG Tübingen D1 · Coaching Tool

Geschützte Traineranwendung für Kalender, Teilnahme, Kaderplanung, Spieltag,
Taktik, Teamprofile, Leistungsdiagnostik, Statistik und Änderungsverlauf.

Produktion: [kader02.vercel.app](https://kader02.vercel.app/)

## Technischer Stand

- Next.js 16, React 19, TypeScript strict
- Vercel als produktive Hosting-Plattform
- Supabase PostgreSQL/REST und Auth
- öffentlicher Google-Kalender als derzeitige externe Terminquelle
- Node.js 22
- Regressionstests mit `node:test`

Das Repository enthält noch Vinext-/Cloudflare-Starterbestandteile. Diese sind nicht
der maßgebliche Produktionspfad. Für eine Vercel-nahe Prüfung immer
`npm run build:vercel` verwenden.

## Lokale Entwicklung in VS Code

Voraussetzungen: Git, Node.js 22 und npm.

```bash
git clone https://github.com/daidalos100/kader.git
cd kader
npm ci
cp .env.example .env.local
npm run dev
```

Die Werte in `.env.local` müssen aus der jeweiligen Entwicklungsumgebung stammen.
Keine Zugangsdaten in Git committen.

Empfohlene Prüfungen vor einem Push:

```bash
npm run lint
npm run test:regression
npm run build:vercel
```

`npm test` führt zusätzlich den historischen Vinext/Sites-Build aus und benötigt
Linux mit GNU `timeout`. Für die produktive Vercel-Auslieferung ist
`npm run build:vercel` maßgeblich.

## Umgebungsvariablen

Siehe `.env.example`. Benötigt werden abhängig von der Umgebung:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_PUBLISHABLE_KEY` (optional)
- `TRAINER_ACCESS_JSON`
- `TRAINER_SESSION_SECRET`
- `EDIT_PIN` (nur Legacy-Fallback)

`SUPABASE_SECRET_KEY` ist ausschließlich serverseitig und darf nie mit
`NEXT_PUBLIC_` veröffentlicht werden.

## Wichtige Bereiche

- `app/components/CoachingTool.tsx` – historisch gewachsene Hauptoberfläche
- `app/components/TacticsBoard.tsx` – Taktiktafel
- `app/api/` – geschützte Server-Endpunkte
- `app/auth.ts` – Trainer-Sitzungen und Zugriff
- `app/lib/calendar.ts` – Kalenderintegration
- `supabase/` – Datenbankskripte
- `tests/hardening.test.mjs` – Regressionen, Sicherheit und UX-Schutz
- `AGENTS.md` – verbindliche Codex-Arbeitsregeln
- `PROJECT_HANDOFF.md` – aktueller technischer Übergabestand
- `docs/TRAINING_MODULE_IMPLEMENTATION_PLAN.md` – Architektur des geplanten Trainingsmoduls

## Trainingsmodul und Plattformausbau

Das Konzept für das neue Trainingsmodul ist fachlich weit entwickelt. Vor der
Implementierung werden Mandantenfähigkeit, Rollen, UUID-basierte Spieleridentitäten,
interne Termin-IDs, RLS und das neue Domänenmodell als Architektur-Sprint umgesetzt.
Die Details und offenen Entscheidungen stehen im Implementierungsplan.

## Deployment

Vercel baut den Branch `main` mit:

```bash
npm run build:vercel
```

Produktionsvariablen werden ausschließlich in Vercel und Supabase verwaltet.
Datenbankänderungen müssen als versionierte SQL-Migration im Repository
nachvollziehbar sein und zuerst in einer nichtproduktiven Umgebung geprüft werden.
