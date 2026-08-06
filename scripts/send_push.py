#!/usr/bin/env python3
"""
send_push.py — fires the 8 PM "question time" notification.

Run by .github/workflows/nightly-questions.yml. Two delivery paths,
both optional; whichever is configured gets used:

  1. Web Push (the goal) — pulls subscriptions from the Cloudflare
     Worker KV, signs with the VAPID private key, delivers straight
     into the installed PWA on each phone.
  2. ntfy.sh (fallback)  — POSTs to a secret topic. Works with zero
     setup if the Worker isn't up yet.

If neither is configured this exits 0 with a note. The site unlocks
the questions on its own at 8 PM local, so nothing actually breaks.

Secrets consumed (all optional):
  VAPID_PRIVATE_KEY   base64url private key
  VAPID_SUBJECT       mailto:you@example.com
  PUSH_API            https://<worker>.workers.dev
  PUSH_ADMIN_TOKEN    bearer token for GET /subscriptions
  NTFY_TOPIC          ntfy.sh topic name
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRIP = ROOT / "data" / "trip.json"

# Fixed summer-2026 UTC offsets. Simpler and more auditable here than
# dragging in a tz database for four known cities on known dates.
CITY_OFFSET = {
    "vienna": 2, "copenhagen": 2, "amsterdam": 2,   # CEST
    "london": 1,                                     # BST
    "dallas": -5,                                    # CDT
}


def local_today(offset_hours: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=offset_hours)).strftime("%Y-%m-%d")


def pick_day(trip):
    """Which trip day is 'tonight'? Honour an override, else match local dates."""
    override = os.environ.get("OVERRIDE_DATE", "").strip()
    if override:
        for d in trip["days"]:
            if d["date"] == override:
                return d
        sys.exit(f"❌ No trip day matches override date {override}")

    for d in trip["days"]:
        off = CITY_OFFSET.get(d["cityKey"], 2)
        if local_today(off) == d["date"]:
            return d
    return None


def build_message(trip, day):
    city = trip["cities"][day["cityKey"]]
    trivia = day["questions"]["trivia"]
    disc = day["questions"]["discussion"]
    n = len(trivia) + len(disc) + len(trip["meta"]["fixedQuestions"])

    title = f"{city['flag']} Question time — {city['name']}"
    body = (
        f"{len(trivia)} trivia · {len(disc)} about today · "
        f"2 house rules. {n} questions. Phones out. 🍻"
    )
    return title, body


def send_webpush(subs, title, body, url):
    from pywebpush import webpush, WebPushException

    priv = os.environ["VAPID_PRIVATE_KEY"]
    subject = os.environ.get("VAPID_SUBJECT", "mailto:eurotrip@example.com")
    payload = json.dumps(
        {"title": title, "body": body, "url": url, "tag": "nightly-questions"}
    )

    ok, dead = 0, []
    for rec in subs:
        sub = rec.get("subscription", rec)
        try:
            webpush(
                subscription_info=sub,
                data=payload,
                vapid_private_key=priv,
                vapid_claims={"sub": subject},
                ttl=7200,
            )
            ok += 1
            print(f"  ✅ sent to {rec.get('who', '?')}")
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            print(f"  ⚠️  failed for {rec.get('who', '?')}: {code} {e}")
            if code in (404, 410):
                dead.append(rec.get("id") or sub.get("endpoint"))
    return ok, dead


def fetch_subs(api, token):
    import requests

    r = requests.get(
        f"{api.rstrip('/')}/subscriptions",
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    r.raise_for_status()
    return r.json().get("subscriptions", [])


def prune(api, token, ids):
    import requests

    if not ids:
        return
    try:
        requests.post(
            f"{api.rstrip('/')}/prune",
            headers={"Authorization": f"Bearer {token}"},
            json={"ids": ids},
            timeout=20,
        )
        print(f"  🧹 pruned {len(ids)} dead subscription(s)")
    except Exception as e:
        print(f"  (prune failed, harmless: {e})")


def send_ntfy(topic, title, body, url):
    import requests

    r = requests.post(
        f"https://ntfy.sh/{topic}",
        data=body.encode("utf-8"),
        headers={
            "Title": title.encode("utf-8"),
            "Tags": "beers",
            "Priority": "default",
            "Click": url,
        },
        timeout=20,
    )
    r.raise_for_status()
    print(f"  ✅ ntfy delivered to topic '{topic}'")


def main():
    trip = json.loads(TRIP.read_text(encoding="utf-8"))
    day = pick_day(trip)

    if not day:
        print("No trip day matches today — nothing to send. Exiting cleanly.")
        return

    title, body = build_message(trip, day)
    site = "https://coobysnacks.github.io/eurotrip-2026/index.html?tab=questions"

    print(f"📅 {day['date']} — {day['title']}")
    print(f"   {title}")
    print(f"   {body}")

    if os.environ.get("DRY_RUN", "").lower() == "true":
        print("\n🔎 DRY RUN — nothing sent.")
        return

    sent_any = False

    api = os.environ.get("PUSH_API", "").strip()
    token = os.environ.get("PUSH_ADMIN_TOKEN", "").strip()
    priv = os.environ.get("VAPID_PRIVATE_KEY", "").strip()

    if api and token and priv:
        try:
            subs = fetch_subs(api, token)
            print(f"\n🔔 Web Push — {len(subs)} subscription(s)")
            if subs:
                ok, dead = send_webpush(subs, title, body, site)
                prune(api, token, dead)
                sent_any = sent_any or ok > 0
            else:
                print("  (nobody has enabled notifications yet)")
        except Exception as e:
            print(f"  ⚠️  Web Push path failed: {e}")
    else:
        print("\n(Web Push not configured — skipping)")

    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if topic:
        print(f"\n📣 ntfy fallback")
        try:
            send_ntfy(topic, title, body, site)
            sent_any = True
        except Exception as e:
            print(f"  ⚠️  ntfy failed: {e}")

    if not sent_any:
        print(
            "\nℹ️  Nothing delivered. The site still unlocks these questions "
            "at 8 PM local on its own — push is a convenience, not a dependency."
        )


if __name__ == "__main__":
    main()
