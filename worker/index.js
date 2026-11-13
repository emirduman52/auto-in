/* =====================================================================
   auto-in — Cloudflare Worker
   ---------------------------------------------------------------------
   Liefert die statische Website aus (Static Assets) und stellt eine
   eigene, schlanke Schnittstelle zum mobile.de-Bestand bereit:

     GET /api/fahrzeuge        Fahrzeugliste (JSON)
     GET /api/fahrzeug/:id     Einzelfahrzeug mit Details (JSON)
     GET /api/bild?u=…         Bild-Proxy fuer Fahrzeugfotos (nur mobile.de-CDN)
     GET /fahrzeuge/<name>-<id> Serverseitig gerenderte Detailseite (SEO)
     GET /sitemap.xml          Sitemap inkl. aller Fahrzeuge

   Zugangsdaten kommen ausschliesslich aus Secrets (env), nie aus dem Code:
     MOBILE_API_USER, MOBILE_API_PASSWORD, MOBILE_CUSTOMER_NUMBER
   ===================================================================== */

import "../js/fz-render.js"; // gemeinsame Darstellung mit dem Browser (setzt globalThis.FzRender)

const R = globalThis.FzRender;
const API_BASE = "https://services.mobile.de";
const API_ACCEPT = "application/vnd.de.mobile.api+json";

const FRESH_SECONDS = 15 * 60;          // so lange gilt der Cache als aktuell
const STALE_SECONDS = 7 * 24 * 60 * 60; // so lange bleibt er als Notfall-Reserve
const BROWSER_SECONDS = 5 * 60;         // Browser-Cache fuer API-Antworten
const PAGE_SIZE = 100;                  // API-Maximum pro Seite
const MAX_PAGES = 20;                   // 20 x 100 = 2000 (API-Gesamtlimit)
const MAX_DETAIL_FETCHES = 40;          // Subrequest-Limit im Free-Plan (50) beachten
const CACHE_VERSION = "v2";             // erhoehen, wenn sich das Mapping aendert

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/sitemap.xml") return await sitemap(url, env, ctx);
      if (url.pathname.startsWith("/fahrzeuge/")) return await detailPage(url, env, ctx);
      if (url.pathname === "/fahrzeug" || url.pathname === "/fahrzeug.html") return await legacyDetail(url, env, ctx);
    } catch (err) {
      console.error("page_unexpected", url.pathname, err && err.message);
      return env.ASSETS.fetch(request);
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "Methode nicht erlaubt." }, 405);
    }
    try {
      return await route(url, env, ctx);
    } catch (err) {
      console.error("api_unexpected", url.pathname, err && err.message);
      return json({ error: "Interner Fehler." }, 500);
    }
  },
};

async function route(url, env, ctx) {
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/fahrzeuge") {
    return cached(url, "/__cache/" + CACHE_VERSION + "/fahrzeuge", ctx, () => loadList(env));
  }

  const m = path.match(/^\/api\/fahrzeug\/([^/]+)$/);
  if (m) {
    // Nur Ziffern zulassen, damit keine beliebigen Pfade an mobile.de gehen
    if (!/^\d{1,15}$/.test(m[1])) return json({ error: "Ungültige Fahrzeug-ID." }, 400);
    return cached(url, "/__cache/" + CACHE_VERSION + "/fahrzeug/" + m[1], ctx, () => loadAd(env, m[1]));
  }

  if (path === "/api/bild") return proxyImage(url);

  return json({ error: "Nicht gefunden." }, 404);
}


/* ===========================  Sitemap  ============================== */
// Feste Seiten + alle Fahrzeuge aus dem (gecachten) Bestand. Faellt mobile.de
// aus, enthaelt die Sitemap trotzdem die festen Seiten.
const SITE_ORIGIN = "https://kfzankauf-ingolstadt.de";
const STATIC_PAGES = ["/", "/fahrzeugbestand", "/leistungen", "/prozess", "/kfz-steuer", "/ueber-uns", "/faq"];

