// ─── AI natakar (paket AI, gpt-4o-mini) ──────────────────────
// Pogovorno naročanje: stranka piše po domače, AI z orodji upravlja
// košarico, deterministična koda pa cene, zaključek in oddajo.
const axios = require('axios');
const db = require('./supabase');

const MODEL = () => process.env.AI_ORDER_MODEL || 'gpt-4o-mini';

const TOOLS = [
  { type: 'function', function: { name: 'show_menu', description: 'Pokaži stranki interaktivni meni s kategorijami', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'add_to_cart', description: 'Dodaj artikel v košarico (ime lahko približno)', parameters: { type: 'object', properties: { item: { type: 'string' }, qty: { type: 'number', description: 'Količina, privzeto 1' } }, required: ['item'] } } },
  { type: 'function', function: { name: 'remove_from_cart', description: 'Odstrani artikel iz košarice', parameters: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] } } },
  { type: 'function', function: { name: 'repeat_last_order', description: 'Dodaj artikle zadnjega naročila stranke ("enako kot zadnjič")', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'add_note', description: 'Zapiši posebno željo ali opombo k naročilu (npr. "brez gob", "bolj pikantno", alergije)', parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } } },
  { type: 'function', function: { name: 'checkout', description: 'Stranka želi zaključiti naročilo — začni postopek oddaje', parameters: { type: 'object', properties: {} } } }
];

// Toleranca ene napačne črke ("kola" najde "Cola", "margarita" -> "Margerita")
function almostEqual(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
    return true;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; }
    else if (!skipped) { skipped = true; j++; }
    else return false;
  }
  return true;
}
function findService(services, name) {
  const q = String(name || '').toLowerCase().trim();
  if (!q) return null;
  let s = services.find(x => (x.name || '').toLowerCase() === q);
  if (s) return s;
  s = services.find(x => (x.name || '').toLowerCase().includes(q) || q.includes((x.name || '').toLowerCase()));
  if (s) return s;
  const qWords = q.split(/\s+/).filter(w => w.length >= 3);
  if (!qWords.length) return null;
  // najboljše ujemanje po besedah (vsebovanost ali razlika 1 črke)
  let best = null, bestScore = 0;
  for (const x of services) {
    const nWords = (x.name || '').toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    let score = 0;
    for (const qw of qWords) {
      if (nWords.some(nw => nw.includes(qw) || qw.includes(nw) || almostEqual(qw, nw))) score++;
    }
    if (score > bestScore) { bestScore = score; best = x; }
  }
  return bestScore > 0 ? best : null;
}

