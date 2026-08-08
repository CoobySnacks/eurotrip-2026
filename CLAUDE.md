# EUROTRIP 2026 — architecture & edit guide

**Read this first.** It is written for a future Claude Code session — very likely
running on Jacob's **phone**, with no laptop available. Everything below assumes
you can edit files and `git push`, and nothing else.

---

## The one rule

> **All content lives in `data/trip.json`. The HTML/JS only renders it.**

Changing a dinner, cancelling a bar, fixing a confirmation number, rewriting
tonight's questions — every one of those is a **single edit to `data/trip.json`**.
You should almost never need to touch the JS.

Push to `main` → GitHub Actions validates the JSON → redeploys Pages → live in
~60 seconds. If the JSON is malformed **the deploy fails and the old site stays
up**, so a bad edit can't take the site down mid-trip.

---

## Live URLs

| What | Where |
|---|---|
| Site | https://coobysnacks.github.io/eurotrip-2026/ |
| Repo | https://github.com/CoobySnacks/eurotrip-2026 |
| Actions | https://github.com/CoobySnacks/eurotrip-2026/actions |

---

## Stack

Vanilla HTML + CSS + JS. **No build step, no framework, no dependencies.**
That is deliberate — nothing can rot or fail to install four weeks from now.

```
index.html              shell: identity gate, install banner, header, nav, footer
css/style.css           all styling (dark, phone-first, city accent via --c)
data/trip.json          ← EVERYTHING. The single source of truth.
js/store.js             localStorage: identity, checkboxes, weather cache
js/time.js              timezone engine (see "The 4 AM rule" below)
js/weather.js           Open-Meteo client, 1-hour cache, falls back to data/weather.json
data/weather.json       daily forecast snapshot — the offline fallback, written by CI
js/render.js            pure render functions — data in, HTML string out
js/push.js              service worker registration + push subscription
js/app.js               boot, routing, countdown ticker, event delegation
sw.js                   service worker: offline shell + push handler
manifest.json           PWA manifest
icons/                  app icons, generated from assets/logo.png
assets/logo.png         group-chat badge — gate screen + source for every icon
assets/crew.jpg         the three of them, pre-cropped to 6:5 (countdown hero, pre-trip only)
assets/crew-original.jpg full-frame master - KEEP IT, re-crop from this, never overwrite
scripts/send_push.py    nightly 8 PM notification sender
worker/worker.js        Cloudflare Worker — subscription store AND the notification
                        scheduler. Cron every 5 min. THIS sends everything.
worker/webpush.js       RFC 8291 push encryption + VAPID in pure Web Crypto
.github/workflows/      deploy.yml (Pages). The notification workflows still exist but
                        their SCHEDULES ARE DISABLED — manual runs only.
```

---

## Two modes, switched automatically

`App.phase()` in `js/app.js` returns:

| Phase | When | Home tab shows |
|---|---|---|
| `pre` | before `meta.departureISO` (2026-08-26 19:40 −05:00) | countdown hero + status strip + trip-at-a-glance + full day list |
| `live` | departure → 2026-09-09 00:00 −05:00 | TODAY view: NOW / suggestions / UP NEXT / weather / rest of day |
| `post` | after | TODAY view with a wrap-up note on top |

Nothing is hardcoded per-day — change `meta.departureISO` and both modes move.

### The 4 AM rule (important)

`js/time.js` rolls the **trip day** over at **4 AM local**, not midnight.

Why: Volksgarten on Friday Aug 28 is a `00:00` block. At 1:30 AM you are still
living Friday night, not Saturday. So:

- `T.tripDateIn(tz)` at 01:30 on Aug 29 returns `2026-08-28`
- `T.blockKey('00:00')` sorts **after** `23:00`, so the club lands at the end of
  the night where it belongs

If you add an after-midnight block, just write the real local time (`01:30`) and
the sort handles it.

---

## `data/trip.json` schema

