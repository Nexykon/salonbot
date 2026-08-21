/*
  Preizkus ujemanja kraja in cene dostave — src/dostava.js.
  Brez baze in brez omrežja: samo vhod → izhod, na Botaninem pravem ceniku.

    node tools/test-dostava.js
*/
const d = require('../src/dostava');

let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const a = JSON.stringify(dobil), b = JSON.stringify(pricakoval);
  if (a === b) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil:      ' + a + '\n      pričakoval: ' + b); }
}

// ── Botanin cenik (kot na listu) ───────────────────────────────────────────
const BOTANA = [
  ['Vodice', 2], ['Sp. Brnik', 2], ['Komenda', 2],
  ['Šenčur', 3], ['Zg. Brnik', 3], ['Dvorje', 3], ['Mengeš', 3], ['Vašca', 3],
  ['Žeje pri Komendi', 3], ['Bukovica pri Vodicah', 3], ['Polje pri Vodicah', 3],
  ['Repnje pri Vodicah', 3], ['Poženik', 3], ['Topole', 3], ['Cerklje', 3],
  ['Domžale', 4], ['Trgovski center Arkada', 4], ['Zapoge', 4], ['Dornice', 4],
  ['Voklo', 4], ['Selo pri Vodicah', 4], ['Škaručna', 4],
  ['Kamnik', 5], ['Velesovo', 5], ['Utik', 5], ['Hraše', 5], ['Ablož', 5],
  ['Homec', 5], ['Vojsko', 5],
  ['Dolsko', 6], ['Koseze', 6], ['Češnjevek', 6], ['Pšata', 6],
  ['Beričevo', 6], ['Dol pri Ljubljani', 6], ['Laze pri Dolskem', 6]
].map(([kraj, cena]) => ({ kraj, cena }));

const salon = { delivery_zones: BOTANA, delivery_fee: 0 };
const cena = naslov => {
  const r = d.strosek(salon, naslov);
  return r.neznana ? 'neznana' : r.cena;
};
const kraj = naslov => {
  const r = d.strosek(salon, naslov);
  return r.neznana ? 'neznana' : r.kraj;
};

console.log('\n1) Naslovi, kot jih stranke res napišejo');
{
  je('suhadole 59b komenda → 2 €', cena('suhadole 59b komenda'), 2);
  je('Vodice 12 → 2 €', cena('Vodice 12'), 2);
  je('Glavna 5, Šenčur → 3 €', cena('Glavna 5, Šenčur'), 3);
  je('Domžale, Ljubljanska 20 → 4 €', cena('Domžale, Ljubljanska 20'), 4);
  je('Kamnik, Maistrova 3 → 5 €', cena('Kamnik, Maistrova 3'), 5);
  je('Dol pri Ljubljani 7 → 6 €', cena('Dol pri Ljubljani 7'), 6);
}

console.log('\n2) Najbolj določen kraj zmaga (past: vse z "Vodicah" bi bilo 2 €)');
{
  je('Selo pri Vodicah 3 → 4 €, ne 2 €', cena('Selo pri Vodicah 3'), 4);
  je('… in kraj je pravi', kraj('Selo pri Vodicah 3'), 'Selo pri Vodicah');
  je('Bukovica pri Vodicah 1 → 3 €', cena('Bukovica pri Vodicah 1'), 3);
  je('Repnje pri Vodicah → 3 €', cena('Repnje pri Vodicah'), 3);
  je('Polje pri Vodicah → 3 €', cena('Polje pri Vodicah'), 3);
  je('Žeje pri Komendi → 3 €, ne 2 €', cena('Žeje pri Komendi 8'), 3);
  je('same Vodice ostanejo 2 €', cena('Vodice, Kopitarjeva 4'), 2);
}

