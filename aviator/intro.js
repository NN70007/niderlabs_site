/* Aviator METAR — animation d'ouverture : un METAR brut se décode en mots de pilote. */
(function () {
  "use strict";
  // carte des aéroports : chargée seulement quand elle arrive à l'écran
  var ca = document.getElementById("carte-accueil");
  if (ca && window.AVIATOR_CARTE) {
    var lance = false;
    var go = function () { if (lance) return; lance = true; window.AVIATOR_CARTE(ca, { total: document.getElementById("total-accueil") }); };
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (e) { if (e[0].isIntersecting) { io.disconnect(); go(); } }, { rootMargin: "200px" });
      io.observe(ca);
    }
    setTimeout(go, 3000); // filet de sécurité : la carte se charge de toute façon après 3 s
  }
  var GROUPES = [
    ["METAR", null], ["ELLX", "Luxembourg (ELLX)", "aero"], ["210000Z", "Observed 00:00 UTC", "arc"],
    ["04014G22KT", "Wind 040° · 14 kt, gusts 22", "vent"], ["010V080", "Variable 010°–080°", "fleche"],
    ["9999", "Visibility 10 km or more", "vis"], ["-RA", "Light rain", "wx"],
    ["FEW030", "Few clouds · 3000 ft", "nuages"], ["BKN045", "Broken · 4500 ft", "nuages"],
    ["12/06", "Temperature 12° · dew point 6°", "temp"], ["Q1018", "QNH 1018 hPa", "qnh"],
    ["TEMPO", null, "tendance"], ["4000", null, "tendance"], ["RA", null, "tendance"], ["BKN012", "Tempo: 4 km in rain, broken 1200 ft", "tendance"]
  ];
  // Zones de la montre (coordonnées de l'écran de 454 px) ; p = page METAR affichée
  var ZONES = {
    aero: [192, 346, 266, 422], arc: [36, 36, 104, 104], vent: [258, 134, 356, 302], fleche: [182, 116, 290, 356],
    qnh: [96, 136, 194, 304], vfr: [184, 76, 270, 107],
    vis: [108, 146, 346, 184, 1], wx: [196, 250, 260, 286, 1], nuages: [68, 202, 386, 238, 1], temp: [148, 296, 306, 330, 1], tendance: [58, 340, 396, 374, 1]
  };
  var montre = document.getElementById("montre-av"), spot = document.getElementById("spot");
  function vise(cle) {
    if (!montre || !spot) return;
    if (!cle) { spot.classList.remove("on"); montre.classList.remove("metar"); return; }
    var z = ZONES[cle];
    montre.classList.toggle("metar", !!z[4]);
    var px = function (x) { return (x + 114) / 671 * 100; }, py = function (y) { return (y + 168) / 805 * 100; };
    spot.style.left = px(z[0]) + "%"; spot.style.top = py(z[1]) + "%";
    spot.style.width = (px(z[2]) - px(z[0])) + "%"; spot.style.height = (py(z[3]) - py(z[1])) + "%";
    spot.classList.toggle("rond", cle === "arc");
    spot.classList.add("on");
  }
  var brut = document.getElementById("brut"), lignes = document.getElementById("lignes"), boite = document.getElementById("decode");
  if (!brut || !lignes) return;
  var spans = GROUPES.map(function (g) {
    var s = document.createElement("span"); s.textContent = g[0]; brut.appendChild(s); brut.appendChild(document.createTextNode(" ")); return s;
  });
  function fin() {
    spans.forEach(function (s) { s.className = "lu"; });
    lignes.innerHTML = "";
    GROUPES.forEach(function (g) { if (g[1]) ajoute(g[1], true); });
    ajoute("VFR", true, true);
    boite.classList.add("fini");
    vise("vfr");
  }
  function ajoute(t, direct, cat) {
    var d = document.createElement("div"); d.className = "l" + (cat ? " cat" : "") + (direct ? " vu" : "");
    d.textContent = t; lignes.appendChild(d);
    if (!direct) requestAnimationFrame(function () { requestAnimationFrame(function () { d.classList.add("vu"); }); });
  }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { fin(); return; }
  var i = 0;
  function suivant() {
    if (i > 0) spans[i - 1].className = "lu";
    if (i >= GROUPES.length) {
      ajoute("VFR", false, true); boite.classList.add("fini"); vise("vfr");
      setTimeout(function () { // on recommence après une pause
        boite.classList.remove("fini"); lignes.innerHTML = ""; spans.forEach(function (s) { s.className = ""; }); i = 0; vise(null); setTimeout(suivant, 700);
      }, 7000);
      return;
    }
    spans[i].className = "actif";
    if (GROUPES[i][1]) ajoute(GROUPES[i][1]);
    if (GROUPES[i][2]) vise(GROUPES[i][2]);
    i++;
    setTimeout(suivant, GROUPES[i - 1][1] ? 900 : 300);
  }
  setTimeout(suivant, 900);
})();
