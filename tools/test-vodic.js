/*
  Preizkus: /api/vodic pove resnico o tem, ali je vodič res odšel.

    node tools/test-vodic.js

  Pošta se NE pošlje nikomur: src/email je podtaknjen, zato preizkus prebere
  natanko tisto, kar bi šlo v nabiralnik — vključno s priponko.

  Pogodba, ki jo preverjamo, je strožja kot pri /api/contact. Tam "success"
  pomeni "prijava je nekje, kjer jo bo človek videl". Tu stran obljubi
  konkretno stvar ("Vodič dobiš takoj") in stran za zahvalo pravi "Vodič je na
  poti" — zato uspeh velja samo, kadar je priponka res odšla.
*/
const fs = require('fs');
const path = require('path');

/* ── podtaknjeni moduli ────────────────────────────────────────────────── */
const podtakni = (rel, izvoz) => {
  const p = require.resolve(rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: izvoz };
};

let POSTA = [];
/*
  Pravi sendEmail vrne true ob uspehu in false ob neuspehu — na tej vrednosti
  stoji, ali sme obrazec javiti uspeh. Podtaknjeni mora vracati isto.
*/
let POSTA_USPE = true;
podtakni('../src/email', {
  sendEmail: async (na, zadeva, html, priponke) => { POSTA.push({ na, zadeva, html, priponke }); return POSTA_USPE; },
  preveriNastavitev: async () => true,
  send: async () => {}, sendMail: async () => {}, sendPasswordReset: async () => {}
});
podtakni('../src/whatsapp', Object.assign({}, require('../src/whatsapp'), {
  send: async () => ({ ok: true })
}));

/* ── gradniki ──────────────────────────────────────────────────────────── */
let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const a = JSON.stringify(dobil), b = JSON.stringify(pricakoval);
  if (a === b) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil:      ' + a + '\n      pričakoval: ' + b); }
}

const KOREN = path.join(__dirname, '..');
const LASTNIK = 'preizkus@example.invalid';

process.env.PORT = process.env.PORT || '3012';
process.env.FLOWTIQ_OWNER_EMAIL = LASTNIK;
delete process.env.WA_TOKEN;

