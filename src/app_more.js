
// ---------- case battles (you vs bot, winner takes every item) ----------
let btCases = ['starter', 'rifle'];
function battles(){
  const cost = btCases.reduce((a, id) => a + CF.CASES.find(c => c.id === id).price, 0);
  $('#app').innerHTML = `<section class="sec"><div><h1>Батлы кейсов</h1><p class="sub">Вы и бот открываете одни и те же кейсы. У кого сумма дропа больше, тот забирает все предметы обоих игроков. При равенстве решает честный жребий.</p></div>
  <div class="panel" style="display:grid;gap:12px"><div class="ctrl" style="justify-content:space-between"><h2>Набор кейсов · ${btCases.length}/10</h2><span class="price">${fmt(cost)}</span></div>
    <div class="btpick">${CF.CASES.map(c => `<button class="btcase" data-add="${c.id}" style="--h:${c.hue}" title="Добавить ${esc(c.name)}"><span class="box">${caseArt(c)}</span><b>${esc(c.name)}</b><span class="price">${fmt(c.price)}</span></button>`).join('')}</div>
    <div class="btsel">${btCases.length ? btCases.map((id, i) => { const c = CF.CASES.find(x => x.id === id); return `<span class="chip" style="--h:${c.hue}">${esc(c.name)} <button data-rm="${i}" aria-label="Убрать">×</button></span>`; }).join('') : '<span class="sub" style="margin:0">Нажмите на кейс, чтобы добавить его в батл</span>'}</div>
    <div class="ctrl"><button class="btn big" id="btgo" ${btCases.length ? '' : 'disabled'}>Начать батл за ${fmt(cost)}</button><button class="btn ghost fastbtn ${isFast() ? 'on' : ''}" id="btfast" aria-pressed="${isFast()}">⚡ Быстро</button><button class="btn ghost sm" id="btclr" ${btCases.length ? '' : 'disabled'}>Очистить</button></div></div>
  <div id="arena"></div></section>`;
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { if (busy) return; if (btCases.length >= 10) return toast('Максимум 10 кейсов'); btCases.push(b.dataset.add); keep(battles); });
  document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { if (busy) return; btCases.splice(+b.dataset.rm, 1); keep(battles); });
  $('#btclr').onclick = () => { if (!busy) { btCases = []; keep(battles); } };
  $('#btfast').onclick = () => { setFast(!isFast()); $('#btfast').classList.toggle('on', isFast()); };
  $('#btgo').onclick = async () => {
    if (busy || !btCases.length) return;
    if (S.balance < cost) return toast('Недостаточно средств');
    busy = true; $('#btgo').disabled = true;
    let res; try { res = await act('battle', { cases: btCases }); } catch(e) { busy = false; $('#btgo').disabled = false; return toast(esc(e.message)); }
    const fast = isFast() || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ar = $('#arena');
    ar.innerHTML = `<div class="arena"><div class="side" id="sy"><div class="sh"><b>Вы</b><span class="money" id="ty">$0.00</span></div><div class="slots">${res.rounds.map(() => '<div class="slot"></div>').join('')}</div></div>
      <div class="vs">VS</div><div class="side" id="sb"><div class="sh"><b>Бот</b><span class="money" id="tb">$0.00</span></div><div class="slots">${res.rounds.map(() => '<div class="slot"></div>').join('')}</div></div></div><div id="btres"></div>`;
    ar.scrollIntoView({ behavior: fast ? 'auto' : 'smooth', block: 'start' });
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let ty = 0, tb = 0;
    for (let i = 0; i < res.rounds.length; i++) {
      const rd = res.rounds[i], c = CF.CASES.find(x => x.id === rd.c);
      const sy = $('#sy').querySelectorAll('.slot')[i], sb = $('#sb').querySelectorAll('.slot')[i];
      const spinMs = fast ? 250 : 1100; const t0 = performance.now();
      while (performance.now() - t0 < spinMs) { const a = CF.pickByRoll(c.drops, Math.random()).item, b = CF.pickByRoll(c.drops, Math.random()).item; sy.innerHTML = itemCard(a, '', 'spin'); sb.innerHTML = itemCard(b, '', 'spin'); await wait(fast ? 50 : 80); }
      sy.innerHTML = itemCard(IT(rd.you), '', 'pop'); sb.innerHTML = itemCard(IT(rd.bot), '', 'pop');
      ty += IT(rd.you).price; tb += IT(rd.bot).price; $('#ty').textContent = fmt(ty); $('#tb').textContent = fmt(tb);
      $('#ty').className = 'money ' + (ty >= tb ? 'win' : ''); $('#tb').className = 'money ' + (tb > ty ? 'lose' : '');
      await wait(fast ? 120 : 450);
    }
    const won = res.winner === 'you';
    $(won ? '#sy' : '#sb').classList.add('champ');
    if (won) confetti('#ffd166');
    $('#btres').innerHTML = `<div class="result"><div style="display:grid;gap:6px"><div class="${won ? 'win' : 'lose'}" style="font-family:var(--f-display);font-size:22px">${won ? 'Победа! Вы забираете ' + fmt(res.payout) : 'Бот забирает всё'}${res.tie ? ' · ничья, решил жребий' : ''}</div><div class="sub" style="margin:0">${fmt(res.you)} против ${fmt(res.bot)} · ставка ${fmt(res.cost)}${won ? ' · предметы уже в инвентаре' : ''}</div></div><div class="ctrl"><button class="btn sm" id="btagain">Ещё раз</button>${won ? '<a class="btn ghost sm" href="#inventory">Инвентарь</a>' : ''}</div></div>`;
    $('#btagain').onclick = () => { $('#arena').innerHTML = ''; $('#btgo').click(); };
    busy = false; $('#btgo').disabled = false;
  };
}

