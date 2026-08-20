// api/_lib/ratelimit.js — best-effort in-memory sliding-window limiter.
// Vercel Edge functions can spin up multiple isolated instances, so this
// caps abuse per warm instance rather than globally — cheap first line of
// defense against a script hammering an LLM-backed endpoint, not a hard
// guarantee. A real multi-instance limit would need something like Upstash
// Redis / Vercel KV shared state.

const buckets = new Map();

export function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  let hits = buckets.get(key);
  if (!hits) { hits = []; buckets.set(key, hits); }
  while (hits.length && now - hits[0] > windowMs) hits.shift();
  if (hits.length >= limit) return true;
  hits.push(now);
  // Bound memory: if the map grows large (many distinct IPs), drop the oldest-looking entries.
  if (buckets.size > 5000) {
    const firstKey = buckets.keys().next().value;
    if (firstKey !== undefined) buckets.delete(firstKey);
  }
  return false;
}

export function clientIp(req) {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}
