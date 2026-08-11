/*
  Burger meni za javne strani FlowTiq.

  Deluje kot nadgradnja: skript na <html> postavi razred `js-nav` in samo
  takrat CSS skrije navigacijo za gumb. Če se JS ne naloži, ostane stara
  odzivna navigacija, ki se prelomi v svojo vrstico — nič se ne izgubi.

  Predpostavlja strukturo iz flowtiq-site.css:
    header.site-head > .head-inner > .head-logo + .head-nav + .head-actions
  Na straneh brez .head-nav (npr. imenik.html) se tiho ne zgodi nič.
*/
(function () {
  var doc = document;
  var glava = doc.querySelector('.site-head .head-inner');
  if (!glava) return;

  var nav = glava.querySelector('.head-nav');
  if (!nav) return;                       // imenik.html ipd. — brez navigacije
  var akcije = glava.querySelector('.head-actions');

  doc.documentElement.classList.add('js-nav');

  /* ── gumb ── */
  var gumb = doc.createElement('button');
  gumb.type = 'button';
  gumb.className = 'burger';
  gumb.setAttribute('aria-label', 'Meni');
  gumb.setAttribute('aria-expanded', 'false');
  gumb.setAttribute('aria-controls', 'ft-nav-panel');
  gumb.innerHTML = '<span></span><span></span><span></span>';

  /* ── plošča: vanjo preselimo navigacijo in podvojimo gumba ── */
  var plosca = doc.createElement('div');
  plosca.className = 'nav-panel';
  plosca.id = 'ft-nav-panel';

  glava.insertBefore(gumb, akcije || null);
  glava.appendChild(plosca);
  plosca.appendChild(nav);

  if (akcije) {
    var kopija = akcije.cloneNode(true);
    kopija.classList.add('head-actions--panel');
    plosca.appendChild(kopija);
  }

  /* ── odpiranje in zapiranje ── */
  var odprt = false;

  function nastavi(v) {
    odprt = v;
    plosca.classList.toggle('open', v);
    gumb.classList.toggle('open', v);
    gumb.setAttribute('aria-expanded', v ? 'true' : 'false');
    gumb.setAttribute('aria-label', v ? 'Zapri meni' : 'Meni');
  }

  gumb.addEventListener('click', function (e) {
    e.stopPropagation();
    nastavi(!odprt);
  });

  /* klik na povezavo v meniju zapre ploščo */
  plosca.addEventListener('click', function (e) {
    if (e.target.closest('a')) nastavi(false);
  });

  /* klik izven glave zapre ploščo */
  doc.addEventListener('click', function (e) {
    if (odprt && !glava.contains(e.target)) nastavi(false);
  });

  /* Escape zapre in vrne fokus na gumb */
  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && odprt) {
      nastavi(false);
      gumb.focus();
    }
  });

  /* ob širitvi zaslona nad prelomno točko ploščo zapremo,
     da ne ostane odprta v namizni postavitvi */
  var mq = window.matchMedia('(min-width: 921px)');
  var obSpremembi = function (e) { if (e.matches && odprt) nastavi(false); };
  if (mq.addEventListener) mq.addEventListener('change', obSpremembi);
  else if (mq.addListener) mq.addListener(obSpremembi);
})();
