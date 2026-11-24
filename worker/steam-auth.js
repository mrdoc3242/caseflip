// Cloudflare Worker: verifies a Steam OpenID login and returns the player's profile.
// Deploy free on workers.dev, set secret STEAM_API_KEY (https://steamcommunity.com/dev/apikey),
// then put the worker URL into CONFIG.STEAM_VERIFY_URL in src/app.js.
export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*', 'Content-Type': 'application/json' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'POST' } });
    const params = new URLSearchParams(await req.text());
    params.set('openid.mode', 'check_authentication');
    const check = await fetch('https://steamcommunity.com/openid/login', { method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (!/is_valid\s*:\s*true/.test(await check.text())) return new Response(JSON.stringify({ error: 'invalid' }), { status: 401, headers: cors });
    const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(params.get('openid.claimed_id') || '');
    if (!m) return new Response(JSON.stringify({ error: 'bad id' }), { status: 400, headers: cors });
    let name = null, avatar = null;
    if (env.STEAM_API_KEY) {
      const r = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${env.STEAM_API_KEY}&steamids=${m[1]}`);
      const p = (await r.json()).response?.players?.[0]; if (p) { name = p.personaname; avatar = p.avatarmedium; }
    }
    return new Response(JSON.stringify({ steamid: m[1], name, avatar }), { headers: cors });
  }
};
