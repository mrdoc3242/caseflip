(function(){
const $ = s => document.querySelector(s);
const fmt = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (p, d) => (p * 100).toFixed(d == null ? (p < 0.01 ? 3 : 2) : d) + '%';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- state & backend ----------
// Two backends with one interface: the Node server (when /api/me answers) or the in-browser demo.
// Both run the same rules from games.js, so odds and RTP are identical.
const BASE_KEY = 'caseflip.v1';
const CONFIG = { STEAM_VERIFY_URL: '' }; // demo-only: verify Steam logins via worker/steam-auth.js
let ACC = null; try { ACC = JSON.parse(localStorage.getItem('caseflip.account')); } catch(e){}
let KEY = BASE_KEY + (ACC ? ':' + ACC.steamid : '');
let S, REMOTE = false, ME = null, FEED = null, CHAT = [], ONLINE = 0, CRASH = null;
function load(){ try { S = JSON.parse(localStorage.getItem(KEY)); } catch(e){ S = null; } }
function refresh(){ renderBal(); renderDrops(); renderLevel(); }
function save(){ if (!REMOTE) try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){} refresh(); }
async function newServerSeed(){ const s = CF.randomHex(32); return { server: s, hash: await CF.sha256Hex(s) }; }
async function init(){
  if (!REMOTE) {
    load();
    if (!S || !S.seed) {
      S = GAMES.newState({ balance: 1000, starter: ['ak-elite','m4a4-evil','usp-cortex','famas-roll','mac10-candy'] });
      S.seed = { ...(await newServerSeed()), client: CF.randomHex(8), nonce: 0 };
      save();
    }
    GAMES.migrate(S);
  }
  refresh(); renderAuth(); route();
}
async function api(path, body){
  const r = await fetch(path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CF': '1' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({ error: 'Сервер недоступен' }));
  if (!r.ok || d.error) throw new Error(d.error || 'Ошибка ' + r.status);
  return d;
}
function applyMe(d){ ME = d; S = d.state; }
async function reloadMe(){ if (!REMOTE) return; try { applyMe(await api('/api/me')); refresh(); } catch(e){} }
// run a game action on whichever backend is active; returns the action result, S is updated
async function act(name, args){
  const freeBefore = S.freeCases || 0;
  let res;
  if (REMOTE) { const d = await api('/api/act', { name, args }); S = d.state; res = d.res; }
  else { res = await GAMES.run(name, { S, IT, CAT: CAT || [], CATMAP, now: Date.now(), roll: GAMES.makeRoll(S, S.seed.server, CF.hmacHex) }, args); }
  save();
  if ((S.freeCases || 0) > freeBefore) setTimeout(() => toast(`Новый уровень ${GAMES.levelOf(S.stats.wager).lv}! Бесплатный кейс ждёт в <a href="#profile">профиле</a>`), 1500);
  return res;
}
// wrap UI handlers: show game errors as a toast instead of throwing
const safe = fn => async (...a) => { try { return await fn(...a); } catch(e) { busy = false; toast(esc(e.message || 'Ошибка')); } };
function renderBal(){ $('#bal').textContent = fmt(S ? S.balance : 0); }
function toast(msg){ const t = $('#toast'); t.innerHTML = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 2600); }

// ---------- art ----------
const IMG = /*IMAGES*/{};
const art = (it) => it.spr ? `<div class="spr" role="img" aria-label="${esc(it.name)}" style="background-image:url(sprites/s${it.spr.sheet}.webp);background-size:1000% ${it.spr.rows * 100}%;background-position:${it.spr.c / 9 * 100}% ${it.spr.rows > 1 ? it.spr.r / (it.spr.rows - 1) * 100 : 0}%"></div>` : IMG[it.id] ? `<img src="${IMG[it.id]}" alt="${esc(it.weapon + ' | ' + it.skin)}" loading="lazy" decoding="async">` : ART.itemSVG(it);
const caseArt = (c) => ART.caseSVG(c, IMG[c.drops[0].item.id]);
// re-render without losing page or list scroll position
function keep(fn){ const y = window.scrollY; const ps = [...document.querySelectorAll('.picker')].map(p => p.scrollTop); fn(); document.querySelectorAll('.picker').forEach((p, i) => { if (ps[i] != null) p.scrollTop = ps[i]; }); window.scrollTo(0, y); }
function itemCard(it, extra = '', cls = '', attrs = ''){
  const r = CF.RARITY[it.rarity];
  return `<div class="item ${cls}" style="--rc:${r.color}" ${attrs} title="${esc(it.weapon + ' | ' + it.skin + ' — ' + r.name)}"><div class="art">${art(it)}</div><div class="w">${it.st === 1 ? '<b class="st">ST™</b> ' : it.st === 2 ? '<b class="sv">SV</b> ' : ''}${esc(it.weapon)}</div><div class="s">${esc(it.skin)}${it.wear != null && it.wear < 5 ? ` <span class="wear">${WEAR[it.wear]}</span>` : ''}</div><div class="v"><span>${fmt(it.price)}</span>${extra}</div></div>`;
}

// ---------- routing ----------
const pages = { cases, battles, crash, upgrade, contracts, inventory, profile, fair, terms: () => legal('terms'), privacy: () => legal('privacy'), responsible: () => legal('responsible') };
let busy = false;
function route(){
  const h = (location.hash.slice(1) || 'cases').split('?')[0];
  if (crashTimer && h !== 'crash') { cancelAnimationFrame(crashTimer); crashTimer = null; }
  let [p, arg] = h.startsWith('case-') ? ['case', h.slice(5)] : [h, null];
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.p === (p === 'case' ? 'cases' : p)));
  if (p === 'case') return openCase(arg);
  (pages[p] || cases)();
  window.scrollTo(0, 0);
}
addEventListener('hashchange', () => { if (!busy) route(); });

