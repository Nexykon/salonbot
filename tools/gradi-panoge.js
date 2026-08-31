/*
  Zgradi public/panoga/<slug>.html iz tools/panoge-podatki.js
  Zaženi:  node tools/gradi-panoge.js

  POZOR: datoteke v public/panoga/ so GENERIRANE. Ročne spremembe v njih
  se pri naslednjem zagonu izgubijo — popravljaj podatke v panoge-podatki.js
  ali predlogo v tem skriptu.
*/
const fs = require('fs');
const path = require('path');

const PANOGE = require('./panoge-podatki.js');
const OUT_DIR = path.join(__dirname, '..', 'public', 'panoga');

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const glava = (p) => `<header class="site-head">
  <div class="head-inner">
    <a class="head-logo" href="/"><img src="/ft-logo.png" width="188" height="55" alt="FlowTiq"></a>
    <nav class="head-nav">
      <a href="/panoge.html" aria-current="page">Za koga</a>
      <a href="/kako-deluje.html">Kako deluje</a>
      <a href="/funkcije.html">Kaj zna</a>
      <a href="/cenik.html">Cena</a>
      <a href="/zgodbe.html">Primeri</a>
      <a href="/vprasanja.html">Vprašanja</a>
    </nav>
    <div class="head-actions">
      <a class="btn btn--ghost btn--sm" href="/salon.html">Prijava</a>
      <a class="btn btn--primary btn--sm" href="/kontakt.html">Odpri račun</a>
    </div>
  </div>
</header>`;

const noga = `<footer class="site-foot">
  <div class="foot-grid">
    <div>
      <img src="/ft-logo.png" width="188" height="55" alt="FlowTiq">
      <p style="font-size:14.5px;color:var(--muted);margin-top:14px;line-height:1.55;max-width:30ch"><strong>Flow</strong> je neprekinjen tok strank. <strong>Tiq</strong> je odziv v sekundi. Skupaj: pomočnik, ki ti polni koledar, medtem ko delaš.</p>
    </div>
    <div>
      <div class="foot-label">Izdelek</div>
      <div class="foot-links">
        <a href="/kako-deluje.html">Kako deluje</a>
        <a href="/funkcije.html">Kaj zna</a>
        <a href="/cenik.html">Cena</a>
        <a href="/vprasanja.html">Vprašanja</a>
      </div>
    </div>
    <div>
      <div class="foot-label">Za koga</div>
      <div class="foot-links">
        <a href="/panoga/restavracije.html">Restavracije in picerije</a>
        <a href="/panoga/frizerski-saloni.html">Frizerski saloni</a>
        <a href="/panoga/zobozdravniki.html">Ambulante</a>
        <a href="/panoge.html">Vse obrti →</a>
        <a href="/imenik.html">Imenik lokalov</a>
      </div>
    </div>
    <div>
      <div class="foot-label">Podjetje</div>
      <div class="foot-links">
        <a href="/o-nas.html">O nas</a>
        <a href="/ai-resitve.html">Razvoj AI rešitev po meri</a>
        <a href="/zgodbe.html">Primeri iz prakse</a>
        <a href="/nasveti.html">Nasveti</a>
        <a href="/varnost.html">Varnost in zasebnost</a>
        <a href="/kontakt.html">Kontakt</a>
      </div>
    </div>
  </div>
  <div class="foot-info">
    <div>
      <div class="foot-label">Kdo stoji za FlowTiq</div>
      <p>FlowTiq razvija <strong>Webacus</strong>. Za njim stojijo leta dela s spletnimi rešitvami in
      avtomatizacijo za slovenska podjetja — FlowTiq ni stranski projekt, ampak izdelek, ki je zrasel
      iz pogovorov s pravimi gostinci in obrtniki. Ko se kaj zalomi, se oglasi človek, ki izdelek pozna.</p>
    </div>
    <div>
      <div class="foot-label">Podpora</div>
      <div class="stack-sm">
        <div><a href="https://wa.me/38640599185" target="_blank" rel="noopener">WhatsApp 040 599 185</a></div>
        <div><a href="mailto:info@flowtiq.si">info@flowtiq.si</a></div>
        <div class="fine">Med tednom od 8. do 19. ure, ob sobotah dopoldne.<br>Odgovorimo običajno v nekaj urah.</div>
      </div>
    </div>
    <div>
      <div class="foot-label">Podatki podjetja</div>
      <div class="stack-sm fine">
        <div>Webacus, Valentin Iljaž s.p.</div>
        <div>Nova vas 12, Bizeljsko</div>
        <div class="davcna">Davčna št.: 35880643</div>
        <div>Nismo zavezanci za DDV<br>(1. odst. 94. člena ZDDV-1).</div>
      </div>
    </div>
  </div>
  <div class="foot-bottom">
    <div>© 2026 FlowTiq — Webacus, Valentin Iljaž s.p. · Davčna št.: 35880643</div>
    <div style="display:flex;gap:18px;flex-wrap:wrap"><a href="/privacy.html">Zasebnost</a><a href="/terms.html">Pogoji uporabe</a><a href="/cookies.html">Piškotki</a><a href="/llms.txt" title="Povzetek strani za jezikovne modele in AI iskalnike">llms.txt</a></div>
  </div>
</footer>`;

