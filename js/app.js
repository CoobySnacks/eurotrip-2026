/* ══════════════════════════════════════════════════════════
   app.js — bootstrap, routing, ticking.
   Loads data/trip.json once, decides pre-trip vs live-trip,
   and hands off to R.* for rendering.
   ══════════════════════════════════════════════════════════ */

const App = (() => {

  let D = null;                 // trip.json
  let tab = null;               // active tab id
  let openDay = null;           // expanded day in list views
  let qDate = null;             // selected day on Questions tab
  let wxCache = {};             // cityKey -> Open-Meteo payload
  let ticker = null;

  const $  = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* ---------- trip phase ---------- */
  function phase() {
    const now = Date.now();
    const dep = new Date(D.meta.departureISO).getTime();
    const end = new Date('2026-09-09T00:00:00-05:00').getTime();
    return now < dep ? 'pre' : now < end ? 'live' : 'post';
  }

  /** The day we're currently living in, using that day's own timezone. */
  function currentDay() {
    for (const day of D.days) {
      const tz = D.cities[day.cityKey].tz;
      if (T.tripDateIn(tz) === day.date) return day;
    }
    // outside the window — clamp
    const p = phase();
    return p === 'pre' ? D.days[0] : D.days[D.days.length - 1];
  }

  const cityTzOf = day => D.cities[day.cityKey].tz;
  const minutesFor = day => T.tripMinutesIn(cityTzOf(day));

  /* ---------- accent colour ---------- */
  function setAccent(cityKey) {
    const c = cityKey && D.cities[cityKey];
    document.documentElement.style.setProperty('--c', c ? c.color : '#F2C14E');
  }

  /* ---------- weather ---------- */
  async function ensureWx(cityKey) {
    if (wxCache[cityKey] !== undefined) return wxCache[cityKey];
    const data = await WX.fetchCity(D.cities[cityKey]);
    wxCache[cityKey] = data;
    return data;
  }

  /* ══════════════ ROUTER ══════════════ */
  async function go(next, opts = {}) {
    tab = next;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === next));
    const view = $('#view');
    const who = Store.getWho();
    const p = phase();
    const day = currentDay();

    /* accent follows context */
    if (['vienna','copenhagen','amsterdam','london'].includes(next)) setAccent(next);
    else if (p !== 'pre') setAccent(day.cityKey);
    else setAccent(null);

    switch (next) {
      case 'today': {
        if (p === 'pre') { view.innerHTML = R.home(D, who); startCountdown(); }
        else {
          const wx = await ensureWx(day.cityKey);
          view.innerHTML = R.today(D, who, day, minutesFor(day), wx);
          if (p === 'post') view.insertAdjacentHTML('afterbegin',
            `<div class="note-box">🏠 <b>That's the trip.</b> 14 days, 4 cities, one Black Keys show. Everything below stays here for the memories.</div>`);
        }
        break;
      }
      case 'trip':
        view.innerHTML = R.fullTrip(D, p === 'pre' ? null : day.date);
        break;
      case 'vienna': case 'copenhagen': case 'amsterdam': case 'london': {
        view.innerHTML = R.city(D, next, wxCache[next] ?? null);
        ensureWx(next).then(w => { if (tab === next) view.innerHTML = R.city(D, next, w); });
        break;
      }
      case 'bookings':   view.innerHTML = R.bookings(D); break;
      case 'money':      view.innerHTML = R.money(D, who); break;
      case 'checklists': view.innerHTML = R.checklists(D); break;
      case 'questions': {
        const sel = qDate ? D.days.find(x => x.date === qDate) : day;
        const target = sel || day;
        const tz = cityTzOf(target);
        const mins = T.tripMinutesIn(tz);
        const todayDate = T.tripDateIn(tz);
        // past days are always unlocked; today unlocks at 8pm local
        const isPast = target.date < todayDate;
        const isToday = target.date === todayDate;
        const unlocked = isPast || (isToday && mins >= D.meta.questionsUnlockHour * 60);
        setAccent(target.cityKey);
        view.innerHTML = R.questions(D, target, unlocked, mins, qDate);
        break;
      }
    }
    if (next !== 'today' || p !== 'pre') stopCountdown();
    if (!opts.keepScroll) window.scrollTo({ top: 0, behavior: 'instant' });
  }

  /* ══════════════ COUNTDOWN ══════════════ */
  function startCountdown() {
    stopCountdown();
    const tick = () => {
      const c = T.countdown(D.meta.departureISO);
      const d = $('#cdD'); if (!d) return stopCountdown();
      if (c.past) { go('today'); return; }
      d.textContent = c.days;
      $('#cdH').textContent = String(c.hours).padStart(2,'0');
      $('#cdM').textContent = String(c.mins).padStart(2,'0');
      $('#cdS').textContent = String(c.secs).padStart(2,'0');
    };
    tick();
    ticker = setInterval(tick, 1000);
  }
  const stopCountdown = () => { if (ticker) { clearInterval(ticker); ticker = null; } };

  /* ══════════════ EVENTS ══════════════ */
  function wire() {
    /* tabs */
    $$('.tab').forEach(t => t.onclick = () => go(t.dataset.tab));

    /* global delegated clicks */
    document.addEventListener('click', e => {
      /* jump-to-tab cards */
      const goEl = e.target.closest('[data-go]');
      if (goEl) { const t = goEl.dataset.go; qDate = null; go(t); return; }

      /* expand/collapse a day */
      const tog = e.target.closest('[data-toggle]');
      if (tog) {
        const item = tog.closest('.day-item');
        item.classList.toggle('open');
        return;
      }

      /* checklist tick */
      const chk = e.target.closest('[data-check]');
      if (chk) {
        Store.toggleCheck(chk.dataset.check);
        go('checklists', { keepScroll: true });
        return;
      }

      /* reset checklists */
      if (e.target.id === 'resetChecks') {
        const ids = [...D.checklists.documents.items, ...D.checklists.packing.items].map(i => i.id);
        Store.resetChecks(ids);
        go('checklists');
        return;
      }

      /* money see-everyone toggle */
      if (e.target.id === 'seeAllBtn') {
        Store.setSeeAll(!Store.getSeeAll());
        go('money', { keepScroll: true });
        return;
      }

      /* trivia reveal */
      const rev = e.target.closest('[data-reveal]');
      if (rev) {
        const el = document.getElementById('ans-' + rev.dataset.reveal);
        if (el) { el.classList.remove('hidden'); rev.remove(); }
        return;
      }

      /* questions day selector */
      const qd = e.target.closest('[data-qday]');
      if (qd) { qDate = qd.dataset.qday; go('questions', { keepScroll: true }); return; }
    });

    /* identity */
    $$('.person-btn').forEach(b => b.onclick = () => {
      Store.setWho(b.dataset.who);
      $('#whoGate').classList.add('hidden');
      paintWho();
      go(phase() === 'pre' ? 'today' : 'today');
      maybeShowInstall();
    });
    $('#switchWho').onclick = () => { $('#whoGate').classList.remove('hidden'); };

    /* install banner */
    $('#ibClose').onclick = () => { $('#installBanner').classList.add('hidden'); Store.dismissInstall(); };
    $('#ftInstall').onclick = () => { $('#installBanner').classList.remove('hidden'); };

    /* notifications */
    $('#notifBtn').onclick = () => Push.enable();

    /* re-render on wake so "now" is never stale */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) go(tab, { keepScroll: true });
    });
  }

  function paintWho() {
    const w = Store.getWho();
    $('#ftWho').textContent = w || '—';
  }

  function maybeShowInstall() {
    const standalone = window.navigator.standalone ||
      window.matchMedia('(display-mode: standalone)').matches;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!standalone && isIOS && !Store.installDismissed())
      setTimeout(() => $('#installBanner').classList.remove('hidden'), 1400);
    if (standalone) $('#notifBtn').classList.remove('hidden');
  }

  /* ══════════════ BOOT ══════════════ */
  async function boot() {
    try {
      const r = await fetch('data/trip.json?v=' + Date.now());
      D = await r.json();
    } catch (e) {
      $('#view').innerHTML = `<div class="empty">Couldn't load the trip data.<br>Check your connection and pull to refresh.</div>`;
      return;
    }
    window.__TRIP = D;   // handy for debugging from Safari console
    $('#ftVersion').textContent = `EUROTRIP 2026 · data v${D.meta.dataVersion}`;

    wire();
    paintWho();

    if (!Store.getWho()) $('#whoGate').classList.remove('hidden');
    else { maybeShowInstall(); }

    await go('today');
    Push.init();

    /* roll the day over automatically while the app sits open */
    setInterval(() => {
      if (phase() !== 'pre' && (tab === 'today' || tab === 'questions')) go(tab, { keepScroll: true });
    }, 60000);
  }

  return { boot, go, phase, currentDay, get data() { return D; } };
})();

document.addEventListener('DOMContentLoaded', App.boot);
