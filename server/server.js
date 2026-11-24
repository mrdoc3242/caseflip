// CaseFlip server: zero dependencies (Node 22+, built-in node:sqlite).
// Accounts (guest cookie + Steam OpenID), server-side balance/inventory, provably fair rolls,
// live drop feed + chat + global crash over SSE, daily price refresh at 12:00 MSK, bonus/withdraw limits.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const CF = require('../src/engine.js');
const G = require('../src/games.js');
const MARKETS = require('./markets.js').fromEnv(process.env);

// ---------- config ----------
const env = (k, d) => process.env[k] ?? d;
const PORT = +env('PORT', 8080);
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DATA = path.resolve(env('DATA_DIR', path.join(ROOT, 'data')));
const PUBLIC_URL = env('PUBLIC_URL', '').replace(/\/$/, '');       // e.g. https://caseflip.onrender.com
const STEAM_API_KEY = env('STEAM_API_KEY', '');                   // optional: names and avatars
const ADMIN_TOKEN = env('ADMIN_TOKEN', '');                       // enables /api/admin/*
const DEMO = env('DEMO_MODE', '1') === '1';                       // virtual money; enables the +$500 top-up
const START_BALANCE = +env('START_BALANCE', DEMO ? 1000 : 0);
const LIMITS = {
  guestsPerIpDay: +env('GUESTS_PER_IP_DAY', 5),
  maxBet: +env('MAX_BET', 1000),
  withdrawDailyUsd: +env('WITHDRAW_DAILY_USD', 200),
  withdrawPerDay: +env('WITHDRAW_PER_DAY', 3),
  withdrawMinUsd: +env('WITHDRAW_MIN_USD', 1),
  withdrawAutoUsd: +env('WITHDRAW_AUTO_USD', 50),     // requests up to this value are bought automatically, bigger ones wait for admin approval
  withdrawSlippage: +env('WITHDRAW_SLIPPAGE', 0.10),  // pay at most site price +10% if the market moved since the last price update
  withdrawAttempts: +env('WITHDRAW_ATTEMPTS', 2),     // markets tried per item before it is returned to the player
  priceEveryMin: +env('PRICE_REFRESH_MIN', 60),
  wagerX: +env('WAGER_X', 3),               // wager this many times all bonus money before withdrawing
  refReward: +env('REF_REWARD', 5), refWager: +env('REF_WAGER', 20),
  chatLevel: +env('CHAT_MIN_LEVEL', 2),
  topupBelow: 10, topupEveryMin: 30,
};
fs.mkdirSync(DATA, { recursive: true });

