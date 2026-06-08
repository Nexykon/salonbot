const db = require('./supabase');
const wa = require('./whatsapp');
const mail = require('./email');
const session = require('./session');
const { askAdminAI, askCustomerAI, transcribeAudio } = require('./ai');
const { getFreeDates, getFreeTimesForDate, isSlotFree, fitsBeforeEnd, toMins } = require('./calendar');

function fmtDate(dateStr) {
  if (!dateStr) return '?';
  const d = new Date(dateStr.substring(0, 10) + 'T12:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function roundTo5Min(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const rounded = Math.round(m / 5) * 5;
  const fM = rounded >= 60 ? 0 : rounded;
  const fH = rounded >= 60 ? h + 1 : h;
  if (fH > 23) return null;
  return String(fH).padStart(2, '0') + ':' + String(fM).padStart(2, '0');
}

async function resolveCustomTime(salon, date, requestedTime, serviceDuration = null) {
  const start = (salon.working_hours_start || '08:00').substring(0, 5);
  const end   = (salon.working_hours_end   || '19:00').substring(0, 5);
  const duration = serviceDuration || salon.booking_interval_minutes || 30;
  const bookedSlots = await db.getBookedTimesForDate(salon.id, date);
  const rounded = roundTo5Min(requestedTime);
  if (!rounded) return null;
  const fromMins = m => String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
  const baseMins = toMins(rounded);
  for (let delta = 0; delta <= 60; delta += 5) {
    for (const d of (delta === 0 ? [0] : [delta, -delta])) {
      const tryMins = baseMins + d;
      if (tryMins < 0) continue;
      const tryTime = fromMins(tryMins);
      if (tryTime >= start && tryTime < end && fitsBeforeEnd(tryTime, duration, end) && isSlotFree(tryTime, duration, bookedSlots)) {
        return tryTime;
      }
    }
  }
  return null;
}

function parseCustomerDateTime(text) {
  const now = new Date();
  const lower = text.toLowerCase();
  let time = null;
  const tm =
    lower.match(/ob\s+(\d{1,2})[h:.]?(\d{2})?/) ||
    lower.match(/(\d{1,2})[h:](\d{2})/) ||
    lower.match(/\b(\d{1,2})\s*h\b/);
  if (tm) {
    const h = parseInt(tm[1]);
    const m = tm[2] ? parseInt(tm[2]) : 0;
    if (h >= 6 && h <= 22 && m >= 0 && m <= 59) {
      time = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
  }
  let date = null;
  if (lower.includes('danes')) {
    date = now.toISOString().split('T')[0];
  } else if (lower.includes('jutri')) {
    const d = new Date(now); d.setDate(d.getDate() + 1);
    date = d.toISOString().split('T')[0];
  } else {
    const dayMap = [
      ['ponedeljek', 1], ['torek', 2], ['cetrtek', 4],
      ['sobota', 6], ['nedelja', 0], ['sreda', 3], ['petek', 5],
      ['pon', 1], ['tor', 2], ['sre', 3], ['cet', 4], ['pet', 5], ['sob', 6], ['ned', 0]
    ];
    for (const [key, dayNum] of dayMap) {
      if (lower.includes(key)) {
        const d = new Date(now);
        let ahead = dayNum - d.getDay();
        if (ahead <= 0) ahead += 7;
        d.setDate(d.getDate() + ahead);
        date = d.toISOString().split('T')[0];
        break;
      }
    }
    if (!date) {
      const dm = text.match(/\b(\d{1,2})\.(\d{1,2})\b/);
      if (dm) {
        const day = parseInt(dm[1]), month = parseInt(dm[2]);
        const d = new Date(now.getFullYear(), month - 1, day);
        if (d >= now) date = d.toISOString().split('T')[0];
      }
    }
  }
  return { date, time };
}

async function handleMessage(msgObj, salon) {
  const from = msgObj.from;
  const msgType = msgObj.type;
  const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
  const token = process.env.WA_TOKEN;

  if (msgType === 'audio') {
    try {
      const mediaId = msgObj.audio?.id;
      if (!mediaId) return;
      const transcription = await transcribeAudio(mediaId, token);
      if (transcription) {
        msgObj.type = 'text';
        msgObj.text = { body: transcription };
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, 'Ni uspelo razumeti glasovnega sporocila. Napisite besedilo.'));
        return;
      }
    } catch (e) {
      console.error('Whisper error:', e.message);
      await db.logError(salon.id, 'whisper', e.message, null, from);
      await wa.send(phoneId, token, wa.textMsg(from, 'Napaka pri obdelavi glasovnega sporocila. Napisite besedilo.'));
      return;
    }
  }

  let iId = '';
  if (msgType === 'interactive') {
    const ir = msgObj.interactive;
    iId = ir.type === 'button_reply' ? ir.button_reply.id : (ir.list_reply?.id || '');
  }
  if (msgType === 'button' && msgObj.button?.payload) {
    iId = msgObj.button.payload;
  }

  const salonAdminPhone = String(salon.admin_phone || '').replace(/[^\d]/g, '');
  const isAdmin = salonAdminPhone && from === salonAdminPhone;
  const msgText = msgObj.text?.body?.trim() || '';

  // ── ADMIN FLOW ──────────────────────────────────────────────
  if (isAdmin) {
    if (iId.startsWith('admin_confirm_')) {
      const ref = iId.replace('admin_confirm_', '');
      const booking = await db.getBookingForSalon(salon.id, ref);
      if (booking) {
        await db.updateBookingStatus(booking.id, 'confirmed');
        await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija *${ref}* potrjena za ${booking.customer_name || booking.customer_phone}.`));
        const custDate = fmtDate(booking.booking_date);
        const custTime = (booking.booking_time || '').substring(0, 5);
        if (booking.customer_phone && booking.customer_phone !== 'manual') {
          try {
            await wa.send(phoneId, token, wa.customerConfirmTemplate(booking.customer_phone, custDate, custTime, salon.name));
          } catch (e) {
            try {
              await wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
                `Vasa rezervacija je potrjena!\n\n${custDate} ob ${custTime}\n\nHvala, vidimo se!`
              ));
            } catch (e2) {
              const errMsg = typeof e2.response?.data === 'object' ? JSON.stringify(e2.response.data) : (e2.response?.data || e2.message);
              console.error('Notify customer err:', errMsg);
              await db.logError(salon.id, 'customer_notify', errMsg, 'Potrditev stranke ni uspela', booking.customer_phone);
              await wa.send(phoneId, token, wa.textMsg(from, `Stranka (${booking.customer_phone}) NI obvescena.\nNapaka: ${errMsg}`));
            }
          }
        }
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija ${ref} ni najdena.`));
      }
      return;
    }

    if (iId.startsWith('admin_cancel_')) {
      const ref = iId.replace('admin_cancel_', '');
      const booking = await db.getBookingForSalon(salon.id, ref);
      if (booking) {
        await db.updateBookingStatus(booking.id, 'cancelled');
        await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija *${ref}* zavrnjena.`));
        if (booking.customer_phone && booking.customer_phone !== 'manual') {
          try {
            await wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
              `Zal vasa rezervacija za ${fmtDate(booking.booking_date)} ob ${(booking.booking_time || '').substring(0, 5)} ni bila potrjena.\n\nZa novo rezervacijo nam pisite.`
            ));
          } catch (e) {
            console.error('Notify customer cancel err:', e.message);
          }
        }
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija ${ref} ni najdena.`));
      }
      return;
    }


    // ── Delivery: accept button → ask delivery time ──
    if (iId.startsWith('delivery_accept_')) {
      const ref = iId.replace('delivery_accept_', '');
      const booking = await db.getBookingForSalon(salon.id, ref);
      if (booking) {
        session.set(from, { awaitingDeliveryTime: ref, deliveryCustomerPhone: booking.customer_phone });
        await wa.send(phoneId, token, wa.textMsg(from, `Naročilo *#${ref}* sprejeto! ✅\n\nKoliko minut do dostave? (samo število, npr. *30*)`));
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Naročilo ${ref} ni najdeno.`));
      }
      return;
    }

    // ── Delivery: reject button ──
    if (iId.startsWith('delivery_reject_')) {
      const ref = iId.replace('delivery_reject_', '');
      const booking = await db.getBookingForSalon(salon.id, ref);
      if (booking) {
        await db.updateBookingStatus(booking.id, 'cancelled');
        await wa.send(phoneId, token, wa.textMsg(from, `Naročilo *#${ref}* zavrnjeno.`));
        if (booking.customer_phone) {
          wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
            `Žal vaše naročilo ni bilo sprejeto. Pokličite nas za več informacij. 😔`
          )).catch(() => {});
        }
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Naročilo ${ref} ni najdeno.`));
      }
      return;
    }

    // ── Delivery: admin typed minutes after accepting ──
    const adminSess = session.get(from);
    if (adminSess.awaitingDeliveryTime && msgText) {
      const minutes = parseInt(msgText.trim());
      const ref = adminSess.awaitingDeliveryTime;
      const custPhone = adminSess.deliveryCustomerPhone;
      session.clear(from);
      if (!isNaN(minutes) && minutes > 0 && custPhone) {
        await db.getBookingForSalon(salon.id, ref).then(b => b && db.updateBookingStatus(b.id, 'confirmed')).catch(() => {});
        await wa.send(phoneId, token, wa.textMsg(from, `Stranka obveščena: dostava v ${minutes} min. ✅`));
        wa.send(phoneId, token, wa.textMsg(custPhone,
          `🍕 Naročilo potrjeno!\n\n⏱️ Dostava v pribl. *${minutes} minutah*\n\nHvala! 😊`
        )).catch(e => wa.send(phoneId, token, wa.textMsg(from, `Stranke ni uspelo obvestiti: ${e.message}`)));
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, 'Napaka: vnesite samo število minut (npr. 30).'));
      }
      return;
    }

    const lowerText = msgText.toLowerCase();
    if (lowerText.startsWith('#potrdi ') || lowerText.startsWith('#zavrni ')) {
      const parts = msgText.trim().split(/\s+/);
      const ref = parts[1];
      const isConfirm = lowerText.startsWith('#potrdi');
      if (ref) {
        const booking = await db.getBookingForSalon(salon.id, ref);
        if (booking) {
          await db.updateBookingStatus(booking.id, isConfirm ? 'confirmed' : 'cancelled');
          await wa.send(phoneId, token, wa.textMsg(from,
            isConfirm
              ? `Rezervacija *${ref}* potrjena za ${booking.customer_name || booking.customer_phone}.`
              : `Rezervacija *${ref}* zavrnjena.`
          ));
          if (booking.customer_phone && booking.customer_phone !== 'manual') {
            try {
              await wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
                isConfirm
                  ? `Vasa rezervacija je potrjena!\n\n${fmtDate(booking.booking_date)} ob ${(booking.booking_time || '').substring(0, 5)}\n\nHvala, vidimo se!`
                  : `Zal vasa rezervacija za ${fmtDate(booking.booking_date)} ob ${(booking.booking_time || '').substring(0, 5)} ni bila potrjena.\n\nZa novo rezervacijo nam pisite.`
              ));
            } catch (e) {
              console.error('Notify customer err:', e.message);
            }
          }
        } else {
          await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija ${ref} ni najdena.`));
        }
      }
      return;
    }

    const lowerMsg = msgText.toLowerCase();
    // #cas REF MIN — legacy text command for delivery time
    if (lowerMsg.startsWith('#cas ')) {
      const parts = msgText.trim().split(/\s+/);
      // Format: #cas REF6 MINUTES  or  #cas MINUTES (uses awaitingDeliveryTime)
      let ref, minutes;
      if (parts.length >= 3) {
        ref = parts[1]; minutes = parseInt(parts[2]);
      } else if (parts.length === 2) {
        minutes = parseInt(parts[1]);
        ref = session.get(from).awaitingDeliveryTime;
      }
      if (ref && !isNaN(minutes) && minutes > 0) {
        const booking = await db.getBookingForSalon(salon.id, ref);
        if (booking) {
          await db.updateBookingStatus(booking.id, 'confirmed');
          session.clear(from);
          await wa.send(phoneId, token, wa.textMsg(from, `Stranka obveščena: dostava v ${minutes} min. ✅`));
          if (booking.customer_phone) {
            wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
              `🍕 Naročilo potrjeno!\n\n⏱️ Dostava v pribl. *${minutes} minutah*\n\nHvala! 😊`
            )).catch(() => {});
          }
        } else {
          await wa.send(phoneId, token, wa.textMsg(from, `Naročilo ${ref} ni najdeno.`));
        }
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, 'Uporaba: *#cas REF6 30* ali *#cas 30* (po sprejemu naročila)'));
      }
      return;
    }

    if (lowerMsg.startsWith('#nauci ')) {
      const content = msgText.slice(7).trim();
      if (content) { await db.addKnowledge(salon.id, content); }
      await wa.send(phoneId, token, wa.textMsg(from, `Nauceno: "${content}"`));
      return;
    }
    if (lowerMsg.startsWith('#pozabi ')) {
      const keyword = msgText.slice(8).trim();
      if (keyword) { await db.deleteKnowledge(salon.id, keyword); }
      await wa.send(phoneId, token, wa.textMsg(from, `Izbrisano znanje: "${keyword}"`));
      return;
    }
    if (lowerMsg.startsWith('#znanje')) {
      const items = await db.getKnowledge(salon.id);
      if (!items.length) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Ni shranjenega znanja.\n\nDodaj z: *#nauci <besedilo>*'));
      } else {
        const list = items.map((k, i) => `${i + 1}. ${k.content}`).join('\n');
        await wa.send(phoneId, token, wa.textMsg(from, `*Znanje (${items.length}):*\n\n${list}\n\nIzbrisi z: *#pozabi <beseda>*`));
      }
      return;
    }

    if (msgText) {
      const today = new Date().toISOString().split('T')[0];
      if (/po[cc]isti|odstrani\s+star|zavrni\s+star/i.test(msgText)) {
        const pending = await db.getPendingBookings(salon.id);
        const past = pending.filter(b => (b.booking_date || '').substring(0, 10) < today);
        for (const b of past) await db.updateBookingStatus(b.id, 'cancelled');
        await wa.send(phoneId, token, wa.textMsg(from, past.length ? `Pocisceno: ${past.length} pretecenih rezervacij.` : 'Ni starih rezervacij.'));
        return;
      }
      if (/termini|pending|rezervaci|cakaj/i.test(msgText)) {
        const pending = await db.getPendingBookings(salon.id);
        const future = pending.filter(b => (b.booking_date || '').substring(0, 10) >= today);
        if (future.length > 0) {
          await wa.send(phoneId, token, wa.textMsg(from, `*${future.length} cakajocih rezervacij:*`));
          for (const b of future) await wa.send(phoneId, token, wa.adminPendingButtons(from, b));
        } else {
          await wa.send(phoneId, token, wa.textMsg(from, 'Ni cakajocih rezervacij.'));
        }
        return;
      }
      try {
        const reply = await askAdminAI(msgText, salon.id);
        await wa.send(phoneId, token, wa.textMsg(from, reply));
      } catch (e) {
        console.error('AI admin error:', e.message);
        await wa.send(phoneId, token, wa.textMsg(from, `Napaka AI: ${e.message}`));
      }
      return;
    }
  }

  // ── CUSTOMER FLOW ────────────────────────────────────────────

  // ══════════════════════════════════════════════════════
  // SALES BOT FLOW (booking_mode = 'sales')
  // ══════════════════════════════════════════════════════
  if (salon.booking_mode === 'sales') {
    const sess = session.get(from);

    // Step 201: got salon name → ask business type
    if (sess.step === 201 && msgText) {
      session.set(from, { ...sess, step: 202, salonName: msgText.trim() });
      await wa.send(phoneId, token, wa.salesTypeList(from));
      return;
    }

    // Step 202: got business type (button) → ask email
    if (sess.step === 202) {
      const typeMap = {
        stype_frizerstvo: 'Frizerstvo ✂️', stype_kozmetika: 'Kozmetika 💆',
        stype_nohti: 'Nohti 💅', stype_tattoo: 'Tattoo / Piercing 🎨',
        stype_masaze: 'Masaže 🧘', stype_drugo: 'Drugo'
      };
      const sType = typeMap[iId] || msgText.trim() || 'Ni navedeno';
      session.set(from, { ...sess, step: 203, salonType: sType });
      await wa.send(phoneId, token, wa.textMsg(from, '📧 Na kateri email vam pošljemo dostop in račun?'));
      return;
    }

    // Step 203: got email → show pricing + confirm
    if (sess.step === 203 && msgText) {
      const email = msgText.trim();
      session.set(from, { ...sess, step: 204, email });
      await wa.send(phoneId, token, wa.salesConfirmButtons(from, sess.salonName, sess.salonType, email));
      return;
    }

    // Step 204: confirmed → save lead, notify admin
    if (iId === 'sales_confirm') {
      const s = session.get(from);
      const today = new Date().toISOString().slice(0, 10);
      const leadData = {
        customer_phone: from,
        customer_name: s.salonName || 'Neznano',
        salon_id: salon.id,
        booking_date: today,
        booking_time: '00:00:00',
        status: 'confirmed',
        notes: `NAROCILO FlowTiq | Vrsta: ${s.salonType || '-'} | Email: ${s.email || '-'}`,
        form_answers: JSON.stringify({ 'Salon': s.salonName, 'Vrsta': s.salonType, 'Email': s.email })
      };
      await db.createBooking(leadData).catch(e => console.error('[sales] save lead failed:', e.message));
      session.clear(from);

      // Notify admin via WA
      if (salonAdminPhone) {
        const msg = `🎉 *NOVO NAROČILO FlowTiq!*\n\n🏪 Salon: ${s.salonName}\n📋 Vrsta: ${s.salonType}\n📞 Tel: +${from}\n📧 Email: ${s.email}\n\nNastavite jim salon in pošljite dostop!`;
        wa.send(phoneId, token, wa.textMsg(salonAdminPhone, msg)).catch(() => {});
      }
      // Notify via email
      if (salon.owner_email) {
        mail.sendBookingNotification && mail.sendBookingNotification(
          salon, s.salonName, from, today, '—', 'FlowTiq naročnina'
        ).catch(e => console.error('[sales] email failed:', e.message));
      }

      await wa.send(phoneId, token, wa.textMsg(from,
        `✅ *Naročilo sprejeto!*\n\nHvala, ${s.salonName}! 🎉\n\nV 24 urah vas kontaktiramo na ${s.email} in nastavimo vaš FlowTiq bot.\n\nDo takrat! 🌸 — Ekipa FlowTiq`
      ));
      return;
    }

    // Step 204: cancelled
    if (iId === 'sales_cancel') {
      session.clear(from);
      await wa.send(phoneId, token, wa.textMsg(from, 'Ni problema! Če se premislite, smo tukaj. 😊'));
      return;
    }

    // Default / new session: welcome + ask salon name
    session.set(from, { step: 201 });
    await wa.send(phoneId, token, wa.textMsg(from,
      `👋 Pozdravljeni! Sem *FlowTiq* — WhatsApp rezervacijski bot za salone.\n\nVaše stranke rezervirajo termine 24/7 brez klicev in SMS-ov. Vi pa vse upravljate prek preprostega admin panela.\n\n🚀 Začnemo z nastavitvijo? Kako se imenuje vaš salon?`
    ));
    return;
  }
  // ══════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════
  // DELIVERY BOT FLOW (booking_mode = 'delivery')
  // ══════════════════════════════════════════════════════
  if (salon.booking_mode === 'delivery') {
    const services = await db.getServices(salon.id);
    const sess = session.get(from);

    function fmtCart(cart) {
      return cart.map(item => `• ${item.name} — ${item.price} €`).join('\n');
    }
    function cartTotal(cart) {
      return cart.reduce((sum, item) => sum + parseFloat(item.price || 0), 0).toFixed(2);
    }
    function cartSummaryShort(cart) {
      if (!cart || !cart.length) return null;
      return `${cart.length} artikel | ${cartTotal(cart)} €`;
    }

    // ── Artikel izbran → dodaj v košarico + cart gumbi (Dodaj še / Zaključi)
    if (iId.startsWith('menu_')) {
      const svcId = iId.replace('menu_', '');
      const svc = services.find(s => s.id === svcId);
      if (!svc) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Artikel ni najden. Izberite iz menija:'));
        await wa.send(phoneId, token, wa.deliveryMenuList(from, services, salon, null));
        return;
      }
      const cart = (sess && sess.cart) || [];
      cart.push({ id: svc.id, name: svc.name, price: svc.price || 0 });
      session.set(from, { ...sess, step: 301, cart });
      await wa.send(phoneId, token, wa.deliveryCartButtons(
        from,
        fmtCart(cart),
        cartTotal(cart)
      ));
      return;
    }

    // ── Dodaj še → pokaži meni spet
    if (iId === 'delivery_add_more') {
      await wa.send(phoneId, token, wa.deliveryMenuList(from, services, salon, cartSummaryShort(sess && sess.cart)));
      return;
    }

    // ── Zaključi → vpraša za opombo
    if (iId === 'delivery_checkout') {
      if (!sess || !sess.cart || !sess.cart.length) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Košarica je prazna. Izberite artikel:'));
        await wa.send(phoneId, token, wa.deliveryMenuList(from, services, salon, null));
        return;
      }
      session.set(from, { ...sess, step: 302 });
      await wa.send(phoneId, token, wa.textMsg(from,
        `🛒 *Vaše naročilo:*\n${fmtCart(sess.cart)}\n\n💰 Skupaj: ${cartTotal(sess.cart)} €\n\n📝 Ali imate kakšno posebno željo?\n_(npr. brez gob, bolj pikantno, alergija na orehe...)_\n\nNapišite opombo ali pošljite *NE* za nadaljevanje brez opombe.`
      ));
      return;
    }

    // ── Step 302: opomba → vpraša ime
    if (sess && sess.step === 302 && msgText) {
      const opomba = msgText.trim().toUpperCase() === 'NE' ? '' : msgText.trim();
      session.set(from, { ...sess, step: 303, opomba });
      await wa.send(phoneId, token, wa.textMsg(from,
        '👤 Prosim vnesite vaše *ime in priimek*:'
      ));
      return;
    }

    // ── Step 303: ime → vpraša naslov
    if (sess && sess.step === 303 && msgText) {
      const customerName = msgText.trim();
      session.set(from, { ...sess, step: 304, customerName });
      await wa.send(phoneId, token, wa.textMsg(from,
        '📍 Na kateri naslov dostavimo?\n_(ulica, hišna številka, kraj)_'
      ));
      return;
    }

    // ── Step 304: naslov → pokaži potrditev
    if (sess && sess.step === 304 && msgText) {
      const address = msgText.trim();
      const cart = sess.cart || [];
      const opombaTxt = sess.opomba ? `\n📝 Opomba: ${sess.opomba}` : '';
      session.set(from, { ...sess, step: 305, deliveryAddress: address });
      await wa.send(phoneId, token, wa.deliveryConfirmButtons(
        from,
        fmtCart(cart) + opombaTxt,
        address,
        cartTotal(cart)
      ));
      return;
    }

    // ── Potrdi naročilo
    if (iId === 'delivery_confirm') {
      const s = session.get(from);
      const cart = s.cart || [];
      if (!cart.length || !s.deliveryAddress) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Začnite znova.'));
        session.clear(from);
        return;
      }
      const total = cartTotal(cart);
      const today = new Date().toISOString().slice(0, 10);
      const custName = s.customerName || from;
      const opomba  = s.opomba || '';
      const bookingData = {
        customer_phone: from,
        customer_name:  custName,
        salon_id:       salon.id,
        booking_date:   today,
        booking_time:   new Date().toTimeString().slice(0, 8),
        status:         'pending',
        notes:          `RAZVOZ | Naslov: ${s.deliveryAddress} | Skupaj: ${total} €${opomba ? ' | Opomba: ' + opomba : ''}`,
        form_answers:   JSON.stringify({
          ime:     custName,
          naslov:  s.deliveryAddress,
          narocilo: fmtCart(cart),
          opomba:  opomba,
          skupaj:  total + ' €'
        })
      };
      const booking = await db.createBooking(bookingData);
      const ref6 = (booking.id || '').slice(-6);
      session.clear(from);
      await wa.send(phoneId, token, wa.textMsg(from,
        `✅ Naročilo oddano, ${custName}!\n\n🔑 Ref: *#${ref6}*\n\nPicerija bo naročilo kmalu potrdila in vas obvestila o času dostave. 🍕`
      ));
      return;
    }

    // ── Prekliči
    if (iId === 'delivery_cancel') {
      session.clear(from);
      await wa.send(phoneId, token, wa.textMsg(from, 'Naročilo preklicano. Dobrodošli nazaj! 🍕'));
      return;
    }

    // ── Default: pozdrav + meni
    session.set(from, { step: 300, cart: [] });
    await wa.send(phoneId, token, wa.textMsg(from,
      salon.greeting_message || '👋 Dobrodošli! Izberite iz menija in naročite dostavo. 🍕'
    ));
    await wa.send(phoneId, token, wa.deliveryMenuList(from, services, salon, null));
    return;
  }



  const sess = session.get(from);
  const services = await db.getServices(salon.id);

  const VALID_MODES = ['exact_time', 'date_only', 'inquiry', 'month_only'];
  const bookingMode = VALID_MODES.includes(salon.booking_mode) ? salon.booking_mode : 'exact_time';
  const datetimePosition = salon.datetime_position === 'last' ? 'last' : 'first';
  const rawFF = salon.form_fields;
  const formFields = Array.isArray(rawFF)
    ? rawFF
    : (typeof rawFF === 'string' && rawFF.trim()
        ? (() => { try { const p = JSON.parse(rawFF); return Array.isArray(p) ? p : []; } catch (err) { return []; } })()
        : []);

  // Helper: after time confirmed (datetime_position = 'first')
  const goAfterTime = async (date, time, sessData) => {
    if (formFields.length > 0) {
      const first = formFields[0];
      session.set(from, { ...sessData, step: 10, selectedDate: date, selectedTime: time, fieldIndex: 0, formAnswers: {} });
      const opt = first.required ? '' : ' (opcijsko - 0 za preskok)';
      await wa.send(phoneId, token, wa.textMsg(from, `${first.label}:${opt}`));
    } else {
      session.set(from, { ...sessData, step: 4, selectedDate: date, selectedTime: time });
      await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
    }
  };

  // Helper: start form fields first (datetime_position = 'last')
  const goFormFirst = async (sessData) => {
    const first = formFields[0];
    session.set(from, { ...sessData, step: 30, fieldIndex: 0, formAnswers: {} });
    const opt = first.required ? '' : ' (opcijsko - 0 za preskok)';
    await wa.send(phoneId, token, wa.textMsg(from, `${first.label}:${opt}`));
  };

  // Helper: after form fields collected in 'last' mode → ask for date
  const goDateAfterForm = async (sessData) => {
    const freeDates = await getFreeDates(salon, 30, sessData.serviceDuration);
    session.set(from, { ...sessData, step: 31 });
    await wa.send(phoneId, token, wa.dateList(from, freeDates));
  };

  // Helper: submit inquiry (step 10 or step 20)
  const submitInquiry = async (customerName, formAnswers, serviceId, preferredDate, preferredTime) => {
    const svc = services.find(sv => sv.id === serviceId);
    const today = new Date().toISOString().split('T')[0];
    const bDate = preferredDate || today;
    const rawTime = preferredTime || '00:00:00';
    const bTime = /^\d{1,2}:\d{2}$/.test(rawTime) ? rawTime + ':00' : rawTime;
    const bData = {
      customer_phone: from,
      customer_name: customerName,
      salon_id: salon.id,
      service_id: serviceId || null,
      booking_date: bDate,
      booking_time: bTime,
      duration_minutes: 0,
      status: salon.auto_confirm === true ? 'confirmed' : 'pending',
      notes: '',
      form_answers: JSON.stringify(formAnswers || {})
    };
    const bk = await db.createBooking(bData);
    const r6 = (bk.id || '').slice(-6);
    session.clear(from);
    const cMsg = salon.inquiry_confirmation_message || 'Hvala za povprasevanje! Kontaktirali vas bomo cim prej.';
    await wa.send(phoneId, token, wa.textMsg(from, `${cMsg}\n\nRef: *${r6}*`));
    const aSum = Object.entries(formAnswers || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
    if (salonAdminPhone) {
      wa.send(phoneId, token, wa.textMsg(salonAdminPhone,
        `*Novo povprasevanje*\n\nIme: ${customerName}\nTel: +${from}\nStoritev: ${svc ? svc.name : ''}\nDatum: ${preferredDate || '?'}\nUra: ${preferredTime || '?'}\nRef: *${r6}*${aSum ? '\n\n' + aSum : ''}`
      )).catch(e => console.error('Inquiry admin WA err:', e.message));
    } else {
      console.log(`[email] Sending inquiry admin email to ${salon.owner_email} for booking ${bk.id}`);
      mail.sendAdminBookingConfirmEmail(salon, customerName, from, preferredDate || today, preferredTime || 'po dogovoru', r6, bk.id)
        .catch(e => console.error('[email] inquiry admin email failed:', e.message));
    }
  };

  // ── Step 6: preferred date for inquiry ──
  if (sess.step === 6 && msgText) {
    session.set(from, { ...sess, step: 7, preferredDate: msgText.trim() });
    await wa.send(phoneId, token, wa.textMsg(from, 'Ob kateri uri? (npr. 10:00, popoldne...)'));
    return;
  }

  // ── Step 7: preferred time for inquiry ──
  if (sess.step === 7 && msgText) {
    const s = session.get(from);
    const updated = { ...s, preferredTime: msgText.trim() };
    if (formFields.length > 0) {
      const first = formFields[0];
      session.set(from, { ...updated, step: 10, fieldIndex: 0, formAnswers: {} });
      const opt = first.required ? '' : ' (opcijsko - 0 za preskok)';
      await wa.send(phoneId, token, wa.textMsg(from, `${first.label}:${opt}`));
    } else {
      session.set(from, { ...updated, step: 20, formAnswers: {} });
      await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
    }
    return;
  }

  // ── Step 10: collecting form fields ──
  if (sess.step === 10 && msgText) {
    const s = session.get(from);
    const fi = s.fieldIndex || 0;
    const field = formFields[fi];
    const skipped = msgText.trim() === '0' && field && !field.required;
    const answers = skipped ? s.formAnswers : { ...(s.formAnswers || {}), [field ? field.label : `Q${fi}`]: msgText.trim() };
    const nextFi = fi + 1;
    if (nextFi < formFields.length) {
      const nextField = formFields[nextFi];
      session.set(from, { ...s, step: 10, fieldIndex: nextFi, formAnswers: answers });
      const opt = nextField.required ? '' : ' (opcijsko - 0 za preskok)';
      await wa.send(phoneId, token, wa.textMsg(from, `${nextField.label}:${opt}`));
    } else {
      // All fields collected — check if name was already in form fields
      const nameField = formFields.find(f =>
        f.id === 'full_name' || f.id === 'name' || f.id === 'ime' ||
        /ime.*priimek|full.?name/i.test(f.label || '')
      );
      const autoName = nameField ? (answers[nameField.label] || null) : null;

      if (bookingMode === 'inquiry') {
        if (autoName) {
          await submitInquiry(autoName, answers, s.serviceId, s.preferredDate, s.preferredTime);
        } else {
          session.set(from, { ...s, step: 20, formAnswers: answers });
          await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
        }
      } else {
        if (autoName) {
          const svc = services.find(sv => sv.id === s.serviceId);
          session.set(from, { ...s, step: 5, customerName: autoName, formAnswers: answers });
          await wa.send(phoneId, token, wa.finalConfirmButtons(from, s.selectedDate, s.selectedTime, autoName, svc ? svc.name : 'Storitev'));
        } else {
          session.set(from, { ...s, step: 4, formAnswers: answers });
          await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
        }
      }
    }
    return;
  }

  // ── Step 20: name for inquiry (no name in form fields) ──
  if (sess.step === 20 && msgText) {
    const s = session.get(from);
    await submitInquiry(msgText.trim(), s.formAnswers, s.serviceId, s.preferredDate, s.preferredTime);
    return;
  }

  // ── Step 30: collecting form fields BEFORE date (datetime_position = 'last') ──
  if (sess.step === 30 && msgText) {
    const s = session.get(from);
    const fi = s.fieldIndex || 0;
    const field = formFields[fi];
    const skipped = msgText.trim() === '0' && field && !field.required;
    const answers = skipped ? s.formAnswers : { ...(s.formAnswers || {}), [field ? field.label : `Q${fi}`]: msgText.trim() };
    const nextFi = fi + 1;
    if (nextFi < formFields.length) {
      const nextField = formFields[nextFi];
      session.set(from, { ...s, step: 30, fieldIndex: nextFi, formAnswers: answers });
      const opt = nextField.required ? '' : ' (opcijsko - 0 za preskok)';
      await wa.send(phoneId, token, wa.textMsg(from, `${nextField.label}:${opt}`));
    } else {
      // All pre-fields done → now ask for date
      await goDateAfterForm({ ...s, formAnswers: answers });
    }
    return;
  }

  // ── Step 31: natural language date (datetime_position = 'last') ──
  if (sess.step === 31 && msgText) {
    const { date, time } = parseCustomerDateTime(msgText);
    const workingDays = (salon.working_days || '1,2,3,4,5,6').split(',').map(Number);
    if (date && time) {
      const d = new Date(date + 'T12:00:00');
      if (!workingDays.includes(d.getDay())) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Na ta dan ne delamo. Izberite drug dan:'));
        await wa.send(phoneId, token, wa.dateList(from, await getFreeDates(salon, 30, sess.serviceDuration)));
        return;
      }
      const bestTime = await resolveCustomTime(salon, date, time, sess.serviceDuration);
      if (bestTime) {
        await goAfterTime(date, bestTime, { ...sess, step: 31 });
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Ob ${time} ni prostih terminov. Izberite drug datum:`));
        await wa.send(phoneId, token, wa.dateList(from, await getFreeDates(salon, 30, sess.serviceDuration)));
      }
    } else if (date) {
      const d = new Date(date + 'T12:00:00');
      if (!workingDays.includes(d.getDay())) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Na ta dan ne delamo. Izberite drug dan:'));
        await wa.send(phoneId, token, wa.dateList(from, await getFreeDates(salon, 30, sess.serviceDuration)));
        return;
      }
      session.set(from, { ...sess, step: 32, selectedDate: date });
      await wa.send(phoneId, token, wa.timeList(from, await getFreeTimesForDate(salon, date, sess.serviceDuration), date));
    } else {
      await wa.send(phoneId, token, wa.dateList(from, await getFreeDates(salon, 30, sess.serviceDuration)));
    }
    return;
  }

  // ── Step 32: natural language time (datetime_position = 'last') ──
  if (sess.step === 32 && msgText) {
    const { date: parsedDate, time: parsedTime } = parseCustomerDateTime(msgText);
    const useDate = parsedDate || sess.selectedDate;
    if (!useDate) { session.clear(from); await wa.send(phoneId, token, wa.dateList(from, await getFreeDates(salon))); return; }
    if (parsedTime) {
      const bestTime = await resolveCustomTime(salon, useDate, parsedTime, sess.serviceDuration);
      if (bestTime) {
        // Skip formFields (already collected in step 30), go straight to name/confirm
        const s = session.get(from);
        const nameField = formFields.find(f =>
          f.id === 'full_name' || f.id === 'name' || f.id === 'ime' ||
          /ime.*priimek|full.?name/i.test(f.label || '')
        );
        const autoName = nameField ? ((s.formAnswers || {})[nameField.label] || null) : null;
        if (autoName) {
          const svc = services.find(sv => sv.id === s.serviceId);
          session.set(from, { ...s, step: 5, customerName: autoName, selectedDate: useDate, selectedTime: bestTime });
          await wa.send(phoneId, token, wa.finalConfirmButtons(from, useDate, bestTime, autoName, svc ? svc.name : 'Storitev'));
        } else {
          session.set(from, { ...s, step: 4, selectedDate: useDate, selectedTime: bestTime });
          await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
        }
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Ob ${parsedTime} ni prostega termina. Izberite:`));
        await wa.send(phoneId, token, wa.timeList(from, await getFreeTimesForDate(salon, useDate, sess.serviceDuration), useDate));
      }
    } else {
      await wa.send(phoneId, token, wa.timeList(from, await getFreeTimesForDate(salon, useDate, sess.serviceDuration), useDate));
    }
    return;
  }

  // ── Step 4: name for exact_time ──
  if (sess.step === 4 && msgText) {
    const s = session.get(from);
    if (!s.selectedDate || !s.selectedTime || !s.serviceId) {
      await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Zacnite znova.'));
      session.clear(from);
      return;
    }
    const svc = services.find(sv => sv.id === s.serviceId);
    session.set(from, { ...s, step: 5, customerName: msgText.trim() });
    await wa.send(phoneId, token, wa.finalConfirmButtons(from, s.selectedDate, s.selectedTime, msgText.trim(), svc ? svc.name : 'Storitev'));
    return;
  }

  // ── Step 5 / final_confirm — ustvari rezervacijo ──
  if ((iId === 'final_confirm') || (sess.step === 5 && iId === 'final_confirm')) {
    const s = session.get(from);
    if (!s.selectedDate || !s.selectedTime || !s.serviceId || !s.customerName) {
      await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Zacnite znova.'));
      session.clear(from);
      return;
    }
    const svc = services.find(sv => sv.id === s.serviceId);
    const fa = s.formAnswers && Object.keys(s.formAnswers).length ? s.formAnswers : {};
    const faJson = Object.keys(fa).length ? JSON.stringify(fa) : null;
    const autoConfirm = salon.auto_confirm === true;

    const bookingData = {
      customer_phone: from,
      customer_name: s.customerName,
      salon_id: salon.id,
      service_id: s.serviceId,
      booking_date: s.selectedDate,
      booking_time: s.selectedTime + ':00',
      status: autoConfirm ? 'confirmed' : 'pending',
      notes: '',
      form_answers: faJson
    };
    if (s.serviceDuration) bookingData.duration_minutes = s.serviceDuration;

    const booking = await db.createBookingIfFree(bookingData);
    const ref6 = (booking.id || '').slice(-6);
    const fDate = fmtDate(s.selectedDate);
    const fTime = (s.selectedTime || '').substring(0, 5);
    session.clear(from);

    // Sporocilo stranki glede na auto_confirm
    const faLines = Object.entries(fa).map(([k, v]) => `• ${k}: ${v}`).join('\n');
    const faBlock = faLines ? `\n\n📋 Vaši odgovori:\n${faLines}` : '';
    const custMsg = autoConfirm
      ? (salon.booking_confirmation_message
          ? salon.booking_confirmation_message + faBlock
          : `Rezervacija potrjena! ✅\n\n📅 ${fDate} ob ${fTime}\n👤 ${s.customerName}\n💼 ${svc ? svc.name : 'Storitev'}${faBlock}\n\nRef: *${ref6}*\n\nDo takrat! 🌸`)
      : `Rezervacija oddana! ⏳\n\n📅 ${fDate} ob ${fTime}\n👤 ${s.customerName}\n💼 ${svc ? svc.name : 'Storitev'}${faBlock}\n\nRef: *${ref6}*\n\nCakamo na potrditev. Ko bo potrjena, vas obvestimo. 🙏`;
    await wa.send(phoneId, token, wa.textMsg(from, custMsg));

    // Obvesti admina glede na nastavitve notify_whatsapp / notify_email
    const doWA    = salon.notify_whatsapp !== false && salonAdminPhone;
    const doEmail = salon.notify_email    !== false && salon.owner_email;

    if (doWA) {
      if (autoConfirm) {
        // Auto-potrjeno: samo info sporocilo
        const aSum = Object.entries(fa).map(([k, v]) => `${k}: ${v}`).join('\n');
        const adminMsg =
          `🆕 *Nova rezervacija*\n\n` +
          `👤 ${s.customerName}\n` +
          `📞 +${from}\n` +
          `💼 ${svc ? svc.name : '-'}\n` +
          `📅 ${fDate} ob ${fTime}\n` +
          `🔑 Ref: *${ref6}*` +
          (aSum ? `\n\n📋 *Odgovori na vprašanja:*\n${aSum}` : '');
        wa.send(phoneId, token, wa.textMsg(salonAdminPhone, adminMsg))
          .catch(e => console.error('[booking] Admin WA err:', e.message));
      } else {
        // Pending: posljemo gumbe za potrditev/zavrnitev
        try {
          await wa.send(phoneId, token, wa.adminBookingNotif(salonAdminPhone, s.customerName, from, fDate, fTime, ref6));
        } catch (e) {
          try {
            await wa.send(phoneId, token, wa.adminBookingNotifSession(salonAdminPhone, s.customerName, from, s.selectedDate, fTime, ref6));
          } catch (e2) {
            wa.send(phoneId, token, wa.textMsg(salonAdminPhone,
              `Nova rezervacija\n\nIme: ${s.customerName}\nTel: +${from}\nDatum: ${fDate} ob ${fTime}\nRef: *${ref6}*\n\nPotrdi: *#potrdi ${ref6}*`
            )).catch(e3 => db.logError(salon.id, 'admin_notify', e3.message, 'Admin WA ni uspelo', from));
          }
        }
      }
    }

    if (doEmail) {
      if (autoConfirm) {
        mail.sendBookingNotification(salon, s.customerName, from, s.selectedDate, fTime, ref6, 'WhatsApp rezervacija', fa)
          .catch(e => console.error('[booking] Admin email err:', e.message));
      } else {
        mail.sendAdminBookingConfirmEmail(salon, s.customerName, from, fDate, fTime, ref6, booking.id)
          .catch(e => console.error('[booking] Admin confirm email err:', e.message));
      }
    }

    if (!doWA && !doEmail) {
      console.warn(`[booking] ${ref6} — ni nastavljenega kanala za obvestila (salon ${salon.id})`);
    }

    console.log(`[booking] Created ${ref6} for ${s.customerName} on ${s.selectedDate} ${fTime}`);
    return;
  }

  // ── final_cancel — prekliči ──
  if (iId === 'final_cancel') {
    session.clear(from);
    await wa.send(phoneId, token, wa.textMsg(from, 'Rezervacija preklicana. Ce zelite rezervirati znova, nam pisˇite.'));
    return;
  }

  // ── Service selection ──
  if (iId.startsWith('svc_')) {
    const svcId = iId.replace('svc_', '');
    const svc = services.find(s => s.id === svcId);
    const serviceDuration = svc ? svc.duration_minutes : null;

    if (bookingMode === 'inquiry') {
      session.set(from, { step: 6, serviceId: svcId });
      await wa.send(phoneId, token, wa.textMsg(from, 'Kdaj bi zeleli priti? (npr. v petek, 28.5., naslednji teden...)'));
      return;
    }

    if (datetimePosition === 'last' && formFields.length > 0) {
      // Form fields first, date/time later
      await goFormFirst({ step: 30, serviceId: svcId, serviceDuration });
      return;
    }

    session.set(from, { step: 1, serviceId: svcId, serviceDuration });
    const freeDates = await getFreeDates(salon, 30, serviceDuration);
    await wa.send(phoneId, token, wa.dateList(from, freeDates));
    return;
  }

  // ── Step 1: natural language date ──
  if (sess.step === 1 && msgText) {
    const { date, time } = parseCustomerDateTime(msgText);
    const workingDays = (salon.working_days || '1,2,3,4,5,6').split(',').map(Number);
    if (date && time) {
      const d = new Date(date + 'T12:00:00');
      if (!workingDays.includes(d.getDay())) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Na ta dan ne delamo. Izberite drug dan:'));
        await wa.send(phoneId, token, wa.dateList(from, await getFreeDates(salon, 30, sess.serviceDuration)));
        return;
      }
      const bestTime = await resolveCustomTime(salon, date, time, sess.serviceDuration);
      if (bestTime) {
        await goAfterTime(date, bestTime, sess);
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Ob ${time} ni prostih terminov. Izberite drug datum:`));
        await wa.send(phoneId, token, wa.dateList(from, await getFreeDates(salon, 30, sess.serviceDuration)));
      }
    } else if (date) {
      const d = new Date(date + 'T12:00:00');
      if (!workingDays.includes(d.getDay())) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Na ta dan ne delamo. Izberite drug dan:'));
        await wa.send(phoneId, token, wa.dateList(from, await getFreeDates(salon, 30, sess.serviceDuration)));
        return;
      }
      session.set(from, { ...sess, step: 2, selectedDate: date });
      await wa.send(phoneId, token, wa.timeList(from, await getFreeTimesForDate(salon, date, sess.serviceDuration), date));
    } else {
      await wa.send(phoneId, token, wa.dateList(from, await getFreeDates(salon, 30, sess.serviceDuration)));
    }
    return;
  }

  // ── Step 2: natural language time ──
  if (sess.step === 2 && msgText) {
    const { date: parsedDate, time: parsedTime } = parseCustomerDateTime(msgText);
    const useDate = parsedDate || sess.selectedDate;
    if (!useDate) {
      session.clear(from);
      await wa.send(phoneId, token, wa.dateList(from, await getFreeDates(salon)));
      return;
    }
    if (parsedTime) {
      const bestTime = await resolveCustomTime(salon, useDate, parsedTime, sess.serviceDuration);
      if (bestTime) {
        await goAfterTime(useDate, bestTime, sess);
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Ob ${parsedTime} ni prostega termina. Izberite:`) );
        await wa.send(phoneId, token, wa.timeList(from, await getFreeTimesForDate(salon, useDate, sess.serviceDuration), useDate));
      }
    } else {
      await wa.send(phoneId, token, wa.timeList(from, await getFreeTimesForDate(salon, useDate, sess.serviceDuration), useDate));
    }
    return;
  }

  // ── Date selection ──
  if (iId.startsWith('date_')) {
    const date = iId.replace('date_', '');
    const nextStep = (sess.step === 31) ? 32 : 2;
    session.set(from, { ...sess, step: nextStep, selectedDate: date });
    await wa.send(phoneId, token, wa.timeList(from, await getFreeTimesForDate(salon, date, sess.serviceDuration), date));
    return;
  }

  // ── Time selection ──
  if (iId.startsWith('time_')) {
    const withoutPrefix = iId.replace('time_', '');
    const date = withoutPrefix.substring(0, 10);
    const time = withoutPrefix.substring(11).replace('h', ':');
    if (sess.step === 31 || sess.step === 32) {
      // datetime_position = 'last': form already collected, go straight to name/confirm
      const s = session.get(from);
      const nameField = formFields.find(f =>
        f.id === 'full_name' || f.id === 'name' || f.id === 'ime' ||
        /ime.*priimek|full.?name/i.test(f.label || '')
      );
      const autoName = nameField ? ((s.formAnswers || {})[nameField.label] || null) : null;
      if (autoName) {
        const svc = services.find(sv => sv.id === s.serviceId);
        session.set(from, { ...s, step: 5, customerName: autoName, selectedDate: date, selectedTime: time });
        await wa.send(phoneId, token, wa.finalConfirmButtons(from, date, time, autoName, svc ? svc.name : 'Storitev'));
      } else {
        session.set(from, { ...s, step: 4, selectedDate: date, selectedTime: time });
        await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
      }
    } else {
      await goAfterTime(date, time, sess);
    }
    return;
  }

  // ── Final confirm → create booking ──
  if (iId === 'final_confirm') {
    const s = session.get(from);
    if (!s.selectedDate || !s.selectedTime || !s.serviceId || !s.customerName) {
      await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Zacnite znova.'));
      session.clear(from);
      return;
    }
    const customerName = s.customerName;
    const fa = s.formAnswers && Object.keys(s.formAnswers).length ? JSON.stringify(s.formAnswers) : null;
    const bookingData = {
      customer_phone: from,
      customer_name: customerName,
      salon_id: salon.id,
      service_id: s.serviceId,
      booking_date: s.selectedDate,
      booking_time: s.selectedTime + ':00',
      status: 'pending',
      notes: '',
      form_answers: fa
    };
    if (s.serviceDuration) bookingData.duration_minutes = s.serviceDuration;
    const booking = await db.createBookingIfFree(bookingData);
    const ref6 = (booking.id || '').slice(-6);
    const fDate = fmtDate(s.selectedDate);
    session.clear(from);

    await wa.send(phoneId, token, wa.textMsg(from,
      `Rezervacija oddana!\n\nIme: ${customerName}\nDatum: ${fDate} ob ${s.selectedTime}\nRef: *${ref6}*\n\nCakamo na potrditev. Ko bo potrjena, vas obvestimo. Hvala!`
    ));

    if (salonAdminPhone) {
      try {
        await wa.send(phoneId, token, wa.adminBookingNotif(salonAdminPhone, customerName, from, fDate, s.selectedTime, ref6));
      } catch (e) {
        try {
          await wa.send(phoneId, token, wa.adminBookingNotifSession(salonAdminPhone, customerName, from, s.selectedDate, s.selectedTime, ref6));
        } catch (e2) {
          wa.send(phoneId, token, wa.textMsg(salonAdminPhone,
            `Nova rezervacija\n\nIme: ${customerName}\nTel: +${from}\nDatum: ${fDate} ob ${s.selectedTime}\nRef: *${ref6}*\n\nPotrdi: *#potrdi ${ref6}*`
          )).catch(e3 => db.logError(salon.id, 'admin_notify', e3.message, 'Admin WA ni uspelo', from));
        }
      }
    } else {
      console.log(`[email] Sending admin confirm email to ${salon.owner_email} for booking ${booking.id}`);
      mail.sendAdminBookingConfirmEmail(salon, customerName, from, fDate, s.selectedTime, ref6, booking.id)
        .catch(e => console.error('[email] admin confirm email failed:', e.message));
    }
    return;
  }

  // ── Final cancel ──
  if (iId === 'final_cancel') {
    session.clear(from);
    await wa.send(phoneId, token, wa.textMsg(from, 'Rezervacija preklicana. Pisite nam kadarkoli.'));
    return;
  }

  // ── Default: show service list ──
  session.clear(from);
  await wa.send(phoneId, token, wa.serviceList(from, services, salon));
}

module.exports = { handleMessage };
