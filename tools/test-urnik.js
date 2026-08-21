/*
  Preverjanje urnika po dnevih — src/urnik.js.
  Brez baze in brez omrežja: samo vhod → izhod.

    node tools/test-urnik.js
*/
const u = require('../src/urnik');

let ok = 0, ni = 0;
function je(opis, dobil, pricakoval) {
  const a = JSON.stringify(dobil), b = JSON.stringify(pricakoval);
  if (a === b) { ok++; console.log('  ✔ ' + opis); }
  else { ni++; console.log('  ✖ ' + opis + '\n      dobil:       ' + a + '\n      pričakoval:  ' + b); }
}

// Referenčni trenutki (Europe/Ljubljana je avgusta UTC+2)
const PON_11 = new Date('2026-08-24T09:00:00Z'); // ponedeljek 11:00
const PON_09 = new Date('2026-08-24T07:00:00Z'); // ponedeljek 09:00
const PON_23 = new Date('2026-08-24T21:00:00Z'); // ponedeljek 23:00
const NED_13 = new Date('2026-08-23T11:00:00Z'); // nedelja 13:00
const TOR_002 = new Date('2026-08-25T22:30:00Z'); // torek 00:30 (v sredo? ne: 22:30Z = 00:30 sredo)

console.log('\n1) Star model brez novega urnika (Botana: 1–6, 10:00–21:00)');
{
  const s = { working_days: '1,2,3,4,5,6', working_hours_start: '10:00', working_hours_end: '21:00' };
  je('ponedeljek odprt 10–21', u.zaDan(s, 1), { od: '10:00', do: '21:00' });
  je('nedelja zaprta', u.zaDan(s, 0), null);
  je('besedilo', u.besedilo(s), 'Pon–Sob 10:00–21:00, Ned zaprto');
  je('odprti dnevi', [...u.odprtiDnevi(s)].sort(), [1, 2, 3, 4, 5, 6]);
  je('v ponedeljek ob 11:00 odprto', u.jeOdprto(s, PON_11).odprto, true);
  je('v ponedeljek ob 09:00 zaprto', u.jeOdprto(s, PON_09).odprto, false);
  je('v nedeljo ob 13:00 zaprto', u.jeOdprto(s, NED_13).odprto, false);
  je('ob 09:00 spet odprejo danes ob 10:00', u.naslednjeOdprtje(s, PON_09), { dow: 1, od: '10:00', kdaj: 'danes' });
  je('v nedeljo spet odprejo jutri', u.naslednjeOdprtje(s, NED_13), { dow: 1, od: '10:00', kdaj: 'jutri' });
}

console.log('\n2) Podatkovna napaka: working_days vsebuje 7 (Test Picerija)');
{
  const s = { working_days: '1,2,3,4,5,6,7', working_hours_start: '08:00', working_hours_end: '22:00' };
  je('sedmica se bere kot nedelja, ne kot nič', u.zaDan(s, 0), { od: '08:00', do: '22:00' });
  je('besedilo', u.besedilo(s), 'Pon–Ned 08:00–22:00');
  je('v nedeljo ob 13:00 odprto', u.jeOdprto(s, NED_13).odprto, true);
}

console.log('\n3) Nov urnik po dnevih');
{
  const s = {
    working_days: '1,2,3,4,5,6', working_hours_start: '08:00', working_hours_end: '22:00',
    working_hours: {
      0: null,
      1: { od: '11:00', do: '22:00' },
      2: { od: '11:00', do: '22:00' },
      3: { od: '11:00', do: '22:00' },
      4: { od: '11:00', do: '22:00' },
      5: { od: '11:00', do: '23:00' },
      6: { od: '12:00', do: '23:00' }
    }
  };
  je('nov urnik prevlada nad starim', u.zaDan(s, 1), { od: '11:00', do: '22:00' });
  je('nedelja zaprta', u.zaDan(s, 0), null);
  je('besedilo združi enake dni', u.besedilo(s), 'Pon–Čet 11:00–22:00, Pet 11:00–23:00, Sob 12:00–23:00, Ned zaprto');
  je('ob 09:00 še zaprto (star model bi rekel odprto)', u.jeOdprto(s, PON_09).odprto, false);
  je('ob 11:00 odprto', u.jeOdprto(s, PON_11).odprto, true);
  je('urnik za datum 2026-08-23 (nedelja)', u.zaDatum(s, '2026-08-23'), null);
  je('urnik za datum 2026-08-22 (sobota)', u.zaDatum(s, '2026-08-22'), { od: '12:00', do: '23:00' });
}