async function sitemap(url, env, ctx) {
  let fahrzeuge = [];
  try {
    const res = await cached(url, "/__cache/" + CACHE_VERSION + "/fahrzeuge", ctx, () => loadList(env));
    if (res.ok) fahrzeuge = (await res.json()).fahrzeuge || [];
  } catch (err) {
    console.error("sitemap_bestand_failed", err && err.message);
  }
  const entry = (loc, lastmod) =>
    "<url><loc>" + escXml(SITE_ORIGIN + loc) + "</loc>" + (lastmod ? "<lastmod>" + escXml(lastmod) + "</lastmod>" : "") + "</url>";
  const urls = STATIC_PAGES.map((p) => entry(p))
    .concat(fahrzeuge.filter((f) => /^\d{1,15}$/.test(f.id)).map((f) => entry(R.detailHref(f), f.geaendert)));
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join("\n") + "\n</urlset>\n";
  return new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=" + BROWSER_SECONDS },
  });
}

function escXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


/* ==================  Fahrzeug-Detailseiten (SEO)  =================== */
// /fahrzeuge/<name>-<id> wird serverseitig fertig gerendert: Titel, Meta-
// Beschreibung, Canonical, Vorschau fuer WhatsApp & Co. (Open Graph) und
// strukturierte Daten (schema.org/Car) fuer Google. Galerie und Lightbox
// aktiviert danach js/bestand.js.
async function loadDetail(url, env, ctx, id) {
  const res = await cached(url, "/__cache/" + CACHE_VERSION + "/fahrzeug/" + id, ctx, () => loadAd(env, id));
  return { status: res.status, fahrzeug: res.ok ? await res.json() : null };
}

async function legacyDetail(url, env, ctx) {
  // Alte Adressen fahrzeug.html?id=… dauerhaft auf die neuen umleiten
  const id = url.searchParams.get("id") || "";
  if (!/^\d{1,15}$/.test(id)) return Response.redirect(url.origin + "/fahrzeugbestand", 301);
  const { fahrzeug } = await loadDetail(url, env, ctx, id);
  return Response.redirect(url.origin + (fahrzeug ? R.detailHref(fahrzeug) : "/fahrzeuge/" + id), 301);
}

async function detailPage(url, env, ctx) {
  const m = url.pathname.match(/^\/fahrzeuge\/(?:[a-z0-9-]*-)?(\d{1,15})\/?$/);
  if (!m) return template(url, env, 404, { titel: "Fahrzeug nicht gefunden", state: R.state("Fahrzeug nicht gefunden", "Der Link ist ungültig. Im Bestand findest du alle aktuellen Fahrzeuge.") });

  const { status, fahrzeug: f } = await loadDetail(url, env, ctx, m[1]);
  if (f) {
    // Falscher oder veralteter Name in der Adresse -> auf die richtige Adresse
    if (url.pathname !== R.detailHref(f)) return Response.redirect(url.origin + R.detailHref(f), 301);
    return template(url, env, 200, { fahrzeug: f });
  }
  if (status === 404) {
    // Verkauft: 410 sagt Google, dass die Seite dauerhaft weg ist
    return template(url, env, 410, { titel: "Fahrzeug nicht mehr verfügbar", state: R.state("Dieses Fahrzeug ist nicht mehr verfügbar", "Vermutlich wurde es bereits verkauft. Schau dir gern unseren aktuellen Bestand an.") });
  }
  // mobile.de gerade nicht erreichbar: leere Vorlage, der Browser versucht es selbst (bestand.js)
  return template(url, env, 503, {});
}

