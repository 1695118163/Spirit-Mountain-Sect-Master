/**
 * tick.js —— 主循环、时间推进 advanceGame（在线/离线共用）、事件调度器、离线结算。
 * 正确性绝不依赖 tick 次数，只依赖时间戳：dt = (now - lastTick)/1000 一次性交给 advanceGame。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const TICK_MS = 250;
  const CATCHUP_THRESHOLD_S = 300; // >300s 判定为休眠/挂起，走离线结算
  let lastTick = Date.now();
  let nextRenderAt = 0;
  let _timer = null;

  function BAL() { return g.LS.BAL; }
  function S() { return g.LS.S; }

  /**
   * 唯一推进函数：在线与离线共用（离线唯一区别是 modeFactor 与丹药减半、颗数封顶）。
   * opts: { mode:'online'|'offline', efficiency:Number, maxPills:Number }
   */
  function advanceGame(dt, opts) {
    if (!(dt > 0)) return;
    const s = S();
    const bal = BAL();
    const eco = g.LS.economy;
    const mode = (opts && opts.mode) || 'online';
    const o = Object.assign({}, opts, { mode });
    if (mode === 'offline' && o.efficiency === undefined) o.efficiency = bal.offline.efficiency_base;

    s.resources.lingqi += eco.computePerSecond('lingqi', o) * dt;
    s.resources.xiufu += eco.computePerSecond('xiufu', o) * dt;
    s.resources.lingshi += eco.computePerSecond('lingshi', o) * dt;

    eco.pillTick(dt, {
      rateFactor: mode === 'offline' ? bal.offline.pill_online_rate : 1,
      maxPills: o.maxPills
    });

    if (mode === 'online') {
      s.stats.play_seconds += dt;
      eco.autoPillTick(Date.now()); // 元婴被动：自动服丹
    }
    // 游戏历法：现实 1 秒 = 游戏 day_per_second 天（在线离线同速，山中无甲子）
    const dps = (bal.game_time && bal.game_time.day_per_second) || 1;
    s.game_days = (s.game_days || 0) + dt * dps;
    g.LS.state.tickBuffs(Date.now());
    eco.clampAll();
  }

  /** 离线效率 = 50% 基础 + 护山阵 5%/级 + 护身符 10%，封顶 eff_cap（0.85） */
  function offlineEfficiency() {
    const bal = BAL();
    const eco = g.LS.economy;
    let eff = bal.offline.efficiency_base
      + eco.bLevel('hushanzhen') * bal.offline.efficiency_per_level;
    if (eco.hasPrestige('hushenfu')) eff += 0.10;
    return Math.min(eff, bal.offline.eff_cap);
  }

  function doOfflineSettle(gapSec) {
    const bal = BAL();
    const eff = offlineEfficiency();
    const secs = Math.min(gapSec, bal.offline.cap_hours * 3600);
    const before = Object.assign({}, S().resources);
    advanceGame(secs, { mode: 'offline', efficiency: eff, maxPills: bal.offline.pill_max_per_settle });
    const gains = {};
    for (const k in before) gains[k] = S().resources[k] - before[k];
    S().stats.offline_claimed += 1;
    // 离线期间不触发奇遇：结算后重排
    g.LS.events.scheduleNext();
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return { gap: gapSec, secs, eff, gains, capped: gapSec > secs };
  }

  /** 页面加载时（boot.init）调用一次：按 lastSeen 结算离线收益 */
  function settleOffline() {
    const now = Date.now();
    let gap = (now - (S().lastSeen || now)) / 1000;
    if (!(gap > 0)) gap = 0;                            // 时钟回拨：判 0，不补不罚
    if (now < (S().last_seen_max || 0)) gap = 0;        // 高水位防篡改
    if (gap < BAL().offline.min_seconds) return null;
    return doOfflineSettle(gap);
  }

  /**
   * 停滞彩蛋：同一境界停留超过阈值 → 顿悟（好事，加修为+点击增益）
   * 或心魔（坏事，扣修为+产量减益）；练气/筑基只出好事。每境界每次停留只触发一次。
   */
  function stagnationTick(now) {
    const bal = BAL();
    const stg = bal.stagnation;
    if (!stg) return;
    const s = S();
    const st = s.stagnation || (s.stagnation = { since: now, fired_for_realm: -1 });
    if (st.fired_for_realm === s.realm.index) return;
    const need = (stg.min_stay_s_by_realm || [])[s.realm.index];
    if (!need || (now - st.since) / 1000 < need) return;
    st.fired_for_realm = s.realm.index;
    st.since = now;
    const next = bal.realms[s.realm.index + 1];
    const needXp = next && next.need_xp ? next.need_xp : 100;
    const good = s.realm.index <= 1 || Math.random() < (stg.good_weight || 0.6); // 低境只出好事
    const T = (stg.texts || {});
    const eco = g.LS.economy;
    if (good) {
      const ins = stg.insight || {};
      const gain = needXp * g.LS.util.rand(ins.xp_pct_of_need_min || 0.3, ins.xp_pct_of_need_max || 0.5);
      s.resources.xiufu += gain;
      g.LS.state.addBuff({
        id: 'insight_click', mult: 1, click_mult: ins.click_buff_mult || 3,
        ts_end: now + (ins.click_buff_duration_s || 60) * 1000
      });
      if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('【顿悟】' + (T.insight_text || ''));
      if (g.LS.ui && g.LS.ui.pushLog) g.LS.ui.pushLog({ title: '顿悟', choice: '停滞中灵光一闪', gainText: '修为 +' + g.LS.util.fmt(gain) });
      g.LS.events.chronicle('insight', {});
    } else {
      const xm = stg.xinmo || {};
      const lose = s.resources.xiufu * g.LS.util.rand(xm.xp_lose_pct_min || 0.05, xm.xp_lose_pct_max || 0.15);
      s.resources.xiufu = Math.max(0, s.resources.xiufu - lose);
      g.LS.state.addBuff({
        id: 'xinmo_debuff', mult: xm.debuff_mult || 0.7,
        ts_end: now + g.LS.util.randInt(xm.debuff_duration_s_min || 60, xm.debuff_duration_s_max || 180) * 1000
      });
      if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('【心魔】' + (T.xinmo_text || ''));
      if (g.LS.ui && g.LS.ui.pushLog) g.LS.ui.pushLog({ title: '心魔', choice: '久困此境，道心蒙尘', gainText: '修为 -' + g.LS.util.fmt(lose) });
      g.LS.events.chronicle('xinmo', {});
    }
    eco.clampAll();
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
  }

  function loopStep() {
    const now = Date.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    if (dt <= 0) return;
    if (dt > CATCHUP_THRESHOLD_S) {
      // 系统休眠等超长间隔：电脑睡了=离线，按离线效率补算并弹结算
      const r = doOfflineSettle(dt);
      if (g.LS.ui && g.LS.ui.showOfflinePopup) g.LS.ui.showOfflinePopup(r);
      if (g.LS.ui && g.LS.ui.renderAll) { nextRenderAt = now + TICK_MS; g.LS.ui.renderAll(); }
      return;
    }
    advanceGame(dt, { mode: 'online' }); // 后台节流的大 dt 全额补算（隐藏期间按在线效率累计）
    stagnationTick(now);
    g.LS.events.maybeTriggerEvent(now);
    if (now >= nextRenderAt) {
      nextRenderAt = now + TICK_MS;
      if (g.LS.ui && g.LS.ui.renderAll) g.LS.ui.renderAll();
    }
  }

  function startLoop() {
    lastTick = Date.now();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(loopStep, TICK_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  function onVisibilityChange() {
    // 回到可见：lastTick 交给下一次 loopStep 的大 dt 自然处理（节流只降低分辨率不损失总量）
    lastTick = Date.now() - Math.min(Date.now() - lastTick, CATCHUP_THRESHOLD_S * 1000 - 1000);
  }

  g.LS.tick = { TICK_MS, CATCHUP_THRESHOLD_S, startLoop, loopStep, advanceGame, settleOffline, doOfflineSettle, onVisibilityChange, offlineEfficiency, stagnationTick };
})(typeof window !== 'undefined' ? window : globalThis);
