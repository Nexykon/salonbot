/*
  Ikone panog — vrisan SVG, en sam vir za vse tri kraje, kjer se pojavijo:
  index.html (kartice), panoge.html (vrstice) in panoga/<slug>.html (glava).

  Zakaj vrisan SVG in ne emoji ali slike:
    - emoji nariše vsaka naprava po svoje (Samsung, Apple, Windows), zato bi
      bila stran videti drugače pri vsakem obiskovalcu;
    - slike pomenijo dodatne zahteve in skrb za velikost;
    - SVG s "currentColor" prevzame barvo besedila, zato se ujema z okvirjem
      in deluje tudi, če se paleta kdaj spremeni.

  Vse ikone so v mreži 24×24, samo obrisi, debelina 2 — enako kot 2px obrobe
  v ostalem oblikovanju.
*/

const IKONE = {
  // Vilice in nož. Rezina pice je bila pri 22px videti kot trikotnik s
  // pikami — vilice in nož prepozna vsakdo tudi pri tej velikosti.
  restavracije: '<path d="M7 3v6.5a2.2 2.2 0 0 0 4.4 0V3"/><path d="M9.2 9.5V21"/><path d="M16.5 21v-7.5a3 3 0 0 0 0-6V3"/><path d="M16.5 13.5h2.5"/>',

  // Škarje
  'frizerski-saloni': '<circle cx="6" cy="18" r="2.6"/><circle cx="18" cy="18" r="2.6"/><path d="M7.8 16 18.5 4.5M16.2 16 5.5 4.5"/>',

  // Lakirni lonček s čopičem in iskrico
  kozmetika: '<path d="M9 9.5h6v10a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 19.5z"/><path d="M10.5 9.5V6.5h3v3"/><path d="M12 3v2M9.5 4l1 1M14.5 4l-1 1"/>',

  // Igla s piko — tattoo
  tattoo: '<path d="M4 20l4.5-1.5L19 8a2.1 2.1 0 0 0-3-3L5.5 15.5z"/><path d="M14.5 6.5 17.5 9.5"/><circle cx="7" cy="8" r="1"/><circle cx="4.5" cy="11.5" r="1"/>',

  // List. Lotos je bil pri tej velikosti videti kot brezoblična packa.
  wellness: '<path d="M20 4c0 8.3-4.6 13-11.5 13H5C5 8.7 9.6 4 16.5 4z"/><path d="M4 20c2.5-4.5 6-7.5 10.5-9.5"/>',

  // Zob
  zobozdravniki: '<path d="M7 3.5C4.8 3.5 3.5 5.4 3.5 8c0 2.6.9 4 1.6 6.4.5 1.8.4 6.1 2.2 6.1 1.6 0 1.5-4.6 2.4-6 .5-.8 1.6-.8 2.1 0 .9 1.4.8 6 2.4 6 1.8 0 1.7-4.3 2.2-6.1.7-2.4 1.6-3.8 1.6-6.4 0-2.6-1.3-4.5-3.5-4.5-1.6 0-2.4.8-3.5.8s-1.9-.8-3.5-.8z"/>',

  // Ključ
  avtoservisi: '<path d="M15.5 3.5a5 5 0 0 0-4.3 7.5L4 18.2 5.8 20l7.2-7.2a5 5 0 0 0 6.5-6.4L16.9 9 15 8.6l-.4-1.9z"/>',

  // Tačka
  veterina: '<circle cx="7" cy="8" r="1.9"/><circle cx="11.5" cy="5.6" r="1.9"/><circle cx="16.3" cy="7.3" r="1.9"/><circle cx="18.6" cy="11.8" r="1.7"/><path d="M12.4 11.6c2.6 0 5 1.8 5 4.2 0 2-1.7 3.4-3.6 3.4-1 0-1.4-.4-2.4-.4s-1.4.4-2.4.4C7.1 19.2 5.4 17.8 5.4 15.8c0-2.4 2.4-4.2 5-4.2z"/>',

  // Fotoaparat
  fotografi: '<path d="M3.5 8.5h3l1.5-2h6l1.5 2h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.2"/>',

  // Utež
  trenerji: '<path d="M4.5 9v6M7.5 7.5v9M16.5 7.5v9M19.5 9v6M7.5 12h9"/>',

  // Postelja
  hoteli: '<path d="M3.5 19v-9M3.5 14.5h17V19M20.5 14.5v-2.2a1.8 1.8 0 0 0-1.8-1.8H11v4"/><circle cx="7.2" cy="12" r="1.9"/>',

  // Diplomska kapa
  sole: '<path d="M12 4 2.5 8.2 12 12.4l9.5-4.2z"/><path d="M6.5 10.3v4.4c0 1.7 2.5 2.9 5.5 2.9s5.5-1.2 5.5-2.9v-4.4"/><path d="M21.5 8.2v5.3"/>'
};

/*
  Ikona v okvirju. Velikost je v pikslih, barva se prevzame iz besedila.
  aria-hidden, ker ime panoge takoj zatem piše v naslovu — bralnik zaslona
  naj slike ne ponavlja.
*/
function ikona(slug, velikost = 22) {
  const risba = IKONE[slug];
  if (!risba) throw new Error('panoga "' + slug + '" nima ikone (tools/ikone-panog.js)');
  return '<svg viewBox="0 0 24 24" width="' + velikost + '" height="' + velikost + '"'
    + ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'
    + ' stroke-linejoin="round" aria-hidden="true" focusable="false">' + risba + '</svg>';
}

module.exports = { IKONE, ikona };
