/*
  Zgradi public/llms.txt — povzetek strani za jezikovne modele in AI iskalnike
  (oblika po llmstxt.org).
  Zaženi:  node tools/gradi-llms.js

  Naslovi in opisi se BEREJO iz strani (<title> in meta description), zato se
  datoteka ne razhaja z vsebino. Ročno napisan llms.txt bi zastarel pri prvi
  spremembi besedila.

  Dejstva v razdelku "Na kratko" so edini ročni del. Vsako je zapisano tudi na
  eni od strani; če se cena ali obseg spremeni, se popravi tukaj IN v
  index.html (JSON-LD).
*/
const fs = require('fs');
const path = require('path');

const DOMENA = 'https://flowtiq.si';
const PUB = path.join(__dirname, '..', 'public');

// Razdelki in strani. Vrstni red je vrstni red v llms.txt.
const RAZDELKI = [
  ['Izdelek', [
    ['/', 'Kaj je FlowTiq in za koga je'],
    ['/kako-deluje.html', null],
    ['/funkcije.html', null],
    ['/cenik.html', null],
    ['/vprasanja.html', null]
  ]],
  ['Za katero dejavnost', [
    ['/panoge.html', null]
  ]],
  ['Podjetje in zaupanje', [
    ['/o-nas.html', null],
    ['/zgodbe.html', null],
    ['/varnost.html', null],
    ['/kontakt.html', null]
  ]],
  ['Za stranke lokalov', [
    ['/imenik.html', null],
    ['/restavracije', null]
  ]],
  ['Optional', [
    ['/nasveti.html', null],
    ['/privacy.html', null],
    ['/terms.html', null],
    ['/cookies.html', null]
  ]]
];

// Panožne strani se dodajo samodejno, tako kot v sitemap.
const PANOGE = fs.readdirSync(path.join(PUB, 'panoga'))
  .filter(f => f.endsWith('.html'))
  .sort()
  .map(f => ['/panoga/' + f, null]);

