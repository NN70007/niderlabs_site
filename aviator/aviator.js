/* Aviator METAR — page de réglages : code de la montre → réglages → enregistrement. */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var jeton = null, reglages = null;
  var ROLES = ["AIRPORT 1 · DEPARTURE", "AIRPORT 2 · DESTINATION", "AIRPORT 3 · ALTERNATE"];
  var SUF = ["", "2", "3"];
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function msg(el, txt, ok) { el.textContent = txt; el.className = "message " + (ok ? "ok" : "err"); el.hidden = !txt; }

  // Le code se tape avec un espace au milieu : « 482 917 »
  $("#code").addEventListener("input", function (e) {
    var d = e.target.value.replace(/\D/g, "").slice(0, 6);
    e.target.value = d.length > 3 ? d.slice(0, 3) + " " + d.slice(3) : d;
  });

  $("#form-code").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("#code").value.replace(/\D/g, ""), b = e.target.querySelector("button"), err = $("#err-code");
    if (code.length !== 6) { msg(err, "Enter the 6 digits shown on your watch.", false); return; }
    b.disabled = true; b.textContent = "Checking…"; err.hidden = true;
    AVIATOR.appel({ action: "aviator.ouvrir", code: code }).then(function (o) {
      jeton = o.jeton; reglages = o.reglages;
      afficher(o);
    }).catch(function (x) { msg(err, x.message, false); })
      .then(function () { b.disabled = false; b.textContent = "Open my settings"; });
  });

  function afficher(o) {
    var r = o.reglages, box = $("#aeroports");
    box.innerHTML = "";
    SUF.forEach(function (s, i) {
      var d = document.createElement("div");
      d.className = "carte";
      d.innerHTML = '<label class="titre" for="icao' + i + '">' + ROLES[i] + '</label>' +
        '<input class="icao" id="icao' + i + '" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="' + (i ? "—" : "ELLX") + '" value="' + esc(r["icao" + s] || "") + '">' +
        '<div class="nom-apt" id="nom' + i + '"></div>' +
        '<label class="titre" for="rwy' + i + '">RUNWAY</label>' +
        '<select id="rwy' + i + '"><option value="0">AUTO (into wind)</option></select>';
      box.appendChild(d);
      var inp = d.querySelector("input");
      var lancer = function () { pistes(i, inp.value, Number($("#rwy" + i).value) || r["rwy" + s] || 0); };
      inp.addEventListener("input", function () { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); if (inp.value.length === 4 || !inp.value) lancer(); });
      pistes(i, r["icao" + s], r["rwy" + s] || 0);
    });
    $("#gps").checked = !!r.gps;
    $("#xwLim").value = r.xwLim;
    $("#magVar").value = r.magVar;
    ["pUnit", "wUnit", "dateFmt"].forEach(function (k) { var x = document.querySelector('input[name="' + k + '"][value="' + (r[k] || 0) + '"]'); if (x) x.checked = true; });
    majUnite();
    $("#carte").checked = o.carte !== false;
    $("#accepte").checked = false;
    $("#vue-code").hidden = true; $("#vue-reglages").hidden = false; $("#lie").hidden = false;
    $("#msg").hidden = true;
    window.scrollTo(0, 0);
  }

  // Nom de l'aéroport et liste des pistes (extrémités) depuis le serveur
  var demandes = {};
  function pistes(i, icao, choisi) {
    var sel = $("#rwy" + i), nom = $("#nom" + i);
    icao = String(icao || "").toUpperCase();
    sel.innerHTML = '<option value="0">AUTO (into wind)</option>';
    if (choisi) sel.innerHTML += '<option value="' + choisi + '">' + pad(choisi) + "</option>";
    sel.value = String(choisi || 0);
    if (icao.length !== 4) { nom.textContent = ""; return; }
    nom.textContent = "…";
    var n = (demandes[i] = (demandes[i] || 0) + 1);
    AVIATOR.appel({ action: "aviator.aeroport", icao: icao }).then(function (a) {
      if (n !== demandes[i]) return;
      if (!a.trouve) { nom.textContent = "Unknown airport – check the code"; return; }
      nom.textContent = a.nom || "";
      var html = '<option value="0">AUTO (into wind)</option>';
      a.pistes.slice().sort(function (x, y) { return x - y; }).forEach(function (p) { html += '<option value="' + p + '">' + pad(p) + (p === choisi ? "" : "") + "</option>"; });
      if (choisi && a.pistes.indexOf(choisi) < 0) html += '<option value="' + choisi + '">' + pad(choisi) + "</option>";
      sel.innerHTML = html; sel.value = String(choisi || 0);
    }).catch(function () { if (n === demandes[i]) nom.textContent = ""; });
  }

  function majUnite() { var m = document.querySelector('input[name="wUnit"]:checked'); $("#xw-unite").textContent = m && m.value === "1" ? "m/s" : "kt"; }
  document.querySelectorAll('input[name="wUnit"]').forEach(function (x) { x.addEventListener("change", majUnite); });

  $("#vue-reglages").addEventListener("submit", function (e) {
    e.preventDefault();
    var m = $("#msg"), b = $("#enregistrer");
    if (!$("#accepte").checked) { msg(m, "Please tick the box to accept the Terms of Use and the NOT FOR NAVIGATION notice.", false); $("#accepte").focus(); return; }
    var val = function (k) { var x = document.querySelector('input[name="' + k + '"]:checked'); return x ? Number(x.value) : 0; };
    var s = {
      icao: $("#icao0").value.trim(), rwy: Number($("#rwy0").value) || 0,
      icao2: $("#icao1").value.trim(), rwy2: Number($("#rwy1").value) || 0,
      icao3: $("#icao2").value.trim(), rwy3: Number($("#rwy2").value) || 0,
      gps: $("#gps").checked, xwLim: Number($("#xwLim").value.replace(/\D/g, "") || 0),
      pUnit: val("pUnit"), wUnit: val("wUnit"), dateFmt: val("dateFmt"),
      magVar: Number(String($("#magVar").value).replace("−", "-").replace(/[^\d-]/g, "") || 0),
      carte: $("#carte").checked
    };
    if (!/^[A-Za-z0-9]{4}$/.test(s.icao)) { msg(m, "Airport 1 needs a 4-letter ICAO code (e.g. ELLX).", false); return; }
    b.disabled = true; b.textContent = "Saving…";
    AVIATOR.appel({ action: "aviator.enregistrer", jeton: jeton, reglages: s, accepte: true }).then(function () {
      msg(m, "Saved. Your watch picks up the new settings within about 15 minutes, as long as your phone is connected.", true);
    }).catch(function (x) {
      if (x.code === "session") { msg(m, x.message, false); setTimeout(function () { location.reload(); }, 2500); }
      else msg(m, x.message, false);
    }).then(function () { b.disabled = false; b.textContent = "Save to my watch"; m.scrollIntoView({ block: "center" }); });
  });

  $("#quitter").addEventListener("click", function () { jeton = null; });
})();
