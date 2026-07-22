const db = require('./supabase');
const { getAdapter } = require('./pos-adapters');
const wa = require('./whatsapp');
const mail = require('./email');
const session = require('./session');
const { askAdminAI, askCustomerAI, transcribeAudio } = require('./ai');
const { getFreeDates, getFreeTimesForDate, isSlotFree, fitsBeforeEnd, toMins } = require('./calendar');
const t = require('./time');
const { botMsg } = require('./botmsg');
const { askOrderAI, computeTotals, aiConfigured, findService } = require('./ai-order');

function fmtDate(dateStr) {
  if (!dateStr) return '?';
  const d = new Date(dateStr.substring(0, 10) + 'T12:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

// Fair-use: obvesti FlowTiq, ko standardni AI lokal preseže mesečno mejo (1x na mesec)
async function notifyFairUse(salon, cnt, limit) {
  const month = t.todayStr().slice(0, 7);
  if (salon.fair_use_notified_month === month) return;
  await db.updateSalonSettings(salon.id, { fair_use_notified_month: month });
  const owner = process.env.FLOWTIQ_OWNER_EMAIL || 'info@flowtiq.si';
  await mail.sendEmail(owner, `AI fair-use presežen — ${salon.name}`, [
    `Lokal "${salon.name}" je ta mesec presegel fair-use mejo AI paketa.`,
    ``,
    `Naročil ta mesec: ${cnt} (meja: ${limit})`,
    `AI natakar je zanje preklopil na klasične gumbe — naročila tečejo naprej.`,
    ``,
    `PRILOŽNOST: ponudi jim Enterprise ceno po meri (master dashboard -> Uredi -> Stripe cena po meri).`
  ].join('\n'));
}

// Skupni slovenski razčlenjevalnik količin ("enega", "dva kosa prosim", "3x")
function parseSloQty(raw) {
  const t = ' ' + String(raw || '').toLowerCase().trim() + ' ';
  const dm = t.match(/\d+/);
  let q = dm ? parseInt(dm[0]) : null;
  if (q === null) {
    const words = [['deset', 10], ['devet', 9], ['osem', 8], ['sedem', 7], ['šest', 6], ['sest', 6], ['pet', 5], ['štiri', 4], ['stiri', 4], ['trikrat', 3], ['tri', 3], ['dvakrat', 2], ['dve', 2], ['dva', 2], ['enkrat', 1], ['enega', 1], ['eno', 1], ['ene', 1], ['ena', 1], ['en', 1]];
    for (const [w, n] of words) {
      if (new RegExp('[\\s]' + w + '(?=[\\s,.!?])').test(t)) { q = n; break; }
    }
  }
  if (q === null) return null;
  const leftover = t
    .replace(/\d+/g, ' ')
    .replace(/\s(deset|devet|osem|sedem|šest|sest|pet|štiri|stiri|trikrat|tri|dvakrat|dve|dva|enkrat|enega|eno|ene|ena|en)(?=[\s,.!?])/g, ' ')
    .replace(/\s(kosov|kosa|kose|kosek|kos|x|krat|komad\w*|prosim|samo|pa|in|hvala|lepo|bi|bom|vzel|vzela|dajte|daj|mi|še|se)(?=[\s,.!?])/g, ' ')
    .replace(/[,.!?]/g, ' ')
    .trim();
  return { q: Math.min(Math.max(q, 1), 50), clean: leftover === '' };
}

function confirmEtaMsg(salon, isPickup, minutes) {
  return botMsg(salon, isPickup ? 'accepted_pickup' : 'accepted_delivery', {
    minute: String(minutes),
    naslov: (isPickup && salon.pickup_address) ? `\n📍 Prevzem: ${salon.pickup_address}` : ''
  });
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
  const todayYmd = t.todayStr();
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
    date = todayYmd;
  } else if (lower.includes('jutri')) {
    date = t.dateOffsetStr(todayYmd, 1);
  } else {
    const dayMap = [
      ['ponedeljek', 1], ['torek', 2], ['cetrtek', 4], ['četrtek', 4],
      ['sobota', 6], ['nedelja', 0], ['sreda', 3], ['petek', 5],
      ['pon', 1], ['tor', 2], ['sre', 3], ['cet', 4], ['čet', 4], ['pet', 5], ['sob', 6], ['ned', 0]
    ];
    for (const [key, dayNum] of dayMap) {
      if (lower.includes(key)) {
        let ahead = dayNum - t.todayDow();
        if (ahead <= 0) ahead += 7;
        date = t.dateOffsetStr(todayYmd, ahead);
        break;
      }
    }
    if (!date) {
      const dm = text.match(/\b(\d{1,2})\.(\d{1,2})\b/);
      if (dm) {
        const day = parseInt(dm[1]), month = parseInt(dm[2]);
        const ymd = todayYmd.slice(0, 4) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        if (ymd >= todayYmd) date = ymd;
      }
    }
  }
  return { date, time };
}

async function handleMessage(msgObj, salon) {
  const from = msgObj.from;
  const skey = `${salon.id}:${from}`; // seja ključana po salonu + telefonu
  const msgType = msgObj.type;
  const phoneId = salon.whatsapp_phone_number_id || process.env.WA_PHONE_ID;
  const token = salon.whatsapp_access_token || process.env.WA_TOKEN;

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

  // ── Bot izklopljen: stranke dobijo obvestilo, admin dela naprej ──
  if (!isAdmin && salon.bot_active === false) {
    await wa.send(phoneId, token, wa.textMsg(from, botMsg(salon, 'bot_offline')));
    return;
  }

  // ── Naročnina potekla + 3 dni odloga: bot na pavzo (stranka dobi vljudno obvestilo) ──
  const SUB_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
  if (!isAdmin && salon.valid_until && Date.now() > new Date(salon.valid_until).getTime() + SUB_GRACE_MS) {
    await wa.send(phoneId, token, wa.textMsg(from, botMsg(salon, 'bot_offline')));
    return;
  }

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
        session.set(skey, { awaitingDeliveryTime: ref, deliveryCustomerPhone: booking.customer_phone, deliveryIsPickup: (booking.notes || '').startsWith('PREVZEM') });
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
          wa.send(phoneId, token, wa.textMsg(booking.customer_phone, botMsg(salon, 'rejected'))).catch(() => {});
        }
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Naročilo ${ref} ni najdeno.`));
      }
      return;
    }

    // ── POS: accept → ask minutes ──
    if (iId.startsWith('pos_accept_')) {
      const ref = iId.replace('pos_accept_', '');
      const booking = await db.getBookingForSalon(salon.id, ref);
      if (booking) {
        // Store cart from form_answers for later POS send
        let posCart = null;
        try {
          const fa = typeof booking.form_answers === 'string'
            ? JSON.parse(booking.form_answers) : booking.form_answers;
          posCart = fa && fa.pos_cart ? JSON.parse(fa.pos_cart) : null;
        } catch (_) {}
        session.set(skey, {
          awaitingPosTime: ref,
          posCustomerPhone: booking.customer_phone,
          posBookingId: booking.id,
          posCart,
          posComment: (() => {
            try {
              const fa = typeof booking.form_answers === 'string'
                ? JSON.parse(booking.form_answers) : booking.form_answers;
              return fa?.opomba || '';
            } catch (_) { return ''; }
          })()
        });
        await wa.send(phoneId, token, wa.textMsg(from,
          `Naročilo *#${ref}* sprejeto! ✅\n\nKoliko minut do priprave/dostave?\n_(samo število, npr. *20*)`
        ));
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Naročilo ${ref} ni najdeno.`));
      }
      return;
    }

    // ── POS: reject ──
    if (iId.startsWith('pos_reject_')) {
      const ref = iId.replace('pos_reject_', '');
      const booking = await db.getBookingForSalon(salon.id, ref);
      if (booking) {
        await db.updateBookingStatus(booking.id, 'cancelled');
        await wa.send(phoneId, token, wa.textMsg(from, `Naročilo *#${ref}* zavrnjeno.`));
        if (booking.customer_phone) {
          wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
            '😔 Žal vašega naročila nismo mogli sprejeti. Pokličite nas za več informacij.'
          )).catch(() => {});
        }
      } else {
        await wa.send(phoneId, token, wa.textMsg(from, `Naročilo ${ref} ni najdeno.`));
      }
      return;
    }

    // ── POS: admin typed minutes → send to POS kitchen ──
    const adminSess = session.get(skey);
    if (adminSess && adminSess.awaitingPosTime && msgText) {
      const minutes = parseInt(msgText.trim());
      const ref = adminSess.awaitingPosTime;
      const custPhone = adminSess.posCustomerPhone;
      const posCart   = adminSess.posCart;
      const posComment = adminSess.posComment || '';
      session.clear(skey);

      if (isNaN(minutes) || minutes <= 0) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Napaka: vnesite samo število minut (npr. 20).'));
        return;
      }

      // Update booking status
      await db.getBookingForSalon(salon.id, ref)
        .then(b => b && db.updateBookingStatus(b.id, 'confirmed'))
        .catch(() => {});

      // Send to POS if configured
      if (salon.pos_type && salon.pos_token && posCart && posCart.length) {
        try {
          const adapter = getAdapter(salon.pos_type);
          const result = await adapter.createOrder(
            salon.pos_token,
            salon.pos_account || '',
            posCart,
            { spot_id: salon.pos_spot_id || 1, comment: posComment }
          );
          if (result.success) {
            await wa.send(phoneId, token, wa.textMsg(from,
              `✅ Naročilo *#${ref}* potrjeno in poslano v kuhinjo!\nPOS ID: ${result.orderId}\n⏱️ Čas: ${minutes} min`
            ));
          } else {
            await wa.send(phoneId, token, wa.textMsg(from,
              `⚠️ Naročilo *#${ref}* potrjeno, A POS napaka: ${result.message}\nRočno vnesite v sistem.`
            ));
          }
        } catch (e) {
          await wa.send(phoneId, token, wa.textMsg(from,
            `⚠️ Naročilo potrjeno, POS napaka: ${e.message}`
          ));
        }
      } else {
        await wa.send(phoneId, token, wa.textMsg(from,
          `✅ Naročilo *#${ref}* potrjeno. ⏱️ ${minutes} min`
        ));
      }

      // Notify customer
      if (custPhone) {
        wa.send(phoneId, token, wa.textMsg(custPhone,
          `🍽️ Naročilo potrjeno!\n\n⏱️ Pripravljeno v pribl. *${minutes} minutah*\n\nHvala za naročilo! 😊`
        )).catch(e => console.error('[POS] notify customer err:', e.message));
      }
      return;
    }

    // ── Delivery: admin typed minutes after accepting ──

    if (adminSess.awaitingDeliveryTime && msgText) {
      const minutes = parseInt(msgText.trim());
      const ref = adminSess.awaitingDeliveryTime;
      const custPhone = adminSess.deliveryCustomerPhone;
      session.clear(skey);
      if (!isNaN(minutes) && minutes > 0 && custPhone) {
        const wasPickup = adminSess.deliveryIsPickup === true;
        await db.getBookingForSalon(salon.id, ref).then(b => b && db.updateBookingStatus(b.id, 'confirmed')).catch(() => {});
        await wa.send(phoneId, token, wa.textMsg(from, `Stranka obveščena: ${wasPickup ? 'prevzem' : 'dostava'} v ${minutes} min. ✅`));
        wa.send(phoneId, token, wa.textMsg(custPhone,
          confirmEtaMsg(salon, wasPickup, minutes)
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
        ref = session.get(skey).awaitingDeliveryTime;
      }
      if (ref && !isNaN(minutes) && minutes > 0) {
        const booking = await db.getBookingForSalon(salon.id, ref);
        if (booking) {
          const casPickup = (booking.notes || '').startsWith('PREVZEM');
          await db.updateBookingStatus(booking.id, 'confirmed');
          session.clear(skey);
          await wa.send(phoneId, token, wa.textMsg(from, `Stranka obveščena: ${casPickup ? 'prevzem' : 'dostava'} v ${minutes} min. ✅`));
          if (booking.customer_phone) {
            wa.send(phoneId, token, wa.textMsg(booking.customer_phone,
              confirmEtaMsg(salon, casPickup, minutes)
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
      const today = t.todayStr();
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
    const sess = session.get(skey);

    // Step 201: got salon name → ask business type
    if (sess.step === 201 && msgText) {
      session.set(skey, { ...sess, step: 202, salonName: msgText.trim() });
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
      session.set(skey, { ...sess, step: 203, salonType: sType });
      await wa.send(phoneId, token, wa.textMsg(from, '📧 Na kateri email vam pošljemo dostop in račun?'));
      return;
    }

    // Step 203: got email → show pricing + confirm
    if (sess.step === 203 && msgText) {
      const email = msgText.trim();
      session.set(skey, { ...sess, step: 204, email });
      await wa.send(phoneId, token, wa.salesConfirmButtons(from, sess.salonName, sess.salonType, email));
      return;
    }

    // Step 204: confirmed → save lead, notify admin
    if (iId === 'sales_confirm') {
      const s = session.get(skey);
      const today = t.todayStr();
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
      session.clear(skey);

      // Notify admin via WA
      if (salonAdminPhone) {
        const msg = `🎉 *NOVO NAROČILO FlowTiq!*\n\n🏪 Salon: ${s.salonName}\n📋 Vrsta: ${s.salonType}\n📞 Tel: +${from}\n📧 Email: ${s.email}\n\nNastavite jim salon in pošljite dostop!`;
        wa.send(phoneId, token, wa.textMsg(salonAdminPhone, msg)).catch(() => {});
      }
      // Notify via email
      if (salon.owner_email) {
        mail.sendBookingNotification && mail.sendBookingNotification(
          salon, s.salonName, from, today, '—', '-', 'FlowTiq naročnina',
          { 'Vrsta': s.salonType || '-', 'Email': s.email || '-' }
        ).catch(e => console.error('[sales] email failed:', e.message));
      }

      await wa.send(phoneId, token, wa.textMsg(from,
        `✅ *Naročilo sprejeto!*\n\nHvala, ${s.salonName}! 🎉\n\nV 24 urah vas kontaktiramo na ${s.email} in nastavimo vaš FlowTiq bot.\n\nDo takrat! 🌸 — Ekipa FlowTiq`
      ));
      return;
    }

    // Step 204: cancelled
    if (iId === 'sales_cancel') {
      session.clear(skey);
      await wa.send(phoneId, token, wa.textMsg(from, 'Ni problema! Če se premislite, smo tukaj. 😊'));
      return;
    }

    // Default / new session: welcome + ask salon name
    session.set(skey, { step: 201 });
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
    const sess = await session.getOrRestore(skey);

    function fmtCart(cart) {
      return cart.map(item => {
        const q = item.qty || 1;
        const lineTotal = (parseFloat(item.price || 0) * q).toFixed(2);
        const nm = item.note ? `${item.name} (${item.note})` : item.name;
        return q > 1 ? `• ${nm} x${q} — ${lineTotal} €` : `• ${nm} — ${lineTotal} €`;
      }).join('\n');
    }
    function cartTotal(cart) {
      return cart.reduce((sum, item) => sum + parseFloat(item.price || 0) * (item.qty || 1), 0).toFixed(2);
    }
    function cartSummaryShort(cart) {
      if (!cart || !cart.length) return null;
      const kosov = cart.reduce((s, i) => s + (i.qty || 1), 0);
      return `${kosov} kosov | ${cartTotal(cart)} €`;
    }

    // ── Ostranjevanje kategorij: "▶️ Več kategorij" ──
    if (iId.startsWith('catspage_')) {
      const pg = parseInt(iId.slice(9)) || 0;
      await wa.send(phoneId, token, wa.deliveryMenuList(from, services, salon, cartSummaryShort(sess && sess.cart), null, pg));
      return;
    }
    // ── Ostranjevanje artiklov znotraj kategorije: catpage_<stran>_<kategorija> ──
    if (iId.startsWith('catpage_')) {
      const rest = iId.slice(8);
      const us = rest.indexOf('_');
      const pg = us >= 0 ? (parseInt(rest.slice(0, us)) || 0) : 0;
      const cat = us >= 0 ? rest.slice(us + 1) : rest;
      await wa.send(phoneId, token, wa.deliveryMenuList(from, services, salon, cartSummaryShort(sess && sess.cart), cat, pg));
      return;
    }
    // ── Ostranjevanje enokategorijskega menija: menupage_<stran> ──
    if (iId.startsWith('menupage_')) {
      const pg = parseInt(iId.slice(9)) || 0;
      await wa.send(phoneId, token, wa.deliveryMenuList(from, services, salon, cartSummaryShort(sess && sess.cart), null, pg));
      return;
    }
    // ── Izbrana kategorija → artikli te kategorije (ali cel meni kot besedilo) ──
    if (iId.startsWith('cat_')) {
      const cat = iId.slice(4);
      if (cat === 'ALL') {
        for (const m of wa.deliveryMenuText(from, services)) await wa.send(phoneId, token, m);
      } else {
        await wa.send(phoneId, token, wa.deliveryMenuList(from, services, salon, cartSummaryShort(sess && sess.cart), cat));
      }
      return;
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
      // AI paket: po izbiri z menija VEDNO deterministično vprašaj po količini.
      // (Prej je klic AI ob "2 pici" -> izbira izgubil količino in dodal 1.)
      if (['ai', 'premium'].includes(salon.subscription_plan)) {
        const pending = { id: svc.id, name: svc.name, price: svc.price || 0 };
        session.set(skey, { ...sess, step: 306, pendingItem: pending });
        await wa.send(phoneId, token, wa.textMsg(from,
          `Koliko *${svc.name}* želite? Če želite kakšno prilagoditev (npr. brez gob), kar pripišite.`
        ));
        return;
      }
      session.set(skey, { ...sess, step: 306, pendingItem: { id: svc.id, name: svc.name, price: svc.price || 0 } });
      await wa.send(phoneId, token, {
        messaging_product: 'whatsapp',
        to: from,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: `*${svc.name}*\n💰 ${svc.price || 0} €\n\nKoliko kosov?\n_(ali vpišite številko, npr. 5)_` },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'dqty_1', title: '1 kos' } },
              { type: 'reply', reply: { id: 'dqty_2', title: '2 kosa' } },
              { type: 'reply', reply: { id: 'dqty_3', title: '3 kosi' } }
            ]
          }
        }
      });
      return;
    }

    // ── Količina (gumb ali vpisana številka) → dodaj v košarico
    const addQtyToCart = async (qty) => {
      const item = sess.pendingItem;
      const cart = sess.cart || [];
      const existing = cart.find(c => String(c.id) === String(item.id));
      if (existing) existing.qty = (existing.qty || 1) + qty;
      else cart.push({ ...item, qty });
      session.set(skey, { ...sess, step: 301, cart, pendingItem: null });
      await wa.send(phoneId, token, wa.deliveryCartButtons(from, fmtCart(cart), cartTotal(cart)));
    };

    if (iId.startsWith('dqty_') && sess.pendingItem) {
      await addQtyToCart(parseInt(iId.replace('dqty_', '')) || 1);
      return;
    }

    if (sess.step === 306 && sess.pendingItem && msgText) {
      const isAiPlan = ['ai', 'premium'].includes(salon.subscription_plan);
      const qtyParsed = parseSloQty(msgText);
      // Posebnost (npr. "brez gob") prepustimo AI; sicer, če je podana količina
      // (tudi z dodatnimi besedami, npr. "dve kot sem prej napisal"), dodaj determinsitično.
      const hasNote = /(brez|extra|ekstra|dodatn|pikant|alergij|gluten|lakto)/i.test(msgText);
      const canAddDet = qtyParsed && qtyParsed.q >= 1 && (qtyParsed.clean || (isAiPlan && !hasNote));
      if (canAddDet) {
        const qty306 = qtyParsed.q;
        if (isAiPlan) {
          const item = sess.pendingItem;
          const cart = sess.cart || [];
          const ex = cart.find(c => String(c.id) === String(item.id) && !c.note);
          if (ex) ex.qty = (ex.qty || 1) + qty306;
          else cart.push({ ...item, qty: qty306 });
          session.set(skey, { ...sess, step: 301, cart, pendingItem: null });
          const feeNote = (parseFloat(salon.packaging_price || 0) > 0 || parseFloat(salon.delivery_fee || 0) > 0)
            ? ' _(embalaža in dostava se dodata ob zaključku)_' : '';
          await wa.send(phoneId, token, wa.textMsg(from,
            `*${item.name}* x${qty306} je v košarici.\n\nKošarica: ${cart.map(i => `${i.name} x${i.qty || 1}`).join(', ')} — artikli skupaj *${cartTotal(cart)} €*${feeNote}\n\nŽelite še kaj? Napišite *zaključi* ali izberite iz menija.`
          ));
        } else {
          await addQtyToCart(qty306);
        }
        return;
      }
      if (!isAiPlan) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Vnesite samo število kosov (npr. 2) ali izberite gumb.'));
        return;
      }
      // AI paket: odgovor s posebnostjo ("eno brez jajc") razume AI s kontekstom izbranega artikla
    }

    // ── Dodaj še → pokaži meni spet
    if (iId === 'delivery_add_more') {
      await wa.send(phoneId, token, wa.deliveryMenuList(from, services, salon, cartSummaryShort(sess && sess.cart)));
      return;
    }

    // ── Povzetek + vprašanje za opombo, glede na način (dostava/prevzem)
    const askNoteForMode = async (mode) => {
      const sessNow = session.get(skey);
      const cart = sessNow.cart || sess.cart || [];
      const packUnit = parseFloat(salon.packaging_price || 0);
      const kosov = cart.reduce((s, i) => s + (i.qty || 1), 0);
      const chargePack = mode === 'dostava' || salon.pickup_packaging !== false;
      const packFee = chargePack ? +(packUnit * kosov).toFixed(2) : 0;
      const delFee = mode === 'dostava' ? parseFloat(salon.delivery_fee || 0) : 0;
      const itemsTotal = parseFloat(cartTotal(cart));
      const grandTotal = (itemsTotal + packFee + delFee).toFixed(2);
      const priceBreakdown = [
        `💰 Artikli: ${itemsTotal.toFixed(2)} €`,
        ...(packFee > 0 ? [`📦 Embalaža: ${kosov} × ${packUnit.toFixed(2)} € = ${packFee.toFixed(2)} €`] : []),
        ...(delFee  > 0 ? [`🚗 Dostava:  ${delFee.toFixed(2)} €`]  : []),
        `──────────────`,
        `💵 *SKUPAJ: ${grandTotal} €*`,
      ].join('\n');
      const modeLabel = mode === 'prevzem' ? '🏃 Osebni prevzem' : '🚗 Dostava';
      if (['ai', 'premium'].includes(salon.subscription_plan)) {
        // AI paket: opomba je bila zbrana že med pogovorom ("brez gob") — ne sprašuj znova
        const aiNote = sessNow.opomba ? `\n📝 Opomba: ${sessNow.opomba}` : '';
        session.set(skey, { ...sess, ...sessNow, step: 303, orderMode: mode, grandTotal, packFee, delFee, opomba: sessNow.opomba || '' });
        await wa.send(phoneId, token, wa.textMsg(from,
          `🛒 *Vaše naročilo* (${modeLabel}):\n${fmtCart(cart)}${aiNote}\n\n${priceBreakdown}\n\n` + botMsg(salon, 'name_question')
        ));
        return;
      }
      session.set(skey, { ...sess, ...sessNow, step: 302, orderMode: mode, grandTotal, packFee, delFee });
      await wa.send(phoneId, token, wa.textMsg(from,
        `🛒 *Vaše naročilo* (${modeLabel}):\n${fmtCart(cart)}\n\n${priceBreakdown}\n\n` + botMsg(salon, 'note_question')
      ));
    };

    // ── Zaključi → izbira načina (ali direktno naprej, če je omogočen samo en)
    const startCheckout = async () => {
      const cur = session.get(skey);
      if (!cur.cart || !cur.cart.length) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Košarica je prazna. Izberite artikel:'));
        await wa.send(phoneId, token, wa.deliveryMenuList(from, services, salon, null));
        return;
      }
      const canDel  = salon.allow_delivery !== false;
      const canPick = salon.allow_pickup !== false;
      if (canDel && canPick) {
        session.set(skey, { ...cur, step: 307 });
        await wa.send(phoneId, token, {
          messaging_product: 'whatsapp', to: from, type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: botMsg(salon, 'mode_question') },
            action: {
              buttons: [
                { type: 'reply', reply: { id: 'dmode_dostava', title: '🚗 Dostava' } },
                { type: 'reply', reply: { id: 'dmode_prevzem', title: '🏃 Osebni prevzem' } }
              ]
            }
          }
        });
      } else {
        await askNoteForMode(canPick && !canDel ? 'prevzem' : 'dostava');
      }
    };
    if (iId === 'delivery_checkout') { await startCheckout(); return; }

    // Ime vračajoče se stranke (preveri enkrat na sejo; null = preverjeno, brez)
    const resolveKnownName = async () => {
      const cur = session.get(skey);
      if (cur.knownName !== undefined) return cur.knownName;
      let nm = null, at = null;
      try { const kc = await db.getLastCustomerByPhone(salon.id, from); if (kc) { nm = kc.name; at = kc.lastAt; } } catch (_e) {}
      session.set(skey, { ...session.get(skey), knownName: nm, knownLastAt: at });
      return nm;
    };

    // ── AI paket: deterministični tekoči trak zaključka (po vrsti, sproti shranjeno, VEDNO odda) ──
    const sendCheckoutSummary = async () => {
      const cur = session.get(skey);
      const cartS = cur.cart || [];
      const modeS = cur.orderMode === 'prevzem' ? 'prevzem' : 'dostava';
      const tot = computeTotals(salon, cartS, modeS);
      const lines = [
        'Vaše naročilo:',
        fmtCart(cartS),
        cur.opomba ? `Opomba: ${cur.opomba}` : null,
        '',
        `Artikli: ${tot.itemsTotal.toFixed(2)} €`,
        tot.packFee > 0 ? `Embalaža: ${tot.packFee.toFixed(2)} €` : null,
        tot.delFee > 0 ? `Dostava: ${tot.delFee.toFixed(2)} €` : null,
        `SKUPAJ: ${tot.grand} €`,
        '',
        modeS === 'dostava' ? `Dostava na: ${cur.deliveryAddress}` : `Osebni prevzem${salon.pickup_address ? ` — ${salon.pickup_address}` : ''}`,
        `Ime: ${cur.customerName}`,
        '',
        'Potrjujete naročilo? (da / ne)',
        '_Če ime ali naslov ni pravilen, napišite npr. „ime Janez Novak"._'
      ].filter(l => l !== null).join('\n');
      session.set(skey, { ...cur, checkoutStage: 'confirm', step: 305, grandTotal: tot.grand, packFee: tot.packFee, delFee: tot.delFee });
      await wa.send(phoneId, token, wa.textMsg(from, lines));
    };
    const aiSetModeDeterministic = async (mode) => {
      const cur = session.get(skey);
      const tot = computeTotals(salon, cur.cart || [], mode);
      const pickNote = mode === 'prevzem' && salon.pickup_address ? ` Prevzem bo na naslovu ${salon.pickup_address}.` : '';
      const known = cur.customerName || await resolveKnownName();
      session.set(skey, { ...session.get(skey), orderMode: mode, customerName: known || null, grandTotal: tot.grand, packFee: tot.packFee, delFee: tot.delFee });
      const head = `${mode === 'dostava' ? 'Dostava.' : 'Osebni prevzem.'}${pickNote} ${tot.text}`;
      if (known) {
        // Ime že poznamo — ne sprašuj znova, nadaljuj na naslov/povzetek
        await wa.send(phoneId, token, wa.textMsg(from, head));
        await promptForStage(session.get(skey));
      } else {
        session.set(skey, { ...session.get(skey), checkoutStage: 'name' });
        await wa.send(phoneId, token, wa.textMsg(from, `${head}\n\nProsim, napišite vaše ime in priimek.`));
      }
    };
    const startAiCheckout = async () => {
      const cur = session.get(skey);
      if (!(cur.cart || []).length) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Košarica je še prazna — povejte, kaj si želite, ali napišite "meni".'));
        return;
      }
      const canDel = salon.allow_delivery !== false;
      const canPick = salon.allow_pickup !== false;
      if (canDel && canPick) {
        session.set(skey, { ...cur, checkoutStage: 'mode' });
        await wa.send(phoneId, token, wa.textMsg(from, 'Odlično! Dostava ali osebni prevzem?'));
      } else {
        await aiSetModeDeterministic(canDel ? 'dostava' : 'prevzem');
      }
    };

    // Determinističen zaključek: pošlji vprašanje za PRVI manjkajoči korak (nikoli AI).
    const promptForStage = async (cur) => {
      if (!(cur.cart || []).length) { await wa.send(phoneId, token, wa.textMsg(from, 'Košarica je prazna.')); return; }
      if (!cur.orderMode) { await startAiCheckout(); return; }
      if (!cur.customerName) {
        const known = await resolveKnownName();
        if (known) {
          cur = { ...cur, customerName: known };
          session.set(skey, cur);
        } else {
          session.set(skey, { ...cur, checkoutStage: 'name' });
          await wa.send(phoneId, token, wa.textMsg(from, 'Prosim, napišite vaše ime in priimek.'));
          return;
        }
      }
      if (cur.orderMode === 'dostava' && !cur.deliveryAddress) {
        session.set(skey, { ...cur, checkoutStage: 'address' });
        const areaN = salon.delivery_area ? `\nDostavljamo: ${salon.delivery_area}` : '';
        await wa.send(phoneId, token, wa.textMsg(from, `Prosim, napišite naslov za dostavo.${areaN}`));
        return;
      }
      await sendCheckoutSummary();
    };

    // ── Izbran način prevzema
    if (iId === 'dmode_dostava' || iId === 'dmode_prevzem') {
      if (!sess.cart || !sess.cart.length) {
        session.clear(skey);
        await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Začnite znova.'));
        return;
      }
      await askNoteForMode(iId === 'dmode_prevzem' ? 'prevzem' : 'dostava');
      return;
    }

    // ── Step 302: opomba → vpraša ime
    if (sess && sess.step === 302 && msgText) {
      const opomba = msgText.trim().toUpperCase() === 'NE' ? '' : msgText.trim();
      session.set(skey, { ...sess, step: 303, opomba });
      await wa.send(phoneId, token, wa.textMsg(from, botMsg(salon, 'name_question')));
      return;
    }

    // ── Step 303: ime → vpraša naslov
    if (sess && sess.step === 303 && msgText) {
      const customerName = msgText.trim();
      if (sess.orderMode === 'prevzem') {
        // Osebni prevzem: brez naslova, direktno na potrditev
        const cart = sess.cart || [];
        const opombaTxt = sess.opomba ? `\n📝 Opomba: ${sess.opomba}` : '';
        const pFee = parseFloat(sess.packFee || 0);
        const iTotal = parseFloat(cartTotal(cart));
        const gTotal = sess.grandTotal || (iTotal + pFee).toFixed(2);
        const kosovP = cart.reduce((sm, i) => sm + (i.qty || 1), 0);
        const pUnit = parseFloat(salon.packaging_price || 0);
        const breakdownTxt = [
          fmtCart(cart) + opombaTxt,
          '',
          `💰 Artikli: ${iTotal.toFixed(2)} €`,
          ...(pFee > 0 ? [`📦 Embalaža: ${kosovP} × ${pUnit.toFixed(2)} € = ${pFee.toFixed(2)} €`] : []),
        ].join('\n');
        const pickupLabel = '🏃 Osebni prevzem' + (salon.pickup_address ? ` — ${salon.pickup_address}` : '');
        session.set(skey, { ...sess, step: 305, customerName, deliveryAddress: '', grandTotal: gTotal, packFee: pFee, delFee: 0 });
        await wa.send(phoneId, token, wa.deliveryConfirmButtons(from, breakdownTxt, pickupLabel, gTotal));
        return;
      }
      session.set(skey, { ...sess, step: 304, customerName });
      const areaNote = salon.delivery_area ? `\n🚗 Dostavljamo: ${salon.delivery_area}` : '';
      await wa.send(phoneId, token, wa.textMsg(from, botMsg(salon, 'address_question') + areaNote));
      return;
    }

    // ── Step 304: naslov → pokaži potrditev
    if (sess && sess.step === 304 && msgText) {
      const address = msgText.trim();
      const cart = sess.cart || [];
      const opombaTxt = sess.opomba ? `\n📝 Opomba: ${sess.opomba}` : '';
      const sessF = session.get(skey);
      const pUnit = parseFloat(salon.packaging_price || 0);
      const kosovS = cart.reduce((sm, i) => sm + (i.qty || 1), 0);
      const pFee = sessF.packFee !== undefined ? parseFloat(sessF.packFee) : +(pUnit * kosovS).toFixed(2);
      const dFee = sessF.delFee  !== undefined ? parseFloat(sessF.delFee)  : parseFloat(salon.delivery_fee || 0);
      const iTotal = parseFloat(cartTotal(cart));
      const gTotal = (iTotal + pFee + dFee).toFixed(2);
      const breakdownTxt = [
        fmtCart(cart) + opombaTxt,
        '',
        `💰 Artikli: ${iTotal.toFixed(2)} €`,
        ...(pFee > 0 ? [`📦 Embalaža: ${kosovS} × ${pUnit.toFixed(2)} € = ${pFee.toFixed(2)} €`] : []),
        ...(dFee > 0 ? [`🚗 Dostava:  ${dFee.toFixed(2)} €`]  : []),
      ].join('\n');
      session.set(skey, { ...sessF, step: 305, deliveryAddress: address, grandTotal: gTotal, packFee: pFee, delFee: dFee });
      await wa.send(phoneId, token, wa.deliveryConfirmButtons(
        from,
        breakdownTxt,
        address,
        gTotal
      ));
      return;
    }

    // ── Potrdi naročilo (skupno za gumb in AI potrditev) ──
    const finalizeOrder = async () => {
      const s = session.get(skey);
      const cart = s.cart || [];
      if (!cart.length || (!s.deliveryAddress && s.orderMode !== 'prevzem')) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Začnite znova.'));
        session.clear(skey);
        return;
      }
      const isPickup = s.orderMode === 'prevzem';
      const total = s.grandTotal || cartTotal(cart);
      const today = t.todayStr();
      const custName = s.customerName || from;
      const opomba  = s.opomba || '';
      const bookingData = {
        customer_phone: from,
        customer_name:  custName,
        salon_id:       salon.id,
        booking_date:   today,
        booking_time:   t.nowTimeHMS(),
        status:         'pending',
        notes:          `${isPickup ? 'PREVZEM | Osebni prevzem' : 'RAZVOZ | Naslov: ' + s.deliveryAddress} | Skupaj: ${s.grandTotal || total} €${opomba ? ' | Opomba: ' + opomba : ''}`,
        form_answers:   JSON.stringify({
          nacin:     isPickup ? 'Osebni prevzem 🏃' : 'Dostava 🚗',
          ime:       custName,
          naslov:    isPickup ? 'Osebni prevzem' : s.deliveryAddress,
          narocilo:  fmtCart(cart),
          opomba:    opomba,
          artikli:   cartTotal(cart) + ' €',
          embalaza:  s.packFee > 0 ? s.packFee.toFixed(2) + ' €' : null,
          dostava:   s.delFee  > 0 ? s.delFee.toFixed(2)  + ' €' : null,
          skupaj:    (s.grandTotal || total) + ' €'
        })
      };
      const booking = await db.createBooking(bookingData);
      const ref6 = (booking.id || '').slice(-6).toUpperCase();
      // Shrani posamezne artikle v sb_order_items
      if (booking.id) {
        const cartWithCategory = cart.map(item => {
          const svc = services.find(s => s.id === item.id);
          return { ...item, quantity: item.qty || 1, category: svc?.category || 'Ostalo' };
        });
        db.createOrderItems(booking.id, salon.id, cartWithCategory).catch(e =>
          console.error('[order_items] save error:', e.message)
        );
      }
      session.clear(skey);
      // Po oddaji naročila NE ponujamo preklica (da ni zmede v gostilni po pripravi).
      await wa.send(phoneId, token, wa.textMsg(from,
        botMsg(salon, isPickup ? 'submitted_pickup' : 'submitted_delivery', { ime: custName, ref: ref6 })
      ));
      // Namenoma BREZ obvestila restavraciji — naročila spremljajo na dashboardu
      // (pri več sto naročilih na dan bi bil WhatsApp/email spam).
    };
    if (iId === 'delivery_confirm') { await finalizeOrder(); return; }

    // ── Stranka napiše "prekliči" ──
    if ((iId === 'cancel_request') || (msgText && !iId && /^\s*(prekli[čc]\w*|storno|cancel)\b/i.test(msgText))) {
      // Med naročanjem (košarica/zaključek še v teku): prekliči sejo.
      if ((sess && sess.step >= 301 && sess.step <= 307) || sess.checkoutStage || (sess.cart && sess.cart.length)) {
        session.clear(skey);
        await wa.send(phoneId, token, wa.textMsg(from, 'V redu, naročanje je preklicano. Pišite nam, ko boste spet lačni! 🍕'));
        return;
      }
      // Po ODDANEM naročilu preklic ni več mogoč (da ni zmede v gostilni).
      await wa.send(phoneId, token, wa.textMsg(from,
        'Naročilo je že oddano in ga ni več mogoče preklicati prek klepeta. Če je prišlo do napake, nas prosim pokličite.'));
      return;
    }
    if (iId === 'cancel_yes' && sess.cancelBookingId) {
      await db.updateBookingStatus(sess.cancelBookingId, 'cancelled');
      const refC = sess.cancelRef || '';
      session.clear(skey);
      await wa.send(phoneId, token, wa.textMsg(from, `✅ Naročilo *#${refC}* je preklicano. Se vidimo naslednjič! 👋`));
      return;
    }
    if (iId === 'cancel_no') {
      session.set(skey, { ...sess, cancelBookingId: null, cancelRef: null });
      await wa.send(phoneId, token, wa.textMsg(from, '👍 Naročilo ostaja v veljavi.'));
      return;
    }

    // ── Prekliči
    if (iId === 'delivery_cancel') {
      session.clear(skey);
      await wa.send(phoneId, token, wa.textMsg(from, 'Naročilo preklicano. Dobrodošli nazaj! 🍕'));
      return;
    }

    // ── "zaključi" gre direktno v zaključek (brez AI ovinka) ──
    if (msgText && !iId && /^\s*zaklju[čc]i?\b/i.test(msgText) && (sess.cart || []).length) {
      if (['ai', 'premium'].includes(salon.subscription_plan)) { await startAiCheckout(); } else { await startCheckout(); }
      return;
    }

    // ── AI paket: odgovor s količino USKLADI zadnje dodani artikel (ne prišteje znova) ──
    if (msgText && !iId && ['ai', 'premium'].includes(salon.subscription_plan) && !sess.pendingItem && !sess.checkoutStage
        && sess.lastAdded && sess.lastAdded.length === 1 && (sess.cart || []).length) {
      const qp = parseSloQty(msgText);
      if (qp && qp.clean) {
        const cur = session.get(skey);
        const la = sess.lastAdded[0];
        const line = (cur.cart || []).find(c => String(c.id) === String(la.id) && (c.note || null) === (la.note || null));
        if (line) {
          line.qty = qp.q; // nastavi TOČNO količino (ne +)
          session.set(skey, { ...cur, cart: cur.cart, lastAdded: null });
          const feeN = (parseFloat(salon.packaging_price || 0) > 0 || parseFloat(salon.delivery_fee || 0) > 0)
            ? ' _(embalaža in dostava se dodata ob zaključku)_' : '';
          await wa.send(phoneId, token, wa.textMsg(from,
            `*${line.name}${line.note ? ` (${line.note})` : ''}* x${qp.q} je v košarici.\n\nKošarica: ${cur.cart.map(i => `${i.name} x${i.qty || 1}`).join(', ')} — artikli skupaj *${cartTotal(cur.cart)} €*${feeN}\n\nŽelite še kaj? Napišite *zaključi* ali izberite iz menija.`
          ));
          return;
        }
      }
    }

    // ── AI paket: "ne / to je vse" na 'Želite še kaj?' = začni zaključek (deterministično) ──
    if (msgText && !iId && ['ai', 'premium'].includes(salon.subscription_plan) && (sess.cart || []).length
        && !sess.checkoutStage && !sess.pendingItem
        && /^\s*(ne|ne,?\s*hvala|nič več|nic vec|to je vse|to bo vse|dovolj|nič drugega|nic drugega|nak)\s*[.!]?\s*$/i.test(msgText)) {
      await startAiCheckout();
      return;
    }

    // ── AI paket: "en tiramisu" z artiklom v košarici = POPRAVEK količine; "še en" = dodatek ──
    if (msgText && !iId && ['ai', 'premium'].includes(salon.subscription_plan) && !sess.pendingItem && !sess.checkoutStage) {
      const qp2 = parseSloQty(msgText);
      if (qp2 && !qp2.clean) {
        const leftoverTxt = (' ' + msgText.toLowerCase() + ' ')
          .replace(/\d+/g, ' ')
          .replace(/\s(deset|devet|osem|sedem|šest|sest|pet|štiri|stiri|trikrat|tri|dvakrat|dve|dva|enkrat|enega|eno|ene|ena|en)(?=[\s,.!?])/g, ' ')
          .replace(/\s(kosov|kosa|kose|kosek|kos|x|krat|komad\w*|prosim|samo|pa|in|hvala|lepo|bi|bom|vzel|vzela|dajte|daj|mi|še|se|zraven|plus|dodaj|dodajte|želim|zelim|želel|zelel|naročiti|narociti|naročil|narocil|naročam|narocam|rad|rada)(?=[\s,.!?])/g, ' ')
          .replace(/[,.!?]/g, ' ')
          .trim();
        const svcHit = leftoverTxt ? findService(services, leftoverTxt) : null;
        const cur = session.get(skey);
        const cart2 = cur.cart || [];
        const line2 = svcHit ? cart2.find(c => String(c.id) === String(svcHit.id) && !c.note) : null;
        // Popravek količine SAMO za artikel, ki je že v košarici. Nov artikel prepustimo
        // AI natakarju, da naravno vpraša po količini in posebnostih.
        if (svcHit && line2) {
          const wantsMore = /(^|\s)(še|se|dodaj|dodajte|zraven|plus)(?=[\s,.!?]|$)/i.test(msgText.toLowerCase());
          if (wantsMore) line2.qty = (line2.qty || 1) + qp2.q; // "še en" -> +1
          else line2.qty = qp2.q;                              // popravek količine -> točno
          session.set(skey, { ...cur, step: 301, cart: cart2, lastAdded: [{ id: svcHit.id, note: null }] });
          const feeN2 = (parseFloat(salon.packaging_price || 0) > 0 || parseFloat(salon.delivery_fee || 0) > 0)
            ? ' _(embalaža in dostava se dodata ob zaključku)_' : '';
          await wa.send(phoneId, token, wa.textMsg(from,
            `Košarica: ${cart2.map(i => `${i.name}${i.note ? ` (${i.note})` : ''} x${i.qty || 1}`).join(', ')} — artikli skupaj *${cartTotal(cart2)} €*${feeN2}\n\nŽelite še kaj? Napišite *zaključi* ali izberite iz menija.`
          ));
          return;
        }
      }
    }

    // ── AI paket: zahteva za meni = interaktivni seznam; če omeni kategorijo (npr. "meni samo pic") -> samo ta kategorija ──
    if (msgText && !iId && ['ai', 'premium'].includes(salon.subscription_plan) && !sess.checkoutStage && msgText.length < 60
        && /(^|\s)(meni|menij|jedilnik|ponudb\w*|cenik)\b/i.test(msgText)
        && !/(ime|priimek)/i.test(msgText)) {
      const curM = session.get(skey);
      const norm = x => String(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const catList = [...new Set(services.map(s => s.category || 'Ostalo'))];
      const stop = ['meni', 'menij', 'jedilnik', 'ponudba', 'ponudbo', 'cenik', 'samo', 'daj', 'pokazi', 'zelim', 'imate', 'prosim'];
      const mWords = norm(msgText).split(/\s+/).filter(w => w.length >= 3 && !stop.includes(w));
      const matchedCat = catList.find(c => { const cn = norm(c); return mWords.some(w => cn.startsWith(w.slice(0, 4)) || w.startsWith(cn.slice(0, 4))); });
      const menuSalonM = { ...salon, greeting_message: matchedCat ? matchedCat + ':' : 'Izvolite meni:' };
      await wa.send(phoneId, token, wa.deliveryMenuList(from, services, menuSalonM, cartSummaryShort(curM.cart), matchedCat || undefined));
      return;
    }

    // ── AI paket: pritrdilen odgovor PRED košarico = pokaži meni (deterministično, brez AI ugibanja) ──
    if (msgText && !iId && ['ai', 'premium'].includes(salon.subscription_plan) && !(sess.cart || []).length && !sess.checkoutStage && !sess.pendingItem
        && msgText.trim().length <= 15 && !findService(services, msgText)
        && /^\s*(da|ja|jaa|seveda|lahko|prosim|ok|okej|velja|zelim|želim|hočem|hocem|bi|itak)\b/i.test(msgText.trim())) {
      const cancelHint = sess.hintShown ? '' : '\n_Naročilo lahko kadar koli prekličete tako, da napišete *prekliči*._';
      const areaPrefix = (salon.delivery_area && !sess.areaShown) ? `Samo da vas obvestimo — dostavljamo po ${salon.delivery_area}.` : '';
      const areaMsg = [areaPrefix, cancelHint ? cancelHint.trim() : '', 'Izvolite meni:'].filter(Boolean).join('\n\n').trim() || 'Izvolite meni:';
      const hist0 = sess.aiHistory || [];
      session.set(skey, { ...sess, step: 300, hintShown: true, areaShown: true, aiHistory: [...hist0, { role: 'user', content: msgText }, { role: 'assistant', content: areaMsg }].slice(-60) });
      const menuSalon0 = { ...salon, greeting_message: areaMsg };
      await wa.send(phoneId, token, wa.deliveryMenuList(from, services, menuSalon0, null));
      return;
    }

    // ── Zaključek (enolastniški tekoči trak): ko je checkout aktiven, vodi SAMO ta ──
    //    determinističen trak. AI se med zaključkom NE kliče -> ni dvojnih povzetkov ──
    //    ne podvojenih vprašanj. Vsak korak vedno odgovori (return). ──
    if (msgText && !iId && ['ai', 'premium'].includes(salon.subscription_plan) && sess.checkoutStage && (sess.cart || []).length) {
      const stage = sess.checkoutStage;
      const canDel = salon.allow_delivery !== false;
      const canPick = salon.allow_pickup !== false;
      if (stage === 'mode') {
        const mLow = msgText.toLowerCase();
        if (canDel && /dostav|na dom|prinesite|pošljite|poslite|dostavite/.test(mLow)) { await aiSetModeDeterministic('dostava'); return; }
        if (canPick && /prevzem|osebn|pridem|sam bom|sama bom|pickup|take ?away|v lokalu|pri vas|k vam/.test(mLow)) { await aiSetModeDeterministic('prevzem'); return; }
        const modes = [canDel ? 'dostava' : null, canPick ? 'osebni prevzem' : null].filter(Boolean).join(' ali ');
        await wa.send(phoneId, token, wa.textMsg(from, `Prosim, izberite: ${modes}?`));
        return;
      }
      if (stage === 'name') {
        const nm = msgText.trim();
        const nameOk = /^[A-Za-zŠŽČĆĐšžčćđ][A-Za-zŠŽČĆĐšžčćđ .'-]{1,50}$/.test(nm)
          && nm.split(/\s+/).length <= 4
          && !/^(da|ja|ne|ok|okej|meni|hvala|zaključi|zakljuci|prekliči|preklici|dostava|prevzem|še|se|dodaj|eno|ena|en|dve|tri|štiri|stiri|pet|brez)(?=[\s,.!?]|$)/i.test(nm);
        if (nameOk) {
          const cur = session.get(skey);
          if (cur.orderMode === 'dostava' && !cur.deliveryAddress) {
            session.set(skey, { ...cur, customerName: nm, checkoutStage: 'address' });
            const areaN = salon.delivery_area ? `\nDostavljamo: ${salon.delivery_area}` : '';
            await wa.send(phoneId, token, wa.textMsg(from, `Hvala. Prosim, napišite naslov za dostavo.${areaN}`));
          } else {
            session.set(skey, { ...cur, customerName: nm });
            await sendCheckoutSummary();
          }
          return;
        }
        await wa.send(phoneId, token, wa.textMsg(from, 'Prosim, napišite vaše ime in priimek.'));
        return;
      }
      if (stage === 'address') {
        const ad = msgText.trim();
        if (ad.length >= 3 && !/^\s*(da|ja|ne|ok|okej|meni|zaključi|zakljuci|prekli)/i.test(ad)) {
          session.set(skey, { ...session.get(skey), deliveryAddress: ad });
          await sendCheckoutSummary();
          return;
        }
        await wa.send(phoneId, token, wa.textMsg(from, 'Prosim, napišite naslov za dostavo (ulica in hišna številka).'));
        return;
      }
      if (stage === 'confirm') {
        if (/^\s*(da|ja|jaa|aha|mhm|yes|lahko|potrjujem|potrdim|potrdi|seveda|ok|okej|velja|dajmo|oddaj|oddajte|naroči|naročam|pošlji|drži|tako je)\b/i.test(msgText)) {
          const totF = computeTotals(salon, sess.cart, sess.orderMode);
          session.set(skey, { ...session.get(skey), step: 305, grandTotal: totF.grand, packFee: totF.packFee, delFee: totF.delFee });
          await finalizeOrder();
          return;
        }
        if (/^\s*(ne|prekli)/i.test(msgText)) {
          // umik iz zaključka -> stranka lahko spet spreminja košarico
          session.set(skey, { ...session.get(skey), checkoutStage: null, step: 301 });
          await wa.send(phoneId, token, wa.textMsg(from, 'V redu. Povejte, kaj želite spremeniti (artikle, način, ime ali naslov), ali napišite zaključi za ponoven zaključek.'));
          return;
        }
        // ── Popravek IMENA med potrditvijo (npr. "ime Zlata Ukota", "nisem Joc ampak Zlata Ukota") ──
        const _corrName = (function(txt){
          const m = txt.match(/(?:ime(?:\s+je|:)?|jaz\s+sem|se\s+pi[šs]em|pi[šs]em\s+se|kli[čc]em\s+se|moje\s+ime\s+je)\s+([A-Za-zŠŽČĆĐšžčćđ][A-Za-zŠŽČĆĐšžčćđ .'-]{1,50})/i)
                 || txt.match(/nisem\b.*?\b(?:ampak|temve[čc]|marve[čc])\s+([A-Za-zŠŽČĆĐšžčćđ][A-Za-zŠŽČĆĐšžčćđ .'-]{1,50})/i);
          if (m) { const nm = m[1].trim().replace(/[.,!?]+$/, ''); if (nm.split(/\s+/).length <= 4) return nm; }
          return null;
        })(msgText);
        if (_corrName) {
          session.set(skey, { ...session.get(skey), customerName: _corrName });
          await wa.send(phoneId, token, wa.textMsg(from, `V redu, popravil sem ime na *${_corrName}*.`));
          await sendCheckoutSummary();
          return;
        }
        if (/(poprav|napa[čc]n|zamenja|spremeni|drug)\w*.*\b(ime|priimek)\b/i.test(msgText) || /\bime\b[^]{0,15}\b(ni|napa[čc])/i.test(msgText)) {
          session.set(skey, { ...session.get(skey), checkoutStage: 'name', customerName: null });
          await wa.send(phoneId, token, wa.textMsg(from, 'Prosim, napišite pravo ime in priimek.'));
          return;
        }
        // ── Popravek NASLOVA med potrditvijo (samo dostava) ──
        if (session.get(skey).orderMode === 'dostava') {
          const mA = msgText.match(/(?:naslov(?:\s+je|:)?|dostavi(?:te)?\s+na|na\s+naslov)\s+(.{3,})/i);
          if (mA) {
            session.set(skey, { ...session.get(skey), deliveryAddress: mA[1].trim().replace(/[.!?]+$/, '') });
            await sendCheckoutSummary();
            return;
          }
        }
        await wa.send(phoneId, token, wa.textMsg(from, 'Potrjujete naročilo? (da / ne)\n_Za popravek napišite npr. „ime Janez Novak" ali „naslov Ulica 1"._'));
        return;
      }
    }

    // ── AI paket: pritrdilen odgovor ob popolnih podatkih VEDNO odda naročilo ──
    if (msgText && !iId && ['ai', 'premium'].includes(salon.subscription_plan)
        && /^\s*(da|ja|jaa|aha|mhm|yes|lahko|potrjujem|potrdim|potrdi|seveda|ok|okej|velja|dajmo|oddaj|oddajte|naroči|naročam|pošlji)\b/i.test(msgText)
        && (sess.cart || []).length && sess.orderMode && sess.customerName
        && (sess.orderMode !== 'dostava' || sess.deliveryAddress)) {
      const totF = computeTotals(salon, sess.cart, sess.orderMode);
      session.set(skey, { ...sess, step: 305, grandTotal: totF.grand, packFee: totF.packFee, delFee: totF.delFee });
      await finalizeOrder();
      return;
    }

    // ── AI natakar (paket AI): prosto besedilo razume in upravlja košarico ──
    if (msgText && !iId && ['ai', 'premium'].includes(salon.subscription_plan) && aiConfigured()) {
      // Fair-use: meja na lokal (ai_monthly_limit, npr. Enterprise 10000) ali privzeta iz env
      const fuMonth = t.todayStr().slice(0, 7);
      if (sess.aiAllowed === undefined || sess.aiAllowedMonth !== fuMonth) {
        const fuLimit = (parseInt(salon.ai_monthly_limit) > 0)
          ? parseInt(salon.ai_monthly_limit)
          : (parseInt(process.env.AI_FAIR_USE_LIMIT) || 1500);
        const cnt = await db.getMonthlyOrderCount(salon.id).catch(() => 0);
        sess.aiAllowed = cnt < fuLimit;
        if (!sess.aiAllowed) notifyFairUse(salon, cnt, fuLimit).catch(e => console.error('[fair-use]', e.message));
        sess.aiAllowedMonth = fuMonth;
        session.set(skey, { ...session.get(skey), aiAllowed: sess.aiAllowed, aiAllowedMonth: fuMonth });
      }
      if (sess.aiAllowed) try {
        const history = sess.aiHistory || [];
        // Prepoznaj vračajočo se stranko (enkrat na sejo)
        if (sess.knownName === undefined) {
          const kc = await db.getLastCustomerByPhone(salon.id, from).catch(() => null);
          sess.knownName = kc ? kc.name : null;
          sess.knownLastAt = kc ? kc.lastAt : null;
          session.set(skey, { ...session.get(skey), knownName: sess.knownName, knownLastAt: sess.knownLastAt });
        }
        const result = await askOrderAI({
          message: msgText, salon, services,
          cart: sess.cart || [], history, phone: from,
          pendingItem: sess.pendingItem || null,
          order: { mode: sess.orderMode || null, name: sess.customerName || null, address: sess.deliveryAddress || null },
          note: sess.opomba || '',
          knownName: sess.knownName || null, lastOrderAt: sess.knownLastAt || null
        });
        // Ob PRVEM stiku pošlji lepo dobrodošlico (ime, dostava/prevzem, delovni čas, preklic).
        const isFirstTurn = (sess.aiHistory || []).length === 0;
        if (isFirstTurn && !sess.hintShown) {
          const welcome = wa.deliveryWelcome(salon, sess.knownName);
          // Če je stranka že kaj naročila, obdrži AI odgovor + dobrodošlico spredaj;
          // sicer dobrodošlica nadomesti pozdrav AI (da se ne podvaja).
          result.reply = (result.cart && result.cart.length)
            ? welcome + (result.reply ? '\n\n' + result.reply : '')
            : welcome;
        }
        const newHistory = [...history,
          { role: 'user', content: msgText },
          { role: 'assistant', content: result.reply || 'V redu.' }
        ].slice(-60);
        const mergedNote = result.note ? [sess.opomba, result.note].filter(Boolean).join('; ') : (sess.opomba || '');
        const ord = result.order || {};
        session.set(skey, {
          ...sess, step: result.cart.length ? 301 : (sess.step || 300),
          hintShown: sess.hintShown || isFirstTurn,
          cart: result.cart, aiHistory: newHistory, pendingItem: null, opomba: mergedNote,
          orderMode: ord.mode || sess.orderMode || null,
          customerName: ord.name || sess.customerName || null,
          deliveryAddress: ord.address || sess.deliveryAddress || null
        });
        // zapomni si dodano v tej rundi (uskladitev količine) + če je vprašal "koliko" brez dodajanja, nastavi čakajoči artikel
        {
          const stAdd = session.get(skey);
          let pendingFromAsk = null;
          if ((!result.added || !result.added.length) && result.reply && /koliko/i.test(result.reply)) {
            const askedSvc = findService(services, msgText);
            if (askedSvc) pendingFromAsk = { id: askedSvc.id, name: askedSvc.name, price: askedSvc.price || 0 };
          }
          session.set(skey, {
            ...stAdd,
            lastAdded: (result.added && result.added.length) ? result.added : null,
            ...(pendingFromAsk ? { pendingItem: pendingFromAsk, step: 306 } : {})
          });
        }
        // Zaključek je izključno determinističen: če je AI zaznal namero zaključka
        // (orodje checkout), preda krmilo traku (promptForStage). AI med zaključkom ne govori.
        {
          const stHand = session.get(skey);
          if (result.checkoutStarted || stHand.checkoutStage) {
            await promptForStage(stHand);
            return;
          }
        }
        let sentSomething = false;
        if (result.reply === '(dejanje)' || result.reply === 'V redu.') result.reply = '';
        if (result.reply) {
          await wa.send(phoneId, token, wa.textMsg(from, result.reply));
          sentSomething = true;
        }
        if (result.action === 'show_menu') {
          // AI je pozdravil sam — telo menija brez pozdravnega sporočila lokala
          const menuSalon = { ...salon, greeting_message: 'Izberite artikel iz menija:' };
          await wa.send(phoneId, token, wa.deliveryMenuList(from, services, menuSalon, cartSummaryShort(result.cart)));
          sentSomething = true;
        } else if (!result.action && result.reply && /(izvoli|tukaj je|pošiljam|posiljam|prilagam|na voljo je|naš men|nas men)/i.test(result.reply) && /meni|jedilnik|ponudb/i.test(result.reply)) {
          // Varovalka: AI je "obljubil" meni, a ni poklical orodja -> pošljemo ga mi
          const menuSalonF = { ...salon, greeting_message: 'Izvolite meni:' };
          await wa.send(phoneId, token, wa.deliveryMenuList(from, services, menuSalonF, cartSummaryShort(result.cart)));
          sentSomething = true;
        } else if (result.action === 'show_cart' && result.cart.length && !result.reply) {
          await wa.send(phoneId, token, wa.deliveryCartButtons(from, fmtCart(result.cart), cartTotal(result.cart)));
          sentSomething = true;
        }
        // GARANTIRAN ODGOVOR: nikoli mrtve tišine — in vsak tak primer se zabeleži za pregled
        if (!sentSomething) {
          const curG = session.get(skey);
          db.logAiMiss(salon.id, from, msgText, curG.checkoutStage || `step:${curG.step || 0}`,
            `cart:${(curG.cart || []).length} mode:${curG.orderMode || '-'} ime:${curG.customerName ? 'da' : '-'}`
          ).catch(() => {});
          if ((curG.cart || []).length) {
            await wa.send(phoneId, token, wa.deliveryCartButtons(from, fmtCart(curG.cart), cartTotal(curG.cart)));
          } else {
            await wa.send(phoneId, token, wa.textMsg(from, 'Oprostite, tega nisem najbolje razumel. Mi lahko poveste še enkrat? Z veseljem pomagam z naročilom.'));
          }
        }
        return;
      } catch (e) {
        const aiDetail = e.response?.data?.error?.message || (e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : null);
        console.error('[AI natakar] error:', e.message, aiDetail || '');
        db.logError(salon.id, 'ai_order', e.message, aiDetail, from).catch(() => {});
        // OHRANI sejo — stranki ne pošiljamo ničesar (retry logika je v ai-order.js)
        return;
      }
      // če fair-use presežen: pade skozi na klasični gumbni potek (nič se ne pokvari)
    }

    // ── Default: pozdrav + meni (samo za nova sporocila brez seje)
    if (!sess || !sess.step || sess.step === 0) {
      session.set(skey, { step: 300, cart: [] });
      await wa.send(phoneId, token, wa.deliveryMenuList(from, services, salon, null));
    }
    return;
  }



  const sess = session.get(skey);
  const services = await db.getServices(salon.id);

  // ══════════════════════════════════════════════════════
  // POS ORDER BOT FLOW (booking_mode = 'pos_order')
  // Integrates with Poster POS, Square, iiko
  // Does NOT touch existing booking/delivery flow
  // ══════════════════════════════════════════════════════
  if (salon.booking_mode === 'pos_order') {
    if (!salon.pos_type || !salon.pos_token) {
      await wa.send(phoneId, token, wa.textMsg(from,
        'POS sistem ni nastavljen. Prosimo, kontaktirajte skrbnika.'
      ));
      return;
    }

    const adapter = getAdapter(salon.pos_type);
    const posToken   = salon.pos_token;
    const posAccount = salon.pos_account || '';
    const posSpotId  = salon.pos_spot_id || 1;

    const sess = session.get(skey) || {};

    // Helper: format cart for display
    function fmtPosCart(cart) {
      return cart.map(i => `• ${i.name} x${i.qty} — ${(i.price * i.qty).toFixed(2)} €`).join('\n');
    }
    function posCartTotal(cart) {
      return cart.reduce((s, i) => s + i.price * i.qty, 0).toFixed(2);
    }

    // ── Step 0: fetch menu + show categories or item list ──
    // Triggered on: first message OR iId === 'pos_start' OR iId === 'pos_menu'
    const isStart = !sess.posStep || iId === 'pos_start' || iId === 'pos_menu';

    if (isStart && !iId.startsWith('pos_item_') && !iId.startsWith('pos_qty_')
        && iId !== 'pos_cart_more' && iId !== 'pos_checkout' && iId !== 'pos_confirm'
        && iId !== 'pos_cancel' && sess.posStep !== 'comment' && sess.posStep !== 'table') {

      try {
        const menu = await adapter.getMenu(posToken, posAccount);
        if (!menu.length) {
          await wa.send(phoneId, token, wa.textMsg(from, 'Meni je trenutno prazen. Poskusite kasneje.'));
          return;
        }

        // Group by category
        const cats = {};
        for (const item of menu) {
          if (!cats[item.category]) cats[item.category] = [];
          cats[item.category].push(item);
        }
        const catNames = Object.keys(cats);

        // Cache menu in session
        session.set(skey, { posStep: 'category', cart: sess.cart || [], posMenu: menu, posCats: cats });

        // Build WhatsApp list sections (max 10 items per section, max 10 sections)
        const sections = catNames.slice(0, 10).map(cat => ({
          title: cat,
          rows: cats[cat].slice(0, 10).map(item => ({
            id:          `pos_item_${item.id}`,
            title:       item.name.slice(0, 24),
            description: `${item.price.toFixed(2)} €${item.description ? ' — ' + item.description.slice(0, 50) : ''}`,
          }))
        }));

        const cartSum = sess.cart && sess.cart.length
          ? `\n🛒 Košarica: ${sess.cart.length} artiklov | ${posCartTotal(sess.cart || [])} €`
          : '';
        const greeting = salon.greeting_message
          ? salon.greeting_message + '\n\n'
          : `Dobrodošli v *${salon.name}*! 🍽️\n\n`;

        await wa.send(phoneId, token, {
          messaging_product: 'whatsapp',
          to: from,
          type: 'interactive',
          interactive: {
            type: 'list',
            header: { type: 'text', text: `Meni — ${salon.name}` },
            body:   { text: greeting + 'Izberite artikel iz menija:' + cartSum },
            footer: { text: 'FlowTiq · POS naročanje' },
            action: {
              button: 'Odpri meni',
              sections,
            }
          }
        });
      } catch (e) {
        console.error('[POS] getMenu error:', e.message);
        await wa.send(phoneId, token, wa.textMsg(from,
          `Napaka pri nalaganju menija: ${e.message}\n\nPoskusite znova čez trenutek.`
        ));
      }
      return;
    }

    // ── Item selected from list ──
    if (iId.startsWith('pos_item_')) {
      const itemId = iId.replace('pos_item_', '');
      const menu = sess.posMenu || [];
      const item = menu.find(m => String(m.id) === String(itemId));
      if (!item) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Artikel ni najden. Poskusite znova.'));
        return;
      }

      // Ask quantity
      session.set(skey, { ...sess, posStep: 'qty', pendingItem: item });

      await wa.send(phoneId, token, {
        messaging_product: 'whatsapp',
        to: from,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: `*${item.name}*\n💰 ${item.price.toFixed(2)} €\n\nKoliko kosov?` },
          action: {
            buttons: [
              { type: 'reply', reply: { id: `pos_qty_1`, title: '1 kos' } },
              { type: 'reply', reply: { id: `pos_qty_2`, title: '2 kosa' } },
              { type: 'reply', reply: { id: `pos_qty_3`, title: '3 kosi' } },
            ]
          }
        }
      });
      return;
    }

    // ── Quantity selected ──
    if (iId.startsWith('pos_qty_') && sess.pendingItem) {
      const qty = parseInt(iId.replace('pos_qty_', '')) || 1;
      const item = sess.pendingItem;
      const cart = sess.cart || [];

      // Merge or add
      const existing = cart.find(c => String(c.id) === String(item.id));
      if (existing) {
        existing.qty += qty;
      } else {
        cart.push({ id: item.id, name: item.name, price: item.price, qty });
      }
      session.set(skey, { ...sess, posStep: 'cart', cart, pendingItem: null });

      await wa.send(phoneId, token, {
        messaging_product: 'whatsapp',
        to: from,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: `✅ Dodano: *${item.name}* x${qty}\n\n🛒 *Košarica:*\n${fmtPosCart(cart)}\n\n💰 Skupaj: *${posCartTotal(cart)} €*` },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'pos_cart_more',  title: 'Dodaj še' } },
              { type: 'reply', reply: { id: 'pos_checkout',   title: 'Zaključi' } },
              { type: 'reply', reply: { id: 'pos_cancel',     title: 'Prekliči vse' } },
            ]
          }
        }
      });
      return;
    }

    // ── User types custom quantity in text ──
    if (sess.posStep === 'qty' && sess.pendingItem && msgText && /^\d+$/.test(msgText.trim())) {
      const qty = Math.min(parseInt(msgText.trim()), 20) || 1;
      const item = sess.pendingItem;
      const cart = sess.cart || [];
      const existing = cart.find(c => String(c.id) === String(item.id));
      if (existing) existing.qty += qty; else cart.push({ id: item.id, name: item.name, price: item.price, qty });
      session.set(skey, { ...sess, posStep: 'cart', cart, pendingItem: null });
      await wa.send(phoneId, token, {
        messaging_product: 'whatsapp',
        to: from,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: `✅ Dodano: *${item.name}* x${qty}\n\n🛒 *Košarica:*\n${fmtPosCart(cart)}\n\n💰 Skupaj: *${posCartTotal(cart)} €*` },
          action: { buttons: [
            { type: 'reply', reply: { id: 'pos_cart_more', title: 'Dodaj še' } },
            { type: 'reply', reply: { id: 'pos_checkout',  title: 'Zaključi' } },
            { type: 'reply', reply: { id: 'pos_cancel',    title: 'Prekliči vse' } },
          ]}
        }
      });
      return;
    }

    // ── Dodaj še → nazaj na meni ──
    if (iId === 'pos_cart_more') {
      // Re-show menu from cached session
      const menu = sess.posMenu || [];
      if (!menu.length) {
        session.set(skey, { posStep: null });
        await wa.send(phoneId, token, wa.textMsg(from, 'Pišite karkoli za prikaz menija.'));
        return;
      }
      const cats = sess.posCats || {};
      const catNames = Object.keys(cats);
      const sections = catNames.slice(0, 10).map(cat => ({
        title: cat,
        rows: (cats[cat] || []).slice(0, 10).map(item => ({
          id: `pos_item_${item.id}`,
          title: item.name.slice(0, 24),
          description: `${item.price.toFixed(2)} €`,
        }))
      }));
      const cartSum = sess.cart && sess.cart.length
        ? `\n\n🛒 Trenutna košarica: ${posCartTotal(sess.cart)} €` : '';
      await wa.send(phoneId, token, {
        messaging_product: 'whatsapp',
        to: from,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: 'Dodaj artikel' },
          body:   { text: 'Izberite naslednji artikel:' + cartSum },
          footer: { text: 'FlowTiq · POS naročanje' },
          action: { button: 'Odpri meni', sections }
        }
      });
      return;
    }

    // ── Zaključi → vpraša mizo / komentar ──
    if (iId === 'pos_checkout') {
      const cart = sess.cart || [];
      if (!cart.length) {
        await wa.send(phoneId, token, wa.textMsg(from, 'Košarica je prazna. Izberite artikel iz menija.'));
        session.set(skey, { posStep: null });
        return;
      }
      session.set(skey, { ...sess, posStep: 'table' });
      await wa.send(phoneId, token, wa.textMsg(from,
        `🛒 *Vaše naročilo:*\n${fmtPosCart(cart)}\n\n💰 Skupaj: *${posCartTotal(cart)} €*\n\n📋 Napišite številko mize ali opombo (npr. *Miza 5* ali *Brez česna*).\n\nZa nadaljevanje brez opombe pošljite *NE*.`
      ));
      return;
    }

    // ── Miza / komentar → pokaži finalno potrditev ──
    if (sess.posStep === 'table' && msgText) {
      const comment = msgText.trim().toUpperCase() === 'NE' ? '' : msgText.trim();
      const cart = sess.cart || [];
      session.set(skey, { ...sess, posStep: 'confirm', posComment: comment });
      const opombaTxt = comment ? `\n📝 Opomba: ${comment}` : '';
      await wa.send(phoneId, token, {
        messaging_product: 'whatsapp',
        to: from,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: `✅ *Potrditev naročila*\n\n${fmtPosCart(cart)}${opombaTxt}\n\n💰 *Skupaj: ${posCartTotal(cart)} €*\n\nPotrdite naročilo?` },
          action: { buttons: [
            { type: 'reply', reply: { id: 'pos_confirm', title: '✅ Potrdi' } },
            { type: 'reply', reply: { id: 'pos_cancel',  title: '❌ Prekliči' } },
          ]}
        }
      });
      return;
    }

    // ── Potrdi → pošlji v POS ──
    if (iId === 'pos_confirm') {
      const cart = sess.cart || [];
      if (!cart.length) {
        session.clear(skey);
        await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Pišite karkoli za nov začetek.'));
        return;
      }
      const comment = sess.posComment || '';

      // Also save to our DB (reference order)
      const today = t.todayStr();
      const bookingData = {
        customer_phone: from,
        customer_name:  from,
        salon_id:       salon.id,
        booking_date:   today,
        booking_time:   t.nowTimeHMS(),
        status:         'pending',
        notes:          `POS NAROČILO | ${salon.pos_type?.toUpperCase()} | Skupaj: ${posCartTotal(cart)} €${comment ? ' | ' + comment : ''}`,
        form_answers:   JSON.stringify({ narocilo: fmtPosCart(cart), skupaj: posCartTotal(cart) + ' €', opomba: comment })
      };
      const booking = await db.createBooking(bookingData).catch(e => {
        console.error('[POS] db.createBooking error:', e.message);
        return null;
      });
      const ref6 = booking ? (booking.id || '').slice(-6).toUpperCase() : '???';

      // Send directly to POS kitchen — no admin confirmation needed
      try {
        const posResult = await adapter.createOrder(posToken, posAccount, cart, {
          spot_id: posSpotId,
          comment,
        });
        session.clear(skey);
        if (posResult.success) {
          await wa.send(phoneId, token, wa.textMsg(from,
            `✅ Naročilo sprejeto!\n\n🔑 Ref: *#${ref6}*\n\nVaše naročilo je poslano v kuhinjo. 🍽️`
          ));
        } else {
          await wa.send(phoneId, token, wa.textMsg(from,
            `✅ Naročilo oddano! (Ref: *#${ref6}*)\n\nHvala za naročilo! 🍽️`
          ));
          console.error('[POS] createOrder failed:', posResult.message);
          db.logError(salon.id, 'pos_create_order', posResult.message, null, from).catch(() => {});
        }
      } catch (e) {
        session.clear(skey);
        console.error('[POS] confirm exception:', e.message);
        await wa.send(phoneId, token, wa.textMsg(from,
          `✅ Naročilo sprejeto! (Ref: *#${ref6}*)\n\nHvala! 🍽️`
        ));
      }
      return;
    }

    // ── Prekliči ──
    if (iId === 'pos_cancel') {
      session.clear(skey);
      await wa.send(phoneId, token, wa.textMsg(from, '❌ Naročilo preklicano. Dobrodošli nazaj! Pišite karkoli za nov začetek.'));
      return;
    }

    // ── Fallback: show menu ──
    session.set(skey, { posStep: null });
    const greet = salon.greeting_message
      ? salon.greeting_message
      : `Dobrodošli v *${salon.name}*! 🍽️ Pišite *menu* za prikaz menija.`;
    await wa.send(phoneId, token, wa.textMsg(from, greet));
    return;
  }
  // ══════════════════════════════════════════════════════


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
      session.set(skey, { ...sessData, step: 10, selectedDate: date, selectedTime: time, fieldIndex: 0, formAnswers: {} });
      const opt = first.required ? '' : ' (opcijsko - 0 za preskok)';
      await wa.send(phoneId, token, wa.textMsg(from, `${first.label}:${opt}`));
    } else {
      session.set(skey, { ...sessData, step: 4, selectedDate: date, selectedTime: time });
      await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
    }
  };

  // Helper: start form fields first (datetime_position = 'last')
  const goFormFirst = async (sessData) => {
    const first = formFields[0];
    session.set(skey, { ...sessData, step: 30, fieldIndex: 0, formAnswers: {} });
    const opt = first.required ? '' : ' (opcijsko - 0 za preskok)';
    await wa.send(phoneId, token, wa.textMsg(from, `${first.label}:${opt}`));
  };

  // Helper: after form fields collected in 'last' mode → ask for date
  const goDateAfterForm = async (sessData) => {
    const freeDates = await getFreeDates(salon, 30, sessData.serviceDuration);
    session.set(skey, { ...sessData, step: 31 });
    await wa.send(phoneId, token, wa.dateList(from, freeDates));
  };

  // Helper: submit inquiry (step 10 or step 20)
  const submitInquiry = async (customerName, formAnswers, serviceId, preferredDate, preferredTime) => {
    const svc = services.find(sv => sv.id === serviceId);
    const today = t.todayStr();
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
    const r6 = (bk.id || '').slice(-6).toUpperCase();
    session.clear(skey);
    const cMsg = salon.inquiry_confirmation_message || 'Hvala za povprasevanje! Kontaktirali vas bomo cim prej.';
    await wa.send(phoneId, token, wa.textMsg(from, `${cMsg}\n\nRef: *${r6}*`));
    const aSum = Object.entries(formAnswers || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
    if (salonAdminPhone) {
      wa.send(phoneId, token, wa.textMsg(salonAdminPhone,
        `*Novo povprasevanje*\n\nIme: ${customerName}\nTel: +${from}\nStoritev: ${svc ? svc.name : ''}\nDatum: ${preferredDate || '?'}\nUra: ${preferredTime || '?'}\nRef: *${r6}*${aSum ? '\n\n' + aSum : ''}`
      )).catch(e => console.error('Inquiry admin WA err:', e.message));
    } else {
      console.log(`[email] Sending inquiry admin email to ${salon.owner_email} for booking ${bk.id}`);
      mail.sendAdminBookingConfirmEmail(salon, customerName, from, preferredDate || today, preferredTime || 'po dogovoru', r6, bk.id, formAnswers)
        .catch(e => console.error('[email] inquiry admin email failed:', e.message));
    }
  };

  // ── Step 6: preferred date for inquiry ──
  if (sess.step === 6 && msgText) {
    session.set(skey, { ...sess, step: 7, preferredDate: msgText.trim() });
    await wa.send(phoneId, token, wa.textMsg(from, 'Ob kateri uri? (npr. 10:00, popoldne...)'));
    return;
  }

  // ── Step 7: preferred time for inquiry ──
  if (sess.step === 7 && msgText) {
    const s = session.get(skey);
    const updated = { ...s, preferredTime: msgText.trim() };
    if (formFields.length > 0) {
      const first = formFields[0];
      session.set(skey, { ...updated, step: 10, fieldIndex: 0, formAnswers: {} });
      const opt = first.required ? '' : ' (opcijsko - 0 za preskok)';
      await wa.send(phoneId, token, wa.textMsg(from, `${first.label}:${opt}`));
    } else {
      session.set(skey, { ...updated, step: 20, formAnswers: {} });
      await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
    }
    return;
  }

  // ── Step 10: collecting form fields ──
  if (sess.step === 10 && msgText) {
    const s = session.get(skey);
    const fi = s.fieldIndex || 0;
    const field = formFields[fi];
    const skipped = msgText.trim() === '0' && field && !field.required;
    const answers = skipped ? s.formAnswers : { ...(s.formAnswers || {}), [field ? field.label : `Q${fi}`]: msgText.trim() };
    const nextFi = fi + 1;
    if (nextFi < formFields.length) {
      const nextField = formFields[nextFi];
      session.set(skey, { ...s, step: 10, fieldIndex: nextFi, formAnswers: answers });
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
          session.set(skey, { ...s, step: 20, formAnswers: answers });
          await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
        }
      } else {
        if (autoName) {
          const svc = services.find(sv => sv.id === s.serviceId);
          session.set(skey, { ...s, step: 5, customerName: autoName, formAnswers: answers });
          await wa.send(phoneId, token, wa.finalConfirmButtons(from, s.selectedDate, s.selectedTime, autoName, svc ? svc.name : 'Storitev'));
        } else {
          session.set(skey, { ...s, step: 4, formAnswers: answers });
          await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
        }
      }
    }
    return;
  }

  // ── Step 20: name for inquiry (no name in form fields) ──
  if (sess.step === 20 && msgText) {
    const s = session.get(skey);
    await submitInquiry(msgText.trim(), s.formAnswers, s.serviceId, s.preferredDate, s.preferredTime);
    return;
  }

  // ── Step 30: collecting form fields BEFORE date (datetime_position = 'last') ──
  if (sess.step === 30 && msgText) {
    const s = session.get(skey);
    const fi = s.fieldIndex || 0;
    const field = formFields[fi];
    const skipped = msgText.trim() === '0' && field && !field.required;
    const answers = skipped ? s.formAnswers : { ...(s.formAnswers || {}), [field ? field.label : `Q${fi}`]: msgText.trim() };
    const nextFi = fi + 1;
    if (nextFi < formFields.length) {
      const nextField = formFields[nextFi];
      session.set(skey, { ...s, step: 30, fieldIndex: nextFi, formAnswers: answers });
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
        // Vprašalnik je bil izpolnjen že v koraku 30 — ne sprašuj znova
        const s31 = session.get(skey);
        const nameField31 = formFields.find(f =>
          f.id === 'full_name' || f.id === 'name' || f.id === 'ime' ||
          /ime.*priimek|full.?name/i.test(f.label || '')
        );
        const autoName31 = nameField31 ? ((s31.formAnswers || {})[nameField31.label] || null) : null;
        if (autoName31) {
          const svc31 = services.find(sv => sv.id === s31.serviceId);
          session.set(skey, { ...s31, step: 5, customerName: autoName31, selectedDate: date, selectedTime: bestTime });
          await wa.send(phoneId, token, wa.finalConfirmButtons(from, date, bestTime, autoName31, svc31 ? svc31.name : 'Storitev'));
        } else {
          session.set(skey, { ...s31, step: 4, selectedDate: date, selectedTime: bestTime });
          await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
        }
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
      session.set(skey, { ...sess, step: 32, selectedDate: date });
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
    if (!useDate) { session.clear(skey); await wa.send(phoneId, token, wa.dateList(from, await getFreeDates(salon))); return; }
    if (parsedTime) {
      const bestTime = await resolveCustomTime(salon, useDate, parsedTime, sess.serviceDuration);
      if (bestTime) {
        // Skip formFields (already collected in step 30), go straight to name/confirm
        const s = session.get(skey);
        const nameField = formFields.find(f =>
          f.id === 'full_name' || f.id === 'name' || f.id === 'ime' ||
          /ime.*priimek|full.?name/i.test(f.label || '')
        );
        const autoName = nameField ? ((s.formAnswers || {})[nameField.label] || null) : null;
        if (autoName) {
          const svc = services.find(sv => sv.id === s.serviceId);
          session.set(skey, { ...s, step: 5, customerName: autoName, selectedDate: useDate, selectedTime: bestTime });
          await wa.send(phoneId, token, wa.finalConfirmButtons(from, useDate, bestTime, autoName, svc ? svc.name : 'Storitev'));
        } else {
          session.set(skey, { ...s, step: 4, selectedDate: useDate, selectedTime: bestTime });
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
    const s = session.get(skey);
    if (!s.selectedDate || !s.selectedTime || !s.serviceId) {
      await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Zacnite znova.'));
      session.clear(skey);
      return;
    }
    const svc = services.find(sv => sv.id === s.serviceId);
    session.set(skey, { ...s, step: 5, customerName: msgText.trim() });
    await wa.send(phoneId, token, wa.finalConfirmButtons(from, s.selectedDate, s.selectedTime, msgText.trim(), svc ? svc.name : 'Storitev'));
    return;
  }

  // ── Step 5 / final_confirm — ustvari rezervacijo ──
  if ((iId === 'final_confirm') || (sess.step === 5 && iId === 'final_confirm')) {
    const s = session.get(skey);
    if (!s.selectedDate || !s.selectedTime || !s.serviceId || !s.customerName) {
      await wa.send(phoneId, token, wa.textMsg(from, 'Seja je potekla. Zacnite znova.'));
      session.clear(skey);
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
      form_answers: Object.keys(fa).length ? fa : null
    };
    if (s.serviceDuration) bookingData.duration_minutes = s.serviceDuration;

    let booking;
    try {
      booking = await db.createBookingIfFree(bookingData);
    } catch (e) {
      if (e.code === 'SLOT_TAKEN') {
        session.set(skey, { ...s, step: 2 });
        await wa.send(phoneId, token, wa.textMsg(from, 'Ta termin je bil žal pravkar zaseden. 😕 Izberite drugo uro:'));
        await wa.send(phoneId, token, wa.timeList(from, await getFreeTimesForDate(salon, s.selectedDate, s.serviceDuration), s.selectedDate));
        return;
      }
      throw e;
    }
    const ref6 = (booking.id || '').slice(-6).toUpperCase();
    const fDate = fmtDate(s.selectedDate);
    const fTime = (s.selectedTime || '').substring(0, 5);
    session.clear(skey);

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
            const fbLines = Object.entries(fa).map(([k,v])=>`• ${k}: ${v}`).join('\n');
          const fbBlock = fbLines ? `\n\n📋 Odgovori stranke:\n${fbLines}` : '';
          wa.send(phoneId, token, wa.textMsg(salonAdminPhone,
            `Nova rezervacija\n\nIme: ${s.customerName}\nTel: +${from}\nDatum: ${fDate} ob ${fTime}\nRef: *${ref6}*${fbBlock}\n\nPotrdi: *#potrdi ${ref6}*`
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
        mail.sendAdminBookingConfirmEmail(salon, s.customerName, from, fDate, fTime, ref6, booking.id, fa)
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
    session.clear(skey);
    await wa.send(phoneId, token, wa.textMsg(from, 'Rezervacija preklicana. Ce zelite rezervirati znova, nam pisˇite.'));
    return;
  }

  // ── Service selection ──
  if (iId.startsWith('svc_')) {
    const svcId = iId.replace('svc_', '');
    const svc = services.find(s => s.id === svcId);
    const serviceDuration = svc ? svc.duration_minutes : null;

    if (bookingMode === 'inquiry') {
      session.set(skey, { step: 6, serviceId: svcId });
      await wa.send(phoneId, token, wa.textMsg(from, 'Kdaj bi zeleli priti? (npr. v petek, 28.5., naslednji teden...)'));
      return;
    }

    if (datetimePosition === 'last' && formFields.length > 0) {
      // Form fields first, date/time later
      await goFormFirst({ step: 30, serviceId: svcId, serviceDuration });
      return;
    }

    session.set(skey, { step: 1, serviceId: svcId, serviceDuration });
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
      session.set(skey, { ...sess, step: 2, selectedDate: date });
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
      session.clear(skey);
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
    session.set(skey, { ...sess, step: nextStep, selectedDate: date });
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
      const s = session.get(skey);
      const nameField = formFields.find(f =>
        f.id === 'full_name' || f.id === 'name' || f.id === 'ime' ||
        /ime.*priimek|full.?name/i.test(f.label || '')
      );
      const autoName = nameField ? ((s.formAnswers || {})[nameField.label] || null) : null;
      if (autoName) {
        const svc = services.find(sv => sv.id === s.serviceId);
        session.set(skey, { ...s, step: 5, customerName: autoName, selectedDate: date, selectedTime: time });
        await wa.send(phoneId, token, wa.finalConfirmButtons(from, date, time, autoName, svc ? svc.name : 'Storitev'));
      } else {
        session.set(skey, { ...s, step: 4, selectedDate: date, selectedTime: time });
        await wa.send(phoneId, token, wa.textMsg(from, 'Vpisite vase ime in priimek:'));
      }
    } else {
      await goAfterTime(date, time, sess);
    }
    return;
  }


  // ── Default: show service list ──
  session.clear(skey);
  await wa.send(phoneId, token, wa.serviceList(from, services, salon));
}

module.exports = { handleMessage };
