/* Aviator METAR — fond de l'ouverture : METAR qui défilent (tiers gauche, très transparents) et champ de vent qui suit la souris. */
(function () {
  var cv = document.getElementById("fond-vent");
  if (!cv || !cv.getContext) return;
  var c = cv.getContext("2d"), W = 0, H = 0, D = 1;
  var reduit = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var TOK = ["METAR","ELLX","210750Z","04014G22KT","010V080","9999","-RA","FEW030","BKN045","12/06","Q1018","TEMPO","4000","RA","BKN012","EDDF","27008KT","CAVOK","09/03","Q1021","NOSIG","LFSB","VRB03KT","SCT025","OVC008","BR","LSGS","SPECI","R24/P1500","VV002","+TSRA","CB","EBBR","22015G28KT"];
  var sombre = function () { return !window.AVIATOR || AVIATOR.sombre === undefined ? true : (typeof AVIATOR.sombre === "function" ? AVIATOR.sombre() : !!AVIATOR.sombre); };
  var pts = [], cols = [], base = 0, visible = true, raf = 0;
  var s = { x: -999, y: -999, tx: -999, ty: -999, vx: 0, vy: 0, actif: 0, t: 0 };
  function hasard(a) { return a[Math.floor(Math.random() * a.length)]; }
  function init() {
    var r = cv.getBoundingClientRect(); D = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height; cv.width = W * D; cv.height = H * D; c.setTransform(D, 0, 0, D, 0, 0);
    pts = []; var p = W < 600 ? 40 : 46;
    for (var y = p / 2; y < H; y += p) for (var x = p / 2; x < W; x += p) pts.push({ x: x, y: y, a: -0.6, f: 0 });
    cols = []; var lim = W / 3;
    for (var cx = 14; cx < lim; cx += 92) { var k = { x: cx, y: Math.random() * 22, v: 0.25 + Math.random() * 0.35, t: [] }; for (var i = 0; i < Math.ceil(H / 22) + 4; i++) k.t.push(hasard(TOK)); cols.push(k); }
  }
  function bouge(x, y) {
    var r = cv.getBoundingClientRect(); x -= r.left; y -= r.top;
    if (s.tx > -900) { s.vx = x - s.tx; s.vy = y - s.ty; }
    s.tx = x; s.ty = y; if (s.x < -900) { s.x = x; s.y = y; } s.actif = 1; s.t = performance.now();
  }
  addEventListener("pointermove", function (e) { bouge(e.clientX, e.clientY); }, { passive: true });
  addEventListener("touchmove", function (e) { var t = e.touches[0]; if (t) bouge(t.clientX, t.clientY); }, { passive: true });
  function image() {
    var clair = !sombre();
    var bleu = clair ? "31,95,201" : "127,176,245", gris = clair ? "78,87,97" : "169,177,186", ambre = clair ? "168,100,0" : "255,178,40";
    c.clearRect(0, 0, W, H);
    s.x += (s.tx - s.x) * 0.12; s.y += (s.ty - s.y) * 0.12;
    if (performance.now() - s.t > 2500) s.actif = 0;
    if (!reduit) base += 0.004;
    var vit = Math.min(1, Math.hypot(s.vx, s.vy) / 30), dir = Math.atan2(s.vy, s.vx);
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], dx = p.x - s.x, dy = p.y - s.y, pr = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 220);
      var calme = -0.6 + Math.sin(p.x * 0.008 + p.y * 0.011 + base) * 0.45;
      var cible = pr > 0 && s.actif ? dir : calme, diff = Math.atan2(Math.sin(cible - p.a), Math.cos(cible - p.a));
      p.a += diff * (0.04 + pr * 0.25); p.f += (pr * (0.4 + vit * 0.6) - p.f) * 0.08;
      var L = 8 + p.f * 15, ca = Math.cos(p.a), sa = Math.sin(p.a), al = (0.07 + p.f * 0.8) * (clair ? 0.9 : 1);
      c.strokeStyle = "rgba(" + (p.f > 0.6 ? ambre : bleu) + "," + al.toFixed(3) + ")"; c.lineWidth = 1.1 + p.f * 1.3;
      var x2 = p.x + ca * L, y2 = p.y + sa * L;
      c.beginPath(); c.moveTo(p.x - ca * L, p.y - sa * L); c.lineTo(x2, y2);
      c.moveTo(x2, y2); c.lineTo(x2 - ca * 6 + sa * 4, y2 - sa * 6 - ca * 4); c.moveTo(x2, y2); c.lineTo(x2 - ca * 6 - sa * 4, y2 - sa * 6 + ca * 4); c.stroke();
    }
    s.vx *= 0.9; s.vy *= 0.9;
    c.font = "13px ui-monospace,Menlo,monospace"; c.textBaseline = "middle"; var lim = W / 3;
    cols.forEach(function (k) {
      if (!reduit) { k.y += k.v; if (k.y > 22) { k.y -= 22; k.t.unshift(hasard(TOK)); k.t.pop(); } }
      var fx = Math.max(0, 1 - k.x / lim) * 0.9 + 0.1;
      for (var j = 0; j < k.t.length; j++) {
        var y = k.y + j * 22 - 22; if (y < -20 || y > H + 20) continue;
        var a = 0.09 * fx * Math.max(0, Math.min(1, y / 120, (H - y) / 120)) * (clair ? 1.2 : 1);
        var dang = /G\d|TS|CB|\+|OVC00|VV/.test(k.t[j]);
        c.fillStyle = "rgba(" + (dang ? ambre : gris) + "," + (a * (dang ? 1.3 : 1)).toFixed(3) + ")";
        c.fillText(k.t[j], k.x, y);
      }
    });
  }
  function boucle() { raf = 0; if (!visible || document.hidden) return; image(); if (!reduit) raf = requestAnimationFrame(boucle); }
  function relance() { if (!raf) raf = requestAnimationFrame(boucle); }
  if ("IntersectionObserver" in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible) relance(); }).observe(cv);
  document.addEventListener("visibilitychange", relance);
  addEventListener("resize", function () { init(); relance(); });
  init(); relance();
  if (reduit) addEventListener("pointermove", function () { requestAnimationFrame(image); }, { passive: true });
})();
