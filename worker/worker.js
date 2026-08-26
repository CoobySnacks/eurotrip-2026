/**
 * Cloudflare Worker — push subscription store AND the notification scheduler
 * for EUROTRIP 2026.
 *
 * Why the scheduling lives here rather than in GitHub Actions: Actions cron is
 * explicitly best-effort, and on this repo an every-10-minutes schedule was
 * observed running 202 minutes apart. That's survivable for a morning hype
 * message and fatal for "leave in 15 minutes". Cloudflare cron triggers fire
 * on time, so this Worker owns anything time-sensitive.
 *
 * Routes
 *   POST /subscribe      {who, subscription}   — public, called by the PWA
 *   GET  /subscriptions                        — Bearer ADMIN_TOKEN
 *   POST /prune          {ids:[...]}           — Bearer ADMIN_TOKEN
 *   POST /test           {who?, title, body}   — Bearer ADMIN_TOKEN, manual send
 *   GET  /due?at=ISO                           — Bearer ADMIN_TOKEN, dry-run the schedule
 *   GET  /health
 *
 * Cron: every 5 minutes.
 *
 * Bindings: KV `SUBS`; secrets ADMIN_TOKEN, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY,
 * VAPID_SUBJECT.
 */

import { sendPush } from './webpush.js';

