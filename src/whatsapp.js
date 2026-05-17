const axios = require('axios');

function client(phoneId, token) {
  return axios.create({
    baseURL: `https://graph.facebook.com/v19.0/${phoneId}`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
}

async function send(phoneId, token, payload) {
  const wa = client(phoneId, token);
  try {
    const r = await wa.post('/messages', payload);
    return r.data;
  } catch (e) {
    console.error('WA send error:', e.response?.data || e.message);
    throw e;
  }
}

function textMsg(to, body) {
  return { messaging_product: 'whatsapp', to, type: 'text', text: { body } };
}

function serviceList(to, services) {
  const rows = services.map(s => ({
    id: 'svc_' + s.id,
    title: s.name.substring(0, 24),
    description: `${s.duration_minutes} min · ${s.price} €`.substring(0, 72)
  })).slice(0, 10);
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: 'Pozdravljeni! Izberite storitev:' },
      action: { button: 'Izberi storitev', sections: [{ title: 'Storitve', rows }] }
    }
  };
}

function dateList(to, slots) {
  const days = ['ned', 'pon', 'tor', 'sre', 'čet', 'pet', 'sob'];
  const seen = new Set();
  const rows = [];
  for (const s of slots) {
    if (seen.has(s.slot_date)) continue;
    seen.add(s.slot_date);
    const d = new Date(s.slot_date + 'T12:00:00');
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    rows.push({ id: 'date_' + s.slot_date, title: `${dd}.${mm}. (${days[d.getDay()]})` });
    if (rows.length >= 10) break;
  }
  if (!rows.length) return textMsg(to, 'Ni prostih terminov v naslednjih 14 dneh. Kontaktirajte nas.');
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: 'Izberite datum:' },
      action: { button: 'Izberi datum', sections: [{ title: 'Datumi', rows }] }
    }
  };
}

function timeList(to, slots, date) {
  const daySlots = slots.filter(s => s.slot_date === date);
  const rows = daySlots.map(s => ({
    id: 'time_' + s.id + '_' + s.slot_time.substring(0, 5).replace(':', 'h'),
    title: s.slot_time.substring(0, 5)
  })).slice(0, 10);
  if (!rows.length) return textMsg(to, 'Na ta dan ni prostih terminov. Izberite drug datum.');
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: 'Izberite uro:' },
      action: { button: 'Izberi uro', sections: [{ title: 'Termini', rows }] }
    }
  };
}

function confirmButtons(to, date, time) {
  const d = new Date(date + 'T12:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: `Potrdite rezervacijo:\n📅 ${dd}.${mm}. ob ${time}` },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'confirm_yes', title: 'Potrdi ✅' } },
          { type: 'reply', reply: { id: 'confirm_no', title: 'Prekliči ❌' } }
        ]
      }
    }
  };
}

function adminBookingNotif(to, booking, slot, ref6) {
  const body =
    `📩 *Nova rezervacija*\n\n` +
    `📅 ${slot.slot_date} ob ${(slot.slot_time || '').substring(0, 5)}\n` +
    `📞 +${booking.customer_phone}\n` +
    `🔑 Ref: *${ref6}*\n\n` +
    `✅ Potrdi: *#potrdi ${ref6}*\n` +
    `❌ Zavrni: *#zavrni ${ref6}*`;
  return textMsg(to, body);
}

module.exports = { send, textMsg, serviceList, dateList, timeList, confirmButtons, adminBookingNotif };
