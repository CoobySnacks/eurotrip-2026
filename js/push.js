/* ══════════════════════════════════════════════════════════
   push.js — PWA install + Web Push (VAPID)

   iOS reality check: Safari only allows web push when the site
   has been added to the Home Screen (iOS 16.4+). So we:
     1. register the service worker always (offline cache)
     2. only offer notifications when running standalone
     3. never block anything — the Questions tab unlocks at
        8 PM local on its own, push or no push.
   ══════════════════════════════════════════════════════════ */

const Push = (() => {

  /* Public VAPID key — safe to ship. The private half lives in
     GitHub Actions secrets and never touches this repo. */
  const VAPID_PUBLIC = 'BJ-g1Z3kNV9xZjtF8-eIladmX40ZCkoxSCnCT3JQcVvRG5WhF0vLVmdLPtCkUe-G20A-yHHieDbbxxek5Hz7VLM';

  /* Cloudflare Worker that stores subscriptions in KV.
     Empty string = push disabled, everything else still works. */
  const PUSH_API = '';

  let reg = null;

  const b64ToU8 = b64 => {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(s);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  };

  const isStandalone = () =>
    window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

  async function init() {
    if (!('serviceWorker' in navigator)) return;
    try {
      reg = await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.warn('[push] SW registration failed', e.message);
      return;
    }

    const btn = document.getElementById('notifBtn');
    if (!btn) return;

    if (isStandalone() && 'Notification' in window) {
      btn.classList.remove('hidden');
      if (Notification.permission === 'granted') {
        btn.classList.add('on');
        btn.title = 'Notifications on';
        subscribe();                 // refresh subscription silently
      }
    }
  }

  async function enable() {
    if (!isStandalone()) {
      alert("Add this to your Home Screen first.\n\nTap the Share button in Safari → Add to Home Screen → open it from there.\n\niPhone only allows notifications for installed apps.");
      document.getElementById('installBanner')?.classList.remove('hidden');
      return;
    }
    if (!('Notification' in window)) { alert('This browser does not support notifications.'); return; }

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      alert('Notifications blocked.\n\nYou can turn them on later in\nSettings → Notifications → Eurotrip.');
      return;
    }
    document.getElementById('notifBtn')?.classList.add('on');
    await subscribe();

    /* immediate confirmation so they know it worked */
    reg?.showNotification('🍻 You\'re in', {
      body: 'Questions land at 8 PM every night of the trip.',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png'
    });
  }

  async function subscribe() {
    if (!reg || !PUSH_API) return null;
    try {
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToU8(VAPID_PUBLIC)
        });
      }
      const who = Store.getWho() || 'unknown';
      await fetch(PUSH_API + '/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ who, subscription: sub.toJSON() })
      });
      Store.setPushState({ who, at: Date.now() });
      return sub;
    } catch (e) {
      console.warn('[push] subscribe failed', e.message);
      return null;
    }
  }

  return { init, enable, subscribe, isStandalone, VAPID_PUBLIC };
})();
