const db = require('./supabase');
const wa = require('./whatsapp');
const mail = require('./email');
const session = require('./session');
const { askAdminAI, askCustomerAI, transcribeAudio } = require('./ai');
const { getFreeDates, getFreeTimesForDate, isSlotFree, fitsBeforeEnd, toMins } = require('./calendar');

// ─── Date formatter ───────────────────────────────────────────
function fmtDate(dateStr) {
  if (!dateStr) return '?';
  const d = new Date(dateStr.substring(0, 10) + 'T12:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

// ─── Time validation — 5-minutna natancnost ───────────────────
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

function findNearestTime(freeTimes, requestedTime) {
  if (!freeTimes.length) return null;
  if (freeTimes.includes(requestedTime)) return requestedTime;
  const toMinsLocal = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const reqMins = toMinsLocal(requestedTime);
  let best = null, bestDiff = Infinity;
  for (const t of freeTimes) {
    const diff = Math.abs(toMinsLocal(t) - reqMins);
    if (diff < bestDiff) { bestDiff = diff; best = t; }
  }
  return best;
}

// ─── Natural language date parser (Slovenian) ─────────────────
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
  } else if (lower.includes('pojutrisnjem')) {
    const d = new Date(now); d.setDate(d.getDate() + 2);
    date = d.toISOString().split('T')[0];
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

// ─── Main handler ─────────────────────────────────────────────
async function handleMessage(msgObj, salon) {
  const from = msgObj.from;
  const msgType = msgObj.type;
  const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
  const token = process.env.WA_TOKEN;

  // ─── Glasovno sporocilo → Whisper transkripcija ───────────
  if (msgType === 'audio') {
    try {
      const mediaId = msgObj.audio?.id;
      if (!mediaId) return;
      const transcription = await transcribeAudio(mediaId, token);
      if (transcription) {
        console.log(`Voice transcribed [${from}]: "${transcription}"`);
        msgObj.type = 'text';
        msgObj.text = { body: transcription };
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, 'Ni uspelo razumeti glasovnega sporocila. Prosimo, napisite besedilo.'));
        return;
      }
    } catch (e) {
      console.error('Whisper error:', e.message);
      await db.logError(salon.id, 'whisper', e.message, null, from);
      await wa.send(phoneId, token, wa.textMsg(from, 'Napaka pri obdelavi glasovnega sporocila. Prosimo, napisite besedilo.'));
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

  // ─── ADMIN FLOW ───────────────────────────────────────────
  if (isAdmin) {
    // Admin gumb Potrdi
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
              const errData = e2.response?.data?.error || e2.response?.data || e2.message;
              const errMsg = typeof errData === 'object' ? JSON.stringify(errData) : errData;
              console.error('Notify customer err:', errMsg);
              await db.logError(salon.id, 'customer_notify', errMsg, 'Potrditev stranke ni uspela', booking.customer_phone);
              await wa.send(phoneId, token, wa.textMsg(from, `Stranka (${booking.customer_phone}) NI obvescena.\nNapaka: ${errMsg}`));
            }
          }
        }
        const notesEmail = (booking.notes || '').match(/customer_email:([^\s,]+)/)?.[1];
        if (notesEmail) {
          await mail.sendCustomerBookingConfirmed(notesEmail, booking.customer_name || 'stranka', salon.name, custDate, custTime, ref).catch(e => console.error('[email] customer confirmed:', e.message));
        }
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija ${ref} ni najdena.`));
      }
      return;
    }

    // Admin gumb Zavrni
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
            const errMsg = JSON.stringify(e.response?.data?.error || e.message);
            console.error('Notify customer cancel err:', errMsg);
            await wa.send(phoneId, token, wa.textMsg(from, `Stranka (${booking.customer_phone}) NI obvescena o zavrnitvi.\nNapaka: ${errMsg}`));
          }
        }
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija ${ref} ni najdena.`));
      }
      return;
    }

    // Admin #potrdi/#zavrni REF6
    const lowerText = msgText.toLowerCase();
    if (lowerText.startsWith('#potrdi ') || lowerText.startsWith('#zavrni ')) {
      const parts = msgText.trim().split(/\s+/);
      const ref = parts[1];
      const isConfirm = lowerText.startsWith('#potrdi');
      if (ref) {
        const booking = await db.getBookingForSalon(salon.id, ref);
        if (booking) {
          const newStatus = isConfirm ? 'confirmed' : 'cancelled';
          await db.updateBookingStatus(booking.id, newStatus);
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
              console.error('Notify customer err:', e.response?.data || e.message);
              await wa.send(phoneId, token, wa.textMsg(from, `Ni uspelo obvestiti stranke (${booking.customer_phone}): ${e.message}`));
            }
          }
          if (isConfirm) {
            const notesEmail = (booking.notes || '').match(/customer_email:([^\s,]+)/)?.[1];
            if (notesEmail) {
              const cDate = fmtDate(booking.booking_date);
              const cTime = (booking.booking_time || '').substring(0, 5);
              await mail.sendCustomerBookingConfirmed(notesEmail, booking.customer_name || 'stranka', salon.name, cDate, cTime, ref).catch(e => console.error('[email] customer confirmed text:', e.message));
            }
          }
        } else {
          await wa.send(phoneId, token, wa.textMsg(from, `Rezervacija ${ref} ni najdena.`));
        }
      }
      return;
    }

    // Knowledge base ukazi
    const lowerMsg = msgText.toLowerCase();

    if (lowerMsg.startsWith('#nauci ')) {
      const content = msgText.slice(7).trim();
      if (content) {
        await db.addKnowledge(salon.id, content);
        await wa.send(phoneId, token, wa.textMsg(from, `Nauceno: "${content}"`));
      }
      return;
    }

    if (lowerMsg.startsWith('#pozabi ')) {
      const keyword = msgText.slice(8).trim();
      if (keyword) {
        await db.deleteKnowledge(salon.id, keyword);
        await wa.send(phoneId, token, wa.textMsg(from, `Izbrisano znanje z besedo: "${keyword}"`));
      }
      return;
    }

    if (lowerMsg.startsWith('#znanje')) {
      const items = await db.getKnowledge(salon.id);
      if (!items.length) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Ni shranjenega znanja.\n\nDodaj z: *#nauci <besedilo>*'));
      } else {
        const list = items.map((k, i) => `${i + 1}. ${k.content}`).join('\n');
        await wa.send(phoneId, token, wa.textMsg(from, `*Shranjeno znanje (${items.length}):*\n\n${list}\n\nIzbrisi z: *#pozabi <beseda>*`));
      }
      return;
    }

    if (msgText) {
      const today = new Date().toISOString().split('T')[0];

      const wantsClear = /po[cč]isti|odstrani\s+star|zavrni\s+star|izbri[sš]\s+star/i.test(msgText);
      if (wantsClear) {
        try {
          const pending = await db.getPendingBookings(salon.id);
          const pastPending = pending.filter(b => (b.booking_date || '').substring(0, 10) < today);
          if (pastPending.length === 0) {
            await wa.send(phoneId, token, wa.textMsg(from, 'Ni starih cakajocih rezervacij za pocistiti.'));
          } else {
            for (const b of pastPending) {
              await db.updateBookingStatus(b.id, 'cancelled');
            }
            await wa.send(phoneId, token, wa.textMsg(from, `Pocisceno: ${pastPending.length} pretecenih rezervacij preklicanih.`));
          }
        } catch (e) {
          console.error('Clear old pending err:', e.message);
          await wa.send(phoneId, token, wa.textMsg(from, `Napaka: ${e.message}`));
        }
        return;
      }

      const asksPending = /termini|pending|rezervaci|cakaj/i.test(msgText);
      if (asksPending) {
        try {
          const pending = await db.getPendingBookings(salon.id);
          const futurePending = pending.filter(b => (b.booking_date || '').substring(0, 10) >= today);
          if (futurePending.length > 0) {
            await wa.send(phoneId, token, wa.textMsg(from, `*${futurePending.length} cakajocih rezervacij:*`));
            for (const b of futurePending) {
              await wa.send(phoneId, token, wa.adminPendingButtons(from, b));
            }
          } else {
            await wa.send(phoneId, token, wa.textMsg(from, 'Ni cakajocih rezervacij.'));
          }
        } catch (e) {
          console.error('Pending bookings err:', e.message);
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

  // ─── CUSTOMER FLOW ────────────────────────────────────────
  const sess = session.get(from);
  const services = await db.getServices(salon.id);

  // FIX: normalize booking_mode and parse form_fields (may be JSON string from DB)
  const VALID_MODES = ['exact_time', 'date_only', 'inquiry', 'month_only'];
  const bookingMode = VALID_MODES.includes(salon.booking_mode) ? salon.booking_mode : 'exact_time';
  const rawFF = salon.form_fields;
  const formFields = Array.isArray(rawFF)
    ? rawFF
    : (typeof rawFF === 'string' && rawFF.trim()
        ? (() => { try { const p = JSON.parse(rawFF); return Array.isArray(p) ? p : []; } catch (err) { return []; } })()
        : []);

  // Helper: after time confirmed — go to form fields or name
  const goAfterTime = async (date, time, sessData) => {
    if (formFields.length > 0) {
      const first = formFields[0];
      session.set(from, { ...sessData, step: 10, selectedDate: date, selectedTime: time, fieldIndex: 0, formAnswers: {} });
      const opt = !first.required ? ' (opcijsko - 0 za preskok)' : '';
      await wa.send(phoneId, token, wa.textMsg(from, `${first.label}:${opt}`));
    } else {
      session.set(from, { ...sessData, step: 4, selectedDate: date, selectedTime: time });
      await wa.send(phoneId, token, wa.textMsg(from, 'Prosimo, vpisite vase ime in priimek:'));
    }
  };

  // ── Step 10: collecting form fields one by one ────────────
  if (sess.step === 10 && msgText) {
    const s = session.get(from);
    const fi = s.fieldIndex || 0;
    const field = formFields[fi];
    const skipped = msgText.trim() === '0' && field && !field.required;
    const answers = skipped ? s.formAnswers : { ...(s.formAnswers || {}), [field?.label || `Q${fi}`]: msgText.trim() };
    const nextFi = fi + 1;
    if (nextFi < formFields.length) {
      const nextField = formFields[nextFi];
      session.set(from, { ...s, step: 10, fieldIndex: nextFi, formAnswers: answers });
      const optional = !nextField.required ? ' (opcijsko - 0 za preskok)' : '';
      await wa.send(phoneId, token, wa.textMsg(from, `${nextField.label}:${optional}`));
    } else {
      // After last field: inquiry → ask name (step 20), exact_time → ask name (step 4)
      if (bookingMode === 'inquiry') {
        session.set(from, { ...s, step: 20, formAnswers: answers });
        await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
      } else {
        session.set(from, { ...s, step: 4, formAnswers: answers });
        await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
      }
    }
    return;
  }

  // ── Step 20: name for inquiry → submit immediately (no email from customer) ──
  if (sess.step === 20 && msgText) {
    const s = session.get(from);
    const customerName = msgText.trim();
    const today = new Date().toISOString().split('T')[0];
    const svc = services.find(sv => sv.id === s.serviceId);
    const bookingData = {
      customer_phone: from,
      customer_name: customerName,
      salon_id: salon.id,
      service_id: s.serviceId || null,
      booking_date: today,
      booking_time: '00:00:00',
      duration_minutes: 0,
      status: 'pending',
      notes: '',
      form_answers: JSON.stringify(s.formAnswers || {})
    };
    const booking = await db.createBooking(bookingData);
    const ref6 = (booking.id || '').slice(-6);
    session.clear(from);

    const confirmMsg = salon.inquiry_confirmation_message || 'Hvala za povprasevanje! Kontaktirali vas bomo cim prej.';
    await wa.send(phoneId, token, wa.textMsg(from, `${confirmMsg}\n\nRef: *${ref6}*`));

    // Notify admin
    const answerSummary = Object.entries(s.formAnswers || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
    if (salonAdminPhone) {
      wa.send(phoneId, token, wa.textMsg(salonAdminPhone,
        `*Novo povprasevanje*\n\nIme: ${customerName}\nTel: +${from}\nStoritev: ${svc?.name || ''}\nRef: *${ref6}*\n\n${answerSummary}`
      )).catch(e => console.error('Inquiry admin WA err:', e.message));
    } else {
      mail.sendAdminBookingConfirmEmail(salon, customerName, from, today, svc?.name || 'povprasevanje', ref6, booking.id)
        .catch(e => console.error('[email] inquiry admin email:', e.message));
    }
    return;
  }

  // ── Step 4: customer name for exact_time booking ──────────
  if (sess.step === 4 && msgText) {
    const s = session.get(from);
    if (!s.selectedDate || !s.selectedTime || !s.serviceId) {
      await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Zacnite znova.'));
      session.clear(from);
      return;
    }
    const svc = services.find(sv => sv.id === s.serviceId);
    session.set(from, { ...s, step: 5, customerName: msgText.trim() });
    await wa.send(phoneId, token, wa.finalConfirmButtons(from, s.selectedDate, s.selectedTime, msgText.trim(), svc?.name || 'Storitev'));
    return;
  }

  // ── Service selection ──────────────────────────────────────
  if (iId.startsWith('svc_')) {
    const svcId = iId.replace('svc_', '');
    const svc = services.find(s => s.id === svcId);
    const serviceDuration = svc?.duration_minutes || null;

    if (bookingMode === 'inquiry') {
      if (formFields.length > 0) {
        const first = formFields[0];
        session.set(from, { step: 10, serviceId: svcId, fieldIndex: 0, formAnswers: {} });
        const optional = !first.required ? ' (opcijsko - 0 za preskok)' : '';
        await wa.send(phoneId, token, wa.textMsg(from, `${first.label}:${optional}`));
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

  // ── Step 1: natural language date input ───────────────────
  if (sess.step === 1 && msgText) {
    const { date, time } = parseCustomerDateTime(msgText);
    const workingDays = (salon.working_days || '1,2,3,4,5,6').split(',').map(Number);

    if (date && time) {
      const d = new Date(date + 'T12:00:00');
      if (!workingDays.includes(d.getDay())) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Na ta dan ne delamo. Izberite drug dan:'));
        const freeDates = await getFreeDates(salon, 30, sess.serviceDuration);
        await wa.send(phoneId, token, wa.dateList(from, freeDates));
        return;
      }
      const bestTime = await resolveCustomTime(salon, date, time, sess.serviceDuration);
      if (bestTime) {
        await goAfterTime(date, bestTime, sess);
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Na ta dan ni prostih terminov ob ${time}. Izberite drug datum:`));
        const freeDates = await getFreeDates(salon, 30, sess.serviceDuration);
        await wa.send(phoneId, token, wa.dateList(from, freeDates));
      }
    } else if (date) {
      const d = new Date(date + 'T12:00:00');
      if (!workingDays.includes(d.getDay())) {
        const freeDates = await getFreeDates(salon, 30, sess.serviceDuration);
        await wa.send(phoneId, token, wa.textMsg(from, 'Na ta dan ne delamo. Izberite drug dan:'));
        await wa.send(phoneId, token, wa.dateList(from, freeDates));
        return;
      }
      session.set(from, { ...sess, step: 2, selectedDate: date });
      const freeTimes = await getFreeTimesForDate(salon, date, sess.serviceDuration);
      await wa.send(phoneId, token, wa.timeList(from, freeTimes, date));
    } else {
      const freeDates = await getFreeDates(salon, 30, sess.serviceDuration);
      await wa.send(phoneId, token, wa.dateList(from, freeDates));
    }
    return;
  }

  // ── Step 2: natural language time input ───────────────────
  if (sess.step === 2 && msgText) {
    const { date: parsedDate, time: parsedTime } = parseCustomerDateTime(msgText);
    const useDate = parsedDate || sess.selectedDate;

    if (!useDate) {
      session.clear(from);
      const freeDates = await getFreeDates(salon);
      await wa.send(phoneId, token, wa.dateList(from, freeDates));
      return;
    }

    if (parsedTime) {
      const bestTime = await resolveCustomTime(salon, useDate, parsedTime, sess.serviceDuration);
      if (bestTime) {
        await goAfterTime(useDate, bestTime, sess);
      } else {
        const freeTimes2 = await getFreeTimesForDate(salon, useDate, sess.serviceDuration);
        await wa.send(phoneId, token, wa.textMsg(from, `Ob ${parsedTime} ni prostega termina. Izberite eno od prostih ur:`));
        await wa.send(phoneId, token, wa.timeList(from, freeTimes2, useDate));
      }
    } else {
      const freeTimes2 = await getFreeTimesForDate(salon, useDate, sess.serviceDuration);
      await wa.send(phoneId, token, wa.timeList(from, freeTimes2, useDate));
    }
    return;
  }

  // ── Date selection ─────────────────────────────────────────
  if (iId.startsWith('date_')) {
    const date = iId.replace('date_', '');
    session.set(from, { ...sess, step: 2, selectedDate: date });
    const freeTimes = await getFreeTimesForDate(salon, date, sess.serviceDuration);
    await wa.send(phoneId, token, wa.timeList(from, freeTimes, date));
    return;
  }

  // ── Time selection: format time_YYYY-MM-DD_HHhMM ──────────
  if (iId.startsWith('time_')) {
    const withoutPrefix = iId.replace('time_', '');
    const date = withoutPrefix.substring(0, 10);
    const timeEncoded = withoutPrefix.substring(11);
    const time = timeEncoded.replace('h', ':');
    await goAfterTime(date, time, sess);
    return;
  }

  // ── Final confirm (after name) → create booking ───────────
  if (iId === 'final_confirm') {
    const s = session.get(from);
    if (!s.selectedDate || !s.selectedTime || !s.serviceId || !s.customerName) {
      await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Zacnite znova.'));
      session.clear(from);
      return;
    }
    const customerName = s.customerName;
    const bookingData = {
      customer_phone: from,
      customer_name: customerName,
      salon_id: salon.id,
      service_id: s.serviceId,
      booking_date: s.selectedDate,
      booking_time: s.selectedTime + ':00',
      status: 'pending',
      notes: '',
      form_answers: s.formAnswers && Object.keys(s.formAnswers).length ? JSON.stringify(s.formAnswers) : null
    };
    if (s.serviceDuration) bookingData.duration_minutes = s.serviceDuration;
    const booking = await db.createBookingIfFree(bookingData);
    const ref6 = (booking.id || '').slice(-6);
    const fDate = fmtDate(s.selectedDate);
    session.clear(from);

    // 1. Stranki: sporocilo o oddani rezervaciji
    await wa.send(phoneId, token, wa.textMsg(from,
      `Rezervacija oddana!\n\nIme: ${customerName}\nDatum: ${fDate} ob ${s.selectedTime}\nRef: *${ref6}*\n\nCakamo na potrditev. Ko bo potrjena, vas obvestimo. Hvala!`
    ));

    // 2. Notify admin: WA ce ima telefon, email (z gumbi Potrdi/Zavrni) ce nima
    if (salonAdminPhone) {
      try {
        await wa.send(phoneId, token,
          wa.adminBookingNotif(salonAdminPhone, customerName, from, fDate, s.selectedTime, ref6)
        );
      } catch (e) {
        try {
          await wa.send(phoneId, token,
            wa.adminBookingNotifSession(salonAdminPhone, customerName, from, s.selectedDate, s.selectedTime, ref6)
          );
        } catch (e2) {
          wa.send(phoneId, token, wa.textMsg(salonAdminPhone,
            `Nova rezervacija\n\nIme: ${customerName}\nTel: +${from}\nDatum: ${fDate} ob ${s.selectedTime}\nRef: *${ref6}*\n\nPotrdi z: *#potrdi ${ref6}*`
          )).catch(e3 => db.logError(salon.id, 'admin_notify', e3.message, 'Admin WA ni uspelo', from));
        }
      }
    } else {
      // Brez telefona → email lastniku z gumbi Potrdi/Zavrni
      mail.sendAdminBookingConfirmEmail(salon, customerName, from, fDate, s.selectedTime, ref6, booking.id)
        .catch(e => console.error('[email] admin confirm email:', e.message));
    }
    return;
  }

  // ── Final cancel ───────────────────────────────────────────
  if (iId === 'final_cancel') {
    session.clear(from);
    await wa.send(phoneId, token, wa.textMsg(from, 'Rezervacija preklicana. Pisite nam kadarkoli.'));
    return;
  }

  // ── Default: show service list ─────────────────────────────
  session.clear(from);
  await wa.send(phoneId, token, wa.serviceList(from, services, salon));
}

module.exports = { handleMessage };