// ---------- cases ----------
function cases(){
  const hero = CF.CASES.find(c => c.id === 'legend');
  const drops = (S.drops || []).slice(0, 14).map(id => IT(id)).filter(Boolean);
  $('#app').innerHTML = `<section class="hero"><div class="hero-txt"><span class="eyebrow">Кейсы · Апгрейды · Контракты</span><h1>Открывай. Апгрейди.<br><em>Флипай.</em></h1><p class="sub">Шесть кейсов с открытыми шансами, апгрейд с честной формулой и контракты на обмен скинов. Каждый результат можно проверить.</p><div class="ctrl"><a class="btn" href="#case-starter">Открыть первый кейс</a><a class="btn ghost" href="#upgrade">Попробовать апгрейд</a></div></div>
  <a class="hero-art" href="#case-legend" aria-label="Кейс Legend">${caseArt(hero)}<span class="hero-tag">Legend · ${fmt(hero.price)}</span></a></section>
  ${drops.length ? `<section class="sec"><h2>Ваши последние дропы</h2><div class="feed">${drops.map(it => itemCard(it)).join('')}</div></section>` : ''}
  <section class="sec"><div class="sec-h"><h2>Кейсы</h2><span class="sub" style="margin:0">шансы каждого предмета открыты</span></div>
  <div class="grid cases">${CF.CASES.map(c => `<a class="case" href="#case-${c.id}" style="--h:${c.hue}"><div class="box">${caseArt(c)}</div><div class="nm">${esc(c.name)}</div><div class="row"><span>${c.drops.length} предметов · до ${fmt(c.drops[0].item.price)}</span><span class="price">${fmt(c.price)}</span></div></a>`).join('')}</div></section>
  ${statsBlock()}`;
}
function statsBlock(){
  const st = S.stats; const rtp = st.wager ? st.ret / st.wager : 0;
  return `<section class="sec"><h2>Ваша статистика</h2><div class="stats">
  <div class="stat">Игр<b>${st.n}</b></div><div class="stat">Поставлено<b>${fmt(st.wager)}</b></div><div class="stat">Возвращено<b>${fmt(st.ret)}</b></div><div class="stat">Итог<b class="${st.ret - st.wager >= 0 ? 'win' : 'lose'}">${st.ret - st.wager >= 0 ? '+' : '−'}${fmt(Math.abs(st.ret - st.wager))}</b></div></div></section>`;
}
function openCase(id){
  const c = CF.CASES.find(x => x.id === id); if (!c) return cases();
  $('#app').innerHTML = `<section class="sec"><a class="back" href="#cases">← Все кейсы</a>
  <div class="case-head" style="--h:${c.hue}"><div class="case-big">${caseArt(c)}</div><div><span class="eyebrow">Кейс</span><h1>${esc(c.name)}</h1><p class="sub">Цена ${fmt(c.price)} · ${c.drops.length} предметов</p><p class="sub">Самый дорогой предмет: ${esc(c.drops[0].item.weapon)} | ${esc(c.drops[0].item.skin)} (${fmt(c.drops[0].item.price)}, шанс ${pct(c.drops[0].p)})</p></div></div>
  <div class="roul" id="roul"><div class="marker"></div><div class="strip" id="strip"></div></div>
  <div class="ctrl"><button class="btn" id="open">Открыть за ${fmt(c.price)}</button><label class="chk"><input type="checkbox" id="fast"> Быстрое открытие</label></div>
  <div id="res"></div>
  <h2>Содержимое и шансы</h2>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">${c.drops.map(d => itemCard(d.item, `<span class="odds">${pct(d.p)}</span>`)).join('')}</div></section>`;
  const strip = $('#strip');
  const fill = (n) => Array.from({ length: n }, () => CF.pickByRoll(c.drops, Math.random()).item);
  strip.innerHTML = fill(14).map(it => itemCard(it)).join('');
  $('#fast').checked = isFast();
  $('#fast').onchange = e => setFast(e.target.checked);
  $('#open').onclick = async () => {
    if (busy) return;
    if (S.balance < c.price) return toast('Недостаточно средств. Пополните демо-баланс.');
    busy = true; $('#open').disabled = true; $('#res').innerHTML = '';
    let res; try { res = await act('openCase', { caseId: c.id }); } catch(e) { busy = false; $('#open').disabled = false; return toast(esc(e.message)); }
    const r = res.roll, drop = IT(res.drop), inst = { uid: res.uid };
    const WIN = 48, items = fill(56); items[WIN] = drop;
    strip.style.transition = 'none'; strip.style.transform = 'translateX(0)';
    strip.innerHTML = items.map(it => itemCard(it)).join('');
    const cw = 146, box = $('#roul').clientWidth;
    const jitter = (Math.random() * 0.8 + 0.1) * 140;
    const x = -(WIN * cw + jitter - box / 2);
    const fast = $('#fast').checked || matchMedia('(prefers-reduced-motion: reduce)').matches;
    void strip.offsetWidth;
    strip.style.transition = `transform ${fast ? 0.6 : 5.5}s cubic-bezier(.12,.75,.12,1)`;
    strip.style.transform = `translateX(${x}px)`;
    setTimeout(() => {
      busy = false; $('#open').disabled = false;
      const good = drop.price >= c.price;
      const wc = strip.children[WIN]; if (wc) wc.classList.add('winner');
      if (drop.price >= c.price * 3 || ['classified','covert','gold'].includes(drop.rarity)) confetti(CF.RARITY[drop.rarity].color);
      $('#res').innerHTML = `<div class="result">${itemCard(drop)}<div style="display:grid;gap:8px"><div class="${good ? 'win' : 'lose'}" style="font-family:var(--f-display);font-size:18px">${good ? 'Окупился' : 'Не окупился'}: ${fmt(drop.price)}</div><div class="ctrl"><button class="btn sm" id="sell">Продать за ${fmt(drop.price)}</button><a class="btn ghost sm" href="#upgrade" style="text-decoration:none">В апгрейд</a><button class="btn ghost sm" id="again">Ещё раз</button></div><div class="sub" style="margin:0;font-size:12px">Ролл ${r.toFixed(8)} · nonce ${res.nonce}</div></div></div>`;
      $('#sell').onclick = () => { sell([inst.uid]); $('#sell').disabled = true; };
      $('#again').onclick = () => $('#open').click();
    }, fast ? 650 : 5600);
  };
  window.scrollTo(0, 0);
}
async function sell(uids){
  try { const r = await act('sell', { uids }); toast('Продано на ' + fmt(r.value)); return r.value; } catch(e) { toast(esc(e.message)); return 0; }
}

