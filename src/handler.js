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

  // ── Step 4: waiting for customer name ──
  if (sess.step === 4 && msgText) {
    const s = session.get(from);
    if (!s.selectedSlotId || !s.serviceId) {
      await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Začnite znova.'));
      session.clear(from);
      return;
    }
    const customerName = msgText;
    const booking = await db.createBooking({
      customer_phone: from,
      customer_name: customerName,
      salon_id: salon.id,
      service_id: s.serviceId,
      booking_date: s.selectedDate,
      booking_time: s.selectedTime ? s.selectedTime + ':00' : null,
      status: 'pending'
    });
    await db.markSlotBooked(s.selectedSlotId);
    session.clear(from);

    const ref6 = (booking.id || '').slice(-6);

    // Notify customer
    await wa.send(phoneId, token, wa.textMsg(from,
      `✅ Rezervacija sprejeta!\n\n👤 ${customerName}\n📅 ${s.selectedDate} ob ${s.selectedTime}\n🔑 Ref: *${ref6}*\n\nČaka na potrditev salona. Obvestili vas bomo. Hvala! 💆`
    ));

    // Notify admin (wrapped in try/catch so customer flow never breaks)
    if (ADMIN_PHONE) {
      try {
        const slot = slots.find(sl => sl.id === s.selectedSlotId);
        const slotInfo = slot || { slot_date: s.selectedDate || '?', slot_time: s.selectedTime || '?' };
        const adminMsg =
          `📩 *Nova rezervacija*\n\n` +
          `👤 ${customerName}\n` +
          `📞 +${from}\n` +
          `📅 ${slotInfo.slot_date} ob ${(slotInfo.slot_time || '').substring(0, 5)}\n` +
          `🔑 Ref: *${ref6}*\n\n` +
          `✅ Potrdi: *#potrdi ${ref6}*\n` +
          `❌ Zavrni: *#zavrni ${ref6}*`;
        await wa.send(phoneId, token, wa.textMsg(ADMIN_PHONE, adminMsg));
      } catch (e) {
        console.error('Admin notify error:', e.response?.data || e.message);
      }
    }
    return;
  }

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

  // Confirm → ask for name
  if (iId === 'confirm_yes') {
    const s = session.get(from);
    if (!s.selectedSlotId || !s.serviceId) {
      await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Začnite znova.'));
      session.clear(from);
      return;
    }
    session.set(from, { ...s, step: 4 });
    await wa.send(phoneId, token, wa.textMsg(from, '👤 Prosimo, vpišite vaše ime in priimek:'));
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

module.exports = { handleMessage };
