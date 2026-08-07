#!/usr/bin/env python3
"""
send_welcome.py — the "we're all here" push.

Fires exactly once, the first time all three of them are registered.

Idempotency lives in the repo, not in KV: the workflow commits
`.welcome-sent` after a successful send, and this script refuses to run
if that file exists. That keeps the whole thing working even if the
Cloudflare token is revoked, and it means the marker is visible in git
history rather than hidden in a KV bucket.

Exit codes:
  0  nothing to do (already sent, or not everyone is in yet)
  0 + writes SENT=true to $GITHUB_OUTPUT when it actually delivers
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARKER = ROOT / ".welcome-sent"
TRIP = ROOT / "data" / "trip.json"

EVERYONE = {"Coob", "Jared", "Grant"}

UA = "Mozilla/5.0 (compatible; EurotripBot/1.0; +https://github.com/CoobySnacks/eurotrip-2026)"

TITLE = "🍻 We're all here"
BODY = ("Welcome gentlemen. We're all here, logged in and clocked in. "
        "Full hearts and hard cogs.")


def out(key, val):
    p = os.environ.get("GITHUB_OUTPUT")
    if p:
        with open(p, "a", encoding="utf-8") as f:
            f.write(f"{key}={val}\n")


def main():
    if MARKER.exists():
        print("Already sent (.welcome-sent present). Nothing to do.")
        return

    api = os.environ.get("PUSH_API", "").strip()
    token = os.environ.get("PUSH_ADMIN_TOKEN", "").strip()
    priv = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    if not (api and token and priv):
        print("Push not configured — skipping.")
        return

    import requests
    from pywebpush import webpush, WebPushException

    sys.path.insert(0, str(ROOT / "scripts"))
    from send_push import dedupe_by_person

    r = requests.get(
        f"{api.rstrip('/')}/subscriptions",
        headers={"Authorization": f"Bearer {token}", "User-Agent": UA},
        timeout=20,
    )
    r.raise_for_status()
    subs, _ = dedupe_by_person(r.json().get("subscriptions", []))

    here = {s.get("who") for s in subs}
    missing = EVERYONE - here
    print(f"registered: {sorted(here) or 'nobody'}")

    if missing:
        print(f"still waiting on: {sorted(missing)} — not sending yet.")
        return

    if os.environ.get("DRY_RUN", "").lower() == "true":
        print(f"\nDRY RUN — would send to {len(subs)}:\n  {TITLE}\n  {BODY}")
        return

    payload = json.dumps({
        "title": TITLE,
        "body": BODY,
        "url": "https://coobysnacks.github.io/eurotrip-2026/",
        "tag": "welcome",
    })
    subject = os.environ.get("VAPID_SUBJECT", "mailto:eurotrip@example.com")

    ok = 0
    for s in subs:
        try:
            webpush(subscription_info=s["subscription"], data=payload,
                    vapid_private_key=priv, vapid_claims={"sub": subject}, ttl=86400)
            print(f"  delivered -> {s.get('who')}")
            ok += 1
        except WebPushException as e:
            print(f"  FAILED {s.get('who')}: {getattr(e.response, 'status_code', None)}")

    if ok:
        MARKER.write_text(
            "Welcome push sent once all three were registered.\n"
            "Delete this file to allow it to fire again.\n",
            encoding="utf-8")
        print(f"\nSent to {ok}/{len(subs)}. Marker written.")
        out("SENT", "true")
    else:
        print("\nNothing delivered — not writing the marker, will retry next run.")


if __name__ == "__main__":
    main()
