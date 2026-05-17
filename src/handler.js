const db = require('./supabase');
const wa = require('./whatsapp');
const session = require('./session');
const { askAdminAI } = require('./ai');

const ADMIN_PHONE = process.env.ADMIN_PHONE;

// ─── Calendar helpers ─────────────────────────────────────────

function generateWorkingTimes(startTime, endTime, intervalMin = 60) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const times = [];
  let mins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  while (mins < endMins) {
    times.push(String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'));
    mins += intervalMin;
  }
  return times;
}

async function getFreeDates(salon, maxDays = 14) {
  const workingDays = (salon.working_days || '1,2,3,4,5,6').split(',').map(Number);
  const startTime = (salon.working_hours_start || '08:00').substring(0, 5);
  const endTime = (salon.working_hours_end || '19:00').substring(0, 5);
  const allTimes = generateWorkingTimes(startTime, endTime, 60);

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  const freeDates = [];
  const cur = new Date(todayStr + 'T12:00:00');

  for (let i = 0; i < maxDays && freeDates.length < 10; i++) {
    const dateStr = cur.toISOString().split('T')[0];
    const dayOfWeek = cur.getDay();

    if (workingDays.includes(dayOfWeek)) {
      const bookedTimes = await db.getBookedTimesForDate(salon.id, dateStr);
      let freeTimes = allTimes.filter(t => !bookedTimes.includes(t));
      if (dateStr === todayStr) freeTimes = freeTimes.filter(t => t > currentTime);
      if (freeTimes.length > 0) freeDates.push({ date: dateStr, count: freeTimes.length });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return freeDates;
}

async function getFreeTimesForDate(salon, date) {
  const startTime = (salon.working_hours_start || '08:00').substring(0, 5);
  const endTime = (salon.working_hours_end || '19:00').substring(0, 5);
  const allTimes = generateWorkingTimes(startTime, endTime, 60);

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const currentTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  const bookedTimes = await db.getBookedTimesForDate(salon.id, date);
  let freeTimes = allTimes.filter(t => !bookedTimes.includes(t));
  if (date === todayStr) freeTimes = freeTimes.filter(t => t > currentTime);
  return freeTimes;
}

// ─── Natural language date parser (Slovenian) ─────────────────

function parseCustomerDateTime(text) {
  const now = new Date();
  const lower = text.toLowerCase();

  // Parse time: "ob 14h", "14:00", "14h", "ob 14.00"
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

  // Parse date
  let date = null;
  if (lower.includes('danes')) {
    date = now.toISOString().split('T')[0];
  } else if (lower.includes('pojutrišnjem')) {
    const d = new Date(now); d.setDate(d.getDate() + 2);
    date = d.toISOString().split('T')[0];
  } else if (lower.includes('jutri')) {
    const d = new Date(now); d.setDate(d.getDate() + 1);
    date = d.toISOString().split('T')[0];
  } else {
    // Day names (order matters — longer first to avoid partial matches)
    const dayMap = [
      ['ponedeljek', 1], ['torek', 2], ['četrtek', 4],
      ['sobota', 6], ['nedelja', 0], ['sreda', 3], ['petek', 5],
      ['pon', 1], ['tor', 2], ['sre', 3], ['čet', 4], ['pet', 5], ['sob', 6], ['ned', 0]
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
    // DD.MM format
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

// ─── Main handler ─────────────────────────────────────────────

async function handleMessage(msgObj, salon) {
  const from = msgObj.from;
  const msgType = msgObj.type;
  const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
  const token = process.env.WA_TOKEN;

  let iId = '';
  if (msgType === 'interactive') {
    const ir = msgObj.interactive;
    iId = ir.type === 'button_reply' ? ir.button_reply.id : (ir.list_reply?.id || '');
  }
  // Template quick reply gumb (admin potrdi/zavrni prek template sporočila)
  if (msgType === 'button' && msgObj.button?.payload) {
    iId = msgObj.button.payload;
  }

  const isAdmin = from === ADMIN_PHONE;
  const msgText = msgObj.text?.body?.trim() || '';

  // ─── ADMIN FLOW ───────────────────────────────────────────
  if (isAdmin) {
    // Admin pritisne gumb Potrdi
    if (iId.startsWith('admin_confirm_')) {
      const ref = iId.replace('admin_confirm_', '');
      const booking = await db.getBooking(ref);
      if (booking) {
        await db.updateBookingStatus(booking.id, 'confirmed');
        await wa.send(phoneId, token, wa.textMsg(from, `✅ Rezervacija *${ref}* potrjena za ${booking.customer_name || booking.customer_phone}.`));
        // Obvesti stranko
        if (booking.customer_phone && booking.customer_phone !== 'manual') {
          try {
            await wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
              `✅ Vaša rezervacija je potrjena!\n\n📅 ${booking.booking_date} ob ${(booking.booking_time || '').substring(0, 5)}\n\nHvala, vidimo se! 💆`
            ));
          } catch (e) { console.error('Notify customer err:', e.message); }
        }
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija ${ref} ni najdena.`));
      }
      return;
    }

    // Admin pritisne gumb Zavrni
    if (iId.startsWith('admin_cancel_')) {
      const ref = iId.replace('admin_cancel_', '');
      const booking = await db.getBooking(ref);
      if (booking) {
        await db.updateBookingStatus(booking.id, 'cancelled');
        await wa.send(phoneId, token, wa.textMsg(from, `❌ Rezervacija *${ref}* zavrnjena.`));
        // Obvesti stranko
        if (booking.customer_phone && booking.customer_phone !== 'manual') {
          try {
            await wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
              `❌ Žal vaša rezervacija za ${booking.booking_date} ob ${(booking.booking_time || '').substring(0, 5)} ni bila potrjena.\n\nZa novo rezervacijo nam pišite. 🙏`
            ));
          } catch (e) { console.error('Notify customer err:', e.message); }
        }
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija ${ref} ni najdena.`));
      }
      return;
    }

    // Admin piše besedilo → AI
    if (msgText) {
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

  // ─── CUSTOMER FLOW ────────────────────────────────────────
  const sess = session.get(from);
  const services = await db.getServices(salon.id);

  // ── Step 4: waiting for customer name ──
  if (sess.step === 4 && msgText) {
    const s = session.get(from);
    if (!s.selectedDate || !s.selectedTime || !s.serviceId) {
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
      booking_time: s.selectedTime + ':00',
      status: 'pending'
    });
    session.clear(from);

    const ref6 = (booking.id || '').slice(-6);

    await wa.send(phoneId, token, wa.textMsg(from,
      `✅ Rezervacija sprejeta!\n\n👤 ${customerName}\n📅 ${s.selectedDate} ob ${s.selectedTime}\n🔑 Ref: *${ref6}*\n\nČaka na potrditev salona. Obvestili vas bomo. Hvala! 💆`
    ));

    if (ADMIN_PHONE) {
      try {
        // Poskusi template (24/7) — zahteva odobren Meta template
        await wa.send(phoneId, token,
          wa.adminBookingNotif(ADMIN_PHONE, customerName, from, s.selectedDate, s.selectedTime, ref6)
        );
      } catch (e) {
        console.error('Template notify err:', e.response?.data?.error?.message || e.message);
        try {
          // Fallback: interactive gumbi (samo v 24h seji)
          await wa.send(phoneId, token,
            wa.adminBookingNotifSession(ADMIN_PHONE, customerName, from, s.selectedDate, s.selectedTime, ref6)
          );
        } catch (e2) {
          console.error('Session notify err:', e2.response?.data?.error?.message || e2.message);
          try {
            // Zadnji fallback: čisto besedilo (vedno deluje)
            await wa.send(phoneId, token, wa.textMsg(ADMIN_PHONE,
              `📩 *Nova rezervacija*\n\n👤 ${customerName}\n📞 +${from}\n📅 ${s.selectedDate} ob ${s.selectedTime}\n🔑 Ref: *${ref6}*\n\nPotrdi: *#potrdi ${ref6}*\nZavrni: *#zavrni ${ref6}*`
            ));
          } catch (e3) { console.error('Text notify err:', e3.message); }
        }
      }
    }
    return;
  }

  // ── Service selection ──
  if (iId.startsWith('svc_')) {
    const svcId = iId.replace('svc_', '');
    session.set(from, { step: 1, serviceId: svcId });
    const freeDates = await getFreeDates(salon);
    await wa.send(phoneId, token, wa.dateList(from, freeDates));
    return;
  }

  // ── Natural language date input (step 1) ──
  if (sess.step === 1 && msgText) {
    const { date, time } = parseCustomerDateTime(msgText);
    const workingDays = (salon.working_days || '1,2,3,4,5,6').split(',').map(Number);

    if (date && time) {
      const d = new Date(date + 'T12:00:00');
      if (!workingDays.includes(d.getDay())) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Na ta dan ne delamo. Delamo od ponedeljka do sobote. Izberite drug dan:'));
        const freeDates = await getFreeDates(salon);
        await wa.send(phoneId, token, wa.dateList(from, freeDates));
        return;
      }
      const freeTimes = await getFreeTimesForDate(salon, date);
      if (freeTimes.includes(time)) {
        session.set(from, { ...sess, step: 3, selectedDate: date, selectedTime: time });
        await wa.send(phoneId, token, wa.confirmButtons(from, date, time));
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Žal termin ${date} ob ${time} ni prost. Izberite drug datum:`));
        const freeDates = await getFreeDates(salon);
        await wa.send(phoneId, token, wa.dateList(from, freeDates));
      }
    } else {
      // Couldn't parse — show date list again
      const freeDates = await getFreeDates(salon);
      await wa.send(phoneId, token, wa.dateList(from, freeDates));
    }
    return;
  }

  // ── Date selection ──
  if (iId.startsWith('date_')) {
    const date = iId.replace('date_', '');
    session.set(from, { ...sess, step: 2, selectedDate: date });
    const freeTimes = await getFreeTimesForDate(salon, date);
    await wa.send(phoneId, token, wa.timeList(from, freeTimes, date));
    return;
  }

  // ── Time selection — format: time_YYYY-MM-DD_HHhMM ──
  if (iId.startsWith('time_')) {
    const withoutPrefix = iId.replace('time_', '');
    const date = withoutPrefix.substring(0, 10);
    const timeEncoded = withoutPrefix.substring(11);
    const time = timeEncoded.replace('h', ':');
    session.set(from, { ...sess, step: 3, selectedDate: date, selectedTime: time });
    await wa.send(phoneId, token, wa.confirmButtons(from, date, time));
    return;
  }

  // ── Confirm → ask for name ──
  if (iId === 'confirm_yes') {
    const s = session.get(from);
    if (!s.selectedDate || !s.serviceId) {
      await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Začnite znova.'));
      session.clear(from);
      return;
    }
    session.set(from, { ...s, step: 4 });
    await wa.send(phoneId, token, wa.textMsg(from, '👤 Prosimo, vpišite vaše ime in priimek:'));
    return;
  }

  // ── Cancel ──
  if (iId === 'confirm_no') {
    session.clear(from);
    await wa.send(phoneId, token, wa.textMsg(from, 'Rezervacija preklicana. Pišite nam kadarkoli. 👋'));
    return;
  }

  // ── Default: show service list ──
  session.clear(from);
  await wa.send(phoneId, token, wa.serviceList(from, services));
}

module.exports = { handleMessage };