// ---------- database ----------
const db = new DatabaseSync(path.join(DATA, 'caseflip.db'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, steamid TEXT UNIQUE, name TEXT, avatar TEXT, state TEXT NOT NULL, seed TEXT NOT NULL,
  ref_code TEXT UNIQUE, referred_by INTEGER, ref_paid INTEGER DEFAULT 0, ref_earned REAL DEFAULT 0, trade_url TEXT, ip TEXT, banned INTEGER DEFAULT 0, created INTEGER, seen INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER);
CREATE TABLE IF NOT EXISTS bets(id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, wager REAL, ret REAL, detail TEXT, t INTEGER);
CREATE TABLE IF NOT EXISTS claims(kind TEXT, key TEXT, user_id INTEGER, amount REAL, t INTEGER);
CREATE INDEX IF NOT EXISTS claims_k ON claims(kind, key, t);
CREATE TABLE IF NOT EXISTS promo(code TEXT PRIMARY KEY, amount REAL, max_uses INTEGER, uses INTEGER DEFAULT 0, expires INTEGER);
CREATE TABLE IF NOT EXISTS chat(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, lv INTEGER, text TEXT, t INTEGER, hidden INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS feed(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, item TEXT, price REAL, src TEXT, t INTEGER);
CREATE TABLE IF NOT EXISTS withdrawals(id INTEGER PRIMARY KEY, user_id INTEGER, items TEXT, value REAL, trade_url TEXT, status TEXT, t INTEGER, note TEXT);
CREATE TABLE IF NOT EXISTS purchases(id INTEGER PRIMARY KEY, withdrawal_id INTEGER, user_id INTEGER, item_id TEXT, name TEXT, value REAL, status TEXT, market TEXT, custom_id TEXT, ext_id TEXT,
  tried TEXT DEFAULT '[]', attempts INTEGER DEFAULT 0, paid REAL, reason TEXT, t INTEGER, updated INTEGER);
CREATE INDEX IF NOT EXISTS purchases_s ON purchases(status);
CREATE TABLE IF NOT EXISTS crash(id INTEGER PRIMARY KEY, seed TEXT, hash TEXT, point REAL, t INTEGER);
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);`);
const q = sql => db.prepare(sql);
if (!q('SELECT 1 FROM promo LIMIT 1').get()) q('INSERT INTO promo(code,amount,max_uses,expires) VALUES(?,?,?,?)').run('CASEFLIP', 10, 1000, 0);

// ---------- catalog (prices) ----------
let CATD = null, CAT = [], CATMAP = new Map(), IT = G.makeIT(CATMAP);
function catalogPath() { const p = path.join(DATA, 'catalog.json'); return fs.existsSync(p) ? p : path.join(DIST, 'catalog.json'); }
function loadCatalog() {
  CATD = JSON.parse(fs.readFileSync(catalogPath(), 'utf8'));
  ({ CAT, CATMAP } = G.buildCatalog(CATD)); IT = G.makeIT(CATMAP);
  CF.applyPrices(n => CATMAP.get('m:' + n)); // case items follow market prices, odds re-solved for 97.5%
  log('catalog', CAT.length, 'items, prices from', CATD.updated);
}

// Prices come from the same marketplaces the site buys withdrawals on, so a skin costs the player
// what it costs us. Site price = cheapest live offer across the markets. Skinport is only a fallback.
// MARKET_PRICES keeps each market's own price per item to pick where to buy first.
let MARKET_PRICES = {}; try { MARKET_PRICES = JSON.parse(fs.readFileSync(path.join(DATA, 'market_prices.json'), 'utf8')); } catch (e) {}
const WEAR_RE = / \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/;
const WE = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];
async function fetchSkinport() {
  const r = await fetch('https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=0', { headers: { 'Accept-Encoding': 'br', 'User-Agent': 'CaseFlip/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const m = new Map(); for (const it of await r.json()) { const p = it.min_price ?? it.suggested_price; if (it.market_hash_name && p > 0) m.set(it.market_hash_name, { price: p, count: it.quantity || 1 }); }
  return m;
}
async function refreshPrices() {
  try {
    const sources = {}, errors = {};
    for (const mk of Object.values(MARKETS.all)) {
      if (mk.id === 'waxpeer' && !mk.enabled) continue; // Waxpeer prices need a key; Market.CSGO's list is public
      try { sources[mk.id] = await mk.prices(); } catch (e) { errors[mk.id] = e.message; }
    }
    let src = Object.keys(sources);
    if (!src.length) { sources.skinport = await fetchSkinport(); src = ['skinport']; }
    const per = {}, best = new Map();
    for (const id of src) for (const [n, v] of sources[id]) {
      if (!n.includes(' | ')) continue;
      (per[n] = per[n] || {})[id] = v.price;
      if (!best.has(n) || v.price < best.get(n)) best.set(n, v.price);
    }
    const base = CATD.skins.map(([w, s]) => w + ' | ' + s); const idx = new Map(base.map((b, i) => [b, i]));
    const caseNames = new Set(Object.values(CF.MH));
    const items = [];
    for (const [n, p] of best) {
      if (p <= 0.5 && !caseNames.has(n)) continue;
      const st = n.includes('StatTrak™') ? 1 : n.startsWith('Souvenir ') ? 2 : 0;
      let b = n.replace(/^StatTrak™ |^Souvenir /, '').replace('★ StatTrak™ ', '★ ');
      const m = WEAR_RE.exec(b); const w = m ? WE.indexOf(m[1]) : 5; b = b.replace(WEAR_RE, '');
      if (!idx.has(b)) continue;
      items.push([idx.get(b), w, st, Math.round(p * 100) / 100]);
    }
    if (items.length < 1000) throw new Error('too few items: ' + items.length);
    items.sort((a, b) => a[3] - b[3]);
    const out = { updated: new Date().toISOString(), source: src.join('+'), skins: CATD.skins, items };
    fs.writeFileSync(path.join(DATA, 'catalog.json.tmp'), JSON.stringify(out)); fs.renameSync(path.join(DATA, 'catalog.json.tmp'), path.join(DATA, 'catalog.json'));
    MARKET_PRICES = per; fs.writeFileSync(path.join(DATA, 'market_prices.json'), JSON.stringify(per));
    loadCatalog(); q('INSERT OR REPLACE INTO kv VALUES(?,?)').run('prices', JSON.stringify({ ok: out.updated, source: out.source, items: items.length, errors }));
    broadcast('prices', { updated: out.updated });
  } catch (e) { log('price refresh failed:', e.message); q('INSERT OR REPLACE INTO kv VALUES(?,?)').run('prices', JSON.stringify({ fail: new Date().toISOString(), error: e.message })); }
}
function schedulePrices() {
  // every PRICE_REFRESH_MIN minutes (default hourly), plus at startup when the list is older than that
  setInterval(refreshPrices, Math.max(10, LIMITS.priceEveryMin) * 60e3).unref();
  if (Date.now() - Date.parse(CATD.updated) > LIMITS.priceEveryMin * 60e3) setTimeout(refreshPrices, 5000);
}

// ---------- helpers ----------
const log = (...a) => console.log(new Date().toISOString(), ...a);
const now = () => Date.now();
const DAY = 864e5;
const hmacSync = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest('hex');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const rnd = n => crypto.randomBytes(n).toString('hex');
const STARTER = ['ak-elite', 'm4a4-evil', 'usp-cortex', 'famas-roll', 'mac10-candy'];
class HttpError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }

// per-user serialization so two tabs can't race on one balance
const locks = new Map();
function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const p = prev.then(fn, fn); const tail = p.catch(() => {}); locks.set(id, tail);
  tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
  return p;
}
function getUser(id) { const u = q('SELECT * FROM users WHERE id=?').get(id); if (u) u.S = G.migrate(JSON.parse(u.state)); return u; }
function saveUser(u) { q('UPDATE users SET state=?, seed=?, seen=? WHERE id=?').run(JSON.stringify(u.S), u.seed, now(), u.id); }
function publicState(u) { const S = { ...u.S }; delete S._now; return S; }
const displayName = u => u.name || (u.steamid ? 'Steam ···' + u.steamid.slice(-4) : 'Гость #' + u.id);

function createUser(ip, refCode) {
  const S = G.newState({ balance: START_BALANCE, starter: STARTER });
  S.stats.bonus = START_BALANCE + STARTER.reduce((a, id) => a + IT(id).price, 0); // free money counts toward the wager requirement
  const seed = rnd(32); S.seed = { hash: sha256(seed), client: rnd(8), nonce: 0 };
  let referred = null;
  if (refCode) { const r = q('SELECT id, ip FROM users WHERE ref_code=?').get(String(refCode).slice(0, 16)); if (r && r.ip !== ip) { referred = r.id; S.freeCases = 1; } }
  const info = q('INSERT INTO users(state, seed, ref_code, referred_by, ip, created, seen) VALUES(?,?,?,?,?,?,?)').run(JSON.stringify(S), seed, rnd(4), referred, ip, now(), now());
  return Number(info.lastInsertRowid);
}
function newSession(res, userId, secure) {
  const token = rnd(24); q('INSERT INTO sessions VALUES(?,?,?)').run(token, userId, now());
  res.setHeader('Set-Cookie', `cf_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`);
  return token;
}
function cookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); }); return o; }
function sessionUserId(req) { const t = cookies(req).cf_sid; if (!t) return null; const s = q('SELECT user_id FROM sessions WHERE token=?').get(t); return s ? s.user_id : null; }
function clientIp(req) { return (env('TRUST_PROXY', '1') === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?'; }
function origin(req) { if (PUBLIC_URL) return PUBLIC_URL; const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http'); return proto + '://' + req.headers.host; }
const isSecure = req => origin(req).startsWith('https://');
function claimedSince(kind, key, since) { return q('SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM claims WHERE kind=? AND key=? AND t>?').get(kind, String(key), since); }
function addClaim(kind, key, userId, amount = 0) { q('INSERT INTO claims VALUES(?,?,?,?,?)').run(kind, String(key), userId, amount, now()); }

// simple token bucket per IP
const buckets = new Map();
function rateLimit(key, perSec, burst) {
  const t = now(); let b = buckets.get(key); if (!b) { b = { tok: burst, t }; buckets.set(key, b); }
  b.tok = Math.min(burst, b.tok + (t - b.t) / 1000 * perSec); b.t = t;
  if (b.tok < 1) return false; b.tok--; return true;
}
setInterval(() => { const t = now(); for (const [k, b] of buckets) if (t - b.t > 600e3) buckets.delete(k); }, 300e3).unref();

// ---------- live: SSE feed, chat, online ----------
const clients = new Set();
function broadcast(event, data) { const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(msg); }
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); broadcast('online', { n: clients.size }); }, 20e3).unref();
function feedRows() {
  const recent = q('SELECT name, item, price, src, t FROM feed ORDER BY id DESC LIMIT 30').all();
  const top = q('SELECT name, item, price, src, t FROM feed WHERE t>? ORDER BY price DESC LIMIT 20').all(now() - DAY);
  return { recent, top };
}
function pushFeed(u, e) {
  if (!e || e.p < 0.5) return;
  const row = { name: displayName(u), item: e.id, price: e.p, src: e.src, t: e.t };
  q('INSERT INTO feed(user_id,name,item,price,src,t) VALUES(?,?,?,?,?,?)').run(u.id, row.name, row.item, row.price, row.src, row.t);
  broadcast('drop', row);
}
setInterval(() => { q('DELETE FROM feed WHERE t<?').run(now() - 7 * DAY); q('DELETE FROM chat WHERE t<?').run(now() - 7 * DAY); q('DELETE FROM sessions WHERE created<?').run(now() - 365 * DAY); }, 3600e3).unref();

// ---------- referral payout ----------
function checkReferral(u) {
  if (!u.referred_by || u.ref_paid || u.S.stats.wager < LIMITS.refWager) return;
  q('UPDATE users SET ref_paid=1 WHERE id=?').run(u.id); u.ref_paid = 1;
  const refId = u.referred_by;
  withLock(refId, async () => { const r = getUser(refId); if (!r) return; G.bonusCredit(r.S, LIMITS.refReward); saveUser(r); q('UPDATE users SET ref_earned=ref_earned+? WHERE id=?').run(LIMITS.refReward, refId); });
}

// ---------- game actions ----------
const ACTIONS = new Set(['openCase', 'sell', 'buy', 'upgrade', 'contract', 'battle', 'dailyBonus', 'questClaim', 'setClientSeed']);
async function doAction(u, name, args, ip) {
  if (!ACTIONS.has(name)) throw new HttpError(404, 'Неизвестное действие');
  if (u.banned) throw new HttpError(403, 'Аккаунт заблокирован');
  if (name === 'dailyBonus') { // one daily bonus per IP as well as per account
    const c = claimedSince('daily', ip, now() - 20 * 3600e3);
    if (c.n > 0 && !q('SELECT 1 FROM claims WHERE kind=? AND key=? AND user_id=? AND t>?').get('daily', ip, u.id, now() - 20 * 3600e3)) throw new HttpError(429, 'С этого адреса бонус сегодня уже получали', 'ip_limit');
  }
  if (name === 'upgrade' && (+args.bal || 0) > LIMITS.maxBet) throw new HttpError(400, 'Максимальная ставка с баланса $' + LIMITS.maxBet);
  const ctx = { S: u.S, IT, CAT, CATMAP, now: now(), roll: G.makeRoll(u.S, u.seed, hmacSync) };
  const before = { w: u.S.stats.wager, r: u.S.stats.ret, n: u.S.log.length };
  const res = await G.run(name, ctx, args);
  if (name === 'dailyBonus') addClaim('daily', ip, u.id, res.amount);
  const dw = G.r2(u.S.stats.wager - before.w);
  if (dw > 0) q('INSERT INTO bets(user_id,kind,wager,ret,detail,t) VALUES(?,?,?,?,?,?)').run(u.id, name, dw, G.r2(u.S.stats.ret - before.r), (u.S.log[0] && u.S.log[0].detail) || '', now());
  saveUser(u); pushFeed(u, res.feed); checkReferral(u);
  return res;
}

// ---------- crash: one global round for everybody ----------
const K_GROWTH = 0.06; // multiplier = e^(0.06·t), x2 after ~11.6 s
const mAt = ms => Math.floor(Math.exp(K_GROWTH * ms / 1000) * 100) / 100;
const CRASH = { id: (q('SELECT MAX(id) m FROM crash').get().m || 0), phase: 'bet', start: 0, seed: '', hash: '', point: 1, bets: new Map(), history: q('SELECT id, point, hash, seed FROM crash ORDER BY id DESC LIMIT 15').all() };
const BET_MS = 8000, END_MS = 4000;
function crashPublic() {
  const t = now();
  return { id: CRASH.id, phase: CRASH.phase, hash: CRASH.hash, elapsed: CRASH.phase === 'run' ? t - CRASH.start : 0, left: CRASH.phase === 'bet' ? Math.max(0, CRASH.start - t) : 0,
    point: CRASH.phase === 'end' ? CRASH.point : null, bets: [...CRASH.bets.values()].map(b => ({ name: b.name, bet: b.bet, cashed: b.cashed || null })), history: CRASH.history.map(h => ({ id: h.id, point: h.point })) };
}
function crashNewRound() {
  CRASH.id++; CRASH.phase = 'bet'; CRASH.seed = rnd(32); CRASH.hash = sha256(CRASH.seed);
  CRASH.roll = CF.hexToRoll(hmacSync(CRASH.seed, 'crash:' + CRASH.id)); CRASH.point = G.crashPoint(CRASH.roll);
  CRASH.bets = new Map(); CRASH.start = now() + BET_MS;
  broadcast('crash', crashPublic());
  setTimeout(crashRun, BET_MS);
}
function crashRun() {
  CRASH.phase = 'run'; CRASH.start = now(); broadcast('crash', crashPublic());
  const endMs = Math.log(CRASH.point) / K_GROWTH * 1000;
  const tick = setInterval(() => {
    const el = now() - CRASH.start, m = Math.min(mAt(el), CRASH.point);
    for (const b of CRASH.bets.values()) if (!b.cashed && b.auto && b.auto <= m) cashOut(b, b.auto);
    if (el >= endMs) { clearInterval(tick); crashEnd(); }
  }, 50);
}
function crashEnd() {
  CRASH.phase = 'end';
  q('INSERT INTO crash VALUES(?,?,?,?,?)').run(CRASH.id, CRASH.seed, CRASH.hash, CRASH.point, now());
  CRASH.history.unshift({ id: CRASH.id, point: CRASH.point, hash: CRASH.hash, seed: CRASH.seed }); CRASH.history = CRASH.history.slice(0, 15);
  for (const b of CRASH.bets.values()) if (!b.cashed) settleCrash(b, 0, null);
  broadcast('crash', { ...crashPublic(), seed: CRASH.seed });
  setTimeout(crashNewRound, END_MS);
}
function settleCrash(b, payout, cashedAt) {
  const round = { id: CRASH.id, hash: CRASH.hash, point: CRASH.point, roll: CRASH.roll };
  return withLock(b.userId, async () => {
    const u = getUser(b.userId); if (!u) return;
    G.crashSettle(u.S, { bet: b.bet, payout, point: round.point, cashedAt, round: round.id, hash: round.hash, roll: round.roll, now: now() });
    q('INSERT INTO bets(user_id,kind,wager,ret,detail,t) VALUES(?,?,?,?,?,?)').run(u.id, 'crash', b.bet, payout, `#${round.id} x${round.point}`, now());
    saveUser(u); checkReferral(u);
  });
}
function cashOut(b, m) {
  b.cashed = m; const payout = G.r2(b.bet * m);
  broadcast('crash_cash', { name: b.name, m, payout });
  return settleCrash(b, payout, m).then(() => payout);
}

