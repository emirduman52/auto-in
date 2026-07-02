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

  // Wertverlust-Parameter (frei anpassbar)
  var ALTERS_ABSCHLAG_PRO_JAHR = 0.13;  // 13 % vom jeweiligen Restwert pro Jahr (exponentiell)
  var NORM_KM_PRO_JAHR         = 15000; // als "normal" angenommene Laufleistung je Jahr
  var KM_ABSCHLAG_PRO_10TKM    = 0.015; // 1,5 % Extra-Abschlag je 10.000 km über dem Normwert
  var KM_FAKTOR_MIN            = 0.55;  // Untergrenze des Kilometer-Faktors
  var SPANNE                   = 0.08;  // Ergebnis-Spanne: Schätzwert −8 % bis +8 %

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

  /* --- Hero: rotierende "Letzter Ankauf"-Beispiele ------------------- */
  // Jeden Tag wird automatisch der nächste Eintrag angezeigt (loopt durch).
  // Frei erweiterbar: Fahrzeug, Preis (in €) und Auszahlungs-Text.
  var ANKAUF_BEISPIELE = [
    { auto: "VW Tiguan",       preis:  8450, dauer: "ausgezahlt in 24 Std." },
    { auto: "BMW 320d",        preis: 11900, dauer: "ausgezahlt in 24 Std." },
    { auto: "Audi A4 Avant",   preis:  9700, dauer: "ausgezahlt am selben Tag" },
    { auto: "Mercedes A 180",  preis:  7300, dauer: "ausgezahlt in 24 Std." },
    { auto: "VW Golf VII",     preis:  6850, dauer: "ausgezahlt am selben Tag" },
    { auto: "Škoda Octavia",   preis:  8200, dauer: "ausgezahlt in 24 Std." },
    { auto: "Opel Astra",      preis:  4900, dauer: "ausgezahlt am selben Tag" },
    { auto: "Ford Focus",      preis:  5600, dauer: "ausgezahlt in 24 Std." }
  ];

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

  function schaetzwert(segment, jahr, km, zustandFaktor) {
    var basis = SEGMENT_BASISWERTE[segment] || 12000;
    var alter = Math.max(0, NOW_YEAR - jahr);

    // exponentieller Alters-Abschlag: Restwert sinkt jährlich um ALTERS_ABSCHLAG_PRO_JAHR
    var altersFaktor = Math.pow(1 - ALTERS_ABSCHLAG_PRO_JAHR, alter);

    // Kilometer-Abschlag nur für Laufleistung ÜBER dem Normwert
    var normKm  = NORM_KM_PRO_JAHR * Math.max(1, alter);
    var mehrKm  = Math.max(0, km - normKm);
    var kmFaktor = Math.max(KM_FAKTOR_MIN, 1 - (mehrKm / 10000) * KM_ABSCHLAG_PRO_10TKM);

    var wert = basis * altersFaktor * kmFaktor * (zustandFaktor || 1);
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
    var STEPS = 6;
    var step = 0;
    var lastBand = "";

    var panes    = $$(".wz-pane", wizard);
    var wzStepNo = $("#wzStepNo"), wzProg = $("#wzProg");
    var wzActions = $("#wzActions"), wzBack = $("#wzBack"), wzNext = $("#wzNext");
    var wzYear = $("#wzYear"), wzKm = $("#wzKm"), wzVeh = $("#wzVeh"), wzRange = $("#wzRange");

    // Jahr-Dropdown füllen
    for (var y = NOW_YEAR; y >= 1990; y--) {
      var o = document.createElement("option");
      o.value = y; o.textContent = y;
      wzYear.appendChild(o);
    }

    // Hilfsfunktionen zum Auslesen
    var val   = function (id) { var el = $(id); return el ? el.value.trim() : ""; };
    var radio = function (name) { var el = $("input[name=" + name + "]:checked", wizard); return el ? el.value : ""; };
    var checks = function (name) { return $$("input[name=" + name + "]:checked", wizard).map(function (c) { return c.value; }); };
    var kmNum = function () { return parseInt((wzKm.value || "").replace(/[^0-9]/g, ""), 10) || 0; };

    function showPane(key) {
      panes.forEach(function (p) { p.classList.toggle("active", p.getAttribute("data-pane") === String(key)); });
    }

    // Pflichtfelder je Slide
    function stepValid(i) {
      if (i === 0) return !!val("#wzMarke") && !!val("#wzModell") && !!$("#wzYear").value && !!$("#wzTyp").value;
      if (i === 1) return kmNum() > 0;
      if (i === 2) return !!radio("wzUnfall");
      if (i === 5) return !!val("#wzPlz") && !!radio("wzAbwicklung");
      return true; // Slides 4 & 5 (Historie, Ausstattung) optional
    }

    function renderQuestion() {
      showPane(step);
      wzStepNo.textContent = step + 1;
      wzProg.style.width = ((step + 1) / STEPS * 100) + "%";
      wzActions.style.display = "flex";
      wzBack.disabled = step === 0;
      wzNext.disabled = !stepValid(step);
      wzNext.textContent = step === STEPS - 1 ? "Einschätzung anzeigen →" : "Weiter →";
    }

    // Kilometerstand live formatieren
    wzKm.addEventListener("input", function () {
      var digits = wzKm.value.replace(/[^0-9]/g, "").slice(0, 7);
      wzKm.value = digits ? parseInt(digits, 10).toLocaleString("de-DE") : "";
    });
    // Alle Eingaben → Weiter-Button live prüfen
    var recheck = function () { wzNext.disabled = !stepValid(step); };
    wizard.addEventListener("input", recheck);
    wizard.addEventListener("change", recheck);

    // Zustands-Faktor aus den Angaben ableiten (für die grobe Schätzung)
    function zustandFaktor() {
      var zf = 1;
      if (radio("wzUnfall") === "ja") zf *= (radio("wzRepariert") === "ja" ? 0.85 : 0.62);
      var m = checks("wzMaengel");
      if (m.indexOf("Motorschaden") >= 0) zf *= 0.50;
      if (m.indexOf("Getriebeproblem") >= 0) zf *= 0.70;
      if (m.indexOf("Warnleuchten aktiv") >= 0) zf *= 0.90;
      if (m.indexOf("Sonstige Probleme") >= 0 || val("#wzMaengelText")) zf *= 0.92;
      var sh = val("#wzScheckheft");
      if (sh === "Ja, lückenlos") zf *= 1.04;
      else if (sh === "Nein") zf *= 0.96;
      return Math.max(0.35, Math.min(1.05, zf));
    }

    // Alle Angaben strukturiert sammeln (für Zusammenfassung & Nachricht)
    function angaben() {
      var a = [];
      var add = function (label, v) { if (v) a.push(label + ": " + v); };
      var typEl = $("#wzTyp");
      add("Marke", val("#wzMarke"));
      add("Modell", val("#wzModell"));
      add("Erstzulassung", $("#wzYear").value);
      add("Fahrzeugtyp", typEl.value ? typEl.options[typEl.selectedIndex].text : "");
      add("Getriebe", radio("wzGetriebe"));
      add("Kraftstoff", val("#wzKraftstoff"));
      add("Motorisierung", val("#wzLeistung"));
      add("Kilometerstand", kmNum() ? fmt(kmNum()) + " km" : "");
      add("Vorbesitzer", val("#wzVorbesitzer"));
      add("Besitzdauer", val("#wzBesitz"));
      add("Unfallschaden", radio("wzUnfall") ? (radio("wzUnfall") === "ja" ? "Ja" : "Nein") : "");
      if (radio("wzUnfall") === "ja" && radio("wzRepariert")) add("Repariert", radio("wzRepariert") === "ja" ? "Ja" : "Nein");
      var maeng = checks("wzMaengel"); if (val("#wzMaengelText")) maeng = maeng.concat([val("#wzMaengelText")]);
      add("Mängel", maeng.join(", "));
      add("Scheckheft", val("#wzScheckheft"));
      add("HU/TÜV bis", val("#wzHu"));
      add("Letzter Service", val("#wzService"));
      add("Ausstattung", checks("wzAusstattung").join(", "));
      add("Bereifung", val("#wzReifen"));
      add("Preisvorstellung", val("#wzPreis"));
      add("Standort/PLZ", val("#wzPlz"));
      add("Abwicklung", radio("wzAbwicklung"));
      return a;
    }

    function computeResult() {
      var est = schaetzwert($("#wzTyp").value, +$("#wzYear").value, kmNum(), zustandFaktor());
      lastBand = groessenordnung(est.low, est.high);
      wzVeh.textContent = val("#wzMarke") + " " + val("#wzModell") + " · EZ " + $("#wzYear").value + " · " + fmt(kmNum()) + " km";
      wzRange.textContent = lastBand;
      wzActions.style.display = "none";
      wzProg.style.width = "100%";
      showPane("result");
    }

    // --- Navigation ---
    // Wizard beim Schrittwechsel auf gleicher Höhe halten (verhindert Springen)
    function anchorWizard() {
      var headerEl = document.querySelector("header");
      var off = (headerEl ? headerEl.offsetHeight : 0) + 14;
      var target = window.scrollY + wizard.getBoundingClientRect().top - off;
      if (Math.abs(target - window.scrollY) > 4) {
        window.scrollTo({ top: target, behavior: "smooth" });
      }
    }

    wzNext.addEventListener("click", function () {
      if (!stepValid(step)) return;
      if (step < STEPS - 1) { step++; renderQuestion(); anchorWizard(); }
      else { computeResult(); anchorWizard(); }
    });
    wzBack.addEventListener("click", function () {
      if (step > 0) { step--; renderQuestion(); anchorWizard(); }
    });

    $("#wzRestart").addEventListener("click", function () {
      $$("input, select, textarea", wizard).forEach(function (el) {
        if (el.type === "checkbox" || el.type === "radio") el.checked = false;
        else if (el.tagName === "SELECT") el.selectedIndex = 0;
        else el.value = "";
      });
      leadErr.textContent = "";
      step = 0; renderQuestion(); anchorWizard();
    });

    // --- Anfrage absenden (Ergebnis-Slide) ---
    var leadForm = $("#leadForm"), leadErr = $("#leadErr");

    // Validiert die Kontaktfelder und baut die Nachricht (alle Angaben + Einordnung).
    // Gibt { name, lines } zurück oder null bei Fehler.
    function buildLead() {
      var name  = val("#leadName"), phone = val("#leadPhone"), email = val("#leadEmail");
      var consent = $("#leadConsent").checked;

      if (!name)  { leadErr.textContent = "Bitte gib deinen Namen an."; return null; }
      if (!phone) { leadErr.textContent = "Bitte gib deine Telefonnummer an."; return null; }
      if (email && !/^\S+@\S+\.\S+$/.test(email)) { leadErr.textContent = "Bitte eine gültige E-Mail-Adresse angeben."; return null; }
      if (!consent) { leadErr.textContent = "Bitte stimme der Kontaktaufnahme zu (DSGVO)."; return null; }
      leadErr.textContent = "";

      var lines = ["Hallo auto-in, ich möchte ein unverbindliches Festangebot für mein Fahrzeug.", ""];
      angaben().forEach(function (l) { lines.push(l); });
      lines.push("Online-Einordnung: " + lastBand, "");
      lines.push("Name: " + name);
      lines.push("Telefon: " + phone);
      if (email) lines.push("E-Mail: " + email);
      return { name: name, lines: lines };
    }

    // Passt den Danke-Text an den gewählten Kanal an
    function setThanks(channel) {
      var sub = $("#wzThanksSub");
      if (!sub) return;
      sub.textContent = channel === "mail"
        ? "Dein E-Mail-Programm öffnet sich mit der bereits vorbereiteten Nachricht — schick sie einfach ab. Wir melden uns nach Erhalt mit deinem persönlichen Angebot."
        : "Du wirst zu WhatsApp weitergeleitet — deine Nachricht ist bereits vorbereitet. Wir melden uns nach Erhalt mit deinem persönlichen Angebot.";
    }

    leadForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var d = buildLead();
      if (!d) return;
      window.open(
        "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(d.lines.join(NL)),
        "_blank", "noopener"
      );
      setThanks("whatsapp");
      showPane("thanks");
    });

    var leadMail = $("#leadMail");
    if (leadMail) leadMail.addEventListener("click", function () {
      var d = buildLead();
      if (!d) return;
      var subject = "Fahrzeug-Anfrage – " + d.name;
      window.location.href = "mailto:" + MAIL_TO +
        "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(d.lines.join(NL));
      setThanks("mail");
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


  /* === Kontaktdaten (für schwebende Buttons & finale CTA) ===
         WhatsApp-Nummer international, ohne + und ohne Leerzeichen.
         Telefonnummer mit +. === */
  var WHATSAPP_NUMBER = "4916095225588";
  var CALL_NUMBER = "+4984195171533";
  var MAIL_TO = "info@auto-in.de";


  /* ===============  Allgemeines Kontaktformular (mailto)  ============ */
  var kontaktForm = $("#kontaktForm");
  if (kontaktForm) {
    var kv = function (id) { var el = $(id); return el ? el.value.trim() : ""; };
    var ktErr = $("#ktErr");
    kontaktForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = kv("#ktName"), email = kv("#ktEmail"), msg = kv("#ktMsg");
      if (!name) { ktErr.textContent = "Bitte gib deinen Namen an."; return; }
      if (!msg)  { ktErr.textContent = "Bitte schreib uns kurz dein Anliegen."; return; }
      if (email && !/^\S+@\S+\.\S+$/.test(email)) { ktErr.textContent = "Bitte eine gültige E-Mail-Adresse angeben."; return; }
      ktErr.textContent = "";

      var lines = [msg, "", "— " + name];
      if (email) lines.push(email);
      window.location.href = "mailto:" + MAIL_TO +
        "?subject=" + encodeURIComponent("Anfrage über die Website – " + name) +
        "&body=" + encodeURIComponent(lines.join(NL));
    });
  }


  /* =============  Hero: täglich rotierender "Letzter Ankauf"  ========= */
  var heroCard = $(".hero-card");
  if (heroCard && ANKAUF_BEISPIELE.length) {
    var hcV = $(".v", heroCard), hcSub = $(".sub", heroCard);
    if (hcV && hcSub) {
      var tagNr = Math.floor(Date.now() / 86400000); // ganze Tage seit 1970
      var b = ANKAUF_BEISPIELE[tagNr % ANKAUF_BEISPIELE.length];
      hcV.textContent = fmt(b.preis) + " €";
      hcSub.textContent = b.auto + " · " + b.dauer;
    }
  }


  /* =============  Schwebende Kontakt-Buttons (WhatsApp + Anruf)  ====== */
  if (!$(".float-contact")) {
    var fcWaMsg = "Hallo auto-in, ich interessiere mich für den Verkauf meines Fahrzeugs.";
    var fcWaHref = "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(fcWaMsg);
    var fcWaIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"></path></svg>';
    var fcCallIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 4h3l1.4 4-2 1.3a11 11 0 0 0 5.3 5.3l1.3-2 4 1.4v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z"></path></svg>';
    var fc = document.createElement("div");
    fc.className = "float-contact";
    fc.innerHTML =
      '<a class="fc-btn fc-wa" href="' + fcWaHref + '" target="_blank" rel="noopener" aria-label="Per WhatsApp kontaktieren">' + fcWaIcon + '</a>' +
      '<a class="fc-btn fc-call" href="tel:' + CALL_NUMBER + '" aria-label="Jetzt anrufen">' + fcCallIcon + '</a>';
    document.body.appendChild(fc);
  }


  /* =====================  Burger-Menü (mobil)  ======================= */
  var navEl = $(".nav"), navLinks = $(".nav-links");
  if (navEl && navLinks && !$(".nav-burger")) {
    var burger = document.createElement("button");
    burger.className = "nav-burger";
    burger.type = "button";
    burger.setAttribute("aria-label", "Menü öffnen");
    burger.setAttribute("aria-expanded", "false");
    burger.innerHTML = "<span></span><span></span><span></span>";
    navEl.appendChild(burger);

    var panel = document.createElement("div");
    panel.className = "mobile-menu";
    var inner = document.createElement("nav");
    inner.className = "mobile-menu-inner";
    $$("a", navLinks).forEach(function (a) { inner.appendChild(a.cloneNode(true)); });
    panel.appendChild(inner);
    document.body.appendChild(panel);

    var setMenu = function (open) {
      document.body.classList.toggle("menu-open", open);
      burger.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      burger.setAttribute("aria-label", open ? "Menü schließen" : "Menü öffnen");
    };
    burger.addEventListener("click", function () {
      setMenu(!document.body.classList.contains("menu-open"));
    });
    // Klick auf einen Link oder neben die Links schließt das Menü
    $$("a", panel).forEach(function (a) { a.addEventListener("click", function () { setMenu(false); }); });
    panel.addEventListener("click", function (e) { if (e.target === panel) setMenu(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setMenu(false); });
  }


  /* =========  Rezensionen-Marquee: Karten für nahtlosen Lauf klonen  = */
  var revTrack = $("#revTrack");
  if (revTrack) {
    $$(".rev-card", revTrack).forEach(function (c) {
      var clone = c.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      revTrack.appendChild(clone);
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
