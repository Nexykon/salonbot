const cron = require('node-cron');
const db = require('./supabase');
const wa = require('./whatsapp');
const mail = require('./email');
const t = require('./time');

const ADMIN_PHONE = process.env.ADMIN_PHONE;

function fmtDate(dateStr) {
  if (!dateStr) return '?';
  const d = new Date(dateStr.substring(0, 10) + 'T12:00:00');
  return d.toLocaleDateString('sl-SI', { weekday: 'long', day: 'numeric', month: 'long' });
}

function dateOffset(base, days) {
  const d = new Date(base + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function todayStr() {
  return t.todayStr();
}

// ─── 1. OPOMNIK (dan pred terminom, samo če rezervirano >7 dni vnaprej) ──────
// Pogoj: booking_date = jutri AND created_at <= booking_date - 7 dni
// → Stranka ki je rezervirala vsaj teden naprej dobi opomnik dan pred terminom
async function sendReminders() {
  try {
    const salons = await db.getAllSalons();
    for (const salon of salons) {
      if (!salon.whatsapp_phone_number_id) continue;
      const phoneId = salon.whatsapp_phone_number_id;
      const token = salon.whatsapp_access_token || process.env.WA_TOKEN;
      const tomorrow = dateOffset(todayStr(), 1);

      const bookings = await db.getBookingsForReminder(salon.id, tomorrow);
      for (const b of bookings) {
        try {
          const time = (b.booking_time || '').substring(0, 5);
          const name = b.customer_name || 'stranka';
          const dateLabel = fmtDate(b.booking_date);
          const msg =
            `⏰ *Opomnik za jutri*\n\n` +
            `Pozdravljeni${name ? ' ' + name.split(' ')[0] : ''}! 👋\n\n` +
            `Jutri, *${dateLabel}* ob *${time}*, vas čakamo v salonu *${salon.name}*.\n\n` +
            `Če ne morete priti, nas prosim obvestite čim prej. Hvala! 🙏`;

          await wa.send(phoneId, token, wa.textMsg(b.customer_phone, msg));
          await db.updateBookingFields(b.id, { reminder_sent: true });
          console.log(`[reminder] Sent to ${b.customer_phone} for ${b.booking_date}`);
        } catch (e) {
          console.error(`[reminder] Error for booking ${b.id}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[reminders] Error:', e.message);
  }
}

// ─── 2. PROŠNJA ZA RECENZIJO (2h po terminu) ─────────────────────────────────
// Teče vsako uro — pogleda termine ki so bili danes in imajo booking_time <= zdaj - 2h
async function sendReviewRequests() {
  try {
    const salons = await db.getAllSalons();
    const today = todayStr();

    for (const salon of salons) {
      if (!salon.whatsapp_phone_number_id) continue;
      const phoneId = salon.whatsapp_phone_number_id;
      const token = salon.whatsapp_access_token || process.env.WA_TOKEN;

      const reviewLink = salon.review_link || '';
      const reviewMsg = salon.review_message ||
        `Hvala za obisk! 🌟 Bi nam pomagali z oceno na Google? Vsaka recenzija nam ogromno pomeni.\n\n` +
        (reviewLink ? `👉 ${reviewLink}\n\n` : '') +
        `Hvala lepa! 🙏`;

      const bookings = await db.getBookingsForReview(salon.id, today);
      for (const b of bookings) {
        try {
          const [h, m] = (b.booking_time || '00:00').split(':').map(Number);
          const [nh, nm] = t.nowTimeStr().split(':').map(Number);
          const diffHours = ((nh * 60 + nm) - (h * 60 + m)) / 60;

          // Pošlji samo če je minilo 2–4 ure od termina
          if (diffHours >= 2 && diffHours < 4) {
            const firstName = (b.customer_name || '').split(' ')[0];
            const greeting = firstName ? `${firstName}, ` : '';
            const msg = `${greeting}${reviewMsg}`;
            await wa.send(phoneId, token, wa.textMsg(b.customer_phone, msg));
            await db.updateBookingFields(b.id, { review_sent: true });
            console.log(`[review] Sent to ${b.customer_phone} for booking ${b.id}`);
          }
        } catch (e) {
          console.error(`[review] Error for booking ${b.id}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[reviews] Error:', e.message);
  }
}

// ─── 3. REAKTIVACIJA (8 tednov / 56 dni od zadnjega obiska) ──────────────────
// Vsak dan zjutraj — pogleda stranke ki so bile točno 56 dni nazaj in od takrat niso rezervirale
async function sendReactivations() {
  try {
    const salons = await db.getAllSalons();
    const date56ago = dateOffset(todayStr(), -56);

    for (const salon of salons) {
      if (!salon.whatsapp_phone_number_id) continue;
      const phoneId = salon.whatsapp_phone_number_id;
      const token = salon.whatsapp_access_token || process.env.WA_TOKEN;

      const reactivMsg = salon.reactivation_message ||
        `Pozdravljen/a! 💇\n\n` +
        `Že 8 tednov vas nismo videli v salonu *${salon.name}* — upamo, da ste v redu! 😊\n\n` +
        `Ko boste pripravljeni, smo tukaj. Rezervirajte termin:`;

      const bookings = await db.getBookingsForReactivation(salon.id, date56ago);
      // Dedupliciraj po customer_phone
      const phones = new Set();
      for (const b of bookings) {
        if (phones.has(b.customer_phone)) continue;
        phones.add(b.customer_phone);
        try {
          // Preveri da stranka nima novejše rezervacije
          const newer = await db.getBookingsForRange(salon.id, dateOffset(date56ago, 1), todayStr());
          const hasNewer = newer.some(n =>
            n.customer_phone === b.customer_phone && n.status !== 'cancelled'
          );
          if (hasNewer) continue;

          const firstName = (b.customer_name || '').split(' ')[0];
          const greeting = firstName ? `Pozdravljeni ${firstName}! 👋\n\n` : '';
          const msg = `${greeting}${reactivMsg}`;
          await wa.send(phoneId, token, wa.textMsg(b.customer_phone, msg));
          console.log(`[reactivation] Sent to ${b.customer_phone} (last visit: ${date56ago})`);
        } catch (e) {
          console.error(`[reactivation] Error for ${b.customer_phone}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[reactivations] Error:', e.message);
  }
}

// ─── 4. DAILY SUMMARY ────────────────────────────────────────────────────────
async function sendDailySummary() {
  try {
    const salon = await db.getSalon();
    if (!salon || !ADMIN_PHONE) return;

    const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
    const token = salon.whatsapp_access_token || process.env.WA_TOKEN;
    const today = todayStr();
    const stats = await db.getDailyStats(salon.id, today);

    const d = new Date(today + 'T12:00:00');
    const dateStr = d.toLocaleDateString('sl-SI', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    let msg = `📊 *FlowTiq — ${dateStr}*\n\n`;
    msg += `📅 Rezervacije danes: *${stats.total}*\n`;
    msg += `✅ Potrjene: *${stats.confirmed}*\n`;
    msg += `⏳ Čakajoče: *${stats.pending}*\n`;
    msg += `❌ Odpovedane: *${stats.cancelled}*\n`;

    if (stats.list && stats.list.length > 0) {
      msg += `\n🗓️ *Urnik za danes:*\n`;
      for (const b of stats.list) {
        const t = (b.booking_time || '').substring(0, 5);
        const name = b.customer_name || b.customer_phone;
        const st = b.status === 'pending' ? ' ⏳' : '';
        msg += `  • ${t} — ${name}${st}\n`;
      }
    } else {
      msg += `\n_Ni naročil za danes._`;
    }

    if (stats.pending > 0) {
      msg += `\n\n💡 Imate ${stats.pending} čakajočih rezervacij. Napišite "termini" za potrditev.`;
    }

    await wa.send(phoneId, token, wa.textMsg(ADMIN_PHONE, msg));
    console.log('[summary] Daily summary sent for', dateStr);
  } catch (e) {
    console.error('[summary] Error:', e.message);
  }
}

// ─── AI dnevnik: dnevni povzetek nerazumljenih sporočil ─────────────────────
async function sendAiMissDigest() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const misses = await db.getAiMissesSince(since);
    if (!misses.length) return;
    const salons = await db.getAllSalons();
    const nameOf = (id) => (salons.find(s => s.id === id) || {}).name || id;
    const lines = misses.map(m =>
      `[${(m.created_at || '').slice(11, 16)}] ${nameOf(m.salon_id)} · +${m.phone} · faza: ${m.stage}\n  "${m.message}"  (${m.context})`
    );
    const owner = process.env.FLOWTIQ_OWNER_EMAIL || 'info@flowtiq.si';
    await mail.sendEmail(owner, `AI natakar — ${misses.length} nerazumljenih sporočil (24h)`, [
      `Sporočila, ki jih AI natakar v zadnjih 24h ni razumel (padel na varovalni odgovor):`,
      ``,
      ...lines,
      ``,
      `Prilepi ta seznam v Cowork in luknje bova zabila.`
    ].join('\n'));
    console.log(`[ai-digest] Poslan povzetek ${misses.length} nerazumljenih.`);
  } catch (e) {
    console.error('[ai-digest] Error:', e.message);
  }
}

// ─── START ────────────────────────────────────────────────────────────────────
function startScheduler() {
  const tz = 'Europe/Ljubljana';

  // Vsak dan ob 08:00 — daily summary + opomnike za jutri + reaktivacije
  // Saloni: povzetek, opomniki, reaktivacije
  cron.schedule('0 8 * * *', async () => {
    await sendDailySummary();
    await sendReminders();
    await sendReactivations();
  }, { timezone: tz });

  // AI natakar (gostilne): ločen dnevni pregled nerazumljenih sporočil -> email FlowTiq
  cron.schedule('30 7 * * *', sendAiMissDigest, { timezone: tz });

  // Vsako uro — recenzije (2h po terminu)
  cron.schedule('0 * * * *', sendReviewRequests, { timezone: tz });

  console.log('Scheduler started:');
  console.log('  07:30 — AI natakar: dnevni pregled nerazumljenih (email)');
  console.log('  08:00 — saloni: daily summary, opomniki, reaktivacije');
  console.log('  vsako uro — recenzije (2h po terminu)');
}

module.exports = { startScheduler, sendDailySummary, sendReminders, sendReviewRequests, sendReactivations, sendAiMissDigest };
