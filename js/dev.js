/**
 * dev.js —— ?dev=1 调试钩子（window.__lingshan）。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  function initDev() {
    try {
      const byUrl = /[?&]dev=1/.test(typeof location !== 'undefined' ? location.search : '');
      const byStore = (typeof localStorage !== 'undefined') && localStorage.getItem('lingshan_dev') === '1';
      if (!byUrl && !byStore) return;
    } catch (e) { return; }

    const S = () => g.LS.S;

    g.__lingshan = {
      state: () => JSON.parse(JSON.stringify(S())),
      add(res, n) {
        S().resources[res] = (S().resources[res] || 0) + n;
        g.LS.economy.clampAll();
        if (g.LS.ui) g.LS.ui.renderAll();
      },
      skip(seconds) {
        S().lastSeen = Date.now() - seconds * 1000;
        S().last_seen_max = Math.max(S().last_seen_max || 0, S().lastSeen);
        const r = g.LS.tick.settleOffline();
        if (r && g.LS.ui) g.LS.ui.showOfflinePopup(r);
        if (g.LS.ui) g.LS.ui.renderAll();
      },
      event() { g.LS.events.drawEvent(); },
      mockLLM(raw) { g.LS.llm._setMock(raw); },
      realm(i) {
        S().realm.index = i;
        S().prestige.lifetime_best_realm = Math.max(S().prestige.lifetime_best_realm || 0, i);
        if (g.LS.ui) g.LS.ui.renderAll();
      },
      breakthrough() {
        if (!g.LS.realm.canBreakthrough()) {
          const next = g.LS.BAL.realms[S().realm.index + 1];
          if (next && next.need_xp) S().resources.xiufu = next.need_xp;
        }
        g.LS.realm.doBreakthrough();
      },
      pity(n) { S().event_state.since_rare = n || 0; },
      export() { return g.LS.save.exportToText(); },
      import(str) { return g.LS.save.importFromText(str); },
      fastForward(hours) {
        const steps = Math.floor(hours * 3600 / 60);
        for (let i = 0; i < steps; i++) g.LS.tick.advanceGame(60, { mode: 'online' });
        if (g.LS.ui) g.LS.ui.renderAll();
      },
      stats() {
        console.log('[灵山掌门 stats]', JSON.parse(JSON.stringify(S().stats)));
        console.log('[灵山掌门 事件占比] 负面结算占比 =', S().stats.total_settled ? (S().stats.negative_settled / S().stats.total_settled) : 0);
        fetch(g.LS.llm.PROXY + '/api/health').then(r => r.json()).then(j => console.log('[代理健康]', j)).catch(() => console.log('[代理健康] 本地代理未启动'));
      }
    };
    console.log('[灵山掌门] dev 模式已开启：window.__lingshan 可用');
  }

  g.LS.dev = { initDev };
})(typeof window !== 'undefined' ? window : globalThis);
