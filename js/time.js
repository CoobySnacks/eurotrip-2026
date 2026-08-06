/* ══════════════════════════════════════════════════════════
   time.js — timezone engine
   Every "what day is it / what are we doing now" decision
   flows through here. Uses Intl so DST is handled by the OS,
   not by us hardcoding +2/+1 offsets.

   KEY RULE: the trip day rolls over at 4 AM local, not midnight.
   That keeps a 12:30 AM club block on the night it belongs to.
   ══════════════════════════════════════════════════════════ */

const T = (() => {

  const ROLLOVER_HOUR = 4;

  /** Date-time parts for `date` as observed in IANA `tz`. */
  function partsIn(tz, date = new Date()) {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p = {};
    for (const { type, value } of f.formatToParts(date)) p[type] = value;
    // en-CA gives hour "24" at midnight in some engines — normalise
    const hour = p.hour === '24' ? '00' : p.hour;
    return {
      y: +p.year, m: +p.month, d: +p.day,
      h: +hour, mi: +p.minute, s: +p.second,
      dateStr: `${p.year}-${p.month}-${p.day}`,
      minutes: (+hour) * 60 + (+p.minute)
    };
  }

  /** 'YYYY-MM-DD' in tz. */
  const dateStrIn = (tz, date) => partsIn(tz, date).dateStr;

  /** Shift a 'YYYY-MM-DD' string by n days (UTC-safe, no tz drift). */
  function shiftDateStr(ds, n) {
    const [y, m, d] = ds.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }

  /**
   * The *trip day* currently in effect for tz — rolls at 4 AM.
   * At 01:30 on Aug 29 in Vienna this still returns '2026-08-28'.
   */
  function tripDateIn(tz, date = new Date()) {
    const p = partsIn(tz, date);
    return p.h < ROLLOVER_HOUR ? shiftDateStr(p.dateStr, -1) : p.dateStr;
  }

  /** Minutes-since-midnight, continuous across the 4 AM rollover (00:30 → 1470). */
  function tripMinutesIn(tz, date = new Date()) {
    const p = partsIn(tz, date);
    return p.h < ROLLOVER_HOUR ? p.minutes + 1440 : p.minutes;
  }

  /** Sort/compare key for a block's "HH:MM" — after-midnight blocks sort last. */
  function blockKey(hhmm) {
    if (!hhmm) return 0;
    const [h, m] = hhmm.split(':').map(Number);
    return h < ROLLOVER_HOUR ? h * 60 + m + 1440 : h * 60 + m;
  }

  /** "19:40" → "7:40 PM" */
  function fmt12(hhmm) {
    if (!hhmm) return '';
    let [h, m] = hhmm.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ap}`;
  }

  /** Short form for tight columns: "7:40p" */
  function fmtShort(hhmm) {
    if (!hhmm) return '';
    let [h, m] = hhmm.split(':').map(Number);
    const ap = h >= 12 ? 'p' : 'a';
    h = h % 12 || 12;
    return m === 0 ? `${h}${ap}` : `${h}:${String(m).padStart(2, '0')}${ap}`;
  }

  /** Breakdown to departure (or any target ISO). */
  function countdown(targetISO, from = new Date()) {
    const diff = new Date(targetISO).getTime() - from.getTime();
    const past = diff <= 0;
    const a = Math.abs(diff);
    return {
      past,
      total: diff,
      days:  Math.floor(a / 864e5),
      hours: Math.floor(a / 36e5) % 24,
      mins:  Math.floor(a / 6e4) % 60,
      secs:  Math.floor(a / 1e3) % 60
    };
  }

  /** "Aug 26" */
  function prettyDate(ds) {
    const [y, m, d] = ds.split('-').map(Number);
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${M[m - 1]} ${d}`;
  }

  /** "Wednesday, August 26" */
  function longDate(ds) {
    const [y, m, d] = ds.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MON = ['January','February','March','April','May','June','July',
                 'August','September','October','November','December'];
    return `${DOW[dt.getUTCDay()]}, ${MON[m - 1]} ${d}`;
  }

  const dayNum = ds => +ds.split('-')[2];
  const dowShort = ds => {
    const [y, m, d] = ds.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getUTCDay()];
  };

  return {
    ROLLOVER_HOUR, partsIn, dateStrIn, shiftDateStr,
    tripDateIn, tripMinutesIn, blockKey,
    fmt12, fmtShort, countdown, prettyDate, longDate, dayNum, dowShort
  };
})();