// ---------- crash ----------
const K_GROWTH = 0.06; // same curve as the server: m = e^(0.06 t)
const mAtMs = ms => Math.floor(Math.exp(K_GROWTH * ms / 1000) * 100) / 100;
let crashTimer = null, crashLocal = null, myCrash = null;
function crashPrefs(){ try { return JSON.parse(localStorage.getItem('caseflip.crash')) || { bet: 1, auto: 2 }; } catch(e) { return { bet: 1, auto: 2 }; } }
function crash(){
  if (crashLocal && !crashLocal.done) crashLocal.done = true;
  const pr = crashPrefs();
  const hist = REMOTE ? (CRASH && CRASH.history) || [] : (S.crashHist || []);
  $('#app').innerHTML = `<section class="sec"><div class="sec-h" style="justify-content:space-between"><div><h1>Краш</h1><p class="sub">Множитель растёт, пока не «крашнется». Заберите ставку до краша${REMOTE ? ' или задайте автовывод' : ': задайте множитель автовывода'}. Шанс дожить до множителя x это 97.5% / x.</p></div>${REMOTE ? `<span class="pill" id="online">${ONLINE} онлайн</span>` : ''}</div>
  <div class="crashwrap">
    <div class="panel crashbox"><div class="chist" id="chist">${hist.slice(0, 12).map(h => `<span class="${h.point >= 2 ? 'hi' : ''}">x${h.point.toFixed(2)}</span>`).join('')}</div><canvas id="ccv"></canvas><div class="cmult" id="cmult">x1.00</div><div class="cstate" id="cstate"></div></div>
    <div class="panel" style="display:grid;gap:12px;align-content:start"><h2>Ставка</h2>
      <label class="balbet">Сумма, $ <input type="number" id="cbet" min="0.1" step="0.1" value="${pr.bet}"></label>
      <div class="mults">${[0.5, 2].map(k => `<button class="btn ghost sm" data-k="${k}">${k === 0.5 ? '½' : '×2'}</button>`).join('')}${[1, 5, 10, 50].map(v => `<button class="btn ghost sm" data-v="${v}">$${v}</button>`).join('')}</div>
      <label class="balbet">Автовывод, x <input type="number" id="cauto" min="1.01" step="0.01" value="${pr.auto || ''}" placeholder="${REMOTE ? 'вручную' : '2.00'}"></label>
      <button class="btn big" id="cgo">${REMOTE ? 'Поставить' : 'Играть'}</button>
      ${REMOTE ? '' : `<button class="btn ghost fastbtn ${isFast() ? 'on' : ''}" id="cfast">⚡ Быстро</button>`}
      <div class="sub" style="margin:0;font-size:12px" id="cinfo">${REMOTE ? 'Один общий раунд для всех игроков. Хэш сида раунда виден заранее.' : 'Демо: раунд только для вас, автовывод задаётся до старта.'}</div>
      ${REMOTE ? '<h2 style="margin-top:6px">Игроки</h2><div class="cplayers" id="cplayers"></div>' : ''}</div>
  </div></section>`;
  const savePr = () => { try { localStorage.setItem('caseflip.crash', JSON.stringify({ bet: +$('#cbet').value, auto: +$('#cauto').value || 0 })); } catch(e){} };
  document.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { $('#cbet').value = Math.max(0.1, +(+$('#cbet').value * +b.dataset.k).toFixed(2)); savePr(); });
  document.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { $('#cbet').value = b.dataset.v; savePr(); });
  $('#cbet').onchange = savePr; $('#cauto').onchange = savePr;
  if ($('#cfast')) $('#cfast').onclick = () => { setFast(!isFast()); $('#cfast').classList.toggle('on', isFast()); };
  $('#cgo').onclick = REMOTE ? crashRemoteClick : crashLocalPlay;
  if (REMOTE) { renderCrashPlayers(); }
  crashLoop();
}
function crashLoop(){
  if (crashTimer) cancelAnimationFrame(crashTimer);
  const frame = () => {
    const cv = $('#ccv'); if (!cv) { crashTimer = null; return; }
    let m = 1, t = 0, phase = 'idle', point = null, left = 0;
    if (REMOTE && CRASH) {
      phase = CRASH.phase; point = CRASH.point;
      if (phase === 'run') { t = performance.now() - CRASH._t0; m = mAtMs(t); }
      if (phase === 'bet') left = Math.max(0, CRASH._t0 - performance.now());
      if (phase === 'end') { m = point; t = Math.log(point) / K_GROWTH * 1000; }
    } else if (crashLocal) {
      const sp = crashLocal.fast ? 5 : 1;
      t = (performance.now() - crashLocal.t0) * sp; m = Math.min(mAtMs(t), crashLocal.point); phase = 'run';
      if (m >= crashLocal.point) { phase = 'end'; point = crashLocal.point; t = Math.log(point) / K_GROWTH * 1000; if (!crashLocal.done) { crashLocal.done = true; crashLocalEnd(); } }
      if (crashLocal.won && m >= crashLocal.auto && !crashLocal.cashShown) { crashLocal.cashShown = true; $('#cstate').innerHTML = `<span class="win">Выведено x${crashLocal.auto.toFixed(2)} · +${fmt(crashLocal.payout)}</span>`; confetti(); }
    }
    drawCrash(cv, m, t, phase === 'end');
    const cm = $('#cmult');
    cm.textContent = phase === 'bet' ? (left / 1000).toFixed(1) + 'с' : 'x' + m.toFixed(2);
    cm.className = 'cmult ' + (phase === 'end' ? 'lose' : phase === 'run' ? 'run' : '');
    if (REMOTE) crashRemoteUi(phase, m);
    crashTimer = requestAnimationFrame(frame);
  };
  crashTimer = requestAnimationFrame(frame);
}
function drawCrash(cv, m, t, crashed){
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  const maxT = Math.max(10000, t * 1.15), maxM = Math.max(2, m * 1.15), pad = 28;
  const X = tt => pad + tt / maxT * (W - pad - 10), Y = mm => H - pad - (mm - 1) / (maxM - 1) * (H - pad - 16);
  x.strokeStyle = '#2a3159'; x.fillStyle = '#8d95c4'; x.font = '11px JetBrains Mono, monospace'; x.lineWidth = 1;
  const step = maxM <= 3 ? 0.5 : maxM <= 6 ? 1 : maxM <= 20 ? 5 : Math.pow(10, Math.floor(Math.log10(maxM)));
  for (let v = 1; v <= maxM; v += step) { x.beginPath(); x.moveTo(pad, Y(v)); x.lineTo(W, Y(v)); x.stroke(); x.fillText(v.toFixed(v < 10 && step < 1 ? 1 : 0) + 'x', 2, Y(v) - 3); }
  if (t <= 0) return;
  const col = crashed ? '#ff5d6c' : '#ff8a3d';
  x.beginPath(); x.moveTo(X(0), Y(1));
  for (let i = 1; i <= 80; i++) { const tt = t * i / 80; x.lineTo(X(tt), Y(Math.min(m, Math.exp(K_GROWTH * tt / 1000)))); }
  x.lineWidth = 3.5; x.strokeStyle = col; x.shadowColor = col; x.shadowBlur = 14; x.stroke(); x.shadowBlur = 0;
  x.lineTo(X(t), Y(1)); x.closePath(); const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, col + '55'); g.addColorStop(1, col + '00'); x.fillStyle = g; x.fill();
}
const crashLocalPlay = async () => {
  if (crashLocal && !crashLocal.done) return;
  const bet = +$('#cbet').value, auto = +$('#cauto').value || 2;
  $('#cgo').disabled = true; $('#cstate').innerHTML = '';
  let res; try { res = await act('crashSolo', { bet, auto }); } catch(e) { $('#cgo').disabled = false; return toast(esc(e.message)); }
  S.crashHist = [{ point: res.point }, ...(S.crashHist || [])].slice(0, 12); save();
  crashLocal = { ...res, t0: performance.now(), fast: isFast() };
};
function crashLocalEnd(){
  const r = crashLocal;
  if (!r.won) $('#cstate').innerHTML = `<span class="lose">Краш на x${r.point.toFixed(2)} · ставка сгорела</span>`;
  $('#chist').innerHTML = (S.crashHist || []).map(h => `<span class="${h.point >= 2 ? 'hi' : ''}">x${h.point.toFixed(2)}</span>`).join('');
  setTimeout(() => { const b = $('#cgo'); if (b) b.disabled = false; }, 600);
}
async function crashRemoteClick(){
  if (!CRASH) return;
  if (CRASH.phase === 'run' && myCrash && myCrash.id === CRASH.id && !myCrash.cashed) {
    try { const d = await api('/api/crash/cashout', {}); myCrash.cashed = d.m; $('#cstate').innerHTML = `<span class="win">Выведено x${d.m.toFixed(2)} · +${fmt(d.payout)}</span>`; confetti(); setTimeout(reloadMe, 400); } catch(e) { toast(esc(e.message)); }
    return;
  }
  if (CRASH.phase !== 'bet') return toast('Ставки примем в следующем раунде');
  try { const d = await api('/api/crash/bet', { bet: +$('#cbet').value, auto: +$('#cauto').value || 0 }); S = d.state; save(); myCrash = { id: CRASH.id, bet: +$('#cbet').value, cashed: null }; $('#cstate').innerHTML = ''; } catch(e) { toast(esc(e.message)); }
}
function crashRemoteUi(phase, m){
  const b = $('#cgo'); if (!b) return;
  const mine = myCrash && CRASH && myCrash.id === CRASH.id;
  let txt, dis = false;
  if (phase === 'bet') { txt = mine ? 'Ставка принята' : 'Поставить'; dis = !!mine; }
  else if (phase === 'run') { if (mine && !myCrash.cashed) txt = 'Забрать ' + fmt(myCrash.bet * m); else { txt = 'Раунд идёт'; dis = true; } }
  else { txt = 'Ждём новый раунд'; dis = true; }
  if (b.textContent !== txt) b.textContent = txt;
  b.disabled = dis; b.classList.toggle('cash', phase === 'run' && mine && !myCrash.cashed);
}
function renderCrashPlayers(){
  const el = $('#cplayers'); if (!el || !CRASH) return;
  el.innerHTML = CRASH.bets && CRASH.bets.length ? CRASH.bets.map(b => `<div class="cpl"><span>${esc(b.name)}</span><span class="money">${fmt(b.bet)}</span><span class="money ${b.cashed ? 'win' : ''}">${b.cashed ? 'x' + b.cashed.toFixed(2) : CRASH.phase === 'end' ? '<span class="lose">—</span>' : '…'}</span></div>`).join('') : '<div class="sub" style="margin:0">Пока никто не поставил</div>';
  const h = $('#chist'); if (h) h.innerHTML = (CRASH.history || []).slice(0, 12).map(x => `<span class="${x.point >= 2 ? 'hi' : ''}">x${x.point.toFixed(2)}</span>`).join('');
}
function onCrash(d){
  CRASH = { ...d, _t0: d.phase === 'run' ? performance.now() - d.elapsed : performance.now() + (d.left || 0) };
  if (d.phase === 'end') {
    const mine = myCrash && myCrash.id === d.id;
    if (mine && !myCrash.cashed && $('#cstate')) $('#cstate').innerHTML = `<span class="lose">Краш на x${d.point.toFixed(2)} · ставка сгорела</span>`;
    if (mine) setTimeout(reloadMe, 600);
  }
  if (d.phase === 'bet' && $('#cstate')) $('#cstate').innerHTML = `<span class="sub" style="margin:0">Раунд #${d.id} · хэш ${d.hash.slice(0, 12)}…</span>`;
  renderCrashPlayers();
}