### `meta`
Trip-level constants. `departureISO` drives the countdown and the pre/live
switch. `fixedQuestions` are the two house-rules questions appended to **every**
night. `questionsUnlockHour` is 20 (8 PM).

### `cities`
Keyed by `vienna` / `copenhagen` / `amsterdam` / `london` / `dallas`.

```jsonc
"vienna": {
  "key": "vienna",
  "name": "Vienna",
  "flag": "🇦🇹",
  "color": "#D4A537",        // drives the whole UI accent when this city is active
  "tz": "Europe/Vienna",     // IANA — DST handled by the OS, never hardcode offsets
  "lat": 48.21, "lon": 16.37,// Open-Meteo coordinates
  "currency": "Euro (€)",
  "dates": "Aug 27 – Aug 30",
  "summary": "one line for the glance card",
  "seasonal": "offline fallback text when weather can't load"
}
```

### `venues` — the link directory
Keyed by slug. **Blocks reference venues by key**, so a venue's address or
Instagram is defined exactly once.

```jsonc
"lugeck": {
  "name": "Lugeck",
  "address": "Lugeck 4, 1010 Wien",   // used to build the Apple Maps link
  "city": "Vienna",                    // must match cities[*].name — drives the city tab listing
  "website": "https://...",
  "menu": "https://...",               // null if none
  "instagram": "https://instagram.com/lugeck_figlmueller",
  "igHandle": "@lugeck_figlmueller",
  "phone": "+43 ...",                  // optional → renders a tap-to-call button
  "note": "shown under the name",
  "closed": true                       // optional → red CLOSED chip
}
```

Apple Maps links are generated in `R.mapsUrl()` as
`https://maps.apple.com/?q=<name>&address=<address>` — opens the native app on iPhone.

### `days[]`
One entry per calendar day, in order.

```jsonc
{
  "date": "2026-08-28",        // YYYY-MM-DD, must be unique
  "dow": "Friday",
  "cityKey": "vienna",
  "transitionFrom": "dallas",  // optional → renders the "both cities" banner
  "title": "VIENNA — Tour, Art, and the Big Night",
  "subtitle": "Pace yourself early.",
  "locked": true,              // cosmetic only
  "unlockHour": 18,            // optional — overrides meta.questionsUnlockHour (20)
                               // Aug 26 uses 18 because the push fires from the
                               // DFW lounge before takeoff. If you change this,
                               // change the matching cron too or the notification
                               // arrives while the tab is still locked.
  "blocks": [ ... ],
  "questions": { "trivia": [...], "discussion": [...] }
}
```

### `blocks[]` — the itinerary rows

```jsonc
{
  "time": "19:30",             // REQUIRED, 24h "HH:MM". Validated by CI.
  "endTime": "22:00",          // optional
  "type": "meal",              // meal|drinks|club|tour|activity|flight|transfer|hotel|travel|free|note
  "title": "Dinner · Zum Schwarzen Kameel",
  "venue": "zum-schwarzen-kameel",  // key into venues{}
  "desc": "body text",
  "note": "rendered italic",
  "warn": "amber callout; goes red if it matches /closed|not confirmed|do not|scam/i",
  "highlight": true,           // title takes the city accent colour
  "critical": true,            // red left border + tinted background
  "leaveBy": true,             // adds "🚨 LEAVE BY THIS TIME" in the UP NEXT list
  "outdoor": true,             // gets a rain flag when the forecast says >50%
  "rainCheck": true,           // same, for things like Reffen
  "conf": "AVBO53170",         // standalone confirmation (transfers)
  "flightRef": "BA 192",       // matches flights[].code → renders the live tracker
  "res": {                     // full reservation → also surfaces on the Bookings tab
    "conf": "RMJLT3NV7US",     // or the literal string "CONFIRMED"
    "party": 3,
    "time": "19:30",
    "note": "€25pp no-show fee"
  },
  "suggestions": [             // the "options/backups" cards
    { "title": "Fallback: Figlmüller", "desc": "same schnitzel", "venue": "figlmueller" }
  ],
  "subStops": [                // for multi-stop blocks like Vienna's "The Loop"
    { "name": "Demel", "venue": "demel", "note": "Sachertorte stop" }
  ],
  "orderCard": {               // collapsible "what to order" (see below)
    "title": "🍛 What to order",
    "intro": "optional line under the summary",
    "sections": [ { "label": "Grills", "items": [
      { "name": "Charred Lamb Chops", "price": "£19.90", "desc": "...", "must": true }
    ] } ],
    "suggested": "one-line order for the table",
    "footer": "Roughly £35–40 a head with a drink."
  }
}
```

