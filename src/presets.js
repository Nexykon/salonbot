const BUSINESS_TYPES = {
  hair: {
    label: 'Frizer',
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
    label: 'Zobozdravstvo',
    greeting: 'Pozdravljeni! Sem avtomatski asistent ordinacije za narocanje terminov.',
    services: [
      { name: 'Pregled', price: 40, duration_minutes: 30, sort_order: 1 },
      { name: 'Ciscenje zobnega kamna', price: 60, duration_minutes: 45, sort_order: 2 },
      { name: 'Kontrola', price: 30, duration_minutes: 20, sort_order: 3 },
      { name: 'Nujni termin', price: 50, duration_minutes: 30, sort_order: 4 }
    ]
  },
  custom: {
    label: 'Custom',
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
