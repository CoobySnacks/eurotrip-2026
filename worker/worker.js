/**
 * Cloudflare Worker — push subscription store for EUROTRIP 2026.
 *
 * Three phones, one KV namespace. Free tier is wildly more than enough.
 *
 * Routes
 *   POST /subscribe      {who, subscription}   — public, called by the PWA
 *   GET  /subscriptions                        — Bearer ADMIN_TOKEN, used by GitHub Actions
 *   POST /prune          {ids:[...]}           — Bearer ADMIN_TOKEN, drops dead endpoints
 *   GET  /health                               — public sanity check
 *
 * Bindings required
 *   KV namespace : SUBS
 *   Secret       : ADMIN_TOKEN
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

/** Stable id for a subscription — the endpoint is unique per device. */
async function idFor(endpoint) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

function authed(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.replace(/^Bearer\s+/i, '');
  return token && env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'eurotrip-push', time: new Date().toISOString() });
    }

    /* ---- register a phone ---- */
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'bad json' }, 400); }

      const sub = body?.subscription;
      if (!sub?.endpoint) return json({ error: 'missing subscription.endpoint' }, 400);

      const who = String(body.who || 'unknown').slice(0, 32);
      const id = await idFor(sub.endpoint);

      await env.SUBS.put(
        `sub:${id}`,
        JSON.stringify({ id, who, subscription: sub, updated: Date.now() })
      );
      return json({ ok: true, id, who });
    }

    /* ---- list for the nightly job ---- */
    if (url.pathname === '/subscriptions' && request.method === 'GET') {
      if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);

      const list = await env.SUBS.list({ prefix: 'sub:' });
      const out = [];
      for (const k of list.keys) {
        const v = await env.SUBS.get(k.name);
        if (v) { try { out.push(JSON.parse(v)); } catch {} }
      }
      return json({ count: out.length, subscriptions: out });
    }

    /* ---- drop endpoints the push service rejected ---- */
    if (url.pathname === '/prune' && request.method === 'POST') {
      if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);

      const { ids = [] } = await request.json().catch(() => ({}));
      let n = 0;
      for (const raw of ids) {
        const id = raw?.startsWith('http') ? await idFor(raw) : raw;
        if (id) { await env.SUBS.delete(`sub:${id}`); n++; }
      }
      return json({ ok: true, pruned: n });
    }

    return json({ error: 'not found' }, 404);
  },
};
