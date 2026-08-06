/* ══════════════════════════════════════════════════════════
   weather.js — Open-Meteo (free, no key, no signup)
   Cached 1 hour in localStorage. Fails soft to seasonal
   averages from trip.json so the page never looks broken
   on a plane / in a dead-zone.
   ══════════════════════════════════════════════════════════ */

const WX = (() => {

  /* WMO weather codes → emoji + label */
  const CODES = {
    0:['☀️','Clear'], 1:['🌤','Mostly clear'], 2:['⛅️','Partly cloudy'], 3:['☁️','Overcast'],
    45:['🌫','Fog'], 48:['🌫','Rime fog'],
    51:['🌦','Light drizzle'], 53:['🌦','Drizzle'], 55:['🌦','Heavy drizzle'],
    56:['🌧','Freezing drizzle'], 57:['🌧','Freezing drizzle'],
    61:['🌧','Light rain'], 63:['🌧','Rain'], 65:['🌧','Heavy rain'],
    66:['🌧','Freezing rain'], 67:['🌧','Freezing rain'],
    71:['🌨','Light snow'], 73:['🌨','Snow'], 75:['🌨','Heavy snow'], 77:['🌨','Snow grains'],
    80:['🌦','Light showers'], 81:['🌦','Showers'], 82:['⛈','Violent showers'],
    85:['🌨','Snow showers'], 86:['🌨','Snow showers'],
    95:['⛈','Thunderstorm'], 96:['⛈','Thunderstorm + hail'], 99:['⛈','Thunderstorm + hail']
  };
  const icon  = c => (CODES[c] || ['🌡','—'])[0];
  const label = c => (CODES[c] || ['🌡','—'])[1];

  /** Is `dateStr` inside Open-Meteo's usable forecast window (~16 days)? */
  function inForecastWindow(dateStr) {
    const target = new Date(dateStr + 'T12:00:00Z').getTime();
    const days = (target - Date.now()) / 864e5;
    return days >= -1 && days <= 15;
  }

  /**
   * Fetch forecast for a city. Returns null on failure (caller falls back).
   * @param {object} city  city object from trip.json
   */
  async function fetchCity(city) {
    const cached = Store.getWx(city.key);
    if (cached) return cached;

    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${city.lat}&longitude=${city.lon}`
      + '&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max'
      + '&current=temperature_2m,weather_code,wind_speed_10m,apparent_temperature'
      + '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch'
      + `&timezone=${encodeURIComponent(city.tz)}&forecast_days=16`;

    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch(url, { signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      Store.setWx(city.key, d);
      return d;
    } catch (e) {
      console.warn('[wx] fetch failed for', city.key, e.message);
      return null;
    }
  }

  /**
   * Hourly slice for one calendar date, from 7am to 11pm.
   * @returns {Array<{time,temp,pop,code}>}
   */
  function hoursFor(data, dateStr) {
    if (!data?.hourly?.time) return [];
    const out = [];
    data.hourly.time.forEach((t, i) => {
      if (!t.startsWith(dateStr)) return;
      const h = +t.slice(11, 13);
      if (h < 7 || h > 23) return;
      out.push({
        time: t.slice(11, 16),
        hour: h,
        temp: Math.round(data.hourly.temperature_2m[i]),
        pop:  data.hourly.precipitation_probability?.[i] ?? 0,
        wind: Math.round(data.hourly.wind_speed_10m?.[i] ?? 0),
        code: data.hourly.weather_code[i]
      });
    });
    return out;
  }

  /** Daily summary for one date, or null if outside the window. */
  function dayFor(data, dateStr) {
    if (!data?.daily?.time) return null;
    const i = data.daily.time.indexOf(dateStr);
    if (i === -1) return null;
    return {
      date:    dateStr,
      code:    data.daily.weather_code[i],
      max:     Math.round(data.daily.temperature_2m_max[i]),
      min:     Math.round(data.daily.temperature_2m_min[i]),
      popMax:  data.daily.precipitation_probability_max?.[i] ?? 0,
      sunrise: data.daily.sunrise?.[i]?.slice(11, 16) ?? null,
      sunset:  data.daily.sunset?.[i]?.slice(11, 16) ?? null
    };
  }

  /** N-day outlook starting at dateStr. */
  function outlook(data, dateStr, n = 3) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const d = dayFor(data, T.shiftDateStr(dateStr, k));
      if (d) out.push(d);
    }
    return out;
  }

  /**
   * "☔️ rain likely at 4pm" — the first hour above `threshold`.
   * @returns {string|null}
   */
  function rainFlag(hours, threshold = 50) {
    const hit = hours.find(h => h.pop > threshold);
    if (!hit) return null;
    let h = hit.hour;
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    // how long does it last?
    const wet = hours.filter(x => x.pop > threshold).length;
    const dur = wet > 3 ? ' — on and off for a few hours' : '';
    return `☔️ Rain likely around ${h}${ap} (${hit.pop}% chance)${dur}`;
  }

  /** Does this date have a >50% rain risk at all? For outdoor-plan warnings. */
  function dayRainRisk(data, dateStr) {
    const d = dayFor(data, dateStr);
    if (!d) return null;
    return d.popMax > 50 ? d.popMax : null;
  }

  return { fetchCity, hoursFor, dayFor, outlook, rainFlag, dayRainRisk,
           icon, label, inForecastWindow };
})();
