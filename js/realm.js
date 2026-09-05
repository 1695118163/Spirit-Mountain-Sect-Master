/**
 * realm.js —— 境界表查询、境界乘算、突破判定与执行、解锁集合、转生。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  function BAL() { return g.LS.BAL; }
  function S() { return g.LS.S; }

  function realmInfo(i) {
    i = i === undefined ? S().realm.index : i;
    return BAL().realms[i] || null;
  }

  /** 境界总乘算 = 各段 mult_passive 叠乘（练气×1、筑基后×2、金丹后×2×3…） */
  function realmMult() {
    const realms = BAL().realms;
    let m = 1;
    for (let k = 1; k <= S().realm.index; k++) {
      if (realms[k]) m *= realms[k].mult_passive;
    }
    return m;
  }

  function nextRealm() { return BAL().realms[S().realm.index + 1] || null; }

  function canBreakthrough() {
    const next = nextRealm();
    if (!next || next.need_xp == null) return false;
    const s = S();
    if (s.bt && s.bt.fail_cooldown_until > Date.now()) return false; // 失败后调息冷却
    return s.resources.xiufu >= next.need_xp;
  }

  /**
   * 突破执行。opts：{ forceSuccess }（模拟/调试）、{ tactic: 'steady'|'normal'|'bold' }、{ usePill: bool }。
   * 成功率按目标境界配置；道心影响成功率；策略改变成功率与奖励倍率；服丹护法再+5%（耗 3 丹）；
   * 失败保留部分修为并可能走火入魔（产量减益 + 修为重挫）；连败 pity_success 次后必成（防挫败）。
   */
  function breakthroughRate(next) {
    const s = S();
    const bt = BAL().breakthrough || {};
    let rate = (bt.success_rate_by_realm && bt.success_rate_by_realm[next.index] != null)
      ? bt.success_rate_by_realm[next.index] : 1;
    if (rate < 1 && bt.dao_heart_bonus) {
      if (s.dao_heart > bt.dao_heart_bonus.high) rate += bt.dao_heart_bonus.pct;
      else if (s.dao_heart < bt.dao_heart_bonus.low) rate -= bt.dao_heart_bonus.pct;
    }
    return Math.max(0.1, Math.min(1, rate));
  }

  function doBreakthrough(opts) {
    const next = nextRealm();
    if (!next || next.need_xp == null) return false;
    const s = S();
    if (s.resources.xiufu < next.need_xp) return false;
    const bal = BAL();
    const bt = bal.breakthrough || {};
    const now = Date.now();
    if (s.bt && s.bt.fail_cooldown_until > now) return false;

    // ── 成功率判定：基础 × 道心 + 策略 + 服丹护法 ──
    let rate = breakthroughRate(next);
    let rewardMult = 1;
    if (opts && opts.tactic && bt.tactics && bt.tactics[opts.tactic]) {
      rate += bt.tactics[opts.tactic].rate_add;
      rewardMult = bt.tactics[opts.tactic].reward_mult;
    }
    if (opts && opts.usePill && bt.pill_guard) {
      if (s.resources.danyao < bt.pill_guard.pills) return false;
      s.resources.danyao -= bt.pill_guard.pills;
      rate += bt.pill_guard.rate_add;
    }
    rate = Math.max(0.05, Math.min(1, rate));
    const pity = bt.pity_success || 3;
    const streak = (s.bt && s.bt.fail_streak) || 0;
    const success = (opts && opts.forceSuccess) || streak >= pity - 1 || Math.random() < rate;

    if (!success) {
      // ── 失败分支 ──
      s.resources.xiufu = Math.max(0, s.resources.xiufu * (bt.fail_keep_xp_ratio != null ? bt.fail_keep_xp_ratio : 0.5));
      s.bt.fail_streak = streak + 1;
      s.bt.fail_cooldown_until = now + (bt.fail_cooldown_s || 30) * 1000;
      const texts = (bal.stagnation && bal.stagnation.texts) || {};
      let isQihuo = false;
      if (bt.qihuo) {
        let q = (bt.qihuo.base_chance || 0.25) + next.index * (bt.qihuo.chance_growth_per_realm || 0.05);
        q = Math.min(q, bt.qihuo.max_chance || 0.5);
        if (Math.random() < q) {
          isQihuo = true;
          s.resources.xiufu *= (1 - (bt.qihuo.xp_loss_ratio || 0.5));
          g.LS.state.addBuff({
            id: 'qihuo_debuff',
            mult: bt.qihuo.debuff_mult || 0.5,
            ts_end: now + g.LS.util.randInt(bt.qihuo.debuff_duration_s_min || 120, bt.qihuo.debuff_duration_s_max || 300) * 1000
          });
        }
      }
      const title = isQihuo ? (texts.qihuo_title || '走火入魔') : (texts.fail_title || '突破未成');
      const text = isQihuo ? (texts.qihuo_text || '') : (texts.fail_text || '');
      if (g.LS.ui && g.LS.ui.showFailOverlay) g.LS.ui.showFailOverlay(title, text, isQihuo);
      if (g.LS.ui && g.LS.ui.pushLog) {
        g.LS.ui.pushLog({ title, choice: '冲关' + next.name + '失利', gainText: isQihuo ? '真气逆行，产量受挫' : '修为保留过半，稍作调息' });
      }
      if (g.LS.save && g.LS.save.save) g.LS.save.save();
      return false;
    }

    // ── 成功分支 ──
    if (!bal.breakthrough || bal.breakthrough.cost_mode !== 'gate') {
      s.resources.xiufu = 0; // 消耗全部当前修为（清零重攒）
    } else {
      s.resources.xiufu = 0;
    }
    s.realm.index = next.index;
    s.prestige.lifetime_best_realm = Math.max(s.prestige.lifetime_best_realm, next.index);
    if (s.bt) s.bt.fail_streak = 0;
    if (s.stagnation) { s.stagnation.since = now; s.stagnation.fired_for_realm = -1; } // 停滞计时重置
    if (next.reward_lingshi) s.resources.lingshi += Math.floor(next.reward_lingshi * rewardMult);
    s.stats.breakthroughs += 1;
    // 新解锁建筑标记（卡片"新"角标置顶 30 秒）
    if (g.LS.ui && g.LS.ui.markNewBuildings) g.LS.ui.markNewBuildings(next.unlock_buildings || []);
    if (g.LS.ui && g.LS.ui.showBreakthroughOverlay) {
      const bt2 = (bal.realm_break_text || []).find(x => x.index === next.index);
      const gain = Math.floor(next.reward_lingshi * rewardMult);
      const gainText = gain ? '灵石 +' + g.LS.util.fmt(gain) : '';
      g.LS.ui.showBreakthroughOverlay(bt2 ? bt2.text : next.name, gainText);
    }
    if (g.LS.ui && g.LS.ui.pushLog) {
      const gain2 = Math.floor(next.reward_lingshi * rewardMult);
      g.LS.ui.pushLog({ title: '破境 · ' + next.name, choice: '境界精进', gainText: gain2 ? '灵石 +' + g.LS.util.fmt(gain2) : '' });
    }
    // 飞升结算：强烈引导转生（不强制）
    if ((next.traits || []).indexOf('ascension') !== -1 && g.LS.ui && g.LS.ui.toast) {
      g.LS.ui.toast('你已飞升。兵解转世，来世可携传承重修。');
    }
    // 化神解锁转生提示
    if ((next.traits || []).indexOf('unlock_rebirth') !== -1 && g.LS.ui && g.LS.ui.toast) {
      g.LS.ui.toast(bal.texts.rebirth_first_hint);
    }
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return true;
  }

  function unlockedBuildingIds() {
    return BAL().buildings.filter(b => b.unlock_realm <= S().realm.index).map(b => b.id);
  }

  function unlockedEventPools() {
    return BAL().pools.filter(p => p.unlock_realm <= S().realm.index).map(p => p.id);
  }

  /* ── 转生 ── */

  function canRebirth() {
    return S().realm.index >= BAL().prestige.unlock_realm_index;
  }

  /** 传承点 = floor( 10 × n × (n+1) ÷ 2 × 0.8^次数 )，n=本次最高境界段数；渡劫被动 ×1.2 */
  function rebirthGain() {
    const s = S();
    const f = BAL().prestige.points_formula;
    const n = (s.prestige.lifetime_best_realm || 0) + 1;
    const dim = Math.max(f.dimin_floor || 0.5, Math.pow(f.dimin, s.prestige.count || 0));
    let pts = Math.floor(f.base * n * (n + 1) / 2 * dim);
    if (s.prestige.lifetime_best_realm >= 8) pts = Math.floor(pts * (f.dujie_mult || 1.2)); // 渡劫被动
    return pts;
  }

  function backupForRebirth() {
    try {
      const raw = localStorage.getItem('lingshan_save_v1') || JSON.stringify(S());
      localStorage.setItem('lingshan_save_backup', raw);
      // 额外落盘一份到下载目录（file:// 下浏览器无法直接写项目 backups/，用下载方式留档）
      const blob = new Blob([raw], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'lingshan_backup_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { console.warn('[灵山掌门] 转生备份失败（不影响转生）：', e.message); }
  }

  function doRebirth() {
    const bal = BAL();
    if (!canRebirth()) return false;
    const gain = rebirthGain();
    const s = S();
    if (typeof localStorage !== 'undefined' && typeof document !== 'undefined') backupForRebirth();

    // 重置范围：资源/建筑/境界/Buff 清零；保留：传承点、已兑换、tags 与图鉴（前世记忆）、道心
    const keepPrestige = s.prestige;
    const keepTags = s.tags;
    const keepDao = s.dao_heart;
    const keepStats = s.stats;
    const keepSettings = s.settings;
    const fresh = g.LS.state.NEW_STATE();
    fresh.created_at = s.created_at;
    fresh.v = s.v;
    fresh.realm.index = 0;
    fresh.prestige = keepPrestige;
    fresh.prestige.count += 1;
    fresh.prestige.prestige_count = fresh.prestige.count;
    fresh.stats = keepStats;
    fresh.stats.prestige_count = fresh.prestige.count;
    fresh.tags = keepTags;
    fresh.dao_heart = keepDao;
    fresh.settings = keepSettings;
    fresh.collection = s.collection || {};   // 图鉴跨转生保留
    fresh.chain_seen = s.chain_seen || {};
    fresh.prestige.lifetime_best_realm = 0;
    fresh.prestige.first_event_after_rebirth = fresh.prestige.bought.indexOf('qianshijiyuan') !== -1;
    fresh.prestige.points += gain;
    fresh.prestige.total_points += gain;
    fresh.rebirth_at = Date.now(); // 本世修行计时起点
    // 初始资本
    const capital = bal.prestige.upgrades.find(u => u.id === 'chushiziben');
    if (capital && fresh.prestige.bought.indexOf('chushiziben') !== -1) {
      fresh.resources.lingqi += capital.effect.start_lingqi || 0;
      fresh.resources.lingshi += capital.effect.start_lingshi || 0;
    }
    g.LS.S = fresh;
    if (g.LS.ui && g.LS.ui.pushLog) g.LS.ui.pushLog({ title: '转世', choice: bal.texts.rebirth_after_log, gainText: '传承点 +' + gain });
    if (g.LS.ui && g.LS.ui.renderAll) g.LS.ui.renderAll();
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return gain;
  }

  g.LS.realm = {
    realmInfo, realmMult, canBreakthrough, doBreakthrough, breakthroughRate,
    unlockedBuildingIds, unlockedEventPools,
    canRebirth, rebirthGain, doRebirth
  };
})(typeof window !== 'undefined' ? window : globalThis);
