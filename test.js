const CF = require('./src/engine.js');
let ok = true;
for (const c of CF.CASES) {
  const sum = c.drops.reduce((a,d)=>a+d.p,0);
  // Monte Carlo
  let ret = 0, N = 2e6;
  for (let i=0;i<N;i++) ret += CF.pickByRoll(c.drops, Math.random()).item.price;
  const mc = ret/(N*c.price);
  console.log(c.name.padEnd(10), 'price', c.price, 'RTP exact', (c.rtp*100).toFixed(4)+'%', 'MC', (mc*100).toFixed(2)+'%', 'sum p', sum.toFixed(8), 'top', c.drops.map(d=>d.item.weapon+' '+(d.p*100).toFixed(3)+'%').slice(0,3).join(', '));
  if (Math.abs(c.rtp-0.975)>1e-9) ok=false;
}
// upgrade with bonuses
console.log('K', CF.UPGRADE_K);
for (const [i,t] of [[1,2],[1,10],[3,4]]) { let r=0,N=4e6; const ch=CF.upgradeChance(i,t); for(let k=0;k<N;k++){ const o=CF.resolveUpgrade(ch,Math.random(),Math.random(),Math.random()); if(o.won) r+=t*o.mult; } console.log('bonus upgrade',i,'->',t,'chance',(ch*100).toFixed(2)+'%','MC RTP',(r/(N*i)*100).toFixed(2)+'%'); }
// exact: integrate over u
{ const ch=0.4; let ev=0; const G=200000; for(let a=0;a<400;a++){ const r0=(a+0.5)/400*1; const pl=CF.plateFromRoll(r0); let e=0; for(let g=0;g<G/100;g++){ const u=(g+0.5)/(G/100); let m=1; if(pl&&u>=pl.from&&u<pl.to) m=pl.mult; else if(u>=CF.BONUS.flipFrom&&u<CF.BONUS.flipTo) m=1.5; e+=m; } ev+=e/(G/100); } console.log('exact K check', ev/400, 'vs', CF.UPGRADE_K); }
if(false)for (const [i,t] of [[1,2],[1,10],[5,100]]) { let r=0,N=2e6; const ch=CF.upgradeChance(i,t); for(let k=0;k<N;k++) if(Math.random()<ch) r+=t; console.log('upgrade',i,'->',t,'chance',(ch*100).toFixed(2)+'%','MC RTP',(r/(N*i)*100).toFixed(2)+'%'); }
for (const tot of [1, 5, 30, 200, 1500]) { const o = CF.contractOutcomes(tot); if(!o){console.log('contract',tot,'no pool');continue;} const ev=o.reduce((a,d)=>a+d.p*d.item.price,0); console.log('contract',tot,'RTP',(ev/tot*100).toFixed(4)+'%', o.length,'outcomes'); if(Math.abs(ev/tot-0.975)>1e-9) ok=false; }
CF.fairRoll('abc','client',1).then(r=>{console.log('fair',r); console.log(ok?'ALL OK':'FAIL');});
// shared games: battle and crash RTP via Monte Carlo through the real action code
(async () => {
  const G = require('./src/games.js'); const IT = G.makeIT(new Map());
  const ctxFor = S => ({ S, IT, CAT: [], CATMAP: new Map(), now: Date.now(), roll: async () => Math.random() });
  let S = G.newState({ balance: 1e9 }); S.seed = { hash: '', client: '', nonce: 0 };
  let w = 0, r = 0; for (let i = 0; i < 100000; i++) { const o = await G.run('battle', ctxFor(S), { cases: ['starter', 'rifle'] }); w += o.cost; r += o.payout; S.inv = []; }
  console.log('battle MC RTP', (r / w * 100).toFixed(2) + '%');
  for (const a of [1.01, 1.5, 2, 10, 100]) { let ret = 0, N = 2e6; for (let i = 0; i < N; i++) if (G.crashPoint(Math.random()) >= a) ret += a; console.log('crash auto x' + a, 'MC RTP', (ret / N * 100).toFixed(2) + '%'); }
  // exact crash: P(point >= a) = 0.975/a
  for (const a of [1.01, 2, 37.5]) { const rr = 1 - 0.975 / a; console.log('crash exact boundary', a, G.crashPoint(rr - 1e-12) < a, G.crashPoint(rr + 1e-9) >= a); }
  let S2 = G.newState({ balance: 0 }); const c = ctxFor(S2); for (let i = 0; i < 3; i++) S2.stats.wager += 0; S2.stats.wager = 9.99; await G.run('sell', c, { uids: [] }).catch(e => console.log('sell empty ->', e.message));
})();
// cases after live market prices are applied (odds re-solved)
{ const G = require('./src/games.js'); const { CATMAP } = G.buildCatalog(require('./dist/catalog.json')); CF.applyPrices(n => CATMAP.get('m:' + n));
  for (const c of CF.CASES) { const ev = c.drops.reduce((a, d) => a + d.p * d.item.price, 0); console.log('live', c.id, c.price, 'RTP', (ev / c.price * 100).toFixed(4) + '%'); if (Math.abs(ev / c.price - 0.975) > 1e-9) { console.log('FAIL live case'); process.exitCode = 1; } } }
