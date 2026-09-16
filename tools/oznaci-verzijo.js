/*
  V naslove skupnih datotek vpiše različico iz njihove vsebine.

    node tools/oznaci-verzijo.js

  ZAKAJ

    flowtek-nav.js in flowtek-site.css se strežeta s Cache-Control
    max-age=14400 (štiri ure), v naslovu pa nista imela ničesar, kar bi
    predpomnilniku povedalo, da sta nova. Obiskovalec, ki je stran videl pred
    objavo, je do štiri ure dobival SVEŽ HTML s STARO datoteko.

    To se je zgodilo trikrat in vsakič dražje:
      1. gumba za družbena omrežja brez sloga,
      2. stara telefonska številka na strani,
      3. Meta pixel se sploh ni naložil — torej štiri ure neizmerjenega
         oglasnega prometa po vsaki objavi.

    Z različico v naslovu je stara datoteka nedosegljiva: ob spremembi
    vsebine se spremeni naslov in predpomnilnik je obide.

  KAKO

    Različica je prvih osem znakov zgoščene vrednosti vsebine datoteke. Ker
    izhaja iz vsebine, se ob nespremenjeni datoteki ne spremeni — objave ne
    povzročajo nepotrebnega prenašanja.

    Zajeta je tudi predloga v gradi-panoge.js; brez tega bi naslednja gradnja
    panožnih strani oznake povozila.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KOREN = path.join(__dirname, '..');
const PUB = path.join(KOREN, 'public');

/*
  Prve štiri nosijo javne strani, zadnje tri pa plošče (salon, delivery,
  admin). Plošče so za to napako še bolj občutljive: lastnik lokala ima
  stran odprto ves dan in bi z zastarelim urnikom ali vmesnikom za dostavo
  delal z lanskim gumbom, ne da bi to opazil.
*/
const DATOTEKE = [
  'flowtek-nav.js', 'flowtek-site.css', 'flowtek-pravno.css', 'flowtek-theme.css',
  'urnik-vmesnik.js', 'dostava-vmesnik.js', 'pomoc.js'
];

const verzija = (ime) => crypto
  .createHash('sha1')
  .update(fs.readFileSync(path.join(PUB, ime)))
  .digest('hex')
  .slice(0, 8);

const tarce = [
  ...fs.readdirSync(PUB).filter((f) => f.endsWith('.html')).map((f) => path.join(PUB, f)),
  ...fs.readdirSync(path.join(PUB, 'panoga')).filter((f) => f.endsWith('.html')).map((f) => path.join(PUB, 'panoga', f)),
  path.join(KOREN, 'tools', 'gradi-panoge.js'),
];

const v = {};
for (const d of DATOTEKE) v[d] = verzija(d);

let spremenjenih = 0;
let oznak = 0;

for (const p of tarce) {
  const pred = fs.readFileSync(p, 'utf8');
  let s = pred;

  for (const d of DATOTEKE) {
    /*
      Ujamemo samo naslove v atributih src/href — ne omemb imena v besedilu
      ali komentarjih. Obstoječo različico zamenjamo, nove dodamo.
    */
    const re = new RegExp('((?:src|href)="\\/' + d.replace('.', '\\.') + ')(\\?v=[a-f0-9]+)?"', 'g');
    s = s.replace(re, (cel, zacetek) => {
      oznak += 1;
      return zacetek + '?v=' + v[d] + '"';
    });
  }

  if (s !== pred) { fs.writeFileSync(p, s); spremenjenih += 1; }
}

console.log('različice:');
for (const d of DATOTEKE) console.log('  ' + d.padEnd(20) + v[d]);
console.log('\noznačenih naslovov: ' + oznak + ' · spremenjenih datotek: ' + spremenjenih);
console.log('\nPo tem poženi še: node tools/gradi-panoge.js');
