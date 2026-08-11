/*
  Zgradi public/sitemap.xml iz seznama javnih strani.
  Zaženi:  node tools/gradi-sitemap.js

  Vključene so samo strani, ki jih hočemo v iskalniku. Nadzorne plošče
  in prijavni zasloni so izpuščeni (isto kot v robots.txt).
  lastmod se vzame iz datuma spremembe datoteke.
*/
const fs = require('fs');
const path = require('path');

const DOMENA = 'https://flowtiq.si';
const PUB = path.join(__dirname, '..', 'public');

// pot -> prioriteta, pogostost
const STRANI = [
  ['/', 1.0, 'weekly'],
  ['/panoge.html', 0.9, 'monthly'],
  ['/kako-deluje.html', 0.9, 'monthly'],
  ['/funkcije.html', 0.9, 'monthly'],
  ['/cenik.html', 0.9, 'monthly'],
  ['/zgodbe.html', 0.7, 'monthly'],
  ['/vprasanja.html', 0.8, 'monthly'],
  ['/o-nas.html', 0.6, 'yearly'],
  ['/nasveti.html', 0.7, 'monthly'],
  ['/kontakt.html', 0.8, 'yearly'],
  ['/varnost.html', 0.5, 'yearly'],
  ['/imenik.html', 0.7, 'weekly'],
  ['/restavracije', 0.6, 'weekly'],
  ['/privacy.html', 0.3, 'yearly'],
  ['/terms.html', 0.3, 'yearly'],
  ['/cookies.html', 0.3, 'yearly']
];

// panožne strani se dodajo samodejno
const panoge = fs.readdirSync(path.join(PUB, 'panoga'))
  .filter(f => f.endsWith('.html'))
  .map(f => ['/panoga/' + f, 0.8, 'monthly']);

const vse = STRANI.concat(panoge);

const datoteka = pot => {
  if (pot === '/') return path.join(PUB, 'index.html');
  if (pot === '/restavracije') return path.join(PUB, 'restavracije.html');
  return path.join(PUB, pot.replace(/^\//, ''));
};

const danes = new Date().toISOString().slice(0, 10);

const vnosi = vse.map(([pot, prio, freq]) => {
  const f = datoteka(pot);
  const lastmod = fs.existsSync(f)
    ? fs.statSync(f).mtime.toISOString().slice(0, 10)
    : danes;
  return '  <url>\n'
    + '    <loc>' + DOMENA + pot + '</loc>\n'
    + '    <lastmod>' + lastmod + '</lastmod>\n'
    + '    <changefreq>' + freq + '</changefreq>\n'
    + '    <priority>' + prio.toFixed(1) + '</priority>\n'
    + '  </url>';
});

const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<!-- Generirano z: node tools/gradi-sitemap.js -->\n'
  + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + vnosi.join('\n') + '\n'
  + '</urlset>\n';

fs.writeFileSync(path.join(PUB, 'sitemap.xml'), xml, 'utf8');

const manjkajo = vse.filter(([p]) => !fs.existsSync(datoteka(p))).map(([p]) => p);
console.log('sitemap.xml: ' + vse.length + ' naslovov (' + panoge.length + ' panožnih)');
if (manjkajo.length) console.log('POZOR — te datoteke ne obstajajo: ' + manjkajo.join(', '));
