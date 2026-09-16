/*
  Skupni skript javnih strani FlowTek:
  burger meni + lebdeči WhatsApp gumb + preklopnik mesečno/letno.

  ── 1. Burger meni ──

  Deluje kot nadgradnja: skript na <html> postavi razred `js-nav` in samo
  takrat CSS skrije navigacijo za gumb. Če se JS ne naloži, ostane stara
  odzivna navigacija, ki se prelomi v svojo vrstico — nič se ne izgubi.

  Predpostavlja strukturo iz flowtek-site.css:
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

/*
  ── 2. Lebdeči WhatsApp gumb ──

  Glavna storitev FlowTek teče na WhatsAppu, zato mora biti stik na klik
  z vsake javne strani. Gumb vstavi skript in ne markup, da ostane na enem
  mestu; brez JS ostanejo povezave na WhatsApp v nogi in na /kontakt.html.

  Izjema je imenik.html — tam obiskovalec naroča pri lokalu in bi ga
  drugi WhatsApp gumb, ki pelje na FlowTek, samo zmedel.
*/
(function () {
  var doc = document;
  if (doc.querySelector('.wa-fab')) return;                  // že vstavljen
  if (/\/imenik(\.html)?$/.test(location.pathname)) return;   // glej opombo zgoraj

  var POVEZAVA = 'https://wa.me/38669323846'
    + '?text=Pozdravljeni%2C%20zanima%20me%20FlowTek%20za%20moje%20podjetje.';

  var a = doc.createElement('a');
  a.className = 'wa-fab';
  a.href = POVEZAVA;
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', 'Pišite nam na WhatsApp — 069 323 846');
  a.title = 'Pišite nam na WhatsApp';
  a.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">'
    + '<path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.97L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 8.24 8.24c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.09-.17.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.84-.2-.49-.41-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.57.13.16 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.14.16 1.57.1.48-.07 1.48-.6 1.69-1.19.21-.58.21-1.08.15-1.19-.06-.11-.23-.18-.48-.3Z"/>'
    + '</svg><span>Pišite nam</span>';

  /* Vstopno animacijo (kratek zamik + zatemnitev) opravi CSS, da gumb
     ni odvisen od časovnika in se pokaže tudi, če se skript zatakne. */
  doc.body.appendChild(a);
})();

/*
  ── 3. Preklopnik mesečno / letno ──

  Uporabljata ga cenik.html in naslovnica; na straneh brez .obd-switch se
  tiho ne zgodi nič.

  Cene bere z /api/plans, kjer jih strežnik servira iz src/plans.js — istega
  vira, iz katerega nastanejo cene na Stripu in zneski na predračunu. Če klic
  pade, ostanejo številke, ki so v HTML-u že napisane; stran je uporabna tudi
  povsem brez JS, saj sta takrat vidni obe (mesečna cena in letna vrstica).

  Preklopnikov je lahko na strani več (npr. nad karticami in v primerjavi) —
  vsi držijo isto stanje.
*/
(function () {
  var doc = document;
  var preklopniki = Array.prototype.slice.call(doc.querySelectorAll('.obd-switch'));
  if (!preklopniki.length) return;

  var korenina = doc.documentElement;
  // useGrouping: true — sl-SI privzeto ne skupinja štirimestnih števil (1343,88 -> 1.343,88)
  var eur = function (n) {
    return Number(n).toLocaleString('sl-SI', { useGrouping: true, minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  };
  // Cele cene pišemo brez decimalk (89 €, ne 89,00 €) — kot doslej na strani.
  var eurKratko = function (n) {
    return Number(n) % 1 === 0
      ? Number(n).toLocaleString('sl-SI', { useGrouping: true }) + ' €'
      : eur(n);
  };

  var cene = null;

  function izpisi(obdobje) {
    korenina.classList.toggle('obd-monthly', obdobje === 'monthly');
    korenina.classList.toggle('obd-yearly', obdobje === 'yearly');

    preklopniki.forEach(function (p) {
      Array.prototype.forEach.call(p.querySelectorAll('.obd-btn'), function (b) {
        var on = b.getAttribute('data-obd') === obdobje;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });

    if (!cene) return;
    Array.prototype.forEach.call(doc.querySelectorAll('[data-cena]'), function (n) {
      var p = cene[n.getAttribute('data-cena')];
      if (!p) return;
      n.textContent = obdobje === 'yearly' ? eur(p.monthly_equivalent) : eurKratko(p.month);
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-letno]'), function (n) {
      var p = cene[n.getAttribute('data-letno')];
      if (!p) return;
      n.textContent = eur(p.year) + ' enkratno za 12 mesecev · prihranek ' + eur(p.saving);
    });
  }

  korenina.classList.add('js-obd');
  izpisi('monthly');

  preklopniki.forEach(function (p) {
    p.addEventListener('click', function (e) {
      var b = e.target.closest('.obd-btn');
      if (b) izpisi(b.getAttribute('data-obd'));
    });
  });

  fetch('/api/plans').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !d.plans) return;
    cene = {};
    d.plans.forEach(function (p) { cene[p.id] = p; });
    izpisi(korenina.classList.contains('obd-yearly') ? 'yearly' : 'monthly');
  }).catch(function () { /* tiho — ostanejo številke iz HTML-a */ });
})();

