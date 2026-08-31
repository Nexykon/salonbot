/*
  Preizkus: e-pošta s kontaktnega obrazca ima ISTA imena polj kot obrazec.

    node tools/test-kontakt.js

  Pošta se NE pošlje nikomur: src/email in src/whatsapp sta podtaknjena, zato
  preizkus prebere natanko tisto, kar bi šlo v nabiralnik. Zapis v bazo je
  prav tako prestrežen.

  Imena polj se preberejo iz public/kontakt.html — če kdo preimenuje polje na
  strani in pozabi na pošto, preizkus pade.
*/
const fs = require('fs');
const path = require('path');

/* ── podtaknjeni moduli ────────────────────────────────────────────────── */
const podtakni = (rel, izvoz) => {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: izvoz };
};

let POSTA = [];
podtakni('../src/email', {
  sendEmail: async (na, zadeva, html) => { POSTA.push({ na, zadeva, html }); },
  send: async () => {}, sendMail: async () => {}, sendPasswordReset: async () => {}
});
let WA = [];
const pravWa = require('../src/whatsapp');
podtakni('../src/whatsapp', Object.assign({}, pravWa, {
  send: async (phoneId, token, msg) => { WA.push(msg); return { ok: true }; }
}));

/* ── gradniki ──────────────────────────────────────────────────────────── */
let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const a = JSON.stringify(dobil), b = JSON.stringify(pricakoval);
  if (a === b) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil:      ' + a + '\n      pričakoval: ' + b); }
}

const KOREN = path.join(__dirname, '..');
const stran = fs.readFileSync(path.join(KOREN, 'public', 'kontakt.html'), 'utf8');

// Imena polj, kot jih vidi obiskovalec — vzeta iz <label> na obrazcu.
const oznakeNaStrani = [...stran.matchAll(/<label for="f-[a-z]+">([^<]+)<\/label>/g)]
  .map(m => m[1].replace(/\s*\*\s*$/, '').trim());
console.log('imena polj na strani: ' + oznakeNaStrani.join(' | '));

/* ── zaženi pravo pot /api/contact prek supertest-like klica ───────────── */
const express = require('express');
const app = express();
app.use(express.json());

// Prepiši samo tisto, kar potrebuje ta pot, in vključi pravo kodo iz server.js
// prek majhne kopije: pot je kratka, zato jo pokličemo prek pravega strežnika.
process.env.PORT = process.env.PORT || '3011';
process.env.FLOWTIQ_OWNER_EMAIL = 'preizkus@example.invalid';
delete process.env.WA_TOKEN;      // brez WhatsApp obvestila v tem preizkusu
delete process.env.SUPABASE_URL;  // brez zapisa v bazo
delete process.env.SUPABASE_KEY;

const streznik = require('../server');

