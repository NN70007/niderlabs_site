/* Boarding — page mobile : connexion par e-mail (code à 6 chiffres) ou code de la montre → vols, trajet, alertes, montres, compte. */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var jeton = null, compte = false, dernier = null;
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var MOIS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  var JOURS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lsLire(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsEcrire(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function now() { return Date.now() / 1000; }
  function aujourdhui() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function hm(t, off) { var d = new Date((t + (off || 0)) * 1000); return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); }
  function jourTxt(t, off) { var d = new Date((t + (off || 0)) * 1000); return JOURS[d.getUTCDay()] + " " + pad(d.getUTCDate()) + " " + MOIS[d.getUTCMonth()]; }
  function jhm(t, off) { var d = new Date((t + (off || 0)) * 1000); return JOURS[d.getUTCDay()] + " " + hm(t, off); }
  function duree(s) { s = Math.max(0, Math.round(s / 60)); return s >= 60 ? Math.floor(s / 60) + " h " + pad(s % 60) : s + " min"; }

  // ---- messages ----
  var tToast = null;
  function toast(txt, ok) {
    var t = $("#toast"); clearTimeout(tToast);
    t.textContent = txt; t.className = "toast " + (ok ? "ok" : "err"); t.hidden = !txt;
    tToast = setTimeout(function () { t.hidden = true; }, ok ? 4500 : 7000);
  }
  function msgEntrer(txt, ok) { var m = $("#m-entrer"); m.textContent = txt; m.className = "message " + (ok ? "ok" : "err"); m.hidden = !txt; }
  function erreur(x) {
    if (x && (x.code === "session" || x.code === "memo")) { toast("Please sign in again.", false); setTimeout(function () { sortir(false); }, 1800); return; }
    toast((x && x.message) || "Error.", false);
  }
  function chiffres(input) {
    input.addEventListener("input", function () { var d = input.value.replace(/\D/g, "").slice(0, 6); input.value = d.length > 3 ? d.slice(0, 3) + " " + d.slice(3) : d; });
  }
  ["#otp", "#wcode", "#lcode"].forEach(function (s) { chiffres($(s)); });
  $("#date").value = aujourdhui();

  // ---- mémorisation du téléphone (même clé qu'avant : les téléphones déjà mémorisés restent ouverts) ----
  var MEMO = "boarding-memo";
  function memoEcrire(v, exp) { lsEcrire(MEMO, v || null); lsEcrire(MEMO + "-exp", v ? String(exp) : null); }

  // ---- connexion par e-mail ----
  var email = "";
  function envoyerCode() {
    var b = $("#f-email button"); b.disabled = true; b.textContent = "Sending…"; msgEntrer("");
    return AVIATOR.appel({ action: "boarding.code", email: email }).then(function () {
      $("#f-email").hidden = true; $("#f-otp").hidden = false; $("#otp-email").textContent = email.toUpperCase();
      $("#otp").value = ""; $("#otp").focus();
      msgEntrer("Code sent. Check your inbox (and the spam folder).", true);
    }).catch(function (x) { msgEntrer(x.message, false); }).then(function () { b.disabled = false; b.textContent = "Send me a code"; });
  }
  $("#f-email").addEventListener("submit", function (e) {
    e.preventDefault();
    email = $("#email").value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msgEntrer("Please enter a valid e-mail address.", false); return; }
    lsEcrire("boarding-email", email);
    envoyerCode();
  });
  $("#otp-retour").addEventListener("click", function () { $("#f-otp").hidden = true; $("#f-email").hidden = false; msgEntrer(""); });
  $("#otp-renvoi").addEventListener("click", envoyerCode);
  $("#otp").addEventListener("input", function () { if ($("#otp").value.replace(/\D/g, "").length === 6) $("#f-otp").requestSubmit(); });
  $("#f-otp").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("#otp").value.replace(/\D/g, ""), b = $("#f-otp button[type=submit]");
    if (code.length !== 6) { msgEntrer("Type the 6 digits from the e-mail.", false); return; }
    b.disabled = true; b.textContent = "Signing in…";
    AVIATOR.appel({ action: "boarding.entrer", email: email, code: code, garder: $("#garder").checked }).then(function (o) {
      if (o.memo) memoEcrire(o.memo, o.memoExp);
      msgEntrer(""); ouvert(o);
      if (o.nouveau) toast("Welcome! Add your first flight: scan your boarding pass or type the flight number.", true);
    }).catch(function (x) { msgEntrer(x.message, false); }).then(function () { b.disabled = false; b.textContent = "Sign in"; });
  });
  if (lsLire("boarding-email")) $("#email").value = lsLire("boarding-email");

  // ---- ouverture avec le code de la montre ----
  function ouvrirMontre(code, bouton) {
    if (bouton) { bouton.disabled = true; bouton.textContent = "Checking…"; }
    return AVIATOR.appel({ action: "aviator.ouvrir", code: code, garder: true }).then(function (o) {
      if (o.memo) memoEcrire(o.memo, o.memoExp);
      o.montre = true; ouvert(o);
    }).catch(function (x) { voir("entrer"); $("#d-montre").open = true; msgEntrer(x.message, false); })
      .then(function () { if (bouton) { bouton.disabled = false; bouton.textContent = "Open with the watch code"; } });
  }
  $("#f-montre").addEventListener("submit", function (e) {
    e.preventDefault();
    var c = $("#wcode").value.replace(/\D/g, "");
    if (c.length !== 6) { msgEntrer("Enter the 6 digits shown on your watch.", false); return; }
    ouvrirMontre(c, $("#f-montre button"));
  });

  // ---- vues et onglets ----
  function voir(v) { $("#v-entrer").hidden = v !== "entrer"; $("#v-app").hidden = v !== "app"; $("#nav").hidden = v !== "app"; }
  function onglet(o) {
    document.querySelectorAll(".onglet").forEach(function (x) { x.hidden = x.id !== "o-" + o; });
    document.querySelectorAll("#nav button").forEach(function (b) { if (b.getAttribute("data-o") === o) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    window.scrollTo(0, 0);
    try { history.replaceState(null, "", "#" + o); } catch (e) {}
  }
  document.querySelectorAll("#nav button").forEach(function (b) { b.addEventListener("click", function () { onglet(b.getAttribute("data-o")); }); });

  function ouvert(o) {
    jeton = o.jeton; compte = !o.montre && !!o.email;
    voir("app");
    var h = (location.hash || "").slice(1);
    onglet(["vols", "trajet", "montre", "moi"].indexOf(h) >= 0 ? h : "vols");
    $("#moi-titre").textContent = compte ? "Signed in" : "Opened with your watch code";
    $("#moi-email").textContent = compte ? o.email : "Your flights are kept with your watch.";
    $("#effacer-box").hidden = !compte;
    $("#montres-compte").hidden = !compte; $("#montre-seule").hidden = compte;
    var exp = Number(lsLire(MEMO + "-exp")) || 0, d = new Date(exp);
    $("#memo-txt").textContent = lsLire(MEMO) ? "This phone stays signed in" + (exp ? " until " + pad(d.getDate()) + " " + MOIS[d.getMonth()] + " " + d.getFullYear() : "") + "." : "";
    $("#sortir-tous").hidden = !lsLire(MEMO);
    installer();
    charger();
  }
  function sortir(tous) {
    var m = lsLire(MEMO), j = jeton;
    memoEcrire(null); jeton = null;
    var p = tous && compte ? AVIATOR.appel({ action: "boarding.sortir", memo: m, jeton: j }) :
      tous ? AVIATOR.appel({ action: "aviator.oublier", tous: true, jeton: j }) : AVIATOR.appel({ action: "boarding.sortir", memo: m, jeton: j });
    p.catch(function () {}).then(function () { location.href = location.pathname; });
  }
  $("#sortir").addEventListener("click", function () { sortir(false); });
  $("#sortir-tous").addEventListener("click", function () { sortir(true); });
  $("#effacer").addEventListener("click", function () {
    if (!confirm("Delete your Boarding account? Your e-mail, flights and settings will be erased.")) return;
    AVIATOR.appel({ action: "boarding.effacer", jeton: jeton, confirme: true }).then(function () {
      memoEcrire(null); lsEcrire("boarding-email", null); jeton = null;
      alert("Your account has been deleted."); location.href = location.pathname;
    }).catch(erreur);
  });

  function charger() {
    $("#liste").innerHTML = '<p class="aide">Loading your flights…</p>';
    return AVIATOR.appel({ action: "boarding.charger", jeton: jeton }).then(function (o) {
      afficherVols(o); maison(o.h); trajetAfficher(o.tr); alertesEtat(o.alertes);
      if (o.compte) afficherMontres(o.compte.montres);
    }).catch(erreur);
  }

  // ---- vols ----
  function etat(v) {
    var s = v.st || "";
    if (/^Canceled/.test(s)) return ["CANCELLED", "rouge"];
    if (s === "Arrived") return ["LANDED", ""];
    if (s === "Diverted") return ["DIVERTED", "rouge"];
    if (v.tk || /Departed|EnRoute|Approaching/.test(s)) return ["IN FLIGHT", "bleu"];
    if (s === "Boarding") return ["BOARDING", ""];
    if (s === "GateClosed") return ["GATE CLOSING", "ambre"];
    if (v.dl > 5) return ["DELAYED +" + v.dl, "ambre"];
    if (v.ld) return ["LIKELY DELAY", "ambre"];
    if (v.sd && v.sd - now() > 2 * 86400) return ["SCHEDULED", "gris"];
    return ["ON TIME", ""];
  }
  function cas(lab, val, cl, sous) { return val ? "<div><span>" + lab + '</span><b class="' + (cl || "") + '">' + esc(val) + "</b>" + (sous ? "<small>" + esc(sous) + "</small>" : "") + "</div>" : ""; }
  function bandeaux(v) {
    var h = "", t = now(), dep = v.ed || v.sd, parti = v.tk || /Departed|EnRoute|Approaching|Arrived|Diverted/.test(v.st || "");
    if (/^Canceled/.test(v.st || "")) return '<div class="bandeau rouge">Flight cancelled<small>Contact your airline to rebook.</small></div>';
    if (v.lv && !parti && t < v.lv + 1200) {
      var r = v.lv - t;
      if (r <= 0) h += '<div class="bandeau rouge"><span>LEAVE NOW<small>' + v.tm + " min to " + esc(v.o) + "</small></span></div>";
      else if (r < 1800) h += '<div class="bandeau rouge"><span>LEAVE HOME IN<small>at ' + hm(v.lv, v.oz) + " · " + v.tm + ' min to the airport</small></span><span class="grand">' + duree(r) + "</span></div>";
      else if (r < 3 * 3600) h += '<div class="bandeau ambre"><span>LEAVE HOME IN<small>at ' + hm(v.lv, v.oz) + " · " + v.tm + ' min to the airport</small></span><span class="grand">' + duree(r) + "</span></div>";
      else h += '<div class="bandeau ambre"><span>LEAVE HOME<small>' + v.tm + " min to the airport · " + v.av + ' min before departure</small></span><span class="grand">' + jhm(v.lv, v.oz) + "</span></div>";
    }
    if (v.ci) h += '<div class="bandeau ambre"><span>CHECK IN ONLINE<small>Online check-in is usually open now – use your airline’s app or website.</small></span></div>';
    if (v.ld && !parti) h += '<div class="bandeau ambre"><span>LIKELY DELAY +' + v.ld + " MIN<small>The aircraft that will fly you lands late" + (v.in && v.in.o ? " from " + esc(v.in.o) : "") + ".</small></span></div>";
    return h;
  }
  function afficherVols(o) {
    var box = $("#liste"), vols = o.vols || [];
    dernier = o;
    if (!vols.length) { box.innerHTML = '<div class="carte"><h2>No flight yet</h2><p class="aide">Scan your boarding pass or type your flight number above. You can add flights months ahead.</p></div>'; return; }
    box.innerHTML = "";
    vols.forEach(function (v) {
      var d = document.createElement("div"); d.className = "carte vol";
      if (v.inconnu) {
        d.innerHTML = '<div class="tete"><div><div class="num">' + esc(v.n) + '</div><div class="jourv">' + esc(v.d) + '</div></div></div><p class="aide">Waiting for flight data…</p>';
      } else {
        var e = etat(v), dep = v.ed || v.sd, arr = v.ea || v.sa, id = v.n.replace(/\W/g, "") + v.d;
        var porte = v.g ? v.g : (dep > now() && !v.tk ? "SOON" : "");
        d.innerHTML = '<div class="tete"><div><div class="num">' + esc(v.n) + '</div><div class="jourv">' + esc(jourTxt(dep, v.oz)) + (v.al ? " · " + esc(v.al) : "") + '</div></div><span class="pill ' + e[1] + '">' + e[0] + "</span></div>" +
          '<div class="trajetv"><div class="apt"><span class="code3">' + esc(v.o) + '</span><span class="ville">' + esc(v.oc || "") + '</span><span class="h' + (v.dl > 5 ? " ambre" : "") + '">' + hm(dep, v.oz) + '</span></div><span class="fleche">→</span>' +
          '<div class="apt"><span class="code3">' + esc(v.a) + '</span><span class="ville">' + esc(v.ac2 || "") + '</span><span class="h">' + (arr ? hm(arr, v.az) : "") + "</span></div></div>" +
          bandeaux(v) +
          '<div class="mini" role="tablist"><button type="button" role="tab" aria-selected="true" data-o="info">Details</button><button type="button" role="tab" data-o="jour">My day</button><button type="button" role="tab" data-o="carte">Map</button></div>' +
          '<div data-p="info"><div class="cases">' + cas(v.gp ? "NEW GATE" : "GATE", porte, v.gp ? "rouge" : "", v.gp ? "was " + v.gp : "") + cas("TERMINAL", v.t) + cas("SEAT", v.s) +
          cas("CHECK-IN", v.ck) + cas("BELT", v.b) + cas("AIRCRAFT", v.md) + cas("ARR. GATE", v.ag) + cas("ARR. TERM.", v.ta) +
          (v.wx ? cas("AT " + v.a, v.wx.t != null ? v.wx.t + "°" : "", "", v.wx.w || "") : "") + "</div></div>" +
          '<div data-p="jour" hidden>' + journee(v) + "</div>" +
          '<div data-p="carte" hidden><div class="carte-vol" id="map-' + esc(id) + '"></div></div>' +
          '<div class="pied-vol"><button class="lien" type="button" data-suppr>Remove flight</button></div>';
        var tabs = d.querySelectorAll(".mini button"), faite = false;
        tabs.forEach(function (t) {
          t.addEventListener("click", function () {
            tabs.forEach(function (x) { x.setAttribute("aria-selected", x === t ? "true" : "false"); });
            d.querySelectorAll("[data-p]").forEach(function (p) { p.hidden = p.getAttribute("data-p") !== t.getAttribute("data-o"); });
            if (t.getAttribute("data-o") === "carte" && !faite) { faite = true; carteVol(v); }
          });
        });
        d.querySelectorAll("[data-copier]").forEach(function (cp) { cp.addEventListener("click", function () { copier(cp.getAttribute("data-copier"), cp); }); });
      }
      var b = d.querySelector("[data-suppr]");
      if (!b) { b = document.createElement("button"); b.type = "button"; b.className = "lien"; b.textContent = "Remove flight"; d.appendChild(b); }
      b.addEventListener("click", function () {
        if (!confirm("Remove " + v.n + "?")) return;
        b.disabled = true;
        AVIATOR.appel({ action: "boarding.supprimer", jeton: jeton, n: String(v.n).replace(/\s/g, ""), d: v.d }).then(afficherVols).catch(erreur).then(function () { b.disabled = false; });
      });
      box.appendChild(d);
    });
  }

  // ---- « My day » : aller à l'aéroport, puis à la porte ----
  function journee(v) {
    var dep = v.ed || v.sd, t = now(), aller = [];
    if (v.lv) {
      var veille = jourTxt(v.lv, v.oz) !== jourTxt(dep, v.oz);
      aller.push(["Leave home" + (veille ? " · " + jourTxt(v.lv, v.oz) : ""), v.lv, v.oz, v.tm ? v.tm + " min to the airport" : ""]);
      aller.push(["At the airport", v.lv + v.tm * 60, v.oz, v.av ? v.av + " min before departure" : ""]);
    }
    aller.push(["Bag drop closes", dep - 2700, v.oz, v.ck ? "Check-in desk " + v.ck : ""]);
    var porte = [["Boarding", dep - 2400, v.oz, v.g ? "Gate " + v.g : "Gate not announced yet"], ["Doors close", dep - 900, v.oz, ""], ["Departure", dep, v.oz, v.tk ? "Took off " + hm(v.tk, v.oz) : ""]];
    var prochain = null;
    aller.concat(porte).forEach(function (p) { if (!prochain && p[1] > t) prochain = p; });
    var ligne = function (p) {
      return '<li class="' + (p[1] <= t ? "fait" : p === prochain ? "suivant" : "") + '"><span class="h">' + hm(p[1], p[2]) + '</span><span class="pt"></span><span class="t">' + esc(p[0]) + (p[3] ? "<small>" + esc(p[3]) + "</small>" : "") + "</span></li>";
    };
    var raison = { far: "Your starting point is far from " + v.o + ": no leave-home time for this flight.", noairport: "Airport position not known yet.", route: "No car route found – set your own travel time in Travel." }[v.tw];
    var h = '<div class="jour"><p class="jour-date">' + esc(jourTxt(dep, v.oz)) + '<span>DEPARTS ' + hm(dep, v.oz) + "</span></p>" +
      "<h3>Getting to " + esc(v.o) + "</h3><ol>" + aller.map(ligne).join("") + "</ol>";
    if (!v.lv) h += '<p class="aide">' + (raison || "Set your starting point in <b>Travel</b> to know when to leave home.") + "</p>";
    if (v.ola != null && dep > t) {
      h += '<div class="uber"><div class="ligne"><a class="bouton second" target="_blank" rel="noopener" href="' + uber(v) + '">Uber now</a>' +
        (v.lv && v.lv > t + 1800 ? '<a class="bouton" target="_blank" rel="noopener" href="' + uber(v) + '">Book Uber for ' + hm(v.lv, v.oz) + "</a>" : "") + "</div>" +
        (v.lv && v.lv > t + 1800 ? '<p class="aide">Uber opens with ' + esc(v.o) + ' as destination. Tap <b>Now › Schedule</b> and choose <button type="button" class="copie" data-copier="' + hm(v.lv, v.oz) + '">' + jourTxt(v.lv, v.oz).slice(0, 3) + " " + hm(v.lv, v.oz) + " ⧉</button></p>" : "") +
        '<button class="lien" type="button" data-copier="' + esc(adresseAeroport(v)) + '">Copy airport address</button></div>';
    }
    h += "<h3>At the gate</h3><ol>" + porte.map(ligne).join("") + '</ol><p class="aide petit">Bag drop, boarding and doors are estimated. Follow the airport screens.</p></div>';
    return h;
  }
  function uber(v) {
    return "https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff%5Blatitude%5D=" + v.ola + "&dropoff%5Blongitude%5D=" + v.olo +
      "&dropoff%5Bnickname%5D=" + encodeURIComponent((v.oc || v.o) + " Airport" + (v.t ? " T" + v.t : ""));
  }
  function adresseAeroport(v) { return (v.oc || v.o) + " Airport (" + v.o + ")" + (v.t ? ", Terminal " + v.t : ""); }
  function copier(txt, btn) {
    var fin = function () { toast("Copied: " + txt, true); };
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(fin).catch(function () { prompt("Copy:", txt); });
    else prompt("Copy:", txt);
  }

  // ---- carte : route et position estimée ----
  function carteVol(v) {
    var el = document.getElementById("map-" + v.n.replace(/\W/g, "") + v.d);
    if (!el || v.ola == null || v.ala == null || !window.L) { if (el) el.outerHTML = '<p class="aide">Map not available for this flight.</p>'; return; }
    var m = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false });
    // fond OpenStreetMap (sans clé) ; assombri par un filtre CSS en mode nuit
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 9, className: AVIATOR.sombre() ? "tuiles-nuit" : "" }).addTo(m);
    var R = Math.PI / 180, la1 = v.ola * R, lo1 = v.olo * R, la2 = v.ala * R, lo2 = v.alo * R;
    var dd = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((la2 - la1) / 2), 2) + Math.cos(la1) * Math.cos(la2) * Math.pow(Math.sin((lo2 - lo1) / 2), 2)));
    var pt = function (f) {
      if (dd < 1e-6) return [v.ola, v.olo];
      var A = Math.sin((1 - f) * dd) / Math.sin(dd), B = Math.sin(f * dd) / Math.sin(dd);
      var x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2), y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2), z = A * Math.sin(la1) + B * Math.sin(la2);
      return [Math.atan2(z, Math.sqrt(x * x + y * y)) / R, Math.atan2(y, x) / R];
    };
    var ligne = []; for (var i = 0; i <= 64; i++) ligne.push(pt(i / 64));
    var t = now(), d0 = v.tk || v.ed || v.sd, d1 = v.ea || v.sa, f = d0 && d1 ? Math.max(0, Math.min(1, (t - d0) / (d1 - d0))) : 0;
    L.polyline(ligne, { color: "#8A939C", weight: 2, opacity: .7, dashArray: "4 6" }).addTo(m);
    if (f > 0) L.polyline(ligne.slice(0, Math.round(f * 64) + 1), { color: "#4F8FE8", weight: 4 }).addTo(m);
    var pin = function (p, s) { L.marker(p, { icon: L.divIcon({ className: "", html: '<span class="apt-pin">' + esc(s) + "</span>", iconSize: null }), interactive: false }).addTo(m); };
    pin([v.ola, v.olo], v.o); pin([v.ala, v.alo], v.a);
    if (f > 0 && f < 1) {
      var p = pt(f), q = pt(Math.min(1, f + 0.01)), cap = Math.atan2(q[1] - p[1], q[0] - p[0]) / R;
      L.marker(p, { icon: L.divIcon({ className: "", html: '<span class="avion" style="transform:rotate(' + (cap - 90).toFixed(0) + 'deg)">✈</span>', iconSize: [28, 28], iconAnchor: [14, 14] }), interactive: false }).addTo(m);
    }
    m.fitBounds(L.latLngBounds(ligne), { padding: [36, 36] });
    setTimeout(function () { m.invalidateSize(); m.fitBounds(L.latLngBounds(ligne), { padding: [36, 36] }); }, 60);
  }

  // ---- ajout manuel ----
  $("#manuel").addEventListener("click", function () { var f = $("#f-vol"); f.hidden = !f.hidden; if (!f.hidden) $("#num").focus(); });
  function ajouter(vol) {
    var b = $("#ajouter"); b.disabled = true; b.textContent = "Checking the flight…";
    return AVIATOR.appel({ action: "boarding.ajouter", jeton: jeton, vol: vol }).then(function (o) {
      var v = o.vol;
      toast("Added: " + v.n + " " + v.o + " → " + v.a + ", " + jourTxt(v.ed || v.sd, v.oz) + " " + hm(v.ed || v.sd, v.oz) + ".", true);
      afficherVols(o); $("#num").value = ""; $("#siege").value = ""; $("#f-vol").hidden = true;
    }).catch(erreur).then(function () { b.disabled = false; b.textContent = "Add flight"; });
  }
  $("#num").addEventListener("input", function (e) { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, ""); });
  $("#siege").addEventListener("input", function (e) { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
  $("#f-vol").addEventListener("submit", function (e) {
    e.preventDefault();
    var n = $("#num").value.replace(/\s/g, ""), d = $("#date").value;
    if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(n)) { toast("Type the flight number as on your ticket, e.g. LG8803.", false); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast("Choose the departure date.", false); return; }
    ajouter({ n: n, d: d, s: $("#siege").value });
  });

  // ---- carte d'embarquement (IATA BCBP), lue sur le téléphone ----
  function bcbp(txt) {
    txt = String(txt || "");
    if (!/^M[1-4]/.test(txt) || txt.length < 58) return null;
    var legs = [], n = Number(txt[1]), pos = 23;
    for (var i = 0; i < n && pos + 35 <= txt.length; i++) {
      var leg = txt.substr(pos, 37);
      var from = leg.substr(7, 3), to = leg.substr(10, 3), car = leg.substr(13, 3).trim(), num = leg.substr(16, 5).trim().replace(/^0+/, ""), jj = Number(leg.substr(21, 3)), seat = leg.substr(25, 4).trim().replace(/^0+/, "");
      if (/^[A-Z]{3}$/.test(from) && car && num && jj > 0) legs.push({ o: from, a: to, n: car + num, j: jj, s: seat });
      pos += 37 + (parseInt(leg.substr(35, 2), 16) || 0);
    }
    return legs;
  }
  function dateJulien(j) {
    var y = new Date().getFullYear();
    for (var k = 0; k < 2; k++) { var d = new Date(Date.UTC(y + k, 0, 1) + (j - 1) * 86400000); if (d.getTime() > Date.now() - 2 * 86400000) return d.toISOString().slice(0, 10); }
    return null;
  }
  function luCode(txt) {
    var legs = bcbp(txt);
    if (!legs || !legs.length) { toast("This barcode is not a boarding pass. Try again, or type the flight number.", false); return; }
    arreterCamera();
    var p = Promise.resolve();
    legs.forEach(function (l) { var d = dateJulien(l.j); if (d) p = p.then(function () { return ajouter({ n: l.n, d: d, s: l.s, o: l.o, bp: true }); }); });
  }
  var flux = null, boucle = null, lecteurZX = null;
  function zxing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    return new Promise(function (ok, ko) { var s = document.createElement("script"); s.src = "zxing-0.21.3.min.js"; s.onload = function () { ok(window.ZXing); }; s.onerror = ko; document.head.appendChild(s); });
  }
  function detecteur() {
    if (!("BarcodeDetector" in window)) return Promise.resolve(null);
    return BarcodeDetector.getSupportedFormats().then(function (f) {
      var voulu = ["aztec", "pdf417", "qr_code", "data_matrix"].filter(function (x) { return f.indexOf(x) >= 0; });
      if (voulu.indexOf("aztec") < 0 || voulu.indexOf("pdf417") < 0) return null;
      var d = new BarcodeDetector({ formats: voulu });
      return function (src) { return d.detect(src).then(function (r) { return r.length ? r[0].rawValue : null; }); };
    }).catch(function () { return null; });
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
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $("#photo").click(); return; }
    $("#camera").hidden = false; $("#f-vol").hidden = true;
    var v = $("#video");
    lecteurImage().then(function (lire) {
      lecteurZX = lire;
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(function (s) {
        flux = s; v.srcObject = s; return v.play();
      }).then(function () {
        var tour = function () { if (!flux) return; lire(v).then(function (t) { if (t) luCode(t); else boucle = setTimeout(tour, 250); }).catch(function () { boucle = setTimeout(tour, 400); }); };
        tour();
      });
    }).catch(function () { arreterCamera(); toast("The camera is not available. Choose a photo or a screenshot of your boarding pass.", false); $("#photo").click(); });
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
        if (t) luCode(t); else toast("No boarding pass barcode found. Crop closer to the barcode, or type the flight number.", false);
      }).catch(function () { toast("Could not read this picture.", false); });
    };
    img.src = url; e.target.value = "";
  });

  // ---- fuseau maison ----
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
    AVIATOR.appel({ action: "boarding.maison", jeton: jeton, tz: e.target.value }).then(function () { toast("Home time zone saved.", true); }).catch(erreur);
  });

  // ---- alertes (Web Push) ----
  var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var installee = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function b64(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); var r = atob(s + "===".slice((s.length + 3) % 4)), o = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; }
  function alertesEtat(n) {
    var ok = "serviceWorker" in navigator && "PushManager" in window, e = $("#alertes-etat"), b = $("#alertes");
    $("#alertes-ios").hidden = !(iOS && !installee);
    if (!ok) { b.disabled = true; e.textContent = iOS && !installee ? "" : "This browser cannot receive alerts."; return; }
    b.disabled = iOS && !installee;
    e.textContent = n ? "Alerts are on for " + n + " device" + (n > 1 ? "s" : "") + "." : "";
    b.textContent = n ? "Turn on alerts on this phone too" : "Turn on alerts";
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
    }).then(function (sub) { return AVIATOR.appel({ action: "boarding.abonner", jeton: jeton, sub: sub.toJSON() }); })
      .then(function (o) { alertesEtat(o.alertes); toast("Alerts are on. A test notification is on its way.", true); })
      .catch(erreur).then(function () { b.disabled = false; });
  });

  // ---- trajet vers l'aéroport ----
  var depart = null;
  function trajetAfficher(tr) {
    if (!tr) return;
    depart = { la: tr.la, lo: tr.lo, lab: tr.lab };
    $("#adr-choisie").textContent = "📍 " + (tr.lab || tr.la + ", " + tr.lo);
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
            var bt = document.createElement("button"); bt.type = "button"; bt.className = "sugg"; bt.textContent = a.display_name;
            bt.addEventListener("click", function () {
              depart = { la: Number(a.lat), lo: Number(a.lon), lab: a.display_name.split(",").slice(0, 3).join(",") };
              $("#adr-choisie").textContent = "📍 " + depart.lab; box.hidden = true; $("#adresse").value = "";
            });
            box.appendChild(bt);
          });
          box.hidden = !l.length;
        }).catch(function () { box.hidden = true; });
    }, 450);
  });
  $("#ici").addEventListener("click", function () {
    if (!navigator.geolocation) { toast("Position is not available on this device.", false); return; }
    navigator.geolocation.getCurrentPosition(function (p) {
      depart = { la: p.coords.latitude, lo: p.coords.longitude, lab: "My position" };
      $("#adr-choisie").textContent = "📍 My position (" + p.coords.latitude.toFixed(3) + ", " + p.coords.longitude.toFixed(3) + ")";
    }, function () { toast("Position refused or unavailable.", false); }, { enableHighAccuracy: false, timeout: 15000 });
  });
  $("#trajet").addEventListener("click", function () {
    if (!depart) { toast("Choose a starting point first (address or your position).", false); return; }
    var mode = document.querySelector('input[name="mode"]:checked').value;
    AVIATOR.appel({ action: "boarding.trajet", jeton: jeton, tr: { la: depart.la, lo: depart.lo, lab: depart.lab, mode: mode, min: Number($("#minutes").value) || 0, av: Number($("#avance").value) || 90 } })
      .then(function (o) {
        var v = (o.vols || []).filter(function (x) { return x.lv; })[0], w = (o.vols || []).filter(function (x) { return x.tw === "far"; })[0];
        toast(v ? "Saved. " + v.n + ": " + v.tm + " min to " + v.o + " – leave home " + jhm(v.lv, v.oz) + "." :
          (w ? "Saved, but your starting point is more than 250 km from " + w.o + ": no leave-home time for this flight." : "Saved."), !!v || !w);
        if (o.vols) afficherVols(o);
      }).catch(erreur);
  });

  // ---- montres liées ----
  function afficherMontres(l) {
    var box = $("#montres");
    box.innerHTML = l.length ? "" : '<p class="aide">No watch linked yet.</p>';
    l.forEach(function (m) {
      var d = document.createElement("div"); d.className = "montre";
      var vu = m.vu ? Math.round((Date.now() - m.vu) / 60000) : null;
      d.innerHTML = '<div class="txt"><b>Garmin watch ··' + esc(m.fin) + "</b><span>" + esc(/^B/.test(m.v) ? "Boarding " + m.v.slice(1) : m.v) +
        (vu != null ? " · seen " + (vu < 90 ? vu + " min ago" : vu < 2880 ? Math.round(vu / 60) + " h ago" : Math.round(vu / 1440) + " days ago") : "") + '</span></div><button class="lien" type="button">Unlink</button>';
      d.querySelector("button").addEventListener("click", function () {
        if (!confirm("Unlink this watch? It will stop showing your flights.")) return;
        AVIATOR.appel({ action: "boarding.delier", jeton: jeton, ref: m.ref }).then(function (o) { afficherMontres(o.montres); toast("Watch unlinked.", true); }).catch(erreur);
      });
      box.appendChild(d);
    });
  }
  $("#f-lier").addEventListener("submit", function (e) {
    e.preventDefault();
    var c = $("#lcode").value.replace(/\D/g, ""), b = $("#f-lier button");
    if (c.length !== 6) { toast("Enter the 6 digits shown on your watch.", false); return; }
    b.disabled = true;
    AVIATOR.appel({ action: "boarding.lier", jeton: jeton, code: c }).then(function (o) {
      afficherMontres(o.montres); afficherVols(o); $("#lcode").value = "";
      toast("Watch linked. Your flights appear on it within 5 minutes.", true);
    }).catch(erreur).then(function () { b.disabled = false; });
  });

  // ---- lexique : ce que la montre affiche, dans ses couleurs ----
  var LEX = [
    ["ON TIME", "vert", "The flight leaves as planned."],
    ["BOARDING", "vert", "Boarding has started – go to the gate."],
    ["YOUR AIRCRAFT IS HERE", "vert", "The aircraft that will fly you is already at the airport."],
    ["LANDED 14:05", "vert", "Landed (local time)."],
    ["CONNECTION 1H20", "vert", "Time to your next flight."],
    ["DELAYED +25", "ambre", "Announced delay, in minutes."],
    ["LIKELY DELAY +20", "ambre", "Not announced yet, but the incoming aircraft lands too late to leave on time."],
    ["CHECK IN ONLINE", "ambre", "The day before: check in on your airline’s app or website."],
    ["LEAVE HOME SAT 07:10", "ambre", "When to leave home. Within 3 hours it counts down: LEAVE HOME IN 2H10."],
    ["GATE CLOSING", "ambre", "Last call – the gate closes soon."],
    ["AIRCRAFT LATE", "ambre", "The incoming aircraft is running late."],
    ["UPDATED 14:05", "ambre", "No fresh data since that time (phone not connected)."],
    ["LEAVE HOME IN 25 MIN", "rouge", "Less than 30 minutes before you should leave."],
    ["LEAVE NOW", "rouge", "Time to go."],
    ["NEW GATE · WAS B32", "rouge", "The gate has changed."],
    ["TIGHT 0H35", "rouge", "Short connection – hurry."],
    ["CANCELLED", "rouge", "Flight cancelled: contact your airline."],
    ["DIVERTED", "rouge", "The flight lands at another airport."],
    ["IN FLIGHT", "bleu", "In the air: time to landing on the ring."],
    ["TAXIING", "bleu", "Left the gate, not yet airborne."],
    ["YOUR AIRCRAFT FROM MAD", "bleu", "Where the aircraft that will fly you is coming from."],
    ["GATE SOON", "blanc", "The gate is not announced yet – usually 30 to 60 min before boarding."],
    ["BELT SOON", "blanc", "Baggage belt not announced yet."],
    ["BAG DROP · DOORS", "gris", "The ring in the last 90 minutes: bag drop closes, boarding, doors close, departure."],
    ["DEP · ARR · T", "gris", "Departure, arrival, terminal."],
    ["HOME", "gris", "Time at home (your home time zone), shown when you travel."]
  ];
  $("#lexique").innerHTML = LEX.map(function (x) { return '<div><dt class="w-' + x[1] + '">' + esc(x[0]) + "</dt><dd>" + esc(x[2]) + "</dd></div>"; }).join("");

  // ---- bandeau « Ajouter à l'écran d'accueil » ----
  var invite = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); invite = e; installer(); });
  function installer() {
    var b = $("#installer"), non = Number(lsLire("boarding-inst-non")) || 0;
    if (installee || !jeton || Date.now() - non < 30 * 86400000 || (!invite && !iOS)) { b.hidden = true; return; }
    $("#inst-aide").textContent = iOS ? "Opens like an app – and needed on iPhone for alerts." : "Opens like an app, full screen.";
    b.hidden = false;
  }
  $("#inst-ok").addEventListener("click", function () {
    if (invite) { invite.prompt(); invite.userChoice.then(function () { invite = null; $("#installer").hidden = true; }); return; }
    toast("Tap Share ⬆ at the bottom of Safari, then “Add to Home Screen”.", true);
  });
  $("#inst-non").addEventListener("click", function () { lsEcrire("boarding-inst-non", String(Date.now())); $("#installer").hidden = true; });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(function () {});

  // rafraîchissement : à chaque retour sur la page, et toutes les 2 min tant qu'elle est ouverte
  document.addEventListener("visibilitychange", function () { if (!document.hidden && jeton) charger(); });
  setInterval(function () { if (!document.hidden && jeton) AVIATOR.appel({ action: "boarding.charger", jeton: jeton }).then(afficherVols).catch(function () {}); }, 120000);

  // ---- démarrage : QR code de la montre, sinon téléphone mémorisé, sinon connexion ----
  var qr = /[?&]c=(\d{6})(?:&|$)/.exec(location.search);
  if (qr) {
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    // déjà connecté avec un compte : on propose de lier cette montre plutôt que d'ouvrir une session « montre »
    var mm = lsLire(MEMO);
    (mm ? AVIATOR.appel({ action: "boarding.reprendre", memo: mm }) : Promise.reject({}))
      .then(function (o) {
        if (!o.email) throw {};
        ouvert(o); onglet("montre");
        $("#lcode").value = qr[1].slice(0, 3) + " " + qr[1].slice(3);
        toast("Tap “Link this watch” to show your flights on it.", true);
      })
      .catch(function () { ouvrirMontre(qr[1]); });
  } else if (lsLire(MEMO)) {
    AVIATOR.appel({ action: "boarding.reprendre", memo: lsLire(MEMO) }).then(ouvert).catch(function (x) {
      if (x.code === "memo") memoEcrire(null);
      voir("entrer"); if (x.code !== "memo") msgEntrer(x.message, false);
    });
  } else voir("entrer");
})();
