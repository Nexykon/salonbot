/*
  Zgradi štiri oglasne pristajalne strani iz tools/preizkus-podatki.js

      node tools/gradi-preizkus.js

  POZOR: public/preizkus-*.html so GENERIRANE. Ročne spremembe se pri
  naslednjem zagonu izgubijo — popravljaj besedilo v preizkus-podatki.js
  ali predlogo tukaj.

  GLAVA IN NOGA SE BERETA IZ OBSTOJEČE STRANI

    Ne prepisujeta se, ampak se izrežeta iz public/cenik.html. Prepisana
    noga se ob prvi spremembi drugod po strani razide in tega nihče ne
    opazi — štiri oglasne strani bi ostale z lansko. Tako se po ponovnem
    zagonu uskladijo same.

  ZAKAJ TE STRANI NISO V SITEMAP.XML

    So oglasne in skoraj enake med sabo. V iskalniku bi tekmovale z
    /cenik.html in /panoga/*, zato nosijo noindex. Iz menija niso dosegljive.
*/
const fs = require('fs');
const path = require('path');

const { SKUPNO, STRANI } = require('./preizkus-podatki.js');

const KOREN = path.join(__dirname, '..');
const PUB = path.join(KOREN, 'public');
const VZOR = fs.readFileSync(path.join(PUB, 'cenik.html'), 'utf8');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const izrezi = (od, doKje) => {
  const a = VZOR.indexOf(od);
  const b = VZOR.indexOf(doKje, a);
  if (a < 0 || b < 0) throw new Error('v cenik.html ni mogoče najti ' + od);
  return VZOR.slice(a, b + doKje.length);
};

/* aria-current odpade: te strani v meniju niso. */
const GLAVA = izrezi('<header class="site-head">', '</header>').replace(/ aria-current="page"/g, '');
const NOGA = izrezi('<footer class="site-foot">', '</footer>');

/* Različice virov vzamemo iz cenika, da jih ni treba vzdrževati dvakrat. */
const CSS = (VZOR.match(/href="(\/flowtek-site\.css[^"]*)"/) || [, '/flowtek-site.css'])[1];
const NAV = (VZOR.match(/src="(\/flowtek-nav\.js[^"]*)"/) || [, '/flowtek-nav.js'])[1];

const gumb = (s, kje) => {
  const url = 'https://wa.me/' + SKUPNO.stevilka + '?text=' + encodeURIComponent(s.sporocilo);
  return '<a class="btn btn--primary pz-gumb" href="' + esc(url) + '" target="_blank" rel="noopener"'
    + ' data-wa-location="' + esc(s.slug + '-' + kje) + '">' + esc(s.gumb) + '</a>';
};

/*
  Obrazec za povratni klic — druga pot za tistega, ki ne želi odpreti
  WhatsAppa. Gumb je namenoma tihi (btn--ghost), da glavni poziv ostane eden.

  Polja so samo tri: ime, telefon, soglasje. E-naslova ne zahtevamo, ker
  vsako polje več pomeni manj prijav, mi pa za klic potrebujemo le številko.
*/
const obrazec = (s) => `<section class="sec sec--cream sec--sm" id="poklici">
  <div class="wrap">
    <h2 class="h-4">${esc(SKUPNO.obrazecNaslov)}</h2>
    <p class="pz-opomba" style="max-width:52ch">${esc(SKUPNO.obrazecVrstica)}</p>

    <div class="pz-uspeh" id="pz-uspeh" style="display:none" role="status">${esc(SKUPNO.obrazecUspeh)}</div>

    <form class="pz-obrazec" id="pz-obrazec" novalidate>
      <div class="field">
        <label for="pz-ime">${esc(SKUPNO.obrazecIme)}</label>
        <input type="text" id="pz-ime" name="ime" placeholder="${esc(SKUPNO.obrazecImeNamig)}" autocomplete="name" required>
      </div>
      <div class="field">
        <label for="pz-tel">${esc(SKUPNO.obrazecTelefon)}</label>
        <input type="tel" id="pz-tel" name="telefon" placeholder="${esc(SKUPNO.obrazecTelefonNamig)}" autocomplete="tel" inputmode="tel" required>
      </div>
      <label class="check">
        <input type="checkbox" id="pz-soglasje" name="soglasje" required>
        <span>${esc(SKUPNO.obrazecSoglasje)} <a href="/varnost.html" target="_blank" rel="noopener">${esc(SKUPNO.obrazecZasebnost)}</a></span>
      </label>
      <div class="form-error" id="pz-napaka" style="display:none" role="alert"></div>
      <button class="btn btn--ghost" type="submit" id="pz-poslji">${esc(SKUPNO.obrazecGumb)}</button>
    </form>
  </div>
</section>`;

const izracun = () => `      <div class="pz-izracun">
        <div>${esc(SKUPNO.izracun)}</div>
        <div class="pz-izracun-drobno">${esc(SKUPNO.izracunDrobno)}</div>
      </div>`;

function stran(s) {
  const naslovUrl = 'https://flowtek.si/' + s.slug + '.html';
  return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.naslovStrani)}</title>
