/*
  Preizkus zneskov embalaže. Dva načina, ki se izključujeta:
    1) enotna cena za CELOTNO naročilo (sb_salons.packaging_price > 0)
    2) cena po artiklu (sb_services.packaging_price); prazno ali 0 = brez
  Brez obojega je embalaža brezplačna.

  Brez baze in brez omrežja — samo vhod → izhod na pravi kodi (computeTotals).

    node tools/test-embalaza.js
*/
const { computeTotals, packOfService, hasExtras } = require('../src/ai-order');

let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const a = JSON.stringify(dobil), b = JSON.stringify(pricakoval);
  if (a === b) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil:      ' + a + '\n      pričakoval: ' + b); }
}

const lokal = (d) => Object.assign({ packaging_price: 0, delivery_fee: 0, pickup_packaging: true }, d);

console.log('\n1) Enotna cena za CELOTNO naročilo (vrečka 1 €)');
{
  const s = lokal({ packaging_price: 1 });
  je('en artikel → 1,00 €', computeTotals(s, [{ name: 'Pica', price: 8, qty: 1 }], 'dostava').packFee, 1);
  je('pet kosov → še vedno 1,00 €', computeTotals(s, [{ name: 'Pica', price: 8, qty: 5 }], 'dostava').packFee, 1);
  je('tri vrstice → še vedno 1,00 €', computeTotals(s, [
    { name: 'A', price: 5, qty: 2 }, { name: 'B', price: 3, qty: 1 }, { name: 'C', price: 2, qty: 4 }
  ], 'dostava').packFee, 1);
  je('prazna košarica → 0', computeTotals(s, [], 'dostava').packFee, 0);
  je('brez zmnožka v razčlenitvi', computeTotals(s, [{ name: 'Pica', price: 8, qty: 3 }], 'dostava').packText, '1.00 €');
  je('skupaj', computeTotals(s, [{ name: 'Pica', price: 8, qty: 2 }], 'dostava').grand, '17.00');
}

console.log('\n2) Enotna cena PREVLADA nad cenami pri artiklih');
{
  const s = lokal({ packaging_price: 1 });
  const cart = [{ name: 'Pica', price: 8, qty: 2, pack: 0.6 }, { name: 'Gobe', price: 1.5, qty: 3, pack: 0.4 }];
  // po artiklih bi bilo 2×0,60 + 3×0,40 = 2,40; enotna cena to povozi
  je('šteje samo enotna cena', computeTotals(s, cart, 'dostava').packFee, 1);
  je('skupaj', computeTotals(s, cart, 'dostava').grand, '21.50');
}

console.log('\n3) Cena po artiklu (enotna cena ni nastavljena)');
{
  const s = lokal({ packaging_price: 0 });
  const cart = [{ name: 'Pica', price: 8, qty: 2, pack: 0.6 }, { name: 'Gobe', price: 1.5, qty: 3, pack: 0.4 }];
  je('2 × 0,60 + 3 × 0,40 = 2,40', computeTotals(s, cart, 'dostava').packFee, 2.4);
  je('pri različnih cenah le vsota', computeTotals(s, cart, 'dostava').packText, '2.40 €');
  const iste = [{ name: 'A', price: 8, qty: 3, pack: 0.6 }];
  je('pri isti ceni tudi zmnožek', computeTotals(s, iste, 'dostava').packText, '3 × 0.60 € = 1.80 €');
}

console.log('\n4) Pri artiklu prazno ali 0 pomeni BREZ embalaže');
{
  const s = lokal({ packaging_price: 0 });
  je('cena 0', computeTotals(s, [{ name: 'Cola', price: 2.5, qty: 4, pack: 0 }], 'dostava').packFee, 0);
  je('brez polja', computeTotals(s, [{ name: 'Cola', price: 2.5, qty: 4 }], 'dostava').packFee, 0);
  je('null', computeTotals(s, [{ name: 'Cola', price: 2.5, qty: 4, pack: null }], 'dostava').packFee, 0);
  je('prazen niz', computeTotals(s, [{ name: 'Cola', price: 2.5, qty: 4, pack: '' }], 'dostava').packFee, 0);
  je('mešano: samo pica se šteje', computeTotals(s, [
    { name: 'Pica', price: 8, qty: 1, pack: 0.6 }, { name: 'Cola', price: 2.5, qty: 4, pack: 0 }
  ], 'dostava').packFee, 0.6);
}

