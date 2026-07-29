# PROJECT_HANDOFF.md

Stand: 29.07.2026  
Branch der Vorbereitung: `agent/training-module-foundation`

## Projektziel

Geschütztes Coaching Tool der TSG Tübingen D1 für Termine, Teilnahme, Kaderplanung, Spieltag, Taktik, Teamkarten, Leistungsdiagnostik, Statistiken und Änderungsverlauf. Die nächste Erweiterung ist ein vollständiges Trainingsmodul. Langfristiges Ziel ist eine selbstverwaltete Plattform für mehrere Vereine, Teams und Saisons.

## Aktueller Produktionsstand

- Produktion: Vercel
- Repository: `daidalos100/kader`
- Standardbranch: `main`
- Daten: Supabase PostgreSQL/REST
- externe Terminquelle: öffentlicher Google-Kalender plus lokale Overrides
- aktuelle Anmeldung: Trainer-Allowlist plus Supabase-Passwortprüfung und signierte HttpOnly-Sitzung
- bestehende Sitzung: 14 Tage, bei aktiver Nutzung erneuert
- Saisonbezug in zentraler State-API aktuell fest: `d1-2026-27`
- produktive Fachzustände überwiegend im generischen `coaching_records`-Modell

## Vorhandene Bereiche

- Übersicht mit nächstem Wettkampf, Teilnahme/Kader/Spieltag und Bestwerten
- Kalender mit vergangenen und kommenden Terminen, Teilnahme und Overrides
- terminbezogene Aufstellung
- mobile Tor-/Assist-Erfassung
- Taktiktafel mit Szenarien, Ball und Zeichenwerkzeugen
- Teamkarten, Profile und Saisonhistorie
- Leistungsdiagnostik und importierte Messreihen
- Statistik, Details, Awards und Ferienausschlüsse
- Sicherung, Änderungsverlauf und Wiederherstellung

## Getroffene technische Entscheidungen

- Next.js/React/TypeScript bleibt die Basis.
- Vercel ist der relevante Produktionsweg.
- Supabase bleibt Datenbank und Auth-Plattform.
- Secrets liegen ausschließlich in Hosting-/lokalen Env-Variablen.
- sensible APIs verwenden private No-Store-Regeln.
- sicherheitsrelevante Header sind in `next.config.ts` gesetzt.
- Optimistic Concurrency ist im generischen State bereits angelegt.
- Spieler- und Diagnostikdaten werden nicht im Source eingebettet.
- Training wird nicht als weiterer großer Abschnitt in `CoachingTool.tsx` implementiert.
- Neue Plattformdaten verwenden Organisation, Team, Saison und UUIDs.
- Google Calendar bleibt vorerst Quelle/Sync-Partner, interne Termine erhalten jedoch eine stabile eigene ID.

## Architekturdiagnose

### Stärken

- hoher funktionaler Reifegrad
- funktionierende produktive Datenhaltung
- bereits vorhandene Sicherheits- und Regressionstests
- robuste mobile und Accessibility-Schutzmechanismen
- bewährte Termin-, Anwesenheits-, Spieler- und Taktikfunktionen als Grundlage für Training

### Kritische Begrenzungen

1. `app/components/CoachingTool.tsx` ist ein sehr großer UI-Monolith.
2. `app/api/coaching-state/route.ts` lädt/speichert heterogene Daten über einen generischen Record-Store.
3. Saisonkennung und Teamkontext sind fest verdrahtet.
4. Es existiert noch kein Organisations-/Team-/Membership-Modell.
5. Historische Spieler-IDs basieren teilweise auf Namen.
6. README und Build-Skripte enthalten noch Sites/Vinext-Starterhistorie, obwohl Vercel produktiv maßgeblich ist.
7. `TRAINER_ACCESS_JSON` ist für wenige Trainer brauchbar, aber keine Plattform-Authentifizierung.
8. Migrationen sind phasenweise SQL-Dateien, noch keine saubere chronologische Migrationskette.

## Priorisierte offene Aufgaben

### P0 – vor Trainingscode

- Mandanten-, Rollen- und Membership-Modell festlegen
- RLS-Policies für mindestens zwei Testorganisationen beweisen
- UUID-Migration und Legacy-Key-Mapping definieren
- App-Shell/Navigation aus dem Monolithen extrahieren
- interne Terminidentität und Google-Sync-Verknüpfung definieren
- Training-Datenmodell und Statusübergänge beschließen
- nichtproduktive Supabase-Umgebung für Migrationstests verwenden

### P1 – Trainingsphase 1

- Trainingseinheit aus Termin
- Kontext, Lernziel, Trainerrollen und Blöcke
- Entwurf/Geplant, Duplizieren, Vorlagen
- Revision/409 und Audit
- Desktop-/Tablet-Planung, mobile Übersicht

### P2

- Skizzen, Gruppen, Stationen, Rotation
- Live-Modus und Nachbereitung
- Champions Trophy
- Auswertung
- KI erst danach

### P3 – Plattformhärtung

- Allowlist-Anmeldung durch Supabase Auth + Memberships ersetzen
- Legacy-State domänenweise ablösen
- Observability/Fehlerüberwachung
- automatisierte Migrationstests und Backups
- Organisations-Onboarding und Self-Service

## Bekannte Bugs/Schulden

- Vercel- und Sites-Buildpfad existieren parallel; Dokumentation war widersprüchlich.
- `npm test` baut Vinext/Sites und ist nicht identisch mit dem Vercel-Produktionsbuild.
- Root-Dokumentation war veraltet und nannte Legacy-PIN statt aktuelle Traineranmeldung.
- Große UI-Datei erhöht Regressionen und erschwert isolierte Tests.
- Generischer JSON-State erschwert referenzielle Integrität und mandantenfeste RLS.
- Google-Termin und lokale Overrides brauchen ein explizites Konfliktmodell.
- Für Live-Training existiert noch keine Offline-/Reconnect-Strategie.

## Erforderliche Env-Variablen

Keine Werte im Repository dokumentieren.

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_PUBLISHABLE_KEY` (optional)
- `TRAINER_ACCESS_JSON`
- `TRAINER_SESSION_SECRET`
- `EDIT_PIN` (Legacy-Fallback)

## Lokale Entwicklung in VS Code

```bash
git clone https://github.com/daidalos100/kader.git
cd kader
git checkout agent/training-module-foundation
npm ci
cp .env.example .env.local
npm run dev
```

Validierung:

```bash
npm run lint
npm run test:regression
npm run build:vercel
```

## Nicht verifiziert in dieser Vorbereitung

Es stand kein lokaler Repository-Checkout zur Verfügung. Deshalb wurden Build, Lint und Tests in diesem Vorbereitungsschritt nicht lokal ausgeführt. Die Dokumente wurden gegen den aktuellen `main`-Stand und die vorhandenen Repository-Dateien erstellt. Nach Checkout sind die drei oben genannten Checks verpflichtend.

## Nächstes sinnvolles Arbeitspaket

Architektur-Sprint 0:

1. Arbeitsbranch vom neuesten `main`.
2. App-Shell und Navigation ohne Verhaltensänderung extrahieren.
3. Organisation/Team/Saison/Membership/Player-UUID-Schema mit RLS anlegen.
4. D1-Migration und Tenant-Isolation testen.
5. leere autorisierte Training-Route hinter Feature Flag hinzufügen.
6. erst danach Planungsphase 1 beginnen.

Details: `docs/TRAINING_MODULE_IMPLEMENTATION_PLAN.md`.
