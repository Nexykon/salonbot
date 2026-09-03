/**
 * pos-adapters.js — FlowTek POS Integration
 * Adapters: Poster POS, Square, iiko
 * Each adapter exposes:
 *   getMenu(token, account, options)  → [{ id, name, price, category, description }]
 *   createOrder(token, account, cart, options) → { success, orderId, message }
 */

const axios = require('axios');

// ─── POSTER POS ────────────────────────────────────────────────────────────────
// API docs: https://dev.joinposter.com/docs/v3/
// Auth: ?token=xxx query param
// account = sub-domain (e.g. "myrestaurant" → myrestaurant.joinposter.com)

const PosterAdapter = {
  name: 'Poster POS',

  async getMenu(token, account) {
    try {
      const url = `https://joinposter.com/api/menu.getProducts?token=${token}`;
      const r = await axios.get(url, { timeout: 10000 });
      if (r.data.error) throw new Error(r.data.error);

      const products = r.data.response || [];
      return products
        .filter(p => p.hidden !== '1' && p.out !== 1)
        .map(p => ({
          id:          p.product_id,
          name:        p.product_name,
          price:       parseFloat(p.price?.[1]?.price || p.price?.[0]?.price || 0) / 100,
          category:    p.category_name || 'Ostalo',
          description: p.description || '',
          photo:       p.photo || null,
        }));
    } catch (e) {
      throw new Error(`Poster menu error: ${e.message}`);
    }
  },

  async createOrder(token, account, cart, options = {}) {
    try {
      const spotId = options.spot_id || 1;
      const tableId = options.table_id || null;

      const products = cart.map(item => ({
        product_id:      item.id,
        count:           item.qty,
        modification_id: item.modification_id || 0,
      }));

      const body = {
        spot_id:  spotId,
        products,
        ...(tableId ? { table_id: tableId } : {}),
        ...(options.comment ? { comment: options.comment } : {}),
      };

      const url = `https://joinposter.com/api/transactions.createOrder?token=${token}`;
      const r = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      if (r.data.error) throw new Error(r.data.error);

      const incoming = r.data.response;
      return {
        success: true,
        orderId: incoming?.incoming_id || incoming?.order_id || '?',
        message: 'Naročilo uspešno poslano v Poster POS',
      };
    } catch (e) {
      return { success: false, orderId: null, message: `Poster napaka: ${e.message}` };
    }
  },

  async testConnection(token, account) {
    try {
      const url = `https://joinposter.com/api/access.getAccessToken?token=${token}`;
      const r = await axios.get(url, { timeout: 8000 });
      if (r.data.error) return { ok: false, msg: r.data.error };
      return { ok: true, msg: 'Poster POS — povezava uspešna ✅' };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  },
};

// ─── SQUARE ───────────────────────────────────────────────────────────────────
// API docs: https://developer.squareup.com/docs
// Auth: Bearer token (access_token)
// account = location_id

const SquareAdapter = {
  name: 'Square',

  _headers(token) {
    return {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-01-18',
    };
  },

  async getMenu(token, account) {
    try {
      const url = 'https://connect.squareup.com/v2/catalog/list?types=ITEM';
      const r = await axios.get(url, { headers: this._headers(token), timeout: 10000 });
      const items = (r.data.objects || []).filter(o => o.type === 'ITEM');

      const menu = [];
      for (const item of items) {
        const d = item.item_data;
        for (const v of (d.variations || [])) {
          const vd = v.item_variation_data;
          menu.push({
            id:          v.id,
            name:        d.name + (d.variations.length > 1 ? ` (${vd.name})` : ''),
            price:       (vd.price_money?.amount || 0) / 100,
            category:    d.category?.id || 'Ostalo',
            description: d.description || '',
            photo:       null,
          });
        }
      }
      return menu;
    } catch (e) {
      throw new Error(`Square menu error: ${e.message}`);
    }
  },

  async createOrder(token, account, cart, options = {}) {
    try {
      const locationId = account;
      const lineItems = cart.map(item => ({
        catalog_object_id: item.id,
        quantity:          String(item.qty),
        ...(options.comment ? { note: options.comment } : {}),
      }));

      const body = {
        idempotency_key: `flowtek-${Date.now()}`,
        order: {
          location_id: locationId,
          line_items:  lineItems,
          ...(options.table_id ? { metadata: { table: String(options.table_id) } } : {}),
        },
      };

      const r = await axios.post(
        'https://connect.squareup.com/v2/orders',
        body,
        { headers: this._headers(token), timeout: 10000 }
      );

      const order = r.data.order;
      return {
        success: true,
        orderId: order?.id || '?',
        message: 'Naročilo uspešno poslano v Square',
      };
    } catch (e) {
      const errMsg = e.response?.data?.errors?.[0]?.detail || e.message;
      return { success: false, orderId: null, message: `Square napaka: ${errMsg}` };
    }
  },

  async testConnection(token, account) {
    try {
      const r = await axios.get(
        `https://connect.squareup.com/v2/locations/${account}`,
        { headers: this._headers(token), timeout: 8000 }
      );
      if (r.data.location) return { ok: true, msg: `Square — ${r.data.location.name} ✅` };
      return { ok: false, msg: 'Napačen location ID' };
    } catch (e) {
      const errMsg = e.response?.data?.errors?.[0]?.detail || e.message;
      return { ok: false, msg: errMsg };
    }
  },
};

// ─── iiko Cloud ───────────────────────────────────────────────────────────────
// API docs: https://api-ru.iiko.services/api/1/
// Auth: POST /api/1/access_token → token (expires 1h)
// account = organizationId (UUID)
// token = apiLogin (not the bearer — we request bearer on each call)

const iikoAdapter = {
  name: 'iiko',

  _base: 'https://api-ru.iiko.services/api/1',

  async _getBearer(apiLogin) {
    const r = await axios.post(
      `${this._base}/access_token`,
      { apiLogin },
      { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }
    );
    return r.data.token;
  },

  _headers(bearer) {
    return {
      Authorization:  `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    };
  },

  async getMenu(token, account) {
    try {
      const bearer = await this._getBearer(token);

      // Fetch external menu (recommended for ordering)
      const r = await axios.post(
        `${this._base}/nomenclature`,
        { organizationId: account },
        { headers: this._headers(bearer), timeout: 12000 }
      );

      const groups = r.data.groups || [];
      const products = r.data.products || [];

      // Build category map
      const catMap = {};
      for (const g of groups) catMap[g.id] = g.name;

      return products
        .filter(p => p.isDeleted !== true && p.isHidden !== true)
        .map(p => ({
          id:          p.id,
          name:        p.name,
          price:       p.sizePrices?.[0]?.price?.currentPrice || 0,
          category:    catMap[p.parentGroup] || 'Ostalo',
          description: p.description || '',
          photo:       null,
        }));
    } catch (e) {
      throw new Error(`iiko menu error: ${e.message}`);
    }
  },

  async createOrder(token, account, cart, options = {}) {
    try {
      const bearer = await this._getBearer(token);

      // Get terminal groups (needed for order creation)
      const tgRes = await axios.post(
        `${this._base}/terminal_groups`,
        { organizationIds: [account] },
        { headers: this._headers(bearer), timeout: 8000 }
      );
      const terminalGroupId = tgRes.data.terminalGroups?.[0]?.items?.[0]?.id;
      if (!terminalGroupId) throw new Error('Ni najden terminal group');

      const items = cart.map(item => ({
        productId: item.id,
        amount:    item.qty,
        ...(item.modification_id ? { modifiers: [{ id: item.modification_id, amount: 1 }] } : {}),
      }));

      const body = {
        organizationId:  account,
        terminalGroupId,
        order: {
          orderTypeId: options.order_type_id || null,
          items,
          comment:    options.comment || '',
          ...(options.table_id ? { tableIds: [options.table_id] } : {}),
        },
      };

      const r = await axios.post(
        `${this._base}/order/create`,
        body,
        { headers: this._headers(bearer), timeout: 12000 }
      );

      const orderId = r.data.orderInfo?.id || r.data.correlationId || '?';
      return {
        success: true,
        orderId,
        message: 'Naročilo uspešno poslano v iiko',
      };
    } catch (e) {
      const errMsg = e.response?.data?.description || e.message;
      return { success: false, orderId: null, message: `iiko napaka: ${errMsg}` };
    }
  },

  async testConnection(token, account) {
    try {
      const bearer = await this._getBearer(token);
      const r = await axios.post(
        `${this._base}/organizations`,
        { organizationIds: [account], returnAdditionalInfo: false, includeDisabled: false },
        { headers: this._headers(bearer), timeout: 8000 }
      );
      const org = r.data.organizations?.[0];
      if (org) return { ok: true, msg: `iiko — ${org.name} ✅` };
      return { ok: false, msg: 'Organization ID ni najden' };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  },
};

// ─── LOYVERSE ─────────────────────────────────────────────────────────────────
// API docs: https://developer.loyverse.com/docs/  (readthedocs: loyverse.readthedocs.io)
// Auth: Bearer token (Loyverse Back Office → Settings → Access tokens)
// account = store_id (Loyverse Store ID)
// OPOMBA: Loyverse API nima koncepta "odprtega naročila/tickета" — createOrder
// ustvari RAČUN (receipt = zaključena prodaja) z opombo. Za kuhinjo je to viden
// zapis prodaje; če lokal želi le odprt bon, to Loyverse API (zaenkrat) ne omogoča.

const LoyverseAdapter = {
  name: 'Loyverse',

  _base: 'https://api.loyverse.com/v1.0',

  _headers(token) {
    return {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  },

  async getMenu(token, account) {
    try {
      // Kategorije (id → ime)
      const catRes = await axios.get(`${this._base}/categories?limit=250`, { headers: this._headers(token), timeout: 10000 });
      const catMap = {};
      for (const c of (catRes.data.categories || [])) catMap[c.id] = c.category_name || c.name || 'Ostalo';

      // Artikli (vsaka varianta = ena postavka menija)
      const itemsRes = await axios.get(`${this._base}/items?limit=250`, { headers: this._headers(token), timeout: 12000 });
      const items = itemsRes.data.items || [];

      const menu = [];
      for (const it of items) {
        const variants = it.variants || [];
        for (const v of variants) {
          // Cena: če obstaja cena za ta store, jo uporabi, sicer default_price
          let price = v.default_price;
          const st = (v.stores || []).find(s => s.store_id === account);
          if (st && st.price != null) price = st.price;
          menu.push({
            id:          v.variant_id,
            name:        it.item_name + (variants.length > 1 && v.option1_value ? ` (${v.option1_value})` : ''),
            price:       Number(price || 0),
            category:    catMap[it.category_id] || 'Ostalo',
            description: it.description || '',
            photo:       (it.image_url) || null,
          });
        }
      }
      return menu;
    } catch (e) {
      const msg = e.response?.data?.errors?.[0]?.details || e.response?.data?.message || e.message;
      throw new Error(`Loyverse menu error: ${msg}`);
    }
  },

  async _firstPaymentTypeId(token) {
    const r = await axios.get(`${this._base}/payment_types?limit=1`, { headers: this._headers(token), timeout: 8000 });
    return r.data.payment_types?.[0]?.id || null;
  },

  async createOrder(token, account, cart, options = {}) {
    try {
      const storeId = account;
      if (!storeId) throw new Error('Manjka Store ID (polje Račun).');

      const lineItems = cart.map(item => ({
        variant_id: item.id,
        quantity:   item.qty,
        price:      item.price != null ? Number(item.price) : undefined,
      }));

      const total = cart.reduce((s, it) => s + (Number(it.price || 0) * it.qty), 0);
      const paymentTypeId = options.payment_type_id || await this._firstPaymentTypeId(token);
      if (!paymentTypeId) throw new Error('Ni najden noben način plačila (payment type) v Loyverse.');

      const body = {
        store_id:   storeId,
        line_items: lineItems,
        payments:   [{ payment_type_id: paymentTypeId, money_amount: total }],
        ...(options.comment ? { note: options.comment } : {}),
      };

      const r = await axios.post(`${this._base}/receipts`, body, { headers: this._headers(token), timeout: 12000 });
      const receiptNo = r.data.receipt_number || r.data.receipt?.receipt_number || '?';
      return {
        success: true,
        orderId: receiptNo,
        message: 'Naročilo zabeleženo v Loyverse (račun ' + receiptNo + ')',
      };
    } catch (e) {
      const msg = e.response?.data?.errors?.[0]?.details || e.response?.data?.message || e.message;
      return { success: false, orderId: null, message: `Loyverse napaka: ${msg}` };
    }
  },

  async testConnection(token, account) {
    try {
      const r = await axios.get(`${this._base}/stores?limit=250`, { headers: this._headers(token), timeout: 8000 });
      const stores = r.data.stores || [];
      if (!stores.length) return { ok: false, msg: 'Ni najdenih trgovin (preveri token).' };
      if (account) {
        const match = stores.find(s => s.id === account);
        if (!match) return { ok: false, msg: `Store ID "${account}" ne obstaja. Razpoložljivi: ` + stores.map(s => `${s.name} = ${s.id}`).join(', ') };
        return { ok: true, msg: `Loyverse — ${match.name} ✅` };
      }
      return { ok: true, msg: `Loyverse — povezava OK. Store ID-ji: ` + stores.map(s => `${s.name} = ${s.id}`).join(', ') };
    } catch (e) {
      const msg = e.response?.data?.errors?.[0]?.details || e.response?.data?.message || e.message;
      return { ok: false, msg };
    }
  },
};

// ─── FACTORY ──────────────────────────────────────────────────────────────────

const ADAPTERS = {
  poster:   PosterAdapter,
  square:   SquareAdapter,
  iiko:     iikoAdapter,
  loyverse: LoyverseAdapter,
};

function getAdapter(posType) {
  const a = ADAPTERS[posType];
  if (!a) throw new Error(`Neznan POS tip: ${posType}. Veljavni: poster, square, iiko, loyverse`);
  return a;
}

module.exports = { getAdapter, ADAPTERS, PosterAdapter, SquareAdapter, iikoAdapter, LoyverseAdapter };
