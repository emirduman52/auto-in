/* =====================================================================
   auto-in — Fahrzeugbestand (Liste & Detailseite)
   ---------------------------------------------------------------------
   Daten kommen vom eigenen Worker (/api/fahrzeuge, /api/fahrzeug/:id),
   der den Bestand serverseitig bei mobile.de abruft und cacht.
   ===================================================================== */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var TEL = "+49 841 95171533";
  var TEL_HREF = "tel:+4984195171533";

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
  var detailHref = function (f) { return "fahrzeug.html?id=" + encodeURIComponent(f.id); };
  var anfrageHref = function (f) {
    return "index.html?fahrzeug=" + encodeURIComponent(f.titel + " (Inserat " + f.id + ")") + "#kontakt";
  };
  var noImg = '<div class="car-noimg">Bild folgt</div>';

  function getJSON(url) {
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || "Fehler"); e.status = r.status; throw e; }
        return d;
      });
    });
  }

  // Defekte Bilder durch Platzhalter ersetzen (error-Events bubblen nicht -> capture)
  function imgFallback(root) {
    root.addEventListener("error", function (e) {
      var t = e.target;
      if (t && t.tagName === "IMG" && !t.dataset.failed) {
        t.dataset.failed = "1";
        t.insertAdjacentHTML("afterend", noImg);
        t.remove();
      }
    }, true);
  }

  function actions(f) {
    return '<div class="car-actions">' +
      '<a class="btn btn-accent" href="' + esc(anfrageHref(f)) + '">Anfrage senden</a>' +
      (f.url ? '<a class="car-ext" href="' + esc(f.url) + '" target="_blank" rel="noopener">Auf mobile.de ansehen ↗</a>' : "") +
      "</div>";
  }


  /* ===========================  Liste  ============================== */
  var grid = $("#fzbGrid");
  if (grid) {
    var toolbar = $("#fzbToolbar"), count = $("#fzbCount"), state = $("#fzbState");
    var makeSel = $("#fzbMake"), sortSel = $("#fzbSort");
    var skeleton = grid.innerHTML;
    var alle = [];
    imgFallback(grid);

    var card = function (f) {
      var img = f.bild
        ? '<img src="' + esc(f.bild) + '" alt="' + esc(f.titel) + '" loading="lazy" decoding="async" width="640" height="480">'
        : noImg;
      return '<article class="car-card">' +
        '<a class="car-media" href="' + esc(detailHref(f)) + '" tabindex="-1" aria-hidden="true">' + img + "</a>" +
        '<div class="car-body">' +
          '<h2 class="car-title"><a href="' + esc(detailHref(f)) + '">' + esc(f.titel) + "</a></h2>" +
          '<div class="car-price">' + esc(preis(f)) + "</div>" +
          '<ul class="car-specs">' + specs(f).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul>" +
          actions(f) +
        "</div></article>";
    };

    var SORT = {
      "preis-auf": function (a, b) { return (a.preis == null) - (b.preis == null) || a.preis - b.preis; },
      "preis-ab":  function (a, b) { return (a.preis == null) - (b.preis == null) || b.preis - a.preis; },
      "km-auf":    function (a, b) { return (a.km == null) - (b.km == null) || a.km - b.km; },
      "ez-ab":     function (a, b) { return String(b.ezSort || "").localeCompare(String(a.ezSort || "")); }
    };

    var render = function () {
      var m = makeSel.value;
      var liste = alle.filter(function (f) { return !m || f.marke === m; });
      if (SORT[sortSel.value]) liste = liste.slice().sort(SORT[sortSel.value]);
      grid.innerHTML = liste.map(card).join("");
      count.textContent = liste.length + (liste.length === 1 ? " Fahrzeug" : " Fahrzeuge");
    };

    var showState = function (html) {
      grid.hidden = true;
      toolbar.hidden = true;
      state.innerHTML = html;
      state.hidden = false;
    };

    var load = function () {
      grid.innerHTML = skeleton;
      grid.hidden = false;
      state.hidden = true;
      grid.setAttribute("aria-busy", "true");
      getJSON("/api/fahrzeuge").then(function (d) {
        alle = Array.isArray(d.fahrzeuge) ? d.fahrzeuge : [];
        if (!alle.length) {
          showState("<h2>Aktuell keine Fahrzeuge im Bestand</h2><p>Schau bald wieder vorbei – oder sag uns, was du suchst. Wir halten die Augen für dich offen.</p>" +
            '<a class="btn btn-accent" href="index.html#kontakt">Wunschfahrzeug anfragen</a>');
          return;
        }
        var marken = alle.map(function (f) { return f.marke; }).filter(function (m, i, a) { return m && a.indexOf(m) === i; }).sort();
        makeSel.innerHTML = '<option value="">Alle Marken</option>' +
          marken.map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + "</option>"; }).join("");
        toolbar.hidden = false;
        render();
      }).catch(function () {
        showState("<h2>Der Bestand lädt gerade nicht</h2><p>Bitte versuche es in ein paar Minuten erneut – oder ruf uns direkt an: " +
          '<a href="' + TEL_HREF + '">' + TEL + "</a>.</p>" +
          '<button type="button" class="btn btn-ghost" id="fzbRetry">Erneut versuchen</button>');
        $("#fzbRetry").addEventListener("click", load);
      }).then(function () { grid.setAttribute("aria-busy", "false"); });
    };

    makeSel.addEventListener("change", render);
    sortSel.addEventListener("change", render);
    load();
  }


  /* ==========================  Detail  ============================== */
  var fzd = $("#fzd");
  if (fzd) {
    imgFallback(fzd);
    var id = new URLSearchParams(location.search).get("id") || "";

    var fail = function (title, text) {
      fzd.setAttribute("aria-busy", "false");
      fzd.innerHTML = '<div class="fzb-state"><h2>' + esc(title) + "</h2><p>" + text + "</p>" +
        '<a class="btn btn-accent" href="fahrzeugbestand.html">Zum Fahrzeugbestand</a></div>';
    };

    var row = function (k, v) { return v == null || v === "" ? "" : "<div><dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>"; };

    var umwelt = function (u) {
      if (!u) return "";
      var rows = [
        u.verbrauch != null && ["Kraftstoffverbrauch kombiniert", fmt(u.verbrauch, 1) + " l/100 km"],
        u.stromverbrauch != null && ["Stromverbrauch kombiniert", fmt(u.stromverbrauch, 1) + " kWh/100 km"],
        u.co2 != null && ["CO₂-Emissionen kombiniert", fmt(u.co2) + " g/km"],
        u.co2Klasse && ["CO₂-Klasse", u.co2Klasse],
        u.effizienzklasse && ["Energieeffizienzklasse", u.effizienzklasse]
      ].filter(Boolean);
      if (!rows.length) return "";
      return '<div class="fzd-env"><h2>Verbrauch &amp; Emissionen</h2><dl>' +
        rows.map(function (r) { return row(r[0], r[1]); }).join("") + "</dl></div>";
    };

    var galerie = function (f) {
      var bilder = (f.bilder || []).filter(function (b) { return b.gross || b.klein; });
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

    var initGalerie = function () {
      var track = $(".gal-track", fzd), counter = $(".gal-count", fzd);
      if (!track || !counter) return;
      var n = track.children.length;
      var go = function (dir) { track.scrollBy({ left: dir * track.clientWidth, behavior: "smooth" }); };
      $(".gal-prev", fzd).addEventListener("click", function () { go(-1); });
      $(".gal-next", fzd).addEventListener("click", function () { go(1); });
      track.addEventListener("keydown", function (e) {
        if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
        if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      });
      track.addEventListener("scroll", function () {
        var i = Math.round(track.scrollLeft / track.clientWidth);
        counter.textContent = Math.min(i + 1, n) + " / " + n;
      }, { passive: true });
    };

    var renderDetail = function (f) {
      document.title = f.titel + " — auto-in Ingolstadt";
      fzd.setAttribute("aria-busy", "false");
      fzd.innerHTML =
        '<div class="fzd-layout">' + galerie(f) +
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
      initGalerie();
    };

    if (!/^\d{1,15}$/.test(id)) {
      fail("Fahrzeug nicht gefunden", "Der Link ist ungültig. Im Bestand findest du alle aktuellen Fahrzeuge.");
    } else {
      getJSON("/api/fahrzeug/" + id).then(renderDetail).catch(function (e) {
        if (e.status === 404) fail("Dieses Fahrzeug ist nicht mehr verfügbar", "Vermutlich wurde es bereits verkauft. Schau dir gern unseren aktuellen Bestand an.");
        else fail("Das Fahrzeug lädt gerade nicht", 'Bitte versuche es in ein paar Minuten erneut – oder ruf uns an: <a href="' + TEL_HREF + '">' + TEL + "</a>.");
      });
    }
  }
})();