console.log('\n3) Podobna imena se NE zamenjajo');
{
  je('Dolsko → 6 €, ne Dol pri Ljubljani', kraj('Dolsko 5'), 'Dolsko');
  je('Dol pri Ljubljani → svoj kraj', kraj('Dol pri Ljubljani 2'), 'Dol pri Ljubljani');
  je('Laze pri Dolskem → svoj kraj', kraj('Laze pri Dolskem 10'), 'Laze pri Dolskem');
  je('Komenda ni Kamnik', kraj('Komenda 4'), 'Komenda');
  je('Kamnik ni Komenda', kraj('Kamnik 4'), 'Kamnik');
  je('Cerklje niso Cerknica', cena('Cerknica 12'), 'neznana');
  // Vojsko in Dolsko se razlikujeta v dveh črkah, cena pa za 1 €
  je('Vojsko → 5 €', cena('Vojsko 1'), 5);
  je('Dolsko → 6 €', cena('Dolsko 1'), 6);
  je('Vojsko ni Dolsko', kraj('Vojsko 1'), 'Vojsko');
  je('Voklo ni Vojsko', kraj('Voklo 2'), 'Voklo');
  je('Dvorje ni Dornice', kraj('Dvorje 3'), 'Dvorje');
  je('Koseze niso Komenda', kraj('Koseze 4'), 'Koseze');
}

console.log('\n4) Okrajšave Sp. / Zg.');
{
  je('Zgornji Brnik 12 → 3 €', cena('Zgornji Brnik 12'), 3);
  je('Zg. Brnik 12 → 3 €', cena('Zg. Brnik 12'), 3);
  je('Spodnji Brnik 4 → 2 €', cena('Spodnji Brnik 4'), 2);
  je('Sp. Brnik 4 → 2 €', cena('Sp. Brnik 4'), 2);
}

console.log('\n5) Dvoumnost ni ugibanje');
{
  // "Brnik" brez oznake ne ujame ne Sp. ne Zg. Brnika (kraj zahteva obe
  // besedi), zato je izid neznan kraj — cena se ne ugane.
  je('sam "Brnik" → neznana (Sp. 2 €, Zg. 3 €)', cena('Brnik 5'), 'neznana');

  // Dvoumnost nastane, kadar sta v ceniku dva zelo podobna kraja z RAZLIČNO
  // ceno — tipičen vnosni spodrsljaj. Takrat cene prav tako ne ugibamo.
  const spodrsljaj = { delivery_zones: [{ kraj: 'Vodice', cena: 2 }, { kraj: 'Vodica', cena: 5 }] };
  const r = d.strosek(spodrsljaj, 'Vodice 12');
  je('podobna kraja z različno ceno → neznana', r.neznana, true);
  je('… in povemo, katera sta', r.dvoumno, ['Vodice', 'Vodica']);
  je('… cene ne ugibamo', r.cena, 0);

  // Enako dobro ujemanje z ISTO ceno ni dvoumnost, le dve poimenovanji
  const isto = { delivery_zones: [{ kraj: 'Vodice', cena: 2 }, { kraj: 'Vodica', cena: 2 }] };
  je('podobna kraja z isto ceno sta v redu', d.strosek(isto, 'Vodice 12').cena, 2);
}

console.log('\n6) Skloni');
{
  je('v Vodicah → 2 €', cena('v Vodicah 3'), 2);
  je('v Komendi → 2 €', cena('Gmajnica 1, Komendi'), 2);
  je('v Domžalah → 4 €', cena('Domžalah, Krumperška 2'), 4);
  je('v Kamniku → 5 €', cena('Kamniku, Šutna 1'), 5);
  je('v Mengšu → 3 €', cena('Mengšu, Slovenska 5'), 3);
  je('v Homcu → 5 €', cena('Homcu 14'), 5);
  je('v Šenčurju → 3 €', cena('Šenčurju, Delavska 7'), 3);
  je('v Hrašah → 5 €', cena('Hrašah 2'), 5);
  je('na Pšati → 6 €', cena('Pšati 9'), 6);
}

