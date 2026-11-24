// CaseFlip original procedural art: weapon silhouettes + per-skin finishes, and case boxes.
(function(root){
  let uid = 0;
  function rng(seed){ let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // side-view silhouettes, viewBox 0 0 200 80
  const SHAPE = {
    ak: 'M4 31 L42 26 L48 24 L122 24 L126 21 L148 21 L150 25 L196 25 L196 29.5 L150 30.5 L147 34 L121 34 L114 36 Q123 50 121 66 L107 67 Q108 51 99 37 L80 37 L75 51 L63 52 L67 37 L48 38 L10 49 L3 46 Z',
    m4: 'M3 29 L30 27 L36 22 L60 22 L64 17 L112 17 L116 22 L148 22 L151 25 L197 25 L197 29 L150 30 L146 34 L104 34 L108 60 L95 61 L92 34 L80 34 L76 49 L65 50 L68 34 L40 34 L35 45 L4 43 Z',
    m4s:'M3 29 L30 27 L36 22 L60 22 L64 17 L112 17 L116 22 L148 22 L150 24 L198 24 L198 31 L150 31 L146 34 L104 34 L108 60 L95 61 L92 34 L80 34 L76 49 L65 50 L68 34 L40 34 L35 45 L4 43 Z',
    famas:'M6 34 Q6 26 18 25 L60 24 L66 16 L120 15 L126 22 L172 23 L172 27 L196 27 L196 31 L170 32 L150 36 L120 36 L118 52 L106 52 L104 38 L84 38 L80 50 L68 50 L70 38 L30 40 L10 44 Z',
    awp: 'M2 31 L40 24 L78 26 L82 20 L90 15 L134 15 L138 19 L133 24 L199 26 L199 30 L122 32 L111 34 L105 50 L94 50 L98 34 L80 34 L73 46 L62 46 L66 34 L44 34 L28 40 L24 48 L8 48 L2 44 Z',
    g3: 'M2 30 L36 25 L78 26 L82 20 L90 16 L128 16 L132 20 L128 24 L190 26 L190 30 L120 32 L112 34 L116 56 L104 57 L100 34 L82 34 L76 46 L64 46 L68 34 L44 34 L8 46 L2 43 Z',
    smg: 'M18 31 L58 28 L62 22 L150 22 L150 26 L178 26 L178 30.5 L150 32 L140 34 L126 34 L129 60 L118 60 L114 34 L98 34 L92 50 L80 50 L84 34 L60 36 L22 45 Z',
    mac: 'M60 26 L66 20 L150 20 L150 25 L166 25 L166 30 L150 31 L146 36 L112 36 L116 64 L102 64 L98 36 L84 36 L80 50 L68 50 L70 36 L60 36 Z',
    p90: 'M24 32 Q24 19 46 19 L150 19 Q168 19 171 27 L184 27 L184 32 L162 36 L130 40 L121 55 L104 55 L101 40 L60 40 L40 47 Q24 47 24 38 Z',
    nova:'M2 30 L40 26 L58 25 L62 22 L198 22 L198 27 L150 28 L150 33 L94 34 L86 36 L80 50 L68 50 L70 36 L44 36 L8 46 L2 43 Z',
    pistol:'M52 22 L152 22 L154 33 L120 33 L115 37 L104 37 L111 66 L89 68 L80 39 L74 33 L52 33 Z',
    deagle:'M44 20 L156 20 L158 34 L120 34 L114 38 L104 38 L112 68 L88 70 L78 40 L72 34 L44 34 Z',
    usp:'M30 23 L120 23 L122 21 L194 21 L194 33 L122 33 L120 32 L96 32 L91 36 L82 36 L89 64 L68 66 L60 38 L54 32 L30 32 Z',
    knife:'M8 42 Q6 36 16 36 L66 35 L74 32 L182 30 Q194 33 178 42 Q130 47 92 47 L74 48 L66 46 L16 48 Q8 48 8 42 Z',
    karambit:'M18 50 Q10 44 20 42 L72 40 Q122 34 166 8 Q164 40 112 52 L72 55 L22 57 Q14 56 18 50 Z',
    butterfly:'M6 42 Q6 36 14 36 L72 35 L80 32 L186 32 Q194 36 182 42 L120 45 L80 46 L72 47 L14 48 Q6 48 6 42 Z',
    gut:'M8 44 Q6 38 16 38 L68 37 L76 32 L150 28 Q170 22 186 30 Q178 36 168 36 Q172 46 150 48 L76 49 L68 48 L16 50 Q8 50 8 44 Z',
    gloves:'M40 72 L40 36 Q40 30 46 30 Q52 30 52 36 L52 22 Q52 15 59 15 Q66 15 66 22 L66 16 Q66 9 73 9 Q80 9 80 16 L80 21 Q80 14 87 14 Q94 14 94 21 L94 46 L106 34 Q113 28 119 34 Q124 40 118 47 L98 70 Q92 76 80 76 L48 76 Q40 76 40 72 Z',
  };
  const HANDLE = { knife:'M8 42 Q6 36 16 36 L66 35 L66 46 L16 48 Q8 48 8 42 Z', karambit:'M18 50 Q10 44 20 42 L72 40 L72 55 L22 57 Q14 56 18 50 Z', butterfly:'M6 42 Q6 36 14 36 L72 35 L72 47 L14 48 Q6 48 6 42 Z', gut:'M8 44 Q6 38 16 38 L68 37 L68 48 L16 50 Q8 50 8 44 Z' };
  const MODEL = { 'AK-47':'ak','M4A4':'m4','M4A1-S':'m4s','FAMAS':'famas','AWP':'awp','G3SG1':'g3','UMP-45':'smg','MP9':'smg','MAC-10':'mac','P90':'p90','Nova':'nova','P250':'pistol','Five-SeveN':'pistol','Glock-18':'pistol','Desert Eagle':'deagle','USP-S':'usp','★ Butterfly Knife':'butterfly','★ Karambit':'karambit','★ M9 Bayonet':'knife','★ Flip Knife':'knife','★ Gut Knife':'gut','★ Sport Gloves':'gloves' };
  // finish: [pattern, colors...]
  const FINISH = {
    'p250-sand':['camo','#c9b48a','#a88f62','#8a7550','#e0d1a8'], 'nova-predator':['camo','#4a5a3a','#2e3a26','#6b5a3e','#1d241a'],
    'mp9-storm':['camo','#6f7f8f','#4b5866','#9aa8b4','#38424d'], 'g3-desert':['camo','#c4a676','#9a7f55','#e1cda4','#7a6644'],
    'ump-urban':['digital','#8d939a','#5d636a','#b8bdc2','#3f454b'], 'mac10-candy':['solid','#d41f2c','#7a0a12'],
    'fs-forest':['camo','#3b4a35','#25301f','#56664a','#151b12'], 'glock-water':['art','#d6262f','#1c6fd6','#f2f2f2','#121212'],
    'p90-asiimov':['asiimov','#f1f1ee','#151515','#f07a1a'], 'usp-cortex':['art','#ff5fa8','#43c5ff','#ffe14d','#1a1030'],
    'm4a4-evil':['art','#1f3fa8','#d6262f','#e9e9e9','#0e1330'], 'ak-elite':['stripes','#e8edf5','#2f5fd0','#14223f'],
    'famas-roll':['stripes','#2bc4b8','#ff4f8f','#141c2a'], 'deagle-cobalt':['shards','#1f56d6','#7fb0ff','#0d1b48'],
    'awp-atheris':['scales','#1aa79a','#0b4f4a','#f2d36b'], 'ak-redline':['redline','#18191c','#d81e2a','#2b2d33'],
    'm4a1-hyper':['art','#1ad1c1','#ff3ea5','#ffe23d','#14122a'], 'usp-kill':['art','#d81e2a','#111111','#f2f2f2','#ff9a3c'],
    'deagle-blaze':['flame','#121212','#ff8a1a','#ffd23d'], 'awp-hyper':['art','#1ad1c1','#ff3ea5','#ffe23d','#14122a'],
    'ak-vulcan':['stripes','#f2f4f8','#1b6fe0','#101114'], 'm4a4-howl':['flame','#7a1010','#ff5a1f','#ffb03a'],
    'awp-asiimov':['asiimov','#f1f1ee','#151515','#f07a1a'], 'ak-fire':['scales','#3d6b3a','#1f3a1d','#e6c25a'],
    'm4a1-print':['marble','#f4f4f2','#1a1a1a','#cfcfcf'], 'awp-lore':['scales','#d7b45a','#7d5f22','#5a7a3a'],
    'glock-fade':['fade','#ffd23d','#ff5fa8','#7a4cff'], 'k-butterfly':['fade','#ffd23d','#ff5fa8','#7a4cff'],
    'k-karambit':['doppler','#3a0d18','#b0263e','#3a5cff'], 'k-m9':['tiger','#e89a2a','#2a1a0a'],
    'k-flip':['marble','#ff3a2a','#2a55ff','#ffd23d'], 'k-gut':['slaughter','#c81e2a','#ff8fa8','#5a0a12'],
    'g-sport':['art','#ff5fa8','#43c5ff','#f2f2f2','#141414'],
  };
  function patternBody(id, f, r){
    const [kind, ...c] = f; let s = `<rect width="200" height="80" fill="${c[0]}"/>`;
    const R = (a, b) => a + r() * (b - a);
    if (kind === 'camo') for (let i = 0; i < 26; i++) { const x = R(0, 200), y = R(0, 80), w = R(8, 26), h = R(5, 14); s += `<ellipse cx="${x|0}" cy="${y|0}" rx="${w|0}" ry="${h|0}" transform="rotate(${R(-30,30)|0} ${x|0} ${y|0})" fill="${c[1 + (i % (c.length - 1))]}"/>`; }
    if (kind === 'digital') for (let i = 0; i < 160; i++) { const sz = 4; s += `<rect x="${(R(0,50)|0)*sz}" y="${(R(0,20)|0)*sz}" width="${sz*(1+(r()*3|0))}" height="${sz}" fill="${c[1 + (i % (c.length - 1))]}"/>`; }
    if (kind === 'solid') s = `<rect width="200" height="80" fill="${c[0]}"/><rect y="44" width="200" height="36" fill="${c[1]}" opacity=".55"/>`;
    if (kind === 'stripes') { s = `<rect width="200" height="80" fill="${c[0]}"/>`; for (let x = -80; x < 220; x += 26) s += `<path d="M${x} 80 L${x+40} 0 L${x+52} 0 L${x+12} 80Z" fill="${c[1]}"/><path d="M${x+14} 80 L${x+54} 0 L${x+57} 0 L${x+17} 80Z" fill="${c[2]}"/>`; }
    if (kind === 'redline') { for (let y = 0; y < 80; y += 3) s += `<rect y="${y}" width="200" height="1" fill="${c[2]}"/>`; s += `<path d="M0 30 L200 26 L200 29 L0 33Z M0 44 L200 40 L200 42 L0 46Z" fill="${c[1]}"/>`; }
    if (kind === 'art' || kind === 'shards') for (let i = 0; i < 22; i++) { const x = R(-10,200), y = R(-10,80); s += `<path d="M${x|0} ${y|0} l${R(10,40)|0} ${R(-20,20)|0} l${R(-20,10)|0} ${R(10,30)|0}Z" fill="${c[1 + (i % (c.length - 1))]}" opacity="${kind==='shards'?0.8:1}"/>`; }
    if (kind === 'asiimov') s = `<rect width="200" height="80" fill="${c[0]}"/><path d="M60 0 L110 0 L95 80 L45 80Z" fill="${c[1]}"/><path d="M130 0 L150 0 L140 80 L120 80Z" fill="${c[2]}"/><path d="M0 50 L60 46 L58 52 L0 56Z" fill="${c[2]}"/><path d="M150 0 L200 0 L200 80 L140 80Z" fill="${c[1]}" opacity=".85"/>`;
    if (kind === 'scales') { for (let y = 0; y < 90; y += 8) for (let x = (y/8%2)*6; x < 210; x += 12) s += `<path d="M${x} ${y} a6 6 0 0 1 12 0" fill="none" stroke="${c[1]}" stroke-width="1.6"/>`; s += `<path d="M0 50 Q50 20 100 45 T200 30" stroke="${c[2]}" stroke-width="5" fill="none" opacity=".9"/>`; }
    if (kind === 'flame') { s = `<rect width="200" height="80" fill="${c[0]}"/>`; for (let i = 0; i < 9; i++) { const x = i * 24 + R(-6,6); s += `<path d="M${x} 80 Q${x+4} 50 ${x+18} ${R(14,34)|0} Q${x+12} 52 ${x+26} 80Z" fill="${c[1]}"/><path d="M${x+8} 80 Q${x+10} 60 ${x+18} ${R(40,54)|0} Q${x+16} 64 ${x+20} 80Z" fill="${c[2]}"/>`; } }
    if (kind === 'fade') s = `<defs><linearGradient id="${id}g" x1="0" x2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset=".5" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient></defs><rect width="200" height="80" fill="url(#${id}g)"/>`;
    if (kind === 'marble' || kind === 'doppler') { s = `<defs><filter id="${id}b"><feGaussianBlur stdDeviation="${kind==='marble'?3:6}"/></filter></defs><rect width="200" height="80" fill="${c[0]}"/><g filter="url(#${id}b)">`; for (let i = 0; i < 14; i++) s += `<ellipse cx="${R(0,200)|0}" cy="${R(0,80)|0}" rx="${R(6,28)|0}" ry="${R(3,10)|0}" fill="${c[1 + (i % (c.length - 1))]}"/>`; s += '</g>'; }
    if (kind === 'tiger') { s = `<rect width="200" height="80" fill="${c[0]}"/>`; for (let x = 70; x < 200; x += 12) s += `<path d="M${x} 20 Q${x+6} 36 ${x-2} 52 L${x+3} 52 Q${x+10} 36 ${x+4} 20Z" fill="${c[1]}"/>`; }
    if (kind === 'slaughter') { for (let i = 0; i < 18; i++) s += `<path d="M${R(60,200)|0} ${R(20,50)|0} q${R(4,14)|0} ${R(-8,8)|0} ${R(8,20)|0} ${R(-4,6)|0} q-6 8 -14 6Z" fill="${c[1 + (i % 2)]}"/>`; }
    return s;
  }
  function itemSVG(item){
    const id = 'a' + (++uid); const model = MODEL[item.weapon] || 'ak'; const d = SHAPE[model];
    const f = FINISH[item.id] || ['solid', '#888', '#444']; const r = rng(item.id);
    const handle = HANDLE[model] ? `<path d="${HANDLE[model]}" fill="#1b1d24"/><path d="${HANDLE[model]}" fill="url(#${id}h)" opacity=".5"/>` : '';
    return `<svg viewBox="0 0 200 80" aria-hidden="true"><defs><clipPath id="${id}c"><path d="${d}"/></clipPath><linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient></defs>
<g clip-path="url(#${id}c)">${patternBody(id, f, r)}${handle}<rect width="200" height="80" fill="url(#${id}h)"/></g><path d="${d}" fill="none" stroke="#05060a" stroke-opacity=".65" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  }
  const EMBLEM = {
    star: 'M0 -15 L4.4 -4.6 L15 -4.6 L6.5 2.2 L9.5 13 L0 6.5 L-9.5 13 L-6.5 2.2 L-15 -4.6 L-4.4 -4.6Z',
    cross: 'M-2 -16 h4 v10 h-4z M-2 6 h4 v10 h-4z M-16 -2 v4 h10 v-4z M6 -2 v4 h10 v-4z M0 -9 a9 9 0 1 1 -0.01 0z M0 -6 a6 6 0 1 0 0.01 0z',
    bullet: 'M-5 -16 Q0 -24 5 -16 L5 8 L-5 8Z M-6 10 h12 v6 h-12z',
    scope: 'M0 -15 a15 15 0 1 1 -0.01 0z M0 -11 a11 11 0 1 0 0.01 0z M-1 -11 h2 v22 h-2z M-11 -1 v2 h22 v-2z',
    blade: 'M-14 12 L6 -12 Q14 -18 12 -8 L-8 14Z M-16 10 l6 6 l-3 3 l-6 -6z',
    crown: 'M-16 10 L-14 -8 L-6 2 L0 -14 L6 2 L14 -8 L16 10Z M-16 12 h32 v5 h-32z',
  };
  const THEME = { starter:'star', rifle:'cross', pistol:'bullet', sniper:'scope', blade:'blade', legend:'crown' };
  function caseSVG(c, heroImg){
    const id = 'c' + (++uid); const h = c.hue; const em = EMBLEM[THEME[c.id] || 'star'];
    const r = rng(c.id); let rays = '', sparks = '';
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; rays += `<path d="M120 92 L${120 + Math.cos(a - .09) * 140} ${92 + Math.sin(a - .09) * 140} L${120 + Math.cos(a + .09) * 140} ${92 + Math.sin(a + .09) * 140}Z"/>`; }
    for (let i = 0; i < 9; i++) { const x = 20 + r() * 200, y = 10 + r() * 90, s = 1.5 + r() * 2.5; sparks += `<path d="M${x} ${y - s * 2} L${x + s * .5} ${y - s * .5} L${x + s * 2} ${y} L${x + s * .5} ${y + s * .5} L${x} ${y + s * 2} L${x - s * .5} ${y + s * .5} L${x - s * 2} ${y} L${x - s * .5} ${y - s * .5}Z" fill="hsl(${h} 100% 85%)" opacity="${(.4 + r() * .6).toFixed(2)}"/>`; }
    const peek = heroImg ? `<image href="${heroImg}" x="54" y="2" width="150" height="112" transform="rotate(-14 129 58)" preserveAspectRatio="xMidYMid meet"/>` : '';
    const rivets = [[38,104],[202,104],[38,166],[202,166],[118,166],[118,104]].map(([x,y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="url(#${id}m)" stroke="#0007" stroke-width=".6"/>`).join('');
    return `<svg viewBox="0 0 240 190" aria-hidden="true"><defs>
<linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h} 70% 52%)"/><stop offset=".55" stop-color="hsl(${h} 72% 34%)"/><stop offset="1" stop-color="hsl(${h} 75% 20%)"/></linearGradient>
<linearGradient id="${id}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h} 80% 74%)"/><stop offset="1" stop-color="hsl(${h} 70% 50%)"/></linearGradient>
<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="hsl(${h} 70% 26%)"/><stop offset="1" stop-color="hsl(${h} 75% 14%)"/></linearGradient>
<linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f6ff"/><stop offset=".45" stop-color="#9aa3c4"/><stop offset="1" stop-color="#3b4263"/></linearGradient>
<radialGradient id="${id}g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="hsl(${h} 100% 70%)" stop-opacity=".7"/><stop offset="1" stop-color="hsl(${h} 100% 60%)" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}e" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="hsl(${h} 95% 80%)"/><stop offset="1" stop-color="hsl(${h} 80% 38%)"/></radialGradient>
<pattern id="${id}hz" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="#14151c"/><rect width="6" height="12" fill="hsl(${h} 90% 60%)"/></pattern>
<clipPath id="${id}cl"><path d="M30 98 L210 98 L210 172 L30 172Z"/></clipPath></defs>
<g fill="hsl(${h} 100% 70%)" opacity=".10">${rays}</g>
<circle cx="120" cy="92" r="92" fill="url(#${id}g)"/>
${sparks}
<ellipse cx="124" cy="180" rx="100" ry="8" fill="#000" opacity=".5"/>
${peek}
<path d="M210 98 L228 84 L228 156 L210 172Z" fill="url(#${id}s)"/>
<path d="M30 98 L210 98 L210 172 L30 172Z" fill="url(#${id}f)"/>
<g clip-path="url(#${id}cl)"><rect x="30" y="148" width="180" height="10" fill="url(#${id}hz)" opacity=".9"/><path d="M30 98 L120 98 L60 172 L30 172Z" fill="#fff" opacity=".06"/></g>
<path d="M22 86 L212 86 L232 72 L42 72Z" fill="url(#${id}t)"/>
<path d="M22 86 L212 86 L212 100 L22 100Z" fill="hsl(${h} 70% 40%)"/>
<path d="M212 86 L232 72 L232 86 L212 100Z" fill="hsl(${h} 70% 26%)"/>
<path d="M22 86 L212 86" stroke="#fff" stroke-opacity=".5" stroke-width="1"/>
<g fill="url(#${id}m)" stroke="#0006" stroke-width=".6"><path d="M28 96 h18 v5 h-13 v13 h-5z"/><path d="M212 96 h-18 v5 h13 v13 h5z"/><path d="M28 174 h18 v-5 h-13 v-13 h-5z"/><path d="M212 174 h-18 v-5 h13 v-13 h5z"/></g>
${rivets}
<circle cx="120" cy="126" r="24" fill="#0c0d18" stroke="url(#${id}m)" stroke-width="3"/>
<circle cx="120" cy="126" r="19" fill="url(#${id}e)"/>
<path d="${em}" transform="translate(120 126)" fill="#0c0d18" opacity=".85"/>
<rect x="104" y="80" width="32" height="14" rx="3" fill="#0c0d18" stroke="url(#${id}m)" stroke-width="1.5"/><circle cx="120" cy="87" r="3" fill="hsl(${h} 100% 75%)"/>
<text x="120" y="168" text-anchor="middle" font-family="Chakra Petch, sans-serif" font-weight="700" font-size="8" letter-spacing="3" fill="#fff" opacity=".85">${c.name.toUpperCase()}</text></svg>`;
  }
  root.ART = { itemSVG, caseSVG };
})(this);
