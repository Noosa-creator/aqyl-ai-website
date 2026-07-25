// api/shorten.js — server-side proxy for da.gd's URL shortener.
// da.gd actually supports CORS (Access-Control-Allow-Origin: *), so this proxy isn't strictly
// required for that reason — it's kept so the provider stays swappable server-side without a
// client redeploy. (is.gd was tried first but rejects .kz domains outright — confirmed via
// direct testing: aqyl-ai.kz and even google.kz fail on is.gd/v.gd with "database insert failed"
// while non-.kz domains succeed, so it's a TLD-level block, not something a proxy can route around.)
// Only ever shortens links that already point back at our own site — not a general-purpose open shortener.

export const config = { runtime: 'edge' };

const ALLOWED = [
  'https://aqyl-ai.kz',
  'https://www.aqyl-ai.kz',
  'http://localhost:3000',
  'http://127.0.0.1:5500'
];

const MAX_URL_LEN = 4200; // matches the ?demo= 4000-char cap plus room for the base URL/path

function cors(origin) {
  const allow = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers });

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';
  const headers = cors(origin);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);

  if (origin && !ALLOWED.includes(origin) && !origin.endsWith('.vercel.app')) {
    return json({ error: 'forbidden' }, 403, headers);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400, headers);
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url || url.length > MAX_URL_LEN) return json({ error: 'bad_url' }, 400, headers);

  // Only shorten links that point back at our own site.
  const isOwn = ALLOWED.some(o => url === o || url.startsWith(o + '/'));
  if (!isOwn) return json({ error: 'forbidden_url' }, 403, headers);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const res = await fetch('https://da.gd/shorten?url=' + encodeURIComponent(url), {
      signal: controller.signal
    });
    clearTimeout(timer);

    const text = (await res.text()).trim();
    if (res.ok && /^https:\/\/da\.gd\//.test(text)) {
      return json({ short: text }, 200, headers);
    }
    return json({ error: 'shortener_failed', detail: text.slice(0, 120) }, 502, headers);
  } catch (e) {
    return json({ error: 'shortener_timeout' }, 504, headers);
  }
}
