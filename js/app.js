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
      case 'concert':
        setAccent('amsterdam');
        view.innerHTML = R.concertNight(D);
        break;
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
        // A day can override the unlock hour — Aug 26 opens at 6 PM because the
        // push fires from the DFW lounge before takeoff, not at 8 PM mid-flight.
        const unlockHour = target.unlockHour ?? D.meta.questionsUnlockHour;
        const unlocked = isPast || (isToday && mins >= unlockHour * 60);
        /* Real instant of THIS day's 8 PM in ITS city — not 8 PM tonight.
           Vienna, Copenhagen and Amsterdam all sit at UTC+2, so using the
           current clock made every future day show an identical countdown. */
        const unlockAt = T.zonedInstant(target.date, unlockHour, tz);
        setAccent(target.cityKey);
        view.innerHTML = R.questions(D, target, unlocked, mins, qDate, unlockHour, unlockAt);
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

    /* identity → then straight into the notification step */
    $$('.person-btn[data-who]').forEach(b => b.onclick = () => {
      Store.setWho(b.dataset.who);
      paintWho();
      showNotifStep();
    });

    $('#switchWho').onclick = () => {
      $('#whoGate').classList.remove('hidden');
      $('#notifStep').classList.add('hidden');
      $('.gate-inner').classList.remove('hidden');
    };

    /* ---- notification step ---- */
    $('#nsEnable').onclick = async () => {
      const btn = $('#nsEnable');
      btn.disabled = true;
      btn.innerHTML = '<span>Working…</span>';
      const res = await Push.enable();

      if (res.ok && res.auto) { finishGate(); return; }

      if (res.ok) {                        // show the code to hand to Coob
        $('#nsActions').classList.add('hidden');
        $('#nsInstall').classList.add('hidden');
        $('#nsCode').classList.remove('hidden');
        $('#nsCodeBox').value = res.code;
        $('#nsTitle').textContent = 'Almost done';
        $('#nsSub').classList.add('hidden');
        return;
      }

      btn.disabled = false;
      btn.innerHTML = '<span class="p-emoji">🔔</span><span>Enable notifications</span>';

      if (res.reason === 'needs-install') {
        $('#nsInstall').classList.remove('hidden');
        $('#nsTitle').textContent = 'Add to Home Screen first';
        $('#nsSub').textContent = "It's an Apple rule, not ours — notifications only work for installed apps.";
        btn.classList.add('hidden');
      } else {
        alert(res.reason);
      }
    };

    $('#nsSkip').onclick = finishGate;

    $('#nsShare').onclick = async () => {
      const r = await Push.shareCode($('#nsCodeBox').value);
      if (r === 'copied') $('#nsShare').innerHTML = '<span>✅ Copied — send it to Coob</span>';
      if (r === 'shared') setTimeout(finishGate, 600);
      if (r === 'manual') $('#nsCodeBox').select();
    };

    $('#nsCopy').onclick = async () => {
      const r = await Push.copyCode($('#nsCodeBox').value);
      $('#nsCopy').textContent = r === 'copied' ? '✅ copied' : 'select the text above and copy';
      if (r !== 'copied') $('#nsCodeBox').select();
      setTimeout(finishGate, 1200);
    };

    /* install banner */
    $('#ibClose').onclick = () => { $('#installBanner').classList.add('hidden'); Store.dismissInstall(); };
    $('#ftInstall').onclick = () => { $('#installBanner').classList.remove('hidden'); };

    /* notifications — reopen the same step from the header bell */
    $('#notifBtn').onclick = () => {
      $('#whoGate').classList.remove('hidden');
      $('.gate-inner').classList.add('hidden');
      $('#notifStep').classList.remove('hidden');
      $('#nsActions').classList.remove('hidden');
      $('#nsCode').classList.add('hidden');
      $('#nsEnable').classList.remove('hidden');
      $('#nsEnable').disabled = false;
      $('#nsEnable').innerHTML = '<span class="p-emoji">🔔</span><span>Enable notifications</span>';
      if (Push.readiness() === 'needs-install') {
        $('#nsInstall').classList.remove('hidden');
        $('#nsEnable').classList.add('hidden');
      }
    };

    /* re-render on wake so "now" is never stale */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) go(tab, { keepScroll: true });
    });

    /* the service worker tells us where a tapped notification wanted to go,
       for the case where the app was already open and never re-booted */
    navigator.serviceWorker?.addEventListener('message', e => {
      if (e.data?.type === 'navigate' && e.data.tab) {
        qDate = null;
        go(e.data.tab);
      }
    });
  }

  function paintWho() {
    const w = Store.getWho();
    $('#ftWho').textContent = w || '—';
  }

  /** Step 2 of the gate: notifications. Skipped entirely if already on. */
  function showNotifStep() {
    const state = Push.readiness();
    const already = state === 'granted' && Store.getPushState();
    if (!Push.supported() || already) { finishGate(); return; }

    $('.gate-inner').classList.add('hidden');          // hide the name picker
    const step = $('#notifStep');
    step.classList.remove('hidden');

    if (state === 'needs-install') {
      $('#nsInstall').classList.remove('hidden');
      $('#nsTitle').textContent = 'Add to Home Screen first';
      $('#nsSub').textContent = "It's an Apple rule, not ours — iPhone only allows notifications for installed apps.";
      $('#nsEnable').classList.add('hidden');
      $('#nsSkip').textContent = 'continue to the site →';
    }
  }

  /** Close the gate and land on the app. */
  function finishGate() {
    $('#whoGate').classList.add('hidden');
    $('#notifStep').classList.add('hidden');
    $('.gate-inner').classList.remove('hidden');
    go('today');
    maybeShowInstall();
  }

  function maybeShowInstall() {
    const standalone = window.navigator.standalone ||
      window.matchMedia('(display-mode: standalone)').matches;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!standalone && isIOS && !Store.installDismissed())
      setTimeout(() => $('#installBanner').classList.remove('hidden'), 1400);
    if (standalone) $('#notifBtn').classList.remove('hidden');
  }

  /**
   * Where to open. Notifications deep-link with ?tab=questions — without this
   * the nightly push lands everyone on the countdown and they have to go
   * hunting for the game.
   *
   * The parameter is stripped afterwards so a later refresh doesn't pin the
   * app to whatever tab a three-day-old notification pointed at.
   */
  const VALID_TABS = ['today','trip','vienna','copenhagen','amsterdam','london',
                      'concert','bookings','money','checklists','questions'];

  function startTab() {
    let want = null;
    try {
      want = new URLSearchParams(location.search).get('tab');
      if (want && location.search) {
        history.replaceState(null, '', location.pathname + location.hash);
      }
    } catch {}
    return VALID_TABS.includes(want) ? want : null;
  }

  /**
   * The tab a tapped notification asked for, left by the service worker.
   *
   * iOS relaunches an installed PWA at its start_url and discards the
   * notification's URL, so ?tab= never survives a cold start — verified on
   * a real phone, twice. The worker writes the target into the Cache API
   * instead, which does survive, and we read it here.
   *
   * Two-minute window: long enough for a slow relaunch, short enough that a
   * notification tapped last night can't hijack this morning's open.
   */
  async function pendingTab() {
    try {
      const c = await caches.open('eurotrip-nav');
      const r = await c.match('/__pending');
      if (!r) return null;
      const { tab, at } = await r.json();
      await c.delete('/__pending');
      if (!at || Date.now() - at > 120000) return null;
      return VALID_TABS.includes(tab) ? tab : null;
    } catch { return null; }
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

    /* a tapped notification wins over the URL, which wins over the default */
    await go((await pendingTab()) || startTab() || 'today');
    Push.init();

    /* roll the day over automatically while the app sits open */
    setInterval(() => {
      if (phase() !== 'pre' && (tab === 'today' || tab === 'questions')) go(tab, { keepScroll: true });
    }, 60000);
  }

  return { boot, go, phase, currentDay, get data() { return D; } };
})();

document.addEventListener('DOMContentLoaded', App.boot);
