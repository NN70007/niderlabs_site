/* Aviator METAR — animation d'ouverture : un METAR brut se décode en mots de pilote. */
(function () {
  "use strict";
  // carte des aéroports : chargée seulement quand elle arrive à l'écran
  var ca = document.getElementById("carte-accueil");
  if (ca && window.AVIATOR_CARTE) {
    var go = function () { window.AVIATOR_CARTE(ca, { total: document.getElementById("total-accueil") }); };
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (e) { if (e[0].isIntersecting) { io.disconnect(); go(); } }, { rootMargin: "200px" });
      io.observe(ca);
    } else go();
  }
  var GROUPES = [
    ["METAR", null], ["ELLX", "Luxembourg (ELLX)"], ["211450Z", "Observed 14:50 UTC"],
    ["04014G22KT", "Wind 040° · 14 kt, gusts 22"], ["010V080", "Variable 010°–080°"],
    ["9999", "Visibility 10 km or more"], ["-RA", "Light rain"],
    ["FEW030", "Few clouds · 3000 ft"], ["BKN045", "Broken · 4500 ft"],
    ["12/06", "Temperature 12° · dew point 6°"], ["Q1018", "QNH 1018 hPa"],
    ["TEMPO", null], ["4000", null], ["RA", null], ["BKN012", "Tempo: 4 km in rain, broken 1200 ft"]
  ];
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
      ajoute("VFR", false, true); boite.classList.add("fini");
      setTimeout(function () { // on recommence après une pause
        boite.classList.remove("fini"); lignes.innerHTML = ""; spans.forEach(function (s) { s.className = ""; }); i = 0; setTimeout(suivant, 700);
      }, 7000);
      return;
    }
    spans[i].className = "actif";
    if (GROUPES[i][1]) ajoute(GROUPES[i][1]);
    i++;
    setTimeout(suivant, GROUPES[i - 1][1] ? 620 : 260);
  }
  setTimeout(suivant, 900);
})();