console.log('\n6b) Hišna številka, zlepljena z imenom, in tipkarske napake strank');
{
  // Iz pravih naročil: stranka je napisala "Dvprje15" — napaka IN brez presledka
  je('Dvorje15 (brez presledka)', cena('Dvorje15'), 3);
  je('Dvprje15 (napaka + brez presledka)', cena('Dvprje15'), 3);
  je('Dvprje 15 (napaka s presledkom)', cena('Dvprje 15'), 3);
  je('Vodice12', cena('Vodice12'), 2);
  je('Komenda,5', cena('Komenda,5'), 2);
  je('Kamnik3a', cena('Kamnik3a'), 5);
  je('poštna številka ne moti', cena('Dvorje 14 4207 cerklje'), 3);
  // Napaka ne sme ujeti napačnega kraja
  je('Vodce 4 → Vodice', kraj('Vodce 4'), 'Vodice');
  je('Kamnk 2 → Kamnik', kraj('Kamnk 2'), 'Kamnik');
  je('Dolske 1 → Dolsko', kraj('Dolske 1'), 'Dolsko');
}

console.log('\n7) Neznan kraj');
{
  je('Ljubljana Bežigrad → neznana', cena('Ljubljana Bežigrad, Vojkova 5'), 'neznana');
  je('Maribor → neznana', cena('Maribor, Partizanska 1'), 'neznana');
  je('samo hišna številka → neznana', cena('12b'), 'neznana');
  je('prazen naslov → neznana', cena(''), 'neznana');
  je('naslov brez kraja → neznana', cena('Cesta na Brdo 15'), 'neznana');
  const r = d.strosek(salon, 'Maribor');
  je('cena je 0 in ne ugibana', r.cena, 0);
}

console.log('\n8) Brez vpisanih krajev velja enotna cena (staro vedenje)');
{
  const stari = { delivery_zones: null, delivery_fee: 3 };
  const r = d.strosek(stari, 'Kjerkoli 5');
  je('enotna cena', r.cena, 3);
  je('ni neznana', r.neznana, false);
  je('kraja ni', r.kraj, null);
  je('prazno polje krajev', d.poKrajih(stari), false);
  je('lokal s kraji', d.poKrajih(salon), true);
  je('enotna cena velja tudi brez naslova', d.strosek(stari, '').cena, 3);
}

console.log('\n9) Preverjanje vpisanih krajev');
{
  je('prazno polje', d.varneZone([]), null);
  je('ni polje', d.varneZone({ kraj: 'X', cena: 1 }), null);
  je('pokvarjen JSON', d.varneZone('[[['), null);
  je('niz se prebere', d.varneZone('[{"kraj":"Vodice","cena":2}]'), [{ kraj: 'Vodice', cena: 2 }]);
  je('kraj brez imena se izpusti', d.varneZone([{ kraj: '  ', cena: 2 }]), null);
  je('cena z vejico', d.varneZone([{ kraj: 'Vodice', cena: '2,50' }]), [{ kraj: 'Vodice', cena: 2.5 }]);
  je('cena 0 je veljavna (brezplačna dostava)', d.varneZone([{ kraj: 'Vodice', cena: 0 }]), [{ kraj: 'Vodice', cena: 0 }]);
  je('negativna cena se izpusti', d.varneZone([{ kraj: 'Vodice', cena: -2 }]), null);
  je('previsoka cena se izpusti', d.varneZone([{ kraj: 'Vodice', cena: 500 }]), null);
  je('smeti v ceni se izpustijo', d.varneZone([{ kraj: 'Vodice', cena: 'abc' }]), null);
  je('podvojen kraj se strne (obdrži prvega)',
    d.varneZone([{ kraj: 'Vodice', cena: 2 }, { kraj: 'VODICE', cena: 5 }]),
    [{ kraj: 'Vodice', cena: 2 }]);
  je('podvojen s šumniki in presledki se strne',
    d.varneZone([{ kraj: 'Šenčur', cena: 3 }, { kraj: ' šencur ', cena: 4 }]).length, 1);
  const veliko = Array.from({ length: 400 }, (_, i) => ({ kraj: 'Kraj' + i, cena: 1 }));
  je('največ ' + d.MAX_KRAJEV + ' krajev', d.varneZone(veliko).length, d.MAX_KRAJEV);
}

console.log('\n10) Cena 0 pri kraju pomeni brezplačno dostavo, ne neznano');
{
  const s = { delivery_zones: [{ kraj: 'Vodice', cena: 0 }], delivery_fee: 5 };
  const r = d.strosek(s, 'Vodice 3');
  je('cena 0', r.cena, 0);
  je('ni neznana', r.neznana, false);
  je('kraj je znan', r.kraj, 'Vodice');
}

