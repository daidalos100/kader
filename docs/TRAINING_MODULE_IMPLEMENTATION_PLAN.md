# Training-Modul: Architektur- und Umsetzungsplan

Stand: 29.07.2026  
Quelle: `Modul-Training-Konzept-v01_JD(2).docx`

## Entscheidung

Das Konzept reicht als **fachliche Produktvision**, aber noch nicht als ausführbare Spezifikation. Der Trainingsablauf, die Nutzeroberflächen und die Ausbauphasen sind sehr gut beschrieben. Für eine saubere Umsetzung und die spätere Plattform für mehrere Vereine und Teams müssen vor dem ersten Feature-Code die nachfolgenden Architektur- und Fachentscheidungen verbindlich werden.

## Was bereits ausreichend definiert ist

- Training als vollständiger Workflow statt bloßer Übungsbibliothek
- Status und Kerndaten einer Einheit
- fünf Planungsebenen: Kontext, Lernziel, Trainerteam, Ablauf, Parallelorganisation
- Blocktypen und blockabhängige Formulare
- Stationen, Rotation und grafische Ablaufplanung
- Ausbau der Taktiktafel zum Trainings-Skizzeneditor
- Champions Trophy ohne Tore, Assists oder subjektive Boni
- Desktop-/Tablet-Planung und reduzierter mobiler Durchführungsmodus
- Live-Anpassungen und kurze Nachbereitung
- strukturierte Übungsbibliothek
- KI erst auf Basis strukturierter und freigegebener Inhalte
- sinnvolle Phasen 1 bis 6

## Vor Umsetzung zu ergänzende Entscheidungen

### Kritisch

1. **Mandant und Berechtigung**
   - Organisation/Verein, Team und Saison als eigene Entitäten
   - Rollen: Plattform-Admin, Vereins-Admin, Team-Admin, Trainer, Co-Trainer/Analyst; Spieler/Eltern später
   - Zugriff auf teamübergreifende Übungen und Vereinsstandards

2. **Identitäten**
   - unveränderliche UUIDs für Spieler, Nutzer, Teams und Termine
   - Zuordnung Nutzer zu Spieler getrennt vom Spieler-Stammsatz
   - bisherige Vornamen-IDs nur als Migrationsschlüssel

3. **Datenbesitz und Sichtbarkeit**
   - Übung: privat, Team, Verein oder global/freigegeben
   - Vorlage, Skizze und Trainingsplan jeweils mit Besitzer, Freigabe und Version
   - definieren, wer löschen, archivieren, duplizieren und freigeben darf

4. **Terminquelle**
   - interner Termin als führende fachliche ID
   - externe Kalender-IDs als Sync-Verknüpfung
   - Konfliktregeln, wenn Google und Tool denselben Termin ändern
   - Trainingseinheit genau einem internen Termin zuordnen, nicht dessen Titel

5. **Statusmodell und Gleichzeitigkeit**
   - erlaubte Übergänge und Pflichtfelder je Status
   - Verhalten bei zwei gleichzeitig planenden Trainern
   - Revision/optimistic locking für Trainingseinheiten und Blöcke

6. **Datenschutz**
   - keine Gesundheitsdiagnosen im Trainingsfeedback
   - Videos, Beobachtungen und Spielergruppen getrennt berechtigen
   - Aufbewahrung, Export und Löschung definieren
   - Schutz Minderjähriger in Test-, Analyse- und Telemetriedaten

### Vor Phase 2

- verbindliche Felder je Blocktyp
- Regeln für Parallelblöcke und Rotationen
- Snapshot des Kaders/der Teilnehmer zum Durchführungszeitpunkt
- Versionsverhalten bei verwendeten Übungen
- mobile Offline-/Reconnect-Strategie

### Vor Champions Trophy

- Geltungsbereich einer Wertung: Team und Saison
- Korrektur, Rücknahme und Audit eines Ergebnisses
- Gleichstände und Rangfolge
- Wechsel eines Spielers zwischen Mannschaften
- Ergebnis eines abgebrochenen Spiels

## Empfohlene Navigation

Die Kalenderfunktion betrifft Training und Spielbetrieb gleichermaßen und sollte deshalb nicht unauffindbar verschachtelt werden.

| Hauptbereich | Unterbereiche |
|---|---|
| Übersicht | Dashboard, nächste Aufgaben, Sicherung/Verlauf |
| Kalender | alle Termine, Teilnahme, Terminpflege |
| Training | Einheiten, Übungen, Champions Trophy, Auswertung |
| Spielbetrieb | Spieltag, Aufstellung, Taktiken |
| Team | Kader, Spielerprofile |
| Analyse | Statistiken, Leistungsdiagnostik, Saisonhistorie |

