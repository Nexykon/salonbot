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
  const sess = session.get(from);
  const services = await db.getServices(salon.id);

  const VALID_MODES = ['exact_time', 'date_only', 'inquiry', 'month_only'];
  const bookingMode = VALID_MODES.includes(salon.booking_mode) ? salon.booking_mode : 'exact_time';
  const rawFF = salon.form_fields;
  const formFields = Array.isArray(rawFF)
    ? rawFF
    : (typeof rawFF === 'string' && rawFF.trim()
        ? (() => { try { const p = JSON.parse(rawFF); return Array.isArray(p) ? p : []; } catch (err) { return []; } })()
        : []);

  // Helper: after time confirmed
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

  // Helper: submit inquiry (step 10 or step 20)
  const submitInquiry = async (customerName, formAnswers, serviceId) => {
    const svc = services.find(sv => sv.id === serviceId);
    const today = new Date().toISOString().split('T')[0];
    const bData = {
      customer_phone: from,
      customer_name: customerName,
      salon_id: salon.id,
      service_id: serviceId || null,
      booking_date: today,
      booking_time: '00:00:00',
      duration_minutes: 0,
      status: 'pending',
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
        `*Novo povprasevanje*\n\nIme: ${customerName}\nTel: +${from}\nStoritev: ${svc ? svc.name : ''}\nRef: *${r6}*${aSum ? '\n\n' + aSum : ''}`
      )).catch(e => console.error('Inquiry admin WA err:', e.message));
    } else {
      console.log(`[email] Sending inquiry admin email to ${salon.owner_email} for booking ${bk.id}`);
      mail.sendAdminBookingConfirmEmail(salon, customerName, from, today, svc ? svc.name : 'povprasevanje', r6, bk.id)
        .catch(e => console.error('[email] inquiry admin email failed:', e.message));
    }
  };

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
          await submitInquiry(autoName, answers, s.serviceId);
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
    await submitInquiry(msgText.trim(), s.formAnswers, s.serviceId);
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

  // ── Service selection ──
  if (iId.startsWith('svc_')) {
    const svcId = iId.replace('svc_', '');
    const svc = services.find(s => s.id === svcId);
    const serviceDuration = svc ? svc.duration_minutes : null;

    if (bookingMode === 'inquiry') {
      if (formFields.length > 0) {
        const first = formFields[0];
        session.set(from, { step: 10, serviceId: svcId, fieldIndex: 0, formAnswers: {} });
        const opt = first.required ? '' : ' (opcijsko - 0 za preskok)';
        await wa.send(phoneId, token, wa.textMsg(from, `${first.label}:${opt}`));
      } else {
        session.set(from, { step: 20, serviceId: svcId, formAnswers: {} });
        await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
      }
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
    session.set(from, { ...sess, step: 2, selectedDate: date });
    await wa.send(phoneId, token, wa.timeList(from, await getFreeTimesForDate(salon, date, sess.serviceDuration), date));
    return;
  }

  // ── Time selection ──
  if (iId.startsWith('time_')) {
    const withoutPrefix = iId.replace('time_', '');
    const date = withoutPrefix.substring(0, 10);
    const time = withoutPrefix.substring(11).replace('h', ':');
    await goAfterTime(date, time, sess);
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