const datoteka = pot => {
  if (pot === '/') return path.join(PUB, 'index.html');
  if (pot === '/restavracije') return path.join(PUB, 'restavracije.html');
  return path.join(PUB, pot.replace(/^\//, ''));
};

const razLastnosti = s => String(s)
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

function podatkiStrani(pot) {
  const f = datoteka(pot);
  if (!fs.existsSync(f)) return null;
  const html = fs.readFileSync(f, 'utf8');
  const t = html.match(/<title>([\s\S]*?)<\/title>/i);
  const d = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  let naslov = t ? razLastnosti(t[1]) : pot;
  // "Cenik — FlowTiq" → "Cenik"; ime znamke je v glavi datoteke
  naslov = naslov.replace(/\s*[—|–|-]\s*FlowTiq.*$/i, '').trim() || naslov;
  return { naslov, opis: d ? razLastnosti(d[1]) : null };
}

const manjkajo = [];
function vrstica([pot, rocniOpis]) {
  const p = podatkiStrani(pot);
  if (!p) { manjkajo.push(pot); return null; }
  const opis = rocniOpis || p.opis;
  return '- [' + p.naslov + '](' + DOMENA + pot + ')' + (opis ? ': ' + opis : '');
}

const NA_KRATKO = `## Na kratko

- **Kaj je:** WhatsApp pomočnik, ki namesto lokala sprejema naročila in rezervacije. Stranka piše na navadno WhatsApp številko lokala — brez aplikacije in brez registracije.
- **Za koga:** restavracije, picerije in gostilne (naročila z dostavo ali prevzemom), frizerski in kozmetični saloni, tattoo studii, avtoservisi, ambulante, veterine, wellness, hoteli, šole in trenerji (rezervacije terminov).
- **Kje deluje:** Slovenija. Stran, pogovor s stranko in podpora so v slovenščini.
- **Cena:** fiksna mesečna naročnina brez provizije od naročila — AI Start 89 €, AI Pro 159,99 €, Premium 299 € na mesec. Vsi paketi imajo vse funkcije; razlikuje se obseg (500, 1.500 oziroma 10.000 naročil na mesec), Premium doda več lokacij pod eno ploščo in prednostno podporo.
- **Pogoji:** postavitev je brezplačna, ni vezave, odpoved kadar koli. Cena je končna — Webacus ni zavezanec za DDV (1. odst. 94. člena ZDDV-1).
- **Kaj zna:** odgovarja 24 ur na dan, razume prosto napisano besedilo, vodi lasten koledar z dolžinami storitev in ločenimi koledarji po zaposlenih, pokaže meni v pogovoru, sešteje naročilo z embalažo in dostavo po kraju, pošlje opomnik dan prej, sprosti odpovedani termin, vabi stranke nazaj, zbira Google ocene, se poveže z blagajno in vse skupaj pokaže na nadzorni plošči.
- **Kdo ga razvija:** Webacus, Valentin Iljaž s.p., Nova vas 12, Bizeljsko, Slovenija. Davčna št. 35880643.
- **Kontakt:** info@flowtiq.si, telefon in WhatsApp +386 40 599 185. Odgovorimo med tednom od 8. do 19. ure, ob sobotah dopoldne.
`;

const glava = `# FlowTiq

> WhatsApp pomočnik za slovenske gostince in obrtnike: 24 ur na dan sprejema naročila in rezervacije na obstoječi WhatsApp številki lokala, brez aplikacije za stranko in brez provizije od naročila.

FlowTiq ni klepetalni robot za vprašanja o izdelku, ampak prevzame konkreten posel: pogovor s stranko od prvega sporočila do oddanega naročila ali potrjenega termina. Zneske, koledar in urnik vodi determinirana koda, jezik razume AI — zato bot ne izmišljuje cen in prostih terminov. Lastnik vse nastavi v nadzorni plošči: delovni čas po dnevih, storitve in cene, ceno embalaže, ceno dostave po krajih in ton pogovora.

Ta datoteka je namenjena jezikovnim modelom in AI iskalnikom. Vsebina strani je prosta za branje in navajanje; prosimo za navedbo vira flowtiq.si.
`;

const odseki = [];
odseki.push(glava);
odseki.push(NA_KRATKO);

for (const [ime, strani] of RAZDELKI) {
  let seznam = strani.map(vrstica).filter(Boolean);
  if (ime === 'Za katero dejavnost') seznam = seznam.concat(PANOGE.map(vrstica).filter(Boolean));
  if (!seznam.length) continue;
  odseki.push('## ' + ime + '\n\n' + seznam.join('\n') + '\n');
}

// Datum je zadnja sprememba VSEBINE, ne datum izdelave datoteke — drugače bi
// se spremenil ob vsakem zagonu, tudi kadar se ni spremenilo nič.
const vsePoti = RAZDELKI.flatMap(([, s]) => s).concat(PANOGE).map(([p]) => p);
const zadnjaSprememba = vsePoti
  .map(datoteka).filter(f => fs.existsSync(f))
  .reduce((n, f) => Math.max(n, fs.statSync(f).mtimeMs), 0);

const besedilo = odseki.join('\n')
  + '\n---\n\nZadnja sprememba: ' + new Date(zadnjaSprememba).toISOString().slice(0, 10)
  + '\nZemljevid strani: ' + DOMENA + '/sitemap.xml\n';

fs.writeFileSync(path.join(PUB, 'llms.txt'), besedilo, 'utf8');

const vrstic = besedilo.split('\n').length;
const povezav = (besedilo.match(/^- \[/gm) || []).length;
console.log('llms.txt: ' + povezav + ' povezav, ' + vrstic + ' vrstic, ' + besedilo.length + ' znakov');
if (manjkajo.length) console.log('POZOR — te strani ne obstajajo: ' + manjkajo.join(', '));
