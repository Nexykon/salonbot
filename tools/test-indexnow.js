/*
  Preverba dokazila o lastništvu za IndexNow.

      node tools/test-indexnow.js

  ZAKAJ OBSTAJA

    Dokazilo je ena sama pot, ki mora delovati natanko za en niz in za nobenega
    drugega. Če bi vračala ključ za katerikoli .txt, ne bi dokazovala ničesar —
    in to bi se opazilo šele takrat, ko bi kdo tuj pošiljal obvestila v našem
    imenu. Zato se preverja oboje: da pravi naslov deluje in da vsi drugi ne.

    Strežnik se zažene s svojim, izmišljenim ključem. Pravega ta preizkus ne
    potrebuje in ga ne sme videti.
*/
const path = require('path');
const { spawn } = require('child_process');

const KOREN = path.join(__dirname, '..');
const VRATA = 3092;
/* Namerno drugačne oblike kot pravi, da se ju ne da zamenjati. */
const KLJUC = 'preizkusnikljuc0000000000000test1';

let ok = 0;
const napake = [];
const trdi = (opis, pogoj, dodatek) => {
  if (pogoj) { ok += 1; console.log('  ✓ ' + opis); }
  else { napake.push(opis + (dodatek ? ' — ' + dodatek : '')); console.log('  ✖ ' + opis + (dodatek ? ' — ' + dodatek : '')); }
};

function zazeni(okolje) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(KOREN, 'server.js')], {
      cwd: KOREN, env: { ...process.env, PORT: String(VRATA), ...okolje }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let izpis = '';
    const cakaj = setTimeout(() => reject(new Error('strežnik se ni zagnal:\n' + izpis)), 30000);
    p.stdout.on('data', (d) => { izpis += d; if (izpis.includes('running on port')) { clearTimeout(cakaj); resolve({ p, izpis: () => izpis }); } });
    p.stderr.on('data', (d) => { izpis += d; });
    p.on('exit', () => clearTimeout(cakaj));
  });
}

const vzemi = async (pot) => {
  const r = await fetch('http://127.0.0.1:' + VRATA + pot);
  return { status: r.status, tip: r.headers.get('content-type') || '', telo: await r.text() };
};

(async () => {
  console.log('\n1. S ključem');
  let s = await zazeni({ INDEXNOW_KEY: KLJUC });
  try {
    let o = await vzemi('/' + KLJUC + '.txt');
    trdi('pravi naslov vrne 200', o.status === 200, String(o.status));
    trdi('telo je samo ključ', o.telo === KLJUC, JSON.stringify(o.telo).slice(0, 60));
    trdi('brez preloma na koncu', !/\s$/.test(o.telo));
    trdi('tip je text/plain', /text\/plain/.test(o.tip), o.tip);

    /*
      Osrednja trditev: dokazilo velja za en sam niz. Brez tega bi ga lahko
      pobral kdorkoli in v našem imenu pošiljal obvestila IndexNow.
    */
    for (const tuj of ['/nekaj-drugega.txt', '/preizkusnikljuc0000000000000test2.txt', '/.txt', '/KLJUC.txt']) {
      const t = await vzemi(tuj);
      trdi('tuj naslov ' + tuj.padEnd(42) + ' vrne 404', t.status === 404, String(t.status));
    }

    console.log('\n2. Prave datoteke imajo prednost');
    for (const [pot, mora] of [['/robots.txt', 'Sitemap:'], ['/llms.txt', '# FlowTek']]) {
      const t = await vzemi(pot);
      trdi(pot.padEnd(14) + ' je še vedno prava datoteka', t.status === 200 && t.telo.includes(mora), t.status + ' ' + t.telo.slice(0, 30));
      trdi(pot.padEnd(14) + ' ne vsebuje ključa', !t.telo.includes(KLJUC));
    }

    console.log('\n3. robots.txt kaže na sitemap');
    const rob = await vzemi('/robots.txt');
    trdi('navaja Sitemap: https://flowtek.si/sitemap.xml', rob.telo.includes('Sitemap: https://flowtek.si/sitemap.xml'));
    trdi('pravila za GPTBot ostajajo', rob.telo.includes('GPTBot'));
    trdi('pravila za ClaudeBot ostajajo', rob.telo.includes('ClaudeBot'));

    trdi('ob zagonu pove, da je vklopljen', /\[indexnow\] ključ je nastavljen/.test(s.izpis()));
  } finally { s.p.kill(); }

  console.log('\n4. Brez ključa');
  /* Brez spremenljivke pot ne sme obstajati — sicer bi vračala prazno vrednost. */
  s = await zazeni({ INDEXNOW_KEY: '' });
  try {
    const o = await vzemi('/' + KLJUC + '.txt');
    trdi('pot se sploh ne registrira (404)', o.status === 404, String(o.status));
    trdi('ob zagonu pove, da je izklopljen', /\[indexnow\] izklopljen/.test(s.izpis()));
  } finally { s.p.kill(); }

  console.log('\n  ' + ok + ' trditev drži' + (napake.length ? ', ' + napake.length + ' pade' : '') + '\n');
  if (napake.length) { for (const n of napake) console.log('   ✖ ' + n); process.exit(1); }
})().catch((e) => { console.error('\nnapaka: ' + e.message); process.exit(1); });