async function template(url, env, status, { fahrzeug: f, titel, state }) {
  const tpl = await env.ASSETS.fetch(new Request(new URL("/fahrzeug", url.origin)));
  const headers = new Headers(tpl.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", status === 200 ? "public, max-age=" + BROWSER_SECONDS : "no-store");
  headers.delete("etag");
  headers.delete("content-length");
  if (status === 503) headers.set("retry-after", "300");

  let rw = new HTMLRewriter();
  if (f) {
    const seite = SITE_ORIGIN + R.detailHref(f);
    const title = f.titel + " kaufen in Ingolstadt — auto-in";
    const desc = metaDescription(f);
    const bild = (R.bilderVon(f)[0] || {}).gross;
    const head = [
      '<link rel="canonical" href="' + R.esc(seite) + '">',
      '<meta property="og:url" content="' + R.esc(seite) + '">',
      '<script type="application/ld+json">' + jsonForScript(carSchema(f, seite)) + "</script>",
    ].join("");
    rw = rw
      .on("title", { element: (el) => el.setInnerContent(title) })
      .on('meta[name="description"]', { element: (el) => el.setAttribute("content", desc) })
      .on('meta[property="og:type"]', { element: (el) => el.setAttribute("content", "product") })
      .on('meta[property="og:title"]', { element: (el) => el.setAttribute("content", f.titel + " — " + R.preis(f)) })
      .on('meta[property="og:description"]', { element: (el) => el.setAttribute("content", desc) })
      .on('meta[property="og:image"]', { element: (el) => { if (bild) el.setAttribute("content", SITE_ORIGIN + bild); } })
      .on("head", { element: (el) => el.append(head, { html: true }) })
      .on("#fzd", {
        element: (el) => {
          el.setAttribute("aria-busy", "false");
          el.setAttribute("data-ssr", "");
          el.setInnerContent(R.detail(f), { html: true });
          el.after('<script type="application/json" id="fzdData">' + jsonForScript(f) + "</script>", { html: true });
        },
      });
  } else if (state) {
    rw = rw
      .on("title", { element: (el) => el.setInnerContent(titel + " — auto-in Ingolstadt") })
      .on("head", { element: (el) => el.append('<meta name="robots" content="noindex">', { html: true }) })
      .on("#fzd", {
        element: (el) => {
          el.setAttribute("aria-busy", "false");
          el.setAttribute("data-ssr", "");
          el.setInnerContent(state, { html: true });
        },
      });
  } else {
    rw = rw.on("head", { element: (el) => el.append('<meta name="robots" content="noindex">', { html: true }) });
  }
  return rw.transform(new Response(tpl.body, { status, headers }));
}

function metaDescription(f) {
  const teile = [f.titel, f.ez && "EZ " + f.ez, f.km != null && R.fmt(f.km) + " km", f.kraftstoff, f.getriebe, R.preis(f)].filter(Boolean);
  return teile.join(" · ") + " — jetzt bei auto-in in Ingolstadt ansehen und Probefahrt vereinbaren.";
}

// JSON sicher in <script> einbetten (kein "</script>" im Text moeglich)
function jsonForScript(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// schema.org/Car – nur Felder, die mobile.de tatsaechlich liefert
function carSchema(f, seite) {
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length)));
  const ez = /^(\d{4})(\d{2})$/.exec(f.ezSort || "");
  return clean({
    "@context": "https://schema.org",
    "@type": "Car",
    name: f.titel,
    url: seite,
    image: R.bilderVon(f).slice(0, 10).map((b) => SITE_ORIGIN + (b.gross || b.klein)),
    description: f.beschreibung ? f.beschreibung.replace(/\s*\n\s*(\*\s*)?/g, " ").trim().slice(0, 1000) : metaDescription(f),
    brand: f.marke ? { "@type": "Brand", name: f.marke } : null,
    model: f.modell,
    itemCondition: f.zustand === "Neufahrzeug" ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
    dateVehicleFirstRegistered: ez ? ez[1] + "-" + ez[2] : null,
    mileageFromOdometer: f.km != null ? { "@type": "QuantitativeValue", value: f.km, unitCode: "KMT" } : null,
    fuelType: f.kraftstoff,
    vehicleTransmission: f.getriebe,
    vehicleEngine: f.kw != null ? clean({
      "@type": "EngineSpecification",
      enginePower: { "@type": "QuantitativeValue", value: f.kw, unitCode: "KWT" },
      engineDisplacement: f.hubraum != null ? { "@type": "QuantitativeValue", value: f.hubraum, unitCode: "CMQ" } : null,
    }) : null,
    color: f.farbe,
    bodyType: f.kategorie,
    seatingCapacity: f.sitze,
    offers: f.preis != null ? {
      "@type": "Offer",
      price: f.preis,
      priceCurrency: f.waehrung || "EUR",
      availability: "https://schema.org/InStock",
      url: seite,
      seller: {
        "@type": "AutoDealer",
        name: "auto-in",
        url: SITE_ORIGIN + "/",
        telephone: "+49 841 95171533",
        address: { "@type": "PostalAddress", streetAddress: "Regensburger Str. 7", postalCode: "85055", addressLocality: "Ingolstadt", addressCountry: "DE" },
      },
    } : null,
  });
}


