const axios = require('axios');
const FormData = require('form-data');
const db = require('./supabase');

// ─── OpenAI API via axios (brez SDK) ─────────────────────────
async function openaiChat(messages, tools) {
  const r = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini',
    max_tokens: 512,
    tools,
    tool_choice: 'auto',
    messages
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
  return r.data;
}

// ─── Tools ───────────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_bookings',
      description: 'Prikaži naročila za določen datum (privzeto danes)',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Datum YYYY-MM-DD. Privzeto danes.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_services',
      description: 'Prikaži vse storitve s cenami in trajanjem',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_free_slots',
      description: 'Prikaži proste termine za določen datum',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Datum YYYY-MM-DD. Privzeto danes.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_booking',
      description: 'Ročno dodaj rezervacijo za stranko',
      parameters: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: 'Ime stranke' },
          customer_phone: { type: 'string', description: 'Telefon stranke (opcijsko)' },
          date: { type: 'string', description: 'Datum YYYY-MM-DD' },
          time: { type: 'string', description: 'Ura HH:MM, npr 12:00' },
          service_name: { type: 'string', description: 'Ime storitve (opcijsko)' }
        },
        required: ['customer_name', 'date', 'time']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'confirm_booking',
      description: 'Potrdi rezervacijo stranke po ref kodi',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Referenčna koda (6 znakov)' }
        },
        required: ['ref']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cancel_booking',
      description: 'Prekliči rezervacijo po ref kodi ali imenu stranke',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Referenčna koda (opcijsko)' },
          customer_name: { type: 'string', description: 'Ime stranke (opcijsko)' },
          date: { type: 'string', description: 'Datum YYYY-MM-DD (opcijsko)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_service',
      description: 'Posodobi ceno ali trajanje storitve',
      parameters: {
        type: 'object',
        properties: {
          service_name: { type: 'string', description: 'Del imena storitve' },
          price: { type: 'number', description: 'Nova cena v € (opcijsko)' },
          duration_minutes: { type: 'number', description: 'Trajanje v minutah (opcijsko)' }
        },
        required: ['service_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_slots',
      description: 'Generiraj termine za cel dan ali več dni naenkrat. Uporabi za "dodaj termine za cel teden", "dodaj termine od 8h do 22h", "nastavi urnik za naslednji mesec" ipd.',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Začetni datum YYYY-MM-DD' },
          end_date: { type: 'string', description: 'Končni datum YYYY-MM-DD (opcijsko, privzeto = start_date)' },
          start_time: { type: 'string', description: 'Začetna ura HH:MM, npr 08:00' },
          end_time: { type: 'string', description: 'Končna ura HH:MM, npr 22:00' },
          interval_minutes: { type: 'number', description: 'Interval med termini v minutah (privzeto 60)' },
          skip_days: { type: 'array', items: { type: 'string' }, description: 'Dnevi za preskok: "monday","tuesday","wednesday","thursday","friday","saturday","sunday"' }
        },
        required: ['start_date', 'start_time', 'end_time']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_slot',
      description: 'Dodaj EN prosti termin v urnik',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Datum YYYY-MM-DD' },
          time: { type: 'string', description: 'Ura HH:MM' }
        },
        required: ['date', 'time']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remove_slot',
      description: 'Odstrani prosti termin iz urnika',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Datum YYYY-MM-DD' },
          time: { type: 'string', description: 'Ura HH:MM' }
        },
        required: ['date', 'time']
      }
    }
  }
];

