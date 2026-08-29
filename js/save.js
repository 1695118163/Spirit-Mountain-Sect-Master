/**
 * save.js —— 存档读写、版本迁移、自动存档调度、导出/导入。
 * 键名：lingshan_save_v1（主）/ lingshan_save_backup（备份）/ lingshan_save_tmp（写入防损）。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const KEY = 'lingshan_save_v1';
  const KEY_BACKUP = 'lingshan_save_backup';
  const KEY_TMP = 'lingshan_save_tmp';
  const SAVE_VERSION = 1;

  const MIGRATIONS = {
    // 1: (s) => { s.settings = s.settings || {}; s.v = 2; return s; }
  };

  function ls() { return (typeof localStorage !== 'undefined') ? localStorage : null; }

  function fillDefaults(s) {
    const fresh = g.LS.state.NEW_STATE();
    for (const k in fresh) {
      if (s[k] === undefined) s[k] = fresh[k];
    }
    for (const r in fresh.resources) if (s.resources[r] === undefined) s.resources[r] = 0;
    s.event_state = Object.assign({}, fresh.event_state, s.event_state || {});
    s.prestige = Object.assign({}, fresh.prestige, s.prestige || {});
    s.stats = Object.assign({}, fresh.stats, s.stats || {});
    s.settings = Object.assign({}, fresh.settings, s.settings || {});
    s.perm_bonus = Object.assign({}, fresh.perm_bonus, s.perm_bonus || {});
    s.pill = Object.assign({}, fresh.pill, s.pill || {});
    if (!Array.isArray(s.buffs)) s.buffs = [];
    if (!Array.isArray(s.chains)) s.chains = [];
    if (!s.tags || typeof s.tags !== 'object') s.tags = {};
    if (!s.buildings || typeof s.buildings !== 'object') s.buildings = {};
    if (!s.building_stalls) s.building_stalls = {};
    return s;
  }

  function migrate(raw) {
    let s;
    try { s = JSON.parse(raw); } catch (e) { return { ok: false, reason: 'parse' }; }
    if (!s || typeof s.v !== 'number') return { ok: false, reason: 'no_version' };
    try {
      let guard = 0;
      while (s.v < SAVE_VERSION) {
        const m = MIGRATIONS[s.v];
        if (!m) throw new Error('missing migration ' + s.v);
        s = m(s);
        if (++guard > 50) throw new Error('migration loop');
      }
    } catch (e) { return { ok: false, reason: 'migrate', state: s }; }
    return { ok: true, state: fillDefaults(s) };
  }

  function save() {
    const store = ls();
    const s = g.LS.S;
    if (!store || !s) return;
    const now = Date.now();
    s.lastSeen = now;
    s.last_seen_max = Math.max(s.last_seen_max || 0, now);
    try {
      const raw = JSON.stringify(s);
      store.setItem(KEY_TMP, raw);   // 先写临时键再替换，防写坏
      store.setItem(KEY, raw);
      store.removeItem(KEY_TMP);
    } catch (e) { console.warn('[灵山掌门] 存档写入失败：', e.message); }
  }

  function backupRaw(raw) {
    const store = ls();
    if (store && raw) { try { store.setItem(KEY_BACKUP, raw); } catch (e) {} }
  }

  function load() {
    const store = ls();
    if (!store) return { ok: false, fresh: true };
    const raw = store.getItem(KEY);
    if (!raw) return { ok: false, fresh: true };
    const r = migrate(raw);
    if (!r.ok) {
      backupRaw(raw); // 绝不静默丢弃：坏档先备份
      console.warn('[灵山掌门] 存档读取失败（' + r.reason + '），已备份原档并重新开始。');
      if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('存档读取失败：原档已备份，本次以新档开始。');
      return { ok: false, fresh: true };
    }
    return r;
  }

  function exportToText() {
    return JSON.stringify(g.LS.S);
  }

  function importFromText(str) {
    const store = ls();
    if (!str || !str.trim()) return { ok: false, reason: 'empty' };
    const raw = str.trim();
    backupRaw(JSON.stringify(g.LS.S)); // 导入前自动备份当前档
    const r = migrate(raw);
    if (!r.ok) return r;
    g.LS.S = r.state;
    if (store) store.setItem(KEY, JSON.stringify(r.state));
    return { ok: true };
  }

  /** 每 30 秒自动存 + 三个页面钩子兜底（visibilitychange/pagehide/beforeunload） */
  function scheduleAutoSave() {
    setInterval(save, 30000);
    const hooks = ['pagehide', 'beforeunload'];
    for (const h of hooks) window.addEventListener(h, save);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') save();
    });
  }

  function resetAll() {
    const store = ls();
    if (!store) return;
    store.removeItem(KEY);
    store.removeItem(KEY_BACKUP);
    store.removeItem(KEY_TMP);
  }

  g.LS.save = { KEY, SAVE_VERSION, save, load, migrate, backupRaw, exportToText, importFromText, scheduleAutoSave, resetAll };
})(typeof window !== 'undefined' ? window : globalThis);