// ---------- market catalog (all CS2 skins > $0.50, daily prices) ----------
const RK = ['consumer','industrial','milspec','restricted','classified','covert','gold'];
const WEAR = ['FN','MW','FT','WW','BS',''];
const WEAR_RU = ['Прямо с завода','Немного поношенное','После полевых испытаний','Поношенное','Закалённое в боях'];
let CAT = null, CATMAP = new Map(), CAT_UPDATED = null;
async function loadCatalog(){
  try {
    const r = await fetch('catalog.json', { cache: 'no-cache' }); const d = await r.json();
    const c = GAMES.buildCatalog(d); CAT_UPDATED = c.updated; CAT = c.CAT;
    CAT.forEach(it => CATMAP.set(it.id, it));
  } catch (e) { CAT = []; }
}
function IT(id){ return CF.ITEMS[id] || CATMAP.get(id) || { id, weapon: 'Предмет', skin: 'недоступен', rarity: 'consumer', price: 0, type: 'rifle' }; }
const MSK = iso => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// ---------- upgrade ----------
let upSel = new Set(), upTarget = null, upQ = '', upWear = -1, upST = 'all', upSort = 'asc', upShow = 60, upBal = 0;
function upgrade(){
  upSel = new Set([...upSel].filter(u => S.inv.some(x => x.uid === u)));
  upBal = Math.max(0, Math.min(upBal, S.balance));
  const skinsV = [...upSel].reduce((a, u) => a + IT(S.inv.find(x => x.uid === u).id).price, 0);
  const inV = +(skinsV + upBal).toFixed(2);
  const minT = inV * CF.RTP / CF.UPGRADE_MAX_CHANCE;
  if (upTarget && (!CATMAP.has(upTarget) || IT(upTarget).price < minT)) upTarget = null;
  const tgt = upTarget ? IT(upTarget) : null;
  const ch = tgt && inV ? CF.upgradeChance(inV, tgt.price) : 0;
  const q = upQ.trim().toLowerCase();
  let list = (CAT || []).filter(i => (!inV || i.price >= minT) && (upWear < 0 || i.wear === upWear) && (upST === 'all' || (upST === 'st' ? i.st === 1 : i.st === 0)) && (!q || i.name.toLowerCase().includes(q)));
  if (upSort === 'desc') list = list.slice().reverse();
  const shown = list.slice(0, upShow);
  $('#app').innerHTML = `<section class="sec"><div class="sec-h" style="justify-content:space-between"><div><h1>Апгрейд</h1><p class="sub">Поставьте скины и/или деньги с баланса и выберите любой скин CS2 дороже ставки. Чем дороже цель, тем ниже шанс (максимум ${pct(CF.UPGRADE_MAX_CHANCE, 0)}). Попадите в FLIP или золотую плашку, чтобы умножить выигрыш.</p></div>${CAT_UPDATED ? `<span class="pill">Цены обновлены ${MSK(CAT_UPDATED)} МСК</span>` : ''}</div>
  <div class="up">
    <div class="panel" style="display:grid;gap:12px;align-content:start"><h2>Ставка · <span class="price">${fmt(inV)}</span></h2>
      <label class="balbet">С баланса, $ <input type="number" id="upBal" min="0" step="0.01" value="${upBal || ''}" placeholder="0.00"></label>
      <div class="picker">${S.inv.length ? `<div class="grid">${S.inv.map(x => itemCard(IT(x.id), '', 'pick' + (upSel.has(x.uid) ? ' sel' : ''), `data-u="${x.uid}"`)).join('')}</div>` : '<div class="empty">Инвентарь пуст. Откройте кейс или поставьте деньги с баланса.</div>'}</div></div>
    <div style="display:grid;gap:14px;justify-items:center;align-self:start;position:sticky;top:90px">
      <div class="dial" id="dial"><div class="ring" id="ring" style="background:${ringBg(ch, null)}"></div>${zoneLabels(ch, null)}<div class="needle" id="needle"></div><div class="mid" id="dmid"><div><div class="pct">${pct(ch, 2)}</div><div class="lbl">шанс</div></div></div></div>
      <div class="bonuses"><div><span class="bz flipc">FLIP</span> монетка: 50% на <b>x2</b></div><div><span class="bz gold">x?</span> плашка в 25% прокрутов</div><div class="bodds"><b>x1.5</b> 50% · <b>x2</b> 35% · <b>x3</b> 15%</div></div>
      ${tgt ? `<div class="tgtmini">${itemCard(tgt)}<button class="btn ghost sm" data-buy="${esc(tgt.id)}" style="width:100%;margin-top:6px" ${S.balance >= tgt.price ? '' : 'disabled'}>Купить за ${fmt(tgt.price)}</button></div>` : ''}
      <div class="ctrl" style="justify-content:center"><button class="btn big" id="go" ${ch > 0 ? '' : 'disabled'}>Апгрейд</button><button class="btn ghost fastbtn ${isFast() ? 'on' : ''}" id="upfast" aria-pressed="${isFast()}" title="Быстрый прокрут">⚡ Быстро</button></div><div id="ures" style="min-height:22px;font-family:var(--f-display);font-size:18px;text-align:center"></div></div>
    <div class="panel" style="display:grid;gap:10px;align-content:start;min-width:0"><h2>Цель ${tgt ? '· <span class="price">' + fmt(tgt.price) + '</span>' : ''}</h2>
      <input type="text" id="upQ" placeholder="Поиск: AK-47, Asiimov, Karambit…" value="${esc(upQ)}">
      <div class="tabs">${['Все', ...WEAR.slice(0, 5)].map((w, i) => `<button data-w="${i - 1}" class="${upWear === i - 1 ? 'on' : ''}">${w}</button>`).join('')}<span style="width:6px"></span>${[['all','Все'],['st','StatTrak™'],['no','Обычные']].map(([k, l]) => `<button data-st="${k}" class="${upST === k ? 'on' : ''}">${l}</button>`).join('')}<button data-sort class="on">${upSort === 'asc' ? 'Цена ↑' : 'Цена ↓'}</button></div>
      <div class="mults">${[1.5, 2, 3, 5, 10, 20].map(m => `<button class="btn ghost sm" data-m="${m}" ${inV ? '' : 'disabled'}>x${m}</button>`).join('')}</div>
      <div class="sub" style="margin:0;font-size:12px">${list.length.toLocaleString('ru-RU')} скинов${inV ? ` дороже ${fmt(minT)}` : ''}</div>
      <div class="picker" id="tpick">${!CAT ? '<div class="empty">Загружаю каталог…</div>' : shown.length ? `<div class="grid">${shown.map(i => itemCard(i, inV ? `<span class="odds">${pct(CF.upgradeChance(inV, i.price), 1)}</span>` : '', 'pick' + (upTarget === i.id ? ' sel' : ''), `data-t="${esc(i.id)}"`).replace('<div class="art">', `<button class="buy" data-buy="${esc(i.id)}" title="Купить за ${fmt(i.price)}" aria-label="Купить за ${fmt(i.price)}" ${S.balance >= i.price ? '' : 'disabled'}>Купить</button><div class="art">`)).join('')}</div>${list.length > upShow ? '<button class="btn ghost sm" id="more" style="width:100%;margin-top:8px">Показать ещё</button>' : ''}` : '<div class="empty">Ничего не найдено.</div>'}</div></div>
  </div></section>`;
  document.querySelectorAll('[data-u]').forEach(el => el.onclick = () => { if (busy) return; const u = +el.dataset.u; upSel.has(u) ? upSel.delete(u) : upSel.add(u); keep(upgrade); });
  document.querySelectorAll('[data-t]').forEach(el => el.onclick = () => { if (busy) return; upTarget = el.dataset.t; keep(upgrade); });
  document.querySelectorAll('[data-buy]').forEach(el => el.onclick = e => { e.stopPropagation(); if (busy) return; buySkin(el.dataset.buy); });
  document.querySelectorAll('[data-w]').forEach(el => el.onclick = () => { upWear = +el.dataset.w; upShow = 60; keep(upgrade); });
  document.querySelectorAll('[data-st]').forEach(el => el.onclick = () => { upST = el.dataset.st; upShow = 60; keep(upgrade); });
  $('[data-sort]').onclick = () => { upSort = upSort === 'asc' ? 'desc' : 'asc'; upShow = 60; keep(upgrade); };
  const more = $('#more'); if (more) more.onclick = () => { upShow += 60; keep(upgrade); };
  let qt; $('#upQ').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { upQ = e.target.value; upShow = 60; keep(upgrade); const el = $('#upQ'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250); };
  let bt; $('#upBal').oninput = e => { clearTimeout(bt); bt = setTimeout(() => { upBal = Math.max(0, Math.min(+e.target.value || 0, S.balance)); keep(upgrade); const el = $('#upBal'); el.focus(); }, 400); };
  document.querySelectorAll('[data-m]').forEach(el => el.onclick = () => { const want = inV * +el.dataset.m; const pool = (CAT || []).filter(i => i.price >= minT && (upWear < 0 || i.wear === upWear) && (upST === 'all' || (upST === 'st' ? i.st === 1 : i.st === 0))); const t = pool.reduce((b, i) => !b || Math.abs(i.price - want) < Math.abs(b.price - want) ? i : b, null); if (t) { upTarget = t.id; upQ = ''; keep(upgrade); } });
  $('#upfast').onclick = () => { setFast(!isFast()); const b = $('#upfast'); b.classList.toggle('on', isFast()); b.setAttribute('aria-pressed', isFast()); };
  $('#go').onclick = async () => {
    if (busy || !ch) return;
    if (upBal > S.balance) return toast('Недостаточно средств');
    busy = true; $('#go').disabled = true;
    const target = tgt, fast = isFast() || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let o; try { o = await act('upgrade', { uids: [...upSel], bal: upBal, target: target.id }); } catch(e) { busy = false; $('#go').disabled = false; return toast(esc(e.message)); }
    const plate = o.plate, r1 = o.r1;
    // 1) gold plate shows up, 2) needle, 3) coin only if the needle hit FLIP (rolls are already settled)
    if (plate) { $('#ring').style.background = ringBg(ch, plate); $('#dial').insertAdjacentHTML('beforeend', zoneLabels(ch, plate, true)); await wait(fast ? 350 : 1000); }
    const needle = $('#needle'); const turns = 4 * 360 + (180 - ch * 180) + r1 * 360; // win arc is centred at the bottom
    needle.style.transition = `transform ${fast ? .5 : 3.2}s cubic-bezier(.15,.8,.15,1)`;
    needle.style.transform = `rotate(${turns}deg)`;
    await wait(fast ? 550 : 3300);
    if (o.zone === 'flip') {
      $('#dmid').innerHTML = `<div class="coin ${o.heads ? 'heads' : 'tails'}" style="--dur:${fast ? .7 : 1.6}s"><div class="face f1">x2</div><div class="face f2">x1</div></div>`;
      await wait(fast ? 800 : 1800);
    }
    busy = false; upSel.clear(); upBal = 0;
    if (o.won) { confetti(o.mult > 1 ? '#ffd166' : undefined); $('#ring').classList.add('flash'); }
    const nm = `${esc(target.weapon)} | ${esc(target.skin)}`;
    $('#ures').innerHTML = !o.won ? `<span class="lose">Не повезло · ролл ${r1.toFixed(4)}</span>`
      : o.mult > 1 ? `<span class="win">${o.zone === 'flip' ? 'FLIP!' : 'Плашка!'} x${o.mult}: ${nm} + ${fmt(target.price * (o.mult - 1))} на баланс</span>`
      : `<span class="win">Успех! +${nm}${o.zone === 'flip' ? ' · монетка: x1' : ''}</span>`;
    setTimeout(() => keep(upgrade), fast ? 1200 : 2200);
  };
}

