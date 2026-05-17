const Anthropic = require('@anthropic-ai/sdk');
const db = require('./supabase');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Tools available to the AI ───────────────────────────────
const TOOLS = [
  {
    name: 'list_bookings',
    description: 'Prikaži naročila za določen datum (privzeto danes)',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Datum YYYY-MM-DD, npr 2026-05-17. Privzeto danes.' }
      }
    }
  },
  {
    name: 'list_services',
    description: 'Prikaži vse storitve s cenami in trajanjem',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'list_free_slots',
    description: 'Prikaži proste termine za določen datum',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Datum YYYY-MM-DD. Privzeto danes.' }
      }
    }
  },
  {
    name: 'add_booking',
    description: 'Ročno dodaj rezervacijo za stranko',
    input_schema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Ime stranke' },
        customer_phone: { type: 'string', description: 'Telefonska številka stranke (opcijsko)' },
        date: { type: 'string', description: 'Datum YYYY-MM-DD' },
        time: { type: 'string', description: 'Ura v formatu HH:MM, npr 12:00' },
        service_name: { type: 'string', description: 'Ime ali del imena storitve (opcijsko)' }
      },
      required: ['customer_name', 'date', 'time']
    }
  },
  {
    name: 'confirm_booking',
    description: 'Potrdi rezervacijo stranke po ref kodi',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Referenčna koda (zadnjih 6 znakov ID-ja)' }
      },
      required: ['ref']
    }
  },
  {
    name: 'cancel_booking',
    description: 'Prekliči rezervacijo po ref kodi ali imenu stranke in datumu',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Referenčna koda rezervacije (opcijsko)' },
        customer_name: { type: 'string', description: 'Ime stranke (opcijsko, alternativa ref)' },
        date: { type: 'string', description: 'Datum YYYY-MM-DD (opcijsko, za iskanje po imenu)' }
      }
    }
  },
  {
    name: 'update_service',
    description: 'Posodobi ceno ali trajanje storitve',
    input_schema: {
      type: 'object',
      properties: {
        service_name: { type: 'string', description: 'Del imena storitve za iskanje' },
        price: { type: 'number', description: 'Nova cena v € (opcijsko)' },
        duration_minutes: { type: 'number', description: 'Novo trajanje v minutah (opcijsko)' }
      },
      required: ['service_name']
    }
  },
  {
    name: 'add_slot',
    description: 'Dodaj prosti termin v urnik',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Datum YYYY-MM-DD' },
        time: { type: 'string', description: 'Ura HH:MM' }
      },
      required: ['date', 'time']
    }
  },
  {
    name: 'remove_slot',
    description: 'Odstrani prosti termin iz urnika (zapri termin)',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Datum YYYY-MM-DD' },
        time: { type: 'string', description: 'Ura HH:MM' }
      },
      required: ['date', 'time']
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
          const time = (b.booking_time || b.slot_time || '?').substring(0, 5);
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
        if (!booking) return `Rezervacija ni najdena.`;
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
- Odgovarjaj kratko, jasno, v slovenščini
- Vedno potrdi kar si naredil z emojiji
- Če nimaš dovolj info (npr. manjka datum ali ime), vprašaj
- Ko admin reče "danes" → uporabi ${today}
- Ko admin reče "jutri" → uporabi naslednji dan
- Dnevi: pon, tor, sre, čet, pet, sob, ned`;

  const messages = [{ role: 'user', content: message }];

  let response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: systemPrompt,
    tools: TOOLS,
    messages
  });

  // Agentic loop – execute tools until final answer
  while (response.stop_reason === 'tool_use') {
    const toolResults = [];

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const result = await executeTool(block.name, block.input, salonId, today);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result
        });
      }
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      tools: TOOLS,
      messages
    });
  }

  return response.content.find(b => b.type === 'text')?.text || 'Opravljeno.';
}

module.exports = { askAdminAI };
