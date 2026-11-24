/* Compteur de visites anonyme de niderlabs.com.
   Envoie seulement : l'adresse de la page, « téléphone » ou « ordinateur », et le nom du site d'où l'on vient.
   Ni cookie, ni stockage dans le navigateur, ni identifiant. Les robots et les pages jamais affichées ne comptent pas. */
(function () {
  "use strict";
  try {
    if (location.hostname !== "niderlabs.com" || navigator.webdriver) return;
    var API = "https://script.google.com/macros/s/AKfycbwjfALtYam9glF9Rb9pF_5IuImyFI4tler3PUiHPXBy5L3GOR-hItwuS33eI2wRHUQiAg/exec";
    var src = "";
    try { if (document.referrer) { var h = new URL(document.referrer).hostname; if (h !== location.hostname) src = h; } } catch (e) { /* adresse illisible */ }
    var tel = window.matchMedia && matchMedia("(pointer: coarse)").matches;
    var corps = JSON.stringify({ action: "visite", p: location.pathname, m: tel ? "t" : "o", s: src });
    var envoyer = function () {
      try { fetch(API, { method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain" }, body: corps }).catch(function () {}); } catch (e) { /* hors ligne */ }
    };
    var plusTard = function () { setTimeout(envoyer, 800); };
    if (document.visibilityState === "visible") plusTard();
    else document.addEventListener("visibilitychange", function attendre() {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", attendre); plusTard();
    });
  } catch (e) { /* jamais d'erreur visible pour le visiteur */ }
})();
