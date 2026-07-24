# Trainerzugang

Der gemeinsame PIN bleibt aktiv, bis die folgenden drei Vercel-Umgebungsvariablen für **Production, Preview und Development** gesetzt sind. Danach schaltet die Anwendung automatisch auf persönliche Trainerkonten um.

| Variable | Wert |
| --- | --- |
| `TRAINER_SESSION_SECRET` | Zufälliger Wert mit mindestens 32 Zeichen. Nicht wiederverwenden. |
| `TRAINER_ACCESS_JSON` | JSON-Array aus freigegebenen Trainerkonten, jeweils mit `email`, `name` und `role` (`admin` oder `trainer`). |
| `SUPABASE_SECRET_KEY` | Bereits vorhandener serverseitiger Supabase-Secret-Key. Er wird zum Versenden der ersten Einladungen benötigt. |

Beispielstruktur für `TRAINER_ACCESS_JSON`:

```json
[
  { "email": "trainer@example.org", "name": "Vorname", "role": "trainer" }
]
```

Zusätzlich in Supabase unter **Authentication → URL Configuration** eintragen:

```text
https://kader02.vercel.app/auth/callback
```

Danach führt die erste Anmeldung einer freigegebenen Adresse automatisch zur Einladung per E-Mail. Nicht gelistete Adressen können weder eingeladen werden noch eine Sitzung eröffnen. Der bisherige `EDIT_PIN` kann erst entfernt werden, nachdem der E-Mail-Login erfolgreich getestet wurde.

Nach Änderungen an Vercel-Variablen muss ein neuer Production-Deploy erfolgen.
