/*
  Preizkus: vprašanje po količini pove tudi, kakšna jed je to.

    node tools/test-besede.js

  Kategorije so prave — iz Botaninega in iz menija Test Picerije, ker se
  pravilo lomi natanko na tem, kar lastniki res vpišejo ("Testenine, rižote
  in njoki", "Posebna ponudba").
*/
const { kolicinsko, vprasajKolicino } = require('../src/besede');

let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  if (dobil === pricakoval) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil: ' + JSON.stringify(dobil) + '  pričakoval: ' + JSON.stringify(pricakoval)); }
}

console.log('\n── 1) Botanine kategorije ───────────────────────────');
je('Pizze → pic', kolicinsko('Pizze', 'Klasika'), 'pic');
je('Solate → solat', kolicinsko('Solate', 'Cezar'), 'solat');
je('Juhe → juh', kolicinsko('Juhe', 'Jurčki'), 'juh');
// Botanine solate in juhe imajo besedo že v imenu ("Botana solata"), zato tam
// besede namenoma NE dodamo — dvakrat isto bi bilo slabše kot brez.
je('Botana solata besede ne dobi', kolicinsko('Solate', 'Botana solata'), null);
je('Ajdova juha besede ne dobi', kolicinsko('Juhe', 'Ajdova juha z jurčki'), null);
je('Sladice → sladic', kolicinsko('Sladice', 'Tiramisu'), 'sladic');
je('Dodatki → dodatkov', kolicinsko('Dodatki', 'Pomfri'), 'dodatkov');
je('Glavne jedi → brez besede', kolicinsko('Glavne jedi', 'Beef zrezek'), null);
je('Morski užitki → brez besede', kolicinsko('Morski užitki', 'File brancina'), null);
je('Posebna ponudba → brez besede', kolicinsko('Posebna ponudba', 'Goveji trakci'), null);
// Kategorija našteva tri vrste — rižoti ne smemo reči testenine.
je('Testenine, rižote in njoki → brez besede', kolicinsko('Testenine, rižote in njoki', 'Mesna lazanja'), null);
je('… tudi za rižoto', kolicinsko('Testenine, rižote in njoki', 'Milanska rižota s piščancem'), null);

console.log('\n── 2) Test Picerija ────────────────────────────────');
je('Pice → pic', kolicinsko('Pice', 'Funghi'), 'pic');
je('Pijača → pijač', kolicinsko('Pijača', 'Coca-Cola 0.5L'), 'pijač');
je('Predjedi → predjedi', kolicinsko('Predjedi', 'Bruschetta'), 'predjedi');
je('Testenine → testenin', kolicinsko('Testenine', 'Lazanja'), 'testenin');

console.log('\n── 3) Beseda se ne ponovi ──────────────────────────');
je('artikel "Pizza pol-pol" v Dodatkih ne dobi "dodatkov"',
  kolicinsko('Dodatki', 'Pizza pol-pol'), 'dodatkov');
je('artikel z imenom "Pizza Klasika" v Pizzah ne dobi "pic"',
  kolicinsko('Pizze', 'Pizza Klasika'), null);
// "Pizze" se ujame prek ključa "pizz", ime pa piše "pica" — obe obliki dasta
// "pic", zato mora tudi ta ujeti se.
je('"Grška pica" v Pizzah ne dobi "pic"', kolicinsko('Pizze', 'Grška pica'), null);
je('"Pica z biftkom" v Pizzah ne dobi "pic"', kolicinsko('Pizze', 'Pica z biftkom'), null);
je('artikel "Solata Cezar" v Solatah ne dobi "solat"',
  kolicinsko('Solate', 'Solata Cezar'), null);

console.log('\n── 4) Šumniki in velike črke ne motijo ─────────────');
je('PIZZE', kolicinsko('PIZZE', 'Klasika'), 'pic');
je('pizze ', kolicinsko('pizze ', 'Klasika'), 'pic');
je('Pijače', kolicinsko('Pijače', 'Radenska'), 'pijač');
je('Palačinke', kolicinsko('Palačinke', 'Nutella'), 'palačink');
je('Sendviči', kolicinsko('Sendviči', 'Tuna'), 'sendvičev');

console.log('\n── 5) Nič namesto ugibanja ─────────────────────────');
je('brez kategorije', kolicinsko(null, 'Klasika'), null);
je('prazna kategorija', kolicinsko('', 'Klasika'), null);
je('izmišljena kategorija', kolicinsko('Ponudba tedna', 'Nekaj'), null);
je('kategorija brez pomena', kolicinsko('XYZ', 'Nekaj'), null);

console.log('\n── 6) Celo vprašanje ───────────────────────────────');
je('pizza', vprasajKolicino('Klasika', 'Pizze'), 'Koliko pic *Klasika* želite?');
je('solata', vprasajKolicino('Cezar', 'Solate'), 'Koliko solat *Cezar* želite?');
je('ime že vsebuje besedo', vprasajKolicino('Grška solata', 'Solate'), 'Koliko *Grška solata* želite?');
je('neznana kategorija ostane kot doslej', vprasajKolicino('Goveji trakci', 'Posebna ponudba'), 'Koliko *Goveji trakci* želite?');
je('brez kategorije ostane kot doslej', vprasajKolicino('Klasika', null), 'Koliko *Klasika* želite?');
je('presledki v imenu se počistijo', vprasajKolicino('  Klasika  ', 'Pizze'), 'Koliko pic *Klasika* želite?');

console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
process.exit(ni ? 1 : 0);
