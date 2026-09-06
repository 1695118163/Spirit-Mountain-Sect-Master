/**
 * battle.js —— 好友斗法引擎：影子生成、四类 QTE、电子拔河、五行克制、结算。
 * 数据：data/cultivation.json（武器/功法/五行/斗法参数）。
 * 全屏接管演出；QTE 计时用 rAF+时间戳（暂停约束同 ambient）。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const CUL = () => (g.LS.BAL && g.LS.BAL.cultivation) || {};
  const S = () => g.LS.S;

  /* ── 名片与影子 ── */

  function myDaoHao() {
    const s = S();
    return '灵曜' + g.LS.util.numToCn(((g.LS.BAL.game_time || {}).start_year || 1) + Math.floor((s.created_at || 0) / 10000) % 900 + 1) + '·掌门';
  }

  /** 我的名片（可复制发给好友） */
  function makeCard() {
    const s = S();
    return {
      v: 1,
      dao: myDaoHao(),
      realm: s.realm.index,
      daoxin: s.dao_heart,
      weapon: s.equip.weapon,
      technique: s.equip.technique,
      honor: s.honor,
      record: s.record,
      ts: Date.now()
    };
  }

  /** 名片 → 影子战力（0~100 归一：境界底盘+武器锋锐+丹毒惩罚） */
  function cardPower(card) {
    const bal = g.LS.BAL;
    const realmEdge = 1.2 ** card.realm;           // 境界复利底盘
    const w = (bal.cultivation.weapons || []).find(x => x.id === card.weapon);
    const t = (bal.cultivation.techniques || []).find(x => x.id === card.technique);
    const sharp = w ? w.sharp : 5;
    const tech = t ? 8 : 3;
    const toxicCut = 1;
    return Math.round(Math.min(100, (realmEdge * 4 + sharp * 0.9 + tech) * toxicCut));
  }

  /* ── 五行克制 ── */
  function elementMult(myEl, opEl) {
    const wx = CUL().wuxing || {};
    if (myEl && opEl && wx.cycle && wx.cycle[myEl] === opEl) return wx.counter_mult || 1.25;
    if (myEl && opEl && wx.cycle && wx.cycle[opEl] === myEl) return wx.countered_mult || 0.85;
    return 1;
  }

  /* ── 拉力计算：功法五行定克制，丹力 buff 与道心只作用于我方 ── */
  function pullOf(card, isShadow, opCard) {
    const p = cardPower(card);
    const w = (CUL().weapons || []).find(x => x.id === card.weapon);
    const t = (CUL().techniques || []).find(x => x.id === card.technique);
    let pull = p;
    if (isShadow) return Math.round(p * (0.9 + Math.random() * 0.2));
    // 我方实时：功法五行克制（我方功法 vs 对方功法）+ 丹力 buff + 道心
    if (t && opCard) {
      const opT = (CUL().techniques || []).find(x => x.id === opCard.technique);
      pull *= elementMult(t.element, opT ? opT.element : '');
    }
    if (S().buffs.some(b => b.id === 'pill_prod' && b.ts_end > Date.now())) pull *= 1.15;
    const dao = S().dao_heart || 0;
    pull *= 1 + dao / 400; // 道心 ±25% 封顶
    return Math.round(pull);
  }

  /* ── 斗法主流程 ── */
  let active = null;

  function startBattle(friend) {
    if (active) return;
    const s = S();
    if (!friend.card) { g.LS.ui.toast('这位道友还没有递过名片'); return; }
    const myCard = makeCard();
    const opCard = friend.card;
    const cfg = CUL().battle || {};
    const myPull = pullOf(myCard, false, opCard);
    const opPull = cardPower(opCard);
    // 境界差：碾压系数
    const diff = Math.abs(opCard.realm - s.realm.index);
    let crush = 1;
    if (diff >= (cfg.crush_at_diff || 3)) crush = cfg.crush_mult || 3;
    else if (diff === 2) crush = 1.3;
    const myBase = myPull * (opCard.realm > s.realm.index ? 1 / (1 + diff * (cfg.realm_edge_pct_per_level || 0.2)) : 1 + Math.min(1, diff * 0.25));
    const opBase = opPull * (s.realm.index > opCard.realm ? 1 : crush);
    // 天命逆转轮（2% 概率，弱势方专属）
    const destiny = Math.random() < ((cfg.destiny_flip || {}).chance || 0.02);
    const rounds = cfg.rounds || 6;
    active = {
      friend, opCard, myBase, opBase, destiny,
      pointer: 0, round: 0, rounds,
      log: []
    };
    g.LS.ui.showBattleArena({
      my: { dao: myDaoHao(), pull: Math.round(myBase) },
      op: { dao: friend.dao || opCard.dao || '道友', pull: Math.round(opBase) },
      rounds
    });
    nextRound();
  }

  function shadowPerf() {
    const cfg = CUL().battle || {};
    const lo = ((cfg.shadow_rand || [])[0]) || 0.75;
    const hi = ((cfg.shadow_rand || [])[1]) || 1.05;
    return 100 * (lo + Math.random() * (hi - lo)) * Math.min(1.2, S().dao_heart >= 0 ? 1 : 0.95);
  }

  function qteWindowScale() {
    // 境界差越大，QTE 窗口越小
    const cfg = CUL().battle || {};
    const diff = Math.abs((active.opCard.realm || 0) - S().realm.index);
    const per = ((cfg.battle || {}).difficulty_window || {}).per_realm_diff || 0.18;
    const min = ((cfg.battle || {}).difficulty_window || {}).min_scale || 0.5;
    return Math.max(min, 1 - diff * per);
  }

  function endRound(myPerf) {
    const a = active;
    const opPerf = shadowPerf() * qteWindowScale();
    let delta = 0;
    if (a.destiny && myBaseOf() < opBaseOf()) {
      delta = 34; // 天命逆转轮：弱势方满拉
      a.log.push('天命逆转！灵机逆涌，一击夺势！');
    } else {
      delta = Math.round(((myPerf - opPerf) / 100) * (CUL().battle.move_pct || 28));
    }
    a.pointer = Math.max(-100, Math.min(100, a.pointer + delta));
    a.log.push('第' + (a.round) + '轮：' + (delta > 0 ? '占得上风 +' + delta : delta < 0 ? '稍逊一筹 ' + delta : '平分秋色'));
    g.LS.ui.updateBattleBar(a.pointer, a.round, a.log[a.log.length - 1]);
    if (Math.abs(a.pointer) >= 100 || a.round >= a.rounds) {
      setTimeout(() => finishBattle(a.pointer), 700);
      return;
    }
    setTimeout(nextRound, 900);
  }

  function myBaseOf() { return active.myBase; }
  function opBaseOf() { return active.opBase; }

  function nextRound() {
    const a = active;
    a.round += 1;
    const types = ['click', 'ring', 'hold', 'rune'];
    const type = types[Math.floor(Math.random() * types.length)];
    g.LS.ui.showQTE(type, a.round, a.rounds, perf => endRound(perf), qteWindowScale());
  }

  function finishBattle(pointer) {
    const a = active;
    const win = pointer > 0 || (pointer === 0 && Math.random() < 0.5);
    const opRealm = a.opCard.realm || 0;
    const diff = Math.max(0, opRealm - S().realm.index);
    const cfg = CUL().battle || {};
    if (win) {
      const honor = (cfg.win_honor_base || 12) + diff * (cfg.win_honor_per_realm_diff || 6);
      S().honor += honor;
      S().record.win += 1;
      g.LS.state.changeDaoHeart(cfg.dao_win || 2);
      if (diff >= 2) {
        const lines = (BAL().chronicle || {}).templates || {};
        S().chronicle_lines && S().chronicle_lines.push(g.LS.util.fmtGameDate(S().game_days || 0) + '，与' + (a.friend.dao || '道友') + '论道，以下克上，一战成名。');
      }
      g.LS.ui.showBattleResult(true, { honor, diff, pointer });
    } else {
      S().record.lose += 1;
      g.LS.state.changeDaoHeart(cfg.dao_lose != null ? cfg.dao_lose : -3);
      g.LS.ui.showBattleResult(false, { honor: 0, diff, pointer });
    }
    g.LS.save.save();
    active = null;
  }

  function abort() { active = null; }

  g.LS.battle = {
    makeCard, cardPower, startBattle, nextRound, endRound, finishBattle, abort,
    elementMult, qteWindowScale, myDaoHao,
    get active() { return active; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
