/*
  Zapiše izid poslanega paketa v bazo.

    node tools/izid.js                 → samo pokaže, kaj bi naredil
    node tools/izid.js --zares         → zapiše

  ZAKAJ OBSTAJA

    Pisma odidejo iz poštnega odjemalca, baza o tem ne ve nič. Brez tega
    koraka se vseh trideset lokalov jutri vrne v vrsto in dobijo drugo
    pismo — kar je natanko tisto, kar se hladnemu nagovarjanju ne sme
    zgoditi.

    Zapiše se, kaj se je res zgodilo, in ne, kaj smo nameravali: dostavljeno,
    zavrnjeno ali dostavljeno s težavo. Zavrnjeni naslovi gredo hkrati med
    ne_kontaktiraj, ker mrtev naslov ne oživi.

  KAJ POMENI ZAVRNITEV ZA UGLED DOMENE

    Trajna zavrnitev (naslov ne obstaja) je najdražja vrsta napake pri
    hladnem pošiljanju. Ponudniki jo štejejo kot znak, da pošiljatelj ne ve,
    komu piše. Zato je vsaka zabeležena zavrnitev vredna več kot uspešna
    dostava: iz vrste odstrani naslov, ki bi drugič spet odbil.
*/
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SB = process.env.SUPABASE_URL;
const KLJUC = process.env.SUPABASE_KEY;
if (!SB || !KLJUC) { console.error('Manjka SUPABASE_URL ali SUPABASE_KEY.'); process.exit(1); }
const GLAVA = { apikey: KLJUC, Authorization: 'Bearer ' + KLJUC, 'Content-Type': 'application/json' };

const ZARES = process.argv.includes('--zares');
const PAKET = path.join(__dirname, '..', 'out', 'paket.json');

/*
  Izid po e-naslovu. Vse, kar tu ni našteto, velja za dostavljeno.

  Naslovi in ne številke, ker je poročilo o dostavi prišlo z naslovi —
  prepisovanje v številke je korak, kjer se pri tridesetih vrsticah zmotiš.
*/
const ZAVRNJENI = [
  'peter.zavesek@siol.net',
  'info@kitajskivrt.si',
  'gostilnaa@gmail.com',
  'smart.f@siol.net',
];
const BREZ_SLIKE = ['kangqiangsen@gmail.com'];

const KDAJ = process.argv.includes('--kdaj')
  ? process.argv[process.argv.indexOf('--kdaj') + 1]
  : new Date().toISOString();

(async () => {
  const paket = JSON.parse(fs.readFileSync(PAKET, 'utf8'));
  const norm = (e) => String(e || '').trim().toLowerCase();

  const zapisi = paket.map((l) => {
    const e = norm(l.email);
    if (ZAVRNJENI.includes(e)) {
      return { ...l, izid: 'napaka', opomba: 'Trajna zavrnitev: naslov ne obstaja' };
    }
    if (BREZ_SLIKE.includes(e)) {
      return { ...l, izid: 'poslano', opomba: 'Dostavljeno, a se vložena slika ni prikazala' };
    }
    return { ...l, izid: 'poslano', opomba: null };
  });

  const povzetek = zapisi.reduce((a, z) => { a[z.izid] = (a[z.izid] || 0) + 1; return a; }, {});
  console.log('\n  Paket: ' + paket.length + ' lokalov');
  console.log('  ' + JSON.stringify(povzetek));
  console.log('\n  Zavrnjeni (gredo tudi med ne_kontaktiraj):');
  for (const z of zapisi.filter((x) => x.izid === 'napaka')) {
    console.log('     ' + String(z.id).padStart(5) + '  ' + z.ime.padEnd(34) + '  ' + z.email);
  }
  const posebni = zapisi.filter((x) => x.opomba && x.izid === 'poslano');
  if (posebni.length) {
    console.log('\n  Z opombo:');
    for (const z of posebni) console.log('     ' + String(z.id).padStart(5) + '  ' + z.ime.padEnd(34) + '  ' + z.opomba);
  }

  if (!ZARES) { console.log('\n  Nič ni zapisano. Za izvedbo dodaj --zares\n'); return; }

  let stikov = 0;
  let odjav = 0;
  let stanj = 0;

  for (const z of zapisi) {
    /*
      Dvakratni zapis istega pisma bi pomenil dva stika in napačen povzetek,
      zato najprej pogledamo, ali zapis za ta dan že obstaja.
    */
    const dan = KDAJ.slice(0, 10);
    const obstoj = await fetch(
      SB + '/rest/v1/sb_lead_stiki?select=id&lead_id=eq.' + z.id
      + '&kanal=eq.email&zgodilo_at=gte.' + dan + 'T00:00:00Z&zgodilo_at=lte.' + dan + 'T23:59:59Z',
      { headers: GLAVA }
    );
    if ((await obstoj.json()).length) {
      console.log('  · ' + z.id + ' že zapisan za ' + dan + ', stik preskočen');
    } else {
      const r = await fetch(SB + '/rest/v1/sb_lead_stiki', {
        method: 'POST',
        headers: GLAVA,
        body: JSON.stringify({
          lead_id: z.id,
          kanal: 'email',
          smer: 'odhod',
          zgodilo_at: KDAJ,
          izid: z.izid,
          zadeva: 'AI na vašem WhatsAppu',
          priponka: z.slug + '.png',
          opomba: z.opomba,
        }),
      });
      if (!r.ok) { console.error('  ✖ stik ' + z.id + ': ' + (await r.text()).slice(0, 160)); continue; }
      stikov += 1;
    }

    /*
      status pomeni "kje v lijaku je" (migracija 010). Po poslanem pismu
      lead ni več "pending" — to bi pomenilo, da mu nismo pisali.

      Prvi zagon tega ni zapisal: dnevnik je imel trideset zapisov, status
      pa je ostal pending in leads.html je vseh trideset kazal kot "Čaka".

      Kdor je že odgovoril (interested / not_interested), ostane, kjer je;
      odgovor je dlje v lijaku od poslanega pisma.
    */
    const st = await fetch(SB + '/rest/v1/leads?id=eq.' + z.id
      + '&status=in.(pending,new)', {
      method: 'PATCH',
      headers: GLAVA,
      body: JSON.stringify({ status: 'sent' }),
    });
    if (st.ok) stanj += 1;

    if (z.izid === 'napaka') {
      const p = await fetch(SB + '/rest/v1/leads?id=eq.' + z.id, {
        method: 'PATCH',
        headers: GLAVA,
        body: JSON.stringify({
          ne_kontaktiraj: true,
          ne_kontaktiraj_razlog: 'Trajna zavrnitev pošte ' + KDAJ.slice(0, 10) + ': naslov ne obstaja',
        }),
      });
      if (p.ok) odjav += 1;
    }
  }

  console.log('\n  zapisanih stikov: ' + stikov);
  console.log('  status → sent: ' + stanj);
  console.log('  označenih ne_kontaktiraj: ' + odjav + '\n');
})();