(async () => {
  const naslov = 'http://127.0.0.1:' + process.env.PORT + '/api/contact';
  await new Promise(r => setTimeout(r, 1200));

  const posljiObrazec = async (telo) => {
    POSTA = []; WA = [];
    const r = await fetch(naslov, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(telo)
    });
    return { koda: r.status, lastniku: POSTA.find(m => m.na === 'preizkus@example.invalid'), prosilcu: POSTA.find(m => m.na !== 'preizkus@example.invalid') };
  };

  console.log('\n1) Nova stran pošlje polja ločeno');
  const nova = await posljiObrazec({
    name: 'Maja Novak', email: 'maja@salon.si', phone: '040 599 185',
    business_type: 'Frizerski saloni · Salon Vita — želja: opomniki',
    lokal: 'Salon Vita', panoga: 'Frizerski saloni', zelja: 'opomniki dan prej', soglasje: true
  });
  je('obrazec je sprejet', nova.koda, 200);
  je('pošta lastniku je nastala', !!nova.lastniku, true);
  const h = (nova.lastniku || {}).html || '';

  console.log('\n2) Imena polj v pošti so ista kot na strani');
  for (const oznaka of oznakeNaStrani) {
    je('"' + oznaka + '"', h.includes(oznaka), true);
  }
  je('stare oznake "Vrsta posla" ni več', /Vrsta posla/.test(h), false);
  je('stare oznake "Email" ni več', /<td[^>]*>Email<\/td>/.test(h), false);
  je('stare oznake "Ime" (samostojne) ni več', /<td[^>]*>Ime<\/td>/.test(h), false);

  console.log('\n3) Vrednosti so vsaka v svoji vrstici');
  for (const [opis, v] of [['ime', 'Maja Novak'], ['telefon', '040 599 185'], ['e-pošta', 'maja@salon.si'],
    ['lokal', 'Salon Vita'], ['panoga', 'Frizerski saloni'], ['želja', 'opomniki dan prej']]) {
    je(opis, h.includes(v), true);
  }
  je('soglasje je zapisano', /Soglasje za kontakt[\s\S]{0,120}da/.test(h), true);
  je('zlepljenega niza ni več v telesu', h.includes('· Salon Vita — želja:'), false);

  console.log('\n4) Zadeva pošte');
  je('vsebuje ime lokala', (nova.lastniku.zadeva || '').includes('Salon Vita'), true);
  je('vsebuje panogo', (nova.lastniku.zadeva || '').includes('Frizerski saloni'), true);

  console.log('\n5) Potrditev prosilcu');
  je('gre na njegov naslov', (nova.prosilcu || {}).na, 'maja@salon.si');
  je('brez manjkajočih šumnikov', /uspesno|Nasi|narocil/.test((nova.prosilcu || {}).html || ''), false);

  console.log('\n6) Starejša stran iz predpomnilnika (samo business_type)');
  const stara = await posljiObrazec({
    name: 'Janez Kos', email: 'janez@lokal.si', phone: '041 000 000',
    business_type: 'Picerije · Pri Lipi'
  });
  je('obrazec je sprejet', stara.koda, 200);
  const hs = (stara.lastniku || {}).html || '';
  je('izpiše se kot ena vrstica', /Vrsta posla/.test(hs), true);
  je('vrednost je cela', hs.includes('Picerije · Pri Lipi'), true);
  je('ime in e-pošta imata novi oznaki', hs.includes('Ime in priimek') && hs.includes('E-pošta'), true);

  console.log('\n7) Soglasje je obvezno tudi na strežniku');
  // Prej je bila kljukica preverjena samo v brskalniku — torej jo je bilo
  // mogoče obiti in o soglasju ni bilo nikakršnega zapisa.
  POSTA = [];
  const brezSoglasja = await fetch(naslov, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Brez Soglasja', email: 'x@y.si', phone: '040', business_type: 'x',
      lokal: 'L', panoga: 'Drugo', zelja: '', soglasje: false })
  });
  const bsOdgovor = await brezSoglasja.json().catch(() => ({}));
  je('neoznačeno soglasje je zavrnjeno', brezSoglasja.status, 400);
  je('odgovor pojasni, zakaj', /soglasje/i.test(bsOdgovor.error || ''), true);
  je('nobena pošta ni šla', POSTA.length, 0);
  // Starejša stran iz predpomnilnika soglasja ne pošlje — takrat ne zavračamo.
  const brezPolja = await posljiObrazec({ name: 'Stara Stran', email: 'a@b.si', phone: '040', business_type: 'Drugo · X' });
  je('manjkajoče polje ne zavrne prijave', brezPolja.koda, 200);
  je('v pošti piše, da podatka ni', /ni podatka/.test((brezPolja.lastniku || {}).html || ''), true);

  console.log('\n8) Povezava v soglasju se odpre v novem zavihku');
  je('target="_blank" in rel="noopener"',
    /<a href="\/varnost\.html" target="_blank" rel="noopener">/.test(stran), true);
  je('bralec vidi, da gre v nov zavihek', /Več o zasebnosti ↗/.test(stran), true);

  console.log('\n9) Vnos ne more vriniti oznak v pošto');
  const zlonamerno = await posljiObrazec({
    name: '<img src=x onerror=alert(1)>', email: 'x@y.si', phone: '<b>040</b>',
    business_type: 'x', lokal: '<script>alert(2)</script>', panoga: 'Drugo', zelja: '', soglasje: true
  });
  const hz = (zlonamerno.lastniku || {}).html || '';
  je('oznake so ubežane', /<img src=x|<script>alert/.test(hz), false);
  je('besedilo je vidno kot besedilo', hz.includes('&lt;img src=x'), true);

  console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
  process.exit(ni ? 1 : 0);
})();
