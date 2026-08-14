#!/usr/bin/env python3
"""
snapshot_weather.py — freeze the forecast into the repo.

Why this exists: the site fetches Open-Meteo live from the phone. That works
at the hotel and fails on a plane, on the metro, and anywhere roaming drops —
which is exactly when someone opens the app to decide whether to bring a
jacket. Without a snapshot the TODAY view falls all the way back to "early
September averages around 65°F", which is useless for a specific afternoon.

So: a daily job writes data/weather.json into the site itself. The service
worker caches it with the rest of the shell, so the forecast survives with no
signal at all. Live data still wins when there is a connection.

Only trip dates are stored, and only the fields the UI renders, so the file
stays small enough to cache comfortably.
"""

import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRIP = ROOT / "data" / "trip.json"
OUT = ROOT / "data" / "weather.json"

UA = {"User-Agent": "EurotripWeatherSnapshot/1.0 (+https://github.com/CoobySnacks/eurotrip-2026)"}


def fetch(city):
    q = urllib.parse.urlencode({
        "latitude": city["lat"],
        "longitude": city["lon"],
        "hourly": "temperature_2m,precipitation_probability,weather_code,wind_speed_10m",
        "daily": ("weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,"
                  "precipitation_probability_max"),
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": city["tz"],
        "forecast_days": 16,
    })
    url = "https://api.open-meteo.com/v1/forecast?" + q
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def trim(data, dates):
    """Keep only the trip's own dates, and only what the UI actually renders.

    Open-Meteo returns null for values at the far edge of its 16-day window.
    An unguarded round(None) here crashed four of five cities on Aug 14 and
    they were silently dropped from the snapshot — so: skip any day or hour
    whose core numbers are missing rather than dying on it.
    """
    out = {"daily": {}, "hourly": {}}
    d = data.get("daily", {})
    for i, day in enumerate(d.get("time", [])):
        if day not in dates:
            continue
        mx, mn = d["temperature_2m_max"][i], d["temperature_2m_min"][i]
        if mx is None or mn is None:
            continue                      # window edge — no usable forecast yet
        out["daily"][day] = {
            "code": d["weather_code"][i] or 0,
            "max": round(mx),
            "min": round(mn),
            "popMax": d.get("precipitation_probability_max", [None] * 99)[i] or 0,
            "sunrise": (d.get("sunrise") or [None])[i][11:16] if d.get("sunrise") else None,
            "sunset": (d.get("sunset") or [None])[i][11:16] if d.get("sunset") else None,
        }
    h = data.get("hourly", {})
    for i, stamp in enumerate(h.get("time", [])):
        day, hh = stamp[:10], int(stamp[11:13])
        if day not in dates or hh < 7 or hh > 23:
            continue
        t = h["temperature_2m"][i]
        if t is None:
            continue
        out["hourly"].setdefault(day, []).append({
            "t": stamp[11:16],
            "temp": round(t),
            "pop": h.get("precipitation_probability", [0] * 99)[i] or 0,
            "code": h["weather_code"][i] or 0,
            "wind": round(h.get("wind_speed_10m", [0] * 99)[i] or 0),
        })
    return out


def main():
    trip = json.loads(TRIP.read_text(encoding="utf-8"))
    dates = {d["date"] for d in trip["days"]}

    # Start from the previous snapshot so one failed fetch keeps yesterday's
    # data for that city instead of erasing it. Mid-trip, a slightly stale
    # forecast beats "seasonal averages" every time.
    prev = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8")).get("cities", {})
        except Exception:
            prev = {}

    snap = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "open-meteo.com",
        "note": "Offline fallback. The app prefers live data whenever it has signal.",
        "cities": dict(prev),
    }

    for key, city in trip["cities"].items():
        try:
            snap["cities"][key] = trim(fetch(city), dates)
            got = len(snap["cities"][key]["daily"])
            print(f"  {key:<12} {got} trip day(s) in range")
        except Exception as e:
            kept = len(prev.get(key, {}).get("daily", {}))
            print(f"  {key:<12} FAILED ({e}) — kept previous snapshot ({kept} day(s))")

    if not any(c["daily"] for c in snap["cities"].values()):
        print("\nNo trip dates are inside the 16-day window yet — nothing useful to store.")
        print("Writing the file anyway so the app always has something to read.")

    OUT.write_text(json.dumps(snap, indent=1, ensure_ascii=False), encoding="utf-8")
    size = OUT.stat().st_size
    print(f"\nwrote {OUT.name}: {size/1024:.1f} KB")
    if size > 400_000:
        print("WARNING: snapshot is large for an offline cache")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
