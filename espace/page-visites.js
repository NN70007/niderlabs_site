/* Page Visites : compteur anonyme des pages publiques (administrateurs seulement ; le serveur le vérifie aussi). */
(function () {
  "use strict";
  var E = window.Espace, esc = E.esc, $ = function (s) { return document.querySelector(s); };
  var S = E.exigerConnexion(); if (!S) return;
  if (!S.user.admin) { location.replace("./"); return; }
  E.enTete({ actif: "visites" }); E.piedDePage();
  var SITES = [["aviator", "Aviator METAR Pro"], ["niderlabs", "NiderLabs"], ["boarding", "Boarding"]];
  var nb = function (x) { return Number(x || 0).toLocaleString("fr-FR"); };

  function jours(depuis, n) {
    var out = [], d = new Date(depuis + "T12:00:00");
    for (var i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
    return out;
  }
  function afficher(st) {
    var total = SITES.reduce(function (s, x) { return s + (st.parSite[x[0]] || 0); }, 0);
    var liste = jours(st.depuis, st.jours), max = 1;
    liste.forEach(function (j) { var t = 0, o = st.parJour[j] || {}; Object.keys(o).forEach(function (k) { t += o[k]; }); if (t > max) max = t; });
    var tel = st.telephone, ordi = st.ordinateur, pct = tel + ordi ? Math.round(100 * tel / (tel + ordi)) : 0;
    var h = '<div class="chiffres"><div class="carte"><b>' + nb(total) + '</b><span>pages vues</span></div>' +
      SITES.map(function (x) { return '<div class="carte"><b>' + nb(st.parSite[x[0]]) + "</b><span>" + esc(x[1]) + "</span></div>"; }).join("") +
      '<div class="carte"><b>' + pct + ' %</b><span>sur téléphone</span></div></div>';
    h += '<div class="carte"><div class="barres">' + liste.map(function (j) {
      var o = st.parJour[j] || {}, t = 0; Object.keys(o).forEach(function (k) { t += o[k]; });
      return '<div class="j" title="' + esc(j) + " : " + nb(t) + ' vues">' + SITES.map(function (x) {
        return o[x[0]] ? '<i class="s-' + x[0] + '" style="height:' + (100 * o[x[0]] / max).toFixed(1) + '%"></i>' : "";
      }).join("") + "</div>";
    }).join("") + '</div><div class="axe"><span>' + esc(liste[0]) + "</span><span>" + esc(liste[liste.length - 1]) + "</span></div>" +
      '<div class="legende">' + SITES.map(function (x) { return '<span><i class="s-' + x[0] + '"></i>' + esc(x[1]) + "</span>"; }).join("") + "</div></div>";
    h += '<div class="deux-col" style="margin-top:16px"><div class="carte"><h2 style="margin:0;padding:16px 16px 8px">Pages les plus vues</h2>' +
      (st.pages.length ? '<div class="defile"><table class="liste"><tbody>' + st.pages.map(function (p) {
        var k = p[0].split("|"); return "<tr><td>" + esc(k.slice(1).join("|")) + '</td><td class="n">' + nb(p[1]) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<div class="avis">Aucune visite sur cette période.</div>') + "</div>" +
      '<div class="carte"><h2 style="margin:0;padding:16px 16px 8px">Venus de</h2>' +
      (st.sources.length ? '<table class="liste"><tbody>' + st.sources.map(function (s) {
        return "<tr><td>" + esc(s[0]) + '</td><td class="n">' + nb(s[1]) + "</td></tr>";
      }).join("") + "</tbody></table>" : '<div class="avis">Accès direct uniquement (favori, adresse tapée, QR code).</div>') + "</div></div>";
    $("#contenu").innerHTML = h;
  }
  function charger(j) {
    $("#err").hidden = true;
    E.api("stats.visites", { jours: j }).then(afficher).catch(function (e) { $("#err").textContent = e.message || "Erreur."; $("#err").hidden = false; });
  }
  $("#periodes").addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-j]"); if (!b) return;
    [].forEach.call(document.querySelectorAll("#periodes button"), function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
    charger(Number(b.dataset.j));
  });
  charger(30);
})();
