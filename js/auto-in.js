/* =====================================================================
   auto-in — Logik für Bewertungs-Wizard & Kfz-Steuer-Rechner
   ---------------------------------------------------------------------
   ALLE anpassbaren Werte stehen oben im Block "KONFIGURATION".
   Du kannst sie ohne Programmierkenntnisse ändern (nur die Zahlen).
   ===================================================================== */
(function () {
  "use strict";

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var NL = String.fromCharCode(10); // Zeilenumbruch ohne Escape-Probleme
  var fmt = function (n) { return Math.round(n).toLocaleString("de-DE"); };
  var euro = function (n) {
    return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  };
  var NOW_YEAR = new Date().getFullYear();

  /* =====================================================================
     KONFIGURATION  —  HIER kannst du alles anpassen
     ===================================================================== */

  /* --- Aufgabe 1: Bewertungs-Wizard ---------------------------------- */

  // Startwerte (Neuwert-Richtwert in €) je Fahrzeug-Segment.
  // >>> Diese Tabelle pflegst du frei. Platzhalter-Werte, bitte korrigieren. <<<
  var SEGMENT_BASISWERTE = {
    kleinwagen:    9000,
    kompakt:      14000,
    mittelklasse: 22000,
    suv:          30000,
    van:          20000,
    premium:      45000,
    transporter:  25000
  };

  var SEGMENT_LABEL = {
    kleinwagen:   "Kleinwagen",
    kompakt:      "Kompaktklasse",
    mittelklasse: "Mittelklasse",
    suv:          "SUV / Geländewagen",
    van:          "Van / Kombi",
    premium:      "Premium / Oberklasse",
    transporter:  "Transporter"
  };

  // Wertverlust-Parameter (frei anpassbar)
  var ALTERS_ABSCHLAG_PRO_JAHR = 0.13;  // 13 % vom jeweiligen Restwert pro Jahr (exponentiell)
  var NORM_KM_PRO_JAHR         = 15000; // als "normal" angenommene Laufleistung je Jahr
  var KM_ABSCHLAG_PRO_10TKM    = 0.015; // 1,5 % Extra-Abschlag je 10.000 km über dem Normwert
  var KM_FAKTOR_MIN            = 0.55;  // Untergrenze des Kilometer-Faktors
  var SPANNE                   = 0.08;  // Ergebnis-Spanne: Schätzwert −8 % bis +8 %

  // Zustands-Faktoren
  var ZUSTAND_FAKTOR = { sehr_gut: 1.00, gut: 0.90, gebrauchsspuren: 0.78, defekt: 0.55 };
  var ZUSTAND_LABEL  = {
    sehr_gut: "Sehr gut", gut: "Gut",
    gebrauchsspuren: "Gebrauchsspuren", defekt: "Reparaturbedarf / Defekt"
  };

  // Statt einer konkreten Euro-Zahl zeigt der Wizard nur eine grobe
  // Größenordnung. Das vermeidet falsche Erwartungen — der verbindliche
  // Preis kommt erst nach der persönlichen Besichtigung.
  // "bis" = Obergrenze (in €) für diese Stufe, "text" = angezeigte Einordnung.
  // Frei anpassbar: Schwellen und Wortlaut hier ändern.
  var GROESSENORDNUNGEN = [
    { bis:  1500,    text: "im niedrigen vierstelligen Bereich" },
    { bis:  4000,    text: "im unteren vierstelligen Bereich" },
    { bis:  7000,    text: "im mittleren vierstelligen Bereich" },
    { bis: 10000,    text: "im oberen vierstelligen Bereich" },
    { bis: 20000,    text: "im unteren fünfstelligen Bereich" },
    { bis: 35000,    text: "im mittleren fünfstelligen Bereich" },
    { bis: Infinity, text: "im oberen fünfstelligen Bereich" }
  ];

  // Hinweis: Die Lead-Abgabe erfolgt per WhatsApp (siehe WHATSAPP_NUMBER weiter unten).
  // Eine E-Mail-Adresse wird nicht mehr benötigt.

  /* --- Aufgabe 2: Kfz-Steuer-Rechner --------------------------------- */
  /* WICHTIG: Diese Sätze/Freibeträge gegen die offizielle Quelle
     (Zoll / Bundesministerium der Finanzen) prüfen und bei jeder
     Gesetzesänderung aktualisieren. Stand der Hinterlegung: 2025. */
  var STEUER = {
    // Hubraum-Anteil: € je ANGEFANGENE 100 cm³
    hubraum: { benzin: 2.00, diesel: 9.50 },

    // CO₂-Anteil: nur der Ausstoß ÜBER dem Freibetrag wird besteuert.
    // Freibetrag (g/km) je nach Erstzulassung:
    //   01.07.2009 – 31.12.2011 : 120
    //   01.01.2012 – 31.12.2013 : 110
    //   ab 01.01.2014           :  95
    co2_flat: 2.00, // € je g/km über Freibetrag (Erstzulassung VOR 01.01.2021, flach)

    // ab 01.01.2021: gestaffelter Tarif für den Anteil über 95 g/km
    co2_tarif_2021: [
      { bis: 115, satz: 2.00 },
      { bis: 135, satz: 2.20 },
      { bis: 155, satz: 2.50 },
      { bis: 175, satz: 2.90 },
      { bis: 195, satz: 3.40 },
      { bis: Infinity, satz: 4.00 }
    ]
  };

  // TODO / optional (bewusst NICHT abgebildet):
  //  - Oldtimer / H-Kennzeichen (pauschale Besteuerung)
  //  - Reine Elektrofahrzeuge (Steuerbefreiung bis 31.12.2025)
  //  - Erstzulassung vor 01.07.2009 (altes Hubraum-/Schadstoff-Modell)

  /* =====================================================================
     ENDE KONFIGURATION — ab hier Programmlogik
     ===================================================================== */


  /* =========================  Aufgabe 1: WIZARD  ====================== */

  function schaetzwert(segment, jahr, km, zustandKey) {
    var basis = SEGMENT_BASISWERTE[segment];
    var alter = Math.max(0, NOW_YEAR - jahr);

    // exponentieller Alters-Abschlag: Restwert sinkt jährlich um ALTERS_ABSCHLAG_PRO_JAHR
    var altersFaktor = Math.pow(1 - ALTERS_ABSCHLAG_PRO_JAHR, alter);

    // Kilometer-Abschlag nur für Laufleistung ÜBER dem Normwert
    var normKm  = NORM_KM_PRO_JAHR * Math.max(1, alter);
    var mehrKm  = Math.max(0, km - normKm);
    var kmFaktor = Math.max(KM_FAKTOR_MIN, 1 - (mehrKm / 10000) * KM_ABSCHLAG_PRO_10TKM);

    var zustandFaktor = ZUSTAND_FAKTOR[zustandKey] || 1;

    var wert = basis * altersFaktor * kmFaktor * zustandFaktor;
    wert = Math.max(250, wert);

    var round = function (n) { return Math.round(n / 50) * 50; }; // auf 50 € runden
    return { low: round(wert * (1 - SPANNE)), high: round(wert * (1 + SPANNE)) };
  }

  // grobe Größenordnung statt konkreter Zahl (siehe GROESSENORDNUNGEN)
  function groessenordnung(low, high) {
    var mid = (low + high) / 2;
    for (var i = 0; i < GROESSENORDNUNGEN.length; i++) {
      if (mid < GROESSENORDNUNGEN[i].bis) return GROESSENORDNUNGEN[i].text;
    }
    return GROESSENORDNUNGEN[GROESSENORDNUNGEN.length - 1].text;
  }

  var wizard = $("#wizard");
  if (wizard) {
    var QUESTIONS = 4;
    var state = { segment: "", jahr: "", km: 0, zustand: "", step: 0 };
    var lastEst = { low: 0, high: 0 };
    var lastBand = "";

    var panes   = $$(".wz-pane", wizard);
    var wzStepNo = $("#wzStepNo"), wzProg = $("#wzProg");
    var wzActions = $("#wzActions"), wzBack = $("#wzBack"), wzNext = $("#wzNext");
    var wzSegment = $("#wzSegment"), wzYear = $("#wzYear"), wzKm = $("#wzKm");
    var wzVeh = $("#wzVeh"), wzRange = $("#wzRange");

    // Jahr-Dropdown füllen
    for (var y = NOW_YEAR; y >= 1995; y--) {
      var o = document.createElement("option");
      o.value = y; o.textContent = y;
      wzYear.appendChild(o);
    }

    function showPane(key) {
      panes.forEach(function (p) {
        p.classList.toggle("active", p.getAttribute("data-pane") === String(key));
      });
    }

    function stepValid(i) {
      if (i === 0) return !!state.segment;
      if (i === 1) return !!state.jahr;
      if (i === 2) return state.km > 0;
      if (i === 3) return !!state.zustand;
      return true;
    }

    function renderQuestion() {
      showPane(state.step);
      wzStepNo.textContent = state.step + 1;
      wzProg.style.width = ((state.step + 1) / QUESTIONS * 100) + "%";
      wzActions.style.display = "flex";
      wzBack.disabled = state.step === 0;
      wzNext.disabled = !stepValid(state.step);
      wzNext.textContent = state.step === QUESTIONS - 1 ? "Schätzwert anzeigen →" : "Weiter →";
    }

    function computeResult() {
      lastEst = schaetzwert(state.segment, +state.jahr, state.km, state.zustand);
      lastBand = groessenordnung(lastEst.low, lastEst.high);
      wzVeh.textContent = SEGMENT_LABEL[state.segment] + " · EZ " + state.jahr + " · " + fmt(state.km) + " km";
      wzRange.textContent = lastBand;
      wzActions.style.display = "none";
      wzProg.style.width = "100%";
      showPane("result");
    }

    // --- Eingaben an State binden ---
    wzSegment.addEventListener("change", function () {
      state.segment = wzSegment.value; wzNext.disabled = !stepValid(state.step);
    });
    wzYear.addEventListener("change", function () {
      state.jahr = wzYear.value; wzNext.disabled = !stepValid(state.step);
    });
    wzKm.addEventListener("input", function () {
      var digits = wzKm.value.replace(/[^0-9]/g, "").slice(0, 7);
      state.km = digits ? parseInt(digits, 10) : 0;
      wzKm.value = digits ? state.km.toLocaleString("de-DE") : "";
      wzNext.disabled = !stepValid(state.step);
    });
    $$("input[name=wzCond]", wizard).forEach(function (r) {
      r.addEventListener("change", function () {
        state.zustand = r.value; wzNext.disabled = !stepValid(state.step);
      });
    });

    // --- Navigation ---
    wzNext.addEventListener("click", function () {
      if (!stepValid(state.step)) return;
      if (state.step < QUESTIONS - 1) { state.step++; renderQuestion(); }
      else { computeResult(); }
    });
    wzBack.addEventListener("click", function () {
      if (state.step > 0) { state.step--; renderQuestion(); }
    });

    // --- Ergebnis → Lead-Formular ---
    $("#wzCta").addEventListener("click", function () { showPane("lead"); });
    $("#wzRestart").addEventListener("click", restart);
    $("#leadBack").addEventListener("click", function () { showPane("result"); });

    function restart() {
      state = { segment: "", jahr: "", km: 0, zustand: "", step: 0 };
      wzSegment.value = ""; wzYear.value = wzYear.options[0].value;
      state.jahr = ""; wzYear.selectedIndex = 0; wzKm.value = "";
      $$("input[name=wzCond]", wizard).forEach(function (r) { r.checked = false; });
      renderQuestion();
    }

    // --- Lead-Formular absenden ---
    var leadForm = $("#leadForm"), leadErr = $("#leadErr");
    leadForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name  = $("#leadName").value.trim();
      var phone = $("#leadPhone").value.trim();
      var email = $("#leadEmail").value.trim();
      var msg   = $("#leadMsg").value.trim();
      var consent = $("#leadConsent").checked;

      if (!name) { leadErr.textContent = "Bitte gib deinen Namen an."; return; }
      if (email && !/^\S+@\S+\.\S+$/.test(email)) { leadErr.textContent = "Bitte eine gültige E-Mail-Adresse angeben."; return; }
      if (!consent) { leadErr.textContent = "Bitte stimme der Kontaktaufnahme zu (DSGVO)."; return; }
      leadErr.textContent = "";

      // Lead-Abgabe per WhatsApp: Nachricht wird vorbefüllt, der Kunde
      // sendet aus seinem eigenen WhatsApp an WHATSAPP_NUMBER.
      var lines = [
        "Hallo auto-in, ich möchte ein unverbindliches Festangebot für mein Fahrzeug.", "",
        "Segment: " + (SEGMENT_LABEL[state.segment] || "-"),
        "Erstzulassung: " + state.jahr,
        "Kilometerstand: " + fmt(state.km) + " km",
        "Zustand: " + (ZUSTAND_LABEL[state.zustand] || "-"),
        "Online-Einordnung: " + lastBand, "",
        "Name: " + name
      ];
      if (phone) lines.push("Telefon: " + phone);
      if (email) lines.push("E-Mail: " + email);
      if (msg)   lines.push("Nachricht: " + msg);

      window.open(
        "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(lines.join(NL)),
        "_blank", "noopener"
      );

      showPane("thanks");
    });

    renderQuestion();
  }


  /* =====================  Aufgabe 2: KFZ-STEUER  ===================== */

  function co2Freibetrag(d) {
    var D = function (y, m, day) { return new Date(y, m - 1, day).getTime(); };
    var t = d.getTime();
    if (t < D(2009, 7, 1))  return null;  // altes Modell — nicht abgebildet
    if (t <= D(2011, 12, 31)) return 120;
    if (t <= D(2013, 12, 31)) return 110;
    return 95;                            // ab 01.01.2014
  }

  function co2Steuer(co2, d) {
    var frei = co2Freibetrag(d);
    if (frei === null) return null;
    var ueber = Math.max(0, co2 - frei);
    if (ueber === 0) return 0;

    // ab 01.01.2021: gestaffelter Tarif für den Anteil über 95 g/km
    if (d.getTime() >= new Date(2021, 0, 1).getTime()) {
      var sum = 0, prev = 95;
      for (var i = 0; i < STEUER.co2_tarif_2021.length; i++) {
        var band = STEUER.co2_tarif_2021[i];
        if (co2 > prev) {
          var upper = Math.min(co2, band.bis);
          sum += (upper - prev) * band.satz;
          prev = upper;
        }
        if (co2 <= band.bis) break;
      }
      return sum;
    }

    // Erstzulassung 01.07.2009 – 31.12.2020: flach 2,00 € je g/km über Freibetrag
    return ueber * STEUER.co2_flat;
  }

  var txForm = $("#steuer");
  if (txForm) {
    var txHubraum = $("#txHubraum"), txCo2 = $("#txCo2"), txDate = $("#txDate");
    var txLocked = $("#txLocked"), txLive = $("#txLive");
    var txAmount = $("#txAmount"), txHubRow = $("#txHubRow"), txCo2Row = $("#txCo2Row"), txHint = $("#txHint");

    function renderTax() {
      var fuelEl = $("input[name=txFuel]:checked", txForm);
      var cc  = parseInt((txHubraum.value || "").replace(/[^0-9]/g, ""), 10);
      var co2 = parseInt((txCo2.value || "").replace(/[^0-9]/g, ""), 10);
      var dateVal = txDate.value;

      if (!fuelEl || !cc || isNaN(co2) || !dateVal) {
        txLocked.style.display = "block"; txLive.style.display = "none"; return;
      }

      var fuel = fuelEl.value;
      var d = new Date(dateVal);
      var hub = Math.ceil(cc / 100) * STEUER.hubraum[fuel]; // je angefangene 100 cm³
      var co2part = co2Steuer(co2, d);

      txLocked.style.display = "none"; txLive.style.display = "block";

      if (co2part === null) {
        txAmount.textContent = "—";
        txHubRow.textContent = "—"; txCo2Row.textContent = "—";
        txHint.textContent = "Für Erstzulassungen vor dem 01.07.2009 gilt das alte Hubraum-/Schadstoff-Modell, das dieser Rechner nicht abbildet.";
        txHint.style.display = "block";
        return;
      }

      var total = Math.floor(hub + co2part); // amtlich auf vollen Euro abgerundet
      txAmount.textContent = fmt(total);
      txHubRow.textContent = euro(hub);
      txCo2Row.textContent = euro(co2part);
      txHint.style.display = "none";
    }

    [txHubraum, txCo2, txDate].forEach(function (el) {
      el.addEventListener("input", renderTax);
      el.addEventListener("change", renderTax);
    });
    $$("input[name=txFuel]", txForm).forEach(function (r) { r.addEventListener("change", renderTax); });
  }


  /* =====================  WhatsApp-Anfrage (Footer-CTA)  ============== */
  /* === HIER eure WhatsApp-Nummer eintragen: international, ohne + und
         ohne Leerzeichen. Beispiel Deutschland: 4917012345678 === */
  var WHATSAPP_NUMBER = "490000000000";

  var waForm = $("#waForm");
  if (waForm) {
    waForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var lines = ["Hallo auto-in, ich interessiere mich für den Verkauf meines Fahrzeugs."];
      var n = $("#waName").value.trim(), v = $("#waVehicle").value.trim(), m = $("#waMsg").value.trim();
      if (n) lines.push("Name: " + n);
      if (v) lines.push("Fahrzeug: " + v);
      if (m) lines.push("Details: " + m);
      window.open("https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(lines.join(NL)), "_blank", "noopener");
    });
  }


  /* =====================  Scroll-Reveal  ============================= */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e, i) {
      if (e.isIntersecting) {
        e.target.style.transitionDelay = (Math.min(i, 4) * 60) + "ms";
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  $$(".reveal").forEach(function (el) { io.observe(el); });

})();
