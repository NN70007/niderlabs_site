/* Aviator METAR — carte publique des aéroports (Leaflet + OpenStreetMap). */
(function () {
  "use strict";
  var T = { "1-4": 7, "5+": 11, "10+": 16 };
  var carte = L.map("plan", { worldCopyJump: true, scrollWheelZoom: false }).setView([48, 8], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 12, attribution: "&copy; OpenStreetMap contributors" }).addTo(carte);
  var calque = L.layerGroup().addTo(carte);
  AVIATOR.appel({ action: "aviator.carte" }).then(function (o) {
    var b = [];
    o.points.forEach(function (p) {
      var c = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#4F8FE8";
      L.circleMarker([p.lat, p.lon], { radius: T[p.t] || 7, color: c, weight: 2, fillColor: c, fillOpacity: 0.55 })
        .bindTooltip("<b>" + p.icao + "</b> " + (p.nom || "") + "<br>" + (p.t === "1-4" ? "1–4" : p.t) + " pilots")
        .addTo(calque);
      b.push([p.lat, p.lon]);
    });
    document.getElementById("total").textContent = o.points.length + (o.points.length === 1 ? " airport" : " airports");
    if (b.length > 1) carte.fitBounds(b, { padding: [40, 40], maxZoom: 7 });
    else if (b.length === 1) carte.setView(b[0], 7);
  }).catch(function (x) { document.getElementById("total").textContent = x.message; });
})();
