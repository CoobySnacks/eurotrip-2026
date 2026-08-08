/* ══════════════════════════════════════════════════════════
   render.js — every view. Pure functions: data in, HTML out.
   Nothing here touches the network except via WX.
   ══════════════════════════════════════════════════════════ */

const R = (() => {

  /* ---------- helpers ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  const cityOf = (d, day) => d.cities[day.cityKey];

  /** Apple Maps deep link — opens the native Maps app on iPhone. */
  function mapsUrl(v) {
    const q = encodeURIComponent(v.name);
    const a = encodeURIComponent(v.address || '');
    return `https://maps.apple.com/?q=${q}${a ? '&address=' + a : ''}`;
  }

  /** The full link treatment for a venue. */
  function venueLinks(D, key) {
    const v = D.venues[key];
    if (!v) return '';
    const L = [];
    L.push(`<a class="lnk lnk-maps" href="${mapsUrl(v)}">📍 Maps</a>`);
    if (v.menu)      L.push(`<a class="lnk lnk-menu" href="${esc(v.menu)}" target="_blank" rel="noopener">🍽 Menu</a>`);
    if (v.instagram) L.push(`<a class="lnk lnk-ig" href="${esc(v.instagram)}" target="_blank" rel="noopener">📸 ${esc(v.igHandle || 'Instagram')}</a>`);
    if (v.website && v.website !== v.menu)
      L.push(`<a class="lnk lnk-web" href="${esc(v.website)}" target="_blank" rel="noopener">🌐 Site</a>`);
    if (v.phone)     L.push(`<a class="lnk lnk-tel" href="tel:${esc(v.phone.replace(/\s/g,''))}">📞 Call</a>`);
    return `<div class="links">${L.join('')}</div>`;
  }

  function venueAddress(D, key) {
    const v = D.venues[key];
    return v?.address ? `<div class="blk-desc" style="color:var(--tx-3);font-size:11.5px">${esc(v.address)}</div>` : '';
  }

  /* ---------- itinerary block ---------- */
  function blockHTML(D, b, opts = {}) {
    const cls = ['blk'];
    if (b.highlight) cls.push('highlight');
    if (b.critical)  cls.push('critical');

    let h = `<div class="${cls.join(' ')}">`;
    h += `<div class="blk-time${opts.dim ? ' dim' : ''}">${T.fmtShort(b.time)}</div>`;
    h += `<div class="blk-body">`;
    h += `<div class="blk-title">${esc(b.title)}</div>`;
    if (b.venue) h += venueAddress(D, b.venue);
    if (b.desc)  h += `<div class="blk-desc">${esc(b.desc)}</div>`;
    if (b.note)  h += `<div class="blk-desc" style="font-style:italic">${esc(b.note)}</div>`;

    /* sub-stops (e.g. Vienna's "The Loop") */
    if (b.subStops?.length) {
      h += `<div style="margin-top:9px">`;
      b.subStops.forEach(s => {
        h += `<div style="padding:8px 0;border-top:1px solid var(--line)">`;
        h += `<div style="font-size:13px;font-weight:700">${esc(s.name)}</div>`;
        if (s.note) h += `<div class="blk-desc" style="margin-top:2px">${esc(s.note)}</div>`;
        if (s.venue) h += venueLinks(D, s.venue);
        /* Verde and Demel only exist as sub-stops of Saturday's Loop, so
           without this their order cards — and Verde's shrimp warning —
           would never render anywhere. */
        if (s.venue) h += orderCardHTML(D.venues[s.venue]?.orderCard);
        h += `</div>`;
      });
      h += `</div>`;
    }

    /* reservation */
    if (b.res) {
      h += `<div class="res"><div class="res-l">✅ Booked</div>`;
      if (b.res.conf && b.res.conf !== 'CONFIRMED')
        h += `<div>Conf <span class="res-conf">${esc(b.res.conf)}</span></div>`;
      else h += `<div><span class="res-conf">CONFIRMED</span></div>`;
      const bits = [];
      if (b.res.time)  bits.push(T.fmt12(b.res.time));
      if (b.res.party) bits.push(`party of ${b.res.party}`);
      if (bits.length) h += `<div>${esc(bits.join(' · '))}</div>`;
      if (b.res.note)  h += `<div style="color:var(--tx-2);margin-top:2px">${esc(b.res.note)}</div>`;
      h += `</div>`;
    }
    if (b.conf && !b.res)
      h += `<div class="res"><div class="res-l">✅ Confirmation</div><span class="res-conf">${esc(b.conf)}</span></div>`;

    /* warnings */
    if (b.warn) {
      const red = b.critical || /closed|not confirmed|🔴|do not|scam/i.test(b.warn);
      h += `<div class="warn${red ? ' red' : ''}"><span class="warn-i">${red ? '🔴' : '⚠️'}</span><span>${esc(b.warn)}</span></div>`;
    }

    /* weather-driven rain flag on outdoor blocks */
    if (opts.rainNote && (b.outdoor || b.rainCheck))
      h += `<div class="rain-flag">☔️ <span>${esc(opts.rainNote)} — this one's outdoors.</span></div>`;

    if (b.venue) h += venueLinks(D, b.venue);

    /* "what to order" — block-level wins, else fall back to the venue's own
       card so backups and suggestions get one too */
    h += orderCardHTML(b.orderCard || (b.venue && D.venues[b.venue]?.orderCard));

    /* suggestions */
    if (b.suggestions?.length) {
      h += `<div class="sug"><div class="sug-l">💡 Options & backups</div>`;
      b.suggestions.forEach(s => {
        h += `<div class="sug-item"><div class="sug-t">${esc(s.title)}</div>`;
        if (s.desc) h += `<div class="sug-d">${esc(s.desc)}</div>`;
        if (s.venue) h += venueLinks(D, s.venue);
        /* backups deserve an order card too — Grøften and Madklubben have one */
        if (s.venue) h += orderCardHTML(D.venues[s.venue]?.orderCard);
        h += `</div>`;
      });
      h += `</div>`;
    }

    h += `</div></div>`;
    return h;
  }

  const sortedBlocks = day => [...day.blocks].sort((a, b) => T.blockKey(a.time) - T.blockKey(b.time));

  /** Big tap-through button pinned to the top of a day (e.g. Concert Night). */
  function pinnedLink(day) {
    const p = day.pinnedLink;
    if (!p) return '';
    return `<a class="pinned-link" data-go="${esc(p.tab)}">
      <div class="pl-label">${esc(p.label)}</div>
      ${p.sub ? `<div class="pl-sub">${esc(p.sub)}</div>` : ''}
    </a>`;
  }

  /**
   * Collapsible "what to order". Native <details> — no JS, works offline,
   * which matters because this gets read at a table with bad signal.
   */
  function orderCardHTML(o) {
    if (!o) return '';
    let h = `<details class="order-card"><summary class="oc-sum">${esc(o.title || '🍽 What to order')}</summary>`;
    if (o.intro) h += `<div class="oc-intro">${esc(o.intro)}</div>`;
    (o.sections || []).forEach(s => {
      h += `<div class="oc-sec">${esc(s.label)}</div>`;
      s.items.forEach(i => {
        h += `<div class="oc-item${i.must ? ' must' : ''}">
          <div class="oc-head"><span class="oc-name">${esc(i.name)}</span>${i.price ? `<span class="oc-price">${esc(i.price)}</span>` : ''}</div>
          ${i.desc ? `<div class="oc-desc">${esc(i.desc)}</div>` : ''}
        </div>`;
      });
    });
    if (o.suggested) h += `<div class="oc-sugg"><div class="oc-sugg-l">A sensible order for three</div>${esc(o.suggested)}</div>`;
    if (o.skip) h += `<div class="oc-skip"><b>Skip:</b> ${esc(o.skip)}</div>`;
    /* allergy warnings are load-bearing — Coob's shrimp allergy */
    if (o.allergy) h += `<div class="oc-allergy">🦐 <span>${esc(o.allergy)}</span></div>`;
    if (o.warn) h += `<div class="warn red" style="margin:9px 13px"><span>⚠️</span><span>${esc(o.warn)}</span></div>`;
    if (o.footer) h += `<div class="oc-foot">${esc(o.footer)}</div>`;
    return h + `</details>`;
  }

  /* ---------- one-line day summary ---------- */
  function daySummary(day) {
    const meals = day.blocks
      .filter(b => ['meal','drinks','club','tour','activity'].includes(b.type))
      .map(b => b.title.replace(/^(Dinner|Lunch|Brunch|Breakfast|Drinks|Nightcap|Cocktails|Pint)\s*·\s*/i, ''));
    return meals.slice(0, 3).join(' · ') || day.subtitle || '';
  }

  /* ══════════════ COUNTDOWN HERO ══════════════ */
  function hero(D) {
    const c = T.countdown(D.meta.departureISO);
    const f = D.flights[0];
    return `
    <div class="crew">
      <img src="assets/crew.jpg" alt="Coob, Grant and Jared" class="crew-img" width="1200" height="1000" loading="eager" decoding="async">
      <div class="crew-cap"><span>Coob · Grant · Jared</span><span class="crew-tag">4 cities · 14 days</span></div>
    </div>
    <div class="hero">
      <div class="hero-kicker">Wheels up in</div>
      <div class="cd" id="cd">
        <div class="cd-unit"><div class="cd-n" id="cdD">${c.days}</div><div class="cd-l">days</div></div>
        <div class="cd-unit"><div class="cd-n" id="cdH">${String(c.hours).padStart(2,'0')}</div><div class="cd-l">hrs</div></div>
        <div class="cd-unit"><div class="cd-n" id="cdM">${String(c.mins).padStart(2,'0')}</div><div class="cd-l">min</div></div>
        <div class="cd-unit"><div class="cd-n" id="cdS">${String(c.secs).padStart(2,'0')}</div><div class="cd-l">sec</div></div>
      </div>
      <div class="hero-sub">Departing <b>Wed Aug 26, 7:40 PM</b> — Dallas time</div>
      <div class="hero-flight">
        <span class="hf-code">${esc(f.code)}</span>
        <span>${esc(f.from)}</span><span class="hf-arrow">✈</span><span>${esc(f.to)}</span>
        <span style="color:var(--tx-3)">${esc(f.aircraft || '')}</span>
      </div>
    </div>`;
  }

  /* ══════════════ STATUS STRIP ══════════════ */
  function statusStrip(D, who, live) {
    const docIds  = D.checklists.documents.items.map(i => i.id);
    const packIds = D.checklists.packing.items.map(i => i.id);
    const dp = Store.progress(docIds);
    const pp = Store.progress(packIds);

    /* documents — call out the UK ETA specifically, it's the one that bites */
    const etaDone = Store.isChecked('uk-eta');
    let docV, docCls, docSub;
    if (!etaDone) { docV = `<span class="ss-v red">UK ETA</span>`; docCls = 'alert'; docSub = 'NOT DONE'; }
    else if (dp.done < dp.total) { docV = `<span class="ss-v amber">${dp.done}/${dp.total}</span>`; docCls = ''; docSub = 'docs done'; }
    else { docV = `<span class="ss-v green">All set</span>`; docCls = 'ok'; docSub = 'documents ✓'; }

    /* money — `who` is null until identity is picked, so guard it */
    const p = who ? D.money.people[who] : null;
    let moneyV, moneySub;
    if (!p) {
      moneyV = `<span class="ss-v">—</span>`;
      moneySub = 'pick who you are';
    } else if (who === 'Coob') {
      moneyV = `<span class="ss-v green">Organizer</span>`;
      moneySub = 'see full ledger';
    } else {
      moneyV = `<span class="ss-v green">R1 ✓</span>`;
      moneySub = `R2 ~$${p.round2.estimateLow.toLocaleString()}`;
    }

    let h = `<div class="status-strip">`;
    h += `<div class="ss-item ${docCls}" data-go="checklists"><div class="ss-l">Documents</div>${docV}<div class="ss-sub">${docSub}</div></div>`;
    /* packing collapses away once the trip starts */
    if (!live) {
      const pCls = pp.done === pp.total ? 'ok' : '';
      const pCol = pp.done === pp.total ? 'green' : (pp.done === 0 ? 'red' : 'amber');
      h += `<div class="ss-item ${pCls}" data-go="checklists"><div class="ss-l">Packing</div><span class="ss-v ${pCol}">${pp.done} / ${pp.total}</span><div class="ss-sub">packed</div></div>`;
    } else {
      h += `<div class="ss-item" data-go="questions"><div class="ss-l">Tonight</div><span class="ss-v">8 PM</span><div class="ss-sub">questions</div></div>`;
    }
    h += `<div class="ss-item" data-go="money"><div class="ss-l">Money</div>${moneyV}<div class="ss-sub">${moneySub}</div></div>`;
    h += `</div>`;
    return h;
  }

  /* ══════════════ TRIP AT A GLANCE ══════════════ */
  function glance(D) {
    let h = `<div class="card glance"><div class="glance-head">
      <div class="glance-big">4 cities · 14 days</div>
      <div class="glance-dates">Aug 26 – Sep 8</div></div>`;
    ['vienna','copenhagen','amsterdam','london'].forEach(k => {
      const c = D.cities[k];
      h += `<div class="city-row" data-go="${k}">
        <div class="cr-bar" style="background:${c.color}"></div>
        <div class="cr-body">
          <div class="cr-name">${c.flag} ${esc(c.name)}</div>
          <div class="cr-dates">${esc(c.dates)}</div>
          <div class="cr-sum">${esc(c.summary)}</div>
        </div>
        <div class="cr-chev">›</div>
      </div>`;
    });
    h += `</div>`;
    return h;
  }

  /* ══════════════ COLLAPSED DAY LIST ══════════════ */
  function dayList(D, days, openDate) {
    let h = '';
    days.forEach(day => {
      const c = cityOf(D, day);
      const open = day.date === openDate;
      h += `<div class="day-item${open ? ' open' : ''}" data-day="${day.date}">
        <div class="day-head" data-toggle="${day.date}">
          <div class="dh-date"><div class="dh-dow">${T.dowShort(day.date)}</div><div class="dh-day">${T.dayNum(day.date)}</div></div>
          <div class="dh-body">
            <div class="dh-title"><span class="dh-city" style="background:${c.color}"></span>${esc(day.title)}</div>
            <div class="dh-sub">${esc(daySummary(day))}</div>
          </div>
          <div class="dh-chev">▶</div>
        </div>
        <div class="day-body">${pinnedLink(day)}${sortedBlocks(day).map(b => blockHTML(D, b)).join('')}</div>
      </div>`;
    });
    return h;
  }

  /* ══════════════ HOME (pre-trip) ══════════════ */
  function home(D, who) {
    let h = hero(D);
    /* Status strip goes BEFORE the countdown note. The note is fun; the strip
       is the accountability nudge that has to be reachable without scrolling,
       and the note is tall enough (115px, 269px on departure morning) to push
       it under the fold if it goes first. */
    h += statusStrip(D, who, false);
    h += countdownNote(D);
    h += glance(D);
    h += `<div class="sec-title">The whole trip — tap any day</div>`;
    h += dayList(D, D.days, null);
    h += docsBanner(D);
    return h;
  }

  /**
   * Today's morning-countdown line, shown on the home screen so the hype
   * still lands for anyone who never turned notifications on.
   */
  function countdownNote(D) {
    const today = T.tripDateIn(D.cities.dallas.tz);
    const m = (D.countdownPushes || []).find(x => x.date === today);
    if (!m) return '';
    const big = m.days === 0;
    return `<div class="cd-note${big ? ' shout' : ''}">
      <div class="cd-note-t">${esc(m.title)}</div>
      <div class="cd-note-b">${m.body.split('\n\n').map(p => esc(p)).join('<br>')}</div>
    </div>`;
  }

  function docsBanner(D) {
    const b = D.reference.docsBanner;
    let h = `<div class="card" style="border-color:rgba(255,77,77,.4);background:rgba(255,77,77,.06);margin-top:16px">
      <div style="font-size:14px;font-weight:850;margin-bottom:9px">${esc(b.title)}</div>`;
    b.items.forEach(i => h += `<div class="blk-desc" style="margin-bottom:6px">• ${esc(i)}</div>`);
    h += `<div class="links"><a class="lnk lnk-menu" href="https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta" target="_blank" rel="noopener">Apply for UK ETA →</a></div></div>`;
    return h;
  }

  /* ══════════════ TODAY (live trip) ══════════════ */
  function today(D, who, day, mins, wxData) {
    const c = cityOf(D, day);
    const blocks = sortedBlocks(day);

    /* current + upcoming */
    let curIdx = -1;
    blocks.forEach((b, i) => { if (T.blockKey(b.time) <= mins) curIdx = i; });
    const cur  = curIdx >= 0 ? blocks[curIdx] : null;
    const next = blocks.slice(curIdx + 1, curIdx + 3);

    const hrs = wxData ? WX.hoursFor(wxData, day.date) : [];
    const rainNote = hrs.length ? WX.rainFlag(hrs) : null;

    let h = pinnedLink(day);
    h += `<div class="today-hdr">
      <div class="th-greet">${esc(greeting(mins))}${who ? ', ' + esc(who) : ''}</div>
      <div class="th-day">${esc(day.title)}</div>
      <div class="th-meta"><span class="th-city-dot"></span>${T.longDate(day.date)} · ${esc(c.name)} local time</div>
    </div>`;

    /* transition day — show both cities */
    if (day.transitionFrom) {
      const from = D.cities[day.transitionFrom];
      h += `<div class="note-box">✈️ <b>Transition day.</b> ${esc(from.flag)} ${esc(from.name)} → ${esc(c.flag)} ${esc(c.name)}. Times below are <b>${esc(c.name)}</b> local unless noted.</div>`;
    }

    /* in-flight tracker */
    const flightBlock = blocks.find(b => b.type === 'flight' && b.flightRef);
    if (cur && cur.type === 'flight' && cur.flightRef) {
      const f = D.flights.find(x => x.code === cur.flightRef);
      if (f) h += flightTracker(f);
    }

    /* NOW */
    if (cur) {
      h += `<div class="now-card">
        <div class="now-l"><span class="pulse"></span>Now</div>
        <div class="now-time">${T.fmt12(cur.time)}${cur.endTime ? ' – ' + T.fmt12(cur.endTime) : ''}</div>
        <div class="now-title">${esc(cur.title)}</div>
        ${cur.desc ? `<div class="now-desc">${esc(cur.desc)}</div>` : ''}
      </div>`;
      h += `<div class="card card-tight">${blockHTML(D, cur, { rainNote })}</div>`;
    } else {
      const first = blocks[0];
      h += `<div class="now-card">
        <div class="now-l"><span class="pulse"></span>Today</div>
        <div class="now-title">Nothing scheduled yet</div>
        <div class="now-desc">${first ? 'First thing is ' + esc(first.title) + ' at ' + T.fmt12(first.time) + '.' : 'Free day.'}</div>
      </div>`;
    }

    /* UP NEXT */
    if (next.length) {
      h += `<div class="sec-title">Up next</div><div class="card">`;
      next.forEach(b => {
        const delta = T.blockKey(b.time) - mins;
        const inTxt = delta <= 0 ? 'now' :
          delta < 60 ? `in ${delta} min` :
          `in ${Math.floor(delta/60)}h ${delta%60 ? (delta%60)+'m' : ''}`.trim();
        h += `<div class="next-item">
          <div class="ni-time">${T.fmtShort(b.time)}</div>
          <div class="ni-body">
            <div class="ni-title">${esc(b.title)}</div>
            <div class="ni-in">${esc(inTxt)}${b.leaveBy ? ' · 🚨 LEAVE BY THIS TIME' : ''}</div>
            ${b.warn ? `<div class="blk-desc" style="color:var(--amber)">⚠️ ${esc(b.warn)}</div>` : ''}
          </div></div>`;
      });
      h += `</div>`;
    }

    /* WEATHER */
    h += weatherToday(D, c, day, wxData, hrs, rainNote);

    /* rest of day */
    h += `<div class="sec-title">Rest of today</div><div class="card">`;
    const rest = blocks.slice(curIdx + 1);
    h += rest.length ? rest.map(b => blockHTML(D, b, { rainNote, dim: true })).join('')
                     : `<div class="empty">That's the day. 🍺</div>`;
    h += `</div>`;

    /* status strip stays live (packing collapses) */
    h += statusStrip(D, who, true);

    /* tonight's questions teaser */
    h += `<div class="card" data-go="questions" style="cursor:pointer;border-color:rgba(217,58,58,.4)">
      <div style="font-size:14px;font-weight:800">🍻 Tonight's questions</div>
      <div class="blk-desc">${day.questions.trivia.length} trivia + ${day.questions.discussion.length} about today + the two house rules. Unlocks ${esc(T.fmt12(String(day.unlockHour ?? D.meta.questionsUnlockHour).padStart(2,'0') + ':00'))} ${esc(c.name)} time.</div>
    </div>`;

    return h;
  }

  const greeting = m => m < 11*60 ? 'Morning' : m < 17*60 ? 'Afternoon' : 'Evening';


  function flightTracker(f) {
    return `<div class="fl">
      <div class="fl-top"><span class="fl-code">✈️ ${esc(f.code)}</span><span class="fl-cabin">In the air</span></div>
      <div class="fl-mid">
        <div class="fl-pt"><div class="fl-ap">${esc(f.from)}</div><div class="fl-tm">${T.fmt12(f.depart)}</div><div class="fl-ct">${esc(f.fromCity)}</div></div>
        <div class="fl-plane">✈</div>
        <div class="fl-pt"><div class="fl-ap">${esc(f.to)}</div><div class="fl-tm">${T.fmt12(f.arrive)}</div><div class="fl-ct">${esc(f.toCity)}</div></div>
      </div>
      <div class="fl-note">Conf <b>${esc(f.conf)}</b>${f.aircraft ? ' · ' + esc(f.aircraft) : ''} · <a href="https://www.flightaware.com/live/flight/${esc(f.code.replace(/\s/g,''))}" target="_blank" rel="noopener" style="color:var(--c)">Track live →</a></div>
    </div>`;
  }

  /* ══════════════ WEATHER BLOCKS ══════════════ */
  function weatherToday(D, c, day, data, hrs, rainNote) {
    let h = `<div class="sec-title">Weather · ${esc(c.name)}</div><div class="card">`;
    if (!data) {
      h += `<div class="blk-desc">Couldn't reach the weather service. Seasonal average: ${esc(c.seasonal)}</div></div>`;
      return h;
    }
    const cur = data.current;
    const dd  = WX.dayFor(data, day.date);
    if (cur) {
      h += `<div class="wx-now">
        <div class="wx-now-i">${WX.icon(cur.weather_code)}</div>
        <div><div class="wx-now-t">${Math.round(cur.temperature_2m)}°F</div>
        <div class="wx-now-d">${esc(WX.label(cur.weather_code))} · feels ${Math.round(cur.apparent_temperature)}° · wind ${Math.round(cur.wind_speed_10m)} mph</div></div>
      </div>`;
    }
    if (hrs.length) h += `<div class="wx-strip">${hrs.map(x => `
      <div class="wx-h${x.pop > 50 ? ' rainy' : ''}">
        <div class="wx-t">${T.fmtShort(x.time)}</div>
        <div class="wx-i">${WX.icon(x.code)}</div>
        <div class="wx-deg">${x.temp}°</div>
        <div class="wx-pop">${x.pop > 15 ? x.pop + '%' : ''}</div>
      </div>`).join('')}</div>`;
    else h += `<div class="wx-note">Hourly detail for ${T.prettyDate(day.date)} isn't in the forecast yet — it only reaches ~16 days out. Seasonal average: ${esc(c.seasonal)}</div>`;
    if (rainNote) h += `<div class="rain-flag">${esc(rainNote)}</div>`;
    if (dd?.sunset) h += `<div class="wx-note">🌅 Sunrise ${T.fmt12(dd.sunrise)} · 🌇 Sunset ${T.fmt12(dd.sunset)}</div>`;

    const out = WX.outlook(data, day.date, 3);
    if (out.length > 1) {
      h += `<div class="wx-3d">${out.map((d, i) => `
        <div class="wx-d"><div class="wx-d-n">${i === 0 ? 'Today' : T.dowShort(d.date)}</div>
        <div class="wx-d-i">${WX.icon(d.code)}</div>
        <div class="wx-d-t">${d.max}° <span>${d.min}°</span></div>
        ${d.popMax > 30 ? `<div class="wx-pop">${d.popMax}%</div>` : ''}</div>`).join('')}</div>`;
    }
    h += `</div>`;
    return h;
  }

  /* ══════════════ CITY TAB ══════════════ */
  function city(D, key, wxData) {
    const c = D.cities[key];
    const days = D.days.filter(d => d.cityKey === key);

    let h = `<div class="city-hero">
      <div class="ch-flag">${c.flag}</div>
      <div class="ch-name">${esc(c.name)}</div>
      <div class="ch-dates">${esc(c.dates)}</div>
      <div class="ch-sum">${esc(c.summary)}</div>
      <div class="ch-cur">💱 ${esc(c.currency)} · 🕐 ${esc(c.tz.split('/')[1].replace('_',' '))} time</div>
    </div>`;

    /* hotel */
    const hotel = D.hotels.find(x => x.cityKey === key);
    if (hotel) {
      h += `<div class="sec-title">Where we're staying</div>`;
      h += `<div class="card"><div class="blk-title">🏨 ${esc(hotel.name)}</div>`;
      h += venueAddress(D, hotel.venue);
      h += `<div class="blk-desc">${T.prettyDate(hotel.checkIn)} – ${T.prettyDate(hotel.checkOut)} · ${hotel.nights} nights · ${esc(hotel.rooms)}</div>`;
      h += `<div class="res"><div class="res-l">✅ Confirmation</div><span class="res-conf">${esc(hotel.conf)}</span></div>`;
      if (hotel.note) h += `<div class="blk-desc" style="margin-top:7px">${esc(hotel.note)}</div>`;
      h += venueLinks(D, hotel.venue);
      h += `</div>`;
    }

    /* weather */
    h += weatherCity(D, c, days, wxData);

    /* days */
    h += `<div class="sec-title">Day by day</div>`;
    h += dayList(D, days, null);

    /* every venue in this city */
    const vks = Object.keys(D.venues).filter(k => D.venues[k].city === c.name);
    h += `<div class="sec-title">Every spot in ${esc(c.name)} (${vks.length})</div><div class="card">`;
    vks.forEach(k => {
      const v = D.venues[k];
      h += `<div style="padding:12px 0;border-bottom:1px solid var(--line)">
        <div class="blk-title">${esc(v.name)}${v.closed ? ' <span class="chip tobook">CLOSED</span>' : ''}</div>
        <div class="blk-desc" style="color:var(--tx-3);font-size:11.5px">${esc(v.address || '')}</div>
        ${v.note ? `<div class="blk-desc">${esc(v.note)}</div>` : ''}
        ${venueLinks(D, k)}</div>`;
    });
    h += `</div>`;
    return h;
  }

  function weatherCity(D, c, days, data) {
    let h = `<div class="sec-title">Weather</div><div class="card">`;
    if (!data) {
      h += `<div class="blk-desc">Offline — seasonal average: ${esc(c.seasonal)}</div></div>`;
      return h;
    }
    if (data.current) {
      h += `<div class="wx-now">
        <div class="wx-now-i">${WX.icon(data.current.weather_code)}</div>
        <div><div class="wx-now-t">${Math.round(data.current.temperature_2m)}°F</div>
        <div class="wx-now-d">Right now in ${esc(c.name)} · ${esc(WX.label(data.current.weather_code))}</div></div></div>`;
    }
    const ours = days.map(d => WX.dayFor(data, d.date)).filter(Boolean);
    if (ours.length) {
      h += `<div class="wx-3d" style="grid-template-columns:repeat(${Math.min(ours.length,4)},1fr)">${ours.map(d => `
        <div class="wx-d"><div class="wx-d-n">${T.dowShort(d.date)} ${T.dayNum(d.date)}</div>
        <div class="wx-d-i">${WX.icon(d.code)}</div>
        <div class="wx-d-t">${d.max}° <span>${d.min}°</span></div>
        ${d.popMax > 30 ? `<div class="wx-pop">${d.popMax}%</div>` : ''}</div>`).join('')}</div>`;
      const wet = ours.filter(d => d.popMax > 50);
      if (wet.length) h += `<div class="rain-flag">☔️ Rain likely on ${wet.map(d => T.dowShort(d.date)).join(', ')} — pack the jacket.</div>`;
    } else {
      h += `<div class="wx-note">Our dates are outside the 16-day forecast window. Seasonal average: ${esc(c.seasonal)}</div>`;
    }
    h += `</div>`;
    return h;
  }

  /* ══════════════ FULL TRIP ══════════════ */
  function fullTrip(D, todayDate) {
    let h = `<div class="sec-title">The whole thing — tap any day</div>`;
    h += dayList(D, D.days, todayDate);
    return h;
  }

  /* ══════════════ BOOKINGS ══════════════ */
  function bookings(D) {
    let h = `<div class="sec-title">✈️ Flights</div>`;
    D.flights.forEach(f => {
      h += `<div class="fl">
        <div class="fl-top"><span class="fl-code">${esc(f.code)}</span><span class="fl-cabin">${esc(f.cabin || '')}</span></div>
        <div class="fl-mid">
          <div class="fl-pt"><div class="fl-ap">${esc(f.from)}</div><div class="fl-tm">${T.fmt12(f.depart)}</div><div class="fl-ct">${esc(f.fromCity)}</div></div>
          <div class="fl-plane">✈</div>
          <div class="fl-pt"><div class="fl-ap">${esc(f.to)}</div><div class="fl-tm">${T.fmt12(f.arrive)}${f.arriveNextDay ? '<sup>+1</sup>' : ''}</div><div class="fl-ct">${esc(f.toCity)}</div></div>
        </div>
        <div class="fl-note">${T.longDate(f.date)} · Conf <b>${esc(f.conf)}</b>${f.aircraft ? ' · ' + esc(f.aircraft) : ''}${f.operatedBy ? ' · op. ' + esc(f.operatedBy) : ''}
        ${f.note ? '<br>' + esc(f.note) : ''}</div>
      </div>`;
    });

    h += `<div class="sec-title">🏨 Hotels</div>`;
    D.hotels.forEach(x => {
      const c = D.cities[x.cityKey];
      const v = D.venues[x.venue];
      h += `<div class="bk">
        <div class="bk-h"><div><div class="bk-t">${esc(x.name)}</div>
        <div class="bk-d">${c.flag} ${esc(c.name)} · ${T.prettyDate(x.checkIn)} – ${T.prettyDate(x.checkOut)} · ${x.nights} nights</div></div></div>
        <div class="bk-row"><span class="bk-k">Confirmation</span><span class="bk-v mono">${esc(x.conf)}</span></div>
        <div class="bk-row"><span class="bk-k">Rooms</span><span class="bk-v">${esc(x.rooms)}</span></div>
        <div class="bk-row"><span class="bk-k">Address</span><span class="bk-v">${esc(v?.address || '')}</span></div>
        ${x.note ? `<div class="blk-desc" style="margin-top:8px">${esc(x.note)}</div>` : ''}
        ${venueLinks(D, x.venue)}
      </div>`;
    });

    h += `<div class="sec-title">🚐 Ground transfers</div>`;
    const chip = s => ({ paid:'<span class="chip paid">✅ paid</span>',
                         inprogress:'<span class="chip inprogress">🟡 in progress</span>',
                         tobook:'<span class="chip tobook">🔴 to book</span>',
                         confirmed:'<span class="chip paid">✅ confirmed</span>' }[s] || '');
    D.transfers.forEach(t => {
      h += `<div class="bk">
        <div class="bk-h"><div><div class="bk-t">${esc(t.label)} ${chip(t.status)}</div>
        <div class="bk-d">${esc(t.cost)}</div></div></div>`;
      t.legs.forEach(l => {
        h += `<div class="bk-row"><span class="bk-k">${esc(l.when)}</span><span class="bk-v">${esc(l.detail)}${l.conf ? `<br><span class="mono" style="color:var(--green)">${esc(l.conf)}</span>` : ''}</span></div>`;
      });
      if (t.phone) h += `<div class="bk-row"><span class="bk-k">Phone</span><span class="bk-v"><a href="tel:${esc(t.phone.replace(/\s/g,''))}" style="color:var(--c)">${esc(t.phone)}</a></span></div>`;
      if (t.email) h += `<div class="bk-row"><span class="bk-k">Email</span><span class="bk-v"><a href="mailto:${esc(t.email)}" style="color:var(--c)">${esc(t.email)}</a></span></div>`;
      if (t.contact) h += `<div class="bk-row"><span class="bk-k">Contact</span><span class="bk-v">${esc(t.contact)}</span></div>`;
      if (t.note) h += `<div class="blk-desc" style="margin-top:8px">${esc(t.note)}</div>`;
      h += `</div>`;
    });

    /* every reservation pulled out of the itinerary */
    h += `<div class="sec-title">🍽 Reservations</div>`;
    D.days.forEach(day => {
      sortedBlocks(day).filter(b => b.res).forEach(b => {
        const v = b.venue ? D.venues[b.venue] : null;
        h += `<div class="bk">
          <div class="bk-h"><div><div class="bk-t">${esc(b.title.replace(/^[^·]+·\s*/, ''))}</div>
          <div class="bk-d">${T.dowShort(day.date)} ${T.prettyDate(day.date)} · ${T.fmt12(b.res.time || b.time)}</div></div></div>
          <div class="bk-row"><span class="bk-k">Confirmation</span><span class="bk-v mono">${esc(b.res.conf)}</span></div>
          <div class="bk-row"><span class="bk-k">Party</span><span class="bk-v">${b.res.party || 3}</span></div>
          ${v ? `<div class="bk-row"><span class="bk-k">Address</span><span class="bk-v">${esc(v.address)}</span></div>` : ''}
          ${v?.phone ? `<div class="bk-row"><span class="bk-k">Phone</span><span class="bk-v"><a href="tel:${esc(v.phone.replace(/\s/g,''))}" style="color:var(--c)">${esc(v.phone)}</a></span></div>` : ''}
          ${b.res.note ? `<div class="blk-desc" style="margin-top:8px">${esc(b.res.note)}</div>` : ''}
          ${b.venue ? venueLinks(D, b.venue) : ''}
        </div>`;
      });
    });

    /* currency */
    /* the Sixt cancellations are an outstanding action, not trivia — put them
       right under the transfers they replaced */
    const sx = D.reference.sixtCancellations;
    if (sx) {
      h += `<div class="card" style="border-color:var(--red);background:rgba(255,77,77,.07)">
        <div class="bk-t" style="color:#FF8A8A">${esc(sx.title)}</div>
        <div class="blk-desc" style="margin-top:6px">${esc(sx.why)}</div>
        <div class="links" style="margin-top:10px">${
          sx.orders.map(o => `<span class="lnk" style="border-color:rgba(255,77,77,.4);color:#FFC2C2">${esc(o)}</span>`).join('')
        }</div></div>`;
    }

    const cur = D.reference.currency;
    h += `<div class="sec-title">💱 ${esc(cur.title)}</div><div class="card">`;
    cur.rows.forEach(r => h += `<div class="bk-row"><span class="bk-k">${esc(r.place)}</span><span class="bk-v">${esc(r.detail)}</span></div>`);
    h += `<div style="margin-top:11px">`;
    cur.rules.forEach(r => h += `<div class="blk-desc" style="margin-bottom:6px">• ${esc(r)}</div>`);
    h += `</div></div>`;
    return h;
  }

  /* ══════════════ MONEY ══════════════ */
  function money(D, who) {
    const M = D.money;
    const seeAll = Store.getSeeAll();

    let h = `<div class="money-hero">
      <div class="mh settled"><div class="mh-l">Round 1</div><div class="mh-v green">SETTLED ✓</div><div class="mh-n">${esc(M.summary.round1.note)}</div></div>
      <div class="mh coming"><div class="mh-l">Round 2</div><div class="mh-v amber">Late August</div><div class="mh-n">Estimates below</div></div>
    </div>`;

    /* The Sixt-void note is gone now that every leg is booked and priced.
       Kept optional so a future edit can put a warning back without JS. */
    if (M.voidNote) h += `<div class="void-note">⚠️ ${esc(M.voidNote)}</div>`;

    if (M.transferSummary) {
      const t = M.transferSummary;
      h += `<div class="card" style="border-color:rgba(53,199,127,.45);background:rgba(53,199,127,.07)">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">
          <div class="bk-t" style="color:var(--green)">✅ ${esc(t.title)}</div>
          <div class="li-a" style="color:var(--green);font-size:17px">${esc(t.perPerson)} pp</div>
        </div>
        <div class="blk-desc" style="margin-top:6px">${esc(t.detail)}</div>
      </div>`;
    }

    h += `<div class="toggle-row"><button class="toggle-btn${seeAll ? ' on' : ''}" id="seeAllBtn">${seeAll ? '👥 Showing everyone' : '👤 Just me'}</button></div>`;

    const people = seeAll ? ['Jared','Grant'] : (who === 'Coob' ? ['Jared','Grant'] : [who]);

    if (who === 'Coob' && !seeAll)
      h += `<div class="note-box">You're the organizer — this is what <b>Jared</b> and <b>Grant</b> owe. Your own outlay is the sum of the bookings you fronted.</div>`;

    people.forEach(name => {
      const p = M.people[name];
      if (!p || !p.round1.requested) return;

      h += `<div class="sec-title">${esc(name)} — Round 1 <span style="color:var(--green)">✓ paid</span></div><div class="card">`;
      p.round1.items.forEach(i => {
        h += `<div class="li"><div class="li-l">${esc(i.label)}</div><div class="li-a">$${i.amount.toLocaleString(undefined,{minimumFractionDigits:2})}</div></div>`;
      });
      h += `<div class="li-total"><span>Requested</span><span>$${p.round1.requested.toLocaleString(undefined,{minimumFractionDigits:2})}</span></div>`;
      h += `<div class="li"><div class="li-l">Paid via Venmo</div><div class="li-a">$${p.round1.paid.toLocaleString(undefined,{minimumFractionDigits:2})}</div></div>`;
      h += `<div class="li"><div class="li-l">Credit carried forward</div><div class="li-a neg">+$${p.round1.credit.toFixed(2)}</div></div>`;
      h += `</div>`;

      h += `<div class="sec-title">${esc(name)} — Round 2 <span class="chip inprogress">estimate</span></div><div class="card">`;
      p.round2.items.forEach(i => {
        const amt = i.amount !== undefined
          ? `$${Math.abs(i.amount).toLocaleString(undefined,{minimumFractionDigits:2})}`
          : `$${i.amountLow}–${i.amountHigh}`;
        const neg = i.amount !== undefined && i.amount < 0;
        h += `<div class="li"><div class="li-l">${esc(i.label)}
          ${i.status ? `<span class="chip ${i.status}">${esc(i.statusNote || i.status)}</span>` : ''}`;
        if (i.breakdown) {
          h += `<div class="li-sub">${i.breakdown.map(b => `${esc(b.label)} $${b.amount.toFixed(2)}`).join(' · ')}</div>`;
        }
        h += `</div><div class="li-a${neg ? ' neg' : ''}">${neg ? '−' : ''}${amt}</div></div>`;
      });
      h += `<div class="li-total"><span>Estimated total</span><span>$${p.round2.estimateLow.toLocaleString()}–${p.round2.estimateHigh.toLocaleString()}</span></div>`;
      h += `</div>`;
    });

    /* still to come */
    h += `<div class="sec-title">What's still to come</div><div class="card">`;
    M.stillToCome.forEach(s => {
      const c = { paid:'chip paid', inprogress:'chip inprogress', tobook:'chip tobook' }[s.status];
      const t = { paid:'✅ paid by Coob', inprogress:'🟡 booking in progress', tobook:'🔴 not booked yet' }[s.status];
      h += `<div class="li"><div class="li-l">${esc(s.label)} <span class="${c}">${t}</span><div class="li-sub">${esc(s.detail)}</div></div></div>`;
    });
    h += `</div>`;

    /* what the food actually costs — separate from the settle-up ledger */
    const B = D.reference.budget;
    if (B) {
      h += `<div class="sec-title">🍽 ${esc(B.title)}</div>`;
      h += `<details class="order-card"><summary class="oc-sum">Per-person estimates for all 23 meals</summary>`;
      h += `<div class="oc-intro">${esc(B.note)}</div>`;
      let city = null;
      B.rows.forEach(r => {
        if (r.city !== city) { city = r.city; h += `<div class="oc-sec">${esc(city)}</div>`; }
        h += `<div class="oc-item"><div class="oc-head">
          <span class="oc-name">${esc(r.venue)}</span>
          <span class="oc-price">${esc(r.pp)}</span></div>
          ${r.extra ? `<div class="oc-desc">${esc(r.extra)}</div>` : ''}</div>`;
      });
      h += `</details>`;
    }

    h += `<div class="note-box" style="margin-top:14px">🍽 ${esc(M.footer)}</div>`;
    h += `<div class="note-box" style="font-size:11.5px;color:var(--tx-3)">Reference only — no payments happen here. Settle in Venmo like always.</div>`;
    return h;
  }

  /* ══════════════ CHECKLISTS ══════════════ */
  function checklists(D) {
    let h = '';
    ['documents','packing'].forEach(sec => {
      const L = D.checklists[sec];
      const ids = L.items.map(i => i.id);
      const p = Store.progress(ids);
      const col = p.pct === 100 ? 'var(--green)' : p.pct > 40 ? 'var(--amber)' : 'var(--red)';
      const circ = 2 * Math.PI * 26;

      h += `<div class="sec-title">${sec === 'documents' ? '📄' : '🧳'} ${esc(L.title)}</div>`;
      h += `<div class="card"><div class="ring-row">
        <div class="ring"><svg width="62" height="62">
          <circle cx="31" cy="31" r="26" fill="none" stroke="var(--line)" stroke-width="6"/>
          <circle cx="31" cy="31" r="26" fill="none" stroke="${col}" stroke-width="6" stroke-linecap="round"
            stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - p.pct/100)}" style="transition:stroke-dashoffset .4s"/>
        </svg><div class="ring-txt">${p.pct}%</div></div>
        <div class="ring-info"><div class="ring-t">${p.done} of ${p.total}</div>
        <div class="ring-s">${p.done === p.total ? 'All done — nice.' : `${p.total - p.done} left`}</div></div>
      </div>`;

      L.items.forEach(i => {
        const done = Store.isChecked(i.id);
        h += `<div class="chk${i.mandatory ? ' mand' : ''}${done ? ' done' : ''}" data-check="${i.id}">
          <div class="chk-box">${done ? '✓' : ''}</div>
          <div class="chk-body">
            <div class="chk-l">${i.emoji ? i.emoji + ' ' : ''}${esc(i.label)}</div>
            ${i.desc ? `<div class="chk-d">${esc(i.desc)}</div>` : ''}
            ${i.warn ? `<div class="warn red" style="margin-top:6px"><span>🚨</span><span>${esc(i.warn)}</span></div>` : ''}
            ${i.link ? `<div class="links"><a class="lnk lnk-menu" href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.linkLabel || 'Open link')} →</a></div>` : ''}
          </div></div>`;
      });
      h += `</div>`;
    });
    h += `<div style="text-align:center;margin-top:18px"><button class="link-btn" id="resetChecks">reset all checkboxes</button></div>`;
    h += `<div class="note-box" style="margin-top:14px;font-size:11.5px">Checkmarks are saved on <b>this phone only</b>. Everyone tracks their own.</div>`;
    return h;
  }

  /* ══════════════ QUESTIONS ══════════════ */
  function questions(D, day, unlocked, mins, selDate, unlockHour, unlockAt) {
    const uh = unlockHour ?? day.unlockHour ?? D.meta.questionsUnlockHour;
    const uhLabel = T.fmt12(String(uh).padStart(2, '0') + ':00');
    const c = cityOf(D, day);
    let h = `<div class="q-daysel">`;
    D.days.forEach(d => {
      h += `<button class="qd${d.date === day.date ? ' active' : ''}" data-qday="${d.date}">${T.dowShort(d.date)} ${T.dayNum(d.date)}</button>`;
    });
    h += `</div>`;

    h += `<div class="today-hdr"><div class="th-greet">${esc(c.flag)} ${esc(c.name)}</div>
      <div class="th-day" style="font-size:20px">${esc(day.title)}</div>
      <div class="th-meta">${T.longDate(day.date)}</div></div>`;

    if (!unlocked) {
      /* Count down to THIS day's unlock instant, which for a future day is
         days away — not to 8 PM tonight. */
      const ms = unlockAt ? unlockAt.getTime() - Date.now() : (uh * 60 - mins) * 6e4;
      const txt = T.untilText(ms);
      const soon = ms < 864e5;                       // unlocks within 24h
      const when = soon ? `at ${uhLabel}` : `${T.dowLong(day.date)} at ${uhLabel}`;
      h += `<div class="card locked">
        <div class="locked-i">🔒</div>
        <div class="locked-t">Unlocks ${esc(when)}</div>
        <div class="locked-d">${esc(c.name)} local time.<br>Everyone's phone buzzes. Then we play.</div>
        <div class="locked-cd">${esc(txt)}</div>
      </div>`;
      h += `<div class="note-box">Want them now? Tap a past day above — those stay unlocked.</div>`;
      return h;
    }

    h += `<div class="sec-title">🧠 Trivia — ${esc(c.name)}</div>`;
    day.questions.trivia.forEach((q, i) => {
      h += `<div class="q-item"><div class="q-n">Trivia ${i+1}</div>
        <div class="q-t">${esc(q.q)}</div>
        <button class="q-reveal" data-reveal="t${i}">Reveal answer</button>
        <div class="q-a hidden" id="ans-t${i}">${esc(q.a)}</div></div>`;
    });

    h += `<div class="sec-title">💬 About today</div>`;
    day.questions.discussion.forEach((q, i) => {
      h += `<div class="q-item"><div class="q-n">Question ${i+1}</div><div class="q-t">${esc(q)}</div></div>`;
    });

    h += `<div class="house-banner">— house rules —</div>`;
    D.meta.fixedQuestions.forEach((q, i) => {
      h += `<div class="q-item house"><div class="q-n">Every night · ${i+1}</div><div class="q-t">${esc(q)}</div></div>`;
    });

    return h;
  }

  /* ══════════════ CONCERT NIGHT ══════════════
     The one page that gets read at midnight, in a crowd, drunk, with no
     signal. Everything is hardcoded in trip.json — no fetches. Big type,
     one instruction per line, and the section they actually need (getting
     home) is one tap away at all times. */
  function concertNight(D) {
    const C = D.concertNight;
    if (!C) return `<div class="empty">No concert night data.</div>`;

    const alertBox = a => `<div class="cn-alert">
      <div class="cn-alert-t">⚠️ ${esc(a.title)}</div>
      ${a.body.split('\n\n').map(p => `<p>${esc(p)}</p>`).join('')}
    </div>`;

    const lines = arr => arr.map(l => `<div class="cn-line">${esc(l)}</div>`).join('');

    let h = `<a class="cn-jump" href="#getting-home">🌙 GETTING HOME →</a>`;

    h += `<div class="cn-hero">
      <div class="cn-kicker">🎸 ${esc(C.title)}</div>
      <div class="cn-route">${esc(C.route)}</div>
    </div>`;

    h += alertBox(C.topAlert);

    /* timeline */
    h += `<div class="cn-h2">The timeline</div><div class="cn-card cn-timeline">`;
    C.timeline.forEach(t => {
      h += `<div class="cn-tl"><div class="cn-tl-t">${esc(t.time)}</div><div class="cn-tl-w">${esc(t.what)}</div></div>`;
    });
    h += `</div>`;

    /* steps */
    C.steps.forEach(s => {
      h += `<div class="cn-h2"><span class="cn-num">${esc(s.n)}</span> ${esc(s.title)}</div>`;
      if (s.meta) h += `<div class="cn-meta">${esc(s.meta)}</div>`;
      h += `<div class="cn-card">`;
      h += lines(s.lines);
      if (s.alert) h += alertBox(s.alert);
      if (s.linesAfter) h += lines(s.linesAfter);
      if (s.venue) h += venueLinks(D, s.venue);
      if (s.tip) h += `<div class="cn-tip">${esc(s.tip)}</div>`;
      h += `</div>`;
    });

    /* getting home */
    h += `<div class="cn-h2 cn-home-h" id="getting-home">🌙 ${esc(C.home.title)}</div>`;
    h += `<div class="cn-card cn-home">`;
    h += `<div class="cn-headline">${esc(C.home.headline)}</div>`;
    h += `<div class="cn-sub">${esc(C.home.sub)}</div>`;
    h += lines(C.home.lines);
    h += alertBox(C.home.alert);
    h += lines(C.home.linesAfter);
    h += `<div class="cn-tip">${esc(C.home.tip)}</div>`;
    h += `</div>`;

    /* taxi */
    h += `<div class="cn-h2">🚕 ${esc(C.taxi.title)}</div><div class="cn-card">`;
    h += lines(C.taxi.lines);
    h += `<div class="cn-show">Show the driver:<div class="cn-addr">${esc(C.taxi.showDriver)}</div></div>`;
    h += `<div class="cn-alert"><div class="cn-alert-t">⚠️ ${esc(C.taxi.warn)}</div></div>`;
    h += `</div>`;

    /* pre-flight */
    h += `<div class="cn-h2">${esc(C.preflight.title)}</div>`;
    h += `<div class="cn-meta">${esc(C.preflight.meta)}</div><div class="cn-card">`;
    C.preflight.items.forEach(i => h += `<div class="cn-check">☐ ${esc(i)}</div>`);
    h += `</div>`;

    /* separated */
    h += `<div class="cn-h2">🆘 ${esc(C.separated.title)}</div><div class="cn-card cn-sos">`;
    h += C.separated.body.split('\n\n').map(p => `<p class="cn-line">${esc(p)}</p>`).join('');
    h += `</div>`;

    /* phones */
    h += `<div class="cn-phones">`;
    C.phones.forEach(p => {
      h += `<a class="cn-phone" href="tel:${esc(p.number.replace(/\s/g,''))}">
        <span class="cn-phone-l">${esc(p.label)}</span>
        <span class="cn-phone-n">${esc(p.number)}</span></a>`;
    });
    h += `</div>`;
    return h;
  }

  return { esc, home, today, city, fullTrip, bookings, money, checklists,
           questions, concertNight, dayList, blockHTML, venueLinks, mapsUrl,
           sortedBlocks, hero };
})();