async function buySkin(id){
  const it = IT(id);
  if (S.balance < it.price) return toast('Недостаточно средств на балансе');
  let inst; try { inst = await act('buy', { id }); } catch(e) { return toast(esc(e.message)); }
  upSel.add(inst.uid); keep(upgrade);
  toast(`Куплено: ${esc(it.weapon)} | ${esc(it.skin)} за ${fmt(it.price)}. Скин в инвентаре и уже выбран в ставку`);
}

// ---------- upgrade dial drawing ----------
function ringBg(ch, plate){
  const F = 180 - ch * 180, A = ch * 360, B = CF.BONUS, W = 'var(--win)', T = '#2a3159';
  const st = [[0, W], [B.flipFrom, W], [B.flipFrom, 'var(--flip)'], [B.flipTo, 'var(--flip)'], [B.flipTo, W], [1, W]];
  let segs = st;
  if (plate) { segs = []; const cuts = [...st.map(x => x[0]), plate.from, plate.to].sort((a, b) => a - b); for (let i = 0; i < cuts.length - 1; i++) { const m = (cuts[i] + cuts[i + 1]) / 2; const c = m >= plate.from && m < plate.to ? 'var(--gold)' : m >= B.flipFrom && m < B.flipTo ? 'var(--flip)' : W; segs.push([cuts[i], c], [cuts[i + 1], c]); } }
  return `conic-gradient(from ${F}deg, ${segs.map(([u, c]) => `${c} ${(u * A).toFixed(3)}deg`).join(', ')}, ${T} ${A.toFixed(3)}deg 360deg)`;
}
function zoneLabels(ch, plate, onlyPlate){
  if (!ch) return '';
  const F = 180 - ch * 180, A = ch * 360, B = CF.BONUS;
  const lab = (u, txt, cls) => { const ang = F + u * A; return `<span class="zlab ${cls}" style="transform:rotate(${ang}deg) translateY(-103px) rotate(${-ang}deg)">${txt}</span>`; };
  let h = onlyPlate ? '' : lab((B.flipFrom + B.flipTo) / 2, 'FLIP', 'flipc');
  if (plate) h += lab((plate.from + plate.to) / 2, 'x' + plate.mult, 'gold pop');
  return h;
}