/* ===================  Cache mit Notfall-Reserve  ==================== */
// Cache API (pro Cloudflare-Rechenzentrum). Eintraege bleiben bis zu 7 Tage
// liegen; aktuell sind sie 15 Minuten. Faellt mobile.de aus, wird der zuletzt
// gespeicherte Stand ausgeliefert ("stale").
async function cached(url, keyPath, ctx, loader) {
  const cache = caches.default;
  const key = new Request(new URL(keyPath, url.origin).toString());

  const hit = await cache.match(key);
  if (hit && ageSeconds(hit) < FRESH_SECONDS) return clientResponse(hit, "HIT");

  try {
    const body = JSON.stringify(await loader());
    ctx.waitUntil(cache.put(key, new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=" + STALE_SECONDS,
        "x-cached-at": String(Date.now()),
      },
    })));
    return json(body, 200, "MISS");
  } catch (err) {
    if (err instanceof NotFoundError) {
      ctx.waitUntil(cache.delete(key));
      return json({ error: "Dieses Fahrzeug ist nicht mehr im Bestand." }, 404);
    }
    console.error("mobile_api_failed", keyPath, err && err.message);
    if (hit) return clientResponse(hit, "STALE");
    // Kurzer Fehlercode zur Diagnose (z. B. "mobile_401", "konfiguration") – ohne Details/Zugangsdaten
    const code = err instanceof UpstreamError ? (err.code || "mobile_" + err.status) : "netzwerk";
    return json({ error: "Der Fahrzeugbestand ist gerade nicht erreichbar. Bitte versuche es später erneut.", code }, 503);
  }
}

function ageSeconds(res) {
  const at = Number(res.headers.get("x-cached-at"));
  return at ? (Date.now() - at) / 1000 : Infinity;
}

function clientResponse(hit, state) {
  const res = new Response(hit.body, hit);
  res.headers.set("cache-control", "public, max-age=" + BROWSER_SECONDS);
  res.headers.set("x-cache", state);
  res.headers.delete("x-cached-at");
  return res;
}

function json(data, status = 200, cacheState) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": status === 200 ? "public, max-age=" + BROWSER_SECONDS : "no-store",
    "x-content-type-options": "nosniff",
  };
  if (cacheState) headers["x-cache"] = cacheState;
  return new Response(typeof data === "string" ? data : JSON.stringify(data), { status, headers });
}


/* =======================  mobile.de-Zugriff  ======================== */
class NotFoundError extends Error {}
class UpstreamError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

function basicAuth(user, pass) {
  const bytes = new TextEncoder().encode(user + ":" + pass);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "Basic " + btoa(bin);
}

async function mobileGet(env, path, params) {
  if (!env.MOBILE_API_USER || !env.MOBILE_API_PASSWORD) {
    throw new UpstreamError(0, "Secrets MOBILE_API_USER / MOBILE_API_PASSWORD fehlen", "konfiguration_zugang");
  }
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(API_BASE + path + qs, {
    headers: {
      Accept: API_ACCEPT,
      Authorization: basicAuth(env.MOBILE_API_USER, env.MOBILE_API_PASSWORD),
    },
  });

  if (res.status === 404) throw new NotFoundError("404");
  if (!res.ok) {
    // Nur Status und mobile.de-Fehlertext loggen – nie Header/Zugangsdaten
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    const hint = res.status === 401 ? " (Zugangsdaten falsch?)" : res.status === 429 ? " (Rate-Limit)" : "";
    console.error("mobile_api_status", res.status + hint, path, detail);
    throw new UpstreamError(res.status, "mobile.de antwortet mit " + res.status);
  }
  return res.json();
}