/*
  ── 4. Merjenje klikov na WhatsApp ──

  GA4 brez kode zna sprožati samo page_view in form_submit, zato klika na
  wa.me ne vidi. Tu je ena sama delegirana poslušalka za vse povezave na vseh
  straneh — brez kopije v vsaki datoteki in brez atributa na vsaki povezavi.

  KAJ TA DOGODEK JE IN KAJ NI

    Meri klik na NAŠI strani. Ali je človek v WhatsAppu res napisal sporočilo,
    od tu ni vidno in ne bo — to je meja merjenja, ne napaka v postavitvi.
    wa_click zato NI konverzija, ampak izkazano zanimanje.

  Klik ne čaka na GA: dogodek pošljemo prek beacona, navigacije ne zadržujemo,
  napaka pri merjenju pa ne sme ustaviti odpiranja povezave.
*/
(function () {
  var doc = document;

  /*
    Merimo SAMO svoji dve številki.

    imenik.html in restavracije.html sestavljata povezave na wa.me s
    številkami POSAMEZNIH LOKALOV. Klik tam pomeni "gost naroči pico pri
    Botani" in ne "interesent piše FlowTeku". Če bi oboje padlo v isti
    dogodek, bi wa_click čez mesec dni pomenil dve različni stvari hkrati —
    in prav to bi ga naredilo neuporabnega.
  */
  var NASE = { '38669323814': 'demo', '38669323846': 'podpora' };

  // "/" -> index, "/vodic.html" -> vodic, "/panoga/restavracije.html" -> panoga-restavracije
  function stranSlug() {
    var p = location.pathname.replace(/\.html$/, '').replace(/^\/+/, '').replace(/\/+$/, '');
    return p ? p.replace(/\//g, '-') : 'index';
  }

  function kje(a) {
    if (a.getAttribute('data-wa')) return a.getAttribute('data-wa');   // izrecno ime
    if (a.classList.contains('wa-fab')) return 'plavajoci';
    if (a.closest('footer')) return 'noga';
    return stranSlug() + '-vsebina';
  }

  /*
    Zajem (capture) je namenoma: dogodek ujamemo tudi, če ga kdo nižje ustavi.
    Povezave nikoli ne prestrezemo — brez preventDefault, brez čakanja.
  */
  doc.addEventListener('click', function (e) {
    var cilj = e.target;
    if (!cilj || typeof cilj.closest !== 'function') return;
    var a = cilj.closest('a[href*="wa.me/"]');
    if (!a) return;
    if (typeof gtag !== 'function') return;          // GA ni naložen — klik gre naprej

    var stevilka = (a.getAttribute('href').match(/wa\.me\/(\d+)/) || [, ''])[1];
    var vrsta = NASE[stevilka];
    if (!vrsta) return;            // številka lokala iz imenika — ni naš dogodek

    try {
      gtag('event', 'wa_click', {
        kje: kje(a),
        stevilka: stevilka,
        // 814 je testna picerija (prikaz), 846 podpora — namen klika je drugačen.
        vrsta: vrsta,
        transport_type: 'beacon'
      });
    } catch (err) { /* merjenje ne sme ovirati klika */ }
  }, true);
})();

/*
  ── 5. Meta pixel ──

  Kot pri wa_click: ena sama koda za vse strani, brez kopije v vsaki datoteki.

  ZAKAJ JE SPLOH TU

    Brez pixla Meta ne vidi konverzij. Kampanja lahko optimizira samo za klike
    ali doseg, remarketinga ni in v poročilu ni videti, kateri oglas je
    pripeljal prijavo. Pri isti porabi je to bistveno slabši rezultat.

  DVE DOGODKI IN NIČ VEČ

    PageView   vsaka javna stran
    Lead       samo tam, kjer je človek res nekaj oddal — /vodic-hvala.html
               in uspešna oddaja kontaktnega obrazca

    Lead namenoma NI na klik na WhatsApp. Klik je izkazano zanimanje, ne
    konverzija; če bi bilo oboje isti dogodek, bi se Meta učila na napačnem
    signalu in bi optimizirala za tisto, kar ne prinese stranke.

  PRIVOLITEV

    Pixel je oglaševalsko sledenje in v EU praviloma zahteva privolitev pred
    proženjem. Pasu za privolitev stran (še) nima, zato je stikalo spodaj
    nastavljeno na false in pixel se sproži takoj. Ko bo pas postavljen, se
    prestavi na true in ftDovoliSledenje() se pokliče šele ob privolitvi —
    drugod v kodi ni treba spremeniti ničesar.
*/
(function () {
  var PIXEL = '2251955875346046';
  var ZAHTEVA_PRIVOLITEV = false;

  var vrsta = [];          // dogodki, ki čakajo na privolitev
  var dovoljeno = !ZAHTEVA_PRIVOLITEV;
  var nalozen = false;

  function nalozi() {
    if (nalozen) return;
    nalozen = true;
    /* Metina standardna koda; vstavimo jo šele, ko smemo. */
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    window.fbq('init', PIXEL);
    window.fbq('track', 'PageView');
  }

  /* Edina pot do pixla iz ostale kode. Pred privolitvijo dogodke shrani. */
  window.ftSledi = function (dogodek, podatki) {
    if (!dovoljeno) { vrsta.push([dogodek, podatki]); return; }
    nalozi();
    try { window.fbq('track', dogodek, podatki || {}); } catch (e) { /* merjenje ne sme ovirati strani */ }
  };

  /* Pokliče se ob privolitvi; sprosti vse, kar je čakalo. */
  window.ftDovoliSledenje = function () {
    if (dovoljeno) return;
    dovoljeno = true;
    nalozi();
    vrsta.splice(0).forEach(function (d) {
      try { window.fbq('track', d[0], d[1] || {}); } catch (e) { /* tiho */ }
    });
  };

  if (dovoljeno) nalozi();
})();
