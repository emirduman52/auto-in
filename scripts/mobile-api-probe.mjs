// Prueft die echte Antwort der mobile.de Search-API (Schritt "Felder pruefen").
// Aufruf im Projektordner:  node scripts/mobile-api-probe.mjs
// Liest die Zugangsdaten aus .dev.vars. Gibt nur Feldnamen/Typen aus sowie
// Werte unkritischer Fahrzeugfelder – keine Verkaeufer- oder Kontaktdaten.
import { readFileSync } from "node:fs";

const vars = Object.fromEntries(
  readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
);
const { MOBILE_API_USER: user, MOBILE_API_PASSWORD: pass, MOBILE_CUSTOMER_NUMBER: customer } = vars;
if (!user || !pass || !customer) {
  console.error("Bitte MOBILE_API_USER, MOBILE_API_PASSWORD und MOBILE_CUSTOMER_NUMBER in .dev.vars eintragen.");
  process.exit(1);
}

const headers = {
  Accept: "application/vnd.de.mobile.api+json",
  Authorization: "Basic " + Buffer.from(user + ":" + pass).toString("base64"),
};
async function get(path, params) {
  const url = "https://services.mobile.de" + path + (params ? "?" + new URLSearchParams(params) : "");
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} fuer ${path}: ${text.slice(0, 300)}`), { status: res.status });
  return JSON.parse(text);
}

// Alle Feldpfade mit Typ sammeln (Arrays: Vereinigung aller Elemente)
function paths(obj, prefix = "", out = new Map()) {
  if (Array.isArray(obj)) {
    out.set(prefix + "[]", `array(${obj.length})`);
    obj.forEach((el) => paths(el, prefix + "[]", out));
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? prefix + "." + k : k;
      if (v && typeof v === "object") paths(v, p, out);
      else if (!out.has(p)) out.set(p, typeof v);
    }
  }
  return out;
}
const SAFE = /^(make|model|modelDescription|category|condition|firstRegistration|mileage|fuel|gearbox|power|cubicCapacity|exteriorColor|doors|seats|price\.|consumption|co2|emissions|energyEfficiency|wltp|costModel)/i;
function show(title, obj) {
  console.log("\n=== " + title + " ===");
  for (const [p, t] of paths(obj)) {
    if (p.startsWith("seller")) continue; // Verkaeuferdaten auslassen
    const v = p.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
    const sample = SAFE.test(p) && v != null && typeof v !== "object" ? "  = " + JSON.stringify(v) : "";
    console.log("  " + p.padEnd(48) + t + sample);
  }
}

const base = { customerNumber: customer, "page.size": "100", "sort.field": "modificationTime", "sort.order": "DESCENDING", "page.number": "1" };
let list;
try {
  list = await get("/search-api/search", base);
  console.log("Suche mit customerNumber allein: OK");
} catch (err) {
  if (err.status !== 400) throw err;
  console.log("Suche mit customerNumber allein: 400 – versuche mit classification=refdata/classes/Car");
  list = await get("/search-api/search", { ...base, classification: "refdata/classes/Car" });
  console.log("Mit classification: OK");
}
console.log(`total=${list.total} maxPages=${list.maxPages} pageSize=${list.pageSize} Inserate auf Seite 1: ${(list.ads || []).length}`);
if (!list.ads || !list.ads.length) process.exit(0);

const firstAd = list.ads[0];
show("Felder im SUCHERGEBNIS (erstes Inserat)", firstAd);
const detail = await get("/search-api/ad/" + firstAd.mobileAdId);
show("Felder im EINZELABRUF (dasselbe Inserat)", detail);

const listPaths = new Set(paths(firstAd).keys());
const onlyDetail = [...paths(detail).keys()].filter((p) => !listPaths.has(p) && !p.startsWith("seller"));
console.log("\n=== Nur im Einzelabruf vorhanden ===\n  " + (onlyDetail.join("\n  ") || "(keine)"));

const img = (detail.images || [])[0];
if (img) {
  console.log("\n=== Bildobjekt ===");
  console.log("  Schluessel: " + Object.keys(typeof img === "object" ? img : { string: img }).join(", "));
  const anyUrl = typeof img === "string" ? img : Object.values(img).find((v) => typeof v === "string" && v.includes("/"));
  if (anyUrl) console.log("  Host: " + new URL(anyUrl.startsWith("http") ? anyUrl : "https://" + anyUrl.replace(/^\/\//, "")).hostname);
} else {
  console.log("\n!! Kein images-Feld im Einzelabruf gefunden");
}

// Pkw-EnVKV: welche Inserate haben keine Verbrauchs-/CO2-Angaben?
const envKeys = /consumption|co2|emission|energyEfficiency/i;
const missing = [];
for (const ad of list.ads.slice(0, 40)) {
  const d = ad.mobileAdId === firstAd.mobileAdId ? detail : await get("/search-api/ad/" + ad.mobileAdId);
  const has = [...paths(d).keys()].some((p) => envKeys.test(p));
  if (!has) missing.push(`${ad.mobileAdId} (${d.make || ""} ${d.modelDescription || d.model || ""})`);
}
console.log("\n=== Inserate ohne Verbrauchs-/CO2-Angaben (max. 40 geprueft) ===\n  " + (missing.join("\n  ") || "(keine)"));
