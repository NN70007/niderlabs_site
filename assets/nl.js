/* niderlabs.com — langue, en-tête, apparition, et le tracé de mesure de l'ouverture. Aucun appel réseau. */
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
  var rv=[].slice.call(document.querySelectorAll('.reveal'));
  if(rv.length){
    if('IntersectionObserver' in window&&!reduce){
      var ro=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');ro.unobserve(e.target)}})},{threshold:.1});
      rv.forEach(function(r){ro.observe(r)});
    }else rv.forEach(function(r){r.classList.add('in')});
  }

  // Tracé : une courbe de mesure qui descend, dessinée une seule fois à l'ouverture.
  var svg=document.querySelector('.trace');
  if(!svg)return;
  var D=[12.1,11.0,10.0,10.0,9.4,9.8,9.0,8.8,9.5,9.2,8.7,8.8,8.3,7.7,7.0,7.3,6.8,6.2,5.7,5.8,4.5,4.4];
  function build(anim){
    var r=svg.getBoundingClientRect(),W=r.width,H=r.height;
    svg.setAttribute('viewBox','0 0 '+W+' '+H);
    var x0=W*(W<760?.05:.68),x1=W*.97,y0=H*(W<760?.8:.42),y1=H*(W<760?.97:.9),mx=12.1,mn=4.4,pts=[];
    for(var i=0;i<D.length;i++){
      var x=x0+(x1-x0)*i/(D.length-1),y=y0+(y1-y0)*(mx-D[i])/(mx-mn);
      pts.push([x,y]);
    }
    var d='M'+pts[0][0].toFixed(1)+' '+pts[0][1].toFixed(1);
    for(var j=1;j<pts.length;j++)d+=' L'+pts[j][0].toFixed(1)+' '+pts[j][1].toFixed(1);
    svg.innerHTML='<path d="'+d+'"/><circle r="4" cx="'+pts[pts.length-1][0].toFixed(1)+'" cy="'+pts[pts.length-1][1].toFixed(1)+'"/>';
    var p=svg.querySelector('path'),c=svg.querySelector('circle'),L=p.getTotalLength();
    if(reduce||!anim)return;
    p.style.strokeDasharray=L;p.style.strokeDashoffset=L;c.style.opacity=0;
    p.getBoundingClientRect();
    p.style.transition='stroke-dashoffset 2.6s cubic-bezier(.4,.1,.2,1) .35s';p.style.strokeDashoffset=0;
    c.style.transition='opacity .4s 2.9s';c.style.opacity=1;
  }
  build(true);
  var t;window.addEventListener('resize',function(){clearTimeout(t);t=setTimeout(function(){build(false)},200)});
})();
