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

  var R = window.FzRender;
  var esc = R.esc, preis = R.preis, specs = R.specs, detailHref = R.detailHref, actions = R.actions, noImg = R.noImg;

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
    // Neue Adresse /fahrzeuge/<name>-<id>, alte fahrzeug.html?id=<id> als Rueckfall
    var pm = location.pathname.match(/-?(\d{1,15})\/?$/);
    var id = pm ? pm[1] : (new URLSearchParams(location.search).get("id") || "");

    var fail = function (title, html) {
      fzd.setAttribute("aria-busy", "false");
      fzd.innerHTML = R.state(title, html);
    };

    // Vollbild-Ansicht: Bild antippen -> gross ansehen, wischen/Pfeile, Esc oder ✕ schliesst
    var initLightbox = function (f) {
      var track = $(".gal-track", fzd);
      var bilder = R.bilderVon(f);
      if (!track || !bilder.length) return;
      var n = bilder.length;

      var lb = document.createElement("div");
      lb.className = "lb";
      lb.hidden = true;
      lb.setAttribute("role", "dialog");
      lb.setAttribute("aria-modal", "true");
      lb.setAttribute("aria-label", "Bildansicht");
      lb.innerHTML =
        '<button type="button" class="lb-close" aria-label="Bildansicht schließen">×</button>' +
        '<div class="lb-track">' + bilder.map(function (b, i) {
          return '<img src="' + esc(b.gross || b.klein) + '" alt="' + esc(f.titel + " – Bild " + (i + 1)) + '" loading="lazy" decoding="async">';
        }).join("") + "</div>" +
        (n > 1 ? '<button type="button" class="lb-btn lb-prev" aria-label="Vorheriges Bild">‹</button>' +
                 '<button type="button" class="lb-btn lb-next" aria-label="Nächstes Bild">›</button>' : "") +
        '<div class="lb-count" aria-live="polite">1 / ' + n + "</div>";
      document.body.appendChild(lb);
      imgFallback(lb);

      var lbTrack = $(".lb-track", lb), lbCount = $(".lb-count", lb);
      var index = function () { return Math.min(Math.round(lbTrack.scrollLeft / lbTrack.clientWidth), n - 1); };
      var go = function (dir) { lbTrack.scrollBy({ left: dir * lbTrack.clientWidth, behavior: "smooth" }); };

      var open = function (i) {
        lb.hidden = false;
        document.documentElement.style.overflow = "hidden";
        lbTrack.scrollLeft = i * lbTrack.clientWidth;
        lbCount.textContent = (i + 1) + " / " + n;
        $(".lb-close", lb).focus();
      };
      var close = function () {
        var i = index();
        lb.hidden = true;
        document.documentElement.style.overflow = "";
        track.scrollLeft = i * track.clientWidth; // Galerie auf zuletzt gesehenes Bild
        track.focus({ preventScroll: true });
      };

      track.addEventListener("click", function (e) {
        var img = e.target.closest("img");
        if (img) open(Array.prototype.indexOf.call(track.children, img));
      });
      $(".lb-close", lb).addEventListener("click", close);
      if (n > 1) {
        $(".lb-prev", lb).addEventListener("click", function () { go(-1); });
        $(".lb-next", lb).addEventListener("click", function () { go(1); });
      }
      lbTrack.addEventListener("scroll", function () { lbCount.textContent = (index() + 1) + " / " + n; }, { passive: true });
      document.addEventListener("keydown", function (e) {
        if (lb.hidden) return;
        if (e.key === "Escape") close();
        else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
        else if (e.key === "Tab") { // Fokus im Dialog halten
          var btns = Array.prototype.slice.call(lb.querySelectorAll("button"));
          var at = btns.indexOf(document.activeElement);
          e.preventDefault();
          btns[(at + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
        }
      });
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

    var initDetail = function (f) {
      initGalerie();
      initLightbox(f);
    };

    var renderDetail = function (f) {
      document.title = f.titel + " — auto-in Ingolstadt";
      fzd.setAttribute("aria-busy", "false");
      fzd.innerHTML = R.detail(f);
      initDetail(f);
    };

    // Vom Worker bereits fertig gerendert? Dann nur noch Galerie & Lightbox aktivieren
    if (fzd.hasAttribute("data-ssr")) {
      var vorab = document.getElementById("fzdData");
      try { if (vorab) initDetail(JSON.parse(vorab.textContent)); } catch (e) { /* Seite bleibt lesbar */ }
      return;
    }

    if (!/^\d{1,15}$/.test(id)) {
      fail("Fahrzeug nicht gefunden", "Der Link ist ungültig. Im Bestand findest du alle aktuellen Fahrzeuge.");
    } else {
      getJSON("/api/fahrzeug/" + id).then(renderDetail).catch(function (e) {
        if (e.status === 404) {
          // Verkaufte Fahrzeuge nicht im Google-Index halten
          var noindex = document.createElement("meta");
          noindex.name = "robots";
          noindex.content = "noindex";
          document.head.appendChild(noindex);
        }
        if (e.status === 404) fail("Dieses Fahrzeug ist nicht mehr verfügbar", "Vermutlich wurde es bereits verkauft. Schau dir gern unseren aktuellen Bestand an.");
        else fail("Das Fahrzeug lädt gerade nicht", 'Bitte versuche es in ein paar Minuten erneut – oder ruf uns an: <a href="' + TEL_HREF + '">' + TEL + "</a>.");
      });
    }
  }
})();
