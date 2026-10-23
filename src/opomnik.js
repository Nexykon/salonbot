// ─── Opomnik dan pred terminom: potrditev z DA, odpoved z NE ─────────────
//
// Scheduler pošlje opomnik kot odobreno Meta predlogo "salon_opomnik" z
// gumboma DA / NE (wa.reminderTemplate). Ko stranka odgovori NE, se termin
// odpove in se takoj sprosti: prosti termini (getBookedTimesForDate)
// odpovedanih ne štejejo. Na DA se stranki zahvalimo; termin ostane potrjen.
//
// Besedni odgovor velja samo, če ima stranka jutri ali danes termin, za
// katerega je že dobila opomnik, in ni sredi drugega pogovora z botom;
// sicer bi "da" iz običajnega rezerviranja razumeli kot odgovor na opomnik.
//
// besedilo() in gumbi() sta zapisana ubeseditev, ki jo mora nositi odobrena
// predloga v Meti — besedilo predloge živi tam, ne tu, zato je to edino
// mesto, kjer se da ob pregledu preveriti, ali se ujemata. Uporabita se tudi
// takrat, kadar je stranka znotraj 24-urnega okna in predloga ni potrebna.
//
// V id gumba gre cel UUID termina, ne šestmestni ref6 kot pri admin gumbih
// (whatsapp.js): ref6 je tam dovolj, ker ga lastnik vidi ob imenu stranke,
// tu pa je id edino, po čemer vemo, kateri termin odpovedati.

const GUMB_DA = 'opomnik_da_';
const GUMB_NE = 'opomnik_ne_';

const DA = /^\s*(da|ja|jaa|ok|okej|potrjujem|potrdim|pridem|bom|seveda|velja)\b[\s!.👍🙂😊]*$/i;
const NE = /^\s*(ne|odpovem|odpovedujem|ne morem|ne bom|ne pridem)\b[\s!.]*$/i;

/*
  Nagovor je brez imena stranke zato, ker mora biti to besedilo enako
  odobreni predlogi, ta pa nosi tri parametre: datum, uro in ime lokala.
  customer_name je pogosto prazen (gost napiše samo številko), zato bi
  četrti parameter pomenil ali prazen nagovor ali ugibanje — pri sporočilu,
  ki ga stranka dobi brez svoje pobude, je splošen nagovor varnejši.
*/
function besedilo(salon, booking, imeDatuma) {
  const ura = (booking.booking_time || '').substring(0, 5);
  return `⏰ *Opomnik za jutri*\n\n` +
    `Pozdravljeni! 👋\n\n` +
    `Jutri, *${imeDatuma}* ob *${ura}*, vas čakamo v salonu *${salon.name}*.\n\n` +
    `Potrdite z *DA* ali odpovejte z *NE*.`;
}

function gumbi(booking) {
  return [
    { id: GUMB_DA + booking.id, naslov: '✅ DA, pridem' },
    { id: GUMB_NE + booking.id, naslov: '❌ NE, odpovem' }
  ];
}

/** Odgovor na opomnik iz gumba ali besedila: { odgovor: 'da' | 'ne', bookingId? } ali null. */
function razberi(iId, msgText) {
  if (iId && iId.startsWith(GUMB_DA)) return { odgovor: 'da', bookingId: iId.slice(GUMB_DA.length) };
  if (iId && iId.startsWith(GUMB_NE)) return { odgovor: 'ne', bookingId: iId.slice(GUMB_NE.length) };
  if (!iId && msgText) {
    if (NE.test(msgText)) return { odgovor: 'ne' };
    if (DA.test(msgText)) return { odgovor: 'da' };
  }
  return null;
}

const odgovorDa = (ura) => `Hvala za potrditev! 😊 Vidimo se jutri ob ${ura}.`;
const odgovorNe = () => 'V redu, termin je odpovedan. Hvala, da ste sporočili! 🙏\n\nZa nov termin nam kadar koli pišite.';
const obvestiloLastniku = (booking, imeDatuma) =>
  `❌ *Odpoved po opomniku*\n\n${booking.customer_name || '+' + booking.customer_phone} je odpovedal(a) termin ` +
  `*${imeDatuma}* ob *${(booking.booking_time || '').substring(0, 5)}*.\n\nTermin je spet prost.`;

module.exports = { besedilo, gumbi, razberi, odgovorDa, odgovorNe, obvestiloLastniku, GUMB_DA, GUMB_NE };