console.log('\n4) Urnik kot niz (tako ga vrne PostgREST pri text stolpcu)');
{
  const s = { working_hours: '{"1":{"od":"09:00","do":"17:00"}}' };
  je('niz se prebere', u.zaDan(s, 1), { od: '09:00', do: '17:00' });
  je('dnevi brez zapisa so zaprti', u.zaDan(s, 2), null);
}

console.log('\n5) Interval čez polnoč (18:00–01:00)');
{
  const s = { working_hours: { 1: { od: '18:00', do: '01:00' }, 2: { od: '18:00', do: '01:00' } } };
  je('v ponedeljek ob 23:00 odprto', u.jeOdprto(s, PON_23).odprto, true);
  je('v sredo ob 00:30 velja torkov interval', u.jeOdprto(s, TOR_002).odprto, true);
  je('v ponedeljek ob 11:00 zaprto', u.jeOdprto(s, PON_11).odprto, false);
}

console.log('\n6) Zavrnitev smeti (ostane star model)');
{
  je('prazen objekt', u.varenUrnik({}), null);
  je('null', u.varenUrnik(null), null);
  je('pokvarjen JSON', u.varenUrnik('{{{'), null);
  je('polje namesto objekta', u.varenUrnik([1, 2]), null);
  je('od enak do', u.varenUrnik({ 1: { od: '10:00', do: '10:00' } }), null);
  je('ura izven obsega', u.varenUrnik({ 1: { od: '25:00', do: '26:00' } }), null);
  je('en veljaven dan zadošča, ura brez vodilne ničle', u.varenUrnik({ 1: { od: '8:00', do: '17:00' } }),
    { 0: null, 1: { od: '08:00', do: '17:00' }, 2: null, 3: null, 4: null, 5: null, 6: null });
  // '8:5' je dvoumno (08:05 ali 08:50) — raje zavrnemo kot ugibamo
  je('dvoumne minute zavrnjene', u.varenUrnik({ 1: { od: '8:5', do: '17:00' } }), null);
  je('zaprto: true', u.varenUrnik({ 1: { od: '08:00', do: '17:00' }, 2: { zaprto: true, od: '08:00', do: '17:00' } })[2], null);
  je('sekunde se odrežejo', u.varenUrnik({ 3: { od: '08:00:00', do: '17:00:00' } })[3], { od: '08:00', do: '17:00' });
}

console.log('\n7) Vsi dnevi zaprti');
{
  const s = { working_days: '', working_hours: { 0: null } };
  je('besedilo pove zaprto', u.besedilo({ working_hours: { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null } }), 'Pon–Sob 08:00–19:00, Ned zaprto');
  je('prazen working_days pade na privzeto 1–6', [...u.odprtiDnevi(s)].sort(), [1, 2, 3, 4, 5, 6]);
}

console.log('\n8) Oblika za vmesnik');
{
  const s = { working_hours: { 1: { od: '10:00', do: '22:00' } } };
  const v = u.zaVmesnik(s);
  je('sedem vrstic', v.length, 7);
  je('prva je ponedeljek', { dan: v[0].dan, kratko: v[0].kratko }, { dan: 1, kratko: 'Pon' });
  je('zadnja je nedelja', { dan: v[6].dan, kratko: v[6].kratko }, { dan: 0, kratko: 'Ned' });
  je('ponedeljek napolnjen', v[0], { dan: 1, kratko: 'Pon', zaprto: false, od: '10:00', do: '22:00' });
  je('torek zaprt', v[1], { dan: 2, kratko: 'Tor', zaprto: true, od: '', do: '' });
}

console.log('\n' + (ni ? '✖ ' + ni + ' od ' + (ok + ni) + ' ni v redu' : '✔ vse v redu (' + ok + ')'));
process.exit(ni ? 1 : 0);
