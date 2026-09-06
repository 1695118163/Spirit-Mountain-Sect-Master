/**
 * save.js —— 存档读写、版本迁移、自动存档调度、导出/导入。
 * 键名：lingshan_save_v1（主）/ lingshan_save_backup（备份）/ lingshan_save_tmp（写入防损）。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const KEY = 'lingshan_save_v1';
  const KEY_BACKUP = 'lingshan_save_backup';
  const KEY_TMP = 'lingshan_save_tmp';
  const SAVE_VERSION = 9;

  const MIGRATIONS = {
    // v1 → v2：补 突破失败体系（bt）/ 停滞彩蛋（stagnation）/ 事件队列（queue）
    1: (s) => {
      s.stagnation = s.stagnation || { since: Date.now(), fired_for_realm: -1 };
      s.bt = s.bt || { fail_streak: 0, fail_cooldown_until: 0 };
      if (s.event_state && !Array.isArray(s.event_state.queue)) s.event_state.queue = [];
      if (s.event_state) s.event_state.pending = false;
      s.v = 2;
      return s;
    },
    // v2 → v3：补 游戏历法（game_days）/ 本世起点（rebirth_at）
    2: (s) => {
      if (typeof s.game_days !== 'number' || !isFinite(s.game_days)) s.game_days = 0;
      if (!s.rebirth_at) s.rebirth_at = s.created_at || Date.now();
      s.v = 3;
      return s;
    },
    // v3 → v4：补 图鉴（collection/chain_seen）/ 建筑技能冷却（ability_cd）
    3: (s) => {
      if (!s.collection || typeof s.collection !== 'object') s.collection = {};
      if (!s.chain_seen || typeof s.chain_seen !== 'object') s.chain_seen = {};
      if (!s.ability_cd || typeof s.ability_cd !== 'object') s.ability_cd = {};
      s.v = 4;
      return s;
    },
    // v4 → v5：补 三世缘（karma_legacy）/ 山志碑林（chronicle_lines/steles）/ BGM 开关
    4: (s) => {
      if (!s.karma_legacy || typeof s.karma_legacy !== 'object') s.karma_legacy = {};
      if (!Array.isArray(s.chronicle_lines)) s.chronicle_lines = [];
      if (!Array.isArray(s.steles)) s.steles = [];
      if (s.settings && s.settings.music === undefined) s.settings.music = false;
      if (s.bt && s.bt.visitor_effect === undefined) s.bt.visitor_effect = '';
      s.v = 5;
      return s;
    },
    // v5 → v6：丹药细分（旧 danyao 计数 → 灵力丹·灵品库存）+ 丹毒
    5: (s) => {
      if (!s.pill_stock || typeof s.pill_stock !== 'object') s.pill_stock = {};
      if (typeof s.pill_toxic !== 'number' || !isFinite(s.pill_toxic)) s.pill_toxic = 0;
      if (s.pill_toxic_flag === undefined) s.pill_toxic_flag = false;
      if (s.bt && s.bt.breakthrough_bonus === undefined) s.bt.breakthrough_bonus = 0;
      if (s.bt && s.bt.guaranteed === undefined) s.bt.guaranteed = false;
      const legacy = (s.resources && s.resources.danyao) || 0;
      if (legacy > 0 && !Object.keys(s.pill_stock).length) {
        s.pill_stock['lingli_灵'] = Math.min(99, Math.floor(legacy));
        s.resources.danyao = Math.min(99, Math.floor(legacy));
      }
      s.v = 6;
      return s;
    },
    // v6 → v7：心魔种因（persistent_curses）/ 概念提示（seen_hints）
    6: (s) => {
      if (!Array.isArray(s.persistent_curses)) s.persistent_curses = [];
      if (!s.seen_hints || typeof s.seen_hints !== 'object') s.seen_hints = {};
      s.v = 7;
      return s;
    },
    // v7 → v8：仙途指要（help_seen）/ 建筑首购建议（first_afford_seen）/ 天气（weather_state）
    7: (s) => {
      if (!s.help_seen || typeof s.help_seen !== 'object') s.help_seen = {};
      if (!s.first_afford_seen || typeof s.first_afford_seen !== 'object') s.first_afford_seen = {};
      if (!s.weather_state) s.weather_state = { kind: 'clear', seed_day: -1 };
      s.v = 8;
      return s;
    },
    // v8 → v9：斗法体系（武器/功法/装备/好友/积分/战绩）
    8: (s) => {
      if (!Array.isArray(s.weapons_owned)) s.weapons_owned = [];
      if (!Array.isArray(s.techniques_owned)) s.techniques_owned = [];
      if (!s.equip || typeof s.equip !== 'object') s.equip = { weapon: null, technique: null };
      if (!Array.isArray(s.friends)) s.friends = [];
      if (typeof s.honor !== 'number' || !isFinite(s.honor)) s.honor = 0;
      if (!s.record || typeof s.record !== 'object') s.record = { win: 0, lose: 0 };
      s.v = 9;
      return s;
    }
  };

  function ls() { return (typeof localStorage !== 'undefined') ? localStorage : null; }

  // 保存锁：重置游戏后置真，拦截卸载时的自动存档（否则旧档在 reload 时被写回=重置白做）
  let saveLocked = false;

  function fillDefaults(s) {
    const fresh = g.LS.state.NEW_STATE();
    for (const k in fresh) {
      if (s[k] === undefined) s[k] = fresh[k];
    }
    // 旧档灵根补发（null 是合法缺省，须显式补随机）
    if (!s.spirit_root && g.LS.state && g.LS.state.rollSpiritRoot) s.spirit_root = g.LS.state.rollSpiritRoot();
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
    if (saveLocked) return; // 重置后禁止落盘
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
    saveLocked = true; // 防止 reload 卸载时自动存档把旧档写回
    const store = ls();
    if (!store) return;
    store.removeItem(KEY);
    store.removeItem(KEY_BACKUP);
    store.removeItem(KEY_TMP);
  }

  g.LS.save = { KEY, SAVE_VERSION, save, load, migrate, backupRaw, exportToText, importFromText, scheduleAutoSave, resetAll };
})(typeof window !== 'undefined' ? window : globalThis);
