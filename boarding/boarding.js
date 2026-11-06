/* Boarding — page des vols : code de la montre → vols suivis (ajout, carte d'embarquement, suppression) → fuseau maison. */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var jeton = null;
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var MOIS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  var JOURS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function msg(el, txt, ok) { el.textContent = txt; el.className = "message " + (ok ? "ok" : "err"); el.hidden = !txt; }
  function aujourdhui() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  $("#code").addEventListener("input", function (e) {
    var d = e.target.value.replace(/\D/g, "").slice(0, 6);
    e.target.value = d.length > 3 ? d.slice(0, 3) + " " + d.slice(3) : d;
  });
  $("#date").value = aujourdhui();

  // ---- « Remember this phone » (même mécanisme qu'Aviator, clé propre à Boarding) ----
  var MEMO = "boarding-memo", qr = /[?&]c=(\d{6})(?:&|$)/.exec(location.search);
  function memoLire() { try { return localStorage.getItem(MEMO); } catch (e) { return null; } }
  function memoEcrire(v, exp) { try { if (v) { localStorage.setItem(MEMO, v); localStorage.setItem(MEMO + "-exp", String(exp)); } else { localStorage.removeItem(MEMO); localStorage.removeItem(MEMO + "-exp"); } } catch (e) {} }
  function memoInfo() {
    var m = memoLire(), box = $("#memo-info");
    box.hidden = !m;
    if (m) {
      var exp = Number((function () { try { return localStorage.getItem(MEMO + "-exp"); } catch (e) { return 0; } })()) || 0, d = new Date(exp);
      $("#memo-txt").textContent = "This phone is remembered" + (exp ? " until " + pad(d.getDate()) + " " + MOIS[d.getMonth()] + " " + d.getFullYear() : "") + ": no code needed.";
    }
  }
  function quitter(tous) {
    var m = memoLire(), j = jeton;
    memoEcrire(null); jeton = null;
    var req = tous ? { action: "aviator.oublier", tous: true, jeton: j } : { action: "aviator.oublier", memo: m };
    return (m || tous ? AVIATOR.appel(req).catch(function () {}) : Promise.resolve()).then(function () { location.href = location.pathname; });
  }

  function ouvert(o) {
    jeton = o.jeton;
    $("#vue-code").hidden = true; $("#vue-vols").hidden = false; $("#lie").hidden = false;
    memoInfo();
    window.scrollTo(0, 0);
    charger();
  }
  function ouvrir(code) {
    var b = $("#form-code button"), err = $("#err-code");
    b.disabled = true; b.textContent = "Checking…"; err.hidden = true;
    var garder = !!$("#garder").checked;
    return AVIATOR.appel({ action: "aviator.ouvrir", code: code, garder: garder }).then(function (o) {
      if (o.memo) memoEcrire(o.memo, o.memoExp);
      ouvert(o);
    }).catch(function (x) { msg(err, x.message, false); })
      .then(function () { b.disabled = false; b.textContent = "Open my flights"; });
  }
  $("#form-code").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("#code").value.replace(/\D/g, "");
    if (code.length !== 6) { msg($("#err-code"), "Enter the 6 digits shown on your watch.", false); return; }
    ouvrir(code);
  });

  // ---- Liste des vols ----
  function hm(t, off) { var d = new Date((t + (off || 0)) * 1000); return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); }
  function jour(t, off) { var d = new Date((t + (off || 0)) * 1000); return JOURS[d.getUTCDay()] + " " + pad(d.getUTCDate()) + " " + MOIS[d.getUTCMonth()]; }
  function etat(v) {
    var s = v.st || "", now = Date.now() / 1000;
    if (/^Canceled/.test(s)) return ["CANCELLED", "rouge"];
    if (s === "Arrived") return ["LANDED", ""];
    if (/Departed|EnRoute|Approaching/.test(s)) return ["IN FLIGHT", "bleu"];
    if (s === "Diverted") return ["DIVERTED", "rouge"];
    if (s === "Boarding") return ["BOARDING", ""];
    if (s === "GateClosed") return ["GATE CLOSING", "ambre"];
    if (v.dl > 5) return ["DELAYED +" + v.dl, "ambre"];
    if (v.sd && v.sd - now > 2 * 86400) return ["SCHEDULED", "bleu"];
    return ["ON TIME", ""];
  }
  function info(lab, val) { return val ? "<div><span>" + lab + "</span><b>" + esc(val) + "</b></div>" : ""; }
  function afficherVols(o) {
    var box = $("#liste");
    var vols = o.vols || [];
    if (!vols.length) { box.innerHTML = '<p class="aide">No flight yet. Add one above: it appears on your watch within 5 minutes.</p>'; return; }
    box.innerHTML = "";
    vols.forEach(function (v) {
      var d = document.createElement("div");
      d.className = "carte vol";
      if (v.inconnu) {
        d.innerHTML = '<div class="haut"><span class="num">' + esc(v.n) + '</span><span class="route">' + esc(v.d) + '</span></div><p class="aide">Waiting for flight data…</p>';
      } else {
        var e = etat(v), arrT = v.ea || v.sa, depT = v.ed || v.sd;
        d.innerHTML = '<div class="haut"><span class="num">' + esc(v.n) + '</span><span class="route">' + esc(v.o) + " → " + esc(v.a) + '</span><span class="etat ' + e[1] + '">' + e[0] + "</span></div>" +
          '<p class="aide">' + esc(jour(depT, v.oz)) + " · " + esc(v.oc || v.o) + " → " + esc(v.ac2 || v.a) + (v.al ? " · " + esc(v.al) : "") + "</p>" +
          '<div class="infos">' + info("DEPARTS", hm(depT, v.oz)) + info("ARRIVES", arrT ? hm(arrT, v.az) : "") + info("GATE", (v.gp ? v.g + " (was " + v.gp + ")" : v.g)) +
          info("TERMINAL", v.t) + info("SEAT", v.s) + info("CHECK-IN", v.ck) + info("BELT", v.b) + info("AIRCRAFT", v.md) + "</div>";
      }
      var b = document.createElement("button");
      b.type = "button"; b.className = "bouton second suppr"; b.textContent = "Remove";
      b.addEventListener("click", function () {
        b.disabled = true;
        AVIATOR.appel({ action: "boarding.supprimer", jeton: jeton, n: String(v.n).replace(/\s/g, ""), d: v.d }).then(afficherVols)
          .catch(erreur).then(function () { b.disabled = false; });
      });
      d.appendChild(b);
      box.appendChild(d);
    });
  }
  function erreur(x) {
    var m = $("#msg");
    if (x && x.code === "session") { msg(m, x.message, false); setTimeout(function () { location.href = location.pathname; }, 2500); return; }
    msg(m, (x && x.message) || "Error.", false);
  }
  function charger() {
    $("#liste").innerHTML = '<p class="aide">Loading…</p>';
    AVIATOR.appel({ action: "boarding.charger", jeton: jeton }).then(function (o) { afficherVols(o); maison(o.h); }).catch(erreur);
  }

  // ---- Fuseau maison ----
  function maison(h) {
    var sel = $("#maison"), zones = [];
    try { zones = Intl.supportedValuesOf("timeZone"); } catch (e) { zones = []; }
    var ici = ""; try { ici = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    [h, ici, "Europe/Luxembourg"].forEach(function (z) { if (z && zones.indexOf(z) < 0) zones.push(z); });
    zones.sort();
    sel.innerHTML = zones.map(function (z) { return '<option value="' + esc(z) + '">' + esc(z.replace(/_/g, " ")) + (z === ici ? " (this phone)" : "") + "</option>"; }).join("");
    sel.value = h || ici;
  }
  $("#maison").addEventListener("change", function (e) {
    AVIATOR.appel({ action: "boarding.maison", jeton: jeton, tz: e.target.value })
      .then(function () { msg($("#msg"), "Home time zone saved.", true); }).catch(erreur);
  });

  // ---- Ajout manuel ----
  function ajouter(vol) {
    var m = $("#msg"), b = $("#ajouter");
    b.disabled = true; b.textContent = "Checking the flight…"; m.hidden = true;
    return AVIATOR.appel({ action: "boarding.ajouter", jeton: jeton, vol: vol }).then(function (o) {
      var v = o.vol;
      msg(m, "Added: " + v.n + " " + v.o + " → " + v.a + ", " + jour(v.ed || v.sd, v.oz) + " at " + hm(v.ed || v.sd, v.oz) + ". It appears on your watch within 5 minutes.", true);
      afficherVols(o);
      $("#num").value = ""; $("#siege").value = "";
    }).catch(erreur).then(function () { b.disabled = false; b.textContent = "Add to my watch"; m.scrollIntoView({ block: "center" }); });
  }
  $("#num").addEventListener("input", function (e) { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, ""); });
  $("#siege").addEventListener("input", function (e) { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
  $("#form-vol").addEventListener("submit", function (e) {
    e.preventDefault();
    var n = $("#num").value.replace(/\s/g, ""), d = $("#date").value;
    if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(n)) { msg($("#msg"), "Type the flight number as on your ticket, e.g. LG8803.", false); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { msg($("#msg"), "Choose the departure date.", false); return; }
    ajouter({ n: n, d: d, s: $("#siege").value });
  });

  // ---- Carte d'embarquement (code-barres IATA BCBP), lue sur le téléphone ----
  // Exemple : M1DOE/JOHN EQZ5S2V FCOMADFR 9601 308Y020B0142 ...
  function bcbp(txt) {
    txt = String(txt || "");
    if (!/^M[1-4]/.test(txt) || txt.length < 58) return null;
    var legs = [], n = Number(txt[1]), pos = 23;
    for (var i = 0; i < n && pos + 35 <= txt.length; i++) {
      var leg = txt.substr(pos, 37);
      var from = leg.substr(7, 3), to = leg.substr(10, 3), car = leg.substr(13, 3).trim(), num = leg.substr(16, 5).trim().replace(/^0+/, ""), jj = Number(leg.substr(21, 3)), seat = leg.substr(25, 4).trim().replace(/^0+/, "");
      if (/^[A-Z]{3}$/.test(from) && car && num && jj > 0) legs.push({ o: from, a: to, n: car + num, j: jj, s: seat });
      var taille = parseInt(leg.substr(35, 2), 16) || 0;
      pos += 37 + taille;
    }
    return legs;
  }
  // jour de l'année -> prochaine date (hier compris), l'année n'étant pas dans le code
  function dateJulien(j) {
    var now = new Date(), y = now.getFullYear();
    for (var k = 0; k < 2; k++) {
      var d = new Date(Date.UTC(y + k, 0, 1) + (j - 1) * 86400000);
      if (d.getTime() > Date.now() - 2 * 86400000) return d.toISOString().slice(0, 10);
    }
    return null;
  }
  function luCode(txt) {
    var legs = bcbp(txt);
    if (!legs || !legs.length) { msg($("#msg"), "This barcode is not a boarding pass. Try again, or type the flight number below.", false); return; }
    arreterCamera();
    var p = Promise.resolve();
    legs.forEach(function (l) {
      var d = dateJulien(l.j);
      if (d) p = p.then(function () { return ajouter({ n: l.n, d: d, s: l.s, o: l.o }); });
    });
  }

  var flux = null, boucle = null, lecteurZX = null;
  function zxing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    return new Promise(function (ok, ko) {
      var s = document.createElement("script"); s.src = "zxing-0.21.3.min.js"; s.onload = function () { ok(window.ZXing); }; s.onerror = ko;
      document.head.appendChild(s);
    });
  }
  function detecteur() {
    if ("BarcodeDetector" in window) {
      return BarcodeDetector.getSupportedFormats().then(function (f) {
        var voulu = ["aztec", "pdf417", "qr_code", "data_matrix"].filter(function (x) { return f.indexOf(x) >= 0; });
        if (voulu.indexOf("aztec") < 0 || voulu.indexOf("pdf417") < 0) return null;
        var d = new BarcodeDetector({ formats: voulu });
        return function (src) { return d.detect(src).then(function (r) { return r.length ? r[0].rawValue : null; }); };
      }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }
  function lecteurImage() {
    return detecteur().then(function (natif) {
      if (natif) return natif;
      return zxing().then(function (Z) {
        var hints = new Map();
        hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.AZTEC, Z.BarcodeFormat.PDF_417, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX]);
        hints.set(Z.DecodeHintType.TRY_HARDER, true);
        var r = new Z.MultiFormatReader(); r.setHints(hints);
        var c = document.createElement("canvas"), x = c.getContext("2d", { willReadFrequently: true });
        return function (src) {
          var w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
          var k = Math.min(1, 1400 / Math.max(w, h)); c.width = Math.round(w * k); c.height = Math.round(h * k);
          x.drawImage(src, 0, 0, c.width, c.height);
          var px = x.getImageData(0, 0, c.width, c.height).data, lum = new Uint8ClampedArray(c.width * c.height);
          for (var i = 0, j = 0; i < px.length; i += 4, j++) lum[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
          try { return Promise.resolve(r.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, c.width, c.height)))).getText()); }
          catch (e) { return Promise.resolve(null); }
        };
      });
    });
  }
  function arreterCamera() {
    if (boucle) { clearTimeout(boucle); boucle = null; }
    if (flux) { flux.getTracks().forEach(function (t) { t.stop(); }); flux = null; }
    $("#camera").hidden = true;
  }
  $("#scanner").addEventListener("click", function () {
    $("#msg").hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $("#photo").click(); return; }
    $("#camera").hidden = false;
    var v = $("#video");
    lecteurImage().then(function (lire) {
      lecteurZX = lire;
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(function (s) {
        flux = s; v.srcObject = s; return v.play();
      }).then(function () {
        var tour = function () {
          if (!flux) return;
          lire(v).then(function (t) { if (t) luCode(t); else boucle = setTimeout(tour, 250); }).catch(function () { boucle = setTimeout(tour, 400); });
        };
        tour();
      });
    }).catch(function () {
      arreterCamera();
      msg($("#msg"), "The camera is not available. Choose a photo or a screenshot of your boarding pass instead.", false);
      $("#photo").click();
    });
  });
  $("#cam-stop").addEventListener("click", arreterCamera);
  $("#photo-btn").addEventListener("click", function () { $("#photo").click(); });
  $("#photo").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var img = new Image(), url = URL.createObjectURL(f);
    img.onload = function () {
      (lecteurZX ? Promise.resolve(lecteurZX) : lecteurImage()).then(function (lire) { return lire(img); }).then(function (t) {
        URL.revokeObjectURL(url);
        if (t) luCode(t); else msg($("#msg"), "No boarding pass barcode found in this picture. Crop it closer to the barcode, or type the flight number below.", false);
      }).catch(function () { msg($("#msg"), "Could not read this picture.", false); });
    };
    img.src = url;
    e.target.value = "";
  });

  $("#quitter").addEventListener("click", function (e) { e.preventDefault(); quitter(false); });
  $("#memo-oublier").addEventListener("click", function () { quitter(false); });
  $("#memo-tous").addEventListener("click", function () { quitter(true); });

  // Arrivée par le QR code de la montre : ouverture directe ; sinon téléphone mémorisé
  if (qr) {
    $("#code").value = qr[1].slice(0, 3) + " " + qr[1].slice(3);
    ouvrir(qr[1]);
  } else if (memoLire()) {
    var b = $("#form-code button"), t = b.textContent;
    b.disabled = true; b.textContent = "Opening…";
    AVIATOR.appel({ action: "aviator.reprendre", memo: memoLire() }).then(ouvert).catch(function (x) {
      if (x.code === "memo") memoEcrire(null);
    }).then(function () { b.disabled = false; b.textContent = t; });
  }
})();
