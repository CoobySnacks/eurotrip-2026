# 🇦🇹🇩🇰🇳🇱🇬🇧 EUROTRIP 2026

**Coob · Jared · Grant** — Dallas → Vienna → Copenhagen → Amsterdam → London → Dallas
**Aug 26 – Sep 8, 2026**

### → [coobysnacks.github.io/eurotrip-2026](https://coobysnacks.github.io/eurotrip-2026/)

A mobile-first PWA for three phones. Counts down to wheels-up, then flips itself
into a live "what are we doing right now" view for the whole trip.

---

## What it does

- **Countdown → TODAY.** Before Aug 26 it's a countdown clock over the full
  itinerary. After takeoff it becomes a NOW / UP NEXT / weather view that rolls
  to the new day automatically, in the timezone of whatever city we're in.
- **Every venue, fully linked.** Apple Maps deep link, official menu, verified
  Instagram, website, tap-to-call — 68 venues.
- **Live weather** via Open-Meteo (no key), °F, with rain flags on outdoor plans.
- **💸 Money.** Settle-up from the trip spreadsheet, private per person, with a
  "see everyone" toggle.
- **✅ Checklists.** Documents (UK ETA!) and packing, saved per phone.
- **🍻 Nightly questions.** 3 trivia about that exact day + 5 about how the day
  went + the two permanent house rules. Unlocks 8 PM local, with a push
  notification so everyone's phone buzzes at dinner.

## Editing it

Everything is in **`data/trip.json`**. Push to `main` and it redeploys itself.

See **[CLAUDE.md](CLAUDE.md)** for the schema and common edits — written so a
Claude Code session on a phone can make any change in one shot.

## Stack

Vanilla HTML/CSS/JS. No build step, no framework, no dependencies.
GitHub Pages + GitHub Actions. Cloudflare Worker + KV for push subscriptions.
