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
          info("TERMINAL", v.t) + info("SEAT", v.s) + info("CHECK-IN", v.ck) + info("BELT", v.b) + info("AIRCRAFT", v.md) +
          info("ARR. GATE", v.ag) + info("ARR. TERMINAL", v.ta) + "</div>" +
          (v.ld ? '<p class="aide"><b style="color:var(--ambre)">Likely delay +' + v.ld + ' min</b>: the aircraft that will fly you lands late.</p>' : "") +
          (v.lv ? '<p class="depart">Leave home at ' + hm(v.lv, -new Date().getTimezoneOffset() * 60) + "</p>" : "") +
          frise(v) + '<div class="carte-vol" id="map-' + esc(v.n.replace(/\W/g, "") + v.d) + '"></div>' +
          '<div class="actions">' + (v.ola != null ? '<a class="bouton second" target="_blank" rel="noopener" href="' + uber(v) + '">Uber to ' + esc(v.o) + "</a>" : "") +
          '<button class="bouton second" type="button" data-copier="' + esc(adresseAeroport(v)) + '">Copy airport address</button></div>';
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
      var cp = d.querySelector("[data-copier]");
      if (cp) cp.addEventListener("click", function () { copier(cp.getAttribute("data-copier"), cp); });
      if (!v.inconnu) carteVol(v);
    });
  }

  // ---- Frise : bag drop, embarquement, portes, départ (heures estimées) ----
  function frise(v) {
    var dep = v.ed || v.sd, now = Date.now() / 1000;
    var pts = [["BAG DROP", dep - 2700], ["BOARDING", dep - 2400], ["DOORS", dep - 900], ["DEPARTS", dep]];
    if (v.tk) pts.push(["TAKE-OFF", v.tk]);
    var t0 = pts[0][1], t1 = pts[pts.length - 1][1], pos = function (t) { return Math.max(0, Math.min(100, (t - t0) / (t1 - t0) * 100)); };
    var h = '<div class="frise"><div class="rail"></div><div class="fait" style="width:' + pos(now).toFixed(1) + '%"></div>';
    pts.forEach(function (p, i) {
      var x = pos(p[1]), al = x < 14 ? "left:0;transform:none;text-align:left" : (x > 86 ? "right:0;left:auto;transform:none;text-align:right" : "left:" + x + "%");
      h += '<div class="pt' + (now >= p[1] ? " ok" : "") + '" style="left:' + x + '%"></div><div class="lb ' + (i % 2 ? "lh" : "lb2") + '" style="' + al + '">' + p[0] + "<br><b>" + hm(p[1], v.oz) + "</b></div>";
    });
    return h + '</div><p class="aide">Bag drop, boarding and doors are estimated from the departure time. Follow the airport screens.</p>';
  }

  // ---- Carte : route et position estimée de l'avion ----
  function carteVol(v) {
    var el = document.getElementById("map-" + v.n.replace(/\W/g, "") + v.d);
    if (!el || v.ola == null || v.ala == null || !window.L) { if (el) el.remove(); return; }
    var m = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/" + (AVIATOR.sombre() ? "dark_all" : "light_all") + "/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap © CARTO", maxZoom: 10 }).addTo(m);
    var a = [v.ola, v.olo], b = [v.ala, v.alo], ligne = [];
    for (var i = 0; i <= 40; i++) { var f = i / 40; ligne.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
    L.polyline(ligne, { color: "#4F8FE8", weight: 3, dashArray: "6 6" }).addTo(m);
    L.circleMarker(a, { radius: 6, color: "#4F8FE8", fillOpacity: 1 }).addTo(m).bindTooltip(v.o, { permanent: true, direction: "left" });
    L.circleMarker(b, { radius: 6, color: "#4F8FE8", fillOpacity: 1 }).addTo(m).bindTooltip(v.a, { permanent: true, direction: "right" });
    var now = Date.now() / 1000, d0 = v.tk || v.ed || v.sd, d1 = v.ea || v.sa;
    if (d0 && d1 && now > d0 && now < d1) {
      var f = (now - d0) / (d1 - d0), p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      L.circleMarker(p, { radius: 9, color: "#FFFFFF", fillColor: "#4F8FE8", fillOpacity: 1, weight: 3 }).addTo(m).bindTooltip("Estimated position", { direction: "top" });
    }
    m.fitBounds([a, b], { padding: [30, 30] });
  }

  function uber(v) {
    return "https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff%5Blatitude%5D=" + v.ola + "&dropoff%5Blongitude%5D=" + v.olo +
      "&dropoff%5Bnickname%5D=" + encodeURIComponent((v.oc || v.o) + " Airport" + (v.t ? " T" + v.t : ""));
  }
  function adresseAeroport(v) { return (v.oc || v.o) + " Airport (" + v.o + ")" + (v.t ? ", Terminal " + v.t : ""); }
  function copier(txt, btn) {
    var fin = function () { var t = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(function () { btn.textContent = t; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(fin).catch(function () { prompt("Copy:", txt); });
    else prompt("Copy:", txt);
  }
  function erreur(x) {
    var m = $("#msg");
    if (x && x.code === "session") { msg(m, x.message, false); setTimeout(function () { location.href = location.pathname; }, 2500); return; }
    msg(m, (x && x.message) || "Error.", false);
  }
  function charger() {
    $("#liste").innerHTML = '<p class="aide">Loading…</p>';
    AVIATOR.appel({ action: "boarding.charger", jeton: jeton }).then(function (o) { afficherVols(o); maison(o.h); trajetAfficher(o.tr); alertesEtat(o.alertes); }).catch(erreur);
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

  // ---- Alertes (Web Push) ----
  var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent), installee = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  function b64(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); var r = atob(s + "===".slice((s.length + 3) % 4)), o = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; }
  function alertesEtat(n) {
    var ok = "serviceWorker" in navigator && "PushManager" in window, e = $("#alertes-etat"), b = $("#alertes");
    $("#alertes-ios").hidden = !(iOS && !installee);
    if (!ok) { b.disabled = true; e.textContent = iOS && !installee ? "" : "This browser cannot receive alerts."; return; }
    b.disabled = iOS && !installee;
    e.textContent = n ? "Alerts are on for " + n + " device" + (n > 1 ? "s" : "") + "." : "";
    if (n) b.textContent = "Turn on alerts on this phone too";
  }
  $("#alertes").addEventListener("click", function () {
    var b = $("#alertes"); b.disabled = true;
    Notification.requestPermission().then(function (p) {
      if (p !== "granted") throw { message: "Notifications are blocked for this site. Allow them in your browser settings." };
      return Promise.all([navigator.serviceWorker.register("sw.js", { scope: "./" }), AVIATOR.appel({ action: "boarding.cle" })]);
    }).then(function (r) {
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(r[1].cle) }); });
      });
    }).then(function (sub) {
      return AVIATOR.appel({ action: "boarding.abonner", jeton: jeton, sub: sub.toJSON() });
    }).then(function (o) { alertesEtat(o.alertes); msg($("#msg"), "Alerts are on. A test notification is on its way.", true); })
      .catch(function (x) { erreur(x); }).then(function () { b.disabled = false; });
  });

  // ---- Trajet vers l'aéroport ----
  var depart = null;
  function trajetAfficher(tr) {
    if (!tr) return;
    depart = { la: tr.la, lo: tr.lo, lab: tr.lab };
    $("#adr-choisie").textContent = "Starting point: " + (tr.lab || tr.la + ", " + tr.lo);
    var r = document.querySelector('input[name="mode"][value="' + tr.mode + '"]'); if (r) r.checked = true;
    if (tr.min) $("#minutes").value = tr.min;
    $("#avance").value = tr.av || 90;
    majMode();
  }
  function majMode() { var m = document.querySelector('input[name="mode"]:checked'); $("#ligne-min").hidden = !(m && m.value === "min"); }
  document.querySelectorAll('input[name="mode"]').forEach(function (x) { x.addEventListener("change", majMode); });
  var nAdr = 0, tAdr = null;
  $("#adresse").addEventListener("input", function () {
    clearTimeout(tAdr);
    var q = $("#adresse").value.trim(), box = $("#adr-sg");
    if (q.length < 4) { box.hidden = true; return; }
    tAdr = setTimeout(function () {
      var mine = ++nAdr;
      fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&q=" + encodeURIComponent(q), { headers: { "Accept-Language": "en" } })
        .then(function (r) { return r.json(); }).then(function (l) {
          if (mine !== nAdr) return;
          box.innerHTML = "";
          l.forEach(function (a) {
            var bt = document.createElement("button"); bt.type = "button"; bt.className = "sugg";
            bt.innerHTML = "<span>" + esc(a.display_name) + "</span>";
            bt.addEventListener("click", function () {
              depart = { la: Number(a.lat), lo: Number(a.lon), lab: a.display_name.split(",").slice(0, 3).join(",") };
              $("#adr-choisie").textContent = "Starting point: " + depart.lab; box.hidden = true; $("#adresse").value = "";
            });
            box.appendChild(bt);
          });
          box.hidden = !l.length;
        }).catch(function () { box.hidden = true; });
    }, 450);
  });
  $("#ici").addEventListener("click", function () {
    if (!navigator.geolocation) { msg($("#msg"), "Position is not available on this device.", false); return; }
    navigator.geolocation.getCurrentPosition(function (p) {
      depart = { la: p.coords.latitude, lo: p.coords.longitude, lab: "My position" };
      $("#adr-choisie").textContent = "Starting point: my position (" + p.coords.latitude.toFixed(3) + ", " + p.coords.longitude.toFixed(3) + ")";
    }, function () { msg($("#msg"), "Position refused or unavailable.", false); }, { enableHighAccuracy: false, timeout: 15000 });
  });
  $("#trajet").addEventListener("click", function () {
    if (!depart) { msg($("#msg"), "Choose a starting point first (address or your position).", false); return; }
    var mode = document.querySelector('input[name="mode"]:checked').value;
    AVIATOR.appel({ action: "boarding.trajet", jeton: jeton, tr: { la: depart.la, lo: depart.lo, lab: depart.lab, mode: mode, min: Number($("#minutes").value) || 0, av: Number($("#avance").value) || 90 } })
      .then(function () { msg($("#msg"), "Saved. Your watch shows when to leave, from 30 hours before departure.", true); charger(); }).catch(erreur);
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
