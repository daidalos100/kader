# Mobile- und Accessibility-Testmatrix

Diese Matrix ist vor jedem Produktions-Release abzuarbeiten. Kritische Pfade sind Login, Navigation,
Spielerauswahl, Drag-and-drop, Anwesenheit, Statistik, Profil-Dialog und Wiederherstellung.

| Umgebung | Viewport | Eingabe | Prüfschwerpunkte |
|---|---:|---|---|
| iPhone SE | 320 × 568 | Touch | Kein Überlappen, Dialog vollständig scrollbar, sichere Seitenränder |
| iPhone 13/14 | 390 × 844 | Touch | Aufstellung, drei Spieler je Position, Bottom-/Top-Navigation |
| Android kompakt | 360 × 800 | Touch | Touchziele mindestens 44 px, Tastatur verdeckt keine Eingaben |
| Smartphone quer | 844 × 390 | Touch | Dialoge, Spielfeld und Statistik bleiben bedienbar |
| iPad | 768 × 1024 | Touch | Zwei-Spalten-Übergänge, Karten und Terminansicht |
| Desktop | 1440 × 900 | Maus | Sticky-Bereiche, Hover und Drag-and-drop |
| Desktop Zoom | 1280 × 720 bei 200 % | Tastatur | Kein Inhaltsverlust oder horizontales Abschneiden |

## Accessibility-Abnahme

- Vollständige Bedienung mit Tab, Umschalt+Tab, Enter, Leertaste und Escape.
- Sichtbarer Fokus auf jedem interaktiven Element.
- Dialogtitel werden angekündigt; Fokus bleibt im geöffneten Dialog.
- Statusänderungen „Speichert“, „Gespeichert“ und Fehler werden vorgelesen.
- `prefers-reduced-motion` deaktiviert nicht notwendige Animationen.
- Text und Bedienelemente erreichen mindestens WCAG-AA-Kontrast.
- Keine Information wird ausschließlich durch Farbe vermittelt.
- Dekorative Bilder haben leere Alternativtexte; Spielerbilder tragen den Vornamen.

## Daten- und Stabilitätsabnahme

- Zwei Browser ändern unterschiedliche Spieler gleichzeitig: beide Änderungen bleiben erhalten.
- Zwei Browser ändern denselben Eintrag: der zweite Browser erhält einen Konflikthinweis und lädt neu.
- Verbindung während des Speicherns trennen: Fehler wird sichtbar, bestehender Serverstand bleibt erhalten.
- Letzte Änderung wiederherstellen und anschließend neu laden.
- Backup herunterladen und JSON-Struktur prüfen.
