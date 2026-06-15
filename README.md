# auto-in — Fahrzeugankauf Ingolstadt

Landingpage für den Fahrzeugankauf **auto-in** (Ingolstadt & Umgebung) mit
interaktiver Sofort-Bewertung und Kfz-Steuer-Rechner.

## Struktur

```
.
├── index.html        # Markup der Seite
├── css/
│   └── styles.css    # Styles
└── js/
    └── auto-in.js    # Logik: Bewertungs-Wizard, Kfz-Steuer-Rechner, WhatsApp-Anfrage
```

## Lokal öffnen

Die Seite ist statisch — `index.html` einfach im Browser öffnen oder einen
kleinen Webserver starten:

```bash
python3 -m http.server
# danach http://localhost:8000 öffnen
```

## Konfiguration

Alle anpassbaren Werte (Segment-Basiswerte, Wertverlust-Parameter,
Kfz-Steuer-Sätze sowie die **WhatsApp-Nummer**) stehen oben in
[`js/auto-in.js`](js/auto-in.js) im Block `KONFIGURATION`.

> Hinweis: Die hinterlegten Kfz-Steuer-Sätze/Freibeträge (Stand 2025) und die
> WhatsApp-Nummer (`490000000000` = Platzhalter) vor dem Livegang prüfen bzw.
> eintragen.