// ---------- contracts ----------
let ctSel = new Set();
const contractPool = total => GAMES.contractPool(CAT, total);
function contracts(){
  ctSel = new Set([...ctSel].filter(u => S.inv.some(x => x.uid === u)));
  const total = [...ctSel].reduce((a, u) => a + IT(S.inv.find(x => x.uid === u).id).price, 0);
  const n = ctSel.size;
  const outs = n >= 3 ? contractPool(total) : null;
  const can = n >= 3 && n <= 10 && outs;
  $('#app').innerHTML = `<section class="sec"><div><h1>Контракты</h1><p class="sub">Обменяйте от 3 до 10 скинов на один. Результат лежит в диапазоне от 0.25x до 4x суммы ваших скинов, шанс каждого исхода виден до подписания.</p></div>
  <div class="up" style="grid-template-columns:1.3fr 1fr">
    <div class="panel" style="display:grid;gap:12px"><div class="ctrl" style="justify-content:space-between"><h2>Ваши скины · ${n}/10</h2><span class="price">${fmt(total)}</span></div>
      <div class="picker">${S.inv.length ? `<div class="grid">${S.inv.map(x => itemCard(IT(x.id), '', 'pick' + (ctSel.has(x.uid) ? ' sel' : ''), `data-c="${x.uid}"`)).join('')}</div>` : '<div class="empty">Инвентарь пуст. Откройте пару кейсов.</div>'}</div></div>
    <div class="panel" style="display:grid;gap:12px;align-content:start;min-width:0"><h2>Возможный результат</h2>
      ${n < 3 ? '<div class="empty">Выберите минимум 3 скина.</div>' : !outs ? '<div class="empty">Для такой суммы нет подходящих предметов. Измените набор.</div>' :
      `<div class="tbl"><table><thead><tr><th>Предмет</th><th>Цена</th><th>x</th><th>Шанс</th></tr></thead><tbody>${outs.map(o => `<tr><td><span style="color:${CF.RARITY[o.item.rarity].color}">●</span> ${esc(o.item.name || o.item.weapon + ' | ' + o.item.skin)}</td><td class="m">${fmt(o.item.price)}</td><td class="m ${o.item.price >= total ? 'win' : 'lose'}">${(o.item.price / total).toFixed(2)}</td><td class="m">${pct(o.p)}</td></tr>`).join('')}</tbody></table></div>`}
      <button class="btn" id="sign" ${can ? '' : 'disabled'}>Подписать контракт</button><div id="cres"></div></div>
  </div></section>`;
  document.querySelectorAll('[data-c]').forEach(el => el.onclick = () => { if (busy) return; const u = +el.dataset.c; if (ctSel.has(u)) ctSel.delete(u); else if (ctSel.size < 10) ctSel.add(u); else toast('Максимум 10 скинов'); keep(contracts); });
  $('#sign').onclick = () => { if (busy || !can) return; signaturePad(total, sig => runContract(outs, total, sig)); };
}
async function runContract(outs, total, sig){
  busy = true;
  let res; try { res = await act('contract', { uids: [...ctSel] }); } catch(e) { busy = false; return toast(esc(e.message)); }
  const r = res.roll, got = IT(res.got); ctSel.clear();
  keep(contracts);
  if (got.price >= total) confetti();
  $('#cres').innerHTML = `<div class="result signed"><img class="sigimg" src="${sig}" alt="Ваша подпись">${itemCard(got)}<div style="display:grid;gap:6px"><div class="${got.price >= total ? 'win' : 'lose'}" style="font-family:var(--f-display);font-size:18px">${got.price >= total ? 'Плюс' : 'Минус'} ${(got.price / total).toFixed(2)}x · ${fmt(got.price)}</div><div class="sub" style="margin:0;font-size:12px">Контракт подписан · ролл ${r.toFixed(6)}</div></div></div>`;
  busy = false;
}

