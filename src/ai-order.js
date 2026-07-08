// ─── AI natakar (paket AI, gpt-4o-mini) ──────────────────────
// Pogovorno naročanje: stranka piše po domače, AI z orodji upravlja
// košarico, deterministična koda pa cene, zaključek in oddajo.
const axios = require('axios');
const db = require('./supabase');

const MODEL = () => process.env.AI_ORDER_MODEL || 'gpt-4o-mini';

const TOOLS = [
  { type: 'function', function: { name: 'show_menu', description: 'Pokaži stranki interaktivni meni s kategorijami', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'add_to_cart', description: 'Dodaj artikel v košarico (ime lahko približno). Če ima artikel posebnost (npr. brez sira), jo dodaj kot note. Če stranka naroči isto jed z RAZLIČNIMI posebnostmi (npr. 2 pici, ena brez sira), kliči add_to_cart LOČENO za vsako — enkrat normalno, enkrat z note.', parameters: { type: 'object', properties: { item: { type: 'string' }, qty: { type: 'number', description: 'Količina, privzeto 1' }, note: { type: 'string', description: 'Posebnost samo za ta artikel (npr. "brez sira", "extra pikantno"). Neobvezno.' } }, required: ['item'] } } },
  { type: 'function', function: { name: 'remove_from_cart', description: 'Odstrani artikel iz košarice', parameters: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] } } },
  { type: 'function', function: { name: 'repeat_last_order', description: 'Dodaj artikle zadnjega naročila stranke ("enako kot zadnjič")', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'add_note', description: 'Zapiši posebno željo ali opombo k naročilu (npr. "brez gob", "bolj pikantno", alergije)', parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } } },
  { type: 'function', function: { name: 'checkout', description: 'Stranka želi zaključiti naročilo — začni zaključek (vprašanje o načinu prevzema)', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'set_mode', description: 'Zabeleži način prevzema, ko ga stranka pove. MAPIRANJE: "osebni", "osebni prevzem", "sam", "pridem", "pridem sam", "pridem po", "pri vas", "v lokalu", "bom prišel", "k vam", "take away", "takeaway", "pickup" → prevzem. "dostava", "dostavite", "na dom", "k meni", "k nam", "prinesite", "pošljite", "na naslov", "delivery" → dostava.', parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['dostava', 'prevzem'] } }, required: ['mode'] } } },
  { type: 'function', function: { name: 'set_name', description: 'Zabeleži ime in priimek stranke', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'set_address', description: 'Zabeleži naslov dostave', parameters: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] } } },
  { type: 'function', function: { name: 'confirm_order', description: 'ŠELE ko stranka izrecno potrdi celotno naročilo — odda naročilo', parameters: { type: 'object', properties: {} } } }
];

// Izračun zneskov — VEDNO deterministična koda, nikoli AI
function computeTotals(salon, cart, mode) {
  const kosov = cart.reduce((s, i) => s + (i.qty || 1), 0);
  const packUnit = parseFloat(salon.packaging_price || 0);
  const chargePack = mode === 'dostava' || salon.pickup_packaging !== false;
  const packFee = chargePack ? +(packUnit * kosov).toFixed(2) : 0;
  const delFee = mode === 'dostava' ? parseFloat(salon.delivery_fee || 0) : 0;
  const itemsTotal = cart.reduce((s, i) => s + parseFloat(i.price || 0) * (i.qty || 1), 0);
  const grand = (itemsTotal + packFee + delFee).toFixed(2);
  const parts = [`Artikli: ${itemsTotal.toFixed(2)} €`];
  if (packFee > 0) parts.push(`Embalaža: ${kosov} × ${packUnit.toFixed(2)} € = ${packFee.toFixed(2)} €`);
  if (delFee > 0) parts.push(`Dostava: ${delFee.toFixed(2)} €`);
  parts.push(`SKUPAJ: ${grand} €`);
  return { itemsTotal, packFee, delFee, grand, text: parts.join(' · ') + '.' };
}

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

