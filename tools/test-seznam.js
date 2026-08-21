/*
  Preizkus, kako se dolga imena jedi prikažejo v WhatsApp seznamu.
  Meta dovoli 24 znakov za naslov vrstice in 72 za opis — tega ni mogoče
  povečati, zato ju uporabimo skupaj.

    node tools/test-seznam.js
*/
const wa = require('../src/whatsapp');

let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const a = JSON.stringify(dobil), b = JSON.stringify(pricakoval);
  if (a === b) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil:      ' + a + '\n      pričakoval: ' + b); }
}

// Prave jedi z Botaninega menija
const JEDI = [
  { id: '1', name: 'Gratinirane kraljeve kozice z mariniranim češnjevim paradižnikom in zelenjavo', price: 15.4, category: 'Morski užitki' },
  { id: '2', name: 'Ocvrti rakci v pivskem testu, pomfri, ameriška solata', price: 16.5, category: 'Posebna ponudba' },
  { id: '3', name: 'Vijolična hobotnica, polenta, špinača s feto, češnjev paradižnik', price: 19, category: 'Posebna ponudba' },
  { id: '4', name: 'Piščančji trakci s porom', price: 16, description: 'Priloga: polenta s skuto, rukolo in ribanim sirom', category: 'Posebna ponudba' },
  { id: '5', name: 'Margerita', price: 9.5, category: 'Pizze' },
  { id: '6', name: 'Kepica sladoleda', price: 2.3, category: 'Sladice' }
];

// Šest artiklov je pod mejo za kategorije, zato seznam pokaže kar jedi.
const vrstice = () => {
  const m = wa.deliveryMenuList('386', JEDI, { greeting_message: 'Izberite:' }, null, null, 0);
  const rows = [];
  for (const sec of m.interactive.action.sections) for (const r of sec.rows) rows.push(r);
  return rows;
};
// Beseda brez ločil na koncu — rez namenoma odstrani vejico ("hobotnica," → "hobotnica")
const brezLocil = w => w.replace(/^[\s,;:.()-]+|[\s,;:.()-]+$/g, '');

console.log('\n1) Metine meje niso presežene');
{
  const m = wa.deliveryMenuList('386', JEDI, {}, null, null, 0);
  const vse = [];
  for (const sec of m.interactive.action.sections) {
    je('naslov sekcije do 24 znakov (' + sec.title + ')', sec.title.length <= 24, true);
    for (const r of sec.rows) vse.push(r);
  }
  for (const r of vse) {
    je('naslov do 24: "' + r.title + '"', r.title.length <= 24, true);
    je('opis do 72 (' + r.description.length + ')', r.description.length <= 72, true);
  }
  je('gumb do 20 znakov', m.interactive.action.button.length <= 20, true);
}

console.log('\n2) Ime se ne odreže sredi besede');
{
  const r = vrstice();
  for (const x of r) {
    if (x.id.startsWith('menu_')) {
      const zadnja = brezLocil(x.title.replace(/…$/, '').trim().split(' ').pop());
      const jed = JEDI.find(j => 'menu_' + j.id === x.id);
      const celaBeseda = !jed || jed.name.split(' ').map(brezLocil).indexOf(zadnja) >= 0;
      je('"' + x.title + '" se konča s celo besedo', celaBeseda, true);
    }
  }
}

console.log('\n3) Nadaljevanje imena je v opisu');
{
  const r = vrstice();
  const kozice = r.find(x => /kraljeve/i.test(x.title));
  console.log('      naslov: ' + kozice.title);
  console.log('      opis:   ' + kozice.description);
  je('naslov je odrezan s tropičjem', /…$/.test(kozice.title), true);
  je('cena je v slovenskem zapisu', /15,40 €/.test(kozice.description), true);
  je('opis nadaljuje ime', /…kozice/.test(kozice.description), true);

  // Koliko imena stranka skupaj vidi?
  const jed = JEDI[0];
  const vidno = kozice.title.replace(/…$/, '') + kozice.description.replace(/^[^·]*· ?…?/, '');
  const delez = Math.round(vidno.replace(/…/g, '').length / jed.name.length * 100);
  console.log('      od ' + jed.name.length + ' znakov imena je vidnih ~' + delez + ' %');
  je('vidnega je vsaj 90 % imena', delez >= 90, true);
}

console.log('\n4) Kratko ime ostane nedotaknjeno, opis se ohrani');
{
  const r = vrstice();
  const trakci = r.find(x => /trakci/i.test(x.title));
  je('kratko ime brez tropičja', trakci.title, 'Piščančji trakci s porom');
  je('opis je opis jedi, ne ime', /Priloga/.test(trakci.description), true);
  je('cena je v opisu', /16,00 €/.test(trakci.description), true);
}

console.log('\n5) Cena je vedno vidna');
{
  const r = vrstice().filter(x => x.id.startsWith('menu_'));
  const brezCene = r.filter(x => !/\d/.test(x.description));
  je('vsaka vrstica ima ceno v opisu', brezCene, []);
}

console.log('\n6) Storitve (frizer, tattoo) — ista meja');
{
  const m = wa.serviceList('386', [
    { id: 'a', name: 'Striženje in barvanje z globinsko nego lasišča', price: 45, duration_minutes: 90 },
    { id: 'b', name: 'Striženje', price: 15, duration_minutes: 30 }
  ], {});
  const rows = m.interactive.action.sections[0].rows;
  je('dolgo ime do 24 znakov', rows[0].title.length <= 24, true);
  je('odrezano po besedi', /…$/.test(rows[0].title), true);
  je('kratko ime nedotaknjeno', rows[1].title, 'Striženje');
  console.log('      ' + rows[0].title + '  |  ' + rows[0].description);
}

console.log('\n7) Robni primeri');
{
  je('prazno ime', wa.deliveryMenuList('386', [{ id: 'x', name: '', price: 1, category: 'A' }], {}, null, 'A', 0)
    .interactive.action.sections[0].rows[0].title, '');
  const ednabeseda = wa.deliveryMenuList('386',
    [{ id: 'y', name: 'Bruschettazgorgonzoloinorehiposebnadolgabeseda', price: 5, category: 'A' }], {}, null, 'A', 0)
    .interactive.action.sections[0].rows[0];
  je('ena zelo dolga beseda se vseeno odreže', ednabeseda.title.length <= 24, true);
  je('… in nadaljevanje gre v opis', /…/.test(ednabeseda.description), true);
  console.log('      ' + ednabeseda.title + '  |  ' + ednabeseda.description);
}

console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
process.exit(ni ? 1 : 0);
