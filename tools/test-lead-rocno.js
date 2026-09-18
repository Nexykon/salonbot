/*
  Ročno dodajanje leada: telefon in naslov gresta skozi vso pot.

      node tools/test-lead-rocno.js

  ZAKAJ OBSTAJA

    Obrazec "Dodaj ročno" je dolgo imel tri polja, uvoz seznama pa je
    telefon in naslov shranjeval. Kdor je lokal vpisal na roko, ga je
    torej vpisal brez telefona — in to se ni videlo nikjer, ker stolpca
    Telefon v tabeli ni bilo.

    Ob dodajanju polj se je pokazalo še eno: končna točka POST /api/leads
    je phone in address razpakirala stran. Obrazec bi ju pošiljal, strežnik
    bi ju tiho zavrgel, plošča pa bi kazala prazen stolpec — napaka, ki je
    videti kot "uporabnik pač ni vpisal telefona".

    Zato ta preizkus ne bere kode, ampak pelje pravo pot: pravi obrazec,
    pravi strežnik, prava baza, pravi izris tabele in pravo iskanje.

  KAJ POTREBUJE

    .env s SUPABASE_URL in SUPABASE_KEY. Vrstica v bazi se na koncu
    pobriše, tudi če preizkus pade.
*/
require('dotenv').config();
const { naloziStran, zazeni, naredFetch, stevec, sb, SB, SBK } = require('./plosca-preizkus');

const VRATA = 3099;
const KLJUC = 'preizkus-' + Math.random().toString(36).slice(2);

const IME = 'PREIZKUS Gostilna Telefon';
const BREZ = 'PREIZKUS Picerija Brez Naslova';
const EPOSTA = 'preizkus.telefon@primer.invalid';
const TELEFON = '040 987 654';
const NASLOV = 'Glavna cesta 1, 4000 Kranj';

const { trdi, konec } = stevec();
// Pobriše natanko svoji dve vrstici — ne vsega, kar se začne s "PREIZKUS",
// ker ima drug preizkus svoje in bi si znala priti navzkriž.
async function pocisti() {
  let n = 0;
  for (const ime of [IME, BREZ]) n += (await sb('DELETE', '/leads?business_name=eq.' + encodeURIComponent(ime))).length;
  return n;
}

