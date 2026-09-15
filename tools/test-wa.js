/*
  Preizkus merjenja klikov na WhatsApp.

    node tools/test-wa.js          (potrebuje lokalni strežnik na 3011)

  Del trditev je statičnih (ena skupna funkcija, žive številke), osrednji del
  pa teče v PRAVEM brskalniku: na vsako povezavo sprožimo klik in preberemo,
  kaj bi šlo v GA. Brez tega bi preverjali le, da je koda zapisana — ne pa, da
  se dogodek res sproži in da klika ne zadrži.

  Navigacijo med preizkusom ustavimo v fazi mehurčenja; poslušalka za merjenje
  je v fazi zajema, zato se izvede prej in je meritev verodostojna.
*/
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const KOREN = path.join(__dirname, '..');
const PUB = path.join(KOREN, 'public');
const NAV = fs.readFileSync(path.join(PUB, 'flowtek-nav.js'), 'utf8');

let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const a = JSON.stringify(dobil), b = JSON.stringify(pricakoval);
  if (a === b) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil:      ' + a + '\n      pričakoval: ' + b); }
}

/* ── 1 · ena sama skupna funkcija ──────────────────────────────────────── */
console.log('\n1) Koda je na enem mestu');
je('flowtek-nav.js vsebuje merjenje', /wa_click/.test(NAV), true);

const NASE_ST = ['38669323814', '38669323846'];
const vsebina = f => fs.readFileSync(path.join(PUB, f), 'utf8');

const straniZWa = fs.readdirSync(PUB).filter(f => f.endsWith('.html'))
  .concat(fs.readdirSync(path.join(PUB, 'panoga')).map(f => 'panoga/' + f))
  .filter(f => /wa\.me\//.test(vsebina(f)));

// Strani z NAŠO številko so tiste, ki jih merimo. imenik in restavracije
// sestavljata povezave na številke lokalov — te namenoma ne štejejo.
const straniZNaso = straniZWa.filter(f => NASE_ST.some(s => vsebina(f).includes(s)));

je('povezave na WhatsApp ima vsaj 25 strani', straniZWa.length >= 25, true);
// Kopija na strani bi pomenila dvojno štetje in razhajanje ob naslednji spremembi.
je('nobena stran nima svoje kopije',
  straniZWa.filter(f => /wa_click/.test(vsebina(f))), []);
je('vse strani z našo številko nalagajo flowtek-nav.js',
  straniZNaso.filter(f => !/src="\/flowtek-nav\.js"/.test(vsebina(f))), []);

/* ── 2 · klik ne sme čakati ────────────────────────────────────────────── */
console.log('\n2) Klik ne čaka na merjenje');
const blok = NAV.slice(NAV.indexOf('4. Merjenje klikov'));
// Komentarje odstranimo: beseda "preventDefault" v pojasnilu ni klic.
const koda = blok.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
je('nikjer ne prestreže povezave', /preventDefault/.test(koda), false);
je('ne vrača false iz poslušalke', /return false/.test(koda), false);
je('uporablja beacon', /transport_type:\s*'beacon'/.test(koda), true);
je('napaka pri merjenju je ujeta', /catch\s*\(/.test(koda), true);
je('brez gtag se tiho umakne', /typeof gtag !== 'function'/.test(koda), true);
je('posluša v fazi zajema', /\}, true\);/.test(koda), true);
// Tuje številke se ne smejo šteti — sicer wa_click pomeni dve stvari hkrati.
je('meri samo naši dve številki',
  NASE_ST.every(s => koda.includes(s)) && /if \(!vrsta\) return;/.test(koda), true);

/* ── 3 · samo žive številke ────────────────────────────────────────────── */
console.log('\n3) Samo žive številke');
const vseStevilke = new Set();
for (const f of straniZWa) {
  const s = fs.readFileSync(path.join(PUB, f), 'utf8');
  for (const m of s.matchAll(/wa\.me\/(\d+)/g)) vseStevilke.add(m[1]);
}
for (const m of NAV.matchAll(/wa\.me\/(\d+)/g)) vseStevilke.add(m[1]);
je('v rabi sta natanko dve številki', [...vseStevilke].sort(), ['38669323814', '38669323846']);
je('mrtve 040 599 185 ni nikjer', [...vseStevilke].some(s => /599185$/.test(s)), false);

/* ── 4 · v pravem brskalniku ───────────────────────────────────────────── */
const brskalnik = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe']
  .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });

const STREZNIK = 'http://127.0.0.1:3011';

