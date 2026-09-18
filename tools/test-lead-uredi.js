/*
  Urejanje leada iz brskalnika: popravek vrstice, status, odjava, razveljavitev.

      node tools/test-lead-uredi.js

  ZAKAJ OBSTAJA

    Iz plošče je bilo do zdaj mogoče popraviti eno samo stvar — e-naslov, in
    še to samo pri leadih, ki ga niso imeli. Vse drugo (napačen e-naslov,
    status po odgovoru, odjava) je terjalo poseg v bazo z roko.

    Dvoje je bilo pri tem tiho pokvarjenega:

      · ne_kontaktiraj sploh ni bil med polji, ki jih PATCH sprejema. Ravno
        od te zastavice je odvisno, ali lokal jutri dobi drugo pismo.

      · Gumb ↺ je klical loadLeads(), funkcijo, ki v datoteki ne obstaja,
        strežnik pa je brisal email_sent_at, medtem ko značka bere
        zadnji_stik_at iz dnevnika stikov. Torej: napaka v izpisu, in tudi
        brez nje se ne bi premaknilo nič.

    Preizkus gre skozi vsako od teh poti s pravim strežnikom in pravo bazo.

  KAJ POTREBUJE

    .env s SUPABASE_URL in SUPABASE_KEY. Preizkusni lead in njegovi zapisi
    v dnevniku se na koncu pobrišejo, tudi če preizkus pade.
*/
require('dotenv').config();
const { naloziStran, zazeni, naredFetch, stevec, sb, SB, SBK } = require('./plosca-preizkus');

const VRATA = 3098;
const KLJUC = 'preizkus-' + Math.random().toString(36).slice(2);
const IME = 'PREIZKUS Urejanje Lokal';

const { trdi, konec } = stevec();
const pocisti = () => sb('DELETE', '/leads?business_name=like.PREIZKUS Urejanje*').then((d) => d.length);
const preberi = async () => (await sb('GET', '/leads?select=*&business_name=eq.' + encodeURIComponent(IME)))[0];