`orderCard` renders as a native `<details>` — no JS, so it still expands with a
dead battery's worth of signal. `must: true` gives an item the gold left border.

**Put it on the VENUE, not the block.** `venues[key].orderCard` renders anywhere
that venue appears — the itinerary row, a `suggestions[]` backup, or a
`subStops[]` entry. Verde and Demel exist only as sub-stops of Saturday's Loop,
so a block-level card would never have shown for them. A block-level
`orderCard` still wins if present, but there is rarely a reason to use one.

Optional fields beyond `sections`: `intro`, `suggested` (green box),
`skip` (grey box), `warn` (red), and `allergy` (red, prawn icon —
**Coob is allergic to shrimp**, so the Vienna cards carry explicit avoid-lists
with prices; do not drop these).

### `concertNight` — the Sep 4 standalone page

Its own top-level object, rendered by `R.concertNight()` on the `concert` tab.
Written to be **read drunk, in a crowd, with no signal**: type one size up
site-wide, one instruction per `cn-line`, everything hardcoded (no fetches).

```jsonc
"concertNight": {
  "topAlert": { "title": "...", "body": "para\n\npara" },   // red alert box
  "timeline": [ { "time": "4:45 PM", "what": "Leave the hotel" } ],
  "steps": [ {
    "n": "2", "title": "THE METRO OUT", "meta": "16 minutes",
    "lines": [ "one instruction per string" ],
    "alert": { "title": "...", "body": "..." },   // optional, renders mid-step
    "linesAfter": [ "instructions that follow the alert" ],
    "venue": "blvd020",                           // optional → link row
    "tip": "Lost? ..."                            // grey side-note
  } ],
  "home": { ... },      // same shape; anchored at #getting-home
  "taxi": { "lines": [], "showDriver": "...", "warn": "..." },
  "preflight": { "items": [] },
  "separated": { "body": "..." },
  "phones": [ { "label": "Hotel", "number": "+31 20 623 1231" } ]
}
```

`\n\n` inside an alert or `separated.body` becomes a paragraph break.
`phones[].number` is rendered as a `tel:` link — keep it dialable.

The sticky **GETTING HOME** button is `.cn-jump`, anchored to `#getting-home`.
That is the section they will actually need at midnight; don't bury it.

### `pinnedLink` — big button at the top of a day

```jsonc
"pinnedLink": { "tab": "concert", "label": "🎸 CONCERT NIGHT — ...", "sub": "..." }
```
Renders above everything in both the TODAY view and the expanded day row.
`tab` is any nav tab id.

### `money`
`people.Jared` / `people.Grant` each carry `round1` (settled) and `round2`
(forecast). Per-person data is only shown to that person unless the
**"see everyone"** toggle is on. `stillToCome[]` drives the status chips
(`paid` / `inprogress` / `tobook`).

### `checklists`
`documents` and `packing`, each an `items[]` of
`{id, label, mandatory, emoji, desc, link, linkLabel, warn}`.
`id` is the localStorage key — **changing an `id` resets that checkbox for
everyone**, so don't rename them casually.

---

## Common edits

### Move a reservation
Find the block in `days[]`, change `time` and `res.time`. Done.
```jsonc
"time": "20:00",
"res": { "conf": "...", "party": 3, "time": "20:00" }
```