/*
  Vodič mora obstajati, sicer preizkus ne more preveriti priponke. Če ga v
  repozitoriju ni, si ga za čas preizkusa ustvarimo sami in ga na koncu
  pobrišemo — preizkus ne sme biti odvisen od datoteke, ki je ni.
*/
const MAPA_VODIC = path.join(KOREN, 'vodic');
let zacasniPdf = null;
const imaPdf = (mapa) => { try { return fs.readdirSync(mapa).some(f => f.toLowerCase().endsWith('.pdf')); } catch (e) { return false; } };
// Iste mape, kot jih pregleda server.js — sicer bi preizkus delal nadomestek,
// čeprav pravi vodič že leži v repozitoriju.
const KJER_ISCE = [MAPA_VODIC, path.join(KOREN, 'public', 'assets'), path.join(KOREN, 'public')];
if (!KJER_ISCE.some(imaPdf)) {
  fs.mkdirSync(MAPA_VODIC, { recursive: true });
  zacasniPdf = path.join(MAPA_VODIC, '_preizkusni-vodic.pdf');
  // Najmanjši veljaven PDF — vsebina ni pomembna, pomembno je, da je datoteka.
  fs.writeFileSync(zacasniPdf, '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
}
const pospravi = () => {
  if (!zacasniPdf) return;
  try { fs.unlinkSync(zacasniPdf); fs.rmdirSync(MAPA_VODIC); } catch (e) { /* ni nujno */ }
};

const streznik = require('../server');

/*
  Bazo odklopimo ŠELE ZDAJ, ne prej: server.js ob nalaganju požene dotenv, ki
  izbrisane spremenljivke povrne iz .env. Ta past je test-kontakt že enkrat
  ujela — preizkus je tiho pisal v PRAVO bazo. Naslov usmerimo v prazno
  (vrata 9 = discard), da vsak poskus zapisa takoj pade.
*/
const BREZ_BAZE = () => { process.env.SUPABASE_URL = 'http://127.0.0.1:9'; process.env.SUPABASE_KEY = 'preizkus-brez-baze'; };
BREZ_BAZE();

(async () => {
  const naslov = 'http://127.0.0.1:' + process.env.PORT + '/api/vodic';
  await new Promise(r => setTimeout(r, 1400));

  const posljiObrazec = async (telo) => {
    POSTA = [];
    const r = await fetch(naslov, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(telo)
    });
    const odgovor = await r.json().catch(() => ({}));
    return {
      koda: r.status, odgovor,
      bralcu: POSTA.find(m => m.na !== LASTNIK),
      lastniku: POSTA.find(m => m.na === LASTNIK)
    };
  };

  console.log('\n1) E-pošta je obvezna in mora biti veljavna');
  for (const [opis, telo] of [
    ['prazno telo', {}],
    ['prazen niz', { email: '' }],
    ['brez afne', { email: 'kar-nekaj' }],
    ['brez domene', { email: 'ime@' }],
    ['brez pike', { email: 'ime@lokal' }]
  ]) {
    const r = await posljiObrazec(telo);
    je(opis + ' → 400', r.koda, 400);
  }
  const prazna = await posljiObrazec({ email: '' });
  je('odgovor pove, kaj je narobe', /e-naslov/i.test(prazna.odgovor.error || ''), true);
  je('ob zavrnitvi ne gre nobena pošta', POSTA.length, 0);

  console.log('\n2) Veljavna prijava: vodič gre bralcu s priponko');
  POSTA_USPE = true;
  const dobra = await posljiObrazec({ email: 'bralec@lokal.si' });
  je('obrazec je sprejet', dobra.koda, 200);
  je('pošta bralcu je nastala', !!dobra.bralcu, true);
  je('gre na vpisani naslov', (dobra.bralcu || {}).na, 'bralec@lokal.si');

  const pri = (dobra.bralcu || {}).priponke;
  je('priponka je pripeta', Array.isArray(pri) && pri.length === 1, true);
  je('priponka ima ime datoteke', !!(pri && pri[0] && /\.pdf$/i.test(pri[0].filename)), true);
  je('priponka ima vsebino', !!(pri && pri[0] && typeof pri[0].content === 'string' && pri[0].content.length > 20), true);
  je('vsebina je base64', !!(pri && pri[0] && /^[A-Za-z0-9+/=]+$/.test(pri[0].content)), true);

  console.log('\n3) Lastnik izve, da je nekdo vzel vodič');
  je('pošta lastniku je nastala', !!dobra.lastniku, true);
  je('v njej je e-naslov bralca', ((dobra.lastniku || {}).html || '').includes('bralec@lokal.si'), true);
  je('lastnikova pošta nima priponke', (dobra.lastniku || {}).priponke, undefined);

  console.log('\n4) Ko pošta pade in baze ni, obrazec ne sme javiti uspeha');
  POSTA_USPE = false;
  const padec = await posljiObrazec({ email: 'nekdo@lokal.si' });
  je('vrne 502, ne 200', padec.koda, 502);
  je('odgovor ne trdi uspeha', padec.odgovor.success === true, false);
  je('odgovor ponudi drugo pot', /WhatsApp 069 323 846|info@flowtek\.si/.test(padec.odgovor.error || ''), true);

  console.log('\n5) Ko pošta pade, zapis v bazo pa uspe — še vedno ni uspeh');
  /*
    Tu se pogodba razlikuje od /api/contact. Zapis nam pove, komu moramo vodič
    poslati ročno, a obiskovalcu ne smemo reči, da je na poti, če ni.
    Zapis ponaredimo tako, da bazo za hip usmerimo na naš lažni PostgREST.
  */
  const http = require('http');
  let zapisov = 0;
  const lazniSb = http.createServer((q, o) => { zapisov++; o.writeHead(201).end('[]'); });
  await new Promise(r => lazniSb.listen(3013, '127.0.0.1', r));
  process.env.SUPABASE_URL = 'http://127.0.0.1:3013';
  process.env.SUPABASE_KEY = 'lazni';

  const zapisan = await posljiObrazec({ email: 'zapisan@lokal.si' });
  je('zapis v bazo se je zgodil', zapisov > 0, true);
  je('kljub zapisu vrne 502', zapisan.koda, 502);

  await new Promise(r => lazniSb.close(r));
  BREZ_BAZE();

  console.log('\n6) Zapis nosi pravi vir in ime iz e-naslova');
  const zapisi = [];
  const lazniSb2 = http.createServer((q, o) => {
    let t = ''; q.on('data', d => t += d); q.on('end', () => { zapisi.push({ pot: q.url, telo: t }); o.writeHead(201).end('[]'); });
  });
  await new Promise(r => lazniSb2.listen(3014, '127.0.0.1', r));
  process.env.SUPABASE_URL = 'http://127.0.0.1:3014';
  process.env.SUPABASE_KEY = 'lazni';

  POSTA_USPE = true;
  await posljiObrazec({ email: 'marko.novak@picerija.si' });
  await new Promise(r => setTimeout(r, 200));
  const vKontakte = zapisi.find(z => z.pot.includes('sb_contacts'));
  je('vrstica gre v sb_contacts', !!vKontakte, true);
  const vrstica = vKontakte ? JSON.parse(vKontakte.telo) : {};
  je('source je "vodic"', vrstica.source, 'vodic');
  je('e-pošta je zapisana', vrstica.email, 'marko.novak@picerija.si');
  // sb_contacts.name je NOT NULL (migracija 009), obrazec pa imena ne zbira.
  je('ime ni null', vrstica.name != null && vrstica.name !== '', true);
  je('ime je lokalni del e-naslova', vrstica.name, 'marko.novak');

  await new Promise(r => lazniSb2.close(r));
  BREZ_BAZE();

  console.log('\n7) Stran in obrazec');
  const stran = fs.readFileSync(path.join(KOREN, 'public', 'vodic.html'), 'utf8');
  const hvala = fs.readFileSync(path.join(KOREN, 'public', 'vodic-hvala.html'), 'utf8');
  const polja = [...stran.matchAll(/<input[^>]*name="([^"]+)"/g)].map(m => m[1]);
  je('obrazec ima natanko eno polje', polja, ['email']);
  je('polje je e-pošta', /type="email"/.test(stran), true);
  je('gumb se glasi "Pošlji mi vodič"', /Pošlji mi vodič/.test(stran), true);
  je('obljuba pod gumbom je tam', /Vodič dobiš takoj/.test(stran), true);

  je('dogodek NI na pristajalni strani', /generate_lead/.test(stran), false);
  je('dogodek je na strani za zahvalo', /gtag\('event', 'generate_lead', \{ method: 'vodic' \}\)/.test(hvala), true);
  je('stran za zahvalo je noindex', /<meta name="robots" content="noindex">/.test(hvala), true);
  je('pristajalna stran NI noindex', /content="noindex"/.test(stran), false);

  console.log('\n8) Samo živi telefonski številki');
  for (const [ime, vsebina] of [['vodic.html', stran], ['vodic-hvala.html', hvala]]) {
    je(ime + ': ni mrtve 040 599 185', /599\s?185|38640599185/.test(vsebina), false);
    je(ime + ': demo številka je prava', /38669323814/.test(vsebina), true);
  }
  /*
    Podporna številka 069 323 846 je v NOGI vsake strani in tja sodi. Preverimo
    torej vsebino strani brez noge: tam sme stati samo demo številka, sicer bi
    bralec pisal podpori namesto pomočniku.
  */
  const brezNoge = (h) => h.slice(0, h.indexOf('<footer'));
  je('v vsebini vodic.html je samo demo številka',
    /069 323 846|38669323846/.test(brezNoge(stran)), false);
  je('v vsebini vodic-hvala.html je samo demo številka',
    /069 323 846|38669323846/.test(brezNoge(hvala)), false);

  console.log('\n9) Brez izmišljenih številk in navedkov');
  const sumljivo = /\b\d+\s?%|\bveč kot \d+|\braziskav|\bstudij|\bpovpre[čc]no \d/i;
  je('vodic.html brez odstotkov in raziskav', sumljivo.test(stran.replace(/<script[\s\S]*?<\/script>/g, '')), false);
  je('vodic-hvala.html brez odstotkov in raziskav', sumljivo.test(hvala.replace(/<script[\s\S]*?<\/script>/g, '')), false);

  pospravi();
  console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
  process.exit(ni ? 1 : 0);
})();
