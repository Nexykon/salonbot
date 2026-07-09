// End-to-end simulacija: mock Gemini (OpenAI-kompatibilen) sloj + prava askOrderAI orkestracija
process.env.AI_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'test-key';

const axios = require('axios');
let lastBody = null;
let script = [];   // vrsta scenarijev odgovorov modela
let stepIdx = 0;

// mock: vsak axios.post vrne naslednji scenarij; scenarij je funkcija(body)->choices
axios.post = async (url, body /*, cfg*/) => {
  lastBody = body;
  const gen = script[stepIdx++];
  if (!gen) throw new Error('ni več scenarijev (round loop je klical prevečkrat?)');
  const msg = gen(body);
  return { data: { choices: [ { finish_reason: msg.tool_calls ? 'tool_calls' : 'stop', message: msg } ] } };
};

// pomožnik za tvorbo tool_call sporočila
let tcId = 0;
const toolCall = (name, args) => ({ role:'assistant', content:null, tool_calls:[{ id:'tc'+(++tcId), type:'function', function:{ name, arguments: JSON.stringify(args||{}) } }] });
const say = (text) => ({ role:'assistant', content: text });

const db = require('./src/supabase');
db.getLastOrderItemsByPhone = async () => []; // ne rabimo baze

const { askOrderAI } = require('./src/ai-order');

const salon = { id:'s1', name:'Pizzerija Test', allow_delivery:true, allow_pickup:true,
  packaging_price:0.5, delivery_fee:2, pickup_packaging:true, pickup_address:'Glavna 1' };
const services = [
  { id:'1', name:'Margerita', category:'Pice', price:7.5 },
  { id:'3', name:'Coca-Cola', category:'Pijače', price:2.5 },
];

let pass=0, fail=0;
const ok=(l,c)=>{ console.log((c?'OK  ':'FAIL')+' '+l); c?pass++:fail++; };

(async () => {
  let cart=[], history=[], order={mode:null,name:null,address:null}, note='';
  const run = async (message) => {
    const r = await askOrderAI({ message, salon, services, cart, history, phone:'386', order, note });
    cart = r.cart; if(r.order) order=r.order; if(r.note) note=r.note;
    history = [...history, {role:'user',content:message}, {role:'assistant',content:r.reply||'ok'}].slice(-60);
    return r;
  };

  // T1: pozdrav (model vrne besedilo, brez orodja)
  script = [ () => say('Pozdravljeni v Pizzeriji Test! Želite kaj naročiti?') ];
  stepIdx=0;
  let r = await run('Živjo');
  ok('T1 pozdrav ni prazen', !!r.reply && r.reply.length>3);

  // T1b: preveri, da je v ZADNJEM zahtevku reasoning_effort:none + max_tokens 1024
  ok('T1 body.reasoning_effort === none', lastBody && lastBody.reasoning_effort==='none');
  ok('T1 body.max_tokens === 1024', lastBody && lastBody.max_tokens===1024);

  // T2: "želim margarito" -> model doda v košarico (qty 2)
  script = [ () => toolCall('add_to_cart', { item:'margarito', qty:2 }),
             () => say('Dodal sem 2x Margerita. Želite še kaj?') ];
  stepIdx=0;
  r = await run('želim dve margariti');
  ok('T2 v košarici Margerita', cart.some(i=>i.name==='Margerita'));
  ok('T2 količina 2', (cart.find(i=>i.name==='Margerita')||{}).qty===2);

  // T3: doda pijačo s posebnostjo -> ločena vrstica
  script = [ () => toolCall('add_to_cart', { item:'kola', qty:1, note:'brez ledu' }),
             () => say('Dodano. Še kaj?') ];
  stepIdx=0;
  r = await run('eno kolo brez ledu');
  ok('T3 kola dodana kot note vrstica', cart.some(i=>i.name==='Coca-Cola' && i.note==='brez ledu'));

  // T4: zaključek po korakih (checkout -> set_mode -> set_name -> set_address -> confirm)
  script = [ () => toolCall('checkout',{}), () => say('Dostava ali osebni prevzem?') ];
  stepIdx=0; r = await run('to je vse, zaključi');
  ok('T4 checkoutStarted', r.checkoutStarted===true);

  script = [ () => toolCall('set_mode',{mode:'dostava'}), () => say('Vaše ime in priimek?') ];
  stepIdx=0; r = await run('dostava');
  ok('T4 mode=dostava', order.mode==='dostava');

  script = [ () => toolCall('set_name',{name:'Janez Novak'}), () => say('Naslov za dostavo?') ];
  stepIdx=0; r = await run('Janez Novak');
  ok('T4 name shranjen', order.name==='Janez Novak');

  script = [ () => toolCall('set_address',{address:'Trubarjeva 5, Ljubljana'}), () => say('Povzetek ... Potrjujete naročilo?') ];
  stepIdx=0; r = await run('Trubarjeva 5, Ljubljana');
  ok('T4 naslov shranjen', order.address==='Trubarjeva 5, Ljubljana');

  script = [ () => toolCall('confirm_order',{}) ];
  stepIdx=0; r = await run('da, potrjujem');
  ok('T4 action=confirm', r.action==='confirm');

  // T5: večkratni tool klici v ENI rundi (test round<5 orkestracije)
  cart=[]; history=[]; order={mode:null,name:null,address:null}; note='';
  script = [ () => ({ role:'assistant', content:null, tool_calls:[
                 { id:'a', type:'function', function:{ name:'add_to_cart', arguments: JSON.stringify({item:'margarita',qty:1}) } },
                 { id:'b', type:'function', function:{ name:'add_to_cart', arguments: JSON.stringify({item:'kola',qty:3}) } } ] }),
             () => say('Dodal sem oboje.') ];
  stepIdx=0; r = await run('margarito in tri kole');
  ok('T5 dva artikla v en zamah', cart.length===2 && (cart.find(i=>i.name==='Coca-Cola')||{}).qty===3);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e=>{ console.error('NAPAKA:', e.message); process.exit(2); });