(async () => {
  if (!SB || !SBK) { console.error('Manjka SUPABASE_URL ali SUPABASE_KEY.'); process.exit(1); }

  await pocisti();
  const [lead] = await sb('POST', '/leads', {
    business_name: IME,
    email: 'stari@primer.invalid',
    phone: '040 111 222',
    address: 'Stara cesta 2, 1000 Ljubljana',
    category: 'RESTAVRACIJE',
    status: 'pending',
    token: 'preizkus' + Date.now().toString(36) + Math.random().toString(36).slice(2),
  });
  console.log('\n  preizkusni lead: id ' + lead.id);

  const streznik = await zazeni(VRATA, KLJUC);
  const dnevnik = [];
  const mojFetch = naredFetch(VRATA, KLJUC, dnevnik);

  try {
    const stran = () => {
      const s = naloziStran(mojFetch, { confirm: true });
      return s;
    };

    console.log('\n1. Okno se napolni iz vrstice');
    let s = stran();
    s.izvedi('allLeads = ' + JSON.stringify([lead]) + '; renderTable();');
    s.okolje.openEdit(lead.id);
    const p = (id) => s.dom.document.getElementById(id).value;
    trdi('okno je odprto', s.dom.document.getElementById('edit-back').classList.contains('show'));
    trdi('ime je prepisano', p('e-name') === IME, p('e-name'));
    trdi('e-naslov je prepisan', p('e-email') === 'stari@primer.invalid', p('e-email'));
    trdi('telefon je prepisan', p('e-phone') === '040 111 222', p('e-phone'));
    trdi('naslov je prepisan', p('e-address') === 'Stara cesta 2, 1000 Ljubljana', p('e-address'));
    trdi('status pending se pokaže kot Čaka', p('e-status') === 'pending', p('e-status'));

    console.log('\n2. Shrani se samo spremenjeno');
    s.dom.document.getElementById('e-email').value = 'novi@primer.invalid';
    s.dom.document.getElementById('e-notes').value = 'Poklical, prosi za ponudbo v ponedeljek';
    dnevnik.length = 0;
    await s.okolje.saveEdit();
    const patch = dnevnik.find((k) => k.nacin === 'PATCH');
    trdi('šel je PATCH na vrstico', patch && patch.pot === '/api/leads/' + lead.id, patch && patch.pot);
    trdi('poslana sta samo dva spremenjena ključa',
      patch && Object.keys(patch.telo).sort().join(',') === 'email,notes',
      patch && JSON.stringify(patch.telo));
    let v = await preberi();
    trdi('nov e-naslov je v bazi', v.email === 'novi@primer.invalid', v.email);
    trdi('zapiski so v bazi', v.notes === 'Poklical, prosi za ponudbo v ponedeljek', v.notes);
    trdi('telefon se ni spremenil', v.phone === '040 111 222', v.phone);
    trdi('okno se je zaprlo', !s.dom.document.getElementById('edit-back').classList.contains('show'));

    console.log('\n3. Prazno ime se ne shrani');
    s.okolje.openEdit(lead.id);
    s.dom.document.getElementById('e-name').value = '   ';
    dnevnik.length = 0;
    await s.okolje.saveEdit();
    trdi('klica ni bilo', !dnevnik.some((k) => k.nacin === 'PATCH'));
    trdi('napaka je izpisana', s.dom.document.getElementById('e-err').style.display === 'block');
    s.okolje.closeEdit();

    console.log('\n4. Status iz vrstice');
    s = stran();
    v = await preberi();
    s.izvedi('allLeads = ' + JSON.stringify([v]) + '; renderTable();');
    trdi('v vrstici je izbirnik statusa', s.vrstice().includes('class="st-sel'), '');
    trdi('izbrana je možnost Čaka', /value="pending" selected/.test(s.vrstice()));
    const sel = { disabled: false };
    await s.okolje.setStatus(lead.id, 'interested', sel);
    v = await preberi();
    trdi('status je v bazi zainteresiran', v.status === 'interested', v.status);
    trdi('izris pokaže zainteresiran', /value="interested" selected/.test(s.vrstice()));

    console.log('\n5. Neveljaven status strežnik zavrne');
    const r = await mojFetch('/api/leads/' + lead.id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'zainteresiran' }),
    });
    trdi('vrne 400', r.status === 400, String(r.status));
    v = await preberi();
    trdi('status v bazi je nedotaknjen', v.status === 'interested', v.status);

    console.log('\n6. Ne kontaktiraj');
    s = stran();
    s.izvedi('allLeads = ' + JSON.stringify([v]) + '; renderTable();');
    await s.okolje.toggleNeKontaktiraj(lead.id, { disabled: false });
    trdi('vprašal je za razlog', s.vprasanja.some((q) => q.vrsta === 'prompt'));
    v = await preberi();
    trdi('zastavica je postavljena', v.ne_kontaktiraj === true, String(v.ne_kontaktiraj));
    trdi('razlog je zapisan', v.ne_kontaktiraj_razlog === 'Ne želi pošte', v.ne_kontaktiraj_razlog);
    trdi('vrstica je označena kot odjavljena', s.vrstice().includes('class="odjavljen"'));
    trdi('izbirnika statusa odjavljeni nima', !s.vrstice().includes('class="st-sel'));
    trdi('značka pove razlog', s.vrstice().includes('title="Ne želi pošte"'));

    console.log('\n7. Prazen razlog strežnik izpolni sam');
    await sb('PATCH', '/leads?id=eq.' + lead.id, { ne_kontaktiraj: false, ne_kontaktiraj_razlog: null });
    const rr = await mojFetch('/api/leads/' + lead.id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ne_kontaktiraj: true, ne_kontaktiraj_razlog: '   ' }),
    });
    trdi('klic uspe', rr.ok, String(rr.status));
    v = await preberi();
    trdi('razlog ni prazen', Boolean(v.ne_kontaktiraj_razlog), JSON.stringify(v.ne_kontaktiraj_razlog));
    trdi('razlog nosi datum', (v.ne_kontaktiraj_razlog || '').includes(new Date().toISOString().slice(0, 10)), v.ne_kontaktiraj_razlog);

    console.log('\n8. Vrnitev med kontakte počisti razlog');
    s = stran();
    s.izvedi('allLeads = ' + JSON.stringify([v]) + '; renderTable();');
    await s.okolje.toggleNeKontaktiraj(lead.id, { disabled: false });
    v = await preberi();
    trdi('zastavica je odstranjena', v.ne_kontaktiraj === false, String(v.ne_kontaktiraj));
    trdi('razlog je pobrisan', v.ne_kontaktiraj_razlog === null, JSON.stringify(v.ne_kontaktiraj_razlog));

    console.log('\n9. Razveljavitev zadnjega stika');
    /*
      Stik se zapiše tako, kot ga zapiše tools/izid.js. Prožilec nad
      dnevnikom (migracija 010) mora zatem sam napolniti zadnji_stik_at.
    */
    await sb('POST', '/sb_lead_stiki', {
      lead_id: lead.id, kanal: 'email', smer: 'odhod',
      zgodilo_at: new Date().toISOString(), izid: 'poslano', zadeva: 'Preizkus',
    });
    await sb('PATCH', '/leads?id=eq.' + lead.id, { status: 'sent' });
    v = await preberi();
    trdi('prožilec je napolnil zadnji_stik_at', Boolean(v.zadnji_stik_at), JSON.stringify(v.zadnji_stik_at));
    trdi('prožilec je preštel stik', v.stikov === 1, String(v.stikov));

    s = stran();
    s.izvedi('allLeads = ' + JSON.stringify([v]) + '; renderTable();');
    trdi('vrstica pred razveljavitvijo kaže Poslano', /value="sent" selected/.test(s.vrstice()));
    trdi('gumb ↺ je na voljo', s.vrstice().includes('resetLead('));

    await s.okolje.resetLead(lead.id, { innerHTML: '', disabled: false });
    trdi('vprašal je za potrditev', s.vprasanja.some((q) => q.vrsta === 'confirm'));
    const stiki = await sb('GET', '/sb_lead_stiki?select=id&lead_id=eq.' + lead.id);
    trdi('zapis v dnevniku je odstranjen', stiki.length === 0, 'ostalo ' + stiki.length);
    v = await preberi();
    trdi('zadnji_stik_at je spet prazen', v.zadnji_stik_at === null, JSON.stringify(v.zadnji_stik_at));
    trdi('števec stikov je na nuli', v.stikov === 0, String(v.stikov));
    trdi('status je spet pending', v.status === 'pending', v.status);
    trdi('vrstica kaže Čaka', /value="pending" selected/.test(s.vrstice()), '');
    trdi('gumba ↺ ni več', !s.vrstice().includes('resetLead('));
  } finally {
    await mojFetch.pocakaj(); // da osveževanje seznama ne pade sredi klica
    streznik.kill();
    console.log('\n  počiščeno vrstic: ' + await pocisti());
  }

  konec();
})().catch((e) => { console.error('\nnapaka: ' + e.message); process.exit(1); });