// ---------- live connection: feed, chat, crash ----------
function connectLive(){
  const es = new EventSource('/api/stream');
  es.addEventListener('hello', e => { const d = JSON.parse(e.data); FEED = { recent: d.recent, top: d.top }; CHAT = d.chat; ONLINE = d.online; onCrash(d.crash); renderDrops(); renderChat(); });
  es.addEventListener('drop', e => { const d = JSON.parse(e.data); if (!FEED) return; FEED.recent = [d, ...FEED.recent].slice(0, 30); FEED.top = [...FEED.top, d].sort((a, b) => b.price - a.price).slice(0, 20); renderDrops(); });
  es.addEventListener('chat', e => { CHAT = [...CHAT, JSON.parse(e.data)].slice(-80); renderChat(true); });
  es.addEventListener('chat_hide', e => { const id = JSON.parse(e.data).id; CHAT = CHAT.filter(m => m.id !== id); renderChat(); });
  es.addEventListener('online', e => { ONLINE = JSON.parse(e.data).n; const o = $('#online'); if (o) o.textContent = ONLINE + ' онлайн'; renderChat(); });
  es.addEventListener('crash', e => onCrash(JSON.parse(e.data)));
  es.addEventListener('crash_bet', e => { const d = JSON.parse(e.data); if (CRASH) { CRASH.bets = [...(CRASH.bets || []), { name: d.name, bet: d.bet }]; renderCrashPlayers(); } });
  es.addEventListener('crash_cash', e => {
    const d = JSON.parse(e.data); if (!CRASH) return;
    const b = (CRASH.bets || []).find(x => x.name === d.name && !x.cashed); if (b) b.cashed = d.m; renderCrashPlayers();
    if (ME && d.name === ME.user.name && myCrash && myCrash.id === CRASH.id && !myCrash.cashed) { myCrash.cashed = d.m; if ($('#cstate')) $('#cstate').innerHTML = `<span class="win">Автовывод x${d.m.toFixed(2)} · +${fmt(d.payout)}</span>`; confetti(); setTimeout(reloadMe, 400); }
  });
}

