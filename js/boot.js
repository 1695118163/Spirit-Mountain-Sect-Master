/**
 * boot.js —— 启动器：数据加载链 → 迁移 → 离线结算 → 开循环（必须是最后一个加载的脚本）。
 * 数据加载链：① 相对路径（http 托管）→ ② 代理接口（file://）→ ③ 失败遮罩报错。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  function fatalOverlay(msg) {
    const el = document.getElementById('fatal-overlay');
    if (!el) { document.body.innerHTML = '<div style="padding:40px;font-size:20px">' + msg + '</div>'; return; }
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  async function loadData() {
    // ① 相对路径：页面经 http://127.0.0.1:8787 静态托管打开时命中（推荐调试路径）
    try {
      const r1 = await fetch('./data/balance.json');
      const r2 = await fetch('./data/events.json');
      if (r1.ok && r2.ok) {
        const balance = await r1.json();
        const events = await r2.json();
        if (balance && Array.isArray(balance.buildings) && Array.isArray(events)) {
          let chains = [];
          try {
            const r3 = await fetch('./data/chains.json');
            if (r3.ok) chains = (await r3.json()).chains || [];
          } catch (e) {}
          try {
            const r4 = await fetch('./data/pills.json');
            if (r4.ok) balance.pills = (await r4.json());
          } catch (e) {}
          try {
            const r5 = await fetch('./data/help.json');
            if (r5.ok) balance.help = (await r5.json());
          } catch (e) {}
          try {
            const r6 = await fetch('./data/cultivation.json');
            if (r6.ok) balance.cultivation = (await r6.json());
          } catch (e) {}
          try {
            const r7 = await fetch('./data/levels.json');
            if (r7.ok) balance.levels = (await r7.json());
          } catch (e) {}
          try {
            const r8 = await fetch('./data/story.json');
            if (r8.ok) balance.story = (await r8.json());
          } catch (e) {}
          try {
            const r9 = await fetch('./data/offline_events.json');
            if (r9.ok) balance.offline_events = (await r9.json());
          } catch (e) {}
          return { balance, events, chains };
        }
      }
    } catch (e) { /* file:// 下此处会留一条 CORS 控制台噪音，属预期 */ }
    // ② 代理接口：页面以 file:// 打开、代理已启动时命中
    try {
      const r = await (await fetch('http://127.0.0.1:8787/api/balance')).json();
      if (r && r.ok && r.balance && Array.isArray(r.balance.buildings)) {
        r.balance.pills = r.pills || {};
        r.balance.help = r.help || {}; r.balance.cultivation = r.cultivation || {};
        r.balance.offline_events = r.offline_events || {};
        return { balance: r.balance, events: r.events, chains: r.chains || [] };
      }
    } catch (e) {}
    // ③ 双双失败：整屏遮罩报错
    fatalOverlay('读不到 balance.json：请先双击 start.bat 启动本地代理，然后刷新本页。');
    return null;
  }

  async function init() {
    const data = await loadData();
    if (!data) return;
    g.LS.BAL = data.balance;
    g.LS.EVT = data.events;
    g.LS.CHAINS = data.chains || [];

    // 存档：load → migrate（失败已备份并开新档）
    const r = g.LS.save.load();
    g.LS.S = r.ok ? r.state : g.LS.state.NEW_STATE();

    // UI 引用与首屏
    g.LS.ui.initRefs();
    g.LS.ui.drawBg();

    // 离线结算（先结算再开循环，防重复结算）
    const off = g.LS.tick.settleOffline();
    g.LS.ui.renderAll();
    // 离线归来 = 一串事件：结算单打头，后面跟独立池事件 + 故人 / 托梦（依次弹）
    if (off) g.LS.events.queueOfflineReturn(off);

    // 主循环 + 自动存档 + LLM 状态探测
    g.LS.tick.startLoop();
    g.LS.save.scheduleAutoSave();
    g.LS.llm.checkHealth();
    setInterval(() => g.LS.llm.checkHealth(), 60000);
    g.LS.dev.initDev();
    if (g.LS.ui.applyLowFx) g.LS.ui.applyLowFx(); // 低性能模式（存档设置）：先于环境层初始化，省掉雾带烘焙
    if (g.LS.ambient) g.LS.ambient.init(); // 环境动画层（云雾/墨鹤/天气）
    if (g.LS.ui.applyLowFx) g.LS.ui.applyLowFx();
    if (g.LS.S.settings.music && g.LS.ui.setBgm) g.LS.ui.setBgm(true);

    // 首次引导（仅首次，存档 flags 后不再弹）
    try {
      if (!localStorage.getItem('lingshan_tutorial_done')) {
        g.LS.ui.showTutorial(g.LS.BAL.texts.tutorial || []);
        localStorage.setItem('lingshan_tutorial_done', '1');
      }
    } catch (e) {}
    // 新档难度选择：未定过难度且刚开局时弹一次
    if (!g.LS.S.settings.difficulty && g.LS.S.stats.play_seconds < 5) {
      setTimeout(() => g.LS.ui.showDifficultyPick(), 800);
    }
    // 版本更新公告：balance.update_notes 版本变化时弹一次，点叉关（seen_update 记已读）
    try {
      const notes = g.LS.BAL.update_notes;
      if (notes && notes.version && g.LS.S.seen_update !== notes.version && g.LS.ui.showUpdateNotes) {
        setTimeout(() => g.LS.ui.showUpdateNotes(notes), 2600); // 让离线卷轴/首引先走
      }
    } catch (e) {}
  }

  g.LS.boot = { loadData, init };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
