const BUSINESS_TYPES = {
  cosmetics: {
    label: 'Kozmeticni studio',
    greeting: 'Pozdravljeni! Sem avtomatski asistent kozmeticnega studia za narocanje terminov.',
    services: [
      { name: 'Nega obraza', price: 55, duration_minutes: 75, sort_order: 1 },
      { name: 'Oblikovanje obrvi', price: 15, duration_minutes: 20, sort_order: 2 },
      { name: 'Laminacija obrvi', price: 35, duration_minutes: 45, sort_order: 3 },
      { name: 'Depilacija', price: 25, duration_minutes: 30, sort_order: 4 },
      { name: 'Licenje', price: 45, duration_minutes: 60, sort_order: 5 }
    ]
  },
  hair: {
    label: 'Frizerji',
    greeting: 'Pozdravljeni! Sem avtomatski asistent za narocanje. Katero storitev zelite?',
    services: [
      { name: 'Strizenje', price: 20, duration_minutes: 30, sort_order: 1 },
      { name: 'Barvanje', price: 45, duration_minutes: 90, sort_order: 2 },
      { name: 'Barvanje + strizenje', price: 60, duration_minutes: 120, sort_order: 3 },
      { name: 'Highlights', price: 55, duration_minutes: 90, sort_order: 4 },
      { name: 'Tretma za lase', price: 25, duration_minutes: 45, sort_order: 5 }
    ]
  },
  beauty: {
    label: 'Nohti / Beauty',
    greeting: 'Pozdravljeni! Sem avtomatski asistent za narocanje na lepotne storitve.',
    services: [
      { name: 'Gel nohti', price: 35, duration_minutes: 90, sort_order: 1 },
      { name: 'Permanentno lakiranje', price: 25, duration_minutes: 60, sort_order: 2 },
      { name: 'Manikura', price: 20, duration_minutes: 45, sort_order: 3 },
      { name: 'Pedikura', price: 30, duration_minutes: 60, sort_order: 4 }
    ]
  },
  massage: {
    label: 'Masaze',
    greeting: 'Pozdravljeni! Sem avtomatski asistent za rezervacijo masaze.',
    services: [
      { name: 'Klasicna masaza 30 min', price: 30, duration_minutes: 30, sort_order: 1 },
      { name: 'Klasicna masaza 60 min', price: 50, duration_minutes: 60, sort_order: 2 },
      { name: 'Sportna masaza', price: 55, duration_minutes: 60, sort_order: 3 },
      { name: 'Sprostitvena masaza 90 min', price: 75, duration_minutes: 90, sort_order: 4 }
    ]
  },
  tattoo: {
    label: 'Tattoo studio',
    greeting: 'Pozdravljeni! Sem avtomatski asistent tattoo studia. Izberite termin ali posvet.',
    services: [
      { name: 'Tattoo posvet', price: 0, duration_minutes: 30, sort_order: 1 },
      { name: 'Majhen tattoo', price: 80, duration_minutes: 90, sort_order: 2 },
      { name: 'Srednji tattoo', price: 180, duration_minutes: 180, sort_order: 3 },
      { name: 'Kontrola / popravek', price: 0, duration_minutes: 30, sort_order: 4 }
    ]
  },
  dentist: {
    label: 'Zobozdravniki',
    greeting: 'Pozdravljeni! Sem avtomatski asistent ordinacije za narocanje terminov.',
    services: [
      { name: 'Pregled', price: 40, duration_minutes: 30, sort_order: 1 },
      { name: 'Ciscenje zobnega kamna', price: 60, duration_minutes: 45, sort_order: 2 },
      { name: 'Kontrola', price: 30, duration_minutes: 20, sort_order: 3 },
      { name: 'Nujni termin', price: 50, duration_minutes: 30, sort_order: 4 }
    ]
  },
  fitness: {
    label: 'Fitness & trenerji',
    greeting: 'Pozdravljeni! Sem avtomatski asistent za rezervacijo treningov in posvetov.',
    services: [
      { name: 'Uvodni posvet', price: 0, duration_minutes: 30, sort_order: 1 },
      { name: 'Osebni trening', price: 40, duration_minutes: 60, sort_order: 2 },
      { name: 'Trening v paru', price: 55, duration_minutes: 60, sort_order: 3 },
      { name: 'Meritve in plan', price: 35, duration_minutes: 45, sort_order: 4 }
    ]
  },
  wellness: {
    label: 'Wellness centri',
    greeting: 'Pozdravljeni! Sem avtomatski asistent wellness centra za rezervacije terminov.',
    services: [
      { name: 'Savna 60 min', price: 25, duration_minutes: 60, sort_order: 1 },
      { name: 'Wellness paket', price: 90, duration_minutes: 120, sort_order: 2 },
      { name: 'Spa ritual', price: 75, duration_minutes: 90, sort_order: 3 },
      { name: 'Jacuzzi termin', price: 35, duration_minutes: 60, sort_order: 4 }
    ]
  },
  veterinary: {
    label: 'Veterinarji',
    greeting: 'Pozdravljeni! Sem avtomatski asistent veterinarske ambulante za narocanje terminov.',
    services: [
      { name: 'Pregled', price: 35, duration_minutes: 30, sort_order: 1 },
      { name: 'Cepljenje', price: 30, duration_minutes: 20, sort_order: 2 },
      { name: 'Kontrolni pregled', price: 25, duration_minutes: 20, sort_order: 3 },
      { name: 'Nujni termin', price: 50, duration_minutes: 30, sort_order: 4 }
    ]
  },
  optical: {
    label: 'Optiki',
    greeting: 'Pozdravljeni! Sem avtomatski asistent optike za narocanje terminov.',
    services: [
      { name: 'Pregled vida', price: 30, duration_minutes: 30, sort_order: 1 },
      { name: 'Svetovanje za ocala', price: 0, duration_minutes: 30, sort_order: 2 },
      { name: 'Kontaktne lece - uvajanje', price: 35, duration_minutes: 45, sort_order: 3 },
      { name: 'Prevzem ocala', price: 0, duration_minutes: 15, sort_order: 4 }
    ]
  },
  physiotherapy: {
    label: 'Fizioterapevti',
    greeting: 'Pozdravljeni! Sem avtomatski asistent fizioterapije za rezervacijo terminov.',
    services: [
      { name: 'Prvi pregled', price: 50, duration_minutes: 45, sort_order: 1 },
      { name: 'Fizioterapija', price: 45, duration_minutes: 45, sort_order: 2 },
      { name: 'Manualna terapija', price: 55, duration_minutes: 60, sort_order: 3 },
      { name: 'Rehabilitacijska vadba', price: 40, duration_minutes: 60, sort_order: 4 }
    ]
  },
  photography: {
    label: 'Fotografi',
    greeting: 'Pozdravljeni! Sem avtomatski asistent fotografskega studia za rezervacije.',
    services: [
      { name: 'Portretno fotografiranje', price: 80, duration_minutes: 60, sort_order: 1 },
      { name: 'Druzinsko fotografiranje', price: 120, duration_minutes: 90, sort_order: 2 },
      { name: 'Poslovni portret', price: 60, duration_minutes: 45, sort_order: 3 },
      { name: 'Posvet za dogodek', price: 0, duration_minutes: 30, sort_order: 4 }
    ]
  },
  custom: {
    label: '+ vasa dejavnost',
    greeting: 'Pozdravljeni! Sem avtomatski asistent za narocanje. Kako vam lahko pomagam?',
    services: []
  }
};

function normalizeBusinessType(type) {
  return BUSINESS_TYPES[type] ? type : 'custom';
}

function getPreset(type) {
  return BUSINESS_TYPES[normalizeBusinessType(type)];
}

function listBusinessTypes() {
  return Object.entries(BUSINESS_TYPES).map(([value, preset]) => ({
    value,
    label: preset.label
  }));
}

function slugify(value) {
  return String(value || 'podjetje')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 48) || 'podjetje';
}

module.exports = { BUSINESS_TYPES, getPreset, listBusinessTypes, normalizeBusinessType, slugify };
