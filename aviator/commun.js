/* Aviator METAR — commun aux pages : thème jour/nuit et appel du serveur (Apps Script). */
(function () {
  "use strict";
  var API = "https://script.google.com/macros/s/AKfycbwjfALtYam9glF9Rb9pF_5IuImyFI4tler3PUiHPXBy5L3GOR-hItwuS33eI2wRHUQiAg/exec";
  var root = document.documentElement;
  function lire(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function ecrire(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* navigation privée */ } }
  var t = lire("aviator-theme");
  if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
  function sombre() {
    var f = root.getAttribute("data-theme");
    return f ? f === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
  }
  document.addEventListener("DOMContentLoaded", function () {
    var b = document.querySelector(".theme");
    if (b) {
      var maj = function () { b.textContent = sombre() ? "Day mode" : "Night mode"; };
      maj();
      b.addEventListener("click", function () {
        var n = sombre() ? "light" : "dark";
        root.setAttribute("data-theme", n); ecrire("aviator-theme", n); maj();
        document.dispatchEvent(new Event("aviator-theme"));
      });
    }
    var an = document.querySelector("[data-annee]");
    if (an) an.textContent = new Date().getFullYear();
  });
  window.AVIATOR = {
    sombre: sombre,
    appel: function (corps) {
      return fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(corps), redirect: "follow" })
        .catch(function () { throw { message: "Cannot reach the server. Check your internet connection.", code: "reseau" }; })
        .then(function (r) { return r.json().catch(function () { throw { message: "Unexpected server response. Please try again.", code: "serveur" }; }); })
        .then(function (o) { if (!o.ok) throw { message: o.error || "Error.", code: o.code }; return o; });
    }
  };
})();
