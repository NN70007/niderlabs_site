/* Aviator METAR — carte en points des aéroports suivis (sans service extérieur : fond calculé à partir de terre.js). */
(function () {
  "use strict";
  var T = { "1-4": 5, "5+": 8, "10+": 12 };
  function couleur(v, d) { var c = getComputedStyle(document.documentElement).getPropertyValue(v).trim(); return c || d; }
  function terre() {
    var t = window.AVIATOR_TERRE; if (!t) return null;
    if (!t.bits) { var s = atob(t.b), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); t.bits = a; }
    return t;
  }
  function estTerre(t, lon, lat) {
    var x = Math.floor((lon + 180) / t.r), y = Math.floor((90 - lat) / t.r);
    if (x < 0 || y < 0 || x >= t.w || y >= t.h) return false;
    var k = y * t.w + x; return (t.bits[k >> 3] >> (7 - (k & 7))) & 1;
  }
  function merc(lat) { var f = Math.max(-80, Math.min(80, lat)) * Math.PI / 180; return Math.log(Math.tan(Math.PI / 4 + f / 2)); }
  function inv(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI; }

  function dessiner(boite, points, opts) {
    opts = opts || {};
    var cv = boite.querySelector("canvas") || boite.appendChild(document.createElement("canvas"));
    var bulle = boite.querySelector(".bulle");
    if (!bulle && opts.bulles) { bulle = document.createElement("div"); bulle.className = "bulle"; bulle.hidden = true; boite.appendChild(bulle); }
    var t = terre(), dpr = window.devicePixelRatio || 1, anim = null, pos = [];
    function cadre(W, H) {
      var lo0 = -12, lo1 = 32, la0 = 34, la1 = 62;
      if (points.length) {
        lo0 = 180; lo1 = -180; la0 = 90; la1 = -90;
        points.forEach(function (p) { lo0 = Math.min(lo0, p.lon); lo1 = Math.max(lo1, p.lon); la0 = Math.min(la0, p.lat); la1 = Math.max(la1, p.lat); });
        var cl = (lo0 + lo1) / 2, cb = (la0 + la1) / 2, dl = Math.max(lo1 - lo0, 36) * 1.25, db = Math.max(la1 - la0, 20) * 1.25;
        lo0 = cl - dl / 2; lo1 = cl + dl / 2; la0 = Math.max(-70, cb - db / 2); la1 = Math.min(78, cb + db / 2);
      }
      var x0 = lo0, x1 = lo1, y0 = merc(la0), y1 = merc(la1);
      // garder les proportions : élargir l'axe trop court
      var kx = W / (x1 - x0), ky = H / ((y1 - y0) * 180 / Math.PI);
      if (kx > ky) { var e = (W / ky - (x1 - x0)) / 2; x0 -= e; x1 += e; }
      else { var m = ((H / kx) * Math.PI / 180 - (y1 - y0)) / 2; y0 -= m; y1 += m; }
      return { x0: x0, x1: x1, y0: y0, y1: y1 };
    }
    function trace() {
      var W = boite.clientWidth, H = boite.clientHeight; if (!W || !H) return;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
      var c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      var f = cadre(W, H), sx = W / (f.x1 - f.x0), sy = H / (f.y1 - f.y0);
      var fond = document.createElement("canvas"); fond.width = cv.width; fond.height = cv.height;
      var g = fond.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = couleur("--encre-3", "#9AA6B6"); g.globalAlpha = 0.32;
      var pas = W < 600 ? 6 : 7.5;
      if (t) for (var y = pas / 2; y < H; y += pas) {
        var lat = inv(f.y1 - y / sy);
        for (var x = pas / 2; x < W; x += pas) {
          var lon = f.x0 + x / sx; lon = ((lon + 540) % 360) - 180;
          if (estTerre(t, lon, lat)) { g.beginPath(); g.arc(x, y, pas * 0.2, 0, 6.2832); g.fill(); }
        }
      }
      pos = points.map(function (p) { return { p: p, x: (p.lon - f.x0) * sx, y: (f.y1 - merc(p.lat)) * sy, r: T[p.t] || 5 }; });
      var acc = couleur("--ciel", "#8CC0F2"), t0 = performance.now(), calme = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (anim) cancelAnimationFrame(anim);
      function image(now) {
        c.clearRect(0, 0, W, H); c.drawImage(fond, 0, 0, W, H);
        var ph = calme ? 0.5 : ((now - t0) / 2400) % 1;
        pos.forEach(function (q, i) {
          var k = calme ? 0.5 : (ph + i * 0.17) % 1;
          c.globalAlpha = 0.5 * (1 - k); c.strokeStyle = acc; c.lineWidth = 1.5;
          c.beginPath(); c.arc(q.x, q.y, q.r + 4 + k * 18, 0, 6.2832); c.stroke();
          var gr = c.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r * 2.6);
          gr.addColorStop(0, acc); gr.addColorStop(1, "rgba(0,0,0,0)");
          c.globalAlpha = 0.35; c.fillStyle = gr; c.beginPath(); c.arc(q.x, q.y, q.r * 2.6, 0, 6.2832); c.fill();
          c.globalAlpha = 1; c.fillStyle = acc; c.beginPath(); c.arc(q.x, q.y, q.r * 0.55, 0, 6.2832); c.fill();
        });
        c.globalAlpha = 1;
        if (!calme) anim = requestAnimationFrame(image);
      }
      anim = requestAnimationFrame(image);
    }
    if (bulle) {
      cv.addEventListener("mousemove", function (e) {
        var r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, best = null, d = 400;
        pos.forEach(function (q) { var dd = (q.x - mx) * (q.x - mx) + (q.y - my) * (q.y - my); if (dd < d) { d = dd; best = q; } });
        if (!best) { bulle.hidden = true; return; }
        bulle.innerHTML = "<b>" + best.p.icao + "</b> " + (best.p.nom || "") + "<span>" + (best.p.t === "1-4" ? "1–4" : best.p.t) + " pilots</span>";
        bulle.style.left = best.x + "px"; bulle.style.top = best.y + "px"; bulle.hidden = false;
      });
      cv.addEventListener("mouseleave", function () { bulle.hidden = true; });
    }
    trace();
    var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(trace, 150); });
    document.addEventListener("aviator-theme", trace);
  }

  window.AVIATOR_CARTE = function (boite, opts) {
    var total = opts && opts.total;
    AVIATOR.appel({ action: "aviator.carte" }).then(function (o) {
      dessiner(boite, o.points || [], opts);
      if (total) total.textContent = (o.points || []).length + ((o.points || []).length === 1 ? " airport" : " airports");
    }).catch(function (x) { dessiner(boite, [], opts); if (total) total.textContent = x.message; });
  };
})();