console.log('\n11) Strnjeno po cenah (za prikaz)');
{
  const p = d.poCenah(salon);
  je('pet cenovnih razredov', p.length, 5);
  je('najcenejši razred je 2 €', p[0].cena, 2);
  je('v njem trije kraji', p[0].kraji.length, 3);
  je('najdražji razred je 6 €', p[p.length - 1].cena, 6);
  for (const r of p) console.log('      ' + r.cena.toFixed(2) + ' € — ' + r.kraji.join(', '));
}

console.log('\n12) Botanin cenik je konsistenten');
{
  const z = d.varneZone(BOTANA);
  je('vseh 36 krajev je sprejetih', z.length, BOTANA.length);
  // Vsak kraj mora sam sebe najti po svoji ceni
  const napake = [];
  for (const x of BOTANA) {
    const r = d.strosek(salon, x.kraj + ' 1');
    if (r.neznana || r.cena !== x.cena) napake.push(x.kraj + ' → ' + (r.neznana ? 'neznana' : r.cena + ' €'));
  }
  je('vsak kraj najde svojo ceno', napake, []);
}

console.log('\n13) Zneski skupaj z embalažo (prava koda computeTotals)');
{
  const { computeTotals } = require('../src/ai-order');
  const bot = {
    delivery_zones: BOTANA, delivery_fee: 0,
    packaging_price: 0, pickup_packaging: true
  };
  const kosarica = [
    { name: 'Botana', price: 12.5, qty: 2, pack: 0.6 },
    { name: 'Bufalo mozzarella', price: 3.5, qty: 1, pack: 0.4 }
  ];

  const komenda = computeTotals(bot, kosarica, 'dostava', null, 'Suhadole 59b, Komenda');
  je('artikli', +komenda.itemsTotal.toFixed(2), 28.5);
  je('embalaža', komenda.packFee, 1.6);
  je('dostava Komenda', komenda.delFee, 2);
  je('skupaj', komenda.grand, '32.10');
  je('brez pripisa o dostavi', komenda.grandText, '32.10 €');
  je('v razčlenitvi je kraj', komenda.vrstice[2], '🚗 Dostava:  2.00 € (Komenda)');
  console.log('      ' + komenda.text);

  const kamnik = computeTotals(bot, kosarica, 'dostava', null, 'Kamnik, Šutna 1');
  je('dostava Kamnik', kamnik.delFee, 5);
  je('skupaj', kamnik.grand, '35.10');

  const neznan = computeTotals(bot, kosarica, 'dostava', null, 'Maribor, Partizanska 1');
  je('neznan kraj: dostave ni v znesku', neznan.delFee, 0);
  je('neznan kraj: označeno', neznan.delNeznana, true);
  je('neznan kraj: znesek ni dokončen', neznan.grandText, '30.10 € + dostava');
  je('neznan kraj: vrstica pove, kaj sledi', neznan.vrstice[2], '🚗 Dostava:  sporočimo ob potrditvi');
  console.log('      ' + neznan.text);

  const brezNaslova = computeTotals(bot, kosarica, 'dostava', null, null);
  je('naslova še ni: dostava nedoločena', brezNaslova.delNeznana, true);
  je('naslova še ni: brez izmišljene cene', brezNaslova.delFee, 0);

  const prevzem = computeTotals(bot, kosarica, 'prevzem', null, 'Komenda 1');
  je('prevzem: brez dostave', prevzem.delFee, 0);
  je('prevzem: ni nedoločena', prevzem.delNeznana, false);
  je('prevzem: znesek dokončen', prevzem.grandText, '30.10 €');

  const stari = { delivery_zones: null, delivery_fee: 3, packaging_price: 0, pickup_packaging: true };
  const s = computeTotals(stari, kosarica, 'dostava', null, 'Kjerkoli 5');
  je('brez krajev velja enotna cena', s.delFee, 3);
  je('… in znesek je dokončen', s.grandText, '33.10 €');
  je('… brez imena kraja v razčlenitvi', s.vrstice[2], '🚗 Dostava:  3.00 €');
}

console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
process.exit(ni ? 1 : 0);