const TRIP_URL = 'https://coobysnacks.github.io/eurotrip-2026/data/trip.json';
const SITE = 'https://coobysnacks.github.io/eurotrip-2026/';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const json = (o, s = 200) =>
  new Response(JSON.stringify(o, null, 2), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

/* ══════════════ time helpers ══════════════ */

const ROLLOVER = 4;   // the trip day turns over at 4 AM local, not midnight

function partsIn(tz, date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const p = {};
  for (const { type, value } of f.formatToParts(date)) p[type] = value;
  const hour = p.hour === '24' ? '00' : p.hour;
  return { dateStr: `${p.year}-${p.month}-${p.day}`, h: +hour, mi: +p.minute, minutes: +hour * 60 + +p.minute };
}

function shiftDate(ds, n) {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Trip date + continuous minutes, honouring the 4 AM rollover. */
function tripNow(tz, date) {
  const p = partsIn(tz, date);
  return p.h < ROLLOVER
    ? { date: shiftDate(p.dateStr, -1), minutes: p.minutes + 1440 }
    : { date: p.dateStr, minutes: p.minutes };
}

const blockKey = t => {
  const [h, m] = t.split(':').map(Number);
  return h < ROLLOVER ? h * 60 + m + 1440 : h * 60 + m;
};

const fmt12 = t => {
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
};

/* ══════════════ what should go out right now ══════════════ */

/* Blocks worth interrupting three people for. Notes and free time are not. */
const ALERT_TYPES = new Set(['meal', 'drinks', 'club', 'tour', 'activity', 'flight', 'transfer', 'travel', 'hotel']);
const DEFAULT_LEAD = 15;      // minutes before
const GRACE = 35;             // fire even if the cron ran late, but not hours later

const ICON = { meal: '🍽', drinks: '🍺', club: '🕺', tour: '🚶', activity: '🎟',
               flight: '✈️', transfer: '🚐', travel: '🚉', hotel: '🏨' };

/**
 * @returns {Array<{id,title,body,url,tag,ttl}>} everything due at `now`
 */
function computeDue(trip, now) {
  const out = [];

  /* ---- 7:30 AM Central countdown ----
     Naturally self-limiting: it only fires on a date that has a
     countdownPushes entry, and those end on departure day. It must NOT
     gate the day-processing below. The original code returned early
     whenever now < departureISO — which suppressed EVERYTHING on Aug 26
     before the 7:40 PM wheels-up: the 4 PM driver alert, the 7:25 flight
     alert, and the 6 PM lounge questions the whole night was built
     around. Caught in the departure-day audit, deployed the same morning. */
  {
    const tz = trip.cities.dallas.tz;
    const p = partsIn(tz, now);
    const target = 7 * 60 + 30;
    if (p.minutes >= target && p.minutes - target <= GRACE) {
      const m = (trip.countdownPushes || []).find(x => x.date === p.dateStr);
      if (m) out.push({ id: `countdown:${m.date}`, title: m.title, body: m.body, url: SITE, tag: 'countdown', ttl: 21600 });
    }
  }

  /* ---- trip days (none exist before departure day, so nothing fires early) ---- */
  for (const day of trip.days) {
    const city = trip.cities[day.cityKey];
    const tn = tripNow(city.tz, now);
    if (tn.date !== day.date) continue;      // not the day we're living

    const due = (mins) => tn.minutes >= mins && tn.minutes - mins <= GRACE;

    /* morning agenda, 8:30 local */
    if (due(8 * 60 + 30)) {
      const items = [...day.blocks]
        .filter(b => ALERT_TYPES.has(b.type))
        .sort((a, b) => blockKey(a.time) - blockKey(b.time))
        .slice(0, 4)
        .map(b => `${fmt12(b.time)} ${b.title}`);
      out.push({
        id: `agenda:${day.date}`,
        title: `${city.flag} ${day.title}`,
        body: items.join('\n') || 'Nothing scheduled — free day.',
        url: SITE, tag: 'agenda', ttl: 21600,
      });
    }

    /* per-block heads-up */
    for (const b of day.blocks) {
      if (b.alert === false) continue;
      if (!ALERT_TYPES.has(b.type)) continue;
      const lead = b.alertLead ?? DEFAULT_LEAD;
      const at = blockKey(b.time) - lead;
      if (!due(at)) continue;

      const venue = b.venue ? trip.venues[b.venue] : null;
      const bits = [];
      if (venue?.address) bits.push(venue.address);
      if (b.warn) bits.push(`⚠️ ${b.warn}`);
      else if (b.desc) bits.push(b.desc);

      out.push({
        id: `blk:${day.date}:${b.time}`,
        title: `${ICON[b.type] || '📍'} ${b.title} — ${lead} min`,
        body: bits.join('\n').slice(0, 300) || fmt12(b.time),
        url: SITE, tag: 'itinerary', ttl: 3600,
      });
    }

    /* nightly questions */
    const uh = day.unlockHour ?? trip.meta.questionsUnlockHour;
    if (due(uh * 60)) {
      const q = day.questions || {};
      const n = (q.trivia?.length || 0) + (q.discussion?.length || 0) + (trip.meta.fixedQuestions?.length || 0);
      out.push({
        id: `questions:${day.date}`,
        title: `${city.flag} Question time — ${city.name}`,
        body: `${q.trivia?.length || 0} trivia · ${q.discussion?.length || 0} about today · 2 house rules. ${n} questions. Phones out. 🍻`,
        url: SITE + 'index.html?tab=questions', tag: 'nightly-questions', ttl: 7200,
      });
    }
  }
  return out;
}

/* ══════════════ subscriptions ══════════════ */

async function idFor(endpoint) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function listSubs(env) {
  const list = await env.SUBS.list({ prefix: 'sub:' });
  const out = [];
  for (const k of list.keys) {
    const v = await env.SUBS.get(k.name);
    if (v) { try { out.push(JSON.parse(v)); } catch {} }
  }
  return out;
}

/** One device per person, newest wins. */
function dedupe(subs) {
  const newest = {};
  for (const s of subs) {
    const w = s.who || 'unknown';
    if (!newest[w] || (s.updated || 0) > (newest[w].updated || 0)) newest[w] = s;
  }
  return Object.values(newest);
}

const authed = (req, env) =>
  (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '') === env.ADMIN_TOKEN && !!env.ADMIN_TOKEN;

async function deliver(env, subs, payload, ttl) {
  const vapid = {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || 'mailto:jacob.talavera27@gmail.com',
  };
  let ok = 0;
  const results = [];
  for (const s of subs) {
    try {
      const r = await sendPush(s.subscription, payload, vapid, ttl);
      if (r.ok) ok++;
      if (r.gone) await env.SUBS.delete(`sub:${s.id}`);
      results.push({ who: s.who, status: r.status });
    } catch (e) {
      results.push({ who: s.who, error: String(e).slice(0, 120) });
    }
  }
  return { ok, results };
}

/* ══════════════ entrypoints ══════════════ */

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const now = new Date(event.scheduledTime || Date.now());
      const trip = await (await fetch(TRIP_URL, { cf: { cacheTtl: 300 } })).json();
      const due = computeDue(trip, now);
      if (!due.length) return;

      const subs = dedupe(await listSubs(env));
      if (!subs.length) return;

      for (const d of due) {
        // KV is the idempotency guard — a late or repeated cron can't double-send
        const seen = await env.SUBS.get(`sent:${d.id}`);
        if (seen) continue;
        await env.SUBS.put(`sent:${d.id}`, String(Date.now()), { expirationTtl: 259200 });
        await deliver(env, subs, { title: d.title, body: d.body, url: d.url, tag: d.tag }, d.ttl);
      }
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/health')
      return json({ ok: true, service: 'eurotrip-push', scheduler: 'cloudflare-cron', time: new Date().toISOString() });

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const sub = body?.subscription;
      if (!sub?.endpoint) return json({ error: 'missing subscription.endpoint' }, 400);
      const who = String(body.who || 'unknown').slice(0, 32);
      const id = await idFor(sub.endpoint);
      await env.SUBS.put(`sub:${id}`, JSON.stringify({ id, who, subscription: sub, updated: Date.now() }));
      return json({ ok: true, id, who });
    }

    if (url.pathname === '/subscriptions' && request.method === 'GET') {
      if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);
      const subs = await listSubs(env);
      return json({ count: subs.length, subscriptions: subs });
    }

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

    /* manual send — used to verify delivery without waiting for a cron */
    if (url.pathname === '/test' && request.method === 'POST') {
      if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);
      const b = await request.json().catch(() => ({}));
      let subs = dedupe(await listSubs(env));
      if (b.who) subs = subs.filter(s => s.who === b.who);
      const r = await deliver(env, subs,
        { title: b.title || 'Test', body: b.body || 'Test from the Worker.', url: SITE, tag: b.tag || 'test' }, 600);
      return json({ sentTo: subs.map(s => s.who), ...r });
    }

    /* dry-run the schedule for any instant — no sending, no KV writes */
    if (url.pathname === '/due') {
      if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);
      const at = url.searchParams.get('at');
      const now = at ? new Date(at) : new Date();
      const trip = await (await fetch(TRIP_URL, { cf: { cacheTtl: 60 } })).json();
      return json({ at: now.toISOString(), due: computeDue(trip, now) });
    }

    return json({ error: 'not found' }, 404);
  },
};
