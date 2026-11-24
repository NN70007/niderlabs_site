/* Aviator METAR — fond de l'ouverture : METAR qui défilent (tiers gauche, très transparents) et champ de vent qui suit la souris. */
(function () {
  var cv = document.getElementById("fond-vent");
  if (!cv || !cv.getContext) return;
  var c = cv.getContext("2d"), W = 0, H = 0, D = 1;
  var reduit = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var TOK = ["METAR","ELLX","210750Z","04014G22KT","010V080","9999","-RA","FEW030","BKN045","12/06","Q1018","TEMPO","4000","RA","BKN012","EDDF","27008KT","CAVOK","09/03","Q1021","NOSIG","LFSB","VRB03KT","SCT025","OVC008","BR","LSGS","SPECI","R24/P1500","VV002","+TSRA","CB","EBBR","22015G28KT"];
  var sombre = function () { return !window.AVIATOR || AVIATOR.sombre === undefined ? true : (typeof AVIATOR.sombre === "function" ? AVIATOR.sombre() : !!AVIATOR.sombre); };
  var pts = [], cols = [], base = 0, visible = true, raf = 0, der = 0, pret = false;
  var s = { x: -999, y: -999, tx: -999, ty: -999, vx: 0, vy: 0, actif: 0, t: 0 };
  function hasard(a) { return a[Math.floor(Math.random() * a.length)]; }
  function init() {
    var r = cv.getBoundingClientRect(); D = Math.min(window.devicePixelRatio || 1, 1.5); // plus fin ne se voit pas sur ces traits très transparents
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
  function image(m) { // m = nombre d'images « 60 par seconde » que représente celle-ci (2 à 30 i/s)
    m = m > 0 ? Math.min(m, 4) : 1;
    var clair = !sombre();
    var bleu = clair ? "31,95,201" : "127,176,245", gris = clair ? "78,87,97" : "169,177,186", ambre = clair ? "168,100,0" : "255,178,40";
    c.clearRect(0, 0, W, H);
    var l12 = 1 - Math.pow(0.88, m); s.x += (s.tx - s.x) * l12; s.y += (s.ty - s.y) * l12;
    if (performance.now() - s.t > 2500) s.actif = 0;
    var vit = Math.min(1, Math.hypot(s.vx, s.vy) / 30), dir = Math.atan2(s.vy, s.vx);
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], dx = p.x - s.x, dy = p.y - s.y, pr = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / 220);
      var calme = -0.6 + Math.sin(p.x * 0.008 + p.y * 0.011 + base) * 0.45;
      var cible = pr > 0 && s.actif ? dir : calme, diff = Math.atan2(Math.sin(cible - p.a), Math.cos(cible - p.a));
      p.a += diff * (1 - Math.pow(1 - (0.04 + pr * 0.25), m)); p.f += (pr * (0.4 + vit * 0.6) - p.f) * (1 - Math.pow(0.92, m));
      var L = 8 + p.f * 15, ca = Math.cos(p.a), sa = Math.sin(p.a), al = (0.07 + p.f * 0.8) * (clair ? 0.9 : 1);
      c.strokeStyle = "rgba(" + (p.f > 0.6 ? ambre : bleu) + "," + al.toFixed(3) + ")"; c.lineWidth = 1.1 + p.f * 1.3;
      var x2 = p.x + ca * L, y2 = p.y + sa * L;
      c.beginPath(); c.moveTo(p.x - ca * L, p.y - sa * L); c.lineTo(x2, y2);
      c.moveTo(x2, y2); c.lineTo(x2 - ca * 6 + sa * 4, y2 - sa * 6 - ca * 4); c.moveTo(x2, y2); c.lineTo(x2 - ca * 6 - sa * 4, y2 - sa * 6 + ca * 4); c.stroke();
    }
    var am = Math.pow(0.9, m); s.vx *= am; s.vy *= am;
    c.font = "13px ui-monospace,Menlo,monospace"; c.textBaseline = "middle"; var lim = W / 3;
    cols.forEach(function (k) {
      if (!reduit) { k.y += k.v * m; while (k.y > 22) { k.y -= 22; k.t.unshift(hasard(TOK)); k.t.pop(); } }
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
  // 30 images par seconde suffisent (le mouvement est lent) : deux fois moins de travail pour le processeur
  function boucle(now) {
    raf = 0; if (!visible || document.hidden) return;
    if (!now || !der || now - der >= (s.actif ? 32 : 48)) { /* 30 i/s quand la souris bouge, 20 i/s au repos */ var m = der && now ? (now - der) / 16.67 : 1; der = now || 0; if (!reduit) base += 0.004 * Math.min(m, 4); image(m); }
    if (!reduit) raf = requestAnimationFrame(boucle);
  }
  function relance() { if (pret && !raf) raf = requestAnimationFrame(boucle); }
  if ("IntersectionObserver" in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible) relance(); }).observe(cv);
  document.addEventListener("visibilitychange", relance);
  addEventListener("resize", function () { init(); relance(); });
  // l'animation démarre une fois la page affichée et chargée, pour ne pas retarder le premier affichage
  function demarre() { pret = true; init(); relance(); }
  if (document.readyState === "complete") setTimeout(demarre, 0);
  else addEventListener("load", function () { setTimeout(demarre, 0); });
  if (reduit) addEventListener("pointermove", function () { requestAnimationFrame(function () { image(1); }); }, { passive: true });
})();
