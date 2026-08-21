/*
  Preizkus zneskov: embalaža po artiklu, enotna cena lokala, dostava.
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

console.log('\n1) Enotna cena lokala (kot doslej — nič se ne sme spremeniti)');
{
  const s = lokal({ packaging_price: 0.6, delivery_fee: 3 });
  const cart = [{ name: 'Margherita', price: 7.5, qty: 2 }, { name: 'Cola', price: 2.5, qty: 1 }];
  const t = computeTotals(s, cart, 'dostava');
  je('embalaža 3 kosi × 0,60', t.packFee, 1.8);
  je('dostava enkrat na naročilo', t.delFee, 3);
  je('artikli', +t.itemsTotal.toFixed(2), 17.5);
  je('skupaj', t.grand, '22.30');
  je('razčlenitev navede množenje', t.packText, '3 × 0.60 € = 1.80 €');
}

console.log('\n2) Cena embalaže po artiklu (pica 0,60, dodatek 0,40)');
{
  const s = lokal({ packaging_price: 0.6 });
  const cart = [
    { name: 'Margherita', price: 7.5, qty: 2, pack: 0.6 },
    { name: 'Gobe', price: 1.5, qty: 3, pack: 0.4 }
  ];
  const t = computeTotals(s, cart, 'dostava');
  // 2 × 0,60 = 1,20  +  3 × 0,40 = 1,20  →  2,40
  je('embalaža je vsota po vrsticah', t.packFee, 2.4);
  je('skupaj', t.grand, '21.90');
  je('pri različnih cenah ni zmnožka, le vsota', t.packText, '2.40 €');
}

console.log('\n3) Artikel brez embalaže (pijača, cena 0)');
{
  const s = lokal({ packaging_price: 0.6 });
  const cart = [
    { name: 'Margherita', price: 7.5, qty: 1, pack: 0.6 },
    { name: 'Cola', price: 2.5, qty: 4, pack: 0 }
  ];
  const t = computeTotals(s, cart, 'dostava');
  je('pijača ne doda embalaže', t.packFee, 0.6);
  je('enotna cena lokala je NE povozi', t.grand, '18.10');
}

console.log('\n4) Artikel brez svoje cene pade na enotno ceno lokala');
{
  const s = lokal({ packaging_price: 0.5 });
  const cart = [
    { name: 'Pica', price: 8, qty: 1, pack: 0.6 },
    { name: 'Solata', price: 5, qty: 1 },            // brez pack → 0,50
    { name: 'Juha', price: 4, qty: 1, pack: null }   // null → 0,50
  ];
  je('vsota 0,60 + 0,50 + 0,50', computeTotals(s, cart, 'dostava').packFee, 1.6);
}

console.log('\n5) Osebni prevzem');
{
  const cart = [{ name: 'Pica', price: 8, qty: 2, pack: 0.6 }];
  const zEmb = lokal({ packaging_price: 0.6, delivery_fee: 3, pickup_packaging: true });
  const brezEmb = lokal({ packaging_price: 0.6, delivery_fee: 3, pickup_packaging: false });
  je('pri prevzemu ni dostave', computeTotals(zEmb, cart, 'prevzem').delFee, 0);
  je('embalaža pri prevzemu (vklopljeno)', computeTotals(zEmb, cart, 'prevzem').packFee, 1.2);
  je('embalaža pri prevzemu (izklopljeno)', computeTotals(brezEmb, cart, 'prevzem').packFee, 0);
  je('skupaj pri prevzemu brez embalaže', computeTotals(brezEmb, cart, 'prevzem').grand, '16.00');
}

console.log('\n6) Prazna in nenavadna košarica');
{
  const s = lokal({ packaging_price: 0.6, delivery_fee: 3 });
  je('prazna košarica: embalaža 0', computeTotals(s, [], 'dostava').packFee, 0);
  je('prazna košarica: dostava se vseeno šteje', computeTotals(s, [], 'dostava').delFee, 3);
  je('brez količine šteje kot 1', computeTotals(s, [{ name: 'X', price: 5 }], 'prevzem').packFee, 0.6);
  je('smeti v ceni embalaže padejo na enotno', computeTotals(s, [{ name: 'X', price: 5, qty: 1, pack: 'abc' }], 'prevzem').packFee, 0.6);
  je('negativna cena embalaže pade na enotno', computeTotals(s, [{ name: 'X', price: 5, qty: 1, pack: -2 }], 'prevzem').packFee, 0.6);
}

console.log('\n7) Zaokroževanje (drobci ne smejo pobegniti)');
{
  const s = lokal({ packaging_price: 0 });
  const cart = Array.from({ length: 3 }, () => ({ name: 'X', price: 0.1, qty: 1, pack: 0.1 }));
  const t = computeTotals(s, cart, 'prevzem');
  je('3 × 0,10 = 0,30 in ne 0,30000000000000004', t.packFee, 0.3);
  je('skupaj 0,60', t.grand, '0.60');
}

console.log('\n8) Razčlenitev za WhatsApp');
{
  const s = lokal({ packaging_price: 0.6, delivery_fee: 3 });
  const t = computeTotals(s, [{ name: 'Pica', price: 8, qty: 1, pack: 0.6 }], 'dostava');
  je('tri vrstice', t.vrstice.length, 3);
  je('artikli', t.vrstice[0], '💰 Artikli: 8.00 €');
  je('embalaža', t.vrstice[1], '📦 Embalaža: 1 × 0.60 € = 0.60 €');
  je('dostava', t.vrstice[2], '🚗 Dostava:  3.00 €');
  const brez = computeTotals(lokal({}), [{ name: 'Pica', price: 8, qty: 1, pack: 0 }], 'prevzem');
  je('brez stroškov ostane samo vrstica artiklov', brez.vrstice.length, 1);
}

console.log('\n9) Cena embalaže z artikla menija');
{
  je('številka', packOfService({ packaging_price: 0.6 }), 0.6);
  je('ničla je veljavna (brez embalaže)', packOfService({ packaging_price: 0 }), 0);
  je('niz s piko', packOfService({ packaging_price: '0.40' }), 0.4);
  je('null pomeni enotno ceno', packOfService({ packaging_price: null }), null);
  je('prazen niz pomeni enotno ceno', packOfService({ packaging_price: '' }), null);
  je('manjkajoče polje', packOfService({}), null);
  je('smeti', packOfService({ packaging_price: 'x' }), null);
  je('negativno', packOfService({ packaging_price: -1 }), null);
  je('brez artikla', packOfService(null), null);
}

console.log('\n10) Opomba "embalaža in dostava se dodata"');
{
  je('enotna cena lokala', hasExtras(lokal({ packaging_price: 0.6 }), [{ name: 'X', price: 5, qty: 1 }]), true);
  je('samo dostava', hasExtras(lokal({ delivery_fee: 2 }), [{ name: 'X', price: 5, qty: 1 }]), true);
  je('nič od tega', hasExtras(lokal({}), [{ name: 'X', price: 5, qty: 1 }]), false);
  // Prav to je bilo prej narobe: lokal brez enotne cene, a artikel ima svojo
  je('lokal brez enotne cene, artikel ima svojo', hasExtras(lokal({}), [{ name: 'X', price: 5, qty: 1, pack: 0.4 }]), true);
  je('vsi artikli brez embalaže', hasExtras(lokal({ packaging_price: 0.6 }), [{ name: 'X', price: 5, qty: 1, pack: 0 }]), false);
}

console.log('\n11) Botanin primer iz zahteve');
{
  // Enotna cena lokala 0,60; dodatki 0,40; brez dostave
  const s = lokal({ packaging_price: 0.6, delivery_fee: 0, pickup_packaging: true });
  const cart = [
    { name: 'Botana', price: 12.5, qty: 2, pack: 0.6 },   // dve pici
    { name: 'Bufalo mozzarella', price: 3.5, qty: 1, pack: 0.4 }
  ];
  const t = computeTotals(s, cart, 'dostava');
  je('artikli 2×12,50 + 3,50', +t.itemsTotal.toFixed(2), 28.5);
  je('embalaža 2×0,60 + 1×0,40', t.packFee, 1.6);
  je('skupaj', t.grand, '30.10');
  console.log('      ' + t.text);
}

console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
process.exit(ni ? 1 : 0);
