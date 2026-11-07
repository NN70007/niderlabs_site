/* Boarding — page mobile : connexion par e-mail (code à 6 chiffres) ou code de la montre → vols, trajet, infos, compte.
   La carte d'embarquement scannée reste sur ce téléphone (localStorage) : jamais envoyée au serveur. */
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
  function cleVol(n, d) { return String(n || "").toUpperCase().replace(/\s/g, "").replace(/^([A-Z0-9]{2})0+(\d)/, "$1$2") + "|" + d; }

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
  // bouton occupé : il réagit tout de suite, ne peut pas être appuyé deux fois ; renvoie la fonction qui le rétablit
  function occupe(b, txt) {
    if (!b || b.classList.contains("occupe")) return function () {};
    var avant = b.innerHTML; b.classList.add("occupe"); b.disabled = true; b.setAttribute("aria-busy", "true");
    if (txt) b.textContent = txt;
    return function () { b.classList.remove("occupe"); b.disabled = false; b.removeAttribute("aria-busy"); b.innerHTML = avant; };
  }
  // confirmation dans la page (pas de fenêtre système : elle décroche la barre du bas sur iPhone)
  function demander(texte, oui) {
    return new Promise(function (res) {
      var d = $("#dlg"); $("#dlg-txt").textContent = texte; $("#dlg-oui").textContent = oui || "OK"; d.hidden = false;
      var fin = function (v) { d.hidden = true; $("#dlg-oui").onclick = $("#dlg-non").onclick = null; recaler(); res(v); };
      $("#dlg-oui").onclick = function () { fin(true); }; $("#dlg-non").onclick = function () { fin(false); };
    });
  }
  // iPhone (écran d'accueil) : après le clavier, la barre du bas peut rester décalée → on la recale
  function recaler() {
    setTimeout(function () {
      window.scrollTo(window.scrollX, window.scrollY);
      var n = $("#nav"); if (!n || n.hidden) return;
      n.style.display = "none"; void n.offsetHeight; n.style.display = "";
    }, 80);
  }
  document.addEventListener("focusout", function (e) { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) recaler(); });
  if (window.visualViewport) {
    var vvH = window.visualViewport.height;
    window.visualViewport.addEventListener("resize", function () { var h = window.visualViewport.height; if (h > vvH + 100) recaler(); vvH = h; });
  }

  function chiffres(input) {
    input.addEventListener("input", function () { var d = input.value.replace(/\D/g, "").slice(0, 6); input.value = d.length > 3 ? d.slice(0, 3) + " " + d.slice(3) : d; });
  }
  ["#otp", "#wcode", "#lcode"].forEach(function (s) { chiffres($(s)); });
  $("#date").value = aujourdhui();

  // ---- mémorisation du téléphone ----
  var MEMO = "boarding-memo";
  function memoEcrire(v, exp) { lsEcrire(MEMO, v || null); lsEcrire(MEMO + "-exp", v ? String(exp) : null); }

  // ---- connexion par e-mail ----
  var email = "";
  function envoyerCode(btn) {
    var fin = occupe(btn || $("#f-email button"), "Sending…"); msgEntrer("");
    return AVIATOR.appel({ action: "boarding.code", email: email }).then(function () {
      $("#f-email").hidden = true; $("#f-otp").hidden = false; $("#otp-email").textContent = email.toUpperCase();
      $("#otp").value = ""; $("#otp").focus();
      msgEntrer("Code sent. Check your inbox (and the spam folder).", true);
    }).catch(function (x) { msgEntrer(x.message, false); }).then(fin);
  }
  $("#f-email").addEventListener("submit", function (e) {
    e.preventDefault();
    email = $("#email").value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msgEntrer("Please enter a valid e-mail address.", false); return; }
    lsEcrire("boarding-email", email);
    envoyerCode();
  });
  $("#otp-retour").addEventListener("click", function () { $("#f-otp").hidden = true; $("#f-email").hidden = false; msgEntrer(""); });
  $("#otp-renvoi").addEventListener("click", function (e) { envoyerCode(e.currentTarget); });
  $("#otp").addEventListener("input", function () { if ($("#otp").value.replace(/\D/g, "").length === 6) $("#f-otp").requestSubmit(); });
  $("#f-otp").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("#otp").value.replace(/\D/g, "");
    if (code.length !== 6) { msgEntrer("Type the 6 digits from the e-mail.", false); return; }
    var fin = occupe($("#f-otp button[type=submit]"), "Signing in…");
    AVIATOR.appel({ action: "boarding.entrer", email: email, code: code, garder: $("#garder").checked }).then(function (o) {
      if (o.memo) memoEcrire(o.memo, o.memoExp);
      msgEntrer(""); $("#otp").blur(); ouvert(o);
      if (o.nouveau) toast("Welcome! Add your first flight: scan your boarding pass or type the flight number.", true);
    }).catch(function (x) { msgEntrer(x.message, false); }).then(fin);
  });
  if (lsLire("boarding-email")) $("#email").value = lsLire("boarding-email");

  // ---- ouverture avec le code de la montre ----
  function ouvrirMontre(code, bouton) {
    var fin = occupe(bouton, "Checking…");
    return AVIATOR.appel({ action: "aviator.ouvrir", code: code, garder: true }).then(function (o) {
      if (o.memo) memoEcrire(o.memo, o.memoExp);
      o.montre = true; ouvert(o);
    }).catch(function (x) { voir("entrer"); $("#d-montre").open = true; msgEntrer(x.message, false); }).then(fin);
  }
  $("#f-montre").addEventListener("submit", function (e) {
    e.preventDefault();
    var c = $("#wcode").value.replace(/\D/g, "");
    if (c.length !== 6) { msgEntrer("Enter the 6 digits shown on your watch.", false); return; }
    $("#wcode").blur();
    ouvrirMontre(c, $("#f-montre button"));
  });

  // ---- vues et onglets ----
  function voir(v) { ["entrer", "app", "partage"].forEach(function (x) { $("#v-" + x).hidden = v !== x; }); $("#nav").hidden = v !== "app"; }
  var ONGLETS = ["vols", "trajet", "info", "moi"];
  function onglet(o) {
    document.querySelectorAll(".onglet").forEach(function (x) { x.hidden = x.id !== "o-" + o; });
    document.querySelectorAll("#nav button").forEach(function (b) { if (b.getAttribute("data-o") === o) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    window.scrollTo(0, 0);
    try { history.replaceState(null, "", "#" + o); } catch (e) {}
  }
  document.querySelectorAll("#nav button[data-o]").forEach(function (b) { b.addEventListener("click", function () { onglet(b.getAttribute("data-o")); }); });

  function ouvert(o) {
    jeton = o.jeton; compte = !o.montre && !!o.email;
    voir("app");
    var h = (location.hash || "").slice(1);
    onglet(ONGLETS.indexOf(h) >= 0 ? h : "vols");
    $("#moi-titre").textContent = compte ? "Signed in" : "Opened with your watch code";
    $("#moi-email").textContent = compte ? o.email : "";
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
    var p = tous && !compte ? AVIATOR.appel({ action: "aviator.oublier", tous: true, jeton: j }) : AVIATOR.appel({ action: "boarding.sortir", memo: m, jeton: j });
    p.catch(function () {}).then(function () { location.href = location.pathname; });
  }
  $("#sortir").addEventListener("click", function (e) { occupe(e.currentTarget, "Signing out…"); sortir(false); });
  $("#sortir-tous").addEventListener("click", function (e) { occupe(e.currentTarget); sortir(true); });
  $("#effacer").addEventListener("click", function (e) {
    var b = e.currentTarget;
    demander("Delete your Boarding account? Your e-mail, flights and settings will be erased.", "Delete").then(function (oui) {
      if (!oui) return;
      var fin = occupe(b, "Deleting…");
      AVIATOR.appel({ action: "boarding.effacer", jeton: jeton, confirme: true }).then(function () {
        memoEcrire(null); lsEcrire("boarding-email", null); lsEcrire(BP, null); jeton = null;
        toast("Your account has been deleted.", true); setTimeout(function () { location.href = location.pathname; }, 1500);
      }).catch(function (x) { fin(); erreur(x); });
    });
  });

  function charger() {
    if (!dernier) $("#liste").innerHTML = '<p class="aide">Loading your flights…</p>';
    return AVIATOR.appel({ action: "boarding.charger", jeton: jeton }).then(function (o) {
      afficherVols(o); maison(o.h); trajetAfficher(o.tr); alertesEtat(o.alertes);
      if (o.compte) afficherMontres(o.compte.montres);
      if (o.montre) $("#montre-seule-txt").innerHTML = o.lie ?
        "This watch is linked to the account <b>" + esc(o.lie) + "</b>. Sign in with this e-mail to manage alerts, watches and the account." :
        "Sign in with your e-mail and link this watch to keep your flights on your phone too – even without the watch.";
    }).catch(erreur);
  }

  // ---- carte d'embarquement gardée sur ce téléphone uniquement ----
  var BP = "boarding-bp";
  function bpTous() { try { return JSON.parse(lsLire(BP) || "{}") || {}; } catch (e) { return {}; } }
  function bpEcrire(o) { lsEcrire(BP, Object.keys(o).length ? JSON.stringify(o) : null); }
  function bpGarder(n, d, txt, f, img) {
    var o = bpTous(), x = { t: txt, f: f || "", exp: Date.parse(d + "T00:00:00Z") / 1000 + 2 * 86400 };
    if (img && f === "PDF_417") x.img = img;
    o[cleVol(n, d)] = x; bpEcrire(o);
  }
  function bpDe(v) { var x = bpTous()[cleVol(v.n, v.d)]; return x && x.t ? x : null; }
  function bpPurger(vols) {
    var o = bpTous(), t = now(), ch = false;
    (vols || []).forEach(function (v) { var x = o[cleVol(v.n, v.d)], arr = v.ea || v.sa; if (x && arr && x.exp !== arr + 3 * 3600) { x.exp = arr + 3 * 3600; ch = true; } });
    Object.keys(o).forEach(function (k) { if (!o[k] || o[k].exp < t) { delete o[k]; ch = true; } });
    if (ch) bpEcrire(o);
  }
  function bpMontrer(v) {
    var x = bpDe(v);
    if (!x) {
      // scannée dans un autre navigateur ou sur un autre appareil : la copie n'est pas sur celui-ci
      demander("Your boarding pass is not stored on this phone (it was scanned in another browser or device – Safari and the home-screen app keep separate copies). Scan it again here to show it.", "Scan now").then(function (oui) {
        if (oui) { onglet("vols"); $("#photo").click(); }
      });
      return;
    }
    $("#bp-code").innerHTML = '<p class="bp-note">Loading…</p>';
    zxing().catch(function () { return null; }).then(function (Z) { $("#bp-code").innerHTML = codeHtml(x, Z); $("#bp-format").textContent = formatTxt(x); });
    $("#bp-vol").textContent = v.n + " · " + v.o + " → " + v.a;
    $("#bp-info").textContent = jourTxt(v.ed || v.sd, v.oz) + " · " + hm(v.ed || v.sd, v.oz) + (v.s ? " · SEAT " + v.s : "");
    $("#bp").hidden = false;
    $("#bp-oublier").onclick = function () {
      demander("Delete this boarding pass from this phone?", "Delete").then(function (oui) {
        if (!oui) return; var o = bpTous(); delete o[cleVol(v.n, v.d)]; bpEcrire(o); $("#bp").hidden = true; if (dernier) afficherVols(dernier);
      });
    };
  }
  $("#bp-fermer").addEventListener("click", function () { $("#bp").hidden = true; recaler(); });
  // même type de code que la carte de la compagnie (Aztec, QR, Data Matrix) ; PDF417 : l'image d'origine
  function matriceSvg(m, q) {
    var w = m.getWidth(), h = m.getHeight(), d = "";
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (m.get(x, y)) d += "M" + (x + q) + " " + (y + q) + "h1v1h-1z";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (w + 2 * q) + " " + (h + 2 * q) + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  function codeHtml(x, Z) {
    try {
      if (Z && x.f === "AZTEC") return matriceSvg(new Z.AztecCodeWriter().encode(x.t, Z.BarcodeFormat.AZTEC, 0, 0, new Map()), 2);
      if (Z && x.f === "DATA_MATRIX") return matriceSvg(new Z.DataMatrixWriter().encode(x.t, Z.BarcodeFormat.DATA_MATRIX, 0, 0, new Map()), 2);
      if (x.f === "PDF_417" && x.img) return '<img src="' + x.img + '" alt="Boarding pass barcode" style="width:100%;image-rendering:pixelated">';
    } catch (e) { /* QR ci-dessous */ }
    var q = qrcode(0, "M"); q.addData(x.t, "Byte"); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  }
  function formatTxt(x) {
    var n = { AZTEC: "Aztec", DATA_MATRIX: "Data Matrix", QR_CODE: "QR", PDF_417: "PDF417" }[x.f];
    if (x.f === "PDF_417" && !x.img) return "Shown as a QR code (your airline uses PDF417). If the reader refuses it, use your airline’s pass.";
    return n ? "Same code type as your airline’s pass (" + n + "). Turn the screen brightness up." : "Shown as a QR code. If the reader refuses it, scan your boarding pass again to get the airline’s code type.";
  }
  // barre du bas : la carte d'embarquement du prochain vol, d'un geste
  function bpProchain() {
    var t = now(), l = (dernier && dernier.vols) || [];
    var v = l.filter(function (x) { return !x.inconnu && bpDe(x) && (x.ea || x.sa || (x.ed || x.sd) + 3 * 3600) > t; })[0];
    if (v) { bpMontrer(v); return; }
    var w = l.filter(function (x) { return x.bp; })[0];
    if (w) { bpMontrer(w); return; }
    toast("No boarding pass on this phone yet. Scan it in Flights.", false);
  }
  document.querySelector('#nav button[data-pass]').addEventListener("click", bpProchain);

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
    var h = "", t = now(), parti = v.tk || /Departed|EnRoute|Approaching|Arrived|Diverted/.test(v.st || "");
    if (/^Canceled/.test(v.st || "")) return '<div class="bandeau rouge"><span>FLIGHT CANCELLED<small>Contact your airline to rebook.</small></span></div>';
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
  // pas encore de porte : à quelle heure elle s'affichera (3 h avant le départ), sinon « SOON »
  function porteAttente(v, dep, t) {
    if (dep <= t || v.tk) return "";
    var h3 = dep - 3 * 3600;
    if (h3 > t) return '<div><span>GATE</span><b class="attente">from ' + hm(h3, v.oz) + "</b><small class=\"gris\">" + (jourTxt(h3, v.oz) !== jourTxt(t, v.oz) ? jourTxt(h3, v.oz) + " · " : "") + "shown 3 h before departure</small></div>";
    return cas("GATE", "SOON", "", "not announced yet");
  }
  function avionHtml(v) {
    var a = v.avion;
    if (!a) return v.md ? '<div class="avion-carte"><div class="corps"><span class="titre">AIRCRAFT</span><span class="modele">' + esc(v.md) + "</span></div></div>" : "";
    var dl = [];
    if (a.rg) dl.push(["REGISTRATION", a.rg]);
    if (a.age != null) dl.push(["AGE", a.age + (a.age === 1 ? " year" : " years")]);
    if (a.se) dl.push(["SEATS", a.se]);
    if (a.dv) dl.push(["DELIVERED", a.dv.slice(0, 7)]);
    else if (a.ff) dl.push(["FIRST FLIGHT", a.ff.slice(0, 7)]);
    return '<div class="avion-carte">' +
      (a.ph ? '<img loading="lazy" src="' + esc(a.ph.u) + '" alt="' + esc((a.md || v.md || "Aircraft") + " " + (a.rg || "")) + '" referrerpolicy="no-referrer">' +
        '<p class="credit">Photo: ' + (a.ph.w ? '<a href="' + esc(a.ph.w) + '" target="_blank" rel="noopener">' + esc(a.ph.by || "Wikimedia Commons") + "</a>" : esc(a.ph.by || "")) + " · " + esc(a.ph.l) + "</p>" : "") +
      '<div class="corps"><span class="titre">AIRCRAFT</span><span class="modele">' + esc(a.md || v.md || "") + "</span><dl>" +
      dl.map(function (x) { return "<div><dt>" + x[0] + "</dt><dd>" + esc(x[1]) + "</dd></div>"; }).join("") + "</dl></div></div>";
  }
  function meteoHtml(v, titre) {
    var w = v.wx, f = v.fc;
    if (f && f.t != null) return '<div class="meteo"><span class="temp">' + f.t + '°</span><span class="txt">' + esc(titre || "At " + v.a + " on arrival") + " · " + esc(f.w) +
      "<span>" + (f.p != null ? f.p + "% rain · " : "") + "wind " + f.v + " km/h · forecast</span></span></div>";
    if (w && w.t != null) return '<div class="meteo"><span class="temp">' + w.t + '°</span><span class="txt">' + esc(titre || "At " + v.a + " now") + "<span>" + esc(String(w.w || "").toLowerCase()) + "</span></span></div>";
    return "";
  }
  var observateur = ("IntersectionObserver" in window) ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting && e.target._v) { observateur.unobserve(e.target); carteVol(e.target, e.target._v); e.target._v = null; } });
  }, { rootMargin: "300px" }) : null;

  function afficherUber(vols) {
    var box = $("#uber-box"), t = now();
    var v = (vols || []).filter(function (x) { return !x.inconnu && x.ola != null && (x.ed || x.sd) > t && !/^Canceled/.test(x.st || ""); })[0];
    if (!v) { box.hidden = true; return; }
    var prog = v.lv && v.lv > t + 1800;
    box.hidden = false;
    box.innerHTML = "<h2>Ride to " + esc(v.oc || v.o) + " airport</h2>" +
      '<p class="aide">' + esc(v.n) + " · " + esc(jourTxt(v.ed || v.sd, v.oz)) + " · departs " + hm(v.ed || v.sd, v.oz) + (v.t ? " · Terminal " + esc(v.t) : "") + "</p>" +
      '<div class="uber-ligne"><a class="bouton" target="_blank" rel="noopener" href="' + uber(v) + '">Uber</a>' +
      (prog ? '<span class="prog">Schedule the pickup for <button type="button" class="copie" data-copier="' + hm(v.lv, v.oz) + '">' + jourTxt(v.lv, v.oz).slice(0, 3) + " " + hm(v.lv, v.oz) + " ⧉</button><br><small>In Uber: Now › Schedule</small></span>" :
        '<span class="prog">' + (v.lv && v.lv <= t + 1800 ? "Time to go – " : "") + "Opens Uber with the airport as destination.</span>") + "</div>" +
      '<button class="lien" type="button" data-copier="' + esc(adresseAeroport(v)) + '">Copy airport address</button>';
    box.querySelectorAll("[data-copier]").forEach(function (cp) { cp.addEventListener("click", function () { copier(cp.getAttribute("data-copier")); }); });
  }
  function afficherVols(o) {
    var box = $("#liste"), vols = o.vols || [];
    dernier = o;
    afficherUber(vols);
    bpPurger(vols);
    if (!vols.length) { box.innerHTML = '<div class="carte"><h2>No flight yet</h2><p class="aide">Scan your boarding pass or type your flight number above. You can add flights months ahead.</p></div>'; return; }
    box.innerHTML = "";
    vols.forEach(function (v) {
      var d = document.createElement("div"); d.className = "carte vol";
      if (v.inconnu) {
        d.innerHTML = '<div class="tete"><div><div class="num">' + esc(v.n) + '</div><div class="jourv">' + esc(v.d) + '</div></div></div><p class="aide">Waiting for flight data…</p><div class="pied-vol"><button class="lien" type="button" data-suppr>Remove flight</button></div>';
      } else {
        var e = etat(v), dep = v.ed || v.sd, arr = v.ea || v.sa, t = now();
        // porte seulement à moins de 3 h du départ (avant, souvent provisoire) ; avant : le terminal
        var gOk = v.g && (dep - t < 3 * 3600 || v.gp || v.tk || dep < t);
        var bp = bpDe(v);
        d.innerHTML = '<div class="tete"><div><div class="num">' + esc(v.n) + '</div><div class="jourv">' + esc(jourTxt(dep, v.oz)) + (v.al ? " · " + esc(v.al) : "") + '</div></div><span class="pill ' + e[1] + '">' + e[0] + "</span></div>" +
          '<div class="trajetv"><div class="apt"><span class="code3">' + esc(v.o) + '</span><span class="ville">' + esc(v.oc || "") + '</span><span class="h' + (v.dl > 5 ? " ambre" : "") + '">' + hm(dep, v.oz) + '</span></div><span class="fleche">→</span>' +
          '<div class="apt"><span class="code3">' + esc(v.a) + '</span><span class="ville">' + esc(v.ac2 || "") + '</span><span class="h">' + (arr ? hm(arr, v.az) : "") + "</span></div></div>" +
          bandeaux(v) +
          '<div class="actions-vol">' + (bp || v.bp ? '<button type="button" class="bouton bp-btn" data-bp>Boarding pass</button>' : "") +
          '<button type="button" class="bouton second" data-partager' + (bp || v.bp ? "" : ' style="grid-column:1/-1"') + ">Share flight</button></div>" +
          '<div class="mini sauts"><button type="button" data-s="info">Details</button><button type="button" data-s="jour">My day</button><button type="button" data-s="carte">Map</button></div>' +
          '<section class="sec" data-sec="info"><h3 class="sec-titre">Details</h3><div class="cases">' +
          (gOk ? cas(v.gp ? "NEW GATE" : "GATE", v.g, v.gp ? "rouge" : "", v.gp ? "was " + v.gp : "") : porteAttente(v, dep, t)) +
          cas("TERMINAL", v.t) + cas("SEAT", v.s) + cas("CHECK-IN", v.ck) + cas("BELT", v.b) + cas("ARR. TERMINAL", v.ta) + cas("ARR. GATE", v.ag) + "</div>" +

          avionHtml(v) + meteoHtml(v) + "</section>" +
          '<section class="sec" data-sec="jour"><h3 class="sec-titre">My day</h3>' + journee(v) + "</section>" +
          '<section class="sec" data-sec="carte"><h3 class="sec-titre">Map</h3><div class="carte-vol"></div></section>' +
          '<div class="pied-vol"><button class="lien" type="button" data-suppr>Remove flight</button></div>';
        d.querySelectorAll("[data-s]").forEach(function (bt) {
          bt.addEventListener("click", function () { var s = d.querySelector('[data-sec="' + bt.getAttribute("data-s") + '"]'); if (s) s.scrollIntoView({ behavior: "smooth", block: "start" }); });
        });
        d.querySelectorAll("[data-copier]").forEach(function (cp) { cp.addEventListener("click", function () { copier(cp.getAttribute("data-copier")); }); });
        d.querySelectorAll("[data-aller]").forEach(function (x) { x.addEventListener("click", function () { onglet("trajet"); }); });
        var im = d.querySelector(".avion-carte img");
        if (im) im.addEventListener("error", function () { var c = im.nextElementSibling; im.remove(); if (c && c.classList.contains("credit")) c.remove(); });
        var bb = d.querySelector("[data-bp]"); if (bb) bb.addEventListener("click", function () { bpMontrer(v); });
        d.querySelector("[data-partager]").addEventListener("click", function (ev) { partager(v, ev.currentTarget); });
        var mapEl = d.querySelector(".carte-vol");
        if (observateur) { mapEl._v = v; observateur.observe(mapEl); } else setTimeout(function () { carteVol(mapEl, v); }, 0);
      }
      var b = d.querySelector("[data-suppr]");
      b.addEventListener("click", function () {
        demander("Remove " + v.n + " from your flights?", "Remove").then(function (oui) {
          if (!oui) return;
          var fin = occupe(b, "Removing…");
          AVIATOR.appel({ action: "boarding.supprimer", jeton: jeton, n: String(v.n).replace(/\s/g, ""), d: v.d }).then(function (r) { fin(); afficherVols(r); }).catch(function (x) { fin(); erreur(x); });
        });
      });
      box.appendChild(d);
    });
  }

  // ---- partager le vol : lien public en lecture seule ----
  function partager(v, btn) {
    var fin = occupe(btn, "Creating link…");
    AVIATOR.appel({ action: "boarding.partager", jeton: jeton, n: String(v.n).replace(/\s/g, ""), d: v.d }).then(function (r) {
      fin();
      var url = location.origin + location.pathname + "?s=" + r.s;
      var txt = v.n + " " + v.o + " → " + v.a + ", lands " + (v.ea || v.sa ? hm(v.ea || v.sa, v.az) : "") + " local time. Live status:";
      if (navigator.share) navigator.share({ title: "My flight " + v.n, text: txt, url: url }).catch(function () {});
      else copier(url);
    }).catch(function (x) { fin(); erreur(x); });
  }

  // ---- « My day » : aller à l'aéroport, puis à la porte ----
  function journee(v) {
    var dep = v.ed || v.sd, t = now(), aller = [];
    var gOkJ = v.g && (dep - t < 3 * 3600 || v.gp || v.tk);
    if (v.lv) {
      var veille = jourTxt(v.lv, v.oz) !== jourTxt(dep, v.oz);
      aller.push(["Leave home" + (veille ? " · " + jourTxt(v.lv, v.oz) : ""), v.lv, v.oz, v.tm ? v.tm + " min to the airport" : ""]);
      aller.push(["At the airport", v.lv + v.tm * 60, v.oz, v.av ? v.av + " min before departure" : ""]);
    }
    aller.push(["Bag drop closes", dep - 2700, v.oz, v.ck ? "Check-in desk " + v.ck : ""]);
    var porte = [["Boarding", dep - 2400, v.oz, gOkJ ? "Gate " + v.g : (v.t ? "Terminal " + v.t + " · gate shown 3 h before" : "Gate not announced yet")], ["Doors close", dep - 900, v.oz, ""], ["Departure", dep, v.oz, v.tk ? "Took off " + hm(v.tk, v.oz) : ""]];
    var prochain = null;
    aller.concat(porte).forEach(function (p) { if (!prochain && p[1] > t) prochain = p; });
    var ligne = function (p) {
      return '<li class="' + (p[1] <= t ? "fait" : p === prochain ? "suivant" : "") + '"><span class="h">' + hm(p[1], p[2]) + '</span><span class="pt"></span><span class="t">' + esc(p[0]) + (p[3] ? "<small>" + esc(p[3]) + "</small>" : "") + "</span></li>";
    };
    var raison = { far: "Your starting point is far from " + v.o + ": no leave-home time for this flight.", noairport: "Airport position not known yet.", route: "No car route found – set your own travel time in To the airport." }[v.tw];
    var h = '<div class="jour"><p class="jour-date">' + esc(jourTxt(dep, v.oz)) + "<span>DEPARTS " + hm(dep, v.oz) + "</span></p>" +
      "<h3>Getting to " + esc(v.o) + "</h3><ol>" + aller.map(ligne).join("") + "</ol>";
    if (!v.lv) h += '<p class="aide">' + (raison || "Set where you leave from in <b>To the airport</b> to know when to leave home.") + "</p>";
    if (v.ola != null && dep > t) h += '<button class="lien" type="button" data-aller>Uber and transport → To the airport</button>';
    h += "<h3>At the gate</h3><ol>" + porte.map(ligne).join("") + '</ol><p class="aide petit">Bag drop, boarding and doors are estimated. Follow the airport screens.</p></div>';
    return h;
  }
  function uber(v) {
    return "https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff%5Blatitude%5D=" + v.ola + "&dropoff%5Blongitude%5D=" + v.olo +
      "&dropoff%5Bnickname%5D=" + encodeURIComponent((v.oc || v.o) + " Airport" + (v.t ? " T" + v.t : ""));
  }
  function adresseAeroport(v) { return (v.oc || v.o) + " Airport (" + v.o + ")" + (v.t ? ", Terminal " + v.t : ""); }
  function copier(txt) {
    var fin = function () { toast("Copied: " + txt, true); };
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(fin).catch(function () { toast(txt, true); });
    else toast(txt, true);
  }

  // ---- carte : route et position estimée ----
  function carteVol(el, v) {
    if (!el) return;
    if (v.ola == null || v.ala == null || !window.L) { el.outerHTML = '<p class="aide">Map not available for this flight.</p>'; return; }
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
  $("#manuel").addEventListener("click", function () { var f = $("#f-vol"); f.hidden = !f.hidden; $("#camera").hidden = true; if (!f.hidden) $("#num").focus(); });
  function ajouter(vol) {
    var fin = occupe($("#ajouter"), "Checking the flight…");
    return AVIATOR.appel({ action: "boarding.ajouter", jeton: jeton, vol: vol }).then(function (o) {
      var v = o.vol;
      toast("Added: " + v.n + " " + v.o + " → " + v.a + ", " + jourTxt(v.ed || v.sd, v.oz) + " " + hm(v.ed || v.sd, v.oz) + ".", true);
      $("#num").value = ""; $("#siege").value = ""; $("#f-vol").hidden = true; $("#num").blur();
      afficherVols(o);
    }).catch(erreur).then(fin);
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
    var legs = bcbp(txt), f0 = formatLu;
    if (!legs || !legs.length) { toast("This barcode is not a boarding pass. Try again, or type the flight number.", false); return false; }
    arreterCamera();
    var p = Promise.resolve();
    legs.forEach(function (l) {
      var d = dateJulien(l.j);
      if (!d) return;
      bpGarder(l.n, d, txt, formatLu, f0 === "PDF_417" && imageLue ? imageLue() : null); // reste sur ce téléphone
      p = p.then(function () { return ajouter({ n: l.n, d: d, s: l.s, o: l.o, bp: true }); });
    });
    return true;
  }

  // ---- lecture des codes : caméra, photo ou capture d'écran entière ----
  var flux = null, boucle = null, lecteurP = null, formatLu = "", imageLue = null;
  function zxing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    return new Promise(function (ok, ko) { var s = document.createElement("script"); s.src = "zxing-0.21.3.min.js"; s.onload = function () { ok(window.ZXing); }; s.onerror = ko; document.head.appendChild(s); });
  }
  function detecteurNatif() {
    if (!("BarcodeDetector" in window)) return Promise.resolve(null);
    return BarcodeDetector.getSupportedFormats().then(function (f) {
      var voulu = ["aztec", "pdf417", "qr_code", "data_matrix"].filter(function (x) { return f.indexOf(x) >= 0; });
      if (voulu.indexOf("aztec") < 0 || voulu.indexOf("pdf417") < 0) return null;
      var d = new BarcodeDetector({ formats: voulu });
      var FMT = { aztec: "AZTEC", pdf417: "PDF_417", qr_code: "QR_CODE", data_matrix: "DATA_MATRIX" };
      return function (src) { return d.detect(src).then(function (r) { if (!r.length) return null; formatLu = FMT[r[0].format] || ""; return r[0].rawValue; }).catch(function () { return null; }); };
    }).catch(function () { return null; });
  }
  // lit(canvas) → Promise<texte|null>
  function lecteur() {
    if (lecteurP) return lecteurP;
    lecteurP = Promise.all([detecteurNatif(), zxing().catch(function () { return null; })]).then(function (r) {
      var natif = r[0], Z = r[1], zx = null;
      if (Z) {
        var hints = new Map();
        hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.AZTEC, Z.BarcodeFormat.PDF_417, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX]);
        hints.set(Z.DecodeHintType.TRY_HARDER, true);
        var mr = new Z.MultiFormatReader(); mr.setHints(hints);
        zx = function (c, inverse) {
          var x = c.getContext("2d", { willReadFrequently: true }), px = x.getImageData(0, 0, c.width, c.height).data, lum = new Uint8ClampedArray(c.width * c.height);
          for (var i = 0, j = 0; i < px.length; i += 4, j++) { var l = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000; lum[j] = inverse ? 255 - l : l; }
          var src = new Z.RGBLuminanceSource(lum, c.width, c.height);
          var ok = function (res) { formatLu = Z.BarcodeFormat[res.getBarcodeFormat()] || ""; return res.getText(); };
          try { return ok(mr.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(src)))); } catch (e) { /* suite */ }
          try { return ok(mr.decode(new Z.BinaryBitmap(new Z.GlobalHistogramBinarizer(src)))); } catch (e) { return null; }
        };
      }
      return function (c, inverse) {
        return (natif && !inverse ? natif(c) : Promise.resolve(null)).then(function (t) { return t || (zx ? zx(c, inverse) : null); });
      };
    });
    return lecteurP;
  }
  function toile(src, sx, sy, sw, sh, larg) {
    var c = document.createElement("canvas"), k = larg / sw;
    c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    var x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingEnabled = k < 1;
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  // zone claire la plus grande (le cadre blanc autour du code, sur fond de couleur) : on la cherche sur une petite image
  function zoneBlanche(img, W, H) {
    var k = 240 / Math.max(W, H), w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
    var c = toile(img, 0, 0, W, H, w), px = c.getContext("2d").getImageData(0, 0, w, h).data, blanc = new Uint8Array(w * h), vu = new Uint8Array(w * h);
    for (var i = 0; i < w * h; i++) { var r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]; blanc[i] = (r > 200 && g > 200 && b > 200) ? 1 : 0; }
    var best = null, pile = [];
    for (var s = 0; s < w * h; s++) {
      if (!blanc[s] || vu[s]) continue;
      var n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0; pile.push(s); vu[s] = 1;
      while (pile.length) {
        var p = pile.pop(), x = p % w, y = (p - x) / w; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        [p - 1, p + 1, p - w, p + w].forEach(function (q) { if (q >= 0 && q < w * h && !vu[q] && blanc[q] && Math.abs((q % w) - x) <= 1) { vu[q] = 1; pile.push(q); } });
      }
      var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      // le cadre du code : assez grand, pas toute l'image
      if (bw * bh > w * h * 0.85 || bw < w * 0.12 || bh < h * 0.05) continue;
      if (!best || bw * bh > best.a) best = { a: bw * bh, x: x0, y: y0, w: bw, h: bh };
    }
    if (!best) return null;
    var m = 0.04;
    return { x: Math.max(0, (best.x / k) - W * m), y: Math.max(0, (best.y / k) - H * m), w: Math.min(W, best.w / k + 2 * W * m), h: Math.min(H, best.h / k + 2 * H * m) };
  }
  // plusieurs essais : image entière en pleine résolution, cadre blanc agrandi, centre, moitiés, image inversée
  function lireImage(img) {
    var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    return lecteur().then(function (lit) {
      var essais = [];
      essais.push(function () { return lit(toile(img, 0, 0, W, H, Math.min(W, 2400))); });
      var z = zoneBlanche(img, W, H);
      imageLue = function () { try { var zz = z || { x: 0, y: 0, w: W, h: H }; return toile(img, zz.x, zz.y, zz.w, zz.h, Math.min(900, zz.w)).toDataURL("image/png"); } catch (e) { return null; } };
      if (z) essais.push(function () { return lit(toile(img, z.x, z.y, z.w, z.h, 1100)); });
      essais.push(function () { return lit(toile(img, W * 0.1, H * 0.25, W * 0.8, H * 0.5, 1200)); });
      essais.push(function () { return lit(toile(img, 0, H * 0.4, W, H * 0.6, 1200)); });
      essais.push(function () { return lit(toile(img, 0, 0, W, H * 0.6, 1200)); });
      essais.push(function () { return lit(toile(img, 0, 0, W, H, Math.min(W, 1600)), true); });
      var i = 0;
      var suite = function () { if (i >= essais.length) return Promise.resolve(null); return essais[i++]().then(function (t) { return t || suite(); }); };
      return suite();
    });
  }
  // dernier recours : la personne touche le code sur l'image
  function pointer(img) {
    var W = img.naturalWidth, H = img.naturalHeight, c = $("#pointer-c"), k = Math.min(1, 1200 / W);
    c.width = Math.round(W * k); c.height = Math.round(H * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    $("#pointer").hidden = false;
    c.onclick = function (e) {
      var r = c.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height, cote = Math.min(W, H) * 0.55;
      var x = Math.max(0, Math.min(W - cote, fx * W - cote / 2)), y = Math.max(0, Math.min(H - cote, fy * H - cote / 2));
      toast("Reading…", true);
      lecteur().then(function (lit) {
        return lit(toile(img, x, y, cote, cote, 1000)).then(function (t) { return t || lit(toile(img, x - cote * 0.2, y - cote * 0.2, cote * 1.4, cote * 1.4, 1200)); });
      }).then(function (t) {
        if (t) { $("#pointer").hidden = true; c.onclick = null; if (luCode(t)) recaler(); }
        else toast("Still no barcode there. Tap right on the code, or type the flight number.", false);
      });
    };
  }
  $("#pointer-annuler").addEventListener("click", function () { $("#pointer").hidden = true; $("#pointer-c").onclick = null; recaler(); });

  function arreterCamera() {
    if (boucle) { clearTimeout(boucle); boucle = null; }
    if (flux) { flux.getTracks().forEach(function (t) { t.stop(); }); flux = null; }
    $("#camera").hidden = true;
  }
  $("#scanner").addEventListener("click", function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $("#photo").click(); return; }
    $("#camera").hidden = false; $("#f-vol").hidden = true; imageLue = null;
    var v = $("#video");
    lecteur().then(function (lit) {
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(function (s) {
        flux = s; v.srcObject = s; return v.play();
      }).then(function () {
        var tour = function () {
          if (!flux) return;
          var w = v.videoWidth, h = v.videoHeight;
          if (!w) { boucle = setTimeout(tour, 250); return; }
          lit(toile(v, 0, 0, w, h, Math.min(w, 1400))).then(function (t) { if (t && luCode(t)) return; boucle = setTimeout(tour, 250); }).catch(function () { boucle = setTimeout(tour, 400); });
        };
        tour();
      });
    }).catch(function () { arreterCamera(); toast("The camera is not available. Choose a photo or a screenshot of your boarding pass.", false); $("#photo").click(); });
  });
  $("#cam-stop").addEventListener("click", arreterCamera);
  $("#photo-btn").addEventListener("click", function () { $("#photo").click(); });
  $("#photo-btn0").addEventListener("click", function () { $("#photo").click(); });
  $("#photo").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var fin = occupe($("#photo-btn0"), "Reading…");
    var img = new Image(), url = URL.createObjectURL(f);
    img.onload = function () {
      lireImage(img).then(function (t) {
        fin();
        if (t && luCode(t)) { URL.revokeObjectURL(url); return; }
        if (!t) { toast("Tap the barcode in your picture.", true); pointer(img); }
      }).catch(function () { fin(); toast("Could not read this picture.", false); });
    };
    img.onerror = function () { fin(); toast("Could not open this picture.", false); };
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
    var s = e.target; s.disabled = true;
    AVIATOR.appel({ action: "boarding.maison", jeton: jeton, tz: s.value }).then(function () { toast("Home time zone saved.", true); }).catch(erreur).then(function () { s.disabled = false; });
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
    var fin = occupe($("#alertes"), "Turning on…");
    Notification.requestPermission().then(function (p) {
      if (p !== "granted") throw { message: "Notifications are blocked for this site. Allow them in your browser settings." };
      return Promise.all([navigator.serviceWorker.register("sw.js", { scope: "./" }), AVIATOR.appel({ action: "boarding.cle" })]);
    }).then(function (r) {
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(r[1].cle) }); });
      });
    }).then(function (sub) { return AVIATOR.appel({ action: "boarding.abonner", jeton: jeton, sub: sub.toJSON() }); })
      .then(function (o) { fin(); alertesEtat(o.alertes); toast("Alerts are on. A test notification is on its way.", true); })
      .catch(function (x) { fin(); erreur(x); });
  });

  // ---- aller à l'aéroport : chaque choix est enregistré tout de suite (sur le compte) ----
  var depart = null, tSauve = null;
  function departAfficher() {
    var p = $("#adr-choisie");
    p.hidden = !depart;
    if (depart) p.innerHTML = "<small>✓ SAVED STARTING POINT</small>📍 " + esc(depart.lab || (depart.la.toFixed(4) + ", " + depart.lo.toFixed(4)));
  }
  function trajetAfficher(tr) {
    if (!tr) { departAfficher(); return; }
    depart = { la: tr.la, lo: tr.lo, lab: tr.lab };
    var r = document.querySelector('input[name="mode"][value="' + tr.mode + '"]'); if (r) r.checked = true;
    if (tr.min) $("#minutes").value = tr.min;
    $("#avance").value = tr.av || 90;
    majMode(); departAfficher();
  }
  function majMode() { var m = document.querySelector('input[name="mode"]:checked'); $("#ligne-min").hidden = !(m && m.value === "min"); }
  function etatTrajet(txt, err) { var e = $("#tr-etat"); e.textContent = txt; e.className = "etat-sauve" + (err ? " err" : ""); }
  function sauverTrajet(delai) {
    clearTimeout(tSauve);
    if (!depart) { etatTrajet("Choose where you leave from first.", true); return; }
    etatTrajet("Saving…");
    tSauve = setTimeout(function () {
      var mode = document.querySelector('input[name="mode"]:checked').value;
      AVIATOR.appel({ action: "boarding.trajet", jeton: jeton, tr: { la: depart.la, lo: depart.lo, lab: depart.lab, mode: mode, min: Number($("#minutes").value) || 0, av: Number($("#avance").value) || 90 } })
        .then(function (o) {
          var v = (o.vols || []).filter(function (x) { return x.lv; })[0], w = (o.vols || []).filter(function (x) { return x.tw === "far"; })[0];
          etatTrajet(v ? "✓ Saved · " + v.n + ": " + v.tm + " min to " + v.o + ", leave home " + jhm(v.lv, v.oz) :
            (w ? "✓ Saved – but more than 250 km from " + w.o + ": no leave-home time for this flight." : "✓ Saved"), false);
          departAfficher();
          if (o.vols) afficherVols(o);
        }).catch(function (x) { etatTrajet((x && x.message) || "Not saved.", true); });
    }, delai || 0);
  }
  document.querySelectorAll('input[name="mode"]').forEach(function (x) { x.addEventListener("change", function () { majMode(); sauverTrajet(); }); });
  ["#minutes", "#avance"].forEach(function (s) { $(s).addEventListener("input", function () { sauverTrajet(900); }); });
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
              depart = { la: Number(a.lat), lo: Number(a.lon), lab: a.display_name.split(",").slice(0, 3).join(",").trim() };
              box.hidden = true; $("#adresse").value = ""; $("#adresse").blur(); departAfficher(); sauverTrajet();
            });
            box.appendChild(bt);
          });
          box.hidden = !l.length;
        }).catch(function () { box.hidden = true; });
    }, 450);
  });
  $("#ici").addEventListener("click", function (e) {
    if (!navigator.geolocation) { toast("Position is not available on this device.", false); return; }
    var fin = occupe(e.currentTarget, "Locating…");
    navigator.geolocation.getCurrentPosition(function (p) {
      var la = p.coords.latitude, lo = p.coords.longitude;
      // adresse lisible (OpenStreetMap) ; à défaut, les coordonnées
      fetch("https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=" + la + "&lon=" + lo, { headers: { "Accept-Language": "en" } })
        .then(function (r) { return r.json(); }).catch(function () { return null; }).then(function (a) {
          var lab = a && a.display_name ? a.display_name.split(",").slice(0, 3).join(",").trim() : "Position " + la.toFixed(4) + ", " + lo.toFixed(4);
          depart = { la: la, lo: lo, lab: lab }; fin(); departAfficher(); sauverTrajet();
        });
    }, function () { fin(); toast("Position refused or unavailable.", false); }, { enableHighAccuracy: false, timeout: 15000 });
  });

  // ---- montres liées (dans Compte) ----
  function afficherMontres(l) {
    var box = $("#montres");
    box.innerHTML = l.length ? "" : '<p class="aide">No watch linked yet.</p>';
    l.forEach(function (m) {
      var d = document.createElement("div"); d.className = "montre";
      var vu = m.vu ? Math.round((Date.now() - m.vu) / 60000) : null;
      d.innerHTML = '<div class="txt"><b>Garmin watch ··' + esc(m.fin) + "</b><span>" + esc(/^B/.test(m.v) ? "Boarding " + m.v.slice(1) : m.v) +
        (vu != null ? " · seen " + (vu < 90 ? vu + " min ago" : vu < 2880 ? Math.round(vu / 60) + " h ago" : Math.round(vu / 1440) + " days ago") : "") + '</span></div><button class="lien" type="button">Unlink</button>';
      var b = d.querySelector("button");
      b.addEventListener("click", function () {
        demander("Unlink this watch? It will stop showing your flights.", "Unlink").then(function (oui) {
          if (!oui) return;
          var fin = occupe(b, "Unlinking…");
          AVIATOR.appel({ action: "boarding.delier", jeton: jeton, ref: m.ref }).then(function (o) { fin(); afficherMontres(o.montres); toast("Watch unlinked.", true); }).catch(function (x) { fin(); erreur(x); });
        });
      });
      box.appendChild(d);
    });
  }
  $("#f-lier").addEventListener("submit", function (e) {
    e.preventDefault();
    var c = $("#lcode").value.replace(/\D/g, "");
    if (c.length !== 6) { toast("Enter the 6 digits shown on your watch.", false); return; }
    $("#lcode").blur();
    var fin = occupe($("#f-lier button"), "Linking…");
    AVIATOR.appel({ action: "boarding.lier", jeton: jeton, code: c }).then(function (o) {
      fin(); afficherMontres(o.montres); afficherVols(o); $("#lcode").value = ""; recaler();
      toast("Watch linked. Your flights appear on it within 5 minutes.", true);
    }).catch(function (x) { fin(); recaler(); erreur(x); });
  });

  // ---- Info ----
  var INFOS = [
    ["What Boarding does", "<p>Boarding follows your flights and tells you what matters, when it matters: when to leave home, when to check in, your terminal then your gate, delays, boarding, the baggage belt.</p><p>It works on any phone. With the free Garmin watch face, the same information is on your wrist.</p>"],
    ["Adding a flight", "<ul><li><b>Scan</b> the barcode of your boarding pass with the camera.</li><li>Or choose a <b>screenshot</b> of it – the whole screen is fine (wallet, airline app).</li><li>Or <b>type</b> the flight number and date – months ahead if you like.</li></ul>"],
    ["Reminders and alerts", "<ul><li><b>CHECK IN ONLINE</b> the day before (not shown once you scanned your boarding pass).</li><li><b>LEAVE HOME</b> at a set time; 30 minutes before, a reminder.</li><li>Alerts for a gate change, delay, cancellation, boarding and the baggage belt.</li></ul><p>Turn alerts on in <b>Account</b>. On iPhone, add Boarding to your home screen first.</p>"],
    ["Terminal first, then the gate", "<p>More than 3 hours before departure you see your <b>terminal</b>. Gates announced earlier often change, so the gate shows up within 3 hours. A gate change is always shown in red.</p>"],
    ["Your boarding pass", "<p>After a scan, <b>Pass</b> (bottom bar) shows your boarding pass in the same code type as your airline’s (Aztec, QR…), ready for security and the gate. It is <b>stored only on this phone</b>, never sent to our servers, and deleted after landing.</p><p>Safari and the home-screen app keep separate copies: scan from the one you use. Keep your airline’s pass as a backup.</p>"],
    ["Sharing a flight", "<p><b>Share flight</b> creates a link for whoever picks you up: live arrival time, delay, baggage belt and weather – no account needed. No seat, no name, no e-mail. The link stops working a few days after the flight.</p>"],
    ["When to leave home", "<p>In <b>To the airport</b>, set where you leave from and how much time you want at the airport. Car times use OpenStreetMap routing with a margin for traffic and parking. The <b>Uber</b> button opens Uber with the airport as destination; to book ahead, choose Schedule and the time shown.</p>"],
    ["The Garmin watch face", "<p>Install <a href=\"https://apps.garmin.com/apps/9cc1d995-2624-4cd2-a085-e798e7aa1c50\" target=\"_blank\" rel=\"noopener\">Boarding</a> on your watch, tap it and link it in <b>Account</b>. When your destination is in another time zone, a small <b>L</b> on the dial points to the local time there.</p>"],
    ["Your data", "<p>Your account keeps only your e-mail address, your flights and your settings. Flight data comes from AeroDataBox, weather from NOAA and Open-Meteo, aircraft photos from Wikimedia Commons. See the <a href=\"privacy/\">privacy policy</a>.</p>"]
  ];
  $("#infos").innerHTML = INFOS.map(function (x) { return "<details><summary>" + x[0] + "</summary>" + x[1] + "</details>"; }).join("");

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
    ["TERMINAL 1", "blanc", "More than 3 hours before departure: your terminal. The gate shows up within 3 hours (earlier gates often change)."],
    ["GATE SOON", "blanc", "Neither gate nor terminal known yet."],
    ["BELT SOON", "blanc", "Baggage belt not announced yet."],
    ["BAG DROP · DOORS", "gris", "The ring in the last 90 minutes: bag drop closes, boarding, doors close, departure."],
    ["DEP · ARR · T", "gris", "Departure, arrival, terminal."],
    ["HOME", "gris", "Time at home (your home time zone), shown when you travel."],
    ["L", "blanc", "Small mark on the edge of the dial: the local time at your destination, when it is in another time zone (e.g. on 10 when it is 16:00 at home and 10:00 in New York)."]
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

  // ---- vol partagé (lien public) ----
  function afficherPartage(v) {
    var box = $("#partage");
    if (v.inconnu) { box.innerHTML = '<div class="carte"><h2>' + esc(v.n) + '</h2><p class="aide">Waiting for flight data…</p></div>'; return; }
    var e = etat(v), dep = v.ed || v.sd, arr = v.ea || v.sa;
    var retard = v.al2 > 5 ? "+" + v.al2 + " min" : v.al2 < -5 ? v.al2 + " min" : "on time";
    box.innerHTML = '<div class="carte vol"><div class="tete"><div><div class="num">' + esc(v.n) + '</div><div class="jourv">' + esc(jourTxt(dep, v.oz)) + (v.al ? " · " + esc(v.al) : "") + '</div></div><span class="pill ' + e[1] + '">' + e[0] + "</span></div>" +
      '<div class="trajetv"><div class="apt"><span class="code3">' + esc(v.o) + '</span><span class="ville">' + esc(v.oc || "") + '</span><span class="h">' + hm(dep, v.oz) + '</span></div><span class="fleche">→</span>' +
      '<div class="apt"><span class="code3">' + esc(v.a) + '</span><span class="ville">' + esc(v.ac2 || "") + '</span><span class="h' + (v.al2 > 5 ? " ambre" : "") + '">' + (arr ? hm(arr, v.az) : "") + "</span></div></div>" +
      (arr ? '<div class="bandeau ' + (v.st === "Arrived" ? "bleu" : v.al2 > 5 ? "ambre" : "bleu") + '"><span>' + (v.st === "Arrived" ? "LANDED" : "LANDS AT") + "<small>local time in " + esc(v.ac2 || v.a) + " · " + retard + '</small></span><span class="grand">' + hm(v.ln || arr, v.az) + "</span></div>" : "") +
      '<div class="cases">' + cas("BELT", v.b) + cas("ARR. TERMINAL", v.ta) + cas("ARR. GATE", v.ag) + cas("TOOK OFF", v.tk ? hm(v.tk, v.oz) : "") + "</div>" +
      meteoHtml(v, "Weather in " + (v.ac2 || v.a)) + '<section class="sec"><h3 class="sec-titre">Map</h3><div class="carte-vol"></div></section></div>';
    carteVol(box.querySelector(".carte-vol"), v);
  }
  function chargerPartage(s) {
    return AVIATOR.appel({ action: "boarding.voir", s: s }).then(function (o) { afficherPartage(o.vol); }).catch(function (x) {
      $("#partage").innerHTML = '<div class="carte"><h2>Link not available</h2><p class="aide">' + esc((x && x.message) || "Error.") + "</p></div>";
    });
  }

  // rafraîchissement : à chaque retour sur la page, et toutes les 2 min tant qu'elle est ouverte
  var partageS = (/[?&]s=([0-9a-f]{16})(?:&|$)/.exec(location.search) || [])[1];
  document.addEventListener("visibilitychange", function () { if (document.hidden) return; if (partageS) chargerPartage(partageS); else if (jeton) charger(); });
  setInterval(function () {
    if (document.hidden) return;
    if (partageS) chargerPartage(partageS);
    else if (jeton) AVIATOR.appel({ action: "boarding.charger", jeton: jeton }).then(afficherVols).catch(function () {});
  }, 120000);

  // ---- nouvelle version en ligne → rechargement (l'app épinglée sur l'écran d'accueil garde parfois l'ancienne page)
  var VERSION = "23";
  function verifierVersion() {
    fetch("version.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (o) {
      if (o && o.v && String(o.v) !== VERSION && lsLire("boarding-rechargee") !== String(o.v)) { lsEcrire("boarding-rechargee", String(o.v)); location.reload(); }
    }).catch(function () {});
  }
  verifierVersion();
  document.addEventListener("visibilitychange", function () { if (!document.hidden) verifierVersion(); });

  // ---- démarrage : lien partagé, QR code de la montre, téléphone mémorisé, sinon connexion ----
  var qr = /[?&]c=(\d{6})(?:&|$)/.exec(location.search);
  if (partageS) {
    voir("partage"); $("#partage").innerHTML = '<p class="aide">Loading…</p>'; chargerPartage(partageS);
  } else if (qr) {
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    var mm = lsLire(MEMO);
    (mm ? AVIATOR.appel({ action: "boarding.reprendre", memo: mm }) : Promise.reject({}))
      .then(function (o) {
        if (!o.email) throw {};
        ouvert(o); onglet("moi");
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
