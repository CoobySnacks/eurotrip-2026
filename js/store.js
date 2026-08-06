/* ══════════════════════════════════════════════════════════
   store.js — identity + persisted state (localStorage only)
   No backend, no accounts. Everything lives on the phone.
   ══════════════════════════════════════════════════════════ */

const Store = (() => {
  const K = {
    who:      'et26.who',
    checks:   'et26.checks',
    seenDays: 'et26.qseen',
    installed:'et26.installDismissed',
    wx:       'et26.wx.',
    seeAll:   'et26.money.seeAll'
  };

  const get = (k, fb) => {
    try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); }
    catch { return fb; }
  };
  const set = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  };

  return {
    /* ---- identity ---- */
    getWho:  ()  => get(K.who, null),
    setWho:  (w) => set(K.who, w),
    clearWho:()  => { try { localStorage.removeItem(K.who); } catch {} },

    /* ---- checklists ---- */
    getChecks: ()      => get(K.checks, {}),
    isChecked: (id)    => !!get(K.checks, {})[id],
    toggleCheck: (id)  => {
      const c = get(K.checks, {});
      c[id] = !c[id];
      set(K.checks, c);
      return c[id];
    },
    resetChecks: (ids) => {
      const c = get(K.checks, {});
      ids.forEach(i => delete c[i]);
      set(K.checks, c);
    },
    /** progress for a list of item ids → {done, total, pct} */
    progress: (ids) => {
      const c = get(K.checks, {});
      const done = ids.filter(i => c[i]).length;
      return { done, total: ids.length, pct: ids.length ? Math.round(done / ids.length * 100) : 0 };
    },

    /* ---- money view toggle ---- */
    getSeeAll: ()  => get(K.seeAll, false),
    setSeeAll: (v) => set(K.seeAll, v),

    /* ---- install banner ---- */
    installDismissed: ()  => get(K.installed, false),
    dismissInstall:   ()  => set(K.installed, true),

    /* ---- weather cache (1 hour TTL) ---- */
    getWx: (cityKey) => {
      const o = get(K.wx + cityKey, null);
      if (!o || !o.t) return null;
      if (Date.now() - o.t > 3600e3) return null;   // stale
      return o.d;
    },
    setWx: (cityKey, data) => set(K.wx + cityKey, { t: Date.now(), d: data }),

    /* ---- push subscription bookkeeping ---- */
    getPushState: ()  => get('et26.push', null),
    setPushState: (v) => set('et26.push', v)
  };
})();