function stran(p, vse) {
  const naslovVrstice = p.naslov.split('\n').map(v => `<div>${esc(v)}</div>`).join('\n          ');

  const pogovor = p.pogovor.map((m, i) => {
    const smer = m.k === 'g' ? 'bubble--out' : 'bubble--in';
    const zamik = (0.15 + i * 0.45).toFixed(2);
    return `<div class="bubble ${smer}" style="animation-delay:${zamik}s">${esc(m.t)}</div>`;
  }).join('\n          ');

  const stevilke = p.stevilke.map(s =>
    `<div style="padding:30px 24px"><div style="font-weight:800;font-size:38px;color:var(--mint);line-height:1">${esc(s.v)}</div><div style="font-size:15px;color:var(--on-ink-3);margin-top:7px">${esc(s.o)}</div></div>`
  ).join('\n        ');

  const boli = p.boli.map(b =>
    `<div class="card card--pad top-red"><h3 style="font-size:20px;line-height:1.15">${esc(b.t)}</h3><p class="body" style="margin-top:10px">${esc(b.o)}</p></div>`
  ).join('\n      ');

  const primeri = p.primeri.map((x, i) =>
    `<div style="padding:24px 26px;display:grid;grid-template-columns:34px 1fr;gap:16px;align-items:start"><div class="mono" style="font-size:13px;font-weight:600;color:var(--green);padding-top:4px">${String(i + 1).padStart(2, '0')}</div><div><h3 style="font-size:19.5px;line-height:1.15">${esc(x.t)}</h3><p style="font-size:15px;color:var(--muted);margin-top:8px;line-height:1.55">${esc(x.o)}</p></div></div>`
  ).join('\n        ');

  const faq = p.faq.map(q =>
    `<details>\n          <summary><span>${esc(q.v)}</span><span class="sign"></span></summary>\n          <div class="faq-body measure-76">${esc(q.o)}</div>\n        </details>`
  ).join('\n        ');

  const druge = vse.filter(x => x.slug !== p.slug).map(x =>
    `<a class="card" href="/panoga/${x.slug}.html" style="padding:9px 15px;font-size:14.5px;font-weight:500;color:var(--ink)">${esc(x.ime)}</a>`
  ).join('\n        ');

  /*
    "za" je TOŽILNIK ("za avtoservise"), ne imenovalnik ("za avtoservisi").
    Sklanjatve iz imena ni mogoče izpeljati s pravilom — ženske oblike so
    enake imenovalniku, moške ne — zato je oblika zapisana pri vsaki panogi.
    Če manjka, se gradnja ustavi: napačen sklon v naslovu strani je tisto,
    kar navajata Google in AI iskalniki.
  */
  if (!p.za) throw new Error('panoga "' + p.slug + '" nima polja "za" (tožilnik za naslov)');
  const opisMeta = `FlowTiq za ${p.za}: ${p.kratko}`;

  return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FlowTiq za ${esc(p.za)} — WhatsApp pomočnik</title>
<meta name="description" content="${esc(opisMeta)}">
<link rel="canonical" href="https://flowtiq.si/panoga/${p.slug}.html">
<meta property="og:url" content="https://flowtiq.si/panoga/${p.slug}.html">
<meta property="og:title" content="FlowTiq za ${esc(p.za)}">
<meta property="og:description" content="${esc(p.podnaslov)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="sl_SI">
<meta property="og:site_name" content="FlowTiq">
<meta property="og:image" content="https://flowtiq.si/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="FlowTiq — naročila in termini na avtopilotu">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FBF8F1">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Domov", "item": "https://flowtiq.si/" },
    { "@type": "ListItem", "position": 2, "name": "Za koga", "item": "https://flowtiq.si/panoge.html" },
    { "@type": "ListItem", "position": 3, "name": "${esc(p.ime)}", "item": "https://flowtiq.si/panoga/${p.slug}.html" }
  ]
}
</script>
<link rel="icon" type="image/png" href="/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fira+Sans:wght@400;500;600;700;800&family=Fira+Mono:wght@500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/flowtiq-site.css">
<script src="/flowtiq-nav.js" defer></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ZXH2YX58RX"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-ZXH2YX58RX');</script>
<style>
  .krojenje { display:flex; align-items:center; gap:10px; font-size:13.5px; color:var(--muted-2); padding-bottom:34px; flex-wrap:wrap; }
  .krojenje a { color:var(--muted-2); }
  .stevilke-3 { display:grid; grid-template-columns:repeat(3,1fr); }
  .stevilke-3 > * + * { border-left:1.5px solid var(--ink-line); }
  @media (max-width:640px) { .stevilke-3 { grid-template-columns:1fr; } .stevilke-3 > * + * { border-left:0; border-top:1.5px solid var(--ink-line); } }
