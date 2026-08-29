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
    return S().resources.xiufu >= next.need_xp;
  }

  function doBreakthrough() {
    const next = nextRealm();
    if (!next || next.need_xp == null) return false;
    if (S().resources.xiufu < next.need_xp) return false;
    const s = S();
    // cost_mode 'consume'：突破消耗全部当前修为（扣表中所需；清零重攒）
    if (!BAL().breakthrough || BAL().breakthrough.cost_mode !== 'gate') {
      s.resources.xiufu = Math.max(0, s.resources.xiufu - next.need_xp);
    } else {
      s.resources.xiufu = 0;
    }
    s.realm.index = next.index;
    s.prestige.lifetime_best_realm = Math.max(s.prestige.lifetime_best_realm, next.index);
    if (next.reward_lingshi) s.resources.lingshi += next.reward_lingshi;
    s.stats.breakthroughs += 1;
    // 新解锁建筑标记（卡片"新"角标置顶 30 秒）
    if (g.LS.ui && g.LS.ui.markNewBuildings) g.LS.ui.markNewBuildings(next.unlock_buildings || []);
    if (g.LS.ui && g.LS.ui.showBreakthroughOverlay) {
      const bt = (BAL().realm_break_text || []).find(x => x.index === next.index);
      const gainText = next.reward_lingshi ? '灵石 +' + g.LS.util.fmt(next.reward_lingshi) : '';
      g.LS.ui.showBreakthroughOverlay(bt ? bt.text : next.name, gainText);
    }
    if (g.LS.ui && g.LS.ui.pushLog) {
      g.LS.ui.pushLog({ title: '破境 · ' + next.name, choice: '境界精进', gainText: next.reward_lingshi ? '灵石 +' + g.LS.util.fmt(next.reward_lingshi) : '' });
    }
    // 飞升结算：强烈引导转生（不强制）
    if ((next.traits || []).indexOf('ascension') !== -1 && g.LS.ui && g.LS.ui.toast) {
      g.LS.ui.toast('你已飞升。兵解转世，来世可携传承重修。');
    }
    // 化神解锁转生提示
    if ((next.traits || []).indexOf('unlock_rebirth') !== -1 && g.LS.ui && g.LS.ui.toast) {
      g.LS.ui.toast(BAL().texts.rebirth_first_hint);
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
    fresh.prestige.lifetime_best_realm = 0;
    fresh.prestige.first_event_after_rebirth = fresh.prestige.bought.indexOf('qianshijiyuan') !== -1;
    fresh.prestige.points += gain;
    fresh.prestige.total_points += gain;
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
    realmInfo, realmMult, canBreakthrough, doBreakthrough,
    unlockedBuildingIds, unlockedEventPools,
    canRebirth, rebirthGain, doRebirth
  };
})(typeof window !== 'undefined' ? window : globalThis);