// ─── Tool executor ───────────────────────────────────────────
async function executeTool(name, input, salonId, today) {
  try {
    switch (name) {
      case 'list_bookings': {
        const date = input.date || today;
        const bookings = await db.getBookingsByDate(salonId, date);
        if (!bookings.length) return `Ni naročil za ${date}.`;
        const lines = bookings.map(b => {
          const time = (b.booking_time || '?').substring(0, 5);
          const who = b.customer_name || b.customer_phone || '?';
          const ref = (b.id || '').slice(-6);
          return `• ${time} – ${who} (${b.status}) [${ref}]`;
        });
        return `Naročila za ${date}:\n${lines.join('\n')}`;
      }
      case 'list_services': {
        const services = await db.getServices(salonId);
        if (!services.length) return 'Ni storitev.';
        return services.map(s => `• ${s.name}: ${s.duration_minutes} min, ${s.price} €`).join('\n');
      }
      case 'list_free_slots': {
        const date = input.date || today;
        const slots = await db.getSlotsByDate(salonId, date);
        const free = slots.filter(s => !s.is_booked);
        if (!free.length) return `Ni prostih terminov za ${date}.`;
        return `Prosti termini (${date}):\n${free.map(s => `• ${s.slot_time.substring(0, 5)}`).join('\n')}`;
      }
      case 'add_booking': {
        const result = await db.addManualBooking(salonId, input);
        if (!result) return 'Napaka pri dodajanju rezervacije.';
        return `✅ Rezervacija dodana:\n👤 ${input.customer_name}\n📅 ${input.date} ob ${input.time}${input.service_name ? '\n✂️ ' + input.service_name : ''}`;
      }
      case 'confirm_booking': {
        const booking = await db.getBooking(input.ref);
        if (!booking) return `Rezervacija ${input.ref} ni najdena.`;
        await db.updateBookingStatus(booking.id, 'confirmed');
        return `✅ Rezervacija ${input.ref} potrjena.`;
      }
      case 'cancel_booking': {
        let booking = null;
        if (input.ref) {
          booking = await db.getBooking(input.ref);
        } else if (input.customer_name) {
          booking = await db.getBookingByName(salonId, input.customer_name, input.date);
        }
        if (!booking) return 'Rezervacija ni najdena.';
        await db.updateBookingStatus(booking.id, 'cancelled');
        if (booking.slot_id) await db.markSlotFree(booking.slot_id);
        const who = booking.customer_name || booking.customer_phone || (input.ref || '');
        return `❌ Rezervacija za ${who} preklicana.`;
      }
      case 'update_service': {
        const result = await db.updateService(salonId, input.service_name, input.price, input.duration_minutes);
        if (!result) return `Storitev '${input.service_name}' ni najdena.`;
        const changes = [];
        if (input.price !== undefined) changes.push(`cena: ${input.price} €`);
        if (input.duration_minutes !== undefined) changes.push(`trajanje: ${input.duration_minutes} min`);
        return `✅ Storitev '${result.name}' posodobljena – ${changes.join(', ')}.`;
      }
      case 'generate_slots': {
        const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
        const skipDays = (input.skip_days || []).map(d => d.toLowerCase());
        const interval = input.interval_minutes || 60;
        const endDate = input.end_date || input.start_date;

        // Build list of dates
        const dates = [];
        const cur = new Date(input.start_date + 'T12:00:00');
        const end = new Date(endDate + 'T12:00:00');
        while (cur <= end) {
          const dayName = dayNames[cur.getDay()];
          if (!skipDays.includes(dayName)) {
            dates.push(cur.toISOString().split('T')[0]);
          }
          cur.setDate(cur.getDate() + 1);
        }

        // Build list of times
        const times = [];
        const [sh, sm] = input.start_time.split(':').map(Number);
        const [eh, em] = input.end_time.split(':').map(Number);
        let mins = sh * 60 + sm;
        const endMins = eh * 60 + em;
        while (mins < endMins) {
          const hh = String(Math.floor(mins / 60)).padStart(2, '0');
          const mm = String(mins % 60).padStart(2, '0');
          times.push(`${hh}:${mm}`);
          mins += interval;
        }

        // Insert all slots
        let count = 0;
        for (const date of dates) {
          for (const time of times) {
            try {
              await db.addSlot(salonId, date, time);
              count++;
            } catch (e) {
              // Skip duplicates silently
            }
          }
        }
        return `✅ Dodanih ${count} terminov na ${dates.length} ${dates.length === 1 ? 'dan' : 'dni'} (${input.start_time}–${input.end_time}, vsakih ${interval} min).`;
      }

      case 'add_slot': {
        await db.addSlot(salonId, input.date, input.time);
        return `✅ Termin dodan: ${input.date} ob ${input.time}.`;
      }
      case 'remove_slot': {
        await db.removeSlot(salonId, input.date, input.time);
        return `✅ Termin odstranjen: ${input.date} ob ${input.time}.`;
      }
      default:
        return 'Neznano orodje.';
    }
  } catch (e) {
    console.error('Tool error:', name, e.message);
    return `Napaka: ${e.message}`;
  }
}

// ─── Customer AI — odgovarja na vprašanja z upoštevanjem znanja ─
async function askCustomerAI(message, salonId) {
  const knowledge = await db.getKnowledge(salonId);
  let knowledgeSection = '';
  if (knowledge.length > 0) {
    knowledgeSection = `\n\nZnanje o salonu:\n${knowledge.map(k => `- ${k.content}`).join('\n')}`;
  }

  const systemPrompt = `Si prijazen WhatsApp asistent frizerskega salona "Salon Vita".
Odgovarjaj kratko in prijazno v slovenščini.
Če ne veš odgovora, reci da se obrnejo na salon.${knowledgeSection}`;

  const r = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini',
    max_tokens: 256,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ]
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 20000
  });
  return r.data.choices[0].message.content?.trim() || null;
}

// ─── Main AI handler ─────────────────────────────────────────
async function askAdminAI(message, salonId) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const dayName = now.toLocaleDateString('sl-SI', { weekday: 'long' });

  const systemPrompt = `Si inteligentni WhatsApp asistent za frizerski salon "Salon Vita".
Danes je ${dayName}, ${today}.
Pomagaš lastniku salona z naročili, storitvami in termini.
Odgovarjaj kratko, jasno, v slovenščini. Vedno potrdi kar si naredil z emojiji.
Ko admin reče "danes" → ${today}, "jutri" → naslednji dan.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message }
  ];

  let response = await openaiChat(messages, TOOLS);

  // Agentic loop
  while (response.choices[0].finish_reason === 'tool_calls') {
    const assistantMsg = response.choices[0].message;
    messages.push(assistantMsg);

    for (const toolCall of assistantMsg.tool_calls) {
      const input = JSON.parse(toolCall.function.arguments);
      const result = await executeTool(toolCall.function.name, input, salonId, today);
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result
      });
    }

    response = await openaiChat(messages, TOOLS);
  }

  return response.choices[0].message.content || 'Opravljeno.';
}

// ─── Whisper — glasovno sporočilo → besedilo ─────────────────
async function transcribeAudio(mediaId, waToken) {
  // 1. Pridobi URL od Meta
  const metaRes = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${waToken}` }
  });
  const audioUrl = metaRes.data.url;

  // 2. Prenesi audio kot buffer
  const audioRes = await axios.get(audioUrl, {
    headers: { Authorization: `Bearer ${waToken}` },
    responseType: 'arraybuffer'
  });
  const audioBuffer = Buffer.from(audioRes.data);

  // 3. Pošlji Whisper API
  const form = new FormData();
  form.append('file', audioBuffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
  form.append('model', 'whisper-1');
  form.append('language', 'sl');

  const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      ...form.getHeaders()
    },
    timeout: 30000
  });

  return whisperRes.data.text?.trim() || null;
}

module.exports = { askAdminAI, askCustomerAI, transcribeAudio };
