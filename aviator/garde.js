/* Accès réservé : les pages niderlabs.com/aviator servent au test ; le public est orienté vers l'éditeur (GOKYO).
   Simple rideau côté navigateur (pas une protection forte) : le code n'est pas écrit ici, seulement son empreinte. */
(function () {
  "use strict";
  var EMPREINTE = "9adac0073ce3645eac080412479b68f3db04c14fafdb9ef8b9d093b6669e3541", CLE = "aviator-acces";
  try { if (localStorage.getItem(CLE) === EMPREINTE) return; } catch (e) { /* stockage indisponible : on demande le code */ }
  var codeMontre = (location.search.match(/[?&]c=(\d{6})/) || [])[1];   // lu tout de suite : la page peut retirer ?c= ensuite
  var cache = document.createElement("style");
  cache.textContent = "body>*:not(#garde){display:none!important}#garde{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:28px 20px;text-align:center;background:#0B0F14;color:#E8ECF1;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif}#garde h1{font-size:22px;font-weight:600;margin:0;letter-spacing:.02em}#garde h1 b{color:#6EA5F0;font-weight:600}#garde p{margin:0;font-size:16px;line-height:1.6;color:#969FAA;max-width:420px}#garde a{color:#6EA5F0}#garde .aller{display:inline-block;padding:14px 26px;border-radius:999px;background:#F5F5F2;color:#0B0F14;font-weight:600;text-decoration:none;font-size:16px}#garde form{display:flex;gap:10px;margin-top:26px}#garde input{width:120px;padding:12px 14px;border-radius:12px;border:1px solid #2A3340;background:#121820;color:#E8ECF1;font-size:18px;text-align:center;letter-spacing:.3em}#garde button{padding:12px 18px;border-radius:12px;border:1px solid #2A3340;background:transparent;color:#E8ECF1;font-size:15px;cursor:pointer}#garde small{color:#6E737C;font-size:13px}#garde .non{color:#F0463C;min-height:18px;font-size:14px}";
  document.documentElement.appendChild(cache);
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (o) { return ("0" + o.toString(16)).slice(-2); }).join(""); }
  function monter() {
    if (document.getElementById("garde")) return;
    var g = document.createElement("div"); g.id = "garde";
    g.innerHTML = '<h1><b>CROSSWIND</b> METAR</h1>' +
      '<p>Crosswind METAR is published by GOKYO. The watch face, its settings and its support are now here:</p>' +
      '<a class="aller" href="https://watch.gokyo.lu/crosswind/">watch.gokyo.lu/crosswind</a>' +
      '<form><input id="garde-code" type="password" inputmode="numeric" autocomplete="off" maxlength="8" aria-label="Access code"><button type="submit">Enter</button></form>' +
      '<small>Test access</small><div class="non" role="alert"></div>';
    document.body.insertBefore(g, document.body.firstChild);
    if (codeMontre) g.querySelector(".aller").href = "https://watch.gokyo.lu/crosswind/?c=" + codeMontre;
    g.querySelector("form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = g.querySelector("#garde-code").value.trim();
      crypto.subtle.digest("SHA-256", new TextEncoder().encode("aviator:" + v)).then(function (h) {
        if (hex(h) === EMPREINTE) { try { localStorage.setItem(CLE, EMPREINTE); } catch (e) { /* session seulement */ } g.remove(); cache.remove(); }
        else { g.querySelector(".non").textContent = "Wrong code."; }
      });
    });
  }
  if (document.body) monter(); else document.addEventListener("DOMContentLoaded", monter);
})();