async function loadList(env) {
  const customer = String(env.MOBILE_CUSTOMER_NUMBER || "").trim();
  if (!/^\d+$/.test(customer)) throw new UpstreamError(0, "Secret MOBILE_CUSTOMER_NUMBER fehlt oder ist ungueltig", customer ? "konfiguration_kundennummer_ungueltig" : "konfiguration_kundennummer_fehlt");

  const base = {
    customerNumber: customer,
    "page.size": String(PAGE_SIZE),
    "sort.field": "modificationTime",
    "sort.order": "DESCENDING",
  };
  // Laut Doku sind nur numerische/boolesche Parameter allein nicht erlaubt.
  // Liefert die Abfrage deshalb 400, mit Fahrzeugklasse erneut versuchen.
  const variants = [{}, { classification: "refdata/classes/Car" }];

  let first, extra;
  for (const v of variants) {
    try {
      first = await mobileGet(env, "/search-api/search", { ...base, ...v, "page.number": "1" });
      extra = v;
      break;
    } catch (err) {
      if (!(err instanceof UpstreamError && err.status === 400) || v === variants[variants.length - 1]) throw err;
    }
  }

  const pages = Math.min(Number(first.maxPages) || 1, MAX_PAGES);
  const rest = await Promise.all(
    range(2, pages).map((n) => mobileGet(env, "/search-api/search", { ...base, ...extra, "page.number": String(n) }))
  );
  let ads = [first, ...rest].flatMap((p) => (Array.isArray(p.ads) ? p.ads : []));

  // Enthaelt das Suchergebnis keine Bilder, Details einzeln nachladen
  if (ads.length && !ads.some((ad) => imageList(ad).length)) {
    const head = await mapLimit(ads.slice(0, MAX_DETAIL_FETCHES), 6, (ad) =>
      mobileGet(env, "/search-api/ad/" + encodeURIComponent(ad.mobileAdId)).catch(() => ad)
    );
    ads = head.concat(ads.slice(MAX_DETAIL_FETCHES));
  }

  return {
    stand: new Date().toISOString(),
    anzahl: ads.length,
    fahrzeuge: ads.map(mapListAd).filter((f) => f.id),
  };
}

async function loadAd(env, id) {
  return mapDetailAd(await mobileGet(env, "/search-api/ad/" + id));
}

function range(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}