</style>
</head>
<body>

${glava(p)}

<section class="sec sec--grad" style="padding:20px 0 60px">
  <div class="wrap">
    <nav class="krojenje" aria-label="Drobtine">
      <a href="/">Domov</a><span>/</span><a href="/panoge.html">Za koga</a><span>/</span><span style="color:var(--ink);font-weight:600">${esc(p.ime)}</span>
    </nav>
    <div class="grid-11-top">
      <div>
        <div style="display:inline-flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="width:46px;height:46px;border:2px solid var(--ink);border-radius:18px;background:#fff;display:grid;place-items:center;font-weight:800;font-size:18px">${esc(p.mono)}</div>
          <div class="pill">FlowTiq za: ${esc(p.ime)}</div>
        </div>
        <h1 style="font-size:clamp(38px,4.8vw,62px);margin-top:22px">
          ${naslovVrstice}
        </h1>
        <p class="lead-lg measure-44" style="font-size:19px;margin-top:22px">${esc(p.podnaslov)}</p>
        <div class="row" style="margin-top:28px">
          <a class="btn btn--primary" href="/kontakt.html">Odpri račun</a>
          <a class="btn btn--ghost" href="/cenik.html">Poglej ceno</a>
        </div>
      </div>
      <div class="chat card--shadow">
        <div class="chat-tag">TAKO IZGLEDA PRI TEBI</div>
        <div class="chat-body" style="background:var(--chat-bg)">
          ${pogovor}
        </div>
      </div>
    </div>
  </div>
</section>

<section class="sec sec--ink sec--flush">
  <div class="wrap">
    <div class="stevilke-3">
        ${stevilke}
    </div>
  </div>
</section>

<section class="sec" style="padding:68px 0">
  <div class="wrap">
    <div class="pill pill--red">01 · Kar te vsak dan jezi</div>
    <h2 class="h-3 measure-24" style="margin-top:22px">Trije problemi, ki jih ima vsak v tvoji panogi.</h2>
    <div class="grid-3-20" style="margin-top:36px">
      ${boli}
    </div>
  </div>
