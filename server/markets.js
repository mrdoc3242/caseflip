// P2P marketplaces that buy a skin and have the seller send it straight to the player's trade link.
// No own Steam bots or inventory needed: the site pays from its balance on the marketplace.
//   Market.CSGO  https://market.csgo.com  API v2: buy-for, get-list-buy-info-by-custom-id, prices/USD.json, get-money
//   Waxpeer      https://waxpeer.com      API v1: buy-one-p2p-name, check-many-project-id, prices, user
// Prices are integers in 1/1000 USD on both APIs (1000 = $1.00).
'use strict';

const UA = { 'User-Agent': 'CaseFlip/1.0', Accept: 'application/json' };
async function getJson(url, timeoutMs = 20000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  let d; try { d = JSON.parse(text); } catch (e) { throw new Error(`HTTP ${r.status}: not JSON`); }
  return d;
}
const toUnits = usd => Math.round(usd * 1000);
const fromUnits = u => Math.round(u) / 1000;

function marketCsgo(key, base = 'https://market.csgo.com') {
  const api = (method, params = {}) => {
    const q = new URLSearchParams({ key, ...params });
    return getJson(`${base}/api/v2/${method}?${q}`);
  };
  return {
    id: 'marketcsgo', name: 'Market.CSGO', enabled: !!key,
    // public list, no key needed: { items: [{ market_hash_name, price: "13.754", volume }] }
    async prices() {
      const d = await getJson(`${base}/api/v2/prices/USD.json`, 60000);
      if (!d.success || !Array.isArray(d.items)) throw new Error('bad price list');
      const m = new Map();
      for (const it of d.items) { const p = parseFloat(it.price); if (it.market_hash_name && p > 0) m.set(it.market_hash_name, { price: p, count: +it.volume || 1 }); }
      return m;
    },
    async balance() { const d = await api('get-money'); if (d.currency && d.currency !== 'USD') throw new Error('Market.CSGO account currency must be USD, got ' + d.currency); return parseFloat(d.money) || 0; },
    // never retried by us: a repeated buy-for pays twice. Recovery goes through status(customId).
    async buy({ name, maxUsd, partner, token, customId }) {
      const d = await api('buy-for', { hash_name: name, price: String(toUnits(maxUsd)), partner, token, custom_id: customId });
      return d.success ? { ok: true, extId: String(d.id) } : { ok: false, error: String(d.error || d.message || 'buy failed') };
    },
    // stage 1 = new, 2 = item given, 5 = timed out / cancelled
    async status(customIds) {
      const q = new URLSearchParams({ key }); customIds.forEach(id => q.append('custom_id[]', id));
      const d = await getJson(`${base}/api/v2/get-list-buy-info-by-custom-id?${q}`);
      const out = {};
      for (const [cid, info] of Object.entries((d && d.data) || {})) {
        const st = +info.stage;
        out[cid] = { state: st === 2 ? 'delivered' : st === 5 ? 'failed' : 'pending', paid: info.paid != null ? fromUnits(+info.paid) : null, reason: info.cancellation_reason || null, tradeId: info.trade_id || null };
      }
      return out;
    },
  };
}

function waxpeer(key, base = 'https://api.waxpeer.com') {
  const api = (method, params = {}) => {
    const q = new URLSearchParams({ api: key }); for (const [k, v] of Object.entries(params)) { if (Array.isArray(v)) v.forEach(x => q.append(k, x)); else if (v != null) q.set(k, v); }
    return getJson(`${base}/v1/${method}?${q}`);
  };
  return {
    id: 'waxpeer', name: 'Waxpeer', enabled: !!key,
    // { items: [{ name, count, min }] }, min in 1/1000 USD
    async prices() {
      const d = await api('prices', { game: 'csgo', minified: 1 });
      if (!d.success || !Array.isArray(d.items)) throw new Error(d.msg || 'bad price list');
      const m = new Map();
      for (const it of d.items) if (it.name && it.min > 0 && it.count > 0) m.set(it.name, { price: fromUnits(it.min), count: it.count });
      return m;
    },
    async balance() { const d = await api('user'); if (!d.success) throw new Error(d.msg || 'user failed'); return fromUnits((d.user && d.user.wallet) || 0); },
    async buy({ name, maxUsd, partner, token, customId }) {
      const d = await api('buy-one-p2p-name', { name, price: toUnits(maxUsd), token, partner, project_id: customId, game: 'csgo' });
      return d.success ? { ok: true, extId: String(d.id) } : { ok: false, error: String(d.msg || 'buy failed') };
    },
    // status 5 = sent and accepted, 6 = cancelled; anything else is still in progress
    async status(customIds) {
      const d = await api('check-many-project-id', { id: customIds });
      const out = {};
      for (const t of (d && d.trades) || []) {
        const st = +t.status;
        out[t.project_id] = { state: st === 5 ? 'delivered' : st === 6 ? 'failed' : 'pending', paid: t.price != null ? fromUnits(+t.price) : null, reason: t.reason || null, tradeId: t.trade_id || null };
      }
      return out;
    },
  };
}

// MARKETS=marketcsgo,waxpeer sets the order; the cheapest market for an item is tried first anyway.
function fromEnv(env) {
  const all = {
    marketcsgo: marketCsgo(env.MARKETCSGO_KEY || '', env.MARKETCSGO_URL || undefined),
    waxpeer: waxpeer(env.WAXPEER_KEY || '', env.WAXPEER_URL || undefined),
  };
  const order = String(env.MARKETS || 'marketcsgo,waxpeer').split(',').map(s => s.trim()).filter(k => all[k]);
  return { all, order, list: () => order.map(k => all[k]) };
}

module.exports = { fromEnv, marketCsgo, waxpeer, toUnits, fromUnits };
