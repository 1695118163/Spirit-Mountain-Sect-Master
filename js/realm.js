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
      if (S().dao_heart > bt.dao_heart_bonus.high) rate += bt.dao_heart_bonus.pct;
      else if (S().dao_heart < bt.dao_heart_bonus.low) rate -= bt.dao_heart_bonus.pct;
    }
    // 难度修正：困难档冲关更凶险，简单档更稳
    if (rate < 1 && g.LS.economy.difficultyCfg) rate += g.LS.economy.difficultyCfg().fail_rate_add || 0;
    return Math.max(0.1, Math.min(1, rate));
  }

  /* ── 保命装与死亡链（甲 §6/§8 + 乙批驳三的统一入口） ── */
  function relicOf(id) { const r = S().relics; return !!(r && r[id] && !r[id + '_broken'] && !(id === 'huanhunjia' && r.huanhunjia_used)); }
  function getTalentLv(id) { const b = S().prestige && S().prestige.bought; return b ? b.filter(x => x === id).length : 0; }
  function xinmoOf() { const v = S().xinmo; return typeof v === 'number' ? v : 0; }
  function diwenCount() { const v = S().diwen; return typeof v === 'number' ? v : 0; }
  function causeText(cause) {
    return ({ tribulation: '殒于天劫', emperor: '殒于帝劫', battle: '殒于邪修之手', event: '身死道消' })[cause] || '身死道消';
  }

  /** 死亡判定链：名刀（碎裂免死、降级）→ 还魂甲（一世一次、降级）→ 真死（强制转生）。
   *  cause: 'tribulation'|'emperor'|'battle'|'event'；返回 'mingdao'|'huanhun'|'death' */
  function resolveDeath(cause) {
    const s = S();
    s.relics = s.relics || {};
    if (s.relics.mingdao && !s.relics.mingdao_broken) {
      s.relics.mingdao_broken = true;
      if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('【名刀·司命】替主碎裂——刀鸣如泣，这一劫，免了！（花半价可重铸）');
      return 'mingdao';
    }
    if (s.relics.huanhunjia && !s.relics.huanhunjia_used) {
      s.relics.huanhunjia_used = true;
      if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('【九转还魂甲】裹住魂光——肉身虽陨，你从死亡里硬生生走了回来！（一世一次）');
      return 'huanhun';
    }
    if (g.LS.events && g.LS.events.chronicle) g.LS.events.chronicle('event', { title: causeText(cause), choice: '形神俱灭' });
    if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast(causeText(cause) + '——形神俱灭，堕入轮回。（本世存档已封存备份，传承点照常结算）');
    backupForRebirth();
    doRebirth(true);
    return 'death';
  }

  /** 组合数（九重雷劫过率用） */
  function combi(n, k) { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }
  /** 落空不超过 miss 道的概率（p = 每道过率） */
  function binomAtMost(n, miss, p) {
    let acc = 0;
    for (let k = 0; k <= miss; k++) acc += combi(n, k) * Math.pow(1 - p, k) * Math.pow(p, n - k);
    return acc;
  }

  /** 帝劫数值（面板与引擎唯一出处，不消耗任何状态；extraBonus 供面板试算破障丹） */
  function emperorOdds(extraBonus) {
    const s = S();
    const tb = (BAL().breakthrough && BAL().breakthrough.tribulation) || {};
    let p = tb.base_p != null ? tb.base_p : 0.70;
    if (s.bt && s.bt.breakthrough_bonus) p += s.bt.breakthrough_bonus;
    p += getTalentLv('tiandao_qin') * 0.04 + diwenCount() * 0.02;
    const xm = xinmoOf();
    if (xm >= 85) p -= 0.20; else if (xm >= 60) p -= 0.12; else if (xm >= 30) p -= 0.06;
    if (extraBonus) p += extraBonus;
    p = Math.max(0.55, Math.min(tb.cap != null ? tb.cap : 0.85, p));
    const strikes = tb.strikes || 9;
    const layers = (tb.death_layers || 2) + (relicOf('mingdao') ? 1 : 0);
    return { p: p, strikes: strikes, layers: layers, pass: binomAtMost(strikes, layers, p),
             perStrikeLoss: tb.per_strike_xp_loss != null ? tb.per_strike_xp_loss : 0.3, hasMingdao: relicOf('mingdao') };
  }

  /** 大帝九重雷劫（甲 §3）：连续 9 道天雷独立判定，失败积劫伤（修为-30%/层），2 层形神俱灭
      opts 必须透传（原缺失 → 第 101 行 ReferenceError，点「出关」直接崩）；opts.pillBonus = 破障丹加成 */
  function emperorTribulation(next, opts) {
    const s = S();
    const bal = BAL();
    const tb = (bal.breakthrough && bal.breakthrough.tribulation) || {};
    const odds = emperorOdds((opts && opts.pillBonus) || 0);
    const p = odds.p;
    if (s.bt && s.bt.breakthrough_bonus) s.bt.breakthrough_bonus = 0; // 已计入 odds.p（破障丹类），用后即清
    const allowLayers = odds.layers;
    const results = [];
    for (let i = 0; i < (tb.strikes || 9); i++) results.push(Math.random() < p);
    const fails = results.filter(x => !x).length;
    const survived = fails <= allowLayers;
    const replay = Object.assign({}, opts, { skipTribulation: true });
    const finish = () => {
      s.resources.xiufu = Math.max(s.resources.xiufu, next.need_xp); // 重入放行
      if (survived) {
        doBreakthrough(Object.assign({}, replay, { forceSuccess: true }));
      } else {
        // 劫伤结算：每层 -30% 修为，保命装介入
        const layers = Math.min(fails, 3);
        for (let i = 0; i < layers; i++) s.resources.xiufu *= (1 - (tb.per_strike_xp_loss || 0.3));
        const how = resolveDeath('emperor');
        if (how === 'death') return; // 强制转生已发生
        // 名刀（大帝：容错+1 已计入）/还魂甲（渡劫终止算普通失败）：修为已扣，回到飞升境养伤
        s.bt.fail_streak = (s.bt.fail_streak || 0) + 1;
        s.bt.fail_cooldown_until = Date.now() + ((bal.breakthrough && bal.breakthrough.fail_cooldown_s) || 30) * 1000;
        if (g.LS.ui && g.LS.ui.showFailOverlay) g.LS.ui.showFailOverlay('帝 劫 未 渡', '九重天雷' + fails + '道落空，' + (how === 'mingdao' ? '名刀碎裂护你一命' : '还魂甲裹魂还阳') + '——修为十不存三，回飞升境重整旗鼓。', true, { xpLeft: Math.floor(s.resources.xiufu), qihuo: true, cooldown: 30 });
        if (g.LS.save) g.LS.save.save();
      }
    };
    if (g.LS.ui && g.LS.ui.playEmperorTribulation) g.LS.ui.playEmperorTribulation(p, results, survived, finish);
    else finish();
    return survived;
  }

  function doBreakthrough(opts) {
    const next = nextRealm();
    if (!next || next.need_xp == null) return false;
    const s = S();
    if (s.resources.xiufu < next.need_xp) return false;
    const bal = BAL();
    const bt = bal.breakthrough || {};
    const now = Date.now();
    if (s.bt && s.bt.fail_cooldown_until > now && !(opts && opts.failReplay)) return false;

    // ── 成功率判定：基础 × 道心 + 策略 + 破障丹 + 故人上门 + 心魔侵扰 ──
    let rate = breakthroughRate(next);
    let rewardMult = 1;
    if (opts && opts.tactic && bt.tactics && bt.tactics[opts.tactic]) {
      rate += bt.tactics[opts.tactic].rate_add;
      rewardMult = bt.tactics[opts.tactic].reward_mult;
    }
    let pillBonus = 0; // 破障丹加成：普通路进 rate，大帝路进帝劫的每道过率
    // skipTribulation 为真 = 天劫/帝劫动画后的重入（首判已定、丹药首判已扣），别再扣第二次
    // （原缺这个判断：重入时丹已空 → !key → return false → 突破在最后一步静默失败、丹白吃）
    if (opts && opts.usePill && !opts.skipTribulation && bt.pill_guard && s.pill_stock) {
      // 破障丹：低品质先扣
      const order = ['凡', '灵', '珍', '仙'];
      let key = null;
      for (const q of order) { const k = 'pozhang_' + q; if (s.pill_stock[k]) { key = k; break; } }
      if (!key) return false;
      s.pill_stock[key] -= 1;
      if (s.pill_stock[key] <= 0) delete s.pill_stock[key];
      rate += bt.pill_guard.rate_add;
      pillBonus = bt.pill_guard.rate_add || 0;
    }
    // 大帝走九重雷劫：本函数的 rate 全程不参与，故此处不清零，留给 emperorTribulation 计入每道过率
    const goingEmperor = next.index >= 10 && !(opts && opts.skipTribulation) && !(opts && opts.failReplay);
    if (s.bt && s.bt.breakthrough_bonus) {
      rate += s.bt.breakthrough_bonus; // 破障丹等来源的额外成功率
      if (!goingEmperor) s.bt.breakthrough_bonus = 0;
    }
    let guaranteed = !!(s.bt && s.bt.guaranteed);
    if (guaranteed) s.bt.guaranteed = false; // 渡厄丹：下次冲关必成，用后即清
    // 难度修正：困难档冲关更凶险，简单档更稳
    const dfc = g.LS.economy.difficultyCfg ? g.LS.economy.difficultyCfg() : { fail_rate_add: 0, qihuo_add: 0 };
    if (!guaranteed && dfc.fail_rate_add) rate += dfc.fail_rate_add;
    // 故人上门效果：恩人护法+、仇人搅局−（一次性，用后即清）
    if (s.bt && s.bt.visitor_effect && bt.visitors) {
      if (s.bt.visitor_effect === 'boost') rate += bt.visitors.boost_rate_add || 0.10;
      else if (s.bt.visitor_effect === 'disturb') rate += bt.visitors.disturb_rate_add || -0.10;
      s.bt.visitor_effect = '';
    }
    // 心魔侵扰：元婴起冲关有一线可能被心魔缠上（渡厄丹可免），压一成成功率（天劫重入沿用首判）
    let xinmoHit = false;
    const xinmoChance = 0.15 + (dfc.qihuo_add || 0);
    if (next.index >= 3 && !guaranteed && !(opts && opts.failReplay) && !(opts && opts.skipTribulation) && Math.random() < Math.max(0.05, xinmoChance)) {
      xinmoHit = true;
      rate -= 0.15;
      if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('冲关在即，一缕心魔悄然缠上识海——这一关，格外凶险。');
    }
    rate = Math.max(0.05, Math.min(1, rate));
    const pity = bt.pity_success || 3;
    const streak = (s.bt && s.bt.fail_streak) || 0;
    // failReplay：天劫动画重入，沿用首判结果（必败）
    const success = (opts && opts.failReplay) ? false
      : ((opts && opts.forceSuccess) || guaranteed || streak >= pity - 1 || Math.random() < rate);

    // 大帝境：九重雷劫专项，不走普通成败判定
    if (goingEmperor) {
      return emperorTribulation(next, Object.assign({}, opts, { pillBonus: pillBonus }));
    }

    // 升境界天劫：金丹起每次冲关都被雷劈（与失败率体系同起点），练气/筑基保持温和水墨
    if (next.index >= 2 && g.LS.ui && g.LS.ui.playTribulation && !(opts && opts.skipTribulation)) {
      const replay = Object.assign({}, opts, { skipTribulation: true });
      if (!success) s.bt.fail_cooldown_until = now + (bt.fail_cooldown_s || 30) * 1000; // 动画期间拦重复点击
      g.LS.ui.playTribulation(success, () => {
        s.resources.xiufu = Math.max(s.resources.xiufu, next.need_xp); // 重入放行门槛
        doBreakthrough(Object.assign({}, replay, success ? { forceSuccess: true } : { failReplay: true }));
      });
      return success;
    }

    if (!success) {
      // ── 失败分支（数值代价显式呈现给玩家） ──
      s.resources.xiufu = Math.max(0, s.resources.xiufu * (bt.fail_keep_xp_ratio != null ? bt.fail_keep_xp_ratio : 0.5));
      s.bt.fail_streak = streak + 1;
      s.bt.fail_cooldown_until = now + (bt.fail_cooldown_s || 30) * 1000;
      const texts = (bal.stagnation && bal.stagnation.texts) || {};
      let isQihuo = false;
      if (bt.qihuo) {
        let q = (bt.qihuo.base_chance || 0.25) + next.index * (bt.qihuo.chance_growth_per_realm || 0.05);
        if (dfc.qihuo_add) q += dfc.qihuo_add; // 难度修正：困难档更容易走火
        q = Math.max(0, Math.min(q, bt.qihuo.max_chance || 0.5));
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
      // ── 走火 death roll（甲 §8）：只挂走火、金丹起、大帝除外；本关只判一次（failReplay 重入沿用） ──
      if (isQihuo && next.index >= 2 && next.index < 10 && !s.bt.death_rolled && !(opts && opts.skipDeath)) {
        s.bt.death_rolled = true;
        const dc = bt.death || {};
        let dr = (dc.base != null ? dc.base : 0.05) + next.index * (dc.per_realm != null ? dc.per_realm : 0.02);
        const xm = xinmoOf();
        dr *= (dc.xinmo_mult || [1, 2, 3])[xm >= 85 ? 2 : (xm >= 60 ? 1 : 0)];
        if (dfc.fail_rate_add) dr += dfc.fail_rate_add; // 简单难度 -5% 修正（负值压低），下限 0
        if (Math.random() < Math.max(0, dr)) {
          const how = resolveDeath('tribulation');
          if (how === 'death') return false; // 形神俱灭：强制转生已发生
          if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('在生死一线走了回来——但伤势已定，修为十不存一。');
        }
      }
      s.bt.death_rolled = false;
      const details = {
        xpLeft: Math.floor(s.resources.xiufu),
        qihuo: isQihuo,
        cooldown: Math.ceil((bt.fail_cooldown_s || 30))
      };
      if (g.LS.ui && g.LS.ui.showFailOverlay) g.LS.ui.showFailOverlay(title, text, isQihuo, details);
      // 修炼迟滞（轻档 debuff，可用修为磨净或清心丹）：普通失败三成概率落下病根
      if (!isQihuo && Math.random() < 0.30) {
        g.LS.state.addBuff({ id: 'chidun_debuff', mult: 0.8, cure: 'xp|pill', ts_end: now + 300 * 1000 });
        if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('落下了病根：修炼迟滞（产量−20%）。可用修为温养冲刷，或服清心丹。');
      }
      if (g.LS.ui && g.LS.ui.pushLog) {
        g.LS.ui.pushLog({ title, choice: '冲关' + next.name + '失利', gainText: isQihuo ? '真气逆行，产量受挫' : '修为保留过半，稍作调息' });
      }
      if (g.LS.events) g.LS.events.chronicle(isQihuo ? 'qihuo' : 'event', { title, choice: '冲关失利' });
      if (g.LS.save && g.LS.save.save) g.LS.save.save();
      return false;
    }

    // ── 成功分支 ──
    s.resources.xiufu = 0; // 突破消耗全部当前修为，清零重攒（cost_mode 仅作存档兼容记录）
    s.realm.index = next.index;
    s.prestige.lifetime_best_realm = Math.max(s.prestige.lifetime_best_realm, next.index);
    if (s.bt) s.bt.fail_streak = 0;
    if (s.stagnation) { s.stagnation.since = now; s.stagnation.fired_for_realm = -1; } // 停滞计时重置
    if (g.LS.events) g.LS.events.chronicle('breakthrough', { name: next.name });
    // 飞升：本世山志刻碑
    if ((next.traits || []).indexOf('ascension') !== -1 && g.LS.events) g.LS.events.carveStele();
    if (next.reward_lingshi) s.resources.lingshi += Math.floor(next.reward_lingshi * rewardMult);
    s.stats.breakthroughs += 1;
    // 心魔被压下的余韵
    if (xinmoHit && g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('心魔在气海翻腾——你咬牙把它压了下去，有惊无险。');
    // 境界引导：每破一层讲一次这一层能干嘛（不熟悉修仙的玩家也能跟上）
    const guides = bal.texts && bal.texts.guide_by_realm;
    if (guides && guides[next.index] && g.LS.ui && g.LS.ui.toast) {
      setTimeout(((t) => () => g.LS.ui.toast('【' + next.name + '】' + t, 5200))(guides[next.index]), 1600);
    }
    // 新解锁建筑标记（卡片"新"角标置顶 30 秒）
    if (g.LS.ui && g.LS.ui.markNewBuildings) g.LS.ui.markNewBuildings(next.unlock_buildings || []);
    if (g.LS.ui && g.LS.ui.showBreakthroughOverlay) {
      const bt2 = (bal.realm_break_text || []).find(x => x.index === next.index);
      const gain = Math.floor(next.reward_lingshi * rewardMult);
      const gainText = gain ? '灵石 +' + g.LS.util.fmt(gain) : '';
      g.LS.ui.showBreakthroughOverlay(bt2 ? bt2.text : next.name, gainText, next.index);
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
    if (s.prestige.lifetime_best_realm >= 10) pts = Math.floor(pts * (f.dadi_mult || 1.3)); // 大帝被动（与渡劫叠乘）
    return pts;
  }

  function backupForRebirth() {
    try {
      const raw = localStorage.getItem('lingshan_save_v1') || JSON.stringify(S());
      localStorage.setItem('lingshan_save_backup', raw);
      // 站内提示代替强制下载：备份在备份键与「设置→导出」中均可取回
      if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('本世存档已封存备份（设置页可导出留档）。');
    } catch (e) { console.warn('[灵山掌门] 转生备份失败（不影响转生）：', e.message); }
  }

  function doRebirth(force) {
    const bal = BAL();
    if (!force && !canRebirth()) return false;
    const gain = rebirthGain();
    const s = S();
    if (typeof localStorage !== 'undefined' && typeof document !== 'undefined') backupForRebirth();

    // 三世缘：本世结过缘的故人（未回收 tag）结转到跨世账本，来世以转世之身重逢
    if (!s.karma_legacy) s.karma_legacy = {};
    Object.keys(s.tags || {}).forEach(k => {
      const t = s.tags[k];
      if (t && t.weight >= 1) {
        const leg = s.karma_legacy[k] || { worlds: 0, last_stance: t.stance };
        leg.worlds += 1;
        leg.last_stance = t.stance;
        s.karma_legacy[k] = leg;
      }
    });
    // 山志刻碑：本世大事凝成碑文（跨转生保留）
    if (g.LS.events) g.LS.events.carveStele();
    g.LS.events && g.LS.events.chronicle && g.LS.events.chronicle('rebirth', {});
    // 前尘心障（丹瘾种因）转生结转；但若此世以身证道（渡劫以上且道心至善），来世得解
    if (Array.isArray(s.persistent_curses) && s.persistent_curses.length) {
      const redeemed = s.prestige.lifetime_best_realm >= 8 && s.dao_heart >= 50;
      if (redeemed) {
        const idx = s.persistent_curses.indexOf('danyin');
        if (idx !== -1) s.persistent_curses.splice(idx, 1);
        if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('前尘心障，随这一世的证道烟消云散。');
      } else {
        fresh.persistent_curses = s.persistent_curses.slice(); // 记忆与技能跟着你，转生也带过去
        if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('心障随记忆一同转世——来世需以身证道方解。');
      }
    }

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
    // 初始资本（多级：lv1 500气+100石 / lv2 2500气+800石 / lv3 1万气+3000石）
    const capLv = fresh.prestige.bought.filter(x => x === 'chushiziben').length;
    if (capLv > 0) {
      const capTable = [[500, 100], [2500, 800], [10000, 3000]];
      const [qi0, ls0] = capTable[Math.min(capLv, 3) - 1];
      fresh.resources.lingqi += qi0;
      fresh.resources.lingshi += ls0;
    }
    g.LS.S = fresh;
    if (g.LS.ui && g.LS.ui.pushLog) g.LS.ui.pushLog({ title: '转世', choice: bal.texts.rebirth_after_log, gainText: '传承点 +' + gain });
    if (g.LS.ui && g.LS.ui.renderAll) g.LS.ui.renderAll();
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return gain;
  }

  g.LS.realm = {
    realmInfo, realmMult, canBreakthrough, doBreakthrough, breakthroughRate, emperorOdds,
    unlockedBuildingIds, unlockedEventPools,
    canRebirth, rebirthGain, doRebirth
  };
})(typeof window !== 'undefined' ? window : globalThis);