Auf Mobilgeräten: kompakter Menü-Button oder horizontale Hauptnavigation mit eindeutigem aktivem Bereich; Unterbereiche als zweite lokale Navigation. Keine zwölf gleichrangigen Hauptpunkte.

## Ziel-Datenmodell

Alle IDs als UUID. Zeitstempel in UTC. Team-/Organisationszugriff aus der authentifizierten Membership ableiten.

### Plattformkern

| Entität | Zweck |
|---|---|
| `organizations` | Mandant/Verein |
| `teams` | Mannschaft innerhalb einer Organisation |
| `seasons` | Saison je Organisation/Team |
| `profiles` | Nutzerprofil zu Supabase Auth |
| `organization_memberships` | Rolle im Verein |
| `team_memberships` | Rolle/Zugriff im Team |
| `players` | vereinsbezogener Spieler-Stammsatz |
| `team_players` | saisonbezogene Kaderzuordnung |
| `events` | interner Kalendertermin |
| `external_event_links` | Google-/ICS-Synchronisation |
| `event_attendance` | Teilnahme je Termin und Spieler |
| `audit_events` | nachvollziehbare Änderungen |

### Training

| Entität | Zweck |
|---|---|
| `training_sessions` | Einheit, Kontext, Status, Lernziel |
| `training_focus_players` | Fokusspieler/-gruppen |
| `training_coach_assignments` | Trainer und Rollen je Einheit |
| `training_blocks` | geordnete/parallelisierbare Ablaufblöcke |
| `training_block_coaches` | Verantwortungen je Block |
| `training_stations` | Feld, Gruppe, Rotation und Wechsel |
| `training_live_state` | laufender Block, Timer und Live-Anpassung |
| `training_reviews` | kurze Nachbereitung |
| `exercises` | stabile Übungsidentität und Sichtbarkeit |
| `exercise_versions` | unveränderliche Version einer Übung |
| `sketches` | versionierte Zeichenfläche als validiertes JSON |
| `training_templates` | wiederverwendbare Einheiten/Abläufe |

### Champions Trophy

| Entität | Zweck |
|---|---|
| `trophy_competitions` | Mini-Turnier/Abschlussspiel-Kontext |
| `trophy_teams` | Mannschaften in dieser Wertung |
| `trophy_team_players` | Teilnehmende je Mannschaft |
| `trophy_matches` | Ergebnis, Modus und Punkte |
| `trophy_standings` | optional materialisierte Auswertung; sonst View |

Keine Trophy-Punkte in bestehende Tor-/Assist-Statistiken mischen.

## Zentrale Zustandsmodelle

### Trainingseinheit

`draft -> planned -> running -> completed -> evaluated`

Zusätzlich `cancelled` und optional `archived`. Rücksprünge nur mit expliziter Fachregel und Audit. Der Konzeptstatus „nicht geplant“ ist im System besser das Fehlen einer Einheit zum Termin und kein gespeicherter Status.

### Übung

`draft -> approved -> archived`

Eine verwendete `exercise_version` bleibt unverändert. Änderungen erzeugen eine neue Version.

## API-Grenzen

Keine Erweiterung des großen `coaching-state`-Payloads um Training. Neue serverseitige Routen:

- `GET/POST /api/training/sessions`
- `GET/PATCH /api/training/sessions/:id`
- `POST /api/training/sessions/:id/transition`
- `PATCH /api/training/sessions/:id/blocks`
- `PATCH /api/training/sessions/:id/live`
- `POST /api/training/sessions/:id/review`
- `GET/POST /api/exercises`
- `POST /api/exercises/:id/versions`
- `GET/POST /api/trophy/competitions`

Jede Mutation enthält `expected_revision`; Konflikte liefern HTTP 409. Autorisierung prüft Organisation, Team, Rolle und Saison.

## Migrationsstrategie aus dem aktuellen System

1. Neue Tabellen ergänzen; bestehende `coaching_records` nicht löschen.
2. Organisation, Team und Saison für die aktuelle D1 einmalig anlegen.
3. Aktuelle Spieler auf UUIDs migrieren und `legacy_key` speichern.
4. Auth-Nutzer auf Memberships abbilden; JSON-Allowlist vorerst als Übergang.
5. Kalendertermine intern spiegeln und externe IDs verknüpfen.
6. Teilnahme und Spielerbezüge schrittweise auf UUIDs umstellen.
7. Training ausschließlich auf dem neuen Modell implementieren.
8. Bestehende Bereiche einzeln aus dem generischen State extrahieren.
9. Erst nach Datenabgleich und Backups Legacy-Felder stilllegen.

