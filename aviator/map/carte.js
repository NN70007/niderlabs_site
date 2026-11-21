/* Aviator METAR — carte publique des aéroports : carte en points dessinée sur place (aucun service extérieur). */
(function () {
  "use strict";
  window.AVIATOR_CARTE(document.getElementById("plan"), { bulles: true, total: document.getElementById("total") });
})();
