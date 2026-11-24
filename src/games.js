// CaseFlip game rules shared by the browser (demo mode) and the Node server.
// Every action mutates a player state object S and returns a result for the UI.
// Rolls come from ctx.roll(kind) -> [0,1), provably fair on both sides.
(function (root) {
  const CF = (typeof module !== 'undefined') ? require('./engine.js') : root.CF;
  const r2 = v => Math.round(v * 100) / 100;
  const RK = ['consumer', 'industrial', 'milspec', 'restricted', 'classified', 'covert', 'gold'];
  const WEARS = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];

  class GameError extends Error { constructor(msg, code) { super(msg); this.code = code || 'bad_request'; } }
  const fail = (msg, code) => { throw new GameError(msg, code); };

  // ---------- catalog ----------
  function buildCatalog(d) {
    const last = Math.floor((d.skins.length - 1) / 100);
    const CAT = d.items.map(([si, w, st, price]) => {
      const [weapon, skin, ri] = d.skins[si];
      const name = (st === 1 ? (weapon.startsWith('★') ? '★ StatTrak™ ' + weapon.slice(2) : 'StatTrak™ ' + weapon) : st === 2 ? 'Souvenir ' + weapon : weapon) + ' | ' + skin + (w < 5 ? ' (' + WEARS[w] + ')' : '');
      const sheet = Math.floor(si / 100), k = si % 100, rows = sheet === last ? Math.ceil((d.skins.length - sheet * 100) / 10) : 10;
      return { id: 'm:' + name, name, weapon, skin, wear: w, st, rarity: RK[ri], price, spr: { sheet, c: k % 10, r: Math.floor(k / 10), rows } };
    });
    const CATMAP = new Map(CAT.map(i => [i.id, i]));
    return { CAT, CATMAP, updated: d.updated };
  }
  function makeIT(CATMAP) {
    return id => CF.ITEMS[id] || CATMAP.get(id) || { id, weapon: 'Предмет', skin: 'недоступен', rarity: 'consumer', price: 0, type: 'rifle' };
  }

  // ---------- state ----------
  function newState(opts = {}) {
    const S = { v: 2, balance: opts.balance ?? 1000, inv: [], uid: 1, stats: { wager: 0, ret: 0, n: 0, bonus: 0 }, log: [], revealed: [], drops: [], top: [], recent: [], quests: null, freeCases: 0, lvlSeen: 1 };
    (opts.starter || []).forEach(id => S.inv.push({ uid: S.uid++, id }));
    return S;
  }
  function migrate(S) {
    S.stats.bonus = S.stats.bonus || 0; S.freeCases = S.freeCases || 0; S.lvlSeen = S.lvlSeen || levelOf(S.stats.wager).lv;
    S.drops = S.drops || []; S.top = S.top || []; S.recent = S.recent || []; S.revealed = S.revealed || []; S.log = S.log || [];
    return S;
  }
  function levelOf(xp) { let lv = 1, need = 10; while (xp >= need) { xp -= need; lv++; need = Math.round(need * 1.35); } return { lv, xp, need }; }

  function addItem(S, id) { const it = { uid: S.uid++, id }; S.inv.unshift(it); S.drops = [id, ...S.drops].slice(0, 30); return it; }
  function takeItems(S, uids, IT) {
    uids = [...new Set((uids || []).map(Number))];
    const items = uids.map(u => S.inv.find(x => x.uid === u));
    if (items.some(x => !x)) fail('Предмет не найден в инвентаре');
    S.inv = S.inv.filter(x => !uids.includes(x.uid));
    return { items, value: r2(items.reduce((a, x) => a + IT(x.id).price, 0)) };
  }
  function recordDrop(S, IT, id, src, now) {
    const e = { id, p: IT(id).price, src, t: now };
    S.recent = [e, ...S.recent].slice(0, 30);
    S.top = [...S.top, e].sort((a, b) => b.p - a.p).slice(0, 20);
    return e;
  }
  function stat(S, w, r, kind, detail) {
    const before = levelOf(S.stats.wager).lv;
    S.stats.wager = r2(S.stats.wager + w); S.stats.ret = r2(S.stats.ret + r); S.stats.n++;
    if (S.log[0]) { S.log[0].w = w; S.log[0].r = r; S.log[0].detail = detail; }
    const after = levelOf(S.stats.wager).lv;
    if (after > S.lvlSeen) { S.freeCases += after - Math.max(before, S.lvlSeen); S.lvlSeen = after; }
    track(S, 'wager', w);
  }
  function debit(S, amount) { amount = r2(amount); if (!(amount >= 0)) fail('Неверная сумма'); if (S.balance + 1e-9 < amount) fail('Недостаточно средств', 'no_funds'); S.balance = r2(S.balance - amount); }
  function credit(S, amount) { S.balance = r2(S.balance + amount); }

  // ---------- daily quests (reset at 00:00 Moscow) ----------
  const QUESTS = [
    { id: 'cases5', type: 'case', goal: 5, reward: 3, ru: 'Открыть 5 кейсов', en: 'Open 5 cases' },
    { id: 'up3', type: 'upgrade', goal: 3, reward: 3, ru: 'Сделать 3 апгрейда', en: 'Do 3 upgrades' },
    { id: 'ct1', type: 'contract', goal: 1, reward: 2, ru: 'Подписать контракт', en: 'Sign a contract' },
    { id: 'bt1', type: 'battle', goal: 1, reward: 3, ru: 'Сыграть батл', en: 'Play a battle' },
    { id: 'cr3', type: 'crash', goal: 3, reward: 2, ru: 'Сделать 3 ставки в краше', en: 'Place 3 crash bets' },
    { id: 'w25', type: 'wager', goal: 25, reward: 5, ru: 'Поставить $25 суммарно', en: 'Wager $25 in total' },
  ];
  const mskDay = now => new Date(now + 3 * 3600e3).toISOString().slice(0, 10);
  function questsFor(S, now) {
    const day = mskDay(now || Date.now());
    if (!S.quests || S.quests.day !== day) S.quests = { day, p: {}, c: {} };
    return S.quests;
  }
  function track(S, type, amount = 1) { const q = questsFor(S, S._now); q.p[type] = r2((q.p[type] || 0) + amount); }

  // ---------- actions ----------
  const A = {};

  A.openCase = async (ctx, { caseId, free }) => {
    const { S, IT, roll, now } = ctx;
    const c = CF.CASES.find(x => x.id === caseId) || fail('Кейс не найден');
    if (free) { if (S.freeCases < 1) fail('Нет бесплатных кейсов'); if (c.id !== 'starter') fail('Бесплатно открывается только Starter'); S.freeCases--; }
    else debit(S, c.price);
    const r = await roll('case:' + c.id + (free ? ':free' : ''));
    const drop = CF.pickByRoll(c.drops, r).item;
    const inst = addItem(S, drop.id); const feed = recordDrop(S, IT, drop.id, 'case', now);
    if (!free) { stat(S, c.price, drop.price, 'case', drop.weapon + ' | ' + drop.skin); track(S, 'case'); }
    else if (S.log[0]) { S.log[0].w = 0; S.log[0].r = drop.price; S.log[0].detail = 'бесплатный кейс: ' + drop.weapon + ' | ' + drop.skin; }
    return { drop: drop.id, uid: inst.uid, roll: r, nonce: S.log[0] && S.log[0].nonce, feed };
  };

  A.sell = async (ctx, { uids }) => {
    const { S, IT } = ctx; if (!uids || !uids.length) fail('Ничего не выбрано');
    const { value } = takeItems(S, uids, IT); credit(S, value); return { value };
  };

  A.buy = async (ctx, { id }) => {
    const { S, IT, CATMAP } = ctx; if (!CATMAP.has(id)) fail('Скин не найден');
    const it = IT(id); debit(S, it.price); const inst = addItem(S, id); return { uid: inst.uid, price: it.price };
  };

  A.upgrade = async (ctx, { uids = [], bal = 0, target }) => {
    const { S, IT, CATMAP, roll, now } = ctx;
    if (!CATMAP.has(target)) fail('Выберите цель');
    bal = r2(Math.max(0, +bal || 0));
    const tgt = IT(target);
    const skinsV = r2((uids || []).reduce((a, u) => { const x = S.inv.find(y => y.uid === +u); if (!x) fail('Предмет не найден в инвентаре'); return a + IT(x.id).price; }, 0));
    const inV = r2(skinsV + bal);
    if (inV <= 0) fail('Пустая ставка');
    if (tgt.price < inV * CF.RTP / CF.UPGRADE_MAX_CHANCE - 1e-9) fail('Цель слишком дешёвая для этой ставки');
    if (S.balance + 1e-9 < bal) fail('Недостаточно средств', 'no_funds');
    const ch = CF.upgradeChance(inV, tgt.price);
    takeItems(S, uids, IT); debit(S, bal);
    const r0 = await roll('upgrade:plate'); const plate = CF.plateFromRoll(r0);
    if (S.log[0]) S.log[0].detail = plate ? 'плашка x' + plate.mult : 'без плашки';
    const r1 = await roll('upgrade');
    const pre = CF.resolveUpgrade(ch, r0, r1, 0);
    const rr2 = pre.zone === 'flip' ? await roll('upgrade:flip') : 0;
    const o = pre.zone === 'flip' ? CF.resolveUpgrade(ch, r0, r1, rr2) : pre;
    const payout = o.won ? r2(tgt.price * o.mult) : 0;
    let feed = null;
    if (o.won) { addItem(S, target); feed = recordDrop(S, IT, target, 'upgrade', now); if (o.mult > 1) credit(S, tgt.price * (o.mult - 1)); }
    stat(S, inV, payout, 'upgrade', (o.won ? 'WIN ' : 'LOSE ') + tgt.name + ' @' + (ch * 100).toFixed(2) + '%' + (o.mult > 1 ? ' x' + o.mult : '') + (o.zone ? ' [' + o.zone + ']' : ''));
    track(S, 'upgrade');
    return { chance: ch, inV, r0, r1, r2: rr2, plate, won: o.won, mult: o.mult, zone: o.zone, heads: o.heads, payout, feed };
  };

  function contractPool(CAT, total) {
    const pool = (CAT && CAT.length ? CAT : CF.CATALOG).filter(i => i.st !== 2);
    const picked = [], used = new Set();
    for (let k = 0; k < 12; k++) {
      const want = total * 0.25 * Math.pow(16, k / 11);
      let best = null; for (const i of pool) { if (used.has(i.id) || i.price < total * 0.25 || i.price > total * 4) continue; if (!best || Math.abs(Math.log(i.price / want)) < Math.abs(Math.log(best.price / want))) best = i; }
      if (best) { used.add(best.id); picked.push(best); }
    }
    const target = total * CF.RTP;
    if (!picked.some(i => i.price < target) || !picked.some(i => i.price > target)) return null;
    const p = CF.solveOdds(picked.map(i => i.price), picked.map(() => 1), target);
    return picked.map((item, i) => ({ item, p: p[i] })).sort((a, b) => b.item.price - a.item.price);
  }

  A.contract = async (ctx, { uids }) => {
    const { S, IT, CAT, roll, now } = ctx;
    uids = [...new Set((uids || []).map(Number))];
    if (uids.length < 3 || uids.length > 10) fail('Нужно от 3 до 10 скинов');
    const total = r2(uids.reduce((a, u) => { const x = S.inv.find(y => y.uid === u); if (!x) fail('Предмет не найден в инвентаре'); return a + IT(x.id).price; }, 0));
    const outs = contractPool(CAT, total) || fail('Для такой суммы нет подходящих предметов');
    takeItems(S, uids, IT);
    const r = await roll('contract');
    const got = CF.pickByRoll(outs, r).item;
    addItem(S, got.id); const feed = recordDrop(S, IT, got.id, 'contract', now);
    stat(S, total, got.price, 'contract', got.name || got.weapon + ' | ' + got.skin); track(S, 'contract');
    return { got: got.id, total, roll: r, feed };
  };

  // Case battle vs the house bot: both sides open the same cases, higher total takes every item.
  // Symmetric, so the player's expected return equals the cases' RTP (97.5%).
  A.battle = async (ctx, { cases }) => {
    const { S, IT, roll, now } = ctx;
    if (!Array.isArray(cases) || cases.length < 1 || cases.length > 10) fail('Выберите от 1 до 10 кейсов');
    const cs = cases.map(id => CF.CASES.find(c => c.id === id) || fail('Кейс не найден'));
    const cost = r2(cs.reduce((a, c) => a + c.price, 0));
    debit(S, cost);
    const rounds = [];
    for (const c of cs) {
      const rp = await roll('battle:you:' + c.id), rb = await roll('battle:bot:' + c.id);
      rounds.push({ c: c.id, you: CF.pickByRoll(c.drops, rp).item.id, bot: CF.pickByRoll(c.drops, rb).item.id, rp, rb });
    }
    const you = r2(rounds.reduce((a, x) => a + IT(x.you).price, 0)), bot = r2(rounds.reduce((a, x) => a + IT(x.bot).price, 0));
    let tie = false, winner = you > bot ? 'you' : bot > you ? 'bot' : null;
    if (!winner) { const t = await roll('battle:tiebreak'); winner = t < 0.5 ? 'you' : 'bot'; tie = true; }
    let payout = 0; const won = [];
    if (winner === 'you') for (const x of rounds) { won.push(addItem(S, x.you).uid, addItem(S, x.bot).uid); payout = r2(you + bot); }
    let feed = null; if (winner === 'you') { const best = rounds.flatMap(x => [x.you, x.bot]).sort((a, b) => IT(b).price - IT(a).price)[0]; feed = recordDrop(S, IT, best, 'battle', now); }
    stat(S, cost, payout, 'battle', `${winner === 'you' ? 'WIN' : 'LOSE'} ${fmtUsd(you)} vs ${fmtUsd(bot)}${tie ? ' (жребий)' : ''}`); track(S, 'battle');
    return { rounds, you, bot, winner, tie, cost, payout, feed };
  };
  const fmtUsd = v => '$' + v.toFixed(2);

  // Crash: P(crash >= m) = 0.975 / m, crash point floored to 0.01 so every cash-out target has EV exactly 97.5%.
  function crashPoint(r) { const x = CF.RTP / (1 - r); return x < 1 ? 1 : Math.floor(x * 100) / 100; }
  A.crashSolo = async (ctx, { bet, auto }) => { // demo mode: one-player round, cash-out target fixed before the round
    const { S, roll } = ctx;
    bet = r2(+bet); auto = Math.floor((+auto || 0) * 100) / 100;
    if (!(bet >= 0.1)) fail('Минимальная ставка $0.10'); if (!(auto >= 1.01 && auto <= 1000)) fail('Автовывод от x1.01 до x1000');
    debit(S, bet);
    const r = await roll('crash'); const point = crashPoint(r);
    const won = point >= auto; const payout = won ? r2(bet * auto) : 0; if (won) credit(S, payout);
    stat(S, bet, payout, 'crash', `краш x${point.toFixed(2)}, вывод x${auto.toFixed(2)}`); track(S, 'crash');
    return { point, auto, won, payout, roll: r };
  };

  A.dailyBonus = async (ctx) => {
    const { S, now } = ctx;
    if (S.bonusAt && now - S.bonusAt < 864e5) fail('Бонус уже получен, приходите позже', 'cooldown');
    S.streak = S.bonusAt && now - S.bonusAt < 2 * 864e5 ? (S.streak || 0) + 1 : 1;
    const L = levelOf(S.stats.wager).lv; const amt = Math.min(250, 25 + (S.streak - 1) * 15 + L * 5);
    S.bonusAt = now; credit(S, amt); S.stats.bonus = r2(S.stats.bonus + amt);
    return { amount: amt, streak: S.streak };
  };

  A.questClaim = async (ctx, { id }) => {
    const { S, now } = ctx; const q = questsFor(S, now); const def = QUESTS.find(x => x.id === id) || fail('Задание не найдено');
    if (q.c[id]) fail('Награда уже получена'); if ((q.p[def.type] || 0) < def.goal) fail('Задание ещё не выполнено');
    q.c[id] = 1; credit(S, def.reward); S.stats.bonus = r2(S.stats.bonus + def.reward);
    return { reward: def.reward };
  };

  // provably-fair seed management lives with the caller (server keeps the secret seed out of S)
  A.setClientSeed = async (ctx, { seed }) => { seed = String(seed || '').trim().slice(0, 64); if (!seed) fail('Client seed не может быть пустым'); ctx.S.seed.client = seed; return { client: seed }; };

  // Settle one global crash bet (server). The stake was debited when the bet was placed.
  function crashSettle(S, { bet, payout, point, cashedAt, round, hash, roll, now }) {
    S._now = now; migrate(S);
    S.log.unshift({ kind: 'crash', nonce: '#' + round, client: '—', hash, roll, t: now }); S.log = S.log.slice(0, 100);
    if (payout) credit(S, payout);
    stat(S, bet, payout, 'crash', `раунд #${round}: краш x${point.toFixed(2)}, ` + (cashedAt ? `вывод x${cashedAt.toFixed(2)}` : 'без вывода'));
    track(S, 'crash'); delete S._now;
  }
  // provably fair roller: HMAC(serverSeed, client:nonce), shared by browser and server
  function makeRoll(S, serverSeed, hmac) {
    return async kind => {
      const sd = S.seed; const nonce = sd.nonce++;
      const roll = CF.hexToRoll(await hmac(serverSeed, `${sd.client}:${nonce}`));
      S.log.unshift({ kind, nonce, client: sd.client, hash: sd.hash, roll, t: Date.now() }); S.log = S.log.slice(0, 100);
      return roll;
    };
  }
  function rotateSeed(S, oldServer, next) { S.revealed.unshift({ server: oldServer, hash: S.seed.hash, n: S.seed.nonce }); S.revealed = S.revealed.slice(0, 50); S.seed = { ...next, client: S.seed.client, nonce: 0 }; }
  function bonusCredit(S, amt) { credit(S, amt); S.stats.bonus = r2((S.stats.bonus || 0) + amt); }

  function run(name, ctx, args) {
    const fn = A[name]; if (!fn) fail('Неизвестное действие');
    ctx.S._now = ctx.now; migrate(ctx.S); questsFor(ctx.S, ctx.now);
    return Promise.resolve(fn(ctx, args || {})).finally(() => { delete ctx.S._now; });
  }

  const api = { GameError, fail, buildCatalog, crashSettle, makeRoll, rotateSeed, bonusCredit, credit, debit, takeItems, addItem, makeIT, newState, migrate, levelOf, contractPool, crashPoint, QUESTS, questsFor, mskDay, actions: Object.keys(A), run, r2 };
  if (typeof module !== 'undefined') module.exports = api; else root.GAMES = api;
})(this);
