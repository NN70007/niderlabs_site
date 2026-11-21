/* Aviator METAR — récit au défilement : chaque groupe du METAR est relié, par un trait, à l'endroit où la montre l'affiche ;
   la montre s'approche de cet endroit. */
(function () {
  "use strict";
  var sec = document.getElementById("recit"); if (!sec) return;
  var JETONS = ["METAR", "ELLX", "210750Z", "04014G22KT", "010V080", "9999", "-RA", "FEW030", "BKN045", "12/06", "Q1018", "TEMPO", "4000", "RA", "BKN012"];
  // zone : coordonnées de l'écran de 454 px ; p = page METAR ; z = grossissement
  // t : groupes du METAR ; page : d = cadran, r = page RWY, m = page METAR ; zone : écran de 454 px ; z : grossissement
  var ETAPES = [
    { t: [10], page: "d", titre: "QNH", p: "1018 hPa in the largest digits of the dial – or in inHg if you prefer.", zone: [96, 136, 194, 304], z: 1.6 },
    { t: [3], page: "d", titre: "Wind speed", p: "14 knots, gusting 22. The digits turn amber when the crosswind on your runway goes above your limit.", zone: [258, 134, 356, 302], z: 1.6 },
    { t: [3], page: "d", titre: "Wind direction", p: "The blue arrow shows where the wind comes from, 040°, relative to runway 06: you see at once if it is ahead, across or behind.", zone: [182, 116, 290, 356], z: 1.35 },
    { t: [1], page: "d", titre: "Your airport", p: "ELLX at the bottom of the dial, with the runway you fly. Tap it to switch: airport 1, 2, 3, then the nearest one.", zone: [192, 346, 266, 422], z: 1.7 },
    { t: [2], page: "d", titre: "Zulu time", p: "The METAR is written in Zulu time (210750Z, 07:50 UTC). The Z on the rim marks the hour in UTC, next to your local time – no mental arithmetic before you file or read a report.", zone: [20, 292, 92, 364], z: 1.6, rond: 1 },
    { t: [1, 2], page: "d", calc: 1, titre: "Sunrise and sunset", p: "Not in the METAR: the watch works them out from the position of ELLX and the date. Amber marks on the edge show sunrise or sunset at their exact times, and civil twilight in between.", zone: [276, 356, 372, 448], z: 1.5, rond: 1 },
    { t: [5, 7, 8], page: "d", titre: "Flight category", p: "Visibility and cloud base add up to one word in colour at the top of the dial: VFR, MVFR, IFR or LIFR.", zone: [184, 76, 270, 107], z: 1.7, sansCadre: 1 },
    { t: [2], page: "d", titre: "How fresh it is", p: "The arc on the rim starts when the METAR was issued (minute 50) and runs to the next one, due at minute 20. Amber when the report is late, red when it is too old.", zone: [2, 80, 78, 156], z: 1.12, rond: 1, arc: 1 },
    { t: [3], page: "r", calc: 1, titre: "Your runway, computed", p: "Tap once. Not in the METAR: the watch works it out from the wind and your runway. Headwind 13 kt, XWIND (crosswind) 5 kt from the left, for runway 06.", zone: [100, 136, 356, 250], z: 1.35 },
    { t: [3, 4], page: "r", calc: 1, titre: "The worst case", p: "Also computed: with the gusts and the variable direction (010° to 080°), the crosswind can reach 17 kt – XW is short for crosswind. Your alert uses this value.", zone: [114, 258, 364, 294], z: 1.55 },
    { t: [9, 10], page: "r", calc: 1, titre: "Density altitude", p: "Computed from the temperature, the QNH and the field elevation.", zone: [144, 306, 314, 340], z: 1.65 },
    { t: [5, 6], page: "m", titre: "Visibility and weather", p: "Tap twice: the METAR in plain words. 10 km or more, light rain.", zone: [108, 146, 346, 290], z: 1.4 },
    { t: [7, 8], page: "m", titre: "Clouds, in feet", p: "Each layer with its base: few at 3000 ft, broken at 4500 ft.", zone: [68, 202, 386, 238], z: 1.5 },
    { t: [9], page: "m", titre: "Temperature and dew point", p: "12° and 6°: how close you are to mist and fog.", zone: [148, 296, 306, 330], z: 1.6 },
    { t: [11, 12, 13, 14], page: "m", titre: "What comes next", p: "The trend, in full and in amber: temporarily 4 km in rain, broken at 1200 ft.", zone: [58, 340, 396, 374], z: 1.45 }
  ];
  var brut = document.getElementById("recit-brut"), montre = document.getElementById("recit-montre"), spot = document.getElementById("recit-spot");
  var titre = document.getElementById("recit-titre"), para = document.getElementById("recit-p"), num = document.getElementById("recit-n"), barre = document.getElementById("recit-barre");
  var calc = document.getElementById("recit-calc"), trou = document.getElementById("recit-trou");
  var svg = document.getElementById("recit-lien"), chemin = document.getElementById("recit-chemin"), bout = document.getElementById("recit-bout");
  var spans = JETONS.map(function (t) { var s = document.createElement("span"); s.textContent = t; brut.appendChild(s); brut.appendChild(document.createTextNode(" ")); return s; });
  var calme = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var px = function (x) { return (x + 114) / 671 * 100; }, py = function (y) { return (y + 168) / 805 * 100; };
  var cur = -1;

  function montrer(k) {
    if (k === cur) return; cur = k;
    var e = ETAPES[k];
    spans.forEach(function (s, i) { s.className = e.t.indexOf(i) >= 0 ? "actif" : ""; });
    titre.textContent = e.titre; para.textContent = e.p;
    num.textContent = (k < 9 ? "0" : "") + (k + 1) + " / " + ETAPES.length;
    montre.classList.toggle("metar", e.page === "m");
    montre.classList.toggle("rwy", e.page === "r");
    var z = e.zone, cx = (px(z[0]) + px(z[2])) / 2, cy = (py(z[1]) + py(z[3])) / 2;
    spot.style.left = px(z[0]) + "%"; spot.style.top = py(z[1]) + "%";
    spot.style.width = (px(z[2]) - px(z[0])) + "%"; spot.style.height = (py(z[3]) - py(z[1])) + "%";
    spot.classList.toggle("spot-rond", !!e.rond);
    // la zone reste nette, le reste de l'écran est grisé (pourcentages de l'écran de 454 px)
    var m = 10, q = function (v) { return (v / 454 * 100).toFixed(2) + "%"; };
    trou.style.left = q(z[0] - m); trou.style.top = q(z[1] - m);
    trou.style.width = q(z[2] - z[0] + 2 * m); trou.style.height = q(z[3] - z[1] + 2 * m);
    trou.classList.toggle("trou-rond", !!e.rond);
    sec.classList.toggle("arc-entier", !!e.arc);
    spot.classList.toggle("on", !e.sansCadre);
    sec.classList.toggle("calcul", !!e.calc);
    calc.hidden = !e.calc;
    montre.style.transformOrigin = cx + "% " + cy + "%";
    montre.style.transform = calme ? "none" : "scale(" + (1 + (e.z - 1) * 0.8).toFixed(2) + ")";
    var t0 = performance.now();
    (function suivre(now) { lien(Math.min(1, (now - t0) / 700)); if (now - t0 < 760) requestAnimationFrame(suivre); })(t0);
  }

  // trait du groupe du METAR (en haut) jusqu'à la zone de la montre
  function lien(av) {
    var e = ETAPES[cur]; if (!e) return;
    var r = svg.getBoundingClientRect();
    svg.setAttribute("viewBox", "0 0 " + r.width + " " + r.height);
    var s = e.t.length ? spans[e.t[0]] : null, last = e.t.length ? spans[e.t[e.t.length - 1]] : null;
    if (!s || getComputedStyle(svg).display === "none") { chemin.setAttribute("d", ""); bout.setAttribute("r", 0); return; }
    var a = s.getBoundingClientRect(), b = last.getBoundingClientRect(), p = spot.getBoundingClientRect();
    var x1 = (a.left + b.right) / 2 - r.left, y1 = a.bottom - r.top + 6;
    var x2 = p.left + p.width / 2 - r.left, y2 = p.top - r.top - 4;
    if (y2 < y1 + 20) y2 = p.top + p.height / 2 - r.top;
    var my = y1 + (y2 - y1) * 0.55;
    var d = "M" + x1 + "," + y1 + " C" + x1 + "," + my + " " + x2 + "," + (y1 + (y2 - y1) * 0.35) + " " + x2 + "," + y2;
    chemin.setAttribute("d", d);
    var L = chemin.getTotalLength();
    chemin.style.strokeDasharray = L; chemin.style.strokeDashoffset = L * (1 - av);
    var q = chemin.getPointAtLength(L * av); bout.setAttribute("cx", q.x); bout.setAttribute("cy", q.y); bout.setAttribute("r", 4);
  }

  function defile() {
    var r = sec.getBoundingClientRect(), h = sec.offsetHeight - innerHeight;
    var prog = Math.min(0.999, Math.max(0, -r.top / Math.max(1, h)));
    barre.style.width = (prog * 100) + "%";
    montrer(Math.floor(prog * ETAPES.length));
  }
  addEventListener("scroll", function () { requestAnimationFrame(defile); }, { passive: true });
  addEventListener("resize", function () { var k = cur; cur = -1; montrer(Math.max(0, k)); });
  montrer(0); defile();
})();
