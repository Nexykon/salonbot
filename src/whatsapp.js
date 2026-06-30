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

function serviceList(to, services, salon = {}) {
  const rows = services.map(s => ({
    id: 'svc_' + s.id,
    title: s.name.substring(0, 24),
    description: `${s.duration_minutes} min · ${s.price} €`.substring(0, 72)
  })).slice(0, 10);
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: salon.greeting_message || 'Pozdravljeni! Izberite storitev:' },
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

// Finalna potrditev z imenom + storitvijo
function finalConfirmButtons(to, date, time, name, serviceName) {
  const d = new Date(date + 'T12:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: `Preverite in potrdite:\n\n👤 ${name}\n💈 ${serviceName || 'Storitev'}\n📅 ${dd}.${mm}.${yyyy} ob ${time}` },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'final_confirm', title: 'Potrdi ✅' } },
          { type: 'reply', reply: { id: 'final_cancel', title: 'Prekliči ❌' } }
        ]
      }
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


function salesTypeList(to) {
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: 'Kakšna je vaša dejavnost?' },
      action: {
        button: 'Izberi vrsto',
        sections: [{
          title: 'Vrsta salona',
          rows: [
            { id: 'stype_frizerstvo', title: 'Frizerstvo ✂️' },
            { id: 'stype_kozmetika', title: 'Kozmetika 💆' },
            { id: 'stype_nohti', title: 'Nohti 💅' },
            { id: 'stype_tattoo', title: 'Tattoo / Piercing 🎨' },
            { id: 'stype_masaze', title: 'Masaže 🧘' },
            { id: 'stype_drugo', title: 'Drugo' }
          ]
        }]
      }
    }
  };
}

function salesConfirmButtons(to, salonName, salonType, email) {
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: `🎉 Odlično! Tukaj je povzetek naročila:\n\n🏪 Salon: ${salonName}\n📋 Vrsta: ${salonType}\n📧 Email: ${email}\n\n💰 *FlowTiq naročnina: 60€/mesec*\n✅ Vključuje: WhatsApp bot + admin panel + email obvestila + neomejene rezervacije\n🛠️ Nastavitev v 24h po naročilu\n\nPotrjujete naročilo?`
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'sales_confirm', title: '✅ Da, naročim!' } },
          { type: 'reply', reply: { id: 'sales_cancel', title: '❌ Ne, hvala' } }
        ]
      }
    }
  };
}


// ══════════════════════════════════════════════════════
// DELIVERY BOT FUNCTIONS (booking_mode = 'delivery')
// ══════════════════════════════════════════════════════

function deliveryMenuList(to, services, salon, cartSummary) {
  // Grupiranje po kategorijah — vsaka je svoja sekcija
  const categoryOrder = ['Pice', 'Mesne jedi', 'Vegetarijanske jedi', 'Solate', 'Dodatki', 'Sladice', 'Pijača', 'Ostalo'];
  const grouped = {};
  for (const s of services) {
    const cat = s.category || 'Ostalo';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(s);
  }
  // Uredi kategorije po predpisanem vrstnem redu
  const orderedCats = [
    ...categoryOrder.filter(c => grouped[c]),
    ...Object.keys(grouped).filter(c => !categoryOrder.includes(c))
  ];
  const itemSections = orderedCats.map(cat => ({
    title: cat,
    rows: grouped[cat].slice(0, 10).map(s => ({
      id: 'menu_' + s.id,
      title: (s.name).substring(0, 24),
      description: ((s.description ? s.description + ' · ' : '') + (s.price ? s.price + ' €' : '')).substring(0, 72)
    }))
  }));
  const sections = itemSections;
  const defaultGreeting = (salon && salon.greeting_message) ? salon.greeting_message : '👇 Izberite artikel iz menija:';
  const bodyText = cartSummary
    ? '🛒 *V košarici:* ' + cartSummary + '\n\nIzberite še artikel:'
    : defaultGreeting;
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: { button: 'Odpri meni', sections }
    }
  };
}

function deliveryCartButtons(to, cartText, total) {
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: '🛒 *Vaše naročilo:*\n\n' + cartText + '\n\n💰 Skupaj: ' + total + ' €\n\nDodajte še kaj ali zaključite?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'delivery_add_more', title: '➕ Dodaj še' } },
          { type: 'reply', reply: { id: 'delivery_checkout', title: '✅ Zaključi' } }
        ]
      }
    }
  };
}

function deliveryConfirmButtons(to, cartText, address, total) {
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: '📋 *Pregled naročila:*\n\n' + cartText + '\n\n📍 Naslov: ' + address + '\n💰 Skupaj: ' + total + ' €\n\nPotrjujete naročilo?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'delivery_confirm', title: '✅ Potrdi' } },
          { type: 'reply', reply: { id: 'delivery_cancel', title: '❌ Prekliči' } }
        ]
      }
    }
  };
}

function deliveryAdminNotif(to, customerPhone, cartText, address, total, ref6) {
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: '🍕 *NOVO NAROČILO #' + ref6 + '*\n\n' + cartText + '\n\n📍 Naslov: ' + address + '\n💰 Skupaj: ' + total + ' €\n📞 Stranka: +' + customerPhone + '\n\nSprejemite in vnesite čas dostave.'
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'delivery_accept_' + ref6, title: '✅ Sprejmi' } },
          { type: 'reply', reply: { id: 'delivery_reject_' + ref6, title: '❌ Zavrni' } }
        ]
      }
    }
  };
}


function posAdminNotif(to, customerPhone, cartText, comment, total, ref6) {
  const commentLine = comment ? '\n📝 ' + comment : '';
  return {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: '🍽️ *NOVO POS NAROČILO #' + ref6 + '*\n\n' +
              cartText + commentLine +
              '\n\n💰 Skupaj: ' + total + ' €' +
              '\n📞 Stranka: +' + customerPhone +
              '\n\nSprejmite in vnesite čas (v minutah).'
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'pos_accept_' + ref6, title: '✅ Sprejmi' } },
          { type: 'reply', reply: { id: 'pos_reject_' + ref6, title: '❌ Zavrni' } }
        ]
      }
    }
  };
}

module.exports = { send, textMsg, serviceList, dateList, timeList, confirmButtons, finalConfirmButtons, adminBookingNotif, adminBookingNotifSession, adminPendingButtons, customerConfirmTemplate, salesTypeList, salesConfirmButtons, deliveryMenuList, deliveryCartButtons, deliveryConfirmButtons, deliveryAdminNotif, posAdminNotif };
