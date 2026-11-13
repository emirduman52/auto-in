/* =====================================================================
   auto-in — Darstellung der Fahrzeuge (gemeinsam fuer Browser & Worker)
   ---------------------------------------------------------------------
   Wird im Browser als normales Skript geladen und vom Cloudflare Worker
   importiert, damit die serverseitig gerenderte Detailseite exakt
   dasselbe HTML hat wie die Darstellung im Browser.
   Stellt globalThis.FzRender bereit.
   ===================================================================== */
(function (root) {
  "use strict";

  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var fmt = function (n, digits) {
    return Number(n).toLocaleString("de-DE", { maximumFractionDigits: digits || 0 });
  };
  var preis = function (f) {
    if (f.preis == null) return "Preis auf Anfrage";
    return fmt(f.preis) + (f.waehrung && f.waehrung !== "EUR" ? " " + f.waehrung : " €");
  };
  var leistung = function (f) { return f.kw != null ? fmt(f.kw) + " kW (" + fmt(f.ps) + " PS)" : null; };
  var specs = function (f) {
    return [f.ez && "EZ " + f.ez, f.km != null && fmt(f.km) + " km", f.kraftstoff, f.getriebe, leistung(f)].filter(Boolean);
  };

  // "Mercedes-Benz GLB 200 d 4Matic" -> "mercedes-benz-glb-200-d-4matic"
  var slug = function (s) {
    var out = String(s || "").toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (out.length > 70) out = out.slice(0, 70).replace(/-[^-]*$/, "");
    return out || "fahrzeug";
  };
  var detailHref = function (f) { return "/fahrzeuge/" + slug(f.titel) + "-" + f.id; };
  var anfrageHref = function (f) {
    return "/index.html?fahrzeug=" + encodeURIComponent(f.titel + " (Inserat " + f.id + ")") + "#kontakt";
  };
  var noImg = '<div class="car-noimg">Bild folgt</div>';

  var actions = function (f) {
    return '<div class="car-actions">' +
      '<a class="btn btn-accent" href="' + esc(anfrageHref(f)) + '">Anfrage senden</a>' +
      (f.url ? '<a class="car-ext" href="' + esc(f.url) + '" target="_blank" rel="noopener">Auf mobile.de ansehen ↗</a>' : "") +
      "</div>";
  };

  var row = function (k, v) { return v == null || v === "" ? "" : "<div><dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>"; };

  var umwelt = function (u) {
    if (!u) return "";
    var rows = [
      u.verbrauch != null && ["Kraftstoffverbrauch kombiniert", fmt(u.verbrauch, 1) + " l/100 km"],
      u.stromverbrauch != null && ["Stromverbrauch kombiniert", fmt(u.stromverbrauch, 1) + " kWh/100 km"],
      u.co2 != null && ["CO₂-Emissionen kombiniert", fmt(u.co2) + " g/km"],
      u.co2Klasse && ["CO₂-Klasse", u.co2Klasse],
      u.effizienzklasse && ["Energieeffizienzklasse", u.effizienzklasse],
      u.schadstoffklasse && ["Schadstoffklasse", u.schadstoffklasse]
    ].filter(Boolean);
    if (!rows.length) return "";
    return '<div class="fzd-env"><h2>Verbrauch &amp; Emissionen</h2><dl>' +
      rows.map(function (r) { return row(r[0], r[1]); }).join("") + "</dl></div>";
  };

  var bilderVon = function (f) { return (f.bilder || []).filter(function (b) { return b.gross || b.klein; }); };

  var galerie = function (f) {
    var bilder = bilderVon(f);
    if (!bilder.length) return '<div class="gal"><div class="gal-track">' + noImg + "</div></div>";
    var imgs = bilder.map(function (b, i) {
      return '<img src="' + esc(b.gross || b.klein) + '" alt="' + esc(f.titel + " – Bild " + (i + 1)) + '"' +
        (i ? ' loading="lazy"' : ' fetchpriority="high"') + ' decoding="async" width="1024" height="768">';
    }).join("");
    var multi = bilder.length > 1;
    return '<div class="gal">' +
      '<div class="gal-track" tabindex="0" aria-label="Bildergalerie, mit Pfeiltasten oder Wischen blättern">' + imgs + "</div>" +
      (multi ? '<button type="button" class="gal-btn gal-prev" aria-label="Vorheriges Bild">‹</button>' +
               '<button type="button" class="gal-btn gal-next" aria-label="Nächstes Bild">›</button>' +
               '<div class="gal-count" aria-hidden="true">1 / ' + bilder.length + "</div>" : "") +
      "</div>";
  };

  var detail = function (f) {
    return '<div class="fzd-layout">' + galerie(f) +
        '<div class="fzd-info">' +
          (f.zustand ? '<span class="eyebrow">' + esc(f.zustand) + "</span>" : "") +
          "<h1>" + esc(f.titel) + "</h1>" +
          '<div class="car-price fzd-price">' + esc(preis(f)) + (f.preis != null ? "<small>Gesamtpreis</small>" : "") + "</div>" +
          '<dl class="fzd-specs">' +
            row("Erstzulassung", f.ez) + row("Kilometerstand", f.km != null ? fmt(f.km) + " km" : null) +
            row("Kraftstoff", f.kraftstoff) + row("Getriebe", f.getriebe) + row("Leistung", leistung(f)) +
            row("Hubraum", f.hubraum != null ? fmt(f.hubraum) + " cm³" : null) + row("Kategorie", f.kategorie) +
            row("Farbe", f.farbe) + row("Türen", f.tueren) + row("Sitzplätze", f.sitze) +
            row("Vorbesitzer", f.vorbesitzer) + row("HU bis", f.hu) +
          "</dl>" +
          actions(f) +
        "</div>" +
      "</div>" +
      umwelt(f.umwelt) +
      (f.beschreibung ? '<div class="fzd-desc"><h2>Beschreibung</h2><p>' + esc(f.beschreibung) + "</p></div>" : "");
  };

  var state = function (title, html) {
    return '<div class="fzb-state"><h2>' + esc(title) + "</h2><p>" + html + "</p>" +
      '<a class="btn btn-accent" href="/fahrzeugbestand">Zum Fahrzeugbestand</a></div>';
  };

  root.FzRender = {
    esc: esc, fmt: fmt, preis: preis, leistung: leistung, specs: specs, slug: slug,
    detailHref: detailHref, anfrageHref: anfrageHref, noImg: noImg, actions: actions,
    bilderVon: bilderVon, detail: detail, state: state
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