// ---------- chat drawer ----------
let chatOpen = false;
function renderChat(newMsg){
  let el = $('#chat');
  if (!el) { el = document.createElement('div'); el.id = 'chat'; document.body.appendChild(el); }
  if (!chatOpen) { el.className = 'chat closed'; el.innerHTML = `<button class="chatbtn" id="chatbtn" aria-label="Открыть чат">💬 Чат${REMOTE ? ` · ${ONLINE}` : ''}${newMsg ? '<i></i>' : ''}</button>`; $('#chatbtn').onclick = () => { chatOpen = true; renderChat(); }; return; }
  const lv = GAMES.levelOf(S.stats.wager).lv, need = REMOTE ? ME.limits.chatLevel : 0;
  el.className = 'chat open';
  el.innerHTML = `<div class="chathead"><b>Чат</b><span class="sub" style="margin:0">${REMOTE ? ONLINE + ' онлайн' : 'демо'}</span><button class="btn ghost sm" id="chatx" aria-label="Закрыть чат">✕</button></div>
  <div class="chatlist" id="chatlist">${REMOTE ? (CHAT.length ? CHAT.map(m => `<div class="msg"><span class="lv">${m.lv}</span><b>${esc(m.name)}</b> <span>${esc(m.text)}</span></div>`).join('') : '<div class="empty">Сообщений пока нет. Напишите первым!</div>') : '<div class="empty">Чат работает, когда сайт запущен на сервере: там все игроки видят сообщения друг друга.</div>'}</div>
  ${REMOTE ? (lv >= need ? `<form class="chatform" id="chatform"><input type="text" id="chatin" maxlength="200" placeholder="Сообщение…" autocomplete="off"><button class="btn sm">→</button></form>` : `<div class="sub" style="margin:0;padding:10px">Писать в чат можно с ${need} уровня. Сейчас у вас ${lv}.</div>`) : ''}`;
  $('#chatx').onclick = () => { chatOpen = false; renderChat(); };
  const list = $('#chatlist'); list.scrollTop = list.scrollHeight;
  const f = $('#chatform'); if (f) { f.onsubmit = async e => { e.preventDefault(); const v = $('#chatin').value.trim(); if (!v) return; try { await api('/api/chat', { text: v }); $('#chatin').value = ''; } catch(err) { toast(esc(err.message)); } }; }
}

