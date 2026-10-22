/*
  Besedilo štirih pristajalnih strani za Meta kampanjo ft-meta-2026-10.

  Strani so oglasne: en sam cilj — obiskovalec naj pritisne gumb in piše
  testni piceriji kot stranka. Zato noindex in zato jih ni v sitemap.xml.

  ZAKAJ JE BESEDILO TU IN NE V ŠTIRIH DATOTEKAH

    Večino besedila si strani delijo (koraki, cene, okvirni izračun, opomba
    pod gumbom). Štirikrat prepisano besedilo se čez dva popravka razide in
    nihče ne opazi — pri panožnih straneh se je to že zgodilo. Tu je
    zapisano enkrat; tools/gradi-preizkus.js iz tega izriše štiri strani.

  KAJ SE NE SME POJAVITI

    43 %, 71 %, 28 %, −30 % in 1,4 s. To so trditve brez vira, ki smo jih
    oktobra pospravili s celotne strani (tools/najdi-stevilke.js).

    Imena lokalov razen "Test Picerija" prav tako ne — stranke v oglasu
    nismo vprašali, ali smejo biti navedene.
*/

/* Skupno besedilo — dobesedno, kot je naročeno. */
const SKUPNO = {
  opombaPodGumbom: 'Odpre se WhatsApp pogovor s testno picerijo. Piši kot stranka – odgovori AI pomočnik.',
  korakiNaslov: 'Kako deluje',
  koraki: [
    'Stranka piše na tvojo obstoječo WhatsApp številko. Ne rabi nove aplikacije.',
    'Pomočnik razume prosto besedilo, npr. »eno capriccioso in dve koli«, in pogleda koledar ali kuhinjo.',
    'Potrdi v nekaj sekundah. 24 ur na dan.',
  ],
  paketi: [
    { ime: 'AI Start', cena: '89 €/mes' },
    { ime: 'AI Pro', cena: '159,99 €/mes' },
    { ime: 'Premium', cena: '299 €/mes' },
  ],
  podCenami: '0 € provizije od naročila · brez vezave · postavitev v 1–2 dneh',
  primerjajPakete: 'Primerjaj pakete',
  izracun: 'Okvirno: 27 zamujenih povpraševanj na mesec ≈ 660 € izgube.',
  izracunDrobno: 'Okviren izračun za manjši lokal ali salon.',
  spodnjiNaslov: 'Preizkusi sam, kako odgovarja.',
  stevilka: '38669323814',
};

const STRANI = [
  {
    slug: 'preizkus-gostinstvo',
    naslovStrani: 'Naročila prek WhatsAppa za gostinstvo | FlowTek',
    opis: 'AI pomočnik na tvoji WhatsApp številki sprejema naročila 24/7. 0 € provizije, brez vezave. Preizkusi testno picerijo.',
    h1: 'Telefon zvoni, ti pa ravno mesiš pico?',
    podnaslov: 'AI pomočnik na tvoji WhatsApp številki sprejme naročilo namesto tebe – tudi v največji gneči.',
    gumb: 'Preizkusi testno picerijo na WhatsAppu',
    sporocilo: 'Živjo, lahko naročim eno capriccioso in dve koli?',
    dodatnaVrstica: null,
    kotNaslov: 'Za picerije, gostilne in restavracije',
    kot: [
      'Razume prosto besedilo in pogleda kuhinjo',
      'Potrdi naročilo v nekaj sekundah',
      '0 € provizije od naročila',
      'Povezava z blagajno: Poster, Square, iiko, Loyverse',
      'Vabila nazaj in zbiranje Google ocen',
    ],
    izracunPodJunakom: false,
  },
  {
    slug: 'preizkus-storitve',
    naslovStrani: 'Termini prek WhatsAppa za salone | FlowTek',
    opis: 'AI pomočnik na tvoji WhatsApp številki dogovarja termine 24/7 in dan prej pošlje opomnik. Brez vezave, od 89 €/mes.',
    h1: 'Stranke rezervirajo termin, tudi ko spiš.',
    podnaslov: 'AI pomočnik na tvoji WhatsApp številki pogleda koledar, potrdi termin in dan prej pošlje opomnik.',
    gumb: 'Preizkusi kot stranka na WhatsAppu',
    sporocilo: 'Živjo, imate jutri ob 19.00 prosto mizo za štiri?',
    /*
      Testni lokal je picerija, stran pa govori o salonih. Brez te vrstice
      obiskovalec odpre pogovor in misli, da je kliknil napačen oglas.
    */
    dodatnaVrstica: 'Testni lokal je picerija – rezerviraj mizo in vidiš, kako pomočnik dogovori termin.',
    kotNaslov: 'Za frizerske in kozmetične salone',
    kot: [
      'Pogleda tvoj koledar in potrdi termin v nekaj sekundah',
      'Opomnik stranki dan prej',
      'Vabila nazaj za naslednji obisk',
      'Zbiranje Google ocen',
      'Povezava z Google koledarjem',
    ],
    izracunPodJunakom: false,
  },
  {
    slug: 'preizkus-obrtniki',
    naslovStrani: 'Termini prek WhatsAppa za obrtnike in servise | FlowTek',
    opis: 'Med delom ne moreš odpisati. AI pomočnik na tvoji WhatsApp številki dogovori termin in pošlje opomnik. Od 89 €/mes.',
    h1: 'Roke imaš v motorju, stranka pa piše?',
    podnaslov: 'AI pomočnik na tvoji WhatsApp številki se s stranko dogovori za termin – ti pa delaš naprej.',
    gumb: 'Preizkusi kot stranka na WhatsAppu',
    sporocilo: 'Živjo, lahko naročim dve margeriti za prevzem ob 18.30?',
    dodatnaVrstica: 'Testni lokal je picerija – isti pomočnik enako sprejema termine.',
    kotNaslov: 'Za avtoservise in obrtnike',
    kot: [
      'Odgovarja 24/7 in pogleda tvoj koledar',
      'Potrdi termin v nekaj sekundah',
      'Opomnik stranki dan prej',
      'Stranka ne rabi nove aplikacije',
      '0 € provizije, brez vezave',
    ],
    izracunPodJunakom: false,
  },
  {
    slug: 'preizkus-ai',
    naslovStrani: 'AI avtomatizacija na WhatsAppu | FlowTek',
    opis: 'Naročila, rezervacije, termini, opomniki in Google ocene na tvoji WhatsApp številki, 24/7. Od 89 €/mes, brez vezave.',
    h1: 'Neodgovorjena sporočila: okvirno 660 € izgube na mesec.',
    podnaslov: 'FlowTek je AI avtomatizacija na tvoji obstoječi WhatsApp številki – za lokale, salone, servise in obrtnike.',
    gumb: 'Preizkusi kot stranka na WhatsAppu',
    sporocilo: 'Živjo, kaj vse lahko naročim pri vas?',
    dodatnaVrstica: null,
    kotNaslov: 'Kaj avtomatizira',
    kot: [
      'Naročila, rezervacije in termini 24/7',
      'Opomniki dan prej in vabila nazaj',
      'Zbiranje Google ocen',
      'Povezava z blagajno in koledarjem: Poster, Square, iiko, Loyverse, Google koledar',
      '0 € provizije, brez vezave, postavitev v 1–2 dneh',
    ],
    // Naslov te strani govori o 660 € — izračun mora stati takoj pod njim.
    izracunPodJunakom: true,
  },
];

module.exports = { SKUPNO, STRANI };