console.log('\n5) Brez obojega je embalaža brezplačna');
{
  const s = lokal({ packaging_price: 0 });
  const t = computeTotals(s, [{ name: 'Pica', price: 8, qty: 3 }], 'dostava');
  je('embalaža 0', t.packFee, 0);
  je('v razčlenitvi ni vrstice embalaže', t.vrstice.length, 1);
  je('skupaj so samo artikli', t.grand, '24.00');
}

console.log('\n6) Osebni prevzem');
{
  const cart = [{ name: 'Pica', price: 8, qty: 2, pack: 0.6 }];
  const enotna = lokal({ packaging_price: 1, delivery_fee: 3 });
  const enotnaBrez = lokal({ packaging_price: 1, delivery_fee: 3, pickup_packaging: false });
  const poArtiklu = lokal({ delivery_fee: 3 });
  const poArtikluBrez = lokal({ delivery_fee: 3, pickup_packaging: false });
  je('pri prevzemu ni dostave', computeTotals(enotna, cart, 'prevzem').delFee, 0);
  je('enotna cena velja tudi pri prevzemu', computeTotals(enotna, cart, 'prevzem').packFee, 1);
  je('enotna cena izklopljena pri prevzemu', computeTotals(enotnaBrez, cart, 'prevzem').packFee, 0);
  je('cena po artiklu pri prevzemu', computeTotals(poArtiklu, cart, 'prevzem').packFee, 1.2);
  je('cena po artiklu izklopljena pri prevzemu', computeTotals(poArtikluBrez, cart, 'prevzem').packFee, 0);
}

console.log('\n7) Nenavadne vrednosti');
{
  const s = lokal({ packaging_price: 0 });
  je('smeti v ceni artikla → brez embalaže', computeTotals(s, [{ name: 'X', price: 5, qty: 1, pack: 'abc' }], 'dostava').packFee, 0);
  je('negativna cena artikla → brez embalaže', computeTotals(s, [{ name: 'X', price: 5, qty: 1, pack: -2 }], 'dostava').packFee, 0);
  je('negativna enotna cena se ne šteje', computeTotals(lokal({ packaging_price: -5 }), [{ name: 'X', price: 5, qty: 1 }], 'dostava').packFee, 0);
  je('brez količine šteje kot 1', computeTotals(s, [{ name: 'X', price: 5, pack: 0.6 }], 'dostava').packFee, 0.6);
  je('dostava se šteje tudi pri prazni košarici', computeTotals(lokal({ delivery_fee: 3 }), [], 'dostava').delFee, 3);
}

console.log('\n8) Zaokroževanje');
{
  const s = lokal({ packaging_price: 0 });
  const cart = Array.from({ length: 3 }, () => ({ name: 'X', price: 0.1, qty: 1, pack: 0.1 }));
  je('3 × 0,10 = 0,30 in ne 0,30000000000000004', computeTotals(s, cart, 'prevzem').packFee, 0.3);
  je('skupaj 0,60', computeTotals(s, cart, 'prevzem').grand, '0.60');
}

console.log('\n9) Razčlenitev za WhatsApp');
{
  const enotna = computeTotals(lokal({ packaging_price: 1, delivery_fee: 3 }), [{ name: 'Pica', price: 8, qty: 2 }], 'dostava');
  je('tri vrstice', enotna.vrstice.length, 3);
  je('artikli', enotna.vrstice[0], '💰 Artikli: 16.00 €');
  je('embalaža na naročilo', enotna.vrstice[1], '📦 Embalaža: 1.00 €');
  je('dostava', enotna.vrstice[2], '🚗 Dostava:  3.00 €');
  const poArt = computeTotals(lokal({ delivery_fee: 0 }), [{ name: 'Pica', price: 8, qty: 2, pack: 0.6 }], 'dostava');
  je('embalaža po artiklu z zmnožkom', poArt.vrstice[1], '📦 Embalaža: 2 × 0.60 € = 1.20 €');
}