### Cancel a venue
Two options — pick by whether it might come back.

*Soft (recommended, keeps the history):* add a warning to the block.
```jsonc
"warn": "❌ CANCELLED — going to the fallback instead"
```
*Hard:* delete the block object from `blocks[]`. To mark the venue itself dead
everywhere, set `"closed": true` on its `venues{}` entry.

### Add a suggestion
Append to the block's `suggestions[]`. Reference an existing venue key, or add a
new one to `venues{}` first.
```jsonc
"suggestions": [
  { "title": "Ruby", "desc": "top-50 cocktail bar", "venue": "ruby" }
]
```

### Edit tonight's questions
Find the day, edit `questions.trivia[]` (each `{q, a}`) or
`questions.discussion[]` (plain strings). The two house-rules questions come from
`meta.fixedQuestions` and are appended to every night automatically — edit them
once there, not per day.

### Add a whole new day
Copy an existing day object, change `date` / `cityKey` / `title`, rewrite
`blocks[]`, and give it `questions.trivia` (≥1) and `questions.discussion` (≥1).
**CI fails the deploy if a day has no questions.**

### Change a transfer's status
`transfers[].status` accepts `paid` / `confirmed` / `inprogress` / `tobook`.
That drives the coloured chip on the Bookings tab. Add the real confirmation
number into the matching `legs[].conf` when it comes through.

---

## Weather

Open-Meteo, no key, no signup. Called client-side from `js/weather.js`,
cached **1 hour** in localStorage per city.

- Temps in °F, wind in mph.
- Any hour above **50%** precipitation probability raises a `☔️ rain likely at 4pm`
  flag, which also renders on blocks marked `outdoor` or `rainCheck`.
- If the fetch fails (plane, dead zone), it falls back to `cities[*].seasonal`
  text rather than showing an error.
- Dates more than ~16 days out aren't in the forecast; the city tab shows the
  seasonal average with a note instead.

---

## Push notifications

**In-site questions never depend on push.** The Questions tab unlocks at 8 PM
local on its own. Push is a convenience layer.

### How it works
1. Phone installs the PWA (Share → Add to Home Screen). **iOS only allows web
   push for installed apps** — this is a hard Apple restriction, not a bug.
2. Tapping 🔔 subscribes and POSTs the subscription to the Cloudflare Worker,
   which stores it in KV.
3. `nightly-questions.yml` runs on cron, pulls subscriptions from the Worker,
   and signs each push with the VAPID private key.

### Cron times — the UTC trap
GitHub Actions cron is **always UTC**. Summer 2026:

| Cities | Local offset | 8 PM local = |
|---|---|---|
| Vienna · Copenhagen · Amsterdam | CEST, UTC+2 | **18:00 UTC** |
| London | BST, UTC+1 | **19:00 UTC** |
| Dallas (Aug 26, **6 PM**) | CDT, UTC−5 | **23:00 UTC** |

That's why `nightly-questions.yml` has four cron lines. Aug 26 fires at 6 PM
from the DFW lounge — 8 PM Dallas time is 20 minutes after wheels-up, and a
push sent to a plane queues rather than vanishing, so it would have arrived at
Heathrow the next morning. Sep 8 (flying home) is skipped entirely.

`pick_day()` chooses the trip day whose **unlock moment is nearest to now**,
not the day matching the local date. Date matching is ambiguous: 23:00 UTC on
Aug 26 is 6 PM in Dallas *and* 1 AM on Aug 27 in Vienna. It also ignores any
run more than 6 hours from an unlock, so manual runs can't misfire.

GitHub's scheduler can fire several minutes late under load — cosmetic only,
since the site unlocks on time regardless.

### Secrets (repo → Settings → Secrets → Actions)
| Secret | Purpose |
|---|---|
| `VAPID_PRIVATE_KEY` | signs push messages — **never commit this** |
| `VAPID_SUBJECT` | `mailto:...` contact for push services |
| `PUSH_API` | Worker URL, e.g. `https://eurotrip-push.<sub>.workers.dev` |
| `PUSH_ADMIN_TOKEN` | bearer token for reading subscriptions |
| `NTFY_TOPIC` | *optional* ntfy.sh fallback topic |

