const { findService, computeTotals } = require('./src/ai-order');
const services = [
  { id:'1', name:'Margerita', category:'Pice', price:7.5 },
  { id:'2', name:'Capricciosa', category:'Pice', price:9 },
  { id:'3', name:'Coca-Cola', category:'Pijače', price:2.5 },
  { id:'4', name:'Domači sok', category:'Pijače', price:3 },
  { id:'5', name:'Tiramisu', category:'Sladice', price:4.5 },
  { id:'6', name:'Dunajski zrezek', category:'Jedi', price:12 },
];
let pass=0, fail=0;
function eq(label, got, want){ const ok = got===want; console.log((ok?'OK  ':'FAIL')+' '+label+`  -> got=${got} want=${want}`); ok?pass++:fail++; }
const fs = (q)=>{ const r=findService(services,q); return r?r.name:null; };

// --- legit ujemanja MORAJO delovati ---
eq('kola -> Coca-Cola', fs('kola'), 'Coca-Cola');
eq('margarita -> Margerita', fs('margarita'), 'Margerita');
eq('1 veliko margarito -> Margerita', fs('1 veliko margarito'), 'Margerita');
eq('sok -> Domači sok', fs('sok'), 'Domači sok');
eq('tiramisu -> Tiramisu', fs('tiramisu'), 'Tiramisu');
eq('dunajski -> Dunajski zrezek', fs('dunajski'), 'Dunajski zrezek');
eq('capricosa (tipkarska) -> Capricciosa', fs('capricosa'), 'Capricciosa');

// --- imena strank NE smejo ujeti jedi (false positive test) ---
eq('ime "Ana" ne ujame jedi', fs('Ana'), null);
eq('ime "Tim" ne ujame jedi', fs('Tim'), null);
eq('naslov "Trubarjeva" ne ujame jedi', fs('Trubarjeva'), null);
eq('random "avto" ne ujame jedi', fs('avto'), null);

// --- computeTotals ---
const salon = { packaging_price:0.5, delivery_fee:2, pickup_packaging:true };
const cart = [ {id:'1',name:'Margerita',price:7.5,qty:2}, {id:'3',name:'Coca-Cola',price:2.5,qty:1} ];
const dt = computeTotals(salon, cart, 'dostava'); // artikli 17.5, embalaza 3*0.5=1.5, dostava 2 => 21.00
eq('dostava grand', dt.grand, '21.00');
const pt = computeTotals(salon, cart, 'prevzem'); // artikli 17.5 + embalaza 1.5 (pickup_packaging true) => 19.00
eq('prevzem grand', pt.grand, '19.00');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
