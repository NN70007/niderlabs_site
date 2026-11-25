/* niderlabs.com — langue, en-tête, apparition, et la démonstration animée de l'ouverture. Aucun appel réseau. */
(function(){
  var html=document.documentElement;
  var LANGS=(html.getAttribute('data-langs')||'en fr').split(' ');
  function store(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
  function pick(l){return LANGS.indexOf(l)>=0?l:(LANGS.indexOf('en')>=0?'en':LANGS[0])}
  function setLang(l,save){
    var want=l;l=pick(l);html.lang=l;if(save)store('nl-lang',want);
    document.querySelectorAll('.lang button').forEach(function(b){b.hidden=LANGS.indexOf(b.dataset.lang)<0;b.setAttribute('aria-pressed',b.dataset.lang===l)});
  }
  var nav=((navigator.languages&&navigator.languages[0])||navigator.language||'en').slice(0,2).toLowerCase();
  setLang(store('nl-lang')||nav,false);
  document.querySelectorAll('.lang button').forEach(function(b){b.addEventListener('click',function(){setLang(b.dataset.lang,true)})});

  var head=document.querySelector('header');
  if(head){
    window.addEventListener('scroll',function(){head.classList.toggle('scrolled',window.scrollY>8)},{passive:true});
    var mb=head.querySelector('.menu-btn');
    if(mb)mb.addEventListener('click',function(){var o=head.classList.toggle('open');mb.setAttribute('aria-expanded',o)});
  }
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var IO='IntersectionObserver' in window;
  var rv=[].slice.call(document.querySelectorAll('.reveal'));
  if(rv.length){
    if(IO&&!reduce){
      var ro=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');ro.unobserve(e.target)}})},{threshold:.1});
      rv.forEach(function(r){ro.observe(r)});
    }else rv.forEach(function(r){r.classList.add('in')});
  }

  // ---- Démonstration : dictée, vérification du modèle, moniteur réseau ----
  var demo=document.getElementById('demo');
  if(!demo)return;
  var tabs=[].slice.call(demo.querySelectorAll('.tabs button')),panes=[].slice.call(demo.querySelectorAll('.pane'));
  var cur=0,auto=true,timer=0;
  function show(i){
    cur=i;
    tabs.forEach(function(t,k){t.setAttribute('aria-selected',k===i)});
    panes.forEach(function(p,k){p.hidden=k!==i});
    start[i]();
  }
  tabs.forEach(function(t,k){t.addEventListener('click',function(){auto=false;clearTimeout(timer);show(k)})});
  function next(ms){if(auto){clearTimeout(timer);timer=setTimeout(function(){show((cur+1)%3)},ms)}}
  function fit(cv){var r=cv.getBoundingClientRect(),d=Math.min(window.devicePixelRatio||1,2);cv.width=Math.max(1,r.width*d);cv.height=Math.max(1,r.height*d);var c=cv.getContext('2d');c.setTransform(d,0,0,d,0,0);return{c:c,w:r.width,h:r.height}}

  var start=[];
  // 1. Dictée
  var LINES=['Lésion de la zone périphérique classée [PI-RADS 4].','Tumeur de [Klatskin] de type IIIa de [Bismuth-Corlette].','Gonarthrose fémoro-tibiale médiale, stade 3 de [Kellgren-Lawrence].','Kyste rénal gauche classé [Bosniak IIF].'];
  var li=0,typed=document.getElementById('typed'),wave=demo.querySelector('.wave'),raf1=0;
  function render(line,n,caret){var s='',k=0,t=false;for(var i=0;i<line.length&&k<n;i++){var ch=line[i];if(ch==='['){s+='<span class="t">';t=true;continue}if(ch===']'){s+='</span>';t=false;continue}s+=ch;k++}if(t)s+='</span>';typed.innerHTML=s+(caret?'<span class="caret"></span>':'')}
  function plainLen(l){return l.replace(/[\[\]]/g,'').length}
  start[0]=function(){
    cancelAnimationFrame(raf1);
    var g=fit(wave),N=48,amp=new Array(N).fill(0),line=LINES[li],len=plainLen(line),t0=performance.now(),dur=len*45+400;
    li=(li+1)%LINES.length;
    if(reduce){render(line,999,false);next(5000);return}
    function f(now){
      var t=now-t0,p=Math.min(1,t/dur);
      g.c.clearRect(0,0,g.w,g.h);
      var gap=g.w/N,bw=Math.max(2,gap*.45),mid=g.h/2;
      for(var i=0;i<N;i++){
        var target=p<1?Math.sin(Math.PI*p)*(.25+.75*Math.abs(Math.sin(t/85+i*.6)*Math.cos(t/160-i*.33))):0;
        amp[i]+=(target-amp[i])*.25;
        var h=Math.max(1.2,amp[i]*g.h*.46);
        g.c.fillStyle='rgba(11,31,51,'+(.18+.7*Math.min(1,amp[i]*1.5)).toFixed(3)+')';
        g.c.fillRect(i*gap+(gap-bw)/2,mid-h,bw,h*2);
      }
      render(line,Math.floor(len*Math.min(1,p*1.1)),true);
      if(cur===0&&t<dur+700)raf1=requestAnimationFrame(f);
    }
    raf1=requestAnimationFrame(f);
    next(dur+2600);
  };

  // 2. Vérification du modèle
  var items=[].slice.call(demo.querySelectorAll('.checks li')),tm=[];
  start[1]=function(){
    tm.forEach(clearTimeout);tm=[];
    items.forEach(function(it){it.classList.remove('on','ok')});
    items.forEach(function(it,k){
      tm.push(setTimeout(function(){it.classList.add('on')},reduce?0:300+k*650));
      tm.push(setTimeout(function(){it.classList.add('ok')},reduce?0:650+k*650));
    });
    next(4600);
  };

  // 3. Moniteur réseau : la courbe reste à zéro
  var ncv=demo.querySelector('.net canvas'),raf3=0;
  start[2]=function(){
    cancelAnimationFrame(raf3);
    var g=fit(ncv),t0=performance.now();
    function f(now){
      var t=(now-t0)/1000;
      g.c.clearRect(0,0,g.w,g.h);
      g.c.strokeStyle='#E2E7ED';g.c.lineWidth=1;
      for(var y=1;y<4;y++){g.c.beginPath();g.c.moveTo(0,g.h*y/4);g.c.lineTo(g.w,g.h*y/4);g.c.stroke()}
      var x=reduce?g.w:Math.min(g.w,(t/3.2)*g.w);
      g.c.strokeStyle='#1F7A55';g.c.lineWidth=2;g.c.beginPath();g.c.moveTo(0,g.h-10);g.c.lineTo(x,g.h-10);g.c.stroke();
      g.c.fillStyle='#1F7A55';g.c.beginPath();g.c.arc(x,g.h-10,3.5,0,6.283);g.c.fill();
      g.c.fillStyle='#5E6F80';g.c.font='12px Schibsted, system-ui, sans-serif';g.c.fillText('0 B/s',8,16);
      if(cur===2&&x<g.w)raf3=requestAnimationFrame(f);
    }
    raf3=requestAnimationFrame(f);
    next(4200);
  };
  show(0);
})();

/* Adresses e-mail protégées : reconstituées ici, jamais écrites en clair dans les pages. */
(function () {
  function mel() {
    var e = document.querySelectorAll(".mel[data-u]"), i, a, m, s;
    for (i = 0; i < e.length; i++) {
      a = e[i]; m = a.getAttribute("data-u") + "@" + a.getAttribute("data-d");
      if (a.tagName === "A") { s = a.getAttribute("data-s"); a.setAttribute("href", "mailto:" + m + (s ? "?subject=" + s : "")); }
      if (a.hasAttribute("data-voir")) a.textContent = m;
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mel); else mel();
})();