async function askOrderAI({ message, salon, services, cart, history, phone, pendingItem }) {
  const menuText = services.map(s => `- ${s.name} (${s.category || 'Ostalo'}): ${s.price} €`).join('\n');
  const areaLine = salon.delivery_area ? `\nOBMOČJE DOSTAVE: ${salon.delivery_area} — to OMENI ŽE V POZDRAVU, da stranka ve, ali sploh dostavljate k njej.` : '';
  const sys = `Si prijazen natakar restavracije "${salon.name}" na WhatsAppu. Odgovarjaš kratko, toplo, v slovenščini, z zmerno emojiji.
POTEK POGOVORA:
1) Ob prvem sporočilu stranko prijazno pozdravi v imenu restavracije in jo vprašaj, ali želi kaj naročiti — menija še NE prikazuj.
2) Ko stranka potrdi, da želi naročiti, ali vpraša po ponudbi, pokliči show_menu.
3) Ko stranka pove, kaj želi (tudi približno, npr. "eno capriccioso"), uporabi add_to_cart. Če ni povedala količine, jo vprašaj po količini.
4) Po vsakem dodajanju kratko potrdi, kaj je v košarici in skupni znesek, ter vprašaj: "Želite še kaj?"
5) Če reče "enako kot zadnjič" ali podobno, uporabi repeat_last_order.
6) Če stranka izrazi posebno željo za pripravo (npr. "brez gob", "bolj pikantno", alergija), uporabi add_note in ji potrdi, da je zabeleženo — NE prikazuj menija.
7) Cene embalaže in dostave se dodajo ob zaključku — če stranka vpraša za skupno ceno, povej znesek artiklov in omeni, da se to doda ob zaključku.
Ko pove, da je to vse oz. želi zaključiti, uporabi checkout.
Nikoli si ne izmišljuj artiklov ali cen — ponujaš samo z menija. Ne obljubljaj časov dostave in ne izmišljuj akcij.
MENI:
${menuText}
TRENUTNA KOŠARICA: ${cart.length ? cart.map(i => `${i.name} x${i.qty || 1}`).join(', ') : 'prazna'}` + areaLine
    + (pendingItem ? `\nSTRANKA JE PRAVKAR IZBRALA Z MENIJA: ${pendingItem.name} — vprašana je bila po količini. Ko odgovori s količino (tudi z besedo, npr. "dve"), TAKOJ uporabi add_to_cart za "${pendingItem.name}" s to količino.` : '');

  const messages = [{ role: 'system', content: sys }, ...history.slice(-8), { role: 'user', content: message }];
  let action = null;
  let newCart = cart.map(i => ({ ...i }));
  const notes = [];

  for (let round = 0; round < 3; round++) {
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: MODEL(), max_tokens: 300, temperature: 0.4, tools: TOOLS, tool_choice: 'auto', messages
    }, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 20000
    });
    const choice = r.data.choices[0];
    if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls) {
      return { reply: (choice.message.content || '').trim(), cart: newCart, action, note: notes.join('; ') || null };
    }
    messages.push(choice.message);
    for (const tc of choice.message.tool_calls) {
      let input = {};
      try { input = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
      let result = '';
      switch (tc.function.name) {
        case 'show_menu':
          action = action || 'show_menu';
          result = 'Interaktivni meni bo prikazan stranki.';
          break;
        case 'add_to_cart': {
          const svc = findService(services, input.item);
          if (!svc) { result = `Artikla "${input.item}" ni na meniju. Predlagaj podobnega z menija.`; break; }
          const qty = Math.min(Math.max(parseInt(input.qty) || 1, 1), 50);
          const ex = newCart.find(c => String(c.id) === String(svc.id));
          if (ex) ex.qty = (ex.qty || 1) + qty;
          else newCart.push({ id: svc.id, name: svc.name, price: svc.price || 0, qty });
          action = action || 'show_cart';
          result = `Dodano: ${svc.name} x${qty} (${svc.price} €/kos). Košarica: ${newCart.map(i => `${i.name} x${i.qty}`).join(', ')}.`;
          break;
        }
        case 'remove_from_cart': {
          const svc = findService(newCart, input.item);
          if (svc) {
            newCart = newCart.filter(c => String(c.id) !== String(svc.id));
            action = action || 'show_cart';
            result = `Odstranjeno: ${svc.name}. Košarica: ${newCart.length ? newCart.map(i => `${i.name} x${i.qty}`).join(', ') : 'prazna'}.`;
          } else result = 'Tega artikla ni v košarici.';
          break;
        }
        case 'repeat_last_order': {
          const items = await db.getLastOrderItemsByPhone(salon.id, phone);
          if (!items.length) { result = 'Stranka še nima prejšnjega naročila — ponudi meni.'; break; }
          for (const it of items) {
            const key = it.service_id || it.name;
            const ex = newCart.find(c => String(c.id) === String(key));
            if (ex) ex.qty = (ex.qty || 1) + (it.quantity || 1);
            else newCart.push({ id: key, name: it.name, price: parseFloat(it.price) || 0, qty: it.quantity || 1 });
          }
          action = action || 'show_cart';
          result = `Dodano zadnje naročilo: ${items.map(i => `${i.name} x${i.quantity || 1}`).join(', ')}.`;
          break;
        }
        case 'add_note': {
          const note = String(input.note || '').trim().slice(0, 200);
          if (note) { notes.push(note); result = `Opomba zabeležena: "${note}". Potrdi stranki in vprašaj, ali želi še kaj.`; }
          else result = 'Opomba je prazna.';
          break;
        }
        case 'checkout':
          if (!newCart.length) { result = 'Košarica je prazna — stranka naj najprej kaj izbere.'; break; }
          action = 'checkout';
          result = 'Postopek zaključka naročila se začne (način prevzema, ime, naslov vodi sistem).';
          break;
        default:
          result = 'Neznano orodje.';
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }
  return { reply: '', cart: newCart, action, note: notes.join('; ') || null };
}

module.exports = { askOrderAI, findService };
