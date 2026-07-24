# Trainerzugang

Das Coaching Tool verwendet persönliche Trainerkonten mit Benutzername und Passwort. Ein gemeinsamer PIN wird nur als Fallback verwendet, solange die Trainerkonfiguration fehlt.

| Variable | Zweck |
| --- | --- |
| `TRAINER_SESSION_SECRET` | Zufälliger Wert mit mindestens 32 Zeichen zur Signierung der Anwendungssitzung. |
| `TRAINER_ACCESS_JSON` | Freigabeliste mit `email`, `name` und `role` (`admin` oder `trainer`). |
| `SUPABASE_SECRET_KEY` | Server-Key für den Abgleich des Supabase-Auth-Kontos. Nur serverseitig verwenden. |

Beispiel für `TRAINER_ACCESS_JSON`:

```json
[
  { "email": "trainer@example.org", "name": "Trainername", "role": "trainer" }
]
```

Der Login akzeptiert die freigegebene E-Mail-Adresse oder den Trainername als Benutzername. Intern wird stets über die E-Mail-Adresse gegen Supabase Auth geprüft.

## Konto anlegen

1. In Supabase zu **Authentication → Users → Add user** wechseln.
2. E-Mail-Adresse aus `TRAINER_ACCESS_JSON` eintragen und ein individuelles Passwort setzen.
3. **Auto confirm user** aktivieren, damit keine Bestätigungs-E-Mail versendet wird.
4. Öffentliche Registrierung in den E-Mail-Provider-Einstellungen deaktiviert lassen.

Die Freigabeliste ist eine zweite Zugriffsschicht: Ein vorhandenes Supabase-Konto ohne Eintrag in `TRAINER_ACCESS_JSON` erhält keinen Zugriff auf das Tool.

Passwörter werden weder im Repository noch in Vercel gespeichert. Änderungen und Wiederherstellungen werden weiterhin mit dem Trainername in der Historie protokolliert.
