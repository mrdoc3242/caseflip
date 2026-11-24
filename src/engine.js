// CaseFlip engine: catalog, RTP solver, provably-fair rolls. Pure logic, runs in browser and node.
(function (root) {
  const RTP = 0.975;
  const RARITY = {
    consumer:   { name: 'Ширпотреб',     color: '#b0c3d9', w: 1 },
    industrial: { name: 'Промышленное',  color: '#5e98d9', w: 1 },
    milspec:    { name: 'Армейское',     color: '#4b69ff', w: 1 },
    restricted: { name: 'Запрещённое',   color: '#8847ff', w: 1 },
    classified: { name: 'Засекреченное', color: '#d32ce6', w: 1 },
    covert:     { name: 'Тайное',        color: '#eb4b4b', w: 1 },
    gold:       { name: 'Редкий предмет',color: '#e4ae39', w: 1 },
  };
  // id, weapon, skin, rarity, price (virtual $), type (for icon)
  const RAW = [
    ['p250-sand','P250','Sand Dune','consumer',0.05,'pistol'],
    ['nova-predator','Nova','Predator','consumer',0.07,'shotgun'],
    ['mp9-storm','MP9','Storm','consumer',0.09,'smg'],
    ['g3-desert','G3SG1','Desert Storm','consumer',0.11,'sniper'],
    ['ump-urban','UMP-45','Urban DDPAT','industrial',0.18,'smg'],
    ['mac10-candy','MAC-10','Candy Apple','industrial',0.32,'smg'],
    ['fs-forest','Five-SeveN','Forest Night','industrial',0.25,'pistol'],
    ['glock-water','Glock-18','Water Elemental','restricted',2.4,'pistol'],
    ['p90-asiimov','P90','Asiimov','restricted',3.9,'smg'],
    ['usp-cortex','USP-S','Cortex','milspec',0.95,'pistol'],
    ['m4a4-evil','M4A4','Evil Daimyo','milspec',1.6,'rifle'],
    ['ak-elite','AK-47','Elite Build','milspec',1.9,'rifle'],
    ['famas-roll','FAMAS','Roll Cage','restricted',2.8,'rifle'],
    ['deagle-cobalt','Desert Eagle','Cobalt Disruption','restricted',5.2,'pistol'],
    ['awp-atheris','AWP','Atheris','restricted',4.6,'sniper'],
    ['ak-redline','AK-47','Redline','classified',14.5,'rifle'],
    ['m4a1-hyper','M4A1-S','Hyper Beast','classified',11.2,'rifle'],
    ['usp-kill','USP-S','Kill Confirmed','classified',22.0,'pistol'],
    ['deagle-blaze','Desert Eagle','Blaze','classified',48.0,'pistol'],
    ['awp-hyper','AWP','Hyper Beast','classified',26.0,'sniper'],
    ['ak-vulcan','AK-47','Vulcan','covert',95.0,'rifle'],
    ['m4a4-howl','M4A4','Howl','covert',1450.0,'rifle'],
    ['awp-asiimov','AWP','Asiimov','covert',110.0,'sniper'],
    ['ak-fire','AK-47','Fire Serpent','covert',520.0,'rifle'],
    ['m4a1-print','M4A1-S','Printstream','covert',160.0,'rifle'],
    ['awp-lore','AWP','Dragon Lore','covert',4800.0,'sniper'],
    ['glock-fade','Glock-18','Fade','covert',780.0,'pistol'],
    ['k-butterfly','★ Butterfly Knife','Fade','gold',2100.0,'knife'],
    ['k-karambit','★ Karambit','Doppler','gold',1250.0,'knife'],
    ['k-m9','★ M9 Bayonet','Tiger Tooth','gold',980.0,'knife'],
    ['k-flip','★ Flip Knife','Marble Fade','gold',540.0,'knife'],
    ['k-gut','★ Gut Knife','Slaughter','gold',190.0,'knife'],
    ['g-sport','★ Sport Gloves','Vice','gold',1650.0,'gloves'],
  ];
  const ITEMS = {};
  RAW.forEach(([id, weapon, skin, rarity, price, type]) => { ITEMS[id] = { id, weapon, skin, rarity, price, type }; });
  const CATALOG = Object.values(ITEMS).sort((a, b) => a.price - b.price);

  // Base rarity weights (relative drop frequency before RTP tilt), Valve-like ladder.
  const BASE_W = { consumer: 80, industrial: 40, milspec: 16, restricted: 5, classified: 1.2, covert: 0.3, gold: 0.08 };

  // Solve p_i ∝ w_i * v_i^(-λ) such that Σ p_i v_i = target. EV is monotone decreasing in λ.
  function solveOdds(values, weights, target) {
    const n = values.length;
    const vmin = Math.min(...values), vmax = Math.max(...values);
    if (!(target > vmin && target < vmax)) throw new Error('target EV outside item value range');
    const lv = values.map(Math.log);
    const probsAt = (lam) => {
      const lw = weights.map((w, i) => Math.log(w) - lam * lv[i]);
      const m = Math.max(...lw);
      const e = lw.map(x => Math.exp(x - m));
      const s = e.reduce((a, b) => a + b, 0);
      return e.map(x => x / s);
    };
    const ev = (p) => p.reduce((a, pi, i) => a + pi * values[i], 0);
    let lo = -60, hi = 60;
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2;
      if (ev(probsAt(mid)) > target) lo = mid; else hi = mid;
    }
    const p = probsAt((lo + hi) / 2);
    return p;
  }

  const CASE_DEFS = [
    { id: 'starter', name: 'Starter', price: 0.99, hue: 200, items: ['p250-sand','nova-predator','mp9-storm','g3-desert','ump-urban','mac10-candy','fs-forest','usp-cortex','m4a4-evil','ak-elite','glock-water'] },
    { id: 'rifle', name: 'Rifleman', price: 4.99, hue: 28, items: ['ump-urban','mac10-candy','m4a4-evil','ak-elite','famas-roll','p90-asiimov','m4a1-hyper','ak-redline','ak-vulcan','m4a1-print'] },
    { id: 'pistol', name: 'Sidearm', price: 2.49, hue: 150, items: ['p250-sand','fs-forest','usp-cortex','glock-water','deagle-cobalt','usp-kill','deagle-blaze','glock-fade'] },
    { id: 'sniper', name: 'Long Shot', price: 9.99, hue: 260, items: ['g3-desert','awp-atheris','p90-asiimov','awp-hyper','deagle-blaze','awp-asiimov','m4a1-print','awp-lore'] },
    { id: 'blade', name: 'Cold Steel', price: 24.99, hue: 45, items: ['famas-roll','deagle-cobalt','ak-redline','usp-kill','awp-hyper','ak-vulcan','k-gut','k-flip','k-m9','k-karambit','k-butterfly'] },
    { id: 'legend', name: 'Legend', price: 99.0, hue: 350, items: ['deagle-blaze','ak-vulcan','awp-asiimov','m4a1-print','ak-fire','glock-fade','k-flip','k-m9','k-karambit','m4a4-howl','g-sport','k-butterfly','awp-lore'] },
  ];
  const CASES = CASE_DEFS.map(c => {
    const items = c.items.map(id => ITEMS[id]);
    const p = solveOdds(items.map(i => i.price), items.map(i => BASE_W[i.rarity]), c.price * RTP);
    const drops = items.map((it, i) => ({ item: it, p })).map((d, i) => ({ item: d.item, p: p[i] }));
    drops.sort((a, b) => b.item.price - a.item.price);
    const ev = drops.reduce((a, d) => a + d.p * d.item.price, 0);
    return { ...c, drops, ev, rtp: ev / c.price };
  });

  // Pick a drop from cumulative probabilities with roll in [0,1).
  function pickByRoll(drops, roll) {
    let acc = 0;
    for (const d of drops) { acc += d.p; if (roll < acc) return d; }
    return drops[drops.length - 1];
  }

  // Upgrade: chance = RTP * input / target, capped at MAX_CHANCE. EV = RTP * input exactly.
  const UPGRADE_MAX_CHANCE = 0.80;
  // Upgrade bonuses. Positions are fractions u of the green (win) arc, u = needleRoll / chance.
  //  FLIP zone: centre 10% of the green arc -> coin flip, 50% doubles the win (x2), else win stays x1.
  //  Gold plate: appears on 25% of spins, 10% of the green arc wide, multiplier x1.5 / x2 / x3 (50% / 35% / 15%).
  const BONUS = { flipFrom: 0.45, flipTo: 0.55, flipP: 0.5, flipMult: 2, plateP: 0.25, plateW: 0.10, plateMults: [[1.5, 0.5], [2, 0.35], [3, 0.15]] };
  const plateEM = BONUS.plateMults.reduce((a, [m, p]) => a + m * p, 0);
  // expected value multiplier of a win; base chance is divided by it so total RTP stays exactly 97.5%
  const UPGRADE_K = 1 + (BONUS.flipTo - BONUS.flipFrom) * BONUS.flipP * (BONUS.flipMult - 1) + BONUS.plateP * BONUS.plateW * (plateEM - 1);
  function upgradeChance(inputValue, targetValue) {
    if (targetValue <= 0) return 0;
    return Math.min(RTP * inputValue / (targetValue * UPGRADE_K), 1);
  }
  function plateFromRoll(r0) {
    if (r0 >= BONUS.plateP) return null;
    const u = r0 / BONUS.plateP; let acc = 0, mult = BONUS.plateMults[BONUS.plateMults.length - 1][0];
    for (const [m, p] of BONUS.plateMults) { acc += p; if (u < acc) { mult = m; break; } }
    let from = (u * 7919) % 1 * 0.7; if (from >= BONUS.flipFrom - BONUS.plateW) from += BONUS.flipTo - BONUS.flipFrom + BONUS.plateW; // never overlaps FLIP
    return { mult, from, to: from + BONUS.plateW };
  }
  // r0: plate roll, r1: needle roll, r2: coin roll (used only when the needle lands in FLIP)
  function resolveUpgrade(chance, r0, r1, r2) {
    const plate = plateFromRoll(r0);
    const won = r1 < chance; if (!won) return { won, plate, mult: 0, zone: null };
    const u = r1 / chance;
    if (plate && u >= plate.from && u < plate.to) return { won, plate, mult: plate.mult, zone: 'plate' };
    if (u >= BONUS.flipFrom && u < BONUS.flipTo) { const heads = r2 < BONUS.flipP; return { won, plate, mult: heads ? BONUS.flipMult : 1, zone: 'flip', heads }; }
    return { won, plate, mult: 1, zone: null };
  }

  // Contract: 3..10 items, outcome pool = catalog items within [0.25x, 4x] of total; odds solved so EV = RTP * total.
  function contractOutcomes(totalValue) {
    const lo = totalValue * 0.25, hi = totalValue * 4;
    let pool = CATALOG.filter(i => i.price >= lo && i.price <= hi);
    const target = totalValue * RTP;
    const below = pool.filter(i => i.price < target), above = pool.filter(i => i.price > target);
    if (!below.length || !above.length) return null;
    // keep at most 6 each side, closest to target, for a readable list
    const b = below.sort((x, y) => y.price - x.price).slice(0, 6);
    const a = above.sort((x, y) => x.price - y.price).slice(0, 6);
    pool = [...b, ...a];
    const weights = pool.map(i => 1); // flat base; tilt solves EV
    const p = solveOdds(pool.map(i => i.price), weights, target);
    const out = pool.map((item, i) => ({ item, p: p[i] })).sort((x, y) => y.item.price - x.item.price);
    return out;
  }

  // ---- Provably fair: roll = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}`) -> first 52 bits / 2^52
  function hexToBytes(h) { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
  function bytesToHex(b) { return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''); }
  function getSubtle() { return (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : require('crypto').webcrypto.subtle; }
  async function sha256Hex(str) { return bytesToHex(await getSubtle().digest('SHA-256', new TextEncoder().encode(str))); }
  async function hmacHex(keyStr, msg) {
    const s = getSubtle();
    const k = await s.importKey('raw', new TextEncoder().encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return bytesToHex(await s.sign('HMAC', k, new TextEncoder().encode(msg)));
  }
  function hexToRoll(hex) { return parseInt(hex.slice(0, 13), 16) / Math.pow(2, 52); }
  async function fairRoll(serverSeed, clientSeed, nonce) { const h = await hmacHex(serverSeed, `${clientSeed}:${nonce}`); return { hash: h, roll: hexToRoll(h) }; }
  function randomHex(n) { const a = new Uint8Array(n); (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : require('crypto').webcrypto).getRandomValues(a); return bytesToHex(a); }

  const api = { RTP, RARITY, ITEMS, CATALOG, CASES, solveOdds, pickByRoll, upgradeChance, UPGRADE_MAX_CHANCE, UPGRADE_K, BONUS, plateFromRoll, resolveUpgrade, contractOutcomes, sha256Hex, hmacHex, hexToRoll, fairRoll, randomHex };
  if (typeof module !== 'undefined') module.exports = api; else root.CF = api;
})(this);
