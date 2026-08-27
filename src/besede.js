/*
  Slovenske besede v botovih vprašanjih.

  Zakaj obstaja: vprašanje "Koliko *Klasika* želite?" ne pove, da je Klasika
  pizza. Naravno bi bilo "Koliko pic *Klasika* želite?" — po "koliko" pa gre v
  slovenščini RODILNIK MNOŽINE (koliko pic, koliko solat, koliko dodatkov), in
  te oblike iz poljubnega imena kategorije ni mogoče izpeljati s pravilom.
  Zato je tu majhen slovar in pošten izhod v sili: kadar kategorije ne poznamo,
  besede ne dodamo — nobene napačne sklanjatve ni.

  Kategorijo vpiše lastnik sam ("Pizze", "Testenine, rižote in njoki"), zato
  iščemo ključno besedo V kategoriji in ne enakosti. Tri pravila so nastala
  iz Botaninega pravega menija:

    1) Kadar kategorija našteva več vrst ("Testenine, rižote in njoki"),
       besede NE dodamo — sicer bi rižoto imenovali testenine.
    2) Kadar je beseda že v imenu artikla ("Grška pica", "Botana solata"),
       je ne ponavljamo.
    3) "Glavne jedi" ostanejo brez besede: "Koliko jedi Ljubljanski zrezek"
       je slabše kot brez.
*/

// ključna beseda v kategoriji (brez šumnikov) → rodilnik množine
const RODILNIK = [
  ['pizz',      'pic'],
  ['pic',       'pic'],
  ['burger',    'burgerjev'],
  ['sendvic',   'sendvičev'],
  ['kebab',     'kebabov'],
  ['testenin',  'testenin'],
  ['pasta',     'testenin'],
  ['rizot',     'rižot'],
  ['njok',      'njokov'],
  ['solat',     'solat'],
  ['juh',       'juh'],
  ['sladic',    'sladic'],
  ['palacink',  'palačink'],
  ['predjed',   'predjedi'],
  ['priloga',   'prilog'],
  ['priloge',   'prilog'],
  ['omak',      'omak'],
  ['pijac',     'pijač'],
  ['napitk',    'pijač'],
  ['sokov',     'pijač'],
  ['dodat',     'dodatkov'],
  ['toping',    'dodatkov']
];

// oblika → vse ključne besede, ki dajo to obliko ('pic' ← 'pizz' in 'pic')
const KLJUCI_ZA = RODILNIK.reduce((m, [k, o]) => { (m[o] = m[o] || []).push(k); return m; }, {});

function brezSumnikov(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/* Rodilnik množine za kategorijo tega artikla, ali null. */
function kolicinsko(kategorija, ime) {
  const k = brezSumnikov(kategorija);
  if (!k) return null;

  // 1) več vrst v eni kategoriji = ni ene prave besede
  const oblike = [...new Set(RODILNIK.filter(([kljuc]) => k.includes(kljuc)).map(([, o]) => o))];
  if (oblike.length !== 1) return null;
  const oblika = oblike[0];

  // 2) beseda je že v imenu artikla
  const i = brezSumnikov(ime);
  if (KLJUCI_ZA[oblika].some(kljuc => i.includes(kljuc))) return null;

  return oblika;
}

/*
  Celo vprašanje po količini. Zvezdice so WhatsApp krepki tisk.
    Koliko pic *Klasika* želite?      (kategorija znana)
    Koliko *Klasika* želite?          (ni znana — kot doslej)
*/
function vprasajKolicino(ime, kategorija) {
  const beseda = kolicinsko(kategorija, ime);
  return 'Koliko ' + (beseda ? beseda + ' ' : '') + '*' + String(ime || '').trim() + '* želite?';
}

module.exports = { kolicinsko, vprasajKolicino };
