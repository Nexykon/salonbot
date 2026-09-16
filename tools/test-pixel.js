/*
  Preizkus Meta pixla.

    node tools/test-pixel.js

  Najpomembnejša trditev ni "pixel obstaja", ampak da se Lead sproži SAMO
  tam, kjer je človek res nekaj oddal. Če bi Lead viselo na kliku ali na
  ogledu, bi se Meta učila na napačnem signalu in bi kampanjo optimizirala
  za tisto, kar ne prinese stranke — in tega se v poročilu ne bi opazilo.
*/
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const beri = (f) => fs.readFileSync(path.join(PUB, f), 'utf8').replace(/\r\n/g, '\n');
const NAV = beri('flowtek-nav.js');

let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const a = JSON.stringify(dobil), b = JSON.stringify(pricakoval);
  if (a === b) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil:      ' + a + '\n      pričakoval: ' + b); }
}

const straniHtml = fs.readdirSync(PUB).filter((f) => f.endsWith('.html'))
  .concat(fs.readdirSync(path.join(PUB, 'panoga')).map((f) => 'panoga/' + f));

console.log('\n1) Koda je na enem mestu');
je('flowtek-nav.js nosi pixel', /fbevents\.js/.test(NAV), true);
je('pixel ID je vpisan', /2251955875346046/.test(NAV), true);
// Kopija na strani bi pomenila dvojni PageView in napačno število.
je('nobena stran nima svoje kopije',
  straniHtml.filter((f) => /fbevents\.js|fbq\('init'/.test(beri(f))), []);

console.log('\n2) PageView povsod, Lead samo ob oddaji');
je('PageView je v skupni kodi', /fbq\('track', 'PageView'\)/.test(NAV), true);

// Lead sme biti samo na teh dveh straneh in nikjer drugje.
const zLead = straniHtml.filter((f) => /ftSledi\(\s*'Lead'/.test(beri(f)));
je('Lead je natanko na dveh mestih', zLead.sort(), ['kontakt.html', 'vodic-hvala.html']);

const hvala = beri('vodic-hvala.html');
const kontakt = beri('kontakt.html');
je('vodic-hvala pošlje Lead', /ftSledi\('Lead', \{ content_name: 'vodic' \}\)/.test(hvala), true);
je('kontakt pošlje Lead', /ftSledi\('Lead', \{ content_name: 'kontakt-obrazec' \}\)/.test(kontakt), true);

/*
  Na kontakt.html mora Lead stati ZA preverbo r.ok — enako kot gtag. Sicer bi
  se sprožil tudi takrat, ko strežnik prijave ni sprejel.
*/
const poR = kontakt.slice(kontakt.indexOf('if (!r.ok)'));
je('Lead na kontaktu stoji za preverbo r.ok', /ftSledi\('Lead'/.test(poR), true);
je('Lead je v isti veji kot gtag',
  /gtag\('event', 'generate_lead'[\s\S]{0,400}ftSledi\('Lead'/.test(kontakt), true);

/*
  flowtek-nav.js se nalaga z "defer", zato ftSledi ob izvedbi vgnezdenega
  skripta še ne obstaja. Prva različica je Lead na strani za zahvalo klicala
  takoj in ga tiho izpustila — v brskalniku je bil viden samo PageView.
  Klic mora zato počakati na DOMContentLoaded.
*/
je('Lead na strani za zahvalo počaka na DOMContentLoaded',
  /addEventListener\('DOMContentLoaded'[\s\S]{0,200}ftSledi\('Lead'/.test(hvala), true);
// Na kontaktu čakanje ni potrebno: klic je v odgovoru na oddajo obrazca,
// torej krepko po nalaganju strani.
je('kontakt ne potrebuje čakanja', /ftSledi\('Lead'[\s\S]{0,40}\}\);/.test(kontakt), true);

console.log('\n3) Lead ne visi na kliku');
// wa_click je izkazano zanimanje, ne konverzija. Če bi bil Lead, bi Meta
// optimizirala za klike na WhatsApp namesto za prijave.
const blokPixel = NAV.slice(NAV.indexOf('5. Meta pixel'));
const blokWa = NAV.slice(NAV.indexOf('4. Merjenje klikov'), NAV.indexOf('5. Meta pixel'));
je('v kodi za wa_click ni Lead', /Lead/.test(blokWa), false);
je('v kodi za wa_click ni fbq', /fbq/.test(blokWa), false);

console.log('\n4) Merjenje ne sme podreti strani');
const koda = blokPixel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
je('klic je v try/catch', /try \{[\s\S]{0,120}fbq\('track'/.test(koda), true);
je('stikalo za privolitev obstaja', /ZAHTEVA_PRIVOLITEV/.test(koda), true);
je('obstaja pot za poznejšo privolitev', /ftDovoliSledenje/.test(koda), true);

console.log('\n5) Piškotna izjava ne sme trditi nasprotnega');
const piskotki = beri('cookies.html');
je('ne trdi več, da oglaševalskih piškotkov ni',
  /Oglaševalskih piškotkov <strong>ne<\/strong> uporabljamo/.test(piskotki), false);
je('ne trdi več, da za oglase ne spremljamo',
  /Za oglaševalske namene vas ne spremljamo/.test(piskotki), false);
je('navaja Meta pixel', /Meta pixel/.test(piskotki), true);
je('navaja piškotka, ki ju pixel nastavi', /_fbp/.test(piskotki) && /_fbc/.test(piskotki), true);
je('pove, česa Meti ne pošljemo', /ne pa vsebine obrazca/.test(piskotki), true);

console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
process.exit(ni ? 1 : 0);