</section>

<section class="sec sec--cream" style="padding:68px 0">
  <div class="wrap">
    <div class="pill">02 · Konkretni primeri</div>
    <div class="grid-even-end" style="margin-top:22px">
      <h2 class="h-3 measure-22">Šest opravil, ki jih prevzame pri tebi.</h2>
      <p class="lead" style="font-size:17.5px">Ne gre za splošnega robota. Vsaka od teh stvari je nastavljena po pravilih tvoje obrti — tvoje storitve, tvoji časi, tvoje cene.</p>
    </div>
    <div class="hair cols-2" style="margin-top:36px">
        ${primeri}
    </div>
  </div>
</section>

<section class="sec" style="padding:68px 0">
  <div class="wrap">
    <div class="pill">03 · Kako začneš</div>
    <h2 class="h-3 measure-22" style="margin-top:22px">Trije koraki, dva dneva.</h2>
    <div class="split cols-3 split-pad split-last-tan" style="margin-top:36px">
      <div>
        <div class="step-n" style="width:34px;height:34px">1</div>
        <h3 style="font-size:20px;margin-top:16px">Poveš nam osnove</h3>
        <p class="body" style="font-size:15px;margin-top:9px">Delovni čas, storitve ali meni, cene. Lahko kar fotografijo cenika prek WhatsAppa.</p>
      </div>
      <div>
        <div class="step-n" style="width:34px;height:34px">2</div>
        <h3 style="font-size:20px;margin-top:16px">Mi nastavimo vse</h3>
        <p class="body" style="font-size:15px;margin-top:9px">Povežemo tvojo WhatsApp številko in nastavimo pomočnika po pravilih tvoje obrti. Ti ne namestiš ničesar.</p>
      </div>
      <div>
        <div class="step-n step-n--green" style="width:34px;height:34px">3</div>
        <h3 style="font-size:20px;margin-top:16px">FlowTiq prevzame</h3>
        <p class="body" style="font-size:15px;margin-top:9px">Od tega trenutka sprejema naročila in rezervacije, opominja in vabi nazaj. Ti delaš naprej.</p>
      </div>
    </div>
  </div>
</section>

<section class="sec sec--cream" style="padding:68px 0">
  <div class="wrap">
    <div class="pill">04 · Kar sprašujejo v tvoji panogi</div>
    <div class="faq" style="margin-top:30px">
        ${faq}
      <div class="faq-note">Splošna vprašanja o FlowTiq najdeš na <a class="uline" href="/vprasanja.html">strani z vprašanji</a>.</div>
    </div>
  </div>
</section>

<section class="sec sec--sm">
  <div class="wrap">
    <div class="pill" style="background:#fff;color:var(--muted-2)">Druge obrti</div>
    <div class="row" style="margin-top:18px;gap:10px">
        ${druge}
    </div>
  </div>
</section>

<section class="sec sec--flush sec--open">
  <div class="wrap cta-wrap">
    <div class="cta cta--split">
      <div>
        <h2 style="font-size:clamp(30px,3.8vw,48px);max-width:22ch">Poglejmo, kako bi FlowTiq deloval točno pri tebi.</h2>
        <p class="measure-50" style="font-size:18px;margin-top:18px">Brez obveznosti in brez tehničnih vprašanj. Povej nam, kaj delaš, in pokažemo ti pogovor, kot bi ga imela tvoja stranka.</p>
      </div>
      <a class="btn btn--onink" href="/kontakt.html" style="justify-self:start;font-size:17.5px">Odpri račun</a>
    </div>
  </div>
</section>

${noga}
</body>
</html>
`;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
let n = 0;
for (const p of PANOGE) {
  const file = path.join(OUT_DIR, p.slug + '.html');
  fs.writeFileSync(file, stran(p, PANOGE), 'utf8');
  console.log('  ✓ public/panoga/' + p.slug + '.html');
  n++;
}
console.log(`\nZgrajenih strani: ${n}`);
