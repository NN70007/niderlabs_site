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
    } else go();
    // les données de la carte partent une fois la page chargée (le serveur met quelques secondes) : elles sont prêtes quand on y arrive
    var prefetch = function () { setTimeout(function () { if (window.AVIATOR_CARTE_DONNEES) window.AVIATOR_CARTE_DONNEES().catch(function () {}); }, 300); };
    if (document.readyState === "complete") prefetch(); else addEventListener("load", prefetch);
  }
  var GROUPES = [
    ["METAR", null], ["ELLX", "Luxembourg (ELLX)"], ["210750Z", "Observed 07:50 UTC"],
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
  // toutes les lignes sont créées d'emblée (invisibles) : le panneau garde sa taille, la page ne bouge pas
  var vues = GROUPES.map(function (g) {
    if (!g[1]) return null;
    var d = document.createElement("div"); d.className = "l"; d.textContent = g[1]; lignes.appendChild(d); return d;
  });
  var cat = document.createElement("div"); cat.className = "l cat"; cat.textContent = "VFR"; lignes.appendChild(cat);
  function tout(etat) { vues.forEach(function (d) { if (d) d.classList.toggle("vu", etat); }); cat.classList.toggle("vu", etat); }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    spans.forEach(function (s) { s.className = "lu"; }); tout(true); boite.classList.add("fini"); return;
  }
  var i = 0;
  function suivant() {
    if (i > 0) spans[i - 1].className = "lu";
    if (i >= GROUPES.length) {
      cat.classList.add("vu"); boite.classList.add("fini");
      setTimeout(function () { // on recommence après une pause
        boite.classList.remove("fini"); tout(false); spans.forEach(function (s) { s.className = ""; }); i = 0; setTimeout(suivant, 700);
      }, 9000);
      return;
    }
    spans[i].className = "actif";
    if (vues[i]) vues[i].classList.add("vu");
    i++;
    setTimeout(suivant, GROUPES[i - 1][1] ? 1400 : 450);
  }
  setTimeout(suivant, 900);
})();
