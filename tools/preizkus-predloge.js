/*
  Pošlje predlogo salon_opomnik na eno številko in pove, kaj je Meta odgovorila.

      node tools/preizkus-predloge.js --lokal "Test Picerija" --na 38641234567
      node tools/preizkus-predloge.js --lokal "Test Picerija" --na 38641234567 --zares

  Brez --zares se NIČ ne pošlje: izpiše se samo telo klica, da se vidi, kaj bi
  odšlo in komu.

  ZAKAJ OBSTAJA

    Seznama predlog od tu ni mogoče prebrati — za to je potreben id računa
    WhatsApp Business, ki ga nikjer ne hranimo in se ga iz sistemskega žetona
    ne da izluščiti. Edina preverba, ki nam je na voljo, je poskus pošiljanja.

    Hkrati je to močnejša preverba od seznama: potrdi celo pot — pravo ime
    predloge, pravi jezik, pravo število parametrov in pravi vrstni red gumbov
    — in ne le tega, da predloga nekje obstaja.

  KAJ POMENIJO ODGOVORI

    132001  predloge s tem imenom in jezikom na tem računu ni
    132000  število parametrov se ne ujema s predlogo
    132005  predloga ni odobrena
    131047  zunaj 24-urnega okna (pri predlogi se ne bi smelo zgoditi)
    131026  prejemnik ni dosegljiv prek WhatsAppa

  POZOR

    To pošlje pravo sporočilo pravi osebi. Lokal izbiraj premišljeno —
    Botana in Trixy-Tatoo-Art sta pravi stranki, njuna številka pa je ta, ki
    jo prejemnik vidi.
*/
require('dotenv').config();
const wa = require('../src/whatsapp');

const arg = (ime, privzeto) => {
  const i = process.argv.indexOf('--' + ime);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : privzeto;
};

const LOKAL = arg('lokal', 'Test Picerija');
const NA = String(arg('na', '')).replace(/[^\d]/g, '');
const ZARES = process.argv.includes('--zares');

const SB = process.env.SUPABASE_URL;
const KLJUC = process.env.SUPABASE_KEY;

(async () => {
  if (!NA) { console.error('Manjka --na <telefonska številka s klicno kodo>'); process.exit(1); }

  const saloni = await (await fetch(SB + '/rest/v1/sb_salons?select=id,name,whatsapp_phone_number_id,whatsapp_access_token', {
    headers: { apikey: KLJUC, Authorization: 'Bearer ' + KLJUC },
  })).json();
  const salon = saloni.find((s) => s.name === LOKAL);
  if (!salon) { console.error('Lokala "' + LOKAL + '" ni. Na voljo: ' + saloni.map((s) => s.name).join(', ')); process.exit(1); }
  if (!salon.whatsapp_phone_number_id) { console.error('Lokal "' + LOKAL + '" nima priklopljenega WhatsAppa.'); process.exit(1); }

  /* Datum in ura sta izmišljena — preverjamo predlogo, ne termina. */
  const jutri = new Date(Date.now() + 86400000);
  const datum = jutri.toLocaleDateString('sl-SI', { weekday: 'long', day: 'numeric', month: 'long' });
  const telo = wa.reminderTemplate(NA, datum, '15:00', salon.name, 'preizkus-brez-termina');

  console.log('\n  pošiljatelj: ' + salon.name + ' (phone_number_id ' + salon.whatsapp_phone_number_id + ')');
  console.log('  prejemnik:   +' + NA);
  console.log('  predloga:    ' + telo.template.name + ' (' + telo.template.language.code + ')');
  for (const c of telo.template.components) {
    if (c.type === 'body') console.log('  parametri:   ' + c.parameters.map((p) => p.text).join(' · '));
    else console.log('  gumb ' + c.index + ':      ' + c.parameters[0].payload);
  }

  if (!ZARES) { console.log('\n  Nič ni poslano. Za izvedbo dodaj --zares\n'); return; }

  try {
    const o = await wa.send(salon.whatsapp_phone_number_id, salon.whatsapp_access_token || process.env.WA_TOKEN, telo);
    console.log('\n  ✔ sprejeto pri Meti · id sporočila: ' + ((o.messages || [{}])[0].id || '?'));
    console.log('    Predloga torej obstaja, je odobrena in se ujema po številu parametrov.');
    console.log('    Ali je res prišla, pove telefon — sprejem pri Meti ni dostava.\n');
  } catch (e) {
    console.log('\n  ✖ Meta je zavrnila: ' + e.message + '\n');
    process.exitCode = 1;
  }
})();