(async () => {
  if (!SB || !SBK) { console.error('Manjka SUPABASE_URL ali SUPABASE_KEY.'); process.exit(1); }

  await pocisti(); // ostanki prejšnjega neuspelega zagona
  const streznik = await zazeni(VRATA, KLJUC);
  const dnevnik = [];
  const mojFetch = naredFetch(VRATA, KLJUC, dnevnik);

  try {
    console.log('\n1. Obrazec');
    const { okolje, dom, html, izvedi, vrstice } = naloziStran(mojFetch);

    trdi('polje m-phone obstaja v HTML', html.includes('id="m-phone"'));
    trdi('polje m-address obstaja v HTML', html.includes('id="m-address"'));
    trdi('stolpec Telefon je v glavi tabele', /<th>Email<\/th>\s*<th>Telefon<\/th>/.test(html));

    // Vpis v obrazec, kot bi ga natipkal človek.
    dom.document.getElementById('m-name').value = IME;
    dom.document.getElementById('m-email').value = EPOSTA;
    dom.document.getElementById('m-phone').value = TELEFON;
    dom.document.getElementById('m-address').value = NASLOV;
    dom.document.getElementById('m-cat').value = 'RESTAVRACIJE';

    console.log('\n2. Kaj obrazec pošlje');
    await okolje.addManual();
    const klic = dnevnik.find((k) => k.pot === '/api/leads' && k.nacin === 'POST');
    trdi('klic je šel na /api/leads', Boolean(klic));
    trdi('v telesu je telefon iz polja', klic && klic.telo.phone === TELEFON, klic && JSON.stringify(klic.telo.phone));
    trdi('v telesu je naslov iz polja', klic && klic.telo.address === NASLOV, klic && JSON.stringify(klic.telo.address));
    trdi('polja so po uspehu prazna',
      dom.document.getElementById('m-phone').value === '' && dom.document.getElementById('m-address').value === '');

    console.log('\n3. Kaj je pristalo v bazi');
    const v = await sb('GET', '/leads?select=*&business_name=eq.' + encodeURIComponent(IME));
    trdi('lead je v bazi', v.length === 1, 'najdenih ' + v.length);
    const l = v[0] || {};
    trdi('telefon je shranjen', l.phone === TELEFON, JSON.stringify(l.phone));
    trdi('naslov je shranjen', l.address === NASLOV, JSON.stringify(l.address));

    console.log('\n4. Izris tabele');
    await mojFetch.pocakaj(); // da osvežitev po dodajanju ne povozi seznama
    izvedi('allLeads = ' + JSON.stringify(v) + '; currentPage = 1; renderTable();');
    trdi('telefon je v vrstici', vrstice().includes(TELEFON));
    trdi('telefon je klicljiv (tel:)', vrstice().includes('href="tel:040987654"'), (vrstice().match(/href="tel:[^"]*"/) || [''])[0]);
    trdi('naslov je v vrstici', vrstice().includes(NASLOV));

    console.log('\n5. Iskanje po telefonski številki');
    for (const niz of ['040 987 654', '987 654', '040 987']) {
      okolje.setSearch(niz);
      trdi('»' + niz + '« najde lokal', vrstice().includes(IME));
    }
    okolje.setSearch('041 111 222');
    trdi('tuja številka ga ne najde', !vrstice().includes(IME));

    /*
      Meja, ki jo je vredno poznati: iskanje primerja dobesedno, zato
      "040987654" ne najde številke, zapisane s presledki. Preizkus to
      trdi namenoma — če se kdaj doda normalizacija, ta vrstica pade in
      opozori, da jo je treba popraviti, ne obratno.
    */
    okolje.setSearch('040987654');
    trdi('strnjen zapis (brez presledkov) NE najde — znana meja', !vrstice().includes(IME));

    /*
      6 · Lokal, ki ga imaš samo po telefonu.

      Prej je strežnik tak vpis zavrnil z "Manjkajo polja", ker je zahteval
      e-naslov — in to je ustavilo natanko tiste lokale, zaradi katerih sta
      stolpca Telefon in Naslov sploh nastala. Picerijo najdeš na Googlu s
      telefonom, e-naslova pa nikjer.
    */
    console.log('\n6. Lokal brez e-naslova');
    dom.document.getElementById('m-name').value = BREZ;
    dom.document.getElementById('m-email').value = '';
    dom.document.getElementById('m-phone').value = '041 222 333';
    dom.document.getElementById('m-address').value = '';
    dom.document.getElementById('m-cat').value = 'RESTAVRACIJE';
    dnevnik.length = 0;
    await okolje.addManual();
    /*
      Napaka strežnika ne pride v m-err, ampak v obvestilo — addLead jo ujame
      in pokaže kot toast. Prva različica te vrstice je gledala v m-err in je
      zato "držala" tudi takrat, ko je strežnik vpis zavrnil.
    */
    const obvestilo = dom.document.getElementById('toast');
    trdi('ni obvestila o napaki', !String(obvestilo.className).includes('error'), obvestilo.textContent);

    const b = await sb('GET', '/leads?select=*&business_name=eq.' + encodeURIComponent(BREZ));
    trdi('lokal je v bazi', b.length === 1, 'najdenih ' + b.length);
    trdi('e-naslov je prazen niz, ne null', b[0] && b[0].email === '', JSON.stringify(b[0] && b[0].email));
    trdi('telefon je shranjen', b[0] && b[0].phone === '041 222 333', b[0] && b[0].phone);

    izvedi('allLeads = ' + JSON.stringify(b) + '; currentSearch = ""; currentPage = 1; renderTable();');
    trdi('v tabeli dobi polje za vpis e-naslova', vrstice().includes('Vnesi email'));

    /*
      In ne pride v paket pošte: tools/paket.js izbira z email=neq. — ista
      poizvedba, ki tu ne sme vrniti ničesar.
    */
    const vPaketu = await sb('GET',
      '/leads?select=id&email=neq.&business_name=eq.' + encodeURIComponent(BREZ));
    trdi('izbor za pošto ga ne pobere', vPaketu.length === 0, 'vrnjenih ' + vPaketu.length);
  } finally {
    await mojFetch.pocakaj(); // da osveževanje seznama ne pade sredi klica
    streznik.kill();
    console.log('\n  počiščeno vrstic: ' + await pocisti());
  }

  konec();
})().catch((e) => { console.error('\nnapaka: ' + e.message); process.exit(1); });