console.log('\n10) Cena embalaže z artikla menija');
{
  je('številka', packOfService({ packaging_price: 0.6 }), 0.6);
  je('ničla', packOfService({ packaging_price: 0 }), 0);
  je('niz s piko', packOfService({ packaging_price: '0.40' }), 0.4);
  je('null', packOfService({ packaging_price: null }), null);
  je('prazen niz', packOfService({ packaging_price: '' }), null);
  je('manjkajoče polje', packOfService({}), null);
  je('smeti', packOfService({ packaging_price: 'x' }), null);
  je('negativno', packOfService({ packaging_price: -1 }), null);
  je('brez artikla', packOfService(null), null);
}

console.log('\n11) Opomba "embalaža in dostava se dodata"');
{
  je('enotna cena na naročilo', hasExtras(lokal({ packaging_price: 1 }), [{ name: 'X', price: 5, qty: 1 }]), true);
  je('cena pri artiklu', hasExtras(lokal({}), [{ name: 'X', price: 5, qty: 1, pack: 0.4 }]), true);
  je('samo dostava', hasExtras(lokal({ delivery_fee: 2 }), [{ name: 'X', price: 5, qty: 1 }]), true);
  je('nič od tega', hasExtras(lokal({}), [{ name: 'X', price: 5, qty: 1 }]), false);
  je('vsi artikli brez embalaže', hasExtras(lokal({}), [{ name: 'X', price: 5, qty: 1, pack: 0 }]), false);
}

console.log('\n12) Botanin primer (cene po artiklu, enotna ni nastavljena)');
{
  const s = lokal({ packaging_price: 0, delivery_fee: 0 });
  const cart = [
    { name: 'Botana', price: 12.5, qty: 2, pack: 0.6 },
    { name: 'Bufalo mozzarella', price: 3.5, qty: 1, pack: 0.4 }
  ];
  const t = computeTotals(s, cart, 'dostava');
  je('artikli', +t.itemsTotal.toFixed(2), 28.5);
  je('embalaža 2×0,60 + 0,40', t.packFee, 1.6);
  je('skupaj', t.grand, '30.10');
  console.log('      ' + t.text);
}

console.log('\n13) Obnovljena seja: vrstica brez cene → cena se poišče v meniju');
{
  // Prav ta primer se je zgodil v živo: artikla sta bila dana v košarico,
  // preden je koda cene embalaže poznala, seja pa je preživela ponovni zagon.
  const s = lokal({ packaging_price: 0 });
  const meni = [
    { id: 'p1', name: 'Botana', price: 12.5, packaging_price: 0.6 },
    { id: 'p2', name: 'Panakota z jagodami', price: 5.2, packaging_price: 0.6 },
    { id: 'p3', name: 'Bufalo mozzarella', price: 3.5, packaging_price: 0.4 }
  ];
  const stara = [
    { id: 'p2', name: 'Panakota z jagodami', price: 5.2, qty: 1, pack: null },
    { id: 'p1', name: 'Botana', price: 12.5, qty: 2, pack: null }
  ];
  je('brez menija embalaža izpade (staro vedenje)', computeTotals(s, stara, 'dostava').packFee, 0);
  je('z menijem se cena najde po id', computeTotals(s, stara, 'dostava', meni).packFee, 1.8);
  je('skupaj', computeTotals(s, stara, 'dostava', meni).grand, '32.00');

  const brezId = [{ name: 'Bufalo mozzarella', price: 3.5, qty: 2 }];
  je('cena se najde tudi po imenu', computeTotals(s, brezId, 'dostava', meni).packFee, 0.8);

  const neznan = [{ id: 'x', name: 'Nekaj, česar ni na meniju', price: 4, qty: 1 }];
  je('artikel, ki ga ni v meniju, ostane brez embalaže', computeTotals(s, neznan, 'dostava', meni).packFee, 0);

  const izrecnaNic = [{ id: 'p1', name: 'Botana', price: 12.5, qty: 1, pack: 0 }];
  je('izrecna 0 v vrstici se NE povozi iz menija', computeTotals(s, izrecnaNic, 'dostava', meni).packFee, 0);

  je('opomba o dodatnih stroških zazna ceno iz menija',
    hasExtras(s, [{ id: 'p1', name: 'Botana', price: 12.5, qty: 1 }], meni), true);
}

console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
process.exit(ni ? 1 : 0);
