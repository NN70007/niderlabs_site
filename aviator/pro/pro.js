/* Aviator METAR Pro — briefing, minima personnels, validités pilote (page expérimentale). */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var jeton = null, pro = null, brief = null;
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function msg(el, txt, ok) { el.textContent = txt; el.className = "message " + (ok ? "ok" : "err"); el.hidden = !txt; }
  function hm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function hmz(d) { return pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + "Z"; }
  var MOIS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  function jour(t) { var d = new Date(t); return pad(d.getUTCDate()) + " " + MOIS[d.getUTCMonth()] + " " + d.getUTCFullYear(); }

  /* ---------- ouverture (code de la montre, via reglages.js) ---------- */
  window.onAviatorOpen = function (j) {
    jeton = j;
    $("#vue-pro").hidden = false;
    AVIATOR.appel({ action: "pro.charger", jeton: jeton }).then(function (o) { pro = o.pro; remplirMinima(); remplirCur(); }).catch(function () {});
    chargerBriefing();
  };

  /* ---------- onglets ---------- */
  var tabs = ["brief", "min", "cur", "set"];
  tabs.forEach(function (t) {
    $("#t-" + t).addEventListener("click", function () {
      tabs.forEach(function (u) { $("#t-" + u).setAttribute("aria-selected", u === t ? "true" : "false"); $("#p-" + u).hidden = u !== t; });
      if (t === "set") $("#vue-reglages").hidden = false;
      window.scrollTo(0, 0);
    });
  });

  /* ---------- calculs ---------- */
  function visM(v) { if (v == null || v === "") return null; if (/\+/.test(String(v))) return 10000; var n = parseFloat(v); return isFinite(n) ? Math.round(n * 1609) : null; }
  function plafond(clouds, vv) {
    var c = null;
    (clouds || []).forEach(function (x) { if ((x.cover === "BKN" || x.cover === "OVC" || x.cover === "OVX") && isFinite(x.base) && x.base != null && (c == null || x.base < c)) c = x.base; });
    if (vv != null && isFinite(vv) && (c == null || vv * 100 < c)) c = vv * 100;
    return c;
  }
  function categorie(ceil, vm) {
    if (ceil == null && vm == null) return "";
    var c = ceil == null ? 99999 : ceil, v = vm == null ? 99999 : vm / 1609;
    if (c < 500 || v < 1) return "LIFR"; if (c < 1000 || v < 3) return "IFR"; if (c <= 3000 || v <= 5) return "MVFR"; return "VFR";
  }
  function bouts(apt) {
    var out = [];
    ((apt && apt.rwy) || []).forEach(function (r) {
      var p = String(r.id).split("/"), al = Number(r.al);
      p.forEach(function (b, k) {
        var n = parseInt(b, 10); if (!(n >= 1 && n <= 36)) return;
        var h = isFinite(al) && r.al != null ? (k === 0 ? al : (al + 180) % 360) : n * 10;
        out.push({ id: b, hdg: h, dim: r.dim, surf: r.surf });
      });
    });
    return out;
  }
  function composantes(wdir, spd, hdg) { var a = (wdir - hdg) * Math.PI / 180; return { head: Math.round(spd * Math.cos(a)), xw: Math.round(spd * Math.sin(a)) }; }
  function meilleure(bs, wdir, spd) {
    var best = null;
    bs.forEach(function (b) { var c = composantes(wdir, spd, b.hdg); if (!best || c.head > best.c.head) best = { b: b, c: c }; });
    return best;
  }
  /** Vérifie des conditions contre les minima : renvoie [verdict, raisons]. */
  function evaluer(o, mn) {
    var r = [], marg = false, nogo = false;
    var chk = function (val, lim, plus, nom, u) {
      if (val == null || lim == null || lim === 0) return;
      if (plus ? val > lim : val < lim) { nogo = true; r.push(nom + " " + val + u + " (limit " + lim + u + ")"); }
      else if (plus ? val > lim * 0.8 : val < lim * 1.2) { marg = true; r.push(nom + " " + val + u + " near limit " + lim + u); }
    };
    chk(o.ceil, mn.ceil, false, "Ceiling", " ft"); chk(o.vis, mn.vis, false, "Visibility", " m");
    chk(o.wind, mn.wind, true, "Wind", " kt"); if (o.xw != null) chk(Math.abs(o.xw), mn.xw, true, "Crosswind", " kt");
    if (o.gust != null && o.wind != null) chk(o.gust - o.wind, mn.gust, true, "Gust spread", " kt");
    return [nogo ? "NOGO" : marg ? "MARGINAL" : "GO", r];
  }
  /* Soleil (algorithme NOAA simplifié) : heure UTC du lever/coucher pour un angle zénithal donné. */
  function soleil(lat, lon, date, zen, lever) {
    var rad = Math.PI / 180, N = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
    var lh = lon / 15, t = N + ((lever ? 6 : 18) - lh) / 24, M = 0.9856 * t - 3.289;
    var L = (M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634 + 360) % 360;
    var RA = (Math.atan(0.91764 * Math.tan(L * rad)) / rad + 360) % 360;
    RA = (RA + Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90) / 15;
    var sd = 0.39782 * Math.sin(L * rad), cd = Math.cos(Math.asin(sd));
    var ch = (Math.cos(zen * rad) - sd * Math.sin(lat * rad)) / (cd * Math.cos(lat * rad));
    if (ch > 1 || ch < -1) return null;
    var H = (lever ? 360 - Math.acos(ch) / rad : Math.acos(ch) / rad) / 15;
    var UT = ((H + RA - 0.06571 * t - 6.622 - lh) % 24 + 24) % 24;
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) + UT * 3600000);
  }

  /* ---------- briefing ---------- */
  function chargerBriefing() {
    $("#brief").innerHTML = '<p class="aide">Loading the latest METAR and TAF…</p>';
    AVIATOR.appel({ action: "pro.briefing", jeton: jeton }).then(function (o) { brief = o; pro = pro || o.pro; afficherBriefing(); })
      .catch(function (x) { $("#brief").innerHTML = '<div class="message err">' + esc(x.message) + "</div>"; });
  }
  $("#rafraichir").addEventListener("click", function () { if (jeton) chargerBriefing(); });

  function afficherBriefing() {
    var o = brief, mn = (pro || o.pro).mn, box = $("#brief"), html = "";
    $("#brief-maj").textContent = "Updated " + hm(new Date(o.maj)) + " local · " + hmz(new Date(o.maj)) + " · source aviationweather.gov (NOAA)";
    var roles = ["DEPARTURE", "DESTINATION", "ALTERNATE"];
    o.icaos.forEach(function (ic, idx) {
      var m = (o.metar[ic] || [])[0], t = (o.taf[ic] || [])[0], apt = o.apt[ic], bs = bouts(apt);
      html += '<article class="apt"><div class="apt-tete"><span class="icao-g">' + esc(ic) + '</span><span class="nom">' + esc(roles[idx] || "") + (apt ? " · " + esc(apt.nom) : "") + "</span>";
      if (!m) { html += '</div><p class="aide">No recent METAR for this aerodrome.</p>'; }
      else {
        var ceil = plafond(m.clouds, m.vertVis), vm = visM(m.visib), cat = m.fltCat || categorie(ceil, vm);
        var wd = m.wdir, ws = m.wspd || 0, wg = m.wgst || null, best = isFinite(wd) && wd != null && bs.length ? meilleure(bs, wd, ws) : null;
        var ev = evaluer({ ceil: ceil, vis: vm, wind: ws, gust: wg, xw: best ? best.c.xw : null }, mn);
        html += (cat ? '<span class="cat ' + cat + '">' + cat + "</span>" : "") + '<span class="verdict ' + ev[0] + '">' + (ev[0] === "NOGO" ? "NO-GO" : ev[0]) + "</span></div>";
        if (ev[1].length) html += '<p class="raisons">' + ev[1].map(esc).join(" · ") + "</p>";
        var age = Math.round((Date.now() / 1000 - m.obsTime) / 60);
        var dewSpread = m.temp != null && m.dewp != null ? m.temp - m.dewp : null;
        var pa = apt && apt.elev != null && m.altim ? apt.elev * 3.281 + (1013.25 - m.altim) * 27 : null;
        var da = pa != null && m.temp != null ? Math.round((pa + 120 * (m.temp - (15 - 2 * apt.elev * 3.281 / 1000))) / 10) * 10 : null;
        html += '<div class="faits">' +
          fait("WIND", wd == null ? (ws ? "VRB " + ws : "CALM") : pad3(wd) + "° " + ws + (wg ? "G" + wg : ""), "kt") +
          fait("VISIBILITY", vm == null ? "–" : vm >= 10000 ? "10 km+" : (vm >= 5000 ? Math.round(vm / 1000) + " km" : vm + " m"), "") +
          fait("CEILING", ceil == null ? "NONE" : ceil + " ft", nuages(m.clouds)) +
          fait("QNH", m.altim ? Math.round(m.altim) : "–", m.altim ? (m.altim * 0.02953).toFixed(2) + " inHg" : "") +
          fait("TEMP / DEW", (m.temp != null ? Math.round(m.temp) : "–") + " / " + (m.dewp != null ? Math.round(m.dewp) : "–"), dewSpread != null && dewSpread <= 3 ? "Spread " + Math.round(dewSpread) + "° – fog / low cloud risk" : "°C") +
          fait("DENSITY ALT.", da == null ? "–" : da + " ft", apt && apt.elev != null ? "Field " + Math.round(apt.elev * 3.281) + " ft" : "") +
          fait("METAR AGE", age + " min", hmz(new Date(m.obsTime * 1000))) + "</div>";
        if (bs.length && wd != null) {
          html += '<div class="pistes-c">';
          bs.sort(function (a, b) { return composantes(wd, ws, b.hdg).head - composantes(wd, ws, a.hdg).head; }).forEach(function (b, k) {
            var c = composantes(wd, ws, b.hdg), g = wg ? composantes(wd, wg, b.hdg) : null;
            var cote = c.xw > 0 ? " R" : c.xw < 0 ? " L" : "";
            html += '<div class="rwy' + (k === 0 ? " best" : "") + '"><div class="rwy-t">RWY ' + esc(b.id) + (k === 0 ? ' <em>BEST</em>' : "") + "</div>" +
              '<div class="rwy-v"><div><span>' + (c.head >= 0 ? "HEADWIND" : "TAILWIND") + "</span><b>" + Math.abs(c.head) + ' <i>kt</i></b></div>' +
              "<div><span>CROSSWIND</span><b>" + Math.abs(c.xw) + ' <i>kt' + cote + "</i></b>" + (g ? "<small>" + Math.abs(g.xw) + " kt in gusts</small>" : "") + "</div></div></div>";
          });
          html += "</div>";
        }
      }
      if (apt && apt.lat != null) {
        var d = new Date(), z = 90.833, cz = 96;
        var lv = soleil(apt.lat, apt.lon, d, z, true), co = soleil(apt.lat, apt.lon, d, z, false), fin = soleil(apt.lat, apt.lon, d, cz, false), deb = soleil(apt.lat, apt.lon, d, cz, true);
        if (co && fin) {
          var reste = Math.round((fin - Date.now()) / 60000);
          html += '<div class="faits">' + fait("SUNRISE", lv ? hm(lv) : "–", lv ? hmz(lv) : "") + fait("SUNSET", hm(co), hmz(co)) +
            fait("NIGHT BEGINS", hm(fin), hmz(fin) + " · end of civil twilight") +
            fait("DAYLIGHT LEFT", reste > 0 ? Math.floor(reste / 60) + " h " + pad(reste % 60) : "NIGHT", reste > 0 ? "until night (EASA)" : "first light " + (deb ? hm(deb) : "–")) + "</div>";
        }
      }
      if (t) {
        html += '<div class="defile"><table class="taf"><thead><tr><th>TAF PERIOD</th><th>CONDITIONS</th><th>MY MINIMA</th></tr></thead><tbody>';
        (t.fcsts || []).forEach(function (f) {
          if (f.timeTo && f.timeTo * 1000 < Date.now()) return;
          var ceil = plafond(f.clouds, f.vertVis), vm = visM(f.visib), cat = categorie(ceil, vm);
          var best = f.wdir != null && f.wspd != null && bs.length ? meilleure(bs, f.wdir, f.wspd) : null;
          var ev = evaluer({ ceil: ceil, vis: vm, wind: f.wspd, gust: f.wgst, xw: best ? best.c.xw : null }, mn);
          var per = (f.fcstChange ? f.fcstChange + (f.probability ? " " + f.probability + "%" : "") + " " : (f.probability ? "PROB" + f.probability + " " : "")) + hmz(new Date(f.timeFrom * 1000)) + " – " + hmz(new Date(f.timeTo * 1000));
          var cond = [cat ? '<span class="cat ' + cat + '">' + cat + "</span>" : "", f.wspd != null ? (f.wdir != null ? pad3(f.wdir) + "°" : "VRB") + " " + f.wspd + (f.wgst ? "G" + f.wgst : "") + " kt" : "", vm != null ? (vm >= 10000 ? "10 km+" : vm + " m") : "", ceil != null ? "ceiling " + ceil + " ft" : "", f.wxString || ""].filter(String).join(" · ");
          html += "<tr><td>" + esc(per) + "</td><td>" + cond + '</td><td><span class="verdict ' + ev[0] + '">' + (ev[0] === "NOGO" ? "NO-GO" : ev[0]) + "</span></td></tr>";
        });
        html += "</tbody></table></div>";
      }
      html += '<div class="brut">' + esc(m ? m.rawOb : "") + (t ? "\n\n" + esc(t.rawTAF) : "") + "</div></article>";
    });
    box.innerHTML = html || '<p class="aide">Set your aerodromes in Watch settings.</p>';
  }
  function pad3(n) { return ("00" + n).slice(-3); }
  function fait(t, v, s) { return '<div class="fait"><span>' + t + "</span><b>" + esc(v) + "</b>" + (s ? "<small>" + esc(s) + "</small>" : "") + "</div>"; }
  function nuages(c) { return (c || []).map(function (x) { return x.cover + (x.base != null ? " " + x.base : ""); }).join(", ") || "No cloud reported"; }

  /* ---------- minima ---------- */
  var MN = ["ceil", "vis", "wind", "xw", "gust"];
  function remplirMinima() { MN.forEach(function (k) { $("#mn-" + k).value = pro.mn[k]; }); }
  $("#save-min").addEventListener("click", function () {
    MN.forEach(function (k) { pro.mn[k] = Number(String($("#mn-" + k).value).replace(/[^\d.]/g, "") || 0); });
    enregistrer($("#msg-min"), "Minima saved. The briefing now uses them.");
  });

  /* ---------- validités ---------- */
  function remplirCur() {
    ["sep", "med", "lpe"].forEach(function (k) { $("#dt-" + k).value = pro.dt[k] || ""; });
    $("#lg-d").value = new Date().toISOString().slice(0, 10);
    listeVols(); cartes();
  }
  function listeVols() {
    var l = pro.lg.slice().sort(function (a, b) { return a.d < b.d ? 1 : -1; });
    $("#lg-liste").innerHTML = l.length ? "<h2>My last flights</h2>" + l.slice(0, 20).map(function (e) {
      var i = pro.lg.indexOf(e);
      return '<div class="vol"><span>' + esc(e.d) + " · " + e.h + " h · " + e.ldg + " ldg" + (e.nl ? " (" + e.nl + " night)" : "") + (e.pic ? " · PIC" : "") + (e.fi ? " · with instructor" : "") + '</span><button type="button" data-i="' + i + '">Remove</button></div>';
    }).join("") : '<p class="aide">No flight logged yet. Add your recent flights to compute your passenger and night currency.</p>';
    Array.prototype.forEach.call($("#lg-liste").querySelectorAll("button[data-i]"), function (b) {
      b.addEventListener("click", function () { pro.lg.splice(Number(b.getAttribute("data-i")), 1); listeVols(); cartes(); });
    });
  }
  $("#lg-add").addEventListener("click", function () {
    var e = { d: $("#lg-d").value, h: Number(String($("#lg-h").value).replace(",", ".")) || 0, ldg: Number($("#lg-l").value) || 0, nl: Number($("#lg-n").value) || 0, pic: $("#lg-pic").checked, fi: $("#lg-fi").checked };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.d) || (!e.h && !e.ldg)) { msg($("#msg-cur"), "Enter a date and the flight time or the landings.", false); return; }
    pro.lg.push(e); $("#lg-h").value = ""; $("#lg-l").value = ""; $("#lg-n").value = ""; $("#lg-fi").checked = false;
    $("#msg-cur").hidden = true; listeVols(); cartes();
  });
  ["sep", "med", "lpe"].forEach(function (k) { $("#dt-" + k).addEventListener("change", function () { pro.dt[k] = this.value; cartes(); }); });
  function cartes() {
    var now = Date.now(), ev = [], nuit = [];
    pro.lg.forEach(function (e) { var t = Date.parse(e.d + "T12:00:00Z"); for (var k = 0; k < e.ldg; k++) ev.push(t); if (e.nl) nuit.push(t); });
    ev.sort(function (a, b) { return b - a; }); nuit.sort(function (a, b) { return b - a; });
    var pax = ev.length >= 3 ? ev[2] + 90 * 864e5 : null, nt = nuit.length ? nuit[0] + 90 * 864e5 : null;
    var c = function (titre, val, cls, sous) { return '<div class="statut-c ' + cls + '"><span>' + titre + "</span><b>" + esc(val) + "</b>" + (sous ? '<small class="aide">' + sous + "</small>" : "") + "</div>"; };
    var cls = function (t) { return t == null ? "bad" : t < now ? "bad" : t - now < 30 * 864e5 ? "warn" : "ok"; };
    var h = c("PASSENGERS", pax && pax >= now ? "Current until " + jour(pax) : "Not current", cls(pax), "3 take-offs and landings in the last 90 days (FCL.060)") +
      c("NIGHT", nt && nt >= now ? "Current until " + jour(nt) : "Not current", nt && nt >= now ? cls(nt) : "warn", "1 night landing in the last 90 days, for passengers at night");
    [["SEP RATING", pro.dt.sep], ["MEDICAL", pro.dt.med], ["ENGLISH (LPE)", pro.dt.lpe]].forEach(function (x) {
      if (!x[1]) { h += c(x[0], "Not set", "warn", "Enter the date below"); return; }
      var t = Date.parse(x[1] + "T23:59:59Z"), j = Math.ceil((t - now) / 864e5);
      h += c(x[0], t < now ? "EXPIRED" : jour(t), cls(t), t < now ? "" : j + " days left");
    });
    if (pro.dt.sep) {
      var fin = Date.parse(pro.dt.sep + "T23:59:59Z"), deb = fin - 365 * 864e5, hh = 0, pic = 0, ldg = 0, fi = false;
      pro.lg.forEach(function (e) { var t = Date.parse(e.d + "T12:00:00Z"); if (t >= deb && t <= fin) { hh += e.h; if (e.pic) pic += e.h; ldg += e.ldg; if (e.fi && e.h >= 1) fi = true; } });
      var bar = function (v, max, txt) { return '<div class="aide">' + txt + " " + (Math.round(v * 10) / 10) + " / " + max + '</div><div class="barre"><i style="width:' + Math.min(100, v / max * 100) + '%"></i></div>'; };
      var ok = hh >= 12 && pic >= 6 && ldg >= 12 && fi;
      h += '<div class="statut-c ' + (ok ? "ok" : "warn") + '"><span>SEP REVALIDATION BY EXPERIENCE</span><b>' + (ok ? "Requirements met" : "In progress") + "</b>" +
        bar(hh, 12, "Hours") + bar(pic, 6, "PIC hours") + bar(ldg, 12, "Take-offs & landings") +
        '<div class="aide">Training flight with an instructor (1 h): ' + (fi ? "done" : "to do") + '</div><small class="aide">In the 12 months before expiry (FCL.740.A)</small></div>';
    }
    $("#cur-cartes").innerHTML = h;
  }
  $("#save-cur").addEventListener("click", function () {
    ["sep", "med", "lpe"].forEach(function (k) { pro.dt[k] = $("#dt-" + k).value; });
    enregistrer($("#msg-cur"), "Saved. The PILOT page of the Pro watch face updates within 5 minutes.");
  });

  function enregistrer(el, ok) {
    AVIATOR.appel({ action: "pro.enregistrer", jeton: jeton, pro: pro }).then(function (o) {
      pro = o.pro; msg(el, ok, true); if (brief) afficherBriefing(); cartes();
    }).catch(function (x) { msg(el, x.message, false); });
  }
})();