// ---------- profile: level, free cases, quests, referrals, promo ----------
const LOCAL_PROMOS = { CASEFLIP: 10 };
function profile(){
  const L = GAMES.levelOf(S.stats.wager), q = GAMES.questsFor(S, Date.now());
  const u = REMOTE ? ME.user : null;
  const refLink = u ? location.origin + '/r/' + u.ref : '';
  $('#app').innerHTML = `<section class="sec"><div><h1>Профиль</h1><p class="sub">${u ? esc(u.name) + (u.steamid ? ' · Steam подключён' : ' · гостевой аккаунт') : 'Демо-аккаунт в этом браузере'}</p></div>
  <div class="prof">
    <div class="panel lvcard"><div class="biglv">${L.lv}</div><div style="display:grid;gap:6px;flex:1"><b>Уровень ${L.lv}</b><span class="lvbar wide"><i style="width:${(L.xp / L.need * 100).toFixed(1)}%"></i></span><span class="sub" style="margin:0;font-size:12px">${fmt(L.xp)} из ${fmt(L.need)} до следующего уровня. Уровень растёт от суммы ставок, за каждый новый уровень даём бесплатный кейс Starter.</span></div></div>
    <div class="panel" style="display:grid;gap:10px;align-content:start"><h2>Бесплатные кейсы · ${S.freeCases || 0}</h2><div class="ctrl"><button class="btn" id="free" ${S.freeCases ? '' : 'disabled'}>Открыть Starter бесплатно</button></div><div id="freeres"></div></div>
  </div>
  <div class="panel" style="display:grid;gap:10px"><div class="ctrl" style="justify-content:space-between"><h2>Задания дня</h2><span class="sub" style="margin:0;font-size:12px">обновляются в 00:00 МСК</span></div>
    <div class="quests">${GAMES.QUESTS.map(d => { const p = Math.min(d.goal, q.p[d.type] || 0), done = p >= d.goal, got = q.c[d.id]; return `<div class="quest ${got ? 'got' : done ? 'done' : ''}"><div><b>${d.ru}</b><span class="lvbar wide"><i style="width:${(p / d.goal * 100).toFixed(0)}%"></i></span><span class="sub" style="margin:0;font-size:12px">${d.type === 'wager' ? fmt(p) + ' / ' + fmt(d.goal) : p + ' / ' + d.goal}</span></div><button class="btn sm" data-q="${d.id}" ${done && !got ? '' : 'disabled'}>${got ? 'Получено' : '+' + fmt(d.reward)}</button></div>`; }).join('')}</div></div>
  <div class="prof">
    <div class="panel" style="display:grid;gap:10px;align-content:start"><h2>Промокод</h2><form class="ctrl" id="promof"><input type="text" id="promo" placeholder="Например, CASEFLIP" maxlength="32" style="flex:1;min-width:140px"><button class="btn sm">Активировать</button></form><span class="sub" style="margin:0;font-size:12px">Каждый промокод можно активировать один раз.</span></div>
    <div class="panel" style="display:grid;gap:10px;align-content:start"><h2>Рефералы</h2>${u ? `<div class="ctrl"><input type="text" readonly value="${esc(refLink)}" id="reflink" style="flex:1;min-width:180px"><button class="btn sm" id="refcopy">Копировать</button></div><div class="stats"><div class="stat">Приглашено<b>${u.refs}</b></div><div class="stat">Активных<b>${u.refPaid}</b></div><div class="stat">Заработано<b>${fmt(u.refEarned || 0)}</b></div></div><span class="sub" style="margin:0;font-size:12px">Друг получает бесплатный кейс, а вы ${fmt(ME.limits.refReward)}, когда он поставит ${fmt(ME.limits.refWager)}.</span>` : '<span class="sub" style="margin:0">Реферальные ссылки работают, когда сайт запущен на сервере.</span>'}</div>
  </div>
  ${u ? `<div class="panel" style="display:grid;gap:10px"><h2>Заявки на вывод</h2>${ME.withdrawals.length ? `<div class="tbl"><table><thead><tr><th>#</th><th>Сумма</th><th>Статус</th><th>Дата</th><th></th></tr></thead><tbody>${ME.withdrawals.map(w => `<tr><td class="m">${w.id}</td><td class="m">${fmt(w.value)}</td><td>${WST[w.status] || esc(w.status)}${(w.items || []).length ? '<div class="witems">' + w.items.map(i => `<span class="${i.status === 'delivered' ? 'win' : i.status === 'refunded' ? 'lose' : ''}">${esc(i.name)}: ${PST[i.status] || esc(i.status)}${i.reason && i.status === 'refunded' ? ' (' + esc(i.reason) + ')' : ''}</span>`).join('') + '</div>' : ''}</td><td class="m">${new Date(w.t).toLocaleString('ru-RU')}</td><td>${w.status === 'pending' ? `<button class="btn ghost sm" data-wc="${w.id}">Отменить</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="sub" style="margin:0">Заявок пока нет. Вывести скин можно из инвентаря.</div>'}</div>` : ''}
  </section>`;
  $('#free').onclick = safe(async () => { if (busy) return; busy = true; const r = await act('openCase', { caseId: 'starter', free: true }); busy = false; const it = IT(r.drop); profile(); $('#freeres').innerHTML = `<div class="result">${itemCard(it, '', 'pop')}<div class="win" style="font-family:var(--f-display)">+ ${esc(it.weapon)} | ${esc(it.skin)}</div></div>`; });
  document.querySelectorAll('[data-q]').forEach(b => b.onclick = safe(async () => { const r = await act('questClaim', { id: b.dataset.q }); confetti('#3ddc97'); toast('+' + fmt(r.reward) + ' за задание'); keep(profile); }));
  $('#promof').onsubmit = safe(async e => {
    e.preventDefault(); const code = $('#promo').value.trim().toUpperCase(); if (!code) return;
    if (REMOTE) { const d = await api('/api/promo', { code }); S = d.state; save(); toast('+' + fmt(d.res.amount) + ' по промокоду'); }
    else { if (!LOCAL_PROMOS[code]) return toast('Промокод не найден или закончился'); S.promos = S.promos || []; if (S.promos.includes(code)) return toast('Вы уже активировали этот промокод'); S.promos.push(code); GAMES.bonusCredit(S, LOCAL_PROMOS[code]); save(); toast('+' + fmt(LOCAL_PROMOS[code]) + ' по промокоду'); }
    confetti('#ffd166'); $('#promo').value = '';
  });
  if ($('#refcopy')) $('#refcopy').onclick = () => { navigator.clipboard?.writeText(refLink).then(() => toast('Ссылка скопирована'), () => { $('#reflink').select(); }); };
  document.querySelectorAll('[data-wc]').forEach(b => b.onclick = safe(async () => { const d = await api('/api/withdraw/cancel', { id: +b.dataset.wc }); S = d.state; await reloadMe(); toast('Заявка отменена, предметы вернулись в инвентарь'); profile(); }));
}

// ---------- withdraw ----------
const WST = { pending: 'ждёт проверки', processing: 'покупаем и отправляем', sent: 'отправлено', partial: 'отправлено частично', refunded: 'возвращено в инвентарь', cancelled: 'отменено' };
const PST = { hold: 'ждёт проверки', queued: 'в очереди', buying: 'покупаем', sent: 'продавец отправляет трейд', delivered: 'получено', refunded: 'вернули в инвентарь', waiting_funds: 'в очереди', cancelled: 'отменено' };
function withdrawModal(uids){
  const val = uids.reduce((a, u) => a + IT(S.inv.find(x => x.uid === u).id).price, 0);
  if (!REMOTE) return modal(`<h2>Вывод в Steam</h2><p class="sub">В демо-версии вывод отключён. На сервере игрок оставляет заявку, а скин отправляет trade-бот после проверки лимитов. Бот подключается отдельно.</p><div class="ctrl"><button class="btn" data-close>Понятно</button></div>`);
  const u = ME.user;
  if (!u.steamid) return modal(`<h2>Вывод в Steam</h2><p class="sub">Чтобы выводить скины, войдите через Steam.</p><div class="ctrl"><a class="btn steam" href="/auth/steam">${STEAM_ICON}Войти через Steam</a><button class="btn ghost" data-close>Отмена</button></div>`);
  modal(`<h2>Вывод ${fmt(val)}</h2><p class="sub">Предметов: ${uids.length}. Лимит ${fmt(ME.limits.withdrawDailyUsd)} в сутки. Перед выводом нужно поставить бонусные деньги ×${ME.limits.wagerX}: сейчас ${fmt(S.stats.wager)} из ${fmt(S.stats.bonus * ME.limits.wagerX)}.</p>
  <p class="sub" style="margin:0">Скин покупается на маркетплейсе, и продавец сам отправит вам трейд в Steam, обычно в течение 15 минут. Примите его. Если продавец не отправит, предмет вернётся в инвентарь.</p>
  <input type="text" id="trade" placeholder="Trade-ссылка Steam" value="${esc(u.tradeUrl || '')}"><a class="sub" style="margin:0;font-size:12px;color:var(--accent)" href="https://steamcommunity.com/my/tradeoffers/privacy#trade_offer_access_url" target="_blank" rel="noopener">Где взять trade-ссылку</a><div class="ctrl"><button class="btn" id="wdgo">Создать заявку</button><button class="btn ghost" data-close>Отмена</button></div>`);
  $('#wdgo').onclick = safe(async () => { const d = await api('/api/withdraw', { uids, tradeUrl: $('#trade').value.trim() }); S = d.state; await reloadMe(); document.querySelector('.modal')?.remove(); invSel.clear(); toast(d.res.auto ? `Заявка #${d.res.id}: покупаем скин, ждите трейд в Steam` : `Заявка #${d.res.id} на ${fmt(d.res.value)} создана и ждёт проверки`); inventory(); });
}

// ---------- 18+ gate ----------
function ageGate(){
  try { if (localStorage.getItem('caseflip.age') === '1') return; } catch(e){ return; }
  const m = document.createElement('div'); m.className = 'modal agegate';
  m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="agetitle"><div class="age18">18+</div><h2 id="agetitle">Вам уже есть 18 лет?</h2><p class="sub" style="margin:0">CaseFlip содержит игровые механики со случайным результатом. Сайт только для совершеннолетних. Продолжая, вы принимаете <a href="#terms">правила</a> и <a href="#privacy">политику конфиденциальности</a>.</p><div class="ctrl"><button class="btn" id="age-yes">Да, мне есть 18</button><button class="btn ghost" id="age-no">Нет</button></div><button class="langsw" id="age-lang">EN</button></div>`;
  document.body.appendChild(m);
  m.querySelector('#age-yes').onclick = () => { try { localStorage.setItem('caseflip.age', '1'); } catch(e){} m.remove(); };
  m.querySelector('#age-no').onclick = () => { m.querySelector('.modal-box').innerHTML = '<h2>Доступ закрыт</h2><p class="sub" style="margin:0">Сайт предназначен только для совершеннолетних.</p>'; };
  m.querySelector('#age-lang').onclick = () => setLang(LANG === 'en' ? 'ru' : 'en');
  m.querySelectorAll('a').forEach(a => a.onclick = () => { m.style.display = 'none'; setTimeout(() => { const back = document.createElement('button'); back.className = 'btn agebk'; back.textContent = 'Вернуться к подтверждению возраста'; back.onclick = () => { back.remove(); m.style.display = ''; }; document.body.appendChild(back); }, 0); });
}

// ---------- legal templates ----------
const SITE = () => location.host || 'caseflip';
const LEGAL = {
  ru: {
    terms: ['Пользовательское соглашение', `<p>Шаблон. Перед запуском с реальными деньгами его должен проверить юрист в вашей юрисдикции.</p>
<h3>1. Общие положения</h3><p>Сайт ${SITE()} (далее «Сервис») предоставляет развлекательные механики: открытие кейсов, апгрейды, контракты, батлы и краш. Используя Сервис, вы подтверждаете, что вам исполнилось 18 лет и что участие в таких играх разрешено законом вашей страны.</p>
<h3>2. Аккаунт</h3><p>Один человек может иметь только один аккаунт. Мультиаккаунты, автоматизация, использование ошибок и бонусный абьюз ведут к блокировке и аннулированию бонусов. Вход выполняется через Steam OpenID: мы не получаем ваш пароль.</p>
<h3>3. Баланс и предметы</h3><p>В демо-режиме баланс виртуальный и не имеет денежной стоимости. Цены предметов берутся с открытых торговых площадок и обновляются ежедневно в 12:00 МСК. Средний теоретический возврат (RTP) всех режимов равен 97.5%.</p>
<h3>4. Бонусы и вывод</h3><p>Бонусы (ежедневный бонус, задания, промокоды, реферальные награды) нужно отыграть с вейджером, указанным на сайте, прежде чем выводить предметы. Вывод ограничен суточным лимитом, заявки проверяются вручную и могут быть отклонены при подозрении на мошенничество.</p>
<h3>5. Честная игра</h3><p>Каждый результат вычисляется по схеме provably fair и может быть проверен во вкладке «Честная игра».</p>
<h3>6. Ответственность</h3><p>Сервис предоставляется «как есть». Мы не несём ответственности за решения пользователя и за перебои в работе Steam. Сервис не связан с Valve Corporation.</p>
<h3>7. Изменения</h3><p>Мы можем менять соглашение, публикуя новую редакцию на этой странице.</p>`],
    privacy: ['Политика конфиденциальности', `<p>Шаблон. Перед запуском проверьте его на соответствие 152-ФЗ, GDPR или законам вашей страны.</p>
<h3>Какие данные мы храним</h3><p>Steam ID, публичное имя и аватар из Steam (если вы вошли через Steam), историю игр и баланса, trade-ссылку для вывода, IP-адрес (для защиты от мультиаккаунтов и злоупотреблений бонусами), сообщения в чате.</p>
<h3>Зачем</h3><p>Чтобы вести ваш аккаунт, проверять честность игр, бороться с мошенничеством и выполнять требования закона.</p>
<h3>Cookies</h3><p>Мы используем одну техническую cookie сессии и, при переходе по реферальной ссылке, cookie с кодом пригласившего. Рекламных трекеров нет.</p>
<h3>Передача третьим лицам</h3><p>Данные не продаются. Steam получает запрос на вход, когда вы сами нажимаете «Войти через Steam».</p>
<h3>Хранение и удаление</h3><p>История игр хранится, пока существует аккаунт. Чтобы удалить аккаунт, напишите в поддержку.</p>
<h3>Контакты</h3><p>Укажите здесь e-mail поддержки и реквизиты оператора данных.</p>`],
    responsible: ['Ответственная игра', `<p>Играйте ради развлечения и только на те средства, которые готовы потерять. В среднем все режимы возвращают 97.5% ставок, то есть на длинной дистанции игрок теряет.</p><h3>Признаки проблемы</h3><p>Вы отыгрываетесь после проигрыша, играете дольше, чем планировали, скрываете игру от близких, занимаете деньги на игру.</p><h3>Что делать</h3><p>Сделайте перерыв, установите себе лимит, обратитесь за поддержкой. Чтобы заблокировать аккаунт на срок, напишите в поддержку.</p>`],
  },
  en: {
    terms: ['Terms of Use', `<p>Template. Have a lawyer in your jurisdiction review it before running with real money.</p>
<h3>1. General</h3><p>${SITE()} (the "Service") provides entertainment mechanics: case opening, upgrades, contracts, battles and crash. By using the Service you confirm that you are 18 or older and that such games are legal where you live.</p>
<h3>2. Account</h3><p>One account per person. Multi-accounting, automation, exploiting bugs and bonus abuse lead to a ban and forfeited bonuses. Login uses Steam OpenID: we never see your password.</p>
<h3>3. Balance and items</h3><p>In demo mode the balance is virtual and has no monetary value. Item prices come from public marketplaces and refresh daily at 12:00 Moscow time. The theoretical return to player (RTP) of every mode is 97.5%.</p>
<h3>4. Bonuses and withdrawals</h3><p>Bonuses (daily bonus, quests, promo codes, referral rewards) must be wagered as stated on the site before withdrawing items. Withdrawals have a daily limit, are reviewed manually and may be refused on suspicion of fraud.</p>
<h3>5. Fair play</h3><p>Every result is provably fair and can be checked on the Fairness page.</p>
<h3>6. Liability</h3><p>The Service is provided "as is". We are not responsible for user decisions or Steam outages. The Service is not affiliated with Valve Corporation.</p>
<h3>7. Changes</h3><p>We may change these terms by publishing a new version on this page.</p>`],
    privacy: ['Privacy Policy', `<p>Template. Check it against GDPR or the laws of your country before launch.</p>
<h3>What we store</h3><p>Steam ID, public Steam name and avatar (if you log in with Steam), game and balance history, your trade link for withdrawals, IP address (to prevent multi-accounting and bonus abuse), chat messages.</p>
<h3>Why</h3><p>To run your account, prove fairness, fight fraud and meet legal requirements.</p>
<h3>Cookies</h3><p>One technical session cookie and, after a referral link, a cookie with the referrer code. No ad trackers.</p>
<h3>Sharing</h3><p>We do not sell data. Steam receives a login request only when you press "Log in with Steam".</p>
<h3>Retention</h3><p>Game history is kept while the account exists. To delete your account, contact support.</p>
<h3>Contacts</h3><p>Put your support e-mail and data controller details here.</p>`],
    responsible: ['Responsible gaming', `<p>Play for fun and only with what you can afford to lose. On average every mode returns 97.5% of wagers, so players lose over time.</p><h3>Warning signs</h3><p>Chasing losses, playing longer than planned, hiding play from family, borrowing money to play.</p><h3>What to do</h3><p>Take a break, set yourself a limit, ask for support. To lock your account for a period, contact support.</p>`],
  },
};
function legal(kind){
  const [title, body] = LEGAL[LANG === 'en' ? 'en' : 'ru'][kind];
  $('#app').innerHTML = `<section class="sec legal" data-noi18n><h1>${title}</h1>${body}<p class="sub">${LANG === 'en' ? 'Last updated' : 'Редакция от'} ${new Date().toISOString().slice(0, 10)}</p></section>`;
}

// ---------- RU / EN ----------
let LANG = 'ru'; try { LANG = localStorage.getItem('caseflip.lang') || 'ru'; } catch(e){}
function setLang(l){ try { localStorage.setItem('caseflip.lang', l); } catch(e){} location.reload(); }
function trStr(s){
  if (s.includes('Гость #')) s = s.replace(/Гость #/g, 'Guest #');
  const k = s.trim(); if (!k || !/[А-Яа-яЁё]/.test(k)) return s.includes('Guest #') ? s : null;
  let v = I18N[k];
  if (v == null) for (const [re, rp] of I18N_RE) { if (re.test(k)) { v = k.replace(re, rp); break; } }
  return v == null ? null : s.replace(k, v);
}
function trTree(root){
  if (root.nodeType === 3) { const v = trStr(root.nodeValue); if (v != null) root.nodeValue = v; return; }
  if (root.nodeType !== 1 || root.closest('[data-noi18n],script,style')) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) { if (n.parentElement && n.parentElement.closest('[data-noi18n],script,style')) continue; const v = trStr(n.nodeValue); if (v != null) n.nodeValue = v; }
  for (const el of [root, ...root.querySelectorAll('[placeholder],[title],[aria-label]')]) for (const a of ['placeholder', 'title', 'aria-label']) { const val = el.getAttribute && el.getAttribute(a); if (val) { const v = trStr(val); if (v != null) el.setAttribute(a, v); } }
}
function initLang(){
  document.documentElement.lang = LANG;
  const sw = document.createElement('button'); sw.className = 'langsw hdr'; sw.textContent = LANG === 'en' ? 'RU' : 'EN'; sw.title = LANG === 'en' ? 'Русский' : 'English'; sw.onclick = () => setLang(LANG === 'en' ? 'ru' : 'en');
  $('.bal').prepend(sw);
  if (LANG !== 'en') return;
  trTree(document.body);
  new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') trTree(m.target); else m.addedNodes.forEach(trTree); } }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