<meta name="description" content="${esc(s.opis)}">
<!--
  Oglasna stran: en cilj, en gumb. noindex, ker so vse štiri skoraj enake
  in bi v iskalniku tekmovale s cenikom in panožnimi stranmi; follow, da
  povezave naprej (cenik) obdržijo vrednost. V sitemap.xml je namenoma ni.
-->
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${naslovUrl}">
<meta property="og:url" content="${naslovUrl}">
<meta property="og:title" content="${esc(s.naslovStrani)}">
<meta property="og:description" content="${esc(s.opis)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="sl_SI">
<meta property="og:image" content="https://flowtek.si/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="FlowTek — naročila in termini na avtopilotu">
<meta property="og:site_name" content="FlowTek">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FBF8F1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;500;600;700;800&family=Fira+Mono:wght@500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${CSS}">
<script src="${NAV}" defer></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ZXH2YX58RX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-ZXH2YX58RX');
</script>
<style>
  /*
    Obiskovalec pride z Reels na telefonu. Gumb mora biti viden brez
    drsenja na 390×844, zato je junak tu nižji kot drugod po strani.
  */
  .pz-junak { padding: 26px 0 30px; }
  .pz-junak h1 { font-size: clamp(27px, 7vw, 44px); line-height: 1.1; }
  .pz-junak .pz-pod { font-size: 17px; color: var(--ink-2); line-height: 1.5; margin-top: 12px; max-width: 46ch; }
  /* Komu je stran namenjena — obiskovalec pride iz oglasa in ne ve, kam je prišel. */
  .pz-za { font-size: 15px; color: var(--ink-2); margin-bottom: 8px; }
  /*
    Pojasnilo, da je demonstracija picerija, stoji PRED gumbom. Prej je bilo
    pod njim, torej za odločitvijo, in v drobnem tisku — pri povprečnem
    obisku štirih do sedmih sekund ga ni prebral nihče.
  */
  .pz-demo { font-size: 15.5px; color: var(--ink-2); line-height: 1.5; margin-top: 14px; max-width: 46ch; }
  .pz-gumb { margin-top: 20px; font-size: 17px; }
  .pz-opomba { font-size: 14.5px; color: var(--muted-2); margin-top: 12px; max-width: 48ch; line-height: 1.5; }
  .pz-opomba + .pz-opomba { margin-top: 6px; }
  /*
    Na teh štirih straneh je en sam glavni poziv — gumb na WhatsApp. Prijava
    in "Odpri račun" v glavi sta tekmovala z njim; povezave v meniju ostanejo,
    plavajoči gumb za podporo prav tako.
  */
  .pz-stran .head-actions { display: none; }
  .pz-obrazec { display: grid; gap: 14px; margin-top: 20px; max-width: 420px; }
  .pz-uspeh { border: 2px solid var(--ink); border-radius: var(--r); background: var(--green-tint); padding: 18px 20px; margin-top: 20px; font-size: 17px; font-weight: 600; max-width: 420px; }
  .pz-koraki { display: grid; gap: 14px; margin-top: 22px; counter-reset: pz; }
  .pz-korak { display: flex; gap: 14px; align-items: flex-start; font-size: 16px; line-height: 1.5; color: var(--ink-2); }
  .pz-st {
    flex: 0 0 auto; width: 30px; height: 30px; border: 2px solid var(--ink); border-radius: 50%;
    display: grid; place-items: center; font-family: var(--mono); font-size: 13px; font-weight: 700;
    background: var(--cream-2); color: var(--ink);
  }
  .pz-kljuke { display: grid; gap: 11px; margin-top: 20px; list-style: none; }
  .pz-kljuke li { font-size: 16px; line-height: 1.5; color: var(--ink-2); }
  .pz-cene { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 22px; }
  .pz-cena { border: 2px solid var(--ink); border-radius: var(--r); background: #fff; padding: 16px 14px; text-align: center; }
  .pz-cena b { display: block; font-size: 15px; }
  .pz-cena span { display: block; font-size: 19px; font-weight: 800; margin-top: 6px; }
  .pz-izracun { border: 1.5px solid var(--line-2); border-radius: 14px; padding: 15px 17px; margin-top: 22px; background: var(--cream-2); max-width: 52ch; }
  .pz-izracun > div:first-child { font-size: 15.5px; color: var(--ink-2); line-height: 1.5; }
  .pz-izracun-drobno { font-size: 14px; color: var(--muted-2); margin-top: 6px; }
  @media (max-width: 520px) {
    .pz-cene { grid-template-columns: 1fr; gap: 10px; }
    .pz-cena { display: flex; align-items: baseline; justify-content: space-between; text-align: left; padding: 13px 16px; }
    .pz-cena span { margin-top: 0; }
  }
</style>
</head>
<body class="pz-stran">

${GLAVA}

<section class="sec sec--grad pz-junak">
  <div class="wrap">
    <p class="pz-za">${esc(s.zaKoga)}</p>
    <h1 class="h-1">${esc(s.h1)}</h1>
    <p class="pz-pod">${esc(s.podnaslov)}</p>
    <p class="pz-demo">${esc(s.demo)}</p>
    ${gumb(s, 'hero')}
    <p class="pz-opomba">${esc(SKUPNO.opombaPodGumbom)}</p>
${s.izracunPodJunakom ? izracun() + '\n' : ''}  </div>
</section>

${obrazec(s)}

<section class="sec sec--sm">
  <div class="wrap">
    <h2 class="h-4">${esc(SKUPNO.korakiNaslov)}</h2>
    <div class="pz-koraki">
${SKUPNO.koraki.map((k, i) => `      <div class="pz-korak"><span class="pz-st">${i + 1}</span><span>${esc(k)}</span></div>`).join('\n')}
    </div>
  </div>
</section>

<section class="sec sec--cream sec--sm">
  <div class="wrap">
    <h2 class="h-4">${esc(s.kotNaslov)}</h2>
    <ul class="pz-kljuke">
${s.kot.map((v) => `      <li>✅ ${esc(v)}</li>`).join('\n')}
    </ul>
  </div>
</section>

<section class="sec sec--sm">
  <div class="wrap">
    <h2 class="h-4">Cena</h2>
    <div class="pz-cene">
${SKUPNO.paketi.map((p) => `      <div class="pz-cena"><b>${esc(p.ime)}</b><span>${esc(p.cena)}</span></div>`).join('\n')}
    </div>
    <p class="pz-opomba" style="max-width:none">${esc(SKUPNO.podCenami)}</p>
    <p style="margin-top:10px"><a class="uline" href="/cenik.html">${esc(SKUPNO.primerjajPakete)}</a></p>
${s.izracunPodJunakom ? '' : izracun() + '\n'}  </div>
</section>

<section class="sec sec--cream sec--sm">
  <div class="wrap">
    <h2 class="h-4">${esc(SKUPNO.spodnjiNaslov)}</h2>
    ${gumb(s, 'bottom')}
    <p class="pz-opomba">${esc(SKUPNO.opombaPodGumbom)}</p>
  </div>
</section>

${NOGA}

<script>
/*
  Oddaja obrazca za povratni klic. Enak vzorec kot kontakt.html.

  Dogodka generate_lead in Lead se sprožita SAMO za preverbo r.ok. Strežnik
  vrne 502, kadar prijave ni uspel ne poslati ne zapisati; takrat obiskovalec
  vidi napako in oglas ne dobi konverzije, ki se ni zgodila.
*/
(function () {
  var form = document.getElementById('pz-obrazec');
  if (!form) return;
  var napaka = document.getElementById('pz-napaka');
  var gumb = document.getElementById('pz-poslji');
  var SLUG = ${JSON.stringify(s.slug)};

  function pokaziNapako(t) {
    napaka.textContent = t;
    napaka.style.display = 'block';
  }

  /* Parametri kampanje gredo v obvestilo, sicer ne vemo, kateri oglas je prijavo prinesel. */
  function utm() {
    var ven = {};
    try {
      new URLSearchParams(location.search).forEach(function (v, k) {
        if (k.indexOf('utm_') === 0) ven[k] = v;
      });
    } catch (e) { /* starejši brskalnik — prijava je pomembnejša od oznake */ }
    return ven;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    napaka.style.display = 'none';

    var ime = document.getElementById('pz-ime').value.trim();
    var tel = document.getElementById('pz-tel').value.trim();
    var soglasje = document.getElementById('pz-soglasje').checked;

    if (!ime || !tel) return pokaziNapako(${JSON.stringify(SKUPNO.obrazecNapakaPolja)});
    if (!soglasje) return pokaziNapako(${JSON.stringify(SKUPNO.obrazecNapakaSoglasje)});

    gumb.disabled = true;
    gumb.textContent = ${JSON.stringify(SKUPNO.obrazecPosiljam)};

    fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: ime, phone: tel, email: '',
        business_type: SLUG + ' · povratni klic',
        source: SLUG, soglasje: true, utm: utm()
      })
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          throw new Error(d && d.error ? d.error : '');
        });
      }
      form.style.display = 'none';
      document.getElementById('pz-uspeh').style.display = 'block';
      if (typeof gtag === 'function') gtag('event', 'generate_lead', {
        method: 'preizkus-obrazec', page_path: location.pathname, link_location: SLUG + '-obrazec'
      });
      if (typeof ftSledi === 'function') ftSledi('Lead', { content_name: 'preizkus-obrazec-' + SLUG });
    }).catch(function (e) {
      gumb.disabled = false;
      gumb.textContent = ${JSON.stringify(SKUPNO.obrazecGumb)};
      pokaziNapako((e && e.message) || ${JSON.stringify(SKUPNO.obrazecNapakaSplosna)});
    });
  });
})();
</script>

</body>
</html>
`;
}

let n = 0;
for (const s of STRANI) {
  const pot = path.join(PUB, s.slug + '.html');
  fs.writeFileSync(pot, stran(s), 'utf8');
  console.log('  ✓ public/' + s.slug + '.html');
  n += 1;
}
console.log('\nZgrajenih strani: ' + n + '\n');