// ---------- withdrawals through P2P markets ----------
// The market buys the cheapest offer under our price ceiling and the seller sends it straight to the player.
// purchase.status: hold (waits for admin) → queued → buying → sent → delivered | refunded; waiting_funds when no market has balance.
function marketName(id) { if (id.startsWith('m:')) return id.slice(2); const it = CF.ITEMS[id]; return it && it.mh || null; }
function tradeParts(url) { const m = /partner=(\d+)&token=([\w-]+)/.exec(url || ''); return m ? { partner: m[1], token: m[2] } : null; }
function refundPurchase(p, reason) {
  q("UPDATE purchases SET status='refunded', reason=?, updated=? WHERE id=?").run(reason, now(), p.id);
  withLock(p.user_id, async () => { const u = getUser(p.user_id); if (!u) return; u.S.inv.unshift({ uid: u.S.uid++, id: p.item_id }); saveUser(u); });
}
function updateWithdrawal(wid) {
  const rows = q('SELECT status FROM purchases WHERE withdrawal_id=?').all(wid).map(r => r.status);
  if (!rows.length) return;
  const open = rows.some(s => ['hold', 'queued', 'buying', 'sent', 'waiting_funds'].includes(s));
  const st = open ? (rows.every(s => s === 'hold') ? 'pending' : 'processing') : rows.every(s => s === 'delivered') ? 'sent' : rows.some(s => s === 'delivered') ? 'partial' : rows.every(s => s === 'cancelled') ? 'cancelled' : 'refunded';
  q('UPDATE withdrawals SET status=? WHERE id=?').run(st, wid);
}
const balances = {};
async function marketBalance(m) { const b = balances[m.id]; if (b && now() - b.t < 60e3) return b.v; const v = await m.balance(); balances[m.id] = { v, t: now() }; return v; }
let ticking = false;
async function withdrawTick() {
  if (ticking) return; ticking = true;
  try {
    const markets = MARKETS.list().filter(m => m.enabled);
    if (!markets.length) return;
    // 1) poll trades in flight
    for (const m of markets) {
      const sent = q("SELECT * FROM purchases WHERE status IN ('sent','buying') AND market=?").all(m.id);
      for (let i = 0; i < sent.length; i += 50) {
        const chunk = sent.slice(i, i + 50); let st;
        try { st = await m.status(chunk.map(p => p.custom_id)); } catch (e) { log('status', m.id, e.message); continue; }
        for (const p of chunk) {
          const r = st[p.custom_id];
          if (!r) { if (p.status === 'buying' && now() - p.updated > 5 * 60e3) { q("UPDATE purchases SET status='queued', updated=? WHERE id=?").run(now(), p.id); } continue; } // a lost buy that never happened
          if (r.state === 'delivered') q("UPDATE purchases SET status='delivered', paid=?, reason=NULL, updated=? WHERE id=?").run(r.paid, now(), p.id);
          else if (r.state === 'failed') q("UPDATE purchases SET status='queued', reason=?, updated=? WHERE id=?").run(r.reason || 'продавец не передал предмет', now(), p.id);
          else if (p.status === 'buying') q("UPDATE purchases SET status='sent', updated=? WHERE id=?").run(now(), p.id);
          updateWithdrawal(p.withdrawal_id);
        }
      }
    }
    // 2) buy queued items: cheapest market first, skip markets already tried, refund after WITHDRAW_ATTEMPTS
    for (const p of q("SELECT p.*, w.trade_url FROM purchases p JOIN withdrawals w ON w.id=p.withdrawal_id WHERE p.status IN ('queued','waiting_funds') ORDER BY p.id LIMIT 20").all()) {
      const tl = tradeParts(p.trade_url); if (!tl) { refundPurchase(p, 'неверная trade-ссылка'); updateWithdrawal(p.withdrawal_id); continue; }
      const tried = JSON.parse(p.tried || '[]');
      if (p.attempts >= LIMITS.withdrawAttempts) { refundPurchase(p, p.reason || 'не удалось купить предмет'); updateWithdrawal(p.withdrawal_id); continue; }
      const ceiling = Math.round(p.value * (1 + LIMITS.withdrawSlippage) * 100) / 100;
      const mp = MARKET_PRICES[p.name] || {};
      const order = markets.filter(m => !tried.includes(m.id)).sort((a, b) => (mp[a.id] ?? 1e12) - (mp[b.id] ?? 1e12));
      if (!order.length) { refundPurchase(p, p.reason || 'предмета нет в продаже'); updateWithdrawal(p.withdrawal_id); continue; }
      let bought = false, noFunds = 0, lastErr = null;
      for (const m of order) {
        if (mp[m.id] != null && mp[m.id] > ceiling) { tried.push(m.id); lastErr = 'цена на маркете выше'; continue; }
        try { if (await marketBalance(m) < ceiling) { noFunds++; continue; } } catch (e) { lastErr = e.message; continue; }
        const customId = `cf${p.id}a${p.attempts + 1}`;
        q("UPDATE purchases SET status='buying', market=?, custom_id=?, attempts=attempts+1, updated=? WHERE id=?").run(m.id, customId, now(), p.id);
        tried.push(m.id); q('UPDATE purchases SET tried=? WHERE id=?').run(JSON.stringify(tried), p.id);
        let r; try { r = await m.buy({ name: p.name, maxUsd: ceiling, partner: tl.partner, token: tl.token, customId }); }
        catch (e) { log('buy', m.id, p.id, e.message); bought = true; break; } // unknown outcome: stays 'buying', the status poll settles it
        if (r.ok) { q("UPDATE purchases SET status='sent', ext_id=?, updated=? WHERE id=?").run(r.extId, now(), p.id); delete balances[m.id]; bought = true; break; }
        lastErr = r.error; q("UPDATE purchases SET status='queued', reason=?, updated=? WHERE id=?").run(r.error, now(), p.id);
      }
      if (!bought) {
        q('UPDATE purchases SET tried=? WHERE id=?').run(JSON.stringify(tried), p.id);
        if (noFunds) q("UPDATE purchases SET status='waiting_funds', reason=?, updated=? WHERE id=?").run(lastErr || 'ждём пополнения баланса маркета', now(), p.id); // admin tops up, the item stays reserved
        else refundPurchase(p, lastErr || 'не удалось купить предмет');
      }
      updateWithdrawal(p.withdrawal_id);
    }
  } catch (e) { log('withdrawTick', e.stack || e); } finally { ticking = false; }
}
setInterval(withdrawTick, (+env('WITHDRAW_TICK_SEC', 30)) * 1000).unref();

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const CSP = "default-src 'self'; img-src 'self' data: https://*.steamstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://steamcommunity.com";
function send(res, status, obj, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((ok, bad) => { let s = ''; req.on('data', c => { s += c; if (s.length > 64e3) { bad(new HttpError(413, 'Слишком большой запрос')); req.destroy(); } }); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(new HttpError(400, 'Неверный JSON')); } }); });
}
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/catalog.json') { res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' }); return fs.createReadStream(catalogPath()).pipe(res); }
  const f = path.normalize(path.join(DIST, pathname));
  if (!f.startsWith(DIST + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  const ext = path.extname(f);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  fs.createReadStream(f).pipe(res);
}

async function me(req, res, ip) {
  let id = sessionUserId(req);
  let u = id && getUser(id);
  if (!u) {
    if (claimedSince('guest', ip, now() - DAY).n >= LIMITS.guestsPerIpDay) throw new HttpError(429, 'Слишком много новых аккаунтов с этого адреса. Войдите через Steam или зайдите завтра.', 'guest_limit');
    id = createUser(ip, cookies(req).cf_ref); addClaim('guest', ip, id); newSession(res, id, isSecure(req)); u = getUser(id);
  }
  return profile(u);
}
function profile(u) {
  const w = q("SELECT id, value, status, t, note FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 10").all(u.id);
  for (const x of w) x.items = q('SELECT name, value, status, reason FROM purchases WHERE withdrawal_id=?').all(x.id);
  const refs = q('SELECT COUNT(*) n, COALESCE(SUM(ref_paid),0) paid FROM users WHERE referred_by=?').get(u.id);
  return { server: true, demo: DEMO, user: { id: u.id, steamid: u.steamid, name: displayName(u), avatar: u.avatar, ref: u.ref_code, refs: refs.n, refPaid: refs.paid, refEarned: u.ref_earned, tradeUrl: u.trade_url },
    state: publicState(u), withdrawals: w, limits: { wagerX: LIMITS.wagerX, withdrawDailyUsd: LIMITS.withdrawDailyUsd, refReward: LIMITS.refReward, refWager: LIMITS.refWager, chatLevel: LIMITS.chatLevel, maxBet: LIMITS.maxBet }, prices: CATD.updated };
}

async function steamReturn(req, res, url) {
  const p = url.searchParams; const o = origin(req);
  const fail = msg => { res.writeHead(302, { Location: '/#profile?err=' + encodeURIComponent(msg) }); res.end(); };
  if (p.get('openid.mode') !== 'id_res' || !String(p.get('openid.return_to') || '').startsWith(o + '/auth/steam/return')) return fail('steam');
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(p.get('openid.claimed_id') || ''); if (!m) return fail('steam');
  const check = new URLSearchParams(p); check.set('openid.mode', 'check_authentication');
  let valid = false; try { const r = await fetch('https://steamcommunity.com/openid/login', { method: 'POST', body: check, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); valid = /is_valid\s*:\s*true/.test(await r.text()); } catch (e) { log('steam verify error', e.message); }
  if (!valid) return fail('steam');
  const steamid = m[1]; let name = null, avatar = null;
  if (STEAM_API_KEY) try { const r = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamid}`); const pl = (await r.json()).response.players[0]; if (pl) { name = String(pl.personaname).slice(0, 32); avatar = pl.avatarfull || pl.avatarmedium; } } catch (e) {}
  let u = q('SELECT id FROM users WHERE steamid=?').get(steamid);
  if (u) { if (name) q('UPDATE users SET name=?, avatar=? WHERE id=?').run(name, avatar, u.id); }
  else {
    const cur = sessionUserId(req); const cu = cur && q('SELECT id, steamid FROM users WHERE id=?').get(cur);
    const id = cu && !cu.steamid ? cu.id : createUser(clientIp(req), cookies(req).cf_ref); // keep guest progress on first Steam login
    q('UPDATE users SET steamid=?, name=?, avatar=? WHERE id=?').run(steamid, name, avatar, id); u = { id };
  }
  newSession(res, u.id, isSecure(req));
  res.writeHead(302, { Location: '/#profile' }); res.end();
}

const ROUTES = {
  'GET /api/me': (c) => me(c.req, c.res, c.ip),
  'GET /api/feed': () => feedRows(),
  'GET /api/crash': () => crashPublic(),
  'GET /api/crash/verify': (c) => { const r = q('SELECT id, seed, hash, point FROM crash WHERE id=?').get(+c.url.searchParams.get('id')); if (!r) throw new HttpError(404, 'Раунд не найден'); return r; },
  'POST /api/logout': (c) => { const t = cookies(c.req).cf_sid; if (t) q('DELETE FROM sessions WHERE token=?').run(t); c.res.setHeader('Set-Cookie', 'cf_sid=; Path=/; Max-Age=0'); return { ok: true }; },
  'POST /api/act': (c) => withUser(c, u => doAction(u, String(c.body.name), c.body.args || {}, c.ip)),
  'POST /api/seed/rotate': (c) => withUser(c, u => { const s = rnd(32); G.rotateSeed(u.S, u.seed, { hash: sha256(s) }); u.seed = s; saveUser(u); return { ok: true }; }),
  'POST /api/topup': (c) => withUser(c, u => {
    if (!DEMO) throw new HttpError(403, 'Пополнение отключено');
    if (u.S.balance >= LIMITS.topupBelow) throw new HttpError(400, `Демо-пополнение доступно, когда на балансе меньше $${LIMITS.topupBelow}`);
    if (claimedSince('topup', u.id, now() - LIMITS.topupEveryMin * 60e3).n) throw new HttpError(429, `Пополнять можно раз в ${LIMITS.topupEveryMin} минут`);
    if (claimedSince('topup_ip', c.ip, now() - DAY).n >= 10) throw new HttpError(429, 'Лимит пополнений с этого адреса на сегодня');
    G.bonusCredit(u.S, 500); addClaim('topup', u.id, u.id, 500); addClaim('topup_ip', c.ip, u.id, 500); saveUser(u); return { amount: 500 };
  }),
  'POST /api/promo': (c) => withUser(c, u => {
    const code = String(c.body.code || '').trim().toUpperCase().slice(0, 32);
    const p = q('SELECT * FROM promo WHERE code=?').get(code);
    if (!p || (p.expires && p.expires < now()) || p.uses >= p.max_uses) throw new HttpError(400, 'Промокод не найден или закончился');
    if (claimedSince('promo:' + code, u.id, 0).n) throw new HttpError(400, 'Вы уже активировали этот промокод');
    if (claimedSince('promo_ip:' + code, c.ip, 0).n) throw new HttpError(429, 'С этого адреса промокод уже активировали');
    q('UPDATE promo SET uses=uses+1 WHERE code=?').run(code); addClaim('promo:' + code, u.id, u.id, p.amount); addClaim('promo_ip:' + code, c.ip, u.id, p.amount);
    G.bonusCredit(u.S, p.amount); saveUser(u); return { amount: p.amount };
  }),
  'POST /api/freecase': (c) => withUser(c, u => doActionFree(u)),
  'POST /api/chat': (c) => withUser(c, u => {
    const text = String(c.body.text || '').replace(/\s+/g, ' ').trim().slice(0, 200); if (!text) throw new HttpError(400, 'Пустое сообщение');
    const lv = G.levelOf(u.S.stats.wager).lv; if (lv < LIMITS.chatLevel) throw new HttpError(403, `Чат открывается с ${LIMITS.chatLevel} уровня`);
    if (!rateLimit('chat:' + u.id, 1 / 3, 2)) throw new HttpError(429, 'Не так быстро');
    if (/(https?:\/\/|www\.|t\.me\/|discord\.gg)/i.test(text)) throw new HttpError(400, 'Ссылки в чате запрещены');
    const row = { name: displayName(u), lv, text, t: now(), avatar: u.avatar };
    row.id = Number(q('INSERT INTO chat(user_id,name,lv,text,t) VALUES(?,?,?,?,?)').run(u.id, row.name, lv, text, row.t).lastInsertRowid);
    broadcast('chat', row); return { ok: true };
  }),
  'POST /api/crash/bet': (c) => withUser(c, u => {
    if (CRASH.phase !== 'bet') throw new HttpError(400, 'Ставки на этот раунд закрыты, ждите следующий');
    if (CRASH.bets.has(u.id)) throw new HttpError(400, 'Вы уже поставили в этом раунде');
    const bet = G.r2(+c.body.bet), auto = c.body.auto ? Math.floor(+c.body.auto * 100) / 100 : 0;
    if (!(bet >= 0.1) || bet > LIMITS.maxBet) throw new HttpError(400, `Ставка от $0.10 до $${LIMITS.maxBet}`);
    if (auto && !(auto >= 1.01 && auto <= 1000)) throw new HttpError(400, 'Автовывод от x1.01 до x1000');
    G.debit(u.S, bet); saveUser(u);
    const b = { userId: u.id, name: displayName(u), bet, auto }; CRASH.bets.set(u.id, b);
    broadcast('crash_bet', { name: b.name, bet }); return { ok: true, balance: u.S.balance };
  }),
  'POST /api/crash/cashout': async (c) => {
    const id = sessionUserId(c.req); const b = id && CRASH.bets.get(id);
    if (!b || CRASH.phase !== 'run' || b.cashed) throw new HttpError(400, 'Нечего забирать');
    const m = mAt(now() - CRASH.start); if (m > CRASH.point) throw new HttpError(400, 'Не успели, краш');
    const payout = await cashOut(b, m); return { m, payout };
  },
  'POST /api/withdraw': (c) => withUser(c, u => {
    if (!u.steamid) throw new HttpError(403, 'Для вывода войдите через Steam');
    const trade = String(c.body.tradeUrl || u.trade_url || '').trim();
    if (!/^https:\/\/steamcommunity\.com\/tradeoffer\/new\/\?partner=\d+&token=[\w-]{6,16}$/.test(trade)) throw new HttpError(400, 'Укажите trade-ссылку Steam');
    const need = G.r2(u.S.stats.bonus * LIMITS.wagerX);
    if (u.S.stats.wager < need) throw new HttpError(403, `Сначала нужно поставить ${'$' + need.toFixed(2)} (бонусы ×${LIMITS.wagerX}), сейчас ${'$' + u.S.stats.wager.toFixed(2)}`);
    const day = q("SELECT COUNT(*) n, COALESCE(SUM(value),0) s FROM withdrawals WHERE user_id=? AND t>? AND status!='cancelled'").get(u.id, now() - DAY);
    if (day.n >= LIMITS.withdrawPerDay) throw new HttpError(429, `Не больше ${LIMITS.withdrawPerDay} заявок в сутки`);
    const { items, value } = G.takeItems(u.S, c.body.uids, IT);
    const noMarket = items.filter(x => !marketName(x.id));
    if (noMarket.length) { items.forEach(x => u.S.inv.unshift(x)); throw new HttpError(400, 'Этот предмет нельзя вывести, его можно продать или поставить в апгрейд'); }
    if (value < LIMITS.withdrawMinUsd || day.s + value > LIMITS.withdrawDailyUsd) { items.forEach(x => u.S.inv.unshift(x)); throw new HttpError(400, `Вывод от $${LIMITS.withdrawMinUsd} и до $${LIMITS.withdrawDailyUsd} в сутки (осталось $${(LIMITS.withdrawDailyUsd - day.s).toFixed(2)})`); }
    q('UPDATE users SET trade_url=? WHERE id=?').run(trade, u.id);
    const auto = !DEMO && MARKETS.list().some(m => m.enabled) && value <= LIMITS.withdrawAutoUsd;
    // DEMO_MODE: balances are virtual, so nothing is bought automatically; the admin approves each request by hand.
    const id = Number(q('INSERT INTO withdrawals(user_id,items,value,trade_url,status,t) VALUES(?,?,?,?,?,?)').run(u.id, JSON.stringify(items), value, trade, auto ? 'processing' : 'pending', now()).lastInsertRowid);
    for (const x of items) q('INSERT INTO purchases(withdrawal_id,user_id,item_id,name,value,status,t,updated) VALUES(?,?,?,?,?,?,?,?)').run(id, u.id, x.id, marketName(x.id), IT(x.id).price, auto ? 'queued' : 'hold', now(), now());
    saveUser(u); if (auto) setTimeout(withdrawTick, 100); return { id, value, auto };
  }),
  'POST /api/withdraw/cancel': (c) => withUser(c, u => {
    const w = q("SELECT * FROM withdrawals WHERE id=? AND user_id=? AND status='pending'").get(+c.body.id, u.id); if (!w) throw new HttpError(404, 'Заявка не найдена');
    q("UPDATE withdrawals SET status='cancelled' WHERE id=?").run(w.id); q("UPDATE purchases SET status='cancelled' WHERE withdrawal_id=?").run(w.id); JSON.parse(w.items).forEach(x => u.S.inv.unshift({ uid: u.S.uid++, id: x.id })); saveUser(u); return { ok: true };
  }),
  // admin (Authorization: Bearer ADMIN_TOKEN)
  'POST /api/admin/promo': (c) => { admin(c); const { code, amount, uses = 100, days = 0 } = c.body; q('INSERT OR REPLACE INTO promo(code,amount,max_uses,uses,expires) VALUES(?,?,?,0,?)').run(String(code).toUpperCase(), +amount, +uses, days ? now() + days * DAY : 0); return { ok: true }; },
  'GET /api/admin/withdrawals': (c) => { admin(c); return q("SELECT w.*, u.steamid, u.name FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 200").all(); },
  // {id, action: 'approve' | 'reject', note}: approve starts buying on the markets, reject returns the items
  'POST /api/admin/withdrawal': (c) => {
    admin(c); const w = q('SELECT * FROM withdrawals WHERE id=?').get(+c.body.id); if (!w) throw new HttpError(404, 'not found');
    if (c.body.action === 'approve') { q("UPDATE withdrawals SET status='processing', note=? WHERE id=?").run(String(c.body.note || ''), w.id); q("UPDATE purchases SET status='queued', updated=? WHERE withdrawal_id=? AND status IN ('hold','waiting_funds')").run(now(), w.id); setTimeout(withdrawTick, 100); }
    else if (c.body.action === 'reject') { for (const p of q("SELECT * FROM purchases WHERE withdrawal_id=? AND status IN ('hold','queued','waiting_funds')").all(w.id)) refundPurchase(p, String(c.body.note || 'отклонено администратором')); q("UPDATE withdrawals SET note=? WHERE id=?").run(String(c.body.note || ''), w.id); updateWithdrawal(w.id); }
    else throw new HttpError(400, 'action: approve | reject');
    return { ok: true };
  },
  'GET /api/admin/markets': async (c) => { admin(c); const out = {}; for (const m of MARKETS.list()) { out[m.id] = { enabled: m.enabled }; if (m.enabled) try { out[m.id].balance = await m.balance(); } catch (e) { out[m.id].error = e.message; } } return { markets: out, queue: q('SELECT status, COUNT(*) n, COALESCE(SUM(value),0) v FROM purchases GROUP BY status').all() }; },
  'GET /api/admin/purchases': (c) => { admin(c); return q('SELECT * FROM purchases ORDER BY id DESC LIMIT 200').all(); },
  'POST /api/admin/ban': (c) => { admin(c); q('UPDATE users SET banned=? WHERE id=?').run(c.body.banned ? 1 : 0, +c.body.id); return { ok: true }; },
  'POST /api/admin/chat/hide': (c) => { admin(c); q('UPDATE chat SET hidden=1 WHERE id=?').run(+c.body.id); broadcast('chat_hide', { id: +c.body.id }); return { ok: true }; },
  'GET /api/admin/stats': (c) => { admin(c); return { markets: MARKETS.list().map(m => ({ id: m.id, enabled: m.enabled })), users: q('SELECT COUNT(*) n FROM users').get().n, bets24: q('SELECT COUNT(*) n, COALESCE(SUM(wager),0) w, COALESCE(SUM(ret),0) r FROM bets WHERE t>?').get(now() - DAY), prices: JSON.parse((q("SELECT v FROM kv WHERE k='prices'").get() || { v: '{}' }).v) }; },
};
function admin(c) { const h = String(c.req.headers.authorization || ''); if (!ADMIN_TOKEN || h.length !== ADMIN_TOKEN.length + 7 || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from('Bearer ' + ADMIN_TOKEN))) throw new HttpError(403, 'forbidden'); }
function withUser(c, fn) {
  const id = sessionUserId(c.req); if (!id) throw new HttpError(401, 'Нет сессии', 'no_session');
  return withLock(id, async () => { const u = getUser(id); if (!u) throw new HttpError(401, 'Нет сессии', 'no_session'); const res = await fn(u); return { res, state: publicState(getUser(id)) }; });
}
async function doActionFree(u) { return doAction(u, 'openCase', { caseId: 'starter', free: true }, ''); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const ip = clientIp(req);
  try {
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (url.pathname === '/auth/steam') {
      const o = origin(req); const p = new URLSearchParams({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'checkid_setup', 'openid.return_to': o + '/auth/steam/return', 'openid.realm': o, 'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select', 'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select' });
      res.writeHead(302, { Location: 'https://steamcommunity.com/openid/login?' + p }); return res.end();
    }
    if (url.pathname === '/auth/steam/return') return await steamReturn(req, res, url);
    if (url.pathname.startsWith('/r/')) { // referral link: /r/CODE
      res.writeHead(302, { Location: '/', 'Set-Cookie': `cf_ref=${encodeURIComponent(url.pathname.slice(3, 19))}; Path=/; Max-Age=2592000; SameSite=Lax` }); return res.end();
    }
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: hello\ndata: ${JSON.stringify({ ...feedRows(), chat: q('SELECT id, name, lv, text, t FROM chat WHERE hidden=0 ORDER BY id DESC LIMIT 50').all().reverse(), crash: crashPublic(), online: clients.size + 1 })}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    if (!rateLimit('ip:' + ip, 15, 40)) throw new HttpError(429, 'Слишком много запросов');
    const key = req.method + ' ' + url.pathname; const h = ROUTES[key]; if (!h) throw new HttpError(404, 'Не найдено');
    let body = {};
    if (req.method === 'POST') { if (req.headers['x-cf'] !== '1') throw new HttpError(403, 'csrf'); body = await readBody(req); }
    const out = await h({ req, res, url, ip, body });
    send(res, 200, out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : e instanceof G.GameError ? 400 : 500;
    if (status === 500) log('error', req.method, req.url, e.stack || e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Ошибка сервера' : e.message, code: e.code });
  }
});

loadCatalog(); schedulePrices(); crashNewRound();
server.listen(PORT, () => log(`CaseFlip on :${PORT} (data ${DATA}, demo ${DEMO})`));
module.exports = { server };