The public VAPID key is in `js/push.js` (safe to ship). Set `PUSH_API` in that
same file once the Worker is deployed — it is empty until then, and push simply
no-ops.

### Testing push without waiting for 8 PM
Actions → *Nightly questions push* → **Run workflow**, optionally with a
`date` override and `dry_run: true` to see the payload without sending.

---

## The Cloudflare Worker — already deployed

| | |
|---|---|
| URL | `https://eurotrip-push.coobysnacks.workers.dev` |
| KV namespace | `eurotrip-subs` — id `766974225fd84191a5dfb112d6392b93` |
| Account | `1d7d939d411cb67b705baec6e3a52f49` |
| Secret binding | `ADMIN_TOKEN` (matches the `PUSH_ADMIN_TOKEN` repo secret) |

Health check: `curl -A "Mozilla/5.0" https://eurotrip-push.coobysnacks.workers.dev/health`

**⚠️ Send a browser User-Agent.** Cloudflare's edge 403s the default
`python-requests/x.y` UA on `workers.dev`. `scripts/send_push.py` sets one; if you
write any new client, do the same or you'll get a silent 403.

### Redeploying it
Only needed if `worker/worker.js` changes. With Node available:
```bash
cd worker && npx wrangler deploy
```
Without Node, PUT the script to
`/client/v4/accounts/<acct>/workers/scripts/eurotrip-push` as multipart
(`metadata` + `worker.js`), with the KV and secret bindings in the metadata —
that is how it was deployed originally.

---

## Identity

First visit asks Coob / Jared / Grant, stored at `et26.who` in localStorage.
No accounts, no backend, no passwords. It personalises the money tab, the
checklist state, and the greeting. Change it via **switch** in the footer.

Checklist state is **per phone** — everyone tracks their own. That is intentional.

---

## Images

- `assets/logo.png` (1200×1200) is the master. Regenerate icons from it with
  Pillow: 180/192/512 straight resizes, plus a maskable 512 padded to 78% on the
  badge's navy `rgb(19,29,56)`.
- `assets/crew.jpg` is **pre-cropped to 2:1**, so the CSS uses plain
  `object-position:center`. If you swap in a different photo, re-crop it to 2:1
  rather than fighting it with `object-position`. Keep an untouched original
  somewhere — the first version of this file was optimised in place and the
  full-frame original was lost, which limited a later re-crop.
- **Changing the icon after people have installed does nothing.** iOS snapshots
  the home-screen icon at install time. A new icon means deleting and re-adding
  the app, so get it right before the link goes out.
- The photo renders only in `R.hero()`, which only runs in `pre` phase. It
  deliberately disappears once the trip starts — screen space goes to the
  TODAY view.

## Gotchas

- **`data/trip.json` must stay valid JSON.** No trailing commas, no comments.
  CI catches it, but you'll waste a deploy cycle.
- **Don't rename checklist `id`s** — it silently resets that checkbox for everyone.
- **Times are 24-hour `HH:MM` strings.** `"7:30"` fails CI; write `"07:30"`.
- **Venue keys must exist** before a block references them. CI checks this.
- The service worker caches the shell but uses **network-first for `trip.json`**,
  so content edits appear on next open without a reinstall.
- `--c` is the CSS variable for the active city accent; `js/app.js` sets it.

---

## If you're a future Claude picking this up

The fastest path to almost any request:

1. `Read data/trip.json` — find the day by its `date`.
2. Make the one edit.
3. `git commit && git push`.
4. Tell Jacob it's live in ~60 seconds.

Only reach into `js/` if the *shape* of the data needs to change (a new field, a
new tab). For content — restaurants, times, links, questions, money, checklists —
`data/trip.json` is the whole job.
