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
    const waErr = e.response?.data?.error;
    const detail = waErr
      ? `WA #${waErr.code}${waErr.error_subcode ? '/' + waErr.error_subcode : ''}: ${waErr.message}${waErr.error_data?.details ? ' — ' + waErr.error_data.details : ''} | tip:${payload?.type || '?'} phoneId:${phoneId}`
      : e.message;
    console.error('WA send error:', detail, '| payload:', JSON.stringify(payload).slice(0, 500));
    const err = new Error(detail);
    err.response = e.response;
    err.waCode = waErr?.code;
    err.waPayload = JSON.stringify(payload).slice(0, 600);
    throw err;
  }
}

function textMsg(to, body) {
  // WhatsApp zavrne prazno besedilo (#100). Varovalka: nikoli ne pošlji praznega.
  const b = (body == null ? '' : String(body)).trim() || 'Trenutno vam ne moremo odgovoriti. Prosimo, poskusite čez trenutek.';
  return { messaging_product: 'whatsapp', to, type: 'text', text: { body: b } };
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
  const ref6 = (booking.id || '').slice(-6).toUpperCase();
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
        text: `🎉 Odlično! Tukaj je povzetek naročila:\n\n🏪 Salon: ${salonName}\n📋 Vrsta: ${salonType}\n📧 Email: ${email}\n\n💰 *FlowTiq naročnina: od 49,99 €/mesec (prvi mesec brezplačno)*\n✅ Vključuje: WhatsApp bot + admin panel + email obvestila + neomejene rezervacije\n🛠️ Nastavitev v 24h po naročilu\n\nPotrjujete naročilo?`
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

const MENU_CAT_ORDER = ['Pice', 'Mesne jedi', 'Vegetarijanske jedi', 'Solate', 'Dodatki', 'Sladice', 'Pijača', 'Ostalo'];
function groupByCategory(services) {
  const grouped = {};
  for (const s of (services || [])) { const cat = s.category || 'Ostalo'; (grouped[cat] = grouped[cat] || []).push(s); }
  const orderedCats = [
    ...MENU_CAT_ORDER.filter(c => grouped[c]),
    ...Object.keys(grouped).filter(c => !MENU_CAT_ORDER.includes(c))
  ];
  return { grouped, orderedCats };
}

// Dvostopenjski meni z ostranjevanjem. WhatsApp seznam dovoli NAJVEČ 10 vrstic.
// - brez izbrane kategorije + velik meni -> KATEGORIJE (ostranjene: "▶️ Več kategorij" / "📋 Cel meni")
// - izbrana kategorija -> njeni artikli (ostranjeni: "▶️ Prikaži več")
// Tako podpira poljubno velike menije (100+ jedi).
const CATS_PER_PAGE = 9;
const ITEMS_PER_PAGE = 9;
function deliveryMenuList(to, services, salon, cartSummary, categoryFilter, page) {
  page = Math.max(0, parseInt(page) || 0);
  let items = services || [];
  if (categoryFilter && categoryFilter !== 'ALL') items = items.filter(s => (s.category || 'Ostalo') === categoryFilter);
  const { grouped, orderedCats } = groupByCategory(items);
  const defaultGreeting = (salon && salon.greeting_message) ? salon.greeting_message : '👇 Izberite iz menija:';
  const cartLine = cartSummary ? '🛒 *V košarici:* ' + cartSummary + '\n\n' : '';
  const nItems = n => n + ' ' + (n === 1 ? 'artikel' : (n === 2 ? 'artikla' : (n < 5 ? 'artikli' : 'artiklov')));
  const listMsg = (bodyText, button, sections) => ({
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: { type: 'list', body: { text: (bodyText || '👇').substring(0, 1024) }, action: { button: (button || 'Meni').substring(0, 20), sections } }
  });

  // ── VELIK meni brez izbrane kategorije -> KATEGORIJE (ostranjene) ──
  if (!categoryFilter && items.length > 9 && orderedCats.length > 1) {
    const start = page * CATS_PER_PAGE;
    const pageCats = orderedCats.slice(start, start + CATS_PER_PAGE);
    const moreCats = orderedCats.length > start + pageCats.length;
    const rows = pageCats.map(cat => ({ id: 'cat_' + cat, title: cat.substring(0, 24), description: nItems(grouped[cat].length) }));
    if (moreCats) rows.push({ id: 'catspage_' + (page + 1), title: '▶️ Več kategorij', description: 'Naslednja stran' });
    else rows.push({ id: 'cat_ALL', title: '📋 Cel meni', description: 'Prikaži vse kot besedilo' });
    return listMsg(cartLine + (cartSummary ? 'Izberite kategorijo:' : defaultGreeting), 'Kategorije', [{ title: 'Kategorije', rows }]);
  }

  // ── ARTIKLI (izbrana kategorija ali majhen meni) — ostranjeno, vedno <=10 vrstic ──
  const cat = (categoryFilter && categoryFilter !== 'ALL') ? categoryFilter : null;
  const flat = [];
  for (const c of orderedCats) for (const s of grouped[c]) flat.push({ s, c });
  let pageItems, hasMore;
  if (flat.length <= 10) { pageItems = flat; hasMore = false; }
  else {
    const start = page * ITEMS_PER_PAGE;
    pageItems = flat.slice(start, start + ITEMS_PER_PAGE);
    hasMore = flat.length > start + pageItems.length;
  }
  // sekcije po kategorijah (znotraj strani), ohrani vrstni red
  const sections = [];
  for (const { s, c } of pageItems) {
    let sec = sections.find(x => x._c === c);
    if (!sec) { sec = { _c: c, title: c.substring(0, 24), rows: [] }; sections.push(sec); }
    sec.rows.push({
      id: 'menu_' + s.id,
      title: (s.name).substring(0, 24),
      description: ((s.description ? s.description + ' · ' : '') + (s.price ? s.price + ' €' : '')).substring(0, 72)
    });
  }
  if (hasMore && sections.length) {
    const nextId = cat ? ('catpage_' + (page + 1) + '_' + cat) : ('menupage_' + (page + 1));
    sections[sections.length - 1].rows.push({ id: nextId, title: '▶️ Prikaži več', description: 'Naslednja stran' });
  }
  sections.forEach(sec => delete sec._c);
  const bodyText = cartSummary ? cartLine + 'Izberite še artikel:' : (cat ? cat + ':' : defaultGreeting);
  return listMsg(bodyText, cat ? cat : 'Odpri meni', sections.length ? sections : [{ title: 'Meni', rows: [] }]);
}

// Cel meni kot besedilo — razbito na več sporočil, če je predolgo (WhatsApp meja ~4096 znakov).
// Vrne POLJE payloadov (pošlji vsakega posebej).
function deliveryMenuText(to, services) {
  const { grouped, orderedCats } = groupByCategory(services);
  const MAX = 3500;
  const parts = [];
  let txt = '*Naš meni*\n';
  for (const cat of orderedCats) {
    let block = '\n*' + cat + '*\n';
    for (const s of grouped[cat]) block += '• ' + s.name + (s.price ? ' — ' + s.price + ' €' : '') + '\n';
    if (txt.length + block.length > MAX) { parts.push(txt); txt = block; }
    else txt += block;
  }
  txt += '\nNapišite, kaj želite (npr. "ena Margherita in dve koli").';
  parts.push(txt);
  return parts.map(body => ({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }));
}

// Dobrodošlica ob prvem stiku (brez emojijev, profesionalno). Vrstice se pokažejo le, če so podatki.
function deliveryWelcome(salon) {
  const stripEmoji = s => String(s || '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ').trim();
  const name = stripEmoji(salon && salon.name) || 'naši restavraciji';
  const info = [];
  if ((salon.allow_delivery !== false) && salon.delivery_area) info.push('Dostava: ' + salon.delivery_area);
  if (salon.allow_pickup && salon.pickup_address) info.push('Osebni prevzem: ' + salon.pickup_address);
  if (salon.working_hours_start && salon.working_hours_end) {
    info.push('Delovni čas: ' + String(salon.working_hours_start).substring(0, 5) + '–' + String(salon.working_hours_end).substring(0, 5));
  }
  let txt = 'Pozdravljeni v *' + name + '*.';
  if (info.length) txt += '\n\n' + info.join('\n');
  txt += '\n\nNaročilo lahko kadar koli prekličete – dovolj je, da napišete *preklic*.';
  txt += '\n\nBi si želeli kaj naročiti?';
  return txt;
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

module.exports = { send, textMsg, serviceList, dateList, timeList, confirmButtons, finalConfirmButtons, adminBookingNotif, adminBookingNotifSession, adminPendingButtons, customerConfirmTemplate, salesTypeList, salesConfirmButtons, deliveryMenuList, deliveryMenuText, deliveryWelcome, deliveryCartButtons, deliveryConfirmButtons, deliveryAdminNotif, posAdminNotif };