/* ==========================  Mapping  =============================== */
// Die API liefert Referenzdaten als Schluessel (z. B. "DIESEL"). Teilweise
// kommen Werte auch als Objekt – val() nimmt dann Beschreibung oder Schluessel.
const val = (v) => (v != null && typeof v === "object" && !Array.isArray(v) ? v.localDescription ?? v.value ?? v.key ?? null : v);
const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
function pick(obj, ...paths) {
  for (const p of paths) {
    const v = val(get(obj, p));
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const FUEL = {
  PETROL: "Benzin", DIESEL: "Diesel", ELECTRICITY: "Elektro", HYBRID: "Hybrid (Benzin/Elektro)",
  HYBRID_DIESEL: "Hybrid (Diesel/Elektro)", LPG: "Autogas (LPG)", CNG: "Erdgas (CNG)",
  HYDROGENIUM: "Wasserstoff", ETHANOL: "Ethanol", OTHER: "Sonstige",
};
const GEARBOX = { MANUAL_GEAR: "Schaltgetriebe", SEMIAUTOMATIC_GEAR: "Halbautomatik", AUTOMATIC_GEAR: "Automatik" };
const CONDITION = { NEW: "Neufahrzeug", USED: "Gebrauchtfahrzeug" };
const CATEGORY = {
  Cabrio: "Cabrio/Roadster", EstateCar: "Kombi", Limousine: "Limousine", OffRoad: "SUV/Geländewagen",
  SmallCar: "Kleinwagen", SportsCar: "Sportwagen/Coupé", Van: "Van/Minibus", OtherCar: "Andere",
  Alcoves: "Wohnmobil (Alkoven)", Integrated: "Wohnmobil (integriert)", PartlyIntegrated: "Wohnmobil (teilintegriert)",
  PartiallyIntegrated: "Wohnmobil (teilintegriert)", Caravan: "Wohnwagen", CamperVan: "Kastenwagen",
};
const COLOR = {
  BLACK: "Schwarz", WHITE: "Weiß", GREY: "Grau", SILVER: "Silber", BLUE: "Blau", RED: "Rot",
  GREEN: "Grün", BROWN: "Braun", BEIGE: "Beige", YELLOW: "Gelb", ORANGE: "Orange", GOLD: "Gold",
  PURPLE: "Lila", VIOLET: "Violett",
};
const MAKE_UPPER = new Set(["BMW", "MG", "DS", "BYD", "GMC", "KTM", "MINI", "VW", "NIO", "XPENG", "SEAT"]);

function label(map, v) {
  if (v == null || v === "") return null;
  const s = String(v);
  return map[s] || prettyKey(s);
}
function prettyKey(s) {
  if (!/^[A-Z0-9_]+$/.test(s)) return s;
  return s.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
function prettyMake(v) {
  if (!v) return "";
  const s = String(v).replace(/_/g, " ");
  if (s !== s.toUpperCase()) return s; // schon lesbar
  if (MAKE_UPPER.has(s)) return s;
  if (s === "CITROEN") return "Citroën";
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

// mobile.de liefert Texte teils mit HTML-Entities ("B&amp;O")
function decodeEntities(v) {
  if (typeof v !== "string") return v;
  return v.replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" })[e]);
}

// mobile.de-Markup: "\\" = Zeilenumbruch, "**fett**" -> Klartext
function formatDescription(v) {
  if (!v) return null;
  return String(v).split("\\\\").join("\n").replace(/\*\*/g, "").replace(/\n{3,}/g, "\n\n").trim() || null;
}

// "EURO6" -> "Euro 6", "EURO6D_TEMP" -> "Euro 6d-TEMP"
function formatEmissionClass(v) {
  const m = String(v || "").match(/^EURO(\d)([A-Z]*)(?:_(TEMP))?$/);
  return m ? "Euro " + m[1] + m[2].toLowerCase() + (m[3] ? "-TEMP" : "") : null;
}

// "202007" bzw. "2020-07" -> "07/2020"
function formatRegistration(v) {
  const m = String(v || "").match(/^(\d{4})-?(\d{2})/);
  return m ? m[2] + "/" + m[1] : null;
}

// Bilder: Groessen-Schluessel (s, m, l, xl, xxl, xxxl) oder eine ref-URL
const CARD_SIZES = ["xl", "l", "xxl", "m"];
const LARGE_SIZES = ["xxl", "xxxl", "xl", "l"];
const RULE_PX = { xl: 640, xxl: 1024, xxxl: 1600, l: 360, m: 240 };

function imageList(ad) {
  const raw = ad && (ad.images || get(ad, "media.images"));
  return Array.isArray(raw) ? raw : [];
}
function imageUrl(img, sizes) {
  if (!img) return null;
  if (typeof img === "string") return proxied(img);
  for (const s of sizes) {
    const u = img[s] ?? img[s.toUpperCase()];
    if (typeof u === "string") return proxied(u);
  }
  if (typeof img.ref === "string") {
    const px = RULE_PX[sizes[0]] || 640;
    let u = img.ref;
    if (/rule=mo-\d+/.test(u)) u = u.replace(/rule=mo-\d+/, "rule=mo-" + px);
    else if (!u.includes("?")) u += "?rule=mo-" + px + ".jpg";
    return proxied(u);
  }
  return null;
}
// Fotos laufen ueber /api/bild, damit der Browser keine Verbindung zum
// mobile.de-CDN aufbaut (keine IP-Uebermittlung an Dritte, kein Consent noetig).
function proxied(u) {
  let s = String(u).trim();
  if (s.startsWith("//")) s = "https:" + s;
  else if (!/^https?:\/\//.test(s)) s = "https://" + s;
  try {
    const parsed = new URL(s);
    if (!isImageHost(parsed.hostname)) return null;
    parsed.protocol = "https:";
    return "/api/bild?u=" + encodeURIComponent(parsed.toString());
  } catch {
    return null;
  }
}
function isImageHost(host) {
  return host === "classistatic.de" || host.endsWith(".classistatic.de");
}

// Nur Links zu mobile.de durchlassen
function safeMobileUrl(u) {
  try {
    const p = new URL(String(u));
    return p.protocol === "https:" && (p.hostname === "mobile.de" || p.hostname.endsWith(".mobile.de")) ? p.toString() : null;
  } catch {
    return null;
  }
}

function mapListAd(ad) {
  const make = prettyMake(pick(ad, "make"));
  const model = pick(ad, "model");
  const version = decodeEntities(pick(ad, "modelDescription"));
  const kw = num(pick(ad, "power", "powerKw", "enginePower"));
  const reg = pick(ad, "firstRegistration", "firstRegistrationDate");
  const firstImg = imageList(ad)[0];

  return {
    id: ad.mobileAdId != null ? String(ad.mobileAdId) : null,
    titel: [make, version || model].filter(Boolean).join(" "),
    marke: make || null,
    modell: model != null ? String(model) : null,
    preis: num(pick(ad, "price.consumerPriceGross")),
    waehrung: pick(ad, "price.currency") || "EUR",
    km: num(pick(ad, "mileage")),
    ez: formatRegistration(reg),
    ezSort: reg ? String(reg).replace("-", "").slice(0, 6) : null,
    kraftstoff: label(FUEL, pick(ad, "fuel")),
    getriebe: label(GEARBOX, pick(ad, "gearbox")),
    kw,
    ps: kw != null ? Math.round(kw * 1.35962) : null,
    zustand: label(CONDITION, pick(ad, "condition")),
    bild: imageUrl(firstImg, CARD_SIZES),
    url: safeMobileUrl(pick(ad, "detailPageUrl")),
    geaendert: pick(ad, "modificationDate"),
  };
}

function mapDetailAd(ad) {
  const base = mapListAd(ad);
  return {
    ...base,
    bilder: imageList(ad)
      .map((img) => ({ klein: imageUrl(img, CARD_SIZES), gross: imageUrl(img, LARGE_SIZES) }))
      .filter((b) => b.klein || b.gross),
    beschreibung: decodeEntities(formatDescription(pick(ad, "description")) || pick(ad, "plainTextDescription")) || null,
    kategorie: label(CATEGORY, pick(ad, "category")),
    farbe: label(COLOR, pick(ad, "exteriorColor")),
    hubraum: num(pick(ad, "cubicCapacity")),
    tueren: pick(ad, "doors") != null ? label({ TWO_OR_THREE: "2/3", FOUR_OR_FIVE: "4/5", SIX_OR_SEVEN: "6/7" }, pick(ad, "doors")) : null,
    sitze: num(pick(ad, "seats", "numSeats")),
    vorbesitzer: num(pick(ad, "numberOfPreviousOwners", "previousOwners")),
    hu: formatRegistration(pick(ad, "nextInspection", "generalInspection")),
    // Pflichtangaben nach Pkw-EnVKV – nur was mobile.de liefert, nichts ergaenzt
    umwelt: {
      verbrauch: num(pick(ad, "consumptions.fuel.combined", "consumptionCombined", "consumptions.combined")),
      stromverbrauch: num(pick(ad, "consumptions.power.combined", "consumptionPowerCombined", "consumptions.powerCombined")),
      co2: num(pick(ad, "emissions.combined.co2", "co2")),
      co2Klasse: pick(ad, "emissions.combined.co2Class", "co2Class"),
      effizienzklasse: pick(ad, "energyEfficiencyClass", "emissions.energyEfficiencyClass"),
      schadstoffklasse: formatEmissionClass(pick(ad, "emissionClass")),
    },
  };
}


/* ==========================  Bild-Proxy  ============================ */
async function proxyImage(url) {
  let target;
  try {
    target = new URL(url.searchParams.get("u") || "");
  } catch {
    return new Response("Ungültige Bild-URL", { status: 400 });
  }
  if (target.protocol !== "https:" || !isImageHost(target.hostname)) {
    return new Response("Ungültige Bild-URL", { status: 400 });
  }

  const res = await fetch(target.toString(), { cf: { cacheEverything: true, cacheTtl: 86400 } });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.startsWith("image/")) {
    return new Response(null, { status: res.status === 404 ? 404 : 502 });
  }
  return new Response(res.body, {
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
