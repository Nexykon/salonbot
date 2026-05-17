const db = require('./supabase');
const wa = require('./whatsapp');
const session = require('./session');
const { askAdminAI } = require('./ai');

const ADMIN_PHONE = process.env.ADMIN_PHONE; // e.g. 38640599185

async function handleMessage(msgObj, salon) {
  const from = msgObj.from;
  const msgType = msgObj.type;
  const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
  const token = process.env.WA_TOKEN;

  // Parse interactive reply ID
  let iId = '';
  if (msgType === 'interactive') {
    const ir = msgObj.interactive;
    iId = ir.type === 'button_reply' ? ir.button_reply.id : (ir.list_reply?.id || '');
  }

  // Check if this is admin
  const isAdmin = from === ADMIN_PHONE;
  const msgText = msgObj.text?.body?.trim() || '';

  // ─── ADMIN FLOW ───────────────────────────────────────────
  if (isAdmin && msgText) {
    try {
      const reply = await askAdminAI(msgText, salon.id);
      await wa.send(phoneId, token, wa.textMsg(from, reply));
    } catch (e) {
      console.error('AI admin error:', e.message);
      await wa.send(phoneId, token, wa.textMsg(from, `Napaka AI: ${e.message}`));
    }
    return;
  }

  // ─── CUSTOMER FLOW ────────────────────────────────────────
  const sess = session.get(from);
  const services = await db.getServices(salon.id);
  const slots = await db.getAvailableSlots(salon.id);

  // Service selection
  if (iId.startsWith('svc_')) {
    const svcId = iId.replace('svc_', '');
    session.set(from, { step: 1, serviceId: svcId });
    await wa.send(phoneId, token, wa.dateList(from, slots));
    return;
  }

  // Date selection
  if (iId.startsWith('date_')) {
    const date = iId.replace('date_', '');
    session.set(from, { ...sess, step: 2, selectedDate: date });
    await wa.send(phoneId, token, wa.timeList(from, slots, date));
    return;
  }

  // Time selection
  if (iId.startsWith('time_')) {
    const parts = iId.split('_');
    const slotId = parts[1];
    const time = parts[2].replace('h', ':');
    session.set(from, { ...sess, step: 3, selectedSlotId: slotId, selectedTime: time });
    await wa.send(phoneId, token, wa.confirmButtons(from, sess.selectedDate || parts[3], time));
    return;
  }

  // Confirm booking
  if (iId === 'confirm_yes') {
    const s = session.get(from);
    if (!s.selectedSlotId || !s.serviceId) {
      await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Začnite znova.'));
      session.clear(from);
      return;
    }
    // Save booking
    const booking = await db.createBooking({
      customer_phone: from,
      salon_id: salon.id,
      slot_id: s.selectedSlotId,
      service_id: s.serviceId,
      status: 'pending'
    });
    await db.markSlotBooked(s.selectedSlotId);
    session.clear(from);

    const ref6 = (booking.id || '').slice(-6);

    // Notify customer
    await wa.send(phoneId, token, wa.textMsg(from,
      `✅ Rezervacija sprejeta!\n\nČaka na potrditev salona.\n🔑 Ref: *${ref6}*\n\nObvestili vas bomo. Hvala! 💆`
    ));

    // Notify admin
    if (ADMIN_PHONE) {
      const slot = slots.find(sl => sl.id === s.selectedSlotId);
      await wa.send(phoneId, token, wa.adminBookingNotif(ADMIN_PHONE, booking, slot || { slot_date: '?', slot_time: '?' }, ref6));
    }
    return;
  }

  // Cancel booking
  if (iId === 'confirm_no') {
    session.clear(from);
    await wa.send(phoneId, token, wa.textMsg(from, 'Rezervacija preklicana. Pišite nam kadarkoli. 👋'));
    return;
  }

  // Default: show service list
  session.clear(from);
  await wa.send(phoneId, token, wa.serviceList(from, services));
}

