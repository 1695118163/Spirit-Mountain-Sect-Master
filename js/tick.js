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

  g.LS.tick = { TICK_MS, CATCHUP_THRESHOLD_S, startLoop, loopStep, advanceGame, settleOffline, doOfflineSettle, onVisibilityChange, offlineEfficiency };
})(typeof window !== 'undefined' ? window : globalThis);