async function askOrderAI({ message, salon, services, cart, history, phone, pendingItem, order = {}, note = '' }) {
  const menuText = services.map(s => `- ${s.name} (${s.category || 'Ostalo'}): ${s.price} €`).join('\n');
  const areaLine = salon.delivery_area ? `\nOBMOČJE DOSTAVE: ${salon.delivery_area}` : '';
  const sys = `Si prijazen natakar restavracije "${salon.name}" na WhatsAppu. Odgovarjaš kratko, toplo, v slovenščini. NE uporabljaj emojijev.
POTEK POGOVORA:
1) Ob prvem sporočilu stranko prijazno pozdravi v imenu restavracije in jo vprašaj, ali želi kaj naročiti — menija še NE prikazuj in območja dostave še NE omenjaj.
2) Ko stranka potrdi, da želi naročiti: če je navedeno OBMOČJE DOSTAVE, ji najprej povej npr. "Samo da vas obvestimo — dostavljamo po [območje]." in vprašaj: "Vam smem ponuditi meni?" — menija še NE prikazuj.
3) Ko stranka pritrdi (ali sama vpraša po ponudbi), pokliči show_menu.
4) Ko stranka pove ali izbere artikel, jo vprašaj po KOLIČINI in po morebitnih POSEBNOSTIH za ta artikel (npr. "brez gob", "extra sir", alergije). Količino vprašaj NARAVNO glede na vrsto artikla — "Koliko pic Margerita želite?", "Koliko Coca-Col?", "Koliko burgerjev?" — nikoli "koliko kosov". Posebnost za artikel dodaj kot note parameter v add_to_cart (ne z add_note). Če stranka naroči isto jed z RAZLIČNIMI posebnostmi (npr. "2 pici, ena brez sira"), kliči add_to_cart DVAKRAT: enkrat qty:1 brez note, enkrat qty:1 z note:"brez sira". add_note uporabljaj SAMO za splošne opombe k celotnemu naročilu.
4b) Če dobiš sporočilo oblike [IZBRANO Z MENIJA: X], je stranka pravkar izbrala artikel X z menija — vprašaj jo naravno po količini in posebnostih za X. add_to_cart uporabi ŠELE, ko pove količino.
5) Po vsakem dodajanju kratko potrdi, kaj je v košarici in skupni znesek artiklov, ter vprašaj: "Želite še kaj?"
6) Če reče "enako kot zadnjič" ali podobno, uporabi repeat_last_order.
7) Splošno željo za celotno naročilo prav tako zabeleži z add_note — NE prikazuj menija.
8) Cene embalaže in dostave se dodajo ob zaključku — če stranka vpraša za skupno ceno, povej znesek artiklov in omeni, da se to doda ob zaključku.
9) Ko stranka pove, da je to vse oz. želi zaključiti, uporabi checkout in nato VODI ZAKLJUČEK PO KORAKIH (vprašanja postavljaj ENO NAENKRAT):
   a. vprašaj "Dostava ali osebni prevzem?" (samo razpoložljive načine) → ko odgovori, uporabi set_mode,
   b. vprašaj za ime in priimek → set_name,
   c. pri dostavi vprašaj za naslov → set_address,
   d. povzemi CELOTNO naročilo (artikli, opomba, način, naslov, znesek SKUPAJ iz rezultata orodja) in vprašaj "Potrjujete naročilo?",
   e. ŠELE ko stranka izrecno potrdi, uporabi confirm_order. Zneske vedno vzemi iz rezultatov orodij, nikoli jih ne računaj sam.
Nikoli si ne izmišljuj artiklov ali cen — ponujaš samo z menija. Ne obljubljaj časov dostave in ne izmišljuj akcij.
MENI:
${menuText}
TRENUTNA KOŠARICA: ${cart.length ? cart.map(i => `${i.name} x${i.qty || 1}`).join(', ') : 'prazna'}` + areaLine
    + `\nNAČINI PREVZEMA: ${[salon.allow_delivery !== false ? 'dostava' : null, salon.allow_pickup !== false ? 'osebni prevzem' : null].filter(Boolean).join(' ali ')}${salon.pickup_address ? ` (prevzem na: ${salon.pickup_address})` : ''}`
    + `\nOPOMBA STRANKE: ${note || '—'}`
    + `\nSTANJE ZAKLJUČKA: način=${order.mode || 'še ni izbran'}, ime=${order.name || 'še ni podano'}, naslov=${order.address || 'še ni podan'}`
    + (pendingItem ? `\nSTRANKA JE PRAVKAR IZBRALA Z MENIJA: ${pendingItem.name} — vprašali smo jo po količini in posebnostih. Ko odgovori, TAKOJ uporabi add_to_cart za "${pendingItem.name}" z navedeno količino (tudi z besedo, npr. "dve"); če navede posebnost (npr. "brez gob"), jo dodaj kot note parameter v add_to_cart (npr. add_to_cart({item: "${pendingItem.name}", qty: 1, note: "brez gob"})).` : '');

  const messages = [{ role: 'system', content: sys }, ...history.slice(-30), { role: 'user', content: message }];
  let action = null;
  let newCart = cart.map(i => ({ ...i }));
  const notes = [];
  const newOrder = { mode: order.mode || null, name: order.name || null, address: order.address || null };

  for (let round = 0; round < 3; round++) {
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: MODEL(), max_tokens: 300, temperature: 0.4, tools: TOOLS, tool_choice: 'auto', messages
    }, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 20000
    });
    const choice = r.data.choices[0];
    if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls) {
      return { reply: (choice.message.content || '').trim(), cart: newCart, action, note: notes.join('; ') || null, order: newOrder };
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
          const itemNote = String(input.note || '').trim().slice(0, 200);
          // Če ima artikel opombo, vedno dodaj kot ločen vnos (ne združuj z obstoječim)
          if (itemNote) {
            newCart.push({ id: svc.id, name: svc.name, price: svc.price || 0, qty, note: itemNote });
          } else {
            const ex = newCart.find(c => String(c.id) === String(svc.id) && !c.note);
            if (ex) ex.qty = (ex.qty || 1) + qty;
            else newCart.push({ id: svc.id, name: svc.name, price: svc.price || 0, qty });
          }
          action = action || 'show_cart';
          result = `Dodano: ${svc.name} x${qty}${itemNote ? ` (${itemNote})` : ''} (${svc.price} €/kos). Košarica: ${newCart.map(i => `${i.name} x${i.qty || 1}${i.note ? ` (${i.note})` : ''}`).join(', ')}.`;
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
        case 'checkout': {
          if (!newCart.length) { result = 'Košarica je prazna — stranka naj najprej kaj izbere.'; break; }
          const modes = [salon.allow_delivery !== false ? 'dostava' : null, salon.allow_pickup !== false ? 'osebni prevzem' : null].filter(Boolean);
          result = modes.length > 1
            ? `Začni zaključek: vprašaj stranko, ali želi ${modes.join(' ali ')}.`
            : `Na voljo je samo ${modes[0]} — uporabi set_mode('${modes[0] === 'dostava' ? 'dostava' : 'prevzem'}') in nadaljuj z imenom.`;
          break;
        }
        case 'set_mode': {
          const m = String(input.mode || '').toLowerCase().includes('prev') ? 'prevzem' : 'dostava';
          if (m === 'dostava' && salon.allow_delivery === false) { result = 'Dostava ni na voljo — ponudi osebni prevzem.'; break; }
          if (m === 'prevzem' && salon.allow_pickup === false) { result = 'Osebni prevzem ni na voljo — ponudi dostavo.'; break; }
          newOrder.mode = m;
          const tt = computeTotals(salon, newCart, m);
          result = `Način zabeležen: ${m === 'prevzem' ? 'osebni prevzem' + (salon.pickup_address ? ` (prevzem na: ${salon.pickup_address})` : '') : 'dostava'}. ${tt.text} Zdaj vprašaj stranko za ime in priimek.`;
          break;
        }
        case 'set_name': {
          const nm = String(input.name || '').trim().slice(0, 80);
          if (!nm) { result = 'Ime je prazno — vprašaj znova.'; break; }
          newOrder.name = nm;
          result = (newOrder.mode === 'dostava' && !newOrder.address)
            ? `Ime zabeleženo. Zdaj vprašaj za naslov dostave${salon.delivery_area ? ` (dostavljamo: ${salon.delivery_area})` : ''}.`
            : `Ime zabeleženo. ${computeTotals(salon, newCart, newOrder.mode || 'dostava').text} Povzemi naročilo in vprašaj za potrditev.`;
          break;
        }
        case 'set_address': {
          const ad = String(input.address || '').trim().slice(0, 200);
          if (!ad) { result = 'Naslov je prazen — vprašaj znova.'; break; }
          newOrder.address = ad;
          result = `Naslov zabeležen. ${computeTotals(salon, newCart, newOrder.mode || 'dostava').text} Povzemi celotno naročilo (artikli, opomba, način, naslov, SKUPAJ) in vprašaj stranko: "Potrjujete naročilo?"`;
          break;
        }
        case 'confirm_order': {
          const missing = [];
          if (!newCart.length) missing.push('košarica je prazna');
          if (!newOrder.mode) missing.push('način prevzema');
          if (!newOrder.name) missing.push('ime');
          if (newOrder.mode === 'dostava' && !newOrder.address) missing.push('naslov dostave');
          if (missing.length) { result = 'Naročila še ni mogoče oddati, manjka: ' + missing.join(', ') + '. Vprašaj stranko po manjkajočem.'; break; }
          action = 'confirm';
          result = 'Naročilo se oddaja — sistem pošlje stranki potrditev z referenčno številko.';
          break;
        }
        default:
          result = 'Neznano orodje.';
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
    // Ob potrditvi naročila ne sprašujemo AI naprej — potrditev pošlje sistem
    if (action === 'confirm') {
      return { reply: '', cart: newCart, action, note: notes.join('; ') || null, order: newOrder };
    }
  }
  return { reply: '', cart: newCart, action, note: notes.join('; ') || null, order: newOrder };
}

module.exports = { askOrderAI, findService, computeTotals };
