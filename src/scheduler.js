const cron = require('node-cron');
const db = require('./supabase');
const wa = require('./whatsapp');

const ADMIN_PHONE = process.env.ADMIN_PHONE;

// ─── Daily Summary ────────────────────────────────────────
async function sendDailySummary() {
  try {
    const salon = await db.getSalon();
    if (!salon || !ADMIN_PHONE) return;

    const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
    const token = process.env.WA_TOKEN;

    const today = new Date().toISOString().split('T')[0];
    const stats = await db.getDailyStats(salon.id, today);

    const d = new Date(today + 'T12:00:00');
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const dateStr = `${dd}.${mm}.${yyyy}`;

    let msg = `📊 *SalonBot — ${dateStr}*\n\n`;
    msg += `📅 Rezervacije danes: *${stats.total}*\n`;
    msg += `✅ Potrjene: *${stats.confirmed}*\n`;
    msg += `⏳ Čakajoče: *${stats.pending}*\n`;
    msg += `❌ Odpovedane: *${stats.cancelled}*\n`;

    if (stats.list.length > 0) {
      msg += `\n🗓️ *Urnik za danes:*\n`;
      for (const b of stats.list) {
        const t = (b.booking_time || '').substring(0, 5);
        const name = b.customer_name || b.customer_phone;
        const status = b.status === 'pending' ? ' ⏳' : '';
        msg += `  • ${t} — ${name}${status}\n`;
      }
    } else {
      msg += `\n_Ni naročil za danes._`;
    }

    if (stats.pending > 0) {
      msg += `\n\n💡 Imate ${stats.pending} čakajočih rezervacij. Napišite "termini" za potrditev.`;
    }

    await wa.send(phoneId, token, wa.textMsg(ADMIN_PHONE, msg));
    console.log('Daily summary sent for', dateStr);
  } catch (e) {
    console.error('Daily summary error:', e.message);
  }
}

// ─── Start cron jobs ──────────────────────────────────────
function startScheduler() {
  // Vsak dan ob 8:00 po slovenskem času
  cron.schedule('0 8 * * *', sendDailySummary, {
    timezone: 'Europe/Ljubljana'
  });
  console.log('Scheduler started — daily summary at 08:00 Europe/Ljubljana');
}

module.exports = { startScheduler, sendDailySummary };
