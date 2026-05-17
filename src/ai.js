const OpenAI = require('openai');
const db = require('./supabase');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Tools available to the AI ───────────────────────────────
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
      name: 'add_slot',
      description: 'Dodaj prosti termin v urnik',
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

// ─── Main AI handler ─────────────────────────────────────────
async function askAdminAI(message, salonId) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const dayName = now.toLocaleDateString('sl-SI', { weekday: 'long' });

  const systemPrompt = `Si inteligentni WhatsApp asistent za frizerski salon "Salon Vita".
Danes je ${dayName}, ${today}.

Pomagaš lastniku salona z:
- Pregledom naročil in terminov
- Ročnim dodajanjem rezervacij
- Potrjevanjem in preklicevanjem rezervacij
- Urejanjem storitev (cene, trajanje)
- Dodajanjem/odstranjevanjem terminov iz urnika

Pravila:
- Odgovarjaj kratko in jasno v slovenščini
- Vedno potrdi kar si naredil z emojiji
- Če nimaš dovolj info (npr. manjka datum ali ime), vprašaj
- Ko admin reče "danes" → ${today}, "jutri" → naslednji dan`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message }
  ];

  let response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 512,
    tools: TOOLS,
    tool_choice: 'auto',
    messages
  });

  // Agentic loop – execute tools until final answer
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

    response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 512,
      tools: TOOLS,
      tool_choice: 'auto',
      messages
    });
  }

  return response.choices[0].message.content || 'Opravljeno.';
}

module.exports = { askAdminAI };
