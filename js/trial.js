/**
 * trial.js —— 试炼塔（PVE）：10 章×5 关 + 帝路 3 关。
 *  - 章解锁=境界≥章序；每关首通拿灵石锚定奖励+掉落；扫荡 90s 产量/次、5 次每小时；
 *  - 野怪=前缀名池×随机灵根×「境界≤章」牌池抽招；Boss/守关者=ai_cards 手配卡组；
 *  - 帝路禁扫荡，首通各得帝纹×1（大帝雷劫 p +0.02/枚）。
 * 战斗复用 battle.js v3 引擎（mode:'trial'，胜负回调回本模块结算）。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const LV = () => g.LS.BAL.levels || {};
  const S = () => g.LS.S;
  const U = () => g.LS.util;

  function trialState() {
    const s = S();
    if (!s.trial) s.trial = { cleared: {}, sweeps: {} };
    if (!s.trial.cleared) s.trial.cleared = {};
    if (!s.trial.sweeps) s.trial.sweeps = {};
    return s.trial;
  }

  function chapterUnlocked(ch) { const r = typeof ch === 'object' ? ch.realm : ch; return S().realm.index >= r; }
  function levelUnlocked(chRealm, idx) {
    if (idx === 1) return chapterUnlocked(chRealm);
    return !!trialState().cleared[chRealm + '_' + (idx - 1)];
  }
  function isCleared(ch, idx) { return !!trialState().cleared[ch.realm + '_' + idx]; }
  /** 帝路解锁：飞升（index 9）入场；第 idx 关需先通前一关 */
  function imperialUnlocked(idx) {
    if (S().realm.index < 9) return false;
    if (idx == null || idx <= 1) return true;
    return !!trialState().cleared['imperial_' + (idx - 1)];
  }

  /** 挂机灵石锚定（甲§9）：首通 600s / 扫荡 90s 产量 */
  function anchorLingshi(seconds) {
    const eco = g.LS.economy;
    return Math.max(50, Math.floor(eco.computePerSecond('lingshi') * seconds));
  }

  /** 扫荡计数：现实小时窗口 5 次/关 */
  function sweepLeft(ch, idx) {
    const st = trialState();
    const key = ch.realm + '_' + idx;
    const nowH = Math.floor(Date.now() / 3600000);
    const rec = st.sweeps[key];
    if (!rec || rec.h !== nowH) return 5;
    return Math.max(0, 5 - rec.n);
  }
  function sweepCount(ch, idx) {
    const st = trialState();
    const key = ch.realm + '_' + idx;
    const nowH = Math.floor(Date.now() / 3600000);
    const rec = st.sweeps[key];
    if (!rec || rec.h !== nowH) { st.sweeps[key] = { h: nowH, n: 1 }; return; }
    rec.n += 1;
  }

  /** 野怪生成：前缀名池 × 随机灵根 × 「境界≤章」卡池抽 4~5 招（乙§5.2）；ch 可为章节对象或境界数字 */
  function buildMob(ch) {
    const LVd = LV();
    const realmNum = typeof ch === 'object' ? ch.realm : ch;
    const prefixes = LVd.mob_prefixes || ['山贼'];
    const name = prefixes[Math.floor(Math.random() * prefixes.length)];
    const els = ['金', '木', '土', '水', '火'];
    const el = els[Math.floor(Math.random() * els.length)];
    const pool = ((g.LS.BAL.cultivation || {}).battle_cards || {}).my_cards || [];
    const candidates = pool.filter(c => (c.unlock_realm || 0) <= realmNum && (c.price || c.default || c.unlock_realm)); // 战斗牌（含基础默认牌）
    const moves = [];
    const n = 4 + Math.floor(Math.random() * 2);
    const shuffled = candidates.slice().sort(() => Math.random() - 0.5);
    for (const c of shuffled) {
      if (moves.length >= n) break;
      moves.push({ name: c.name, cost: c.cost, dmg: c.dmg || 0, shield: c.shield || 0, heal: c.heal || 0, el: c.el === 'root' ? el : (c.el || null), cd: c.cd || 0 });
    }
    return { name, realm: realmNum, element: el, moves, hpMult: 1 };
  }

  /** 开战：组装 op 交给 battle（mode:'trial'，胜负回调 trialSettle） */
  function fight(chRealm, idx) {
    const LVd = LV();
    const ch = (LVd.chapters || []).find(x => x.realm === chRealm);
    if (!ch) return;
    const lv = ch.levels[idx - 1];
    if (!levelUnlocked(chRealm, idx)) { g.LS.ui.toast('先过前面一关'); return; }
    let spec;
    if (lv.kind === 'boss') {
      const boss = (((g.LS.BAL.cultivation || {}).battle_cards || {}).ai_cards || {}).trial_bosses[chRealm];
      spec = boss ? Object.assign({}, boss, { hpMult: lv.hpMult }) : buildMob(ch);
    } else {
      spec = buildMob(ch);
      spec.hpMult = lv.hpMult;
    }
    if (lv.teach && !S().seen_hints['trial_t' + chRealm + '_' + idx]) {
      S().seen_hints['trial_t' + chRealm + '_' + idx] = 1;
      g.LS.ui.toast('【斗法手册】' + lv.teach, 5200);
    }
    g.LS.battle.startTrialFight(spec, { chRealm, idx, kind: lv.kind, drop: lv.drop, chapter: ch });
  }

  function fightImperial(idx) {
    const LVd = LV();
    const imp = (LVd.imperial || [])[idx - 1];
    if (!imp) return;
    if (!imperialUnlocked(idx)) { g.LS.ui.toast('先破前面的守关者'); return; }
    const boss = (((g.LS.BAL.cultivation || {}).battle_cards || {}).ai_cards || {}).imperial_guards[idx - 1];
    const spec = boss ? Object.assign({}, boss, { hpMult: imp.hpMult, realm: 10 }) : null;
    if (!spec) { g.LS.ui.toast('守关者数据缺失'); return; }
    g.LS.battle.startTrialFight(spec, { chRealm: 10, idx, kind: 'imperial', imperialIdx: idx, drop: { stele: 1 } });
  }

  /** 胜利结算（battle.js 回调）：首通锚定奖励+掉落；记录 cleared */
  function settle(ctx) {
    const s = S();
    const st = trialState();
    const key = (ctx.imperialIdx ? 'imperial_' + ctx.imperialIdx : ctx.chRealm + '_' + ctx.idx);
    const first = !st.cleared[key];
    st.cleared[key] = true;
    const lines = [];
    let lingshi = 0;
    if (first) {
      lingshi = anchorLingshi((ctx.drop && ctx.drop.lingshi_seconds) || 600);
      s.resources.lingshi += lingshi;
      lines.push('首通！灵石 +' + U().fmt(lingshi));
      if (ctx.drop && ctx.drop.stele) {
        s.diwen = (s.diwen || 0) + ctx.drop.stele;
        lines.push('得【帝纹】×' + ctx.drop.stele + '——大帝雷劫每重通过率 +2%/枚。');
      } else {
        // 掉落 roll：30% 功法/武器（本境可买档随机一件免费入囊）、50% 丹（珍品权重）、20% 空（甲§9）
        const roll = Math.random();
        const cul = g.LS.BAL.cultivation || {};
        if (roll < 0.3) {
          const gearPool = Math.random() < 0.5 ? (cul.weapons || []) : (cul.techniques || []);
          const fitting = gearPool.filter(x => (x.unlock_realm != null ? x.unlock_realm : guessRealm(x)) <= ctx.chRealm && x.price);
          if (fitting.length) {
            const it = fitting[Math.floor(Math.random() * fitting.length)];
            if (gearPool === (cul.weapons || [])) { s.weapons_owned = s.weapons_owned || []; s.weapons_owned.push(it.id); }
            else { s.techniques_owned = s.techniques_owned || []; s.techniques_owned.push(it.id); }
            lines.push('掉落【' + it.name + '】！已收入囊中。');
          }
        } else if (roll < 0.8) {
          const q = Math.random() < 0.5 ? '珍' : '灵';
          const key2 = 'qingxin_' + q;
          s.pill_stock = s.pill_stock || {};
          s.pill_stock[key2] = (s.pill_stock[key2] || 0) + 1;
          lines.push('掉落' + q + '品清心丹 ×1。');
        }
      }
    } else {
      lingshi = anchorLingshi(90);
      s.resources.lingshi += lingshi;
      lines.push('再胜一场，灵石 +' + U().fmt(lingshi));
    }
    g.LS.save.save();
    return { lines, lingshi, first };
  }

  function guessRealm(item) { return 0; }

  /** 扫荡（已通关才可用） */
  function sweep(chRealm, idx) {
    if (!isCleared(chRealm, idx)) { g.LS.ui.toast('先首通此关'); return; }
    if (sweepLeft(chRealm, idx) <= 0) { g.LS.ui.toast('此关本小时扫荡次数已用完（5 次/时）'); return; }
    sweepCount(chRealm, idx);
    const ls = anchorLingshi(90);
    S().resources.lingshi += ls;
    g.LS.save.save();
    return ls;
  }

  g.LS.trial = {
    chapterUnlocked, levelUnlocked, isCleared, imperialUnlocked, sweepLeft,
    fight, fightImperial, sweep, settle, anchorLingshi, buildMob
  };
})(typeof window !== 'undefined' ? window : globalThis);