function vBrskalniku(pot, tujaStevilka) {
  /*
    Vstavimo lastno stran, ki naloži pravo stran v okvir istega izvora, tam
    podtakne gtag, ustavi navigacijo in klikne vse povezave na wa.me.
  */
  const merilna = `<!doctype html><meta charset="utf-8"><body><script>
    var o = document.createElement('iframe');
    o.style.cssText = 'width:1200px;height:800px;border:0';
    o.src = '${pot}';
    o.onload = function () {
      var w = o.contentWindow, d = o.contentDocument;
      var dogodki = [];
      w.gtag = function () { dogodki.push([].slice.call(arguments)); };
      // Navigacijo ustavimo v mehurčenju — merjenje je v zajemu in teče prej.
      d.addEventListener('click', function (e) { e.preventDefault(); }, false);

      /* Po želji vrinemo povezavo s TUJO številko — tako kot jo sestavi
         imenik za posamezen lokal — in preverimo, da je ne štejemo. */
      var tuja = ${tujaStevilka ? "'" + tujaStevilka + "'" : 'null'};
      if (tuja) {
        var t = d.createElement('a');
        t.href = 'https://wa.me/' + tuja + '?text=Pozdravljeni';
        t.className = 'wa';
        t.textContent = 'lokal';
        d.body.appendChild(t);
      }

      var povezave = [].slice.call(d.querySelectorAll('a[href*="wa.me/"]'));
      povezave.forEach(function (a) { a.click(); });

      document.title = JSON.stringify({
        povezav: povezave.length,
        dogodki: dogodki.filter(function (d) { return d[0] === 'event' && d[1] === 'wa_click'; })
                        .map(function (d) { return d[2]; })
      });
    };
    document.body.appendChild(o);
  </script></body>`;

  const zac = path.join(PUB, '_merjenje.html');
  fs.writeFileSync(zac, merilna);
  try {
    const dom = execFileSync(brskalnik, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--user-data-dir=' + path.join(require('os').tmpdir(), 'ft-wa-' + Date.now()),
      '--window-size=1280,900', '--virtual-time-budget=6000',
      '--dump-dom', STREZNIK + '/_merjenje.html'
    ], { encoding: 'utf8', timeout: 90000, maxBuffer: 60 * 1024 * 1024 });
    const m = dom.match(/<title>([^<]*)<\/title>/);
    if (!m) return null;
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } catch (e) {
    return null;
  } finally {
    try { fs.unlinkSync(zac); } catch (e) { /* ni nujno */ }
  }
}

(async () => {
  let zivi = false;
  try { zivi = (await fetch(STREZNIK + '/index.html')).ok; } catch (e) { zivi = false; }

  if (!brskalnik || !zivi) {
    console.log('\n4) V pravem brskalniku — PRESKOČENO'
      + (!brskalnik ? ' (brskalnika ni)' : ' (na ' + STREZNIK + ' ni strežnika)'));
    console.log('   Zaženi statični strežnik na 3011 in ponovi, da se preveri tudi sprožitev.');
  } else {
    console.log('\n4) V pravem brskalniku: klik res sproži dogodek');
    for (const [pot, pricakovanaMesta] of [
      ['/index.html', ['index-hero', 'noga']],
      ['/vodic.html', ['vodic-demo', 'noga']],
      ['/vodic-hvala.html', ['vodic-hvala-demo', 'noga']],
      ['/panoga/restavracije.html', ['noga']]
    ]) {
      const r = vBrskalniku(pot);
      if (!r) { je(pot + ': meritev je uspela', false, true); continue; }

      // Plavajoči gumb doda flowtek-nav.js, zato jih je v izrisu več kot v HTML.
      je(pot + ': vsak klik je sprožil dogodek', r.dogodki.length, r.povezav);

      const mesta = [...new Set(r.dogodki.map(d => d.kje))].sort();
      for (const m of pricakovanaMesta) je(pot + ': med mesti je "' + m + '"', mesta.includes(m), true);
      je(pot + ': plavajoči gumb je zajet', mesta.includes('plavajoci'), true);

      const stevilke = [...new Set(r.dogodki.map(d => d.stevilka))];
      je(pot + ': vsak dogodek nosi številko', stevilke.every(s => /^386\d+$/.test(s)), true);
      je(pot + ': vsak dogodek nosi vrsto',
        r.dogodki.every(d => d.vrsta === 'demo' || d.vrsta === 'podpora'), true);
      je(pot + ': demo številka je označena kot demo',
        r.dogodki.filter(d => d.stevilka === '38669323814').every(d => d.vrsta === 'demo'), true);
      je(pot + ': ni tujih številk', r.dogodki.every(d => NASE_ST.includes(d.stevilka)), true);
    }

    /*
      Imenik sestavlja povezave na številke LOKALOV. Tam se sme sprožiti samo
      dogodek za našo številko v nogi — klik na lokalovo številko je nekaj
      drugega in ga ne smemo šteti skupaj.
    */
    /*
      Imenik in restavracije sestavljata povezave na številke LOKALOV. Klik
      tam pomeni "gost naroča pri lokalu" in ne "interesent piše FlowTeku".
      Ker se na statičnem strežniku seznam lokalov ne naloži (pride iz API),
      tujo povezavo vrinemo sami — tako preverimo prav pravilo, ne okolja.
    */
    console.log('\n5) Številke lokalov se ne štejejo');
    const TUJA = '38641234567';
    for (const pot of ['/imenik.html', '/index.html']) {
      const r = vBrskalniku(pot, TUJA);
      if (!r) { je(pot + ': meritev je uspela', false, true); continue; }
      je(pot + ': tuja povezava je bila kliknjena',
        r.povezav > 0, true);
      je(pot + ': za tujo številko ni dogodka',
        r.dogodki.some(d => d.stevilka === TUJA), false);
      je(pot + ': vsi dogodki so na naši številki',
        r.dogodki.every(d => NASE_ST.includes(d.stevilka)), true);
    }
  }

  console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
  process.exit(ni ? 1 : 0);
})();