Keine Big-Bang-Migration.

## Technischer Zuschnitt vor Phase 1

Der aktuelle UI-Monolith `CoachingTool.tsx` darf das neue Modul nicht aufnehmen. Zuerst:

- gemeinsame Shell und Navigation extrahieren,
- Mandanten-/Team-/Saisonkontext serverseitig bereitstellen,
- neue Training-Domain und Repository-Schicht anlegen,
- Test-Factory ohne echte Spielernamen erstellen,
- Migrationen in eine nummerierte Struktur überführen.

## Phasen mit Abnahmekriterien

### Architektur-Sprint 0

- Mandantenmodell und Rollen beschlossen
- RLS-Policies automatisiert geprüft
- aktuelle D1 als erster Mandant migrierbar
- Navigation ohne Funktionsverlust neu strukturiert
- Training-Modul leer, aber autorisiert erreichbar

### Phase 1: Planung

- Einheit aus Termin erstellen
- Kontext, Lernziel, Trainerrollen, Blöcke und Reihenfolge speichern
- Entwurf/Geplant mit Pflichtfeldvalidierung
- Duplizieren und Vorlage verwenden
- Konfliktspeicherung mit 409
- responsive Desktop-/Tablet-Planung

### Phase 2: Skizzen und Gruppen

- versionierter Skizzeneditor
- Stationen und Rotationen
- vorhandene Spieler per UUID
- Mobilansicht lesend, Tablet/Desktop bearbeitend
- Tastatur/Touch/Zoom getestet

### Phase 3: Live

- Fokusmodus, Blocktimer, Verlängern/Beenden
- Live-Anpassungen mit Änderungsverlauf
- Wiederaufnahme nach Reload/Netzunterbrechung
- kurze Nachbereitung

### Phase 4: Champions Trophy

- normale und Shootout-Punktelogik
- Rangliste pro Saison
- Korrektur und Rücknahme mit Audit
- keine Vermischung mit Spielstatistik

### Phase 5: Auswertung

- Lernziel, Durchführung und Wiederholung auswertbar
- minimale, datenschutzkonforme Trainerbeobachtungen
- keine öffentliche Spieler-Rangliste aus subjektiven Angaben

### Phase 6: KI

- nur freigegebene Übungen und strukturierte Regeln
- Vorschlag statt automatische Speicherung
- Quellen/Begründung sichtbar
- Trainer bestätigt jede Änderung

## Testmatrix

- Unit: Statusübergänge, Blockregeln, Trophy-Punkte, Rotation
- API: Rollen, Tenant-Isolation, Revision/409, Validierung
- RLS: Zugriff zwischen zwei Organisationen zwingend verweigert
- Integration: Termin -> Einheit -> Durchführung -> Review
- Migration: Legacy-Spieler und Kalender ohne Duplikate
- UI: 360/390/430 px, Tablet, MacBook Air, Desktop, 200-%-Zoom
- Accessibility: Tastatur, Fokus, Escape, Screenreader-Namen, Reduced Motion
- Resilience: Reload, Offline-Unterbrechung, doppelte Mutation

## Offene Produktfragen vor Code

1. Dürfen Trainer eines Vereins Übungen teamübergreifend sehen oder nur nach Freigabe?
2. Wer darf Vereinsstandards freigeben?
3. Sind Spielerbeobachtungen nur für Trainer dieses Teams sichtbar?
4. Muss eine geplante Einheit nach Beginn unveränderlich versioniert werden?
5. Welche Pflichtangaben gelten je Blocktyp?
6. Wie werden Spieler bei parallelen Stationen automatisch verteilt?
7. Welche Gleichstandsregel gilt für Champions Trophy?
8. Welche Daten dürfen beim Vereins-/Teamwechsel historisch mitgeführt werden?

## Empfohlenes nächstes Arbeitspaket

**Architektur-Sprint 0** in einem separaten Branch: App-Shell/Navigation extrahieren, Mandanten-Schema und RLS als Migration anlegen, aktuelle D1 als Seed/Migration abbilden und ein leeres, autorisiertes Training-Modul hinter Feature Flag bereitstellen. Erst danach Phase 1 implementieren.
