/* ══════════════════════════════════════════════════════════
   push.js — PWA install + Web Push (VAPID)

   NO BACKEND. On purpose.

   A push subscription has to be stored somewhere the nightly
   job can read it. The usual answer is a server; ours is a
   GitHub Actions secret. Each phone subscribes once, hands
   Coob a code, and Coob pastes it into the PUSH_SUBSCRIPTIONS
   secret. Three phones, three codes, done forever.

   Why not just commit the codes? A push subscription is a
   capability — anyone holding it can notify that phone. The
   repo is public, so they live in an encrypted secret instead.

   iOS reality check: Safari only allows web push once the site
   is on the Home Screen (iOS 16.4+). Nothing gets around that,
   so we detect it and walk them through it instead of showing
   a button that silently fails.

   Everything here is optional. The Questions tab unlocks at
   8 PM local on its own.
   ══════════════════════════════════════════════════════════ */

const Push = (() => {

  /* Public VAPID key — safe to ship. Private half lives in GitHub secrets. */
  const VAPID_PUBLIC = 'BJ-g1Z3kNV9xZjtF8-eIladmX40ZCkoxSCnCT3JQcVvRG5WhF0vLVmdLPtCkUe-G20A-yHHieDbbxxek5Hz7VLM';

  /* Cloudflare Worker + KV. With this set, enabling notifications is a single
     tap — the subscription registers itself and the code step never appears. */
  const PUSH_API = 'https://eurotrip-push.coobysnacks.workers.dev';

  let reg = null;

  const b64ToU8 = b64 => {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from([...atob(s)].map(c => c.charCodeAt(0)));
  };

  const isStandalone = () =>
    window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

  const supported = () =>
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  async function init() {
    if (!('serviceWorker' in navigator)) return;
    try { reg = await navigator.serviceWorker.register('sw.js'); }
    catch (e) { console.warn('[push] SW registration failed', e.message); return; }

    const btn = document.getElementById('notifBtn');
    if (!btn) return;
    if (supported() && (isStandalone() || !isIOS())) {
      btn.classList.remove('hidden');
      if (Notification.permission === 'granted') {
        btn.classList.add('on');
        btn.title = 'Notifications on';
      }
    }
  }

  /** Can this device actually turn notifications on right now? */
  function readiness() {
    if (!supported())              return 'unsupported';
    if (isIOS() && !isStandalone())return 'needs-install';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied')  return 'denied';
    return 'ready';
  }

  /**
   * Ask for permission and create the subscription.
   * @returns {Promise<{ok:boolean, reason?:string, code?:string}>}
   */
  async function enable() {
    const state = readiness();

    if (state === 'unsupported')
      return { ok: false, reason: "This browser doesn't support notifications. On iPhone, use Safari." };
    if (state === 'needs-install')
      return { ok: false, reason: 'needs-install' };
    if (state === 'denied')
      return { ok: false, reason: 'Notifications are blocked. Turn them on in Settings → Notifications → Eurotrip, then come back.' };

    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted')
        return { ok: false, reason: 'No problem — the questions still unlock at 8 PM inside the app.' };
    }

    if (!reg) { try { reg = await navigator.serviceWorker.ready; } catch {} }
    if (!reg) return { ok: false, reason: 'Service worker not ready. Close the app and reopen it.' };

    let sub;
    try {
      sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToU8(VAPID_PUBLIC)
        });
      }
    } catch (e) {
      return { ok: false, reason: 'Could not create the subscription: ' + e.message };
    }

    const who = Store.getWho() || 'unknown';
    const payload = { who, subscription: sub.toJSON() };

    /* If a Worker is configured, register automatically and skip the code step. */
    if (PUSH_API) {
      try {
        await fetch(PUSH_API + '/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        Store.setPushState({ who, at: Date.now(), auto: true });
        confirmToast();
        return { ok: true, auto: true };
      } catch (e) {
        console.warn('[push] worker registration failed, falling back to code', e.message);
      }
    }

    Store.setPushState({ who, at: Date.now(), auto: false });
    confirmToast();
    return { ok: true, auto: false, code: JSON.stringify(payload) };
  }

  function confirmToast() {
    try {
      reg?.showNotification('🍻 You\'re in', {
        body: 'Questions land at 8 PM every night of the trip.',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: 'welcome'
      });
    } catch {}
  }

  /** Share sheet on iOS, clipboard everywhere else. */
  async function shareCode(code) {
    const who = Store.getWho() || 'someone';
    const text = `Eurotrip notification code for ${who} — paste this to Coob:\n\n${code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Eurotrip notification code', text }); return 'shared'; }
      catch { /* user cancelled — fall through to clipboard */ }
    }
    return copyCode(code);
  }

  async function copyCode(code) {
    try { await navigator.clipboard.writeText(code); return 'copied'; }
    catch { return 'manual'; }
  }

  return { init, enable, readiness, shareCode, copyCode,
           isStandalone, isIOS, supported, VAPID_PUBLIC };
})();
