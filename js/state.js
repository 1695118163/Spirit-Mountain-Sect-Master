/**
 * state.js —— 游戏状态唯一数据源 LS.S 的创建/读取/变更、A–F 效果唯一入口 applyEffect。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};
  const U = () => g.LS.util;

  /** 按 balance.json 生成初始态（存档 schema v1） */
  function NEW_STATE() {
    const BAL = g.LS.BAL || {};
    const firstDelay = (BAL.events && BAL.events.first_delay_s) || 150;
    return {
      v: 4,
      created_at: Date.now(),
      lastSeen: Date.now(),
      last_seen_max: Date.now(),
      resources: { lingqi: 0, xiufu: 0, lingshi: 0, danyao: 0, chuancheng: 0 },
      realm: { index: 0 },
      buildings: {},
      building_stalls: {},
      buffs: [],
      perm_bonus: { all: 0, lingqi: 0, xiufu: 0, lingshi: 0 },
      dao_heart: 0,
      event_state: {
        next_event_at: Date.now() + firstDelay * 1000,
        since_rare: 0,
        since_xian: 0,
        recent_ids: [],
        recent_negatives: 0,
        open: null,
        pending: false,
        queue: [],
        log: []
      },
      tags: {},
      chains: [],
      pill: { progress_s: 0, last_serve_at: 0 },
      stagnation: { since: Date.now(), fired_for_realm: -1 },
      bt: { fail_streak: 0, fail_cooldown_until: 0, visitor_effect: '', breakthrough_bonus: 0, guaranteed: false },
      pill_stock: {},
      pill_toxic: 0,
      persistent_curses: [],
      seen_hints: {},
      weapons_owned: [],
      techniques_owned: [],
      equip: { weapon: null, technique: null },
      friends: [],
      honor: 0,
      record: { win: 0, lose: 0 },
      game_days: 0,
      rebirth_at: Date.now(),
      collection: {},
      chain_seen: {},
      ability_cd: {},
      karma_legacy: {},
      chronicle_lines: [],
      steles: [],
      prestige: { count: 0, points: 0, total_points: 0, spent: 0, bought: [], lifetime_best_realm: 0, first_event_after_rebirth: false },
      stats: { play_seconds: 0, clicks: 0, events_total: 0, events_llm: 0, events_fallback: 0, breakthroughs: 0, prestige_count: 0, offline_claimed: 0, negative_settled: 0, total_settled: 0 },
      settings: { sound: true, llm_enabled: true, music: false, difficulty: 'normal' },
      spirit_root: null // 开局随机：{key, element}——伪/真/异/天
    };
  }

  function getS() { return g.LS.S; }

  /** 开局随机灵根（凡人设定：伪40/真30/异20/天10），灵根偏向五行之一 */
  function rollSpiritRoot() {
    const cfg = (g.LS.BAL && g.LS.BAL.spirit_root) || {};
    const types = cfg.types || [
      { key: '伪', weight: 40, xp_mult: 0.85 }, { key: '真', weight: 30, xp_mult: 1.0 },
      { key: '异', weight: 20, xp_mult: 1.15 }, { key: '天', weight: 10, xp_mult: 1.35 }
    ];
    const els = ['金', '木', '水', '火', '土'];
    const pick = g.LS.util.weightedPick(types, t => t.weight);
    return { key: pick.key, element: els[Math.floor(Math.random() * els.length)] };
  }

  function spiritRootMult() {
    const s = S();
    if (!s.spirit_root) return 1;
    const cfg = (g.LS.BAL && g.LS.BAL.spirit_root) || {};
    const t = (cfg.types || []).find(x => x.key === s.spirit_root.key);
    return t ? (t.xp_mult || 1) : 1;
  }

  /**
   * A–F 效果唯一入口。slot 为 events.js 预掷并具体化后的对象：
   *  A {type:'A', res, amount}   资源直加（amount>0）
   *  B {type:'B', res, amount}   资源直扣（amount<0，最低扣到 0）
   *  C {type:'C', mult, duration_s, click_mult?}  限时 Buff
   *  D {type:'D', pct}           永久加成（小数 0.02 = +2%，累计受 cap 限制）
   *  E {type:'E', seedEventId}   连锁标记
   *  F {type:'F', buildingId, duration_s}  建筑停产
   */
  function applyEffect(slot) {
    const S = g.LS.S;
    const BAL = g.LS.BAL;
    if (!slot || !slot.type) return null;
    const now = Date.now();
    switch (slot.type) {
      case 'A':
      case 'B': {
        const res = slot.res;
        if (!(res in S.resources)) return null;
        // 丹药奖励特判：细分为灵力丹入库（品质随机），不再堆通用计数
        if (res === 'danyao' && slot.amount > 0 && g.LS.economy && g.LS.economy.grantPill) {
          const q = g.LS.economy.rollPillQuality();
          g.LS.economy.grantPill('lingli', q, Math.round(slot.amount));
          return { res, delta: slot.amount };
        }
        const cur = S.resources[res] || 0;
        let nv = cur + slot.amount;
        if (nv < 0) nv = 0;
        S.resources[res] = nv;
        return { res, delta: nv - cur };
      }
      case 'C': {
        addBuff({ id: 'event_buff', mult: slot.mult, ts_end: now + slot.duration_s * 1000, click_mult: slot.click_mult || 0 });
        return { mult: slot.mult, duration_s: slot.duration_s };
      }
      case 'D': {
        const cap = ((BAL.events && BAL.events.effect && BAL.events.effect.D && BAL.events.effect.D.cap_pct) || 100) / 100;
        const before = S.perm_bonus.all;
        S.perm_bonus.all = U().clamp(before + slot.pct, 0, cap);
        return { pct: slot.pct, total: S.perm_bonus.all, capped: slot.pct > 0 && S.perm_bonus.all >= cap && before < cap };
      }
      case 'E': {
        S.chains.push({ seedEventId: slot.seedEventId, dueIn: slot.dueIn || U().randInt(2, 4) });
        return { chained: true };
      }
      case 'F': {
        S.building_stalls[slot.buildingId] = now + slot.duration_s * 1000;
        return { buildingId: slot.buildingId, duration_s: slot.duration_s };
      }
      default:
        return null;
    }
  }

  function addBuff(def) {
    const S = g.LS.S;
    S.buffs.push(Object.assign({ ts_start: Date.now() }, def));
  }

  /** 过期清理：Buff 与建筑异常（到期必清理） */
  function tickBuffs(now) {
    const S = g.LS.S;
    if (!now) now = Date.now();
    if (Array.isArray(S.buffs)) S.buffs = S.buffs.filter(b => b.ts_end > now);
    if (S.building_stalls) {
      for (const k in S.building_stalls) {
        if (S.building_stalls[k] <= now) delete S.building_stalls[k];
      }
    }
  }

  /** 写入因果标签：重复同类 tag weight+1（上限 3）；已回收的可重新激活 */
  function addTag(key, stance, weight) {
    const S = g.LS.S;
    if (!key) return;
    const t = S.tags[key];
    if (t) {
      t.weight = U().clamp(t.weight + 1, 1, (g.LS.BAL.events && g.LS.BAL.events.karma && g.LS.BAL.events.karma.weight_cap) || 3);
      t.stance = stance || t.stance;
      t.recycled = false;
    } else {
      S.tags[key] = { key, stance: stance || '缘', weight: weight || 1, recycled: false, since_realm: S.realm.index };
    }
  }

  function changeDaoHeart(d) {
    const S = g.LS.S;
    const BAL = g.LS.BAL;
    const lo = (BAL.dao_heart && BAL.dao_heart.min) || -100;
    const hi = (BAL.dao_heart && BAL.dao_heart.max) || 100;
    S.dao_heart = U().clamp(S.dao_heart + d, lo, hi);
  }

  function markFlag(id, weight) { addTag(id, '缘', weight); }

  g.LS.state = { NEW_STATE, getS, applyEffect, addBuff, tickBuffs, addTag, changeDaoHeart, markFlag, rollSpiritRoot, spiritRootMult };
})(typeof window !== 'undefined' ? window : globalThis);