// ─── ADMIN HANDLER ──────────────────────────────────────────
async function handleAdmin(from, text, iId, salon, phoneId, token) {
  const cmd = text.split(' ')[0].toLowerCase();
  const param = text.split(' ').slice(1).join(' ').trim();

  // Confirm booking via button
  if (iId.startsWith('aconf_')) {
    const ref = iId.replace('aconf_', '');
    const booking = await db.getBooking(ref);
    if (!booking) { await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija ${ref} ni najdena.`)); return; }
    await db.updateBookingStatus(booking.id, 'confirmed');
    await wa.send(phoneId, token, wa.textMsg(from, `✅ Rezervacija ${ref} potrjena.`));
    await wa.send(phoneId, token, wa.textMsg(booking.customer_phone, `🎉 Vaša rezervacija je potrjena!\n\nDo takrat! 💆`));
    return;
  }

  // Reject booking via button
  if (iId.startsWith('arej_')) {
    const ref = iId.replace('arej_', '');
    const booking = await db.getBooking(ref);
    if (!booking) { await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija ${ref} ni najdena.`)); return; }
    await db.updateBookingStatus(booking.id, 'cancelled');
    // Re-open slot
    if (booking.slot_id) {
      await db.markSlotBooked(booking.slot_id); // we'd need markSlotFree
    }
    await wa.send(phoneId, token, wa.textMsg(from, `❌ Rezervacija ${ref} zavrnjena.`));
    await wa.send(phoneId, token, wa.textMsg(booking.customer_phone, `❌ Žal vaša rezervacija ni bila potrjena.\n\nKontaktirajte nas za nov termin.`));
    return;
  }

  // Confirm booking via text command
  if (cmd === '#potrdi') {
    const ref = param;
    if (!ref) { await wa.send(phoneId, token, wa.textMsg(from, 'Uporaba: #potrdi REF')); return; }
    const booking = await db.getBooking(ref);
    if (!booking) { await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija ${ref} ni najdena.`)); return; }
    await db.updateBookingStatus(booking.id, 'confirmed');
    await wa.send(phoneId, token, wa.textMsg(from, `✅ Rezervacija ${ref} potrjena.`));
    await wa.send(phoneId, token, wa.textMsg(booking.customer_phone, `🎉 Vaša rezervacija je potrjena!\n\nDo takrat! 💆`));
    return;
  }

  // Reject booking via text command
  if (cmd === '#zavrni') {
    const ref = param;
    if (!ref) { await wa.send(phoneId, token, wa.textMsg(from, 'Uporaba: #zavrni REF')); return; }
    const booking = await db.getBooking(ref);
    if (!booking) { await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija ${ref} ni najdena.`)); return; }
    await db.updateBookingStatus(booking.id, 'cancelled');
    await wa.send(phoneId, token, wa.textMsg(from, `❌ Rezervacija ${ref} zavrnjena.`));
    await wa.send(phoneId, token, wa.textMsg(booking.customer_phone, `❌ Žal vaša rezervacija ni bila potrjena.\n\nKontaktirajte nas za nov termin.`));
    return;
  }

  // Text commands
  if (cmd === '#pomoc') {
    await wa.send(phoneId, token, wa.textMsg(from,
      `Admin ukazi:\n\n#narocila - danes naročeni\n#storitve - storitve\n#potrdi REF - potrdi rezervacijo\n#zavrni REF - zavrni rezervacijo`
    ));
    return;
  }

  if (cmd === '#narocila') {
    const bookings = await db.getTodayBookings(salon.id);
    if (!bookings.length) { await wa.send(phoneId, token, wa.textMsg(from, 'Danes ni naročil.')); return; }
    const list = bookings.map(b => `• ${(b.slot_time||'?').substring(0,5)} – ${b.customer_phone} (${b.status})`).join('\n');
    await wa.send(phoneId, token, wa.textMsg(from, `Danes naročeni:\n\n${list}`));
    return;
  }

  if (cmd === '#storitve') {
    const services = await db.getServices(salon.id);
    const list = services.map(s => `• ${s.name} – ${s.duration_minutes} min, ${s.price} €`).join('\n');
    await wa.send(phoneId, token, wa.textMsg(from, `Storitve:\n\n${list}`));
    return;
  }

  await wa.send(phoneId, token, wa.textMsg(from, `Neznan ukaz. Pošlji #pomoc za seznam ukazov.`));
}

module.exports = { handleMessage };