// ---------- signature pad ----------
const INKS = [['#ff8a3d','Оранжевый'],['#ffd166','Золотой'],['#3ddc97','Зелёный'],['#43c5ff','Голубой'],['#ff5fa8','Розовый'],['#b18cff','Фиолетовый'],['#ffffff','Белый'],['rainbow','Радуга']];
let INK = 'rainbow';
function signaturePad(total, done){
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="modal-box sigbox" role="dialog" aria-modal="true" aria-label="Подпись контракта"><div class="ctrl" style="justify-content:space-between"><h2>Подпишите контракт</h2><span class="price">${fmt(total)}</span></div>
  <p class="sub" style="margin:0">Распишитесь пальцем или мышкой. Выберите цвет чернил.</p>
  <div class="inks">${INKS.map(([c, l]) => `<button class="ink ${INK === c ? 'on' : ''}" data-ink="${c}" title="${l}" aria-label="${l}" style="${c === 'rainbow' ? '' : '--c:' + c}"></button>`).join('')}</div>
  <div class="sigwrap"><canvas id="sigc"></canvas><div class="sigline"><span>✕</span></div><div class="sighint" id="sighint">Распишитесь здесь</div></div>
  <div class="ctrl"><button class="btn ghost sm" id="sclear">Стереть</button><button class="btn ghost sm" id="sauto">Автоподпись</button><span style="flex:1"></span><button class="btn ghost sm" data-close>Отмена</button><button class="btn" id="sok" disabled>Подписать</button></div></div>`;
  document.body.appendChild(m);
  const cv = m.querySelector('#sigc'), wrap = m.querySelector('.sigwrap'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = wrap.clientWidth, H = wrap.clientHeight; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const x = cv.getContext('2d'); x.scale(dpr, dpr); x.lineCap = 'round'; x.lineJoin = 'round';
  let ink = 0, hue = Math.random() * 360, last = null, lastW = 3;
  const color = () => INK === 'rainbow' ? `hsl(${hue % 360} 95% 62%)` : INK;
  function seg(p){
    if (!last) { last = p; return; }
    const d = Math.hypot(p.x - last.x, p.y - last.y); if (d < 0.5) return;
    const w = Math.max(1.6, Math.min(6, 7 - d * 0.35)); lastW = lastW * 0.6 + w * 0.4; hue += d * 0.9;
    x.strokeStyle = color(); x.shadowColor = color(); x.shadowBlur = 10; x.lineWidth = lastW;
    x.beginPath(); x.moveTo(last.x, last.y); x.lineTo(p.x, p.y); x.stroke();
    ink += d; last = p;
    if (ink > 120) m.querySelector('#sok').disabled = false;
    m.querySelector('#sighint').hidden = true;
  }
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); last = null; seg(pos(e)); };
  cv.onpointermove = e => { if (e.buttons || e.pointerType === 'touch') { if (cv.hasPointerCapture(e.pointerId)) seg(pos(e)); } };
  cv.onpointerup = () => { last = null; };
  m.querySelectorAll('[data-ink]').forEach(b => b.onclick = () => { INK = b.dataset.ink; m.querySelectorAll('[data-ink]').forEach(z => z.classList.toggle('on', z === b)); });
  m.querySelector('#sclear').onclick = () => { x.clearRect(0, 0, W, H); ink = 0; m.querySelector('#sok').disabled = true; m.querySelector('#sighint').hidden = false; };
  m.querySelector('#sauto').onclick = () => {
    // animated autograph: a looping scribble with a flourish underline
    const pts = []; const y0 = H * 0.6, x0 = W * 0.12, len = W * 0.66, loops = 6 + Math.floor(Math.random() * 4), ph = Math.random() * 6;
    for (let t = 0; t <= 1; t += 0.0025) { const th = t * Math.PI * 2 * loops; const r = 9 + 9 * Math.abs(Math.sin(t * 4.3 + ph)); pts.push({ x: x0 + t * len - r * Math.sin(th) * 0.9, y: y0 - r * (1 - Math.cos(th)) * 1.25 - Math.sin(t * 2.2 + ph) * 8 }); }
    const brk = pts.length;
    for (let t = 0; t <= 1; t += 0.008) pts.push({ x: x0 + len * 1.04 - t * len * 1.1, y: y0 + 22 + Math.sin(t * Math.PI) * 10 - t * 6 });
    let i = 0; last = null;
    (function step(){ for (let k = 0; k < 6 && i < pts.length; k++, i++) { if (i === brk) last = null; seg(pts[i]); } if (i < pts.length) requestAnimationFrame(step); else last = null; })();
  };
  m.onclick = e => { if (e.target === m || e.target.hasAttribute('data-close')) m.remove(); };
  m.querySelector('#sok').onclick = () => {
    const url = cv.toDataURL('image/png');
    m.querySelector('.sigwrap').classList.add('stamp');
    setTimeout(() => { m.remove(); done(url); }, 700);
  };
}

// ---------- inventory ----------
let invSel = new Set();
function inventory(){
  invSel = new Set([...invSel].filter(u => S.inv.some(x => x.uid === u)));
  const total = S.inv.reduce((a, x) => a + IT(x.id).price, 0);
  const selV = [...invSel].reduce((a, u) => a + IT(S.inv.find(x => x.uid === u).id).price, 0);
  $('#app').innerHTML = `<section class="sec"><div><h1>Инвентарь</h1><p class="sub">${S.inv.length} предметов на ${fmt(total)}. Продажа идёт по полной цене предмета.</p></div>
  <div class="ctrl"><button class="btn" id="sellSel" ${invSel.size ? '' : 'disabled'}>Продать выбранные (${fmt(selV)})</button><button class="btn ghost" id="selAll" ${S.inv.length ? '' : 'disabled'}>Выбрать все</button><button class="btn ghost" id="wd" ${invSel.size ? '' : 'disabled'}>Вывести в Steam</button></div>
  ${S.inv.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">${S.inv.map(x => itemCard(IT(x.id), '', 'pick' + (invSel.has(x.uid) ? ' sel' : ''), `data-i="${x.uid}"`)).join('')}</div>` : '<div class="empty panel">Пока пусто. <a href="#cases" style="color:var(--accent)">Открыть кейс</a></div>'}
  </section>${statsBlock()}
  ${REMOTE ? '' : '<section class="sec"><div class="ctrl"><button class="btn ghost sm" id="reset">Сбросить демо-аккаунт</button><span id="rconf"></span></div></section>'}`;
  document.querySelectorAll('[data-i]').forEach(el => el.onclick = () => { const u = +el.dataset.i; invSel.has(u) ? invSel.delete(u) : invSel.add(u); keep(inventory); });
  $('#sellSel').onclick = async () => { await sell([...invSel]); invSel.clear(); inventory(); };
  $('#wd').onclick = () => withdrawModal([...invSel]);
  $('#selAll').onclick = () => { S.inv.forEach(x => invSel.add(x.uid)); inventory(); };
  if ($('#reset')) $('#reset').onclick = () => { $('#rconf').innerHTML = '<button class="btn sm" id="ryes" style="background:var(--lose)">Да, сбросить всё</button>'; $('#ryes').onclick = async () => { try { localStorage.removeItem(KEY); } catch(e){} S = null; await init(); toast('Аккаунт сброшен'); }; };
}

// ---------- fairness ----------
function fair(){
  const sd = S.seed;
  $('#app').innerHTML = `<section class="sec"><div><h1>Честная игра</h1><p class="sub">Перед игрой вы видите SHA-256 хэш серверного сида. Каждый результат: <code>HMAC-SHA256(server_seed, client_seed:nonce)</code>, первые 52 бита делятся на 2<sup>52</sup> и дают число от 0 до 1. После смены сида старый сид раскрывается, и любой ролл можно пересчитать. В апгрейде на один прокрут уходит до трёх роллов подряд: upgrade:plate (появится ли плашка и её множитель), upgrade (стрелка) и upgrade:flip (монетка, только если стрелка попала в FLIP).</p></div>
  <div class="panel" style="display:grid;gap:14px"><h2>Текущие сиды</h2><dl class="kv">
    <dt>Хэш server seed</dt><dd>${sd.hash}</dd><dt>Client seed</dt><dd><input type="text" id="cseed" value="${esc(sd.client)}" maxlength="64"></dd><dt>Nonce</dt><dd>${sd.nonce}</dd></dl>
    <div class="ctrl"><button class="btn sm" id="saveC">Сохранить client seed</button><button class="btn ghost sm" id="rot">Сменить server seed и раскрыть текущий</button></div></div>
  <div class="panel" style="display:grid;gap:12px"><h2>Проверить ролл</h2>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))"><input type="text" id="vS" placeholder="server seed"><input type="text" id="vC" placeholder="client seed"><input type="text" id="vN" placeholder="nonce"></div>
    <div class="ctrl"><button class="btn sm" id="verify">Посчитать</button><span id="vOut" class="money"></span></div></div>
  <div class="panel" style="display:grid;gap:12px"><h2>Проверить раунд краша</h2><p class="sub" style="margin:0">Хэш сида раунда показывается до приёма ставок, сам сид раскрывается после краша. Точка краша: <code>r = HMAC-SHA256(seed, "crash:" + номер)</code>, затем <code>max(1, floor(97.5 / (1 − r)) / 100)</code>.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))"><input type="text" id="cS" placeholder="seed раунда"><input type="text" id="cN" placeholder="номер раунда"></div>
    <div class="ctrl"><button class="btn sm" id="cverify">Посчитать</button>${REMOTE ? '<button class="btn ghost sm" id="cload">Взять последний раунд</button>' : ''}<span id="cOut" class="money"></span></div></div>
  ${S.revealed.length ? `<div class="panel" style="display:grid;gap:10px"><h2>Раскрытые сиды</h2><div class="tbl"><table><thead><tr><th>Server seed</th><th>Хэш</th><th>Игр</th></tr></thead><tbody>${S.revealed.map(r => `<tr><td class="m">${r.server}</td><td class="m">${r.hash.slice(0, 16)}…</td><td class="m">${r.n}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
  <div class="panel" style="display:grid;gap:10px"><h2>История</h2>${S.log.length ? `<div class="tbl"><table><thead><tr><th>Режим</th><th>Nonce</th><th>Client</th><th>Хэш сида</th><th>Ролл</th><th>Ставка</th><th>Итог</th><th>Детали</th></tr></thead><tbody>${S.log.map(l => `<tr><td>${esc(l.kind)}</td><td class="m">${l.nonce}</td><td class="m">${esc(l.client)}</td><td class="m">${String(l.hash || '').slice(0, 10)}…</td><td class="m">${l.roll != null ? l.roll.toFixed(8) : ''}</td><td class="m">${l.w != null ? fmt(l.w) : ''}</td><td class="m ${l.r >= l.w ? 'win' : 'lose'}">${l.r != null ? fmt(l.r) : ''}</td><td>${esc(l.detail || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Пока нет игр.</div>'}</div>
</section>`;
  $('#saveC').onclick = safe(async () => { await act('setClientSeed', { seed: $('#cseed').value }); toast('Client seed сохранён'); fair(); });
  $('#rot').onclick = safe(async () => {
    if (REMOTE) { S = (await api('/api/seed/rotate', {})).state; } else { GAMES.rotateSeed(S, sd.server, await newServerSeed()); }
    save(); toast('Старый server seed раскрыт'); fair();
  });
  $('#cverify').onclick = async () => { const sd2 = $('#cS').value.trim(), n = $('#cN').value.trim(); if (!sd2 || !n) return $('#cOut').textContent = 'Заполните оба поля'; const h = await CF.hmacHex(sd2, 'crash:' + n); const r = CF.hexToRoll(h); $('#cOut').innerHTML = `r = ${r.toFixed(8)} · краш x${GAMES.crashPoint(r).toFixed(2)} · sha256(seed) = ${(await CF.sha256Hex(sd2)).slice(0, 16)}…`; };
  if ($('#cload')) $('#cload').onclick = safe(async () => { const last = CRASH && CRASH.history && CRASH.history[0]; if (!last) return toast('Пока нет завершённых раундов'); const v = await api('/api/crash/verify?id=' + last.id); $('#cS').value = v.seed; $('#cN').value = v.id; $('#cverify').click(); });
  $('#verify').onclick = async () => { const s = $('#vS').value.trim(), c = $('#vC').value.trim(), n = $('#vN').value.trim(); if (!s || !c || n === '') return $('#vOut').textContent = 'Заполните все три поля'; const r = await CF.fairRoll(s, c, +n); const h = await CF.sha256Hex(s); $('#vOut').innerHTML = `ролл = ${r.roll.toFixed(8)} · sha256(seed) = ${h.slice(0, 16)}…`; };
}


// ---------- fast mode ----------
function isFast(){ try { return localStorage.getItem('caseflip.fast') === '1'; } catch(e) { return false; } }
function setFast(v){ try { localStorage.setItem('caseflip.fast', v ? '1' : '0'); } catch(e){} }

// ---------- top drops strip (this player's real drops) ----------
let dropTab = 'top';
const SRC = { case: 'Кейс', upgrade: 'Апгрейд', contract: 'Контракт', battle: 'Батл', crash: 'Краш' };
function renderDrops(){
  const el = $('#drops'); if (!el || !S) return;
  const list = REMOTE && FEED ? (dropTab === 'top' ? FEED.top : FEED.recent).map(e => ({ id: e.item, p: e.price, src: e.src, name: e.name })) : ((dropTab === 'top' ? S.top : S.recent) || []);
  let cards;
  if (list.length) cards = list.map(e => { const it = IT(e.id); const r = CF.RARITY[it.rarity]; return `<div class="drop" style="--rc:${r.color}" title="${esc((it.name || it.weapon + ' | ' + it.skin) + ' · ' + SRC[e.src])}"><div class="dart">${art(it)}</div><div class="dtx"><b>${esc(it.skin)}</b><span>${fmt(e.p)} · ${e.name ? esc(e.name) : SRC[e.src]}</span></div></div>`; }).join('');
  else cards = `<div class="drop-empty">${REMOTE ? 'Здесь появятся лучшие дропы игроков.' : 'Здесь появятся ваши лучшие дропы.'} Самое дорогое в кейсах: ${[...new Set(CF.CASES.map(c => c.drops[0].item))].sort((a, b) => b.price - a.price).slice(0, 3).map(i => esc(i.weapon + ' | ' + i.skin) + ' ' + fmt(i.price)).join(', ')}</div>`;
  el.innerHTML = `<div class="wrap dropbar"><div class="dtabs"><button class="${dropTab === 'top' ? 'on' : ''}" data-dt="top">🏆 ${REMOTE ? 'Топ за 24ч' : 'Топ дропы'}</button><button class="${dropTab === 'recent' ? 'on' : ''}" data-dt="recent">Последние</button></div><div class="dtrack"><div class="drow ${list.length > 6 ? 'marq' : ''}">${cards}${list.length > 6 ? cards : ''}</div></div></div>`;
  el.querySelectorAll('[data-dt]').forEach(b => b.onclick = () => { dropTab = b.dataset.dt; renderDrops(); });
}

// ---------- level & daily bonus ----------
const levelOf = GAMES.levelOf;
function renderLevel(){
  const el = $('#lvl'); if (!el || !S) return;
  const L = levelOf(S.stats.wager);
  const ready = !S.bonusAt || Date.now() - S.bonusAt >= 864e5;
  el.innerHTML = `<span class="lv" title="Уровень растёт от суммы ставок">${L.lv}</span><span class="lvbar"><i style="width:${Math.min(100, L.xp / L.need * 100).toFixed(1)}%"></i></span><button class="btn sm bonus ${ready ? 'ready' : ''}" id="bonus" ${ready ? '' : 'disabled'}>${ready ? '🎁 Бонус' : '🎁 ' + untilBonus()}</button>${S.freeCases ? `<a class="fcase" href="#profile" title="Бесплатные кейсы">📦 ${S.freeCases}</a>` : ''}`;
  $('#bonus').onclick = claimBonus;
}
function untilBonus(){ const ms = 864e5 - (Date.now() - S.bonusAt); const h = Math.floor(ms / 36e5), m = Math.floor(ms % 36e5 / 6e4); return `${h}ч ${m}м`; }
const claimBonus = safe(async () => {
  if (S.bonusAt && Date.now() - S.bonusAt < 864e5) return;
  const r = await act('dailyBonus');
  confetti('#ffd166'); toast(`+${fmt(r.amount)} · серия ${r.streak} дн. Заходите завтра, бонус вырастет`);
});
setInterval(() => { if (S) renderLevel(); }, 60000);

// ---------- confetti ----------
function confetti(main){
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas'); c.className = 'confetti'; document.body.appendChild(c);
  const W = c.width = innerWidth, H = c.height = innerHeight, x = c.getContext('2d');
  const cols = [main || '#ff8a3d', '#ffd166', '#3ddc97', '#43c5ff', '#ff5fa8', '#b18cff'];
  const P = Array.from({ length: 140 }, () => ({ x: W / 2 + (Math.random() - .5) * 200, y: H * 0.45, vx: (Math.random() - .5) * 16, vy: -Math.random() * 16 - 4, r: Math.random() * 6 + 3, a: Math.random() * 6, va: (Math.random() - .5) * .4, c: cols[Math.random() * cols.length | 0] }));
  let t = 0; (function f(){ x.clearRect(0, 0, W, H); for (const p of P) { p.vy += .45; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c; x.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); x.restore(); } if (++t < 110) requestAnimationFrame(f); else c.remove(); })();
}

// ---------- Steam login (OpenID 2.0) ----------
const IN_FRAME = (() => { try { return window.top !== window; } catch(e) { return true; } })();
function steamLoginUrl(){
  const ret = location.origin + location.pathname;
  const q = new URLSearchParams({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'checkid_setup', 'openid.return_to': ret, 'openid.realm': location.origin, 'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select', 'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select' });
  return 'https://steamcommunity.com/openid/login?' + q;
}
async function handleSteamReturn(){
  const q = new URLSearchParams(location.search);
  if (q.get('openid.mode') !== 'id_res') return;
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(q.get('openid.claimed_id') || '');
  history.replaceState(null, '', location.pathname + location.hash);
  if (!m) return toast('Steam не подтвердил вход');
  let acc = { steamid: m[1], name: null, avatar: null, verified: false };
  if (CONFIG.STEAM_VERIFY_URL) {
    try { const r = await fetch(CONFIG.STEAM_VERIFY_URL, { method: 'POST', body: q }); const d = await r.json(); if (!d.steamid) throw 0; acc = { ...acc, ...d, verified: true }; }
    catch(e) { return toast('Не удалось проверить вход через Steam'); }
  }
  setAccount(acc);
}
function setAccount(acc){
  ACC = acc; try { acc ? localStorage.setItem('caseflip.account', JSON.stringify(acc)) : localStorage.removeItem('caseflip.account'); } catch(e){}
  KEY = BASE_KEY + (acc ? ':' + acc.steamid : ''); S = null; init(); renderAuth();
}
function renderAuth(){
  const el = $('#auth');
  if (REMOTE) {
    const u = ME.user;
    if (!u.steamid) { el.innerHTML = `<a class="btn steam sm" href="/auth/steam">${STEAM_ICON}Войти через Steam</a>`; return; }
    el.innerHTML = `<a class="who" href="#profile">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : `<i>${esc(u.name[0])}</i>`}<span>${esc(u.name)}</span></a><button class="btn ghost sm" id="logout">Выйти</button>`;
    $('#logout').onclick = safe(async () => { await api('/api/logout', {}); location.reload(); });
    return;
  }
  if (!ACC) { el.innerHTML = `<button class="btn steam sm" id="login">${STEAM_ICON}Войти через Steam</button>`; $('#login').onclick = login; return; }
  const nm = ACC.name || 'Steam ···' + ACC.steamid.slice(-4);
  el.innerHTML = `<span class="who">${ACC.avatar ? `<img src="${esc(ACC.avatar)}" alt="">` : `<i>${esc(nm[0])}</i>`}<span>${esc(nm)}</span></span><button class="btn ghost sm" id="logout">Выйти</button>`;
  $('#logout').onclick = () => { setAccount(null); toast('Вы вышли из аккаунта'); };
}
function login(){
  if (IN_FRAME || location.protocol === 'file:') return modal(`<h2>Вход через Steam</h2><p class="sub">Steam после входа возвращает игрока обратно на адрес сайта. В этом предпросмотре такой возврат невозможен, поэтому кнопка заработает, когда CaseFlip будет на своём домене.</p><p class="sub">Сейчас прогресс сохраняется в гостевом профиле этого браузера.</p><div class="ctrl"><button class="btn" data-close>Понятно</button></div>`);
  location.href = steamLoginUrl();
}
function modal(html){
  const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">${html}</div>`;
  m.onclick = e => { if (e.target === m || e.target.hasAttribute('data-close')) m.remove(); };
  document.body.appendChild(m); m.querySelector('button')?.focus();
}
const STEAM_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><circle cx="16" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="8" r="1.8"/><circle cx="8" cy="16" r="3.5"/><path d="M2 13 L8 16 L13 10.5" stroke="currentColor" stroke-width="2" fill="none"/></svg>';

$('#topup').onclick = safe(async () => {
  if (REMOTE) { S = (await api('/api/topup', {})).state; } else { GAMES.bonusCredit(S, 500); }
  save(); toast('+$500 демо-баланса');
});
async function detectServer(){
  if (location.protocol === 'file:') return false;
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (!(r.headers.get('content-type') || '').includes('json')) return false;
    const d = await r.json();
    if (d.server) { applyMe(d); return true; }
    if (d.error) { setTimeout(() => toast(esc(d.error) + ' Пока работает демо-режим в браузере.'), 800); return false; }
  } catch(e){}
  return false;
}
function boot(){
initLang(); ageGate();
Promise.all([detectServer(), loadCatalog()]).then(async ([srv]) => {
  REMOTE = !!srv;
  document.documentElement.classList.toggle('remote', REMOTE);
  if (REMOTE) { connectLive(); const err = /err=([^&]+)/.exec(location.hash); if (err) { toast('Steam не подтвердил вход'); history.replaceState(null, '', location.pathname + '#profile'); } }
  else await handleSteamReturn();
  init();
}).catch(e => { console.error(e); init(); });
}
})();
