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

function dateList(to, freeDates) {
  const days = ['ned', 'pon', 'tor', 'sre', 'čet', 'pet', 'sob'];
  if (!freeDates.length) return textMsg(to, 'Ni prostih terminov v naslednjih 14 dneh. Za rezervacijo nas pokličite.');
  const rows = freeDates.slice(0, 10).map(({ date, count }) => {
    const d = new Date(date + 'T12:00:00');
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return {
      id: 'date_' + date,
      title: `${dd}.${mm}. (${days[d.getDay()]})`,
      description: `${count} prostih terminov`
    };
  });
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: 'Izberite datum ali napišite kdaj bi radi prišli (npr. "jutri ob 14h"):' },
      action: { button: 'Izberi datum', sections: [{ title: 'Razpoložljivi datumi', rows }] }
    }
  };
}

function timeList(to, freeTimes, date) {
  if (!freeTimes.length) return textMsg(to, 'Na ta dan ni več prostih terminov. Izberite drug datum.');
  const rows = freeTimes.slice(0, 10).map(time => ({
    id: 'time_' + date + '_' + time.replace(':', 'h'),
    title: time
  }));
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: 'Izberite uro iz seznama ali napišite svojo (npr. "14:35"):' },
      action: { button: 'Izberi uro', sections: [{ title: 'Prosti termini', rows }] }
    }
  };
}

function confirmButtons(to, date, time) {
  const d = new Date(date + 'T12:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: `Potrdite rezervacijo:\n📅 ${dd}.${mm}.${yyyy} ob ${time}` },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'confirm_yes', title: 'Potrdi ✅' } },
          { type: 'reply', reply: { id: 'confirm_no', title: 'Prekliči ❌' } }
        ]
      }
    }
  };
}

// Template sporočilo — deluje 24/7, ne glede na sejo
// Zahteva odobren Meta template "salon_nova_rezervacija"
function adminBookingNotif(to, customerName, phone, date, time, ref6) {
  return {
    messaging_product: 'whatsapp', to, type: 'template',
    template: {
      name: 'salon_nova_rezervacija',
      language: { code: 'sl' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: customerName },
            { type: 'text', text: phone },
            { type: 'text', text: `${date} ob ${time}` },
            { type: 'text', text: ref6 }
          ]
        },
        {
          type: 'button', sub_type: 'quick_reply', index: '0',
          parameters: [{ type: 'payload', payload: 'admin_confirm_' + ref6 }]
        },
        {
          type: 'button', sub_type: 'quick_reply', index: '1',
          parameters: [{ type: 'payload', payload: 'admin_cancel_' + ref6 }]
        }
      ]
    }
  };
}

// Fallback: interactive gumbi (samo znotraj 24h seje)
function adminBookingNotifSession(to, customerName, phone, date, time, ref6) {
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: `📩 *Nova rezervacija*\n\n👤 ${customerName}\n📞 +${phone}\n📅 ${date} ob ${time}\n🔑 Ref: *${ref6}*`
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'admin_confirm_' + ref6, title: 'Potrdi' } },
          { type: 'reply', reply: { id: 'admin_cancel_' + ref6, title: 'Zavrni' } }
        ]
      }
    }
  };
}

function adminPendingButtons(to, booking) {
  const ref6 = (booking.id || '').slice(-6);
  const d = new Date((booking.booking_date || '').substring(0, 10) + 'T12:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const time = (booking.booking_time || '').substring(0, 5);
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: `📩 *Čakajoča rezervacija*\n\n👤 ${booking.customer_name || '?'}\n📞 +${booking.customer_phone}\n📅 ${dd}.${mm}.${yyyy} ob ${time}\n🔑 Ref: *${ref6}*`
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'admin_confirm_' + ref6, title: 'Potrdi ✅' } },
          { type: 'reply', reply: { id: 'admin_cancel_' + ref6, title: 'Zavrni ❌' } }
        ]
      }
    }
  };
}

// Template za stranko — potrjena rezervacija (24/7, ne glede na sejo)
// Zahteva odobren Meta template "salon_rezervacija_potrjena" (en_US)
function customerConfirmTemplate(to, date, time, salonName) {
  return {
    messaging_product: 'whatsapp', to, type: 'template',
    template: {
      name: 'salon_rezervacija_potrjena',
      language: { code: 'sl' },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: date },
          { type: 'text', text: time },
          { type: 'text', text: salonName || 'Salon' }
        ]
      }]
    }
  };
}

module.exports = { send, textMsg, serviceList, dateList, timeList, confirmButtons, adminBookingNotif, adminBookingNotifSession, adminPendingButtons, customerConfirmTemplate };
