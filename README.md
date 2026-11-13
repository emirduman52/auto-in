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

## Fahrzeugbestand (mobile.de Search-API)

Der Bestand auf `fahrzeugbestand.html` und den Detailseiten `/fahrzeuge/<name>-<id>`
wird nicht mehr per iFrame eingebunden, sondern über einen Cloudflare Worker
([`worker/index.js`](worker/index.js)) aus der mobile.de Search-API geladen und
mit eigenem Design dargestellt ([`js/bestand.js`](js/bestand.js)). Das HTML
eines Fahrzeugs erzeugt [`js/fz-render.js`](js/fz-render.js), die Datei nutzen
Browser und Worker gemeinsam.

| Endpunkt | Inhalt |
| --- | --- |
| `GET /api/fahrzeuge` | Fahrzeugliste (schlankes JSON) |
| `GET /api/fahrzeug/:id` | Einzelfahrzeug mit Details (nur Ziffern als ID) |
| `GET /api/bild?u=…` | Bild-Proxy, nur für das mobile.de-CDN (`*.classistatic.de`) |
| `GET /fahrzeuge/<name>-<id>` | Detailseite, serverseitig gerendert (Titel, Canonical, Open Graph, schema.org/Car). Falscher Name → 301, verkauft → 410 |
| `GET /fahrzeug.html?id=…` | Alte Adresse, 301 auf die neue Detailseite |
| `GET /sitemap.xml` | Sitemap mit festen Seiten und allen Fahrzeugen |

### Secrets

| Name | Inhalt |
| --- | --- |
| `MOBILE_API_USER` | API-Benutzer von mobile.de |
| `MOBILE_API_PASSWORD` | API-Passwort |
| `MOBILE_CUSTOMER_NUMBER` | Kundennummer des Händlers |

- **Produktiv:** Cloudflare-Dashboard → Workers & Pages → `auto-in` → Settings →
  Variables and Secrets, jeweils Typ **Secret** (nicht „Text“ – Text-Variablen
  werden bei jedem Deploy aus `wrangler.jsonc` überschrieben).
- **Lokal:** `.dev.vars.example` nach `.dev.vars` kopieren und Werte eintragen.
  `.dev.vars` ist in `.gitignore` und `.assetsignore` ausgeschlossen.

### Lokal starten

```bash
npx wrangler dev                    # http://localhost:8787
node scripts/mobile-api-probe.mjs   # zeigt Feldstruktur der echten API-Antwort
```

### Caching

- API-Antworten liegen im Cloudflare-Cache (Cache API, pro Rechenzentrum) und
  gelten **15 Minuten** als aktuell; danach wird mobile.de neu abgefragt.
- Ist mobile.de nicht erreichbar, wird der zuletzt gespeicherte Stand (bis zu
  7 Tage alt) ausgeliefert, sonst eine Fehlermeldung (HTTP 503). Header
  `x-cache`: `HIT`, `MISS` oder `STALE`.
- Fotos werden über `/api/bild` 24 Stunden gecacht. Besucher bauen dadurch keine
  Verbindung zu mobile.de auf.
- Hinweis: Auf `*.workers.dev`-Adressen (z. B. Preview-URLs) speichert die
  Cache API nichts – dort wird bei jedem Aufruf neu abgefragt. Auf `auto-in.de`
  greift der Cache.
- Fehler (401, 429, 5xx) werden serverseitig geloggt (Workers Observability),
  ohne Zugangsdaten.
