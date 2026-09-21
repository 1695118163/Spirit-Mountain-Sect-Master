/**
 * ui.js —— DOM 引用缓存与定向脏更新、数字动画、弹窗/浮层、设置面板、水墨 Canvas 背景、WebAudio 音效。
 * 渲染策略：缓存引用 + 脏比对，绝不做每秒整树 innerHTML。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const refs = {};
  const uiState = { holdingBreath: false }; // 按住吐纳状态（进度条流转加速用）
  // Buff 详情表（悬停 title 用）：id → 名称与说明
  const BUFF_DETAIL = {
    pill: { name: '丹力', txt: '全身灵机鼓荡，全局产量倍增', badge: '丹力' },
    pill_prod: { name: '灵力丹', txt: '灵力丹药力，全局产量倍增', badge: '丹力' },
    pill_click: { name: '凝神', txt: '凝神丹药力，点击产量大增', badge: '凝神' },
    pill_toxic_debuff: { name: '丹毒攻心', txt: '丹毒攻心：全局产量大减，等它散去或服清心丹', badge: '毒' },
    qihuo_debuff: { name: '走火入魔', txt: '真气逆行：全局产量减半', badge: '劫' },
    xinmo_debuff: { name: '心魔侵扰', txt: '心魔作祟：全局产量下降', badge: '魔' },
    chidun_debuff: { name: '修炼迟滞', txt: '修炼迟滞：全局产量下降，可用修为温养冲刷', badge: '滞' },
    zhuoyuan_debuff: { name: '浊元余毒', txt: '浊元丹余毒：全局产量下降', badge: '浊' },
    insight_click: { name: '顿悟', txt: '灵台清明：点击产量大增', badge: '悟' },
    event_buff: { name: '灵机', txt: '奇遇带来的临时增益', badge: '灵' },
    pill_shield: { name: '避尘', txt: '避尘丹清光护体：邪祟不侵', badge: '护' }
  };
  const lastStr = {};
  let evTimer = null;
  const UPDATE_READ_KEY = 'lingshan_update_read_v1';
  const DECK_PROMPT_DAY_KEY = 'lingshan_deck_prompt_day';
  let pendingUpdateNotes = null;
  let updateNotesTimer = null;
  let pendingDeckPrompt = false;
  let deckPromptTimer = null;
  const newBuildingUntil = {};
  let buildingSig = '';
  let audioCtx = null;

  function toggleDeckCard(deck, card, pool, limits) {
    const next = Array.isArray(deck) ? deck.slice() : [];
    const existing = next.indexOf(card.id);
    if (existing !== -1) {
      next.splice(existing, 1);
      return { ok: true, deck: next, removed: true };
    }
    const cap = (limits || {})[card.kind] || 1;
    const used = next.reduce((count, id) => {
      const entry = pool.find(item => item.id === id);
      return count + (entry && entry.kind === card.kind ? 1 : 0);
    }, 0);
    if (used >= cap) return { ok: false, deck: next, full: true };
    next.push(card.id);
    return { ok: true, deck: next, removed: false };
  }

  function removeDeckCardAt(deck, index) {
    const source = Array.isArray(deck) ? deck : [];
    if (!Number.isInteger(index) || index < 0 || index >= source.length) return source.slice();
    return source.slice(0, index).concat(source.slice(index + 1));
  }

  function $id(id) { return document.getElementById(id); }
  // 心魔阶段标签（滋生/缠身/入魔）：阈值与名称取 balance.xinmo.thresholds，与 #dao-heart 小字同源
  function xinmoStage(v) {
    const ths = (g.LS.BAL && g.LS.BAL.xinmo && g.LS.BAL.xinmo.thresholds) || [];
    let hit = null;
    for (const t of ths) if (v >= t.min) hit = t;
    return hit ? String(hit.name).replace('心魔', '') : '';
  }

  // 手机端底部三面板 Tab（方案一）：只切 body[data-mobtab]，桌面端该属性无任何 CSS 依赖
  function syncMobTabs() {
    if (!refs.mobTabs) return;
    const cur = document.body.dataset.mobtab || 'center';
    refs.mobTabs.querySelectorAll('button[data-tab]').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === cur);
    });
  }
  function fmtSafe(v) { return (g.LS.util && g.LS.util.fmt) ? g.LS.util.fmt(v) : String(Math.floor(v || 0)); }
  function fmtResource(v) {
    if (v === null || v === undefined || !isFinite(v)) return '--';
    const units = [[1e32, '沟'], [1e28, '穰'], [1e24, '秭'], [1e20, '垓'], [1e16, '京'], [1e12, '兆'], [1e8, '亿'], [1e4, '万']];
    const n = Math.abs(v), sign = v < 0 ? '-' : '';
    for (const [base, unit] of units) if (n >= base) return sign + (n / base).toFixed(2) + unit;
    return sign + n.toFixed(2);
  }
  function fmtResourceById(res, v) {
    return (res === 'danyao' || res === 'xinmo' || res === 'toxic' || res === 'daoxin') ? String(Math.floor(v || 0)) : fmtResource(v);
  }
  // 丹毒提示：与 economy 的产量折损同口径（每 10 点 -3%，上限 -30%）
  function toxicHint(v) {
    const pct = Math.min(30, Math.floor((v || 0) / 10) * 3);
    return pct > 0 ? '-' + pct + '% 产量' : '';
  }

  /* ── WebAudio 合成音效（零素材） ── */
  function sfx(type) {
    if (document.hidden || !g.LS.S || !g.LS.S.settings || !g.LS.S.settings.sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      const t = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const gn = audioCtx.createGain();
      o.connect(gn); gn.connect(audioCtx.destination);
      if (type === 'click') {
        o.frequency.setValueAtTime(880, t);
        gn.gain.setValueAtTime(.06, t);
        gn.gain.exponentialRampToValueAtTime(.001, t + .06);
        o.start(t); o.stop(t + .07);
      } else if (type === 'bell') {
        o.frequency.setValueAtTime(660, t);
        o.frequency.exponentialRampToValueAtTime(220, t + .9);
        gn.gain.setValueAtTime(.18, t);
        gn.gain.exponentialRampToValueAtTime(.001, t + 1);
        o.start(t); o.stop(t + 1.1);
      } else if (type === 'drum') {
        // A5 鼓点：低频下扫，垫在钟鸣里
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(45, t + .35);
        gn.gain.setValueAtTime(.3, t);
        gn.gain.exponentialRampToValueAtTime(.001, t + .4);
        o.start(t); o.stop(t + .45);
      } else if (type === 'thunder') {
        // 天劫雷声：噪声爆裂 + 低频轰鸣（原用未定义的 ctx，整段被 try 吞掉 → 一直没声；改 audioCtx）
        const nctx = audioCtx;
        const nb = nctx.createBufferSource();
        const buf = nctx.createBuffer(1, Math.floor(nctx.sampleRate * .5), nctx.sampleRate);
        const dd = buf.getChannelData(0);
        for (let i = 0; i < dd.length; i++) dd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (dd.length / 4));
        nb.buffer = buf;
        const nf = nctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 900;
        const ng = nctx.createGain(); ng.gain.setValueAtTime(.4, t); ng.gain.exponentialRampToValueAtTime(.001, t + .5);
        nb.connect(nf); nf.connect(ng); ng.connect(nctx.destination);
        nb.start(t);
        const o2 = nctx.createOscillator(); o2.type = 'sine';
        o2.frequency.setValueAtTime(90, t); o2.frequency.exponentialRampToValueAtTime(38, t + .5);
        const g2 = nctx.createGain(); g2.gain.setValueAtTime(.28, t); g2.gain.exponentialRampToValueAtTime(.001, t + .55);
        o2.connect(g2); g2.connect(nctx.destination);
        o2.start(t); o2.stop(t + .6);
      } else if (type === 'breakfail') {
        // 冲关失败：一声闷锣——低沉下坠，尾音散在风里（与成功的清钟+鼓点区分开）
        o.type = 'triangle';
        o.frequency.setValueAtTime(200, t);
        o.frequency.exponentialRampToValueAtTime(74, t + 1.1);
        gn.gain.setValueAtTime(.24, t);
        gn.gain.exponentialRampToValueAtTime(.001, t + 1.25);
        o.start(t); o.stop(t + 1.3);
      } else if (type === 'shihuo') {
        // 走火入魔：闷锣之上再叠一层气逆的沙哑嘶声，比普通失败更凶
        o.type = 'triangle';
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(52, t + 1.3);
        gn.gain.setValueAtTime(.26, t);
        gn.gain.exponentialRampToValueAtTime(.001, t + 1.45);
        o.start(t); o.stop(t + 1.5);
        const sctx = audioCtx;
        const sb = sctx.createBufferSource();
        const sbuf = sctx.createBuffer(1, Math.floor(sctx.sampleRate * .7), sctx.sampleRate);
        const sd = sbuf.getChannelData(0);
        for (let i = 0; i < sd.length; i++) sd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sd.length / 5)) * .6;
        sb.buffer = sbuf;
        const sf = sctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 420; sf.Q.value = .8;
        const sg = sctx.createGain(); sg.gain.setValueAtTime(.16, t); sg.gain.exponentialRampToValueAtTime(.001, t + .7);
        sb.connect(sf); sf.connect(sg); sg.connect(sctx.destination);
        sb.start(t);
      } else if (type === 'guqin') {
        o.frequency.setValueAtTime(440, t);
        o.frequency.linearRampToValueAtTime(660, t + .25);
        gn.gain.setValueAtTime(.1, t);
        gn.gain.exponentialRampToValueAtTime(.001, t + .5);
        o.start(t); o.stop(t + .55);
      }
    } catch (e) { /* 音效失败不影响游戏 */ }
  }

  /* ── 引用缓存与事件绑定 ── */
  function initRefs() {
    refs.resRows = {};
    document.querySelectorAll('.res-row').forEach(row => {
      refs.resRows[row.dataset.res] = { val: row.querySelector('.res-val'), rate: row.querySelector('.res-rate') };
    });
    refs.equipWeapon = $id('equip-weapon');
    refs.equipWeaponRow = $id('equip-weapon-row');
    refs.equipTechnique = $id('equip-technique');
    refs.equipTechniqueRow = $id('equip-technique-row');
    refs.buildingList = $id('building-list');
    refs.btnBuyAll = $id('btn-buyall');
    refs.btnBuyAllSet = $id('btn-buyall-set');
    refs.buyallMenu = $id('buyall-menu');
    refs.realmName = $id('realm-name');
    refs.daoHeart = $id('dao-heart');
    refs.gameDate = $id('game-date');
    refs.realTime = $id('real-time');
    refs.xpFill = $id('xp-fill');
    refs.xpText = $id('xp-text');
    refs.xpBar = $id('xp-bar');
    refs.taichiMonk = $id('taichi-monk');
    refs.btnBreath = $id('btn-breath');
    refs.btnBreak = $id('btn-break');
    refs.btnPill = $id('btn-pill');
    refs.btnSettings = $id('btn-settings');
    refs.btnCodex = $id('btn-codex');
    refs.btnHelp = $id('btn-help');
    refs.btnPillHouse = $id('btn-pillhouse');
    refs.btnRebirth = $id('btn-rebirth');
    // 手机端底部三面板 Tab（方案一）：窄屏一次只显示一个面板，桌面端不受影响
    refs.mobTabs = $id('mob-tabs');
    if (refs.mobTabs) {
      document.body.dataset.mobtab = document.body.dataset.mobtab || 'center';
      refs.mobTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-tab]');
        if (!btn) return;
        document.body.dataset.mobtab = btn.dataset.tab;
        syncMobTabs();
        window.scrollTo(0, 0);           // 换面板即回顶，避免停在上一面板的滚动位置
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      });
      syncMobTabs();
    }
    // 洞天福地「一键升级」：反复升「等级最低且买得起」的，直到无可升
    if (refs.btnBuyAll) {
      refs.btnBuyAll.addEventListener('click', () => {
        const r = buyAllAffordable();
        if (r.n > 0) { sfx('click'); toast('一键升级 · ' + buyallSummary(r.by), 2600); }
        else toast('洞天暂无可升级');
        renderBuildings(); renderResources();
      });
    }
    // 齿轮：展开/收起一键升级的设置面板
    if (refs.btnBuyAllSet) {
      refs.btnBuyAllSet.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleBuyallMenu();
      });
    }
    if (refs.buyallMenu) {
      refs.buyallMenu.addEventListener('click', (e) => e.stopPropagation());
      refs.buyallMenu.addEventListener('change', (e) => {
        const t = e.target;
        if (!t) return;
        if (t.name === 'bm-mode') setBuyallCfg({ mode: t.value });
        else if (t.id === 'bm-stone') setBuyallCfg({ useStone: t.checked });
        else if (t.id === 'bm-danyao') setBuyallCfg({ useDanyao: t.checked });
      });
    }
    document.addEventListener('click', () => toggleBuyallMenu(false));
    // 移动端长按菜单拦截：吐纳圆钮与面板按钮长按不再弹出系统菜单
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('#btn-breath, #breath-wrap, button, .panel')) e.preventDefault();
    });
    // 面板按钮统一事件委托（document 级）：元素被任何方式重建/替换都不会丢绑定
    document.addEventListener('click', (e) => {
      const t = e.target.closest('#btn-market, #btn-friends, #btn-deck, #btn-help, #btn-codex, #btn-pillhouse, #btn-settings, #btn-updates, #btn-codexpage, #btn-trial, #btn-xinmo, #btn-mo, #btn-map, #btn-quest, #btn-disciple, .map-spot');
      if (!t) return;
      if (t.id === 'btn-market') showMarket();
      else if (t.id === 'btn-map') g.LS.page.go('map');
      else if (t.id === 'btn-quest') showQuest();
      else if (t.id === 'btn-disciple') showDisciple();
      else if (t.id === 'btn-friends') showFriends();
      else if (t.id === 'btn-deck') showDeckEditor();
      else if (t.id === 'btn-help') showHelpPanel();
      else if (t.id === 'btn-codex') showCodex();
      else if (t.id === 'btn-pillhouse') showPillHouse();
      else if (t.id === 'btn-settings') showSettings();
      else if (t.id === 'btn-updates') showUpdateNotes(g.LS.CHANGELOG, { page: 'server' });
      else if (t.id === 'btn-codexpage') showCodexPage();
      else if (t.id === 'btn-trial') showTrial();
      else if (t.id === 'btn-xinmo') showXinmo();
      else if (t.id === 'btn-mo') showMoPanel();
      else if (t.dataset && t.dataset.spot && t.closest('.map-spot')) {
        const spot = t.dataset.spot;
        if (spot === 'modao') { showMoPanel(); return; }
        if (spot === 'seek') { showDiscipleSeek(); return; }
        if (['dannfang', 'market', 'arena'].indexOf(spot) !== -1) g.LS.page.go(spot);
      }
    });
    refs.logList = $id('log-list');
    refs.permList = $id('perm-list');
    refs.buffBar = $id('buff-bar');
    refs.llmDot = $id('llm-dot');
    refs.forewarn = $id('forewarn');
    refs.modalRoot = $id('modal-root');
    registerPages();
    refs.toastRoot = $id('toast-root');
    refs.topbar = $id('topbar');
    refs.tintSeason = $id('tint-season');
    refs.tintDay = $id('tint-day');
    refs.bg = $id('bg');

    // 吐纳：点击 + 按住连点（每 150ms）
    let holdTimer = null;
    // 连发表现层节流：长按/自动时数值照加不差，但飘字/音效/涟漪 450ms 合并一条（消除每秒 27 次 DOM/音频风暴的卡顿）
    const burst = { on: () => uiState.holdingBreath || !!g.LS.S.auto_breath, qi: 0, xp: 0, timer: null };
    const burstFlush = () => {
      burst.timer = null;
      if (burst.qi <= 0 && burst.xp <= 0) return;
      const q = burst.qi, x = burst.xp;
      burst.qi = 0; burst.xp = 0;
      sfx('click');
      if (!uiState.holdingBreath && !burst.on()) spawnRipple();
      spawnFloatText('+' + fmtSafe(q) + ' 灵气' + (x > 0 ? ' · +' + fmtSafe(x) + ' 修为' : ''), x > 0 ? 'gold' : 'cyan');
    };
    const doBreath = () => {
      const r = g.LS.economy.breath();
      if (burst.on()) {
        burst.qi += r.qi; burst.xp += r.xp;
        if (!burst.timer) burst.timer = setTimeout(burstFlush, 450);
        return;
      }
      sfx('click');
      spawnRipple();
      spawnFloatText('+' + fmtSafe(r.qi) + ' 灵气', 'cyan');
      if (r.xp > 0) spawnFloatText('+' + fmtSafe(r.xp) + ' 修为', 'gold');
    };
    refs.btnBreath.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      uiState.holdingBreath = true;
      doBreath();
      clearInterval(holdTimer);
      holdTimer = setInterval(doBreath, 150);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
      refs.btnBreath.addEventListener(ev, () => { clearInterval(holdTimer); uiState.holdingBreath = false; }));
    // 自动吐纳拨钮：拨开=每 150ms 一次（与手动长按同节奏），关=立即停；手动长按仍可用（两者并存）
    const autoT = document.getElementById('auto-breath');
    if (autoT) {
      autoT.checked = !!g.LS.S.auto_breath;
      refs.btnBreath.classList.toggle('auto-on', !!g.LS.S.auto_breath);
      let autoTimer = null;
      const applyAuto = () => {
        clearInterval(autoTimer);
        if (g.LS.S.auto_breath) autoTimer = setInterval(doBreath, 150);
        refs.btnBreath.classList.toggle('auto-on', !!g.LS.S.auto_breath);
      };
      if (g.LS.S.auto_breath) applyAuto();
      autoT.addEventListener('change', () => {
        g.LS.S.auto_breath = autoT.checked;
        g.LS.save.save();
        applyAuto();
        toast(autoT.checked ? '自动吐纳开启——气息自行流转。' : '自动吐纳关闭——回归手动。');
      });
    }

    refs.btnBreak.addEventListener('click', () => {
      const next = g.LS.BAL.realms[g.LS.S.realm.index + 1];
      if (!next || !next.need_xp || g.LS.S.resources.xiufu < next.need_xp) return;
      if (g.LS.S.bt && g.LS.S.bt.fail_cooldown_until > Date.now()) {
        toast('调息之中，稍候再试（' + Math.ceil((g.LS.S.bt.fail_cooldown_until - Date.now()) / 1000) + ' 秒）');
        return;
      }
      // 故人上门：出关前有未了因果的故人拦在山门外（每 karma 每世一次）
      const visitor = g.LS.events.maybeVisitor('breakthrough');
      if (visitor) {
        g.LS.S.event_state.open = visitor;
        g.LS.S.stats.events_total += 1;
        showEventModal(visitor);
        return; // 处理完上门再点突破
      }
      showBreakthroughPanel(next);
    });
    refs.btnPill.addEventListener('click', () => {
      // 用户反馈：吃丹要能自己挑——顶栏「服丹」改为进丹房页按品质选
      g.LS.page.go('dannfang');
    });
    // 面板按钮已统一走 document 事件委托（见上方），此处不再单绑以免双触发
    refs.btnRebirth.addEventListener('click', () => {
      if (!g.LS.realm.canRebirth()) { toast('修至化神，方见轮回之门。'); return; }
      showRebirthPanel();
    });
  }

  function spawnRipple() {
    const wrap = refs.btnBreath.parentElement;
    const el = document.createElement('span');
    el.className = 'ripple';
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 720);
  }

  /** A4 飘字：圈正上方生成、随机水平散开、上浮缓慢淡出（灵气青 / 修为金） */
  function spawnFloatText(text, kind) {
    if (!refs.btnBreath) return;
    if (g.LS.ambient && g.LS.ambient.isReduced && g.LS.ambient.isReduced()) return;
    const el = document.createElement('span');
    el.className = 'float-num' + (kind === 'gold' ? ' gold' : '');
    el.textContent = text;
    // 随机水平散开 ±70px，多个并发不叠字
    el.style.marginLeft = (Math.random() * 140 - 70) + 'px';
    refs.btnBreath.parentElement.appendChild(el);
    setTimeout(() => el.remove(), 1150);
  }

  /** A4：资源值跨整千/整万时弹跳一次 */
  function popIfMilestone(el, v) {
    const step = v >= 1e4 ? 1e4 : 1e3;
    const k = Math.floor(Math.abs(v) / step);
    const key = el.className + k;
    if (lastStr['pop_' + key] === undefined) { lastStr['pop_' + key] = true; return; }
    if (lastStr['popMilestone_' + (el.id || el.className)] !== String(k)) {
      lastStr['popMilestone_' + (el.id || el.className)] = String(k);
      el.classList.remove('num-pop');
      void el.offsetWidth; // 重启动画
      el.classList.add('num-pop');
      setTimeout(() => el.classList.remove('num-pop'), 220);
    }
  }

  /* ── 资源栏（脏比对） ── */
  function renderEquipmentSummary() {
    if (!refs.equipWeapon || !refs.equipTechnique) return;
    const s = g.LS.S;
    const cul = (g.LS.BAL && g.LS.BAL.cultivation) || {};
    const weapon = (cul.weapons || []).find(x => x.id === (s.equip && s.equip.weapon));
    const technique = (cul.techniques || []).find(x => x.id === (s.equip && s.equip.technique));
    const renderOne = (kind, item, valueEl, rowEl) => {
      const value = item ? item.name + (item.element ? ' · ' + item.element : '') : '未装备';
      if (lastStr['equip_' + kind] !== value) {
        valueEl.textContent = value;
        valueEl.title = value;
        lastStr['equip_' + kind] = value;
      }
      if (rowEl) {
        rowEl.dataset.tip = item
          ? (kind === 'weapon' ? '当前法宝：' : '当前功法：') + (item.grade ? item.grade + '品 · ' : '') + value + (item.desc ? '\n' + item.desc : '')
          : (kind === 'weapon' ? '当前尚未装备法宝' : '当前尚未主修功法');
      }
    };
    renderOne('weapon', weapon, refs.equipWeapon, refs.equipWeaponRow);
    renderOne('technique', technique, refs.equipTechnique, refs.equipTechniqueRow);
  }

  function renderResources() {
    const s = g.LS.S;
    const eco = g.LS.economy;
    for (const res in refs.resRows) {
      const r = refs.resRows[res];
      // 丹药行显示细分库存总数（各品类丹药之和）；心魔行显示心境计量（0~100，非资源产量）
      const v = res === 'xinmo' ? (s.xinmo || 0)
        : res === 'daoxin' ? Math.trunc(s.dao_heart || 0)
        : res === 'toxic' ? Math.floor(s.pill_toxic || 0)
        : (res === 'danyao' && eco.pillTotal ? eco.pillTotal() : (s.resources[res] || 0));
      const str = fmtResourceById(res, v);
      if (lastStr['v_' + res] !== str) {
        if (lastStr['v_' + res] !== undefined) {
          r.val.classList.add('tick-flash');
          setTimeout(((el) => () => el.classList.remove('tick-flash'))(r.val), 180);
          popIfMilestone(r.val, v); // 跨整千/整万弹跳
        }
        r.val.textContent = str;
        if (res === 'toxic') r.val.style.color = v >= 30 ? 'var(--cinnabar)' : '';   // 与丹房同口径：30 起标红
        lastStr['v_' + res] = str;
      }
      const rate = (res === 'xinmo' || res === 'toxic' || res === 'daoxin') ? 0 : eco.computePerSecond(res);
      const rStr = res === 'xinmo' ? xinmoStage(s.xinmo || 0)
        : res === 'daoxin' ? ''
        : res === 'toxic' ? toxicHint(s.pill_toxic || 0)
        : (rate > 0 ? fmtResource(rate) + '/秒' : '');
      if (lastStr['r_' + res] !== rStr) { r.rate.textContent = rStr; lastStr['r_' + res] = rStr; }
    }
    document.querySelectorAll('[data-live-resource]').forEach(el => {
      const res = el.dataset.liveResource;
      let value;
      if (res === 'danyao') value = eco.pillTotal ? eco.pillTotal() : (s.resources.danyao || 0);
      else if (res === 'toxic') value = s.pill_toxic || 0;
      else if (res === 'xinmo') value = s.xinmo || 0;
      else value = s.resources[res] || 0;
      const text = fmtResourceById(res, value);
      if (el.textContent !== text) el.textContent = text;
    });
    document.querySelectorAll('[data-market-cost]').forEach(btn => {
      btn.disabled = (s.resources.lingshi || 0) < Number(btn.dataset.marketCost || 0);
    });
    renderEquipmentSummary();
    checkHints(); // 概念即遇即讲
    updateBuffBar();
  }

  function updateBuffBar() {
    if (!refs.buffBar) return;
    const now = Date.now();
    const buffs = (g.LS.S.buffs || []).filter(b => b.ts_end > now);
    const sig = buffs.map(b => (b.id || 'b') + Math.round(b.ts_end / 1000)).join('|');
    if (lastStr.buffBar === sig) return;
    lastStr.buffBar = sig;
    refs.buffBar.innerHTML = '';
    for (const b of buffs) {
      const chip = document.createElement('span');
      chip.className = 'buff-chip';
      chip.style.cursor = 'help';
      const left = Math.ceil((b.ts_end - now) / 1000);
      // 悬停详情：来源与具体效果（用户反馈：状态看不懂）
      const detail = BUFF_DETAIL[b.id] || { name: b.name || '状态', txt: '' };
      chip.title = detail.name + '：' + detail.txt + '（剩 ' + left + ' 秒）';
      const multTxt = (b.mult && b.mult > 1 ? '×' + b.mult.toFixed(1) + ' ' : '') + (b.click_mult ? '点击×' + b.click_mult.toFixed(0) + ' ' : '');
      chip.textContent = (detail.badge || b.name || '状态') + ' ' + multTxt + left + 's';
      refs.buffBar.appendChild(chip);
    }
  }

  /* ── 建筑面板（结构只在解锁/购买时重建） ── */
  function buildingUnlockSig() {
    return g.LS.BAL.buildings.map(b => b.id + ':' + (g.LS.S.buildings[b.id] || 0) + ':' + (b.unlock_realm <= g.LS.S.realm.index ? 1 : 0)).join(',');
  }

  /**
   * 一键升级（2026-09-19）：反复挑「当前等级最低且买得起」的洞天升上去，
   * 直到没有任何可升级的为止。
   * 依据：成本 = 首级成本 × 增长系数^等级（指数上涨），所以等级最低的那栋
   * 下一级的「单位成本收益」最高；实测该顺序与逐次算性价比的最优解
   * 元婴前完全一致、化神后差 1.3%，且优于作者 sim 的顺序表。
   */
  /** 一键升级设置: { mode:'all'|'one'|'pill', useStone, useDanyao } —— 默认一次花光 */
  function buyallCfg() {
    const st = (g.LS.S && g.LS.S.settings && g.LS.S.settings.buyall) || {};
    return { mode: st.mode || 'all', useStone: st.useStone !== false, useDanyao: st.useDanyao !== false };
  }
  function setBuyallCfg(patch) {
    const s = g.LS.S;
    if (!s) return;
    if (!s.settings) s.settings = {};
    s.settings.buyall = Object.assign(buyallCfg(), patch);
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    syncBuyallMenu();
  }
  function syncBuyallMenu() {
    if (!refs.buyallMenu) return;
    const cfg = buyallCfg();
    const m = refs.buyallMenu.querySelectorAll('input[name=bm-mode]');
    for (const r of m) r.checked = (r.value === cfg.mode);
    const st = refs.buyallMenu.querySelector('#bm-stone'); if (st) st.checked = cfg.useStone;
    const dn = refs.buyallMenu.querySelector('#bm-danyao'); if (dn) dn.checked = cfg.useDanyao;
  }
  function toggleBuyallMenu(force) {
    if (!refs.buyallMenu) return;
    const open = (force === undefined) ? refs.buyallMenu.hasAttribute('hidden') : !!force;
    if (open) { syncBuyallMenu(); refs.buyallMenu.removeAttribute('hidden'); }
    else refs.buyallMenu.setAttribute('hidden', '');
    if (refs.btnBuyAllSet) refs.btnBuyAllSet.classList.toggle('on', open);
  }

  function buyAllAffordable() {
    const eco = g.LS.economy, bal = g.LS.BAL, s = g.LS.S;
    if (!eco || !eco.canAfford || !bal || !s) return 0;
    const cfg = buyallCfg();
    const pillQi = (bal.pill && bal.pill.cost_lingqi_per_pill) || 50;
    const rounds = cfg.mode === 'one' ? 1 : 500;   // 一次只升一级 = 只走一轮
    let n = 0;
    const by = {};                                 // 建筑 id → 升了几级
    for (let guard = 0; guard < rounds; guard++) {
      let pick = null;
      for (const b of bal.buildings) {
        if ((b.unlock_realm || 0) > s.realm.index) continue;
        const cost = eco.buildingCost(b.id);
        if (!cfg.useStone && cost.lingshi) continue;      // 设置：不动灵石
        if (!cfg.useDanyao && cost.danyao) continue;      // 设置：不动丹药
        if (!eco.canAfford(cost)) continue;
        if (cfg.mode === 'pill' && (s.resources.lingqi - (cost.lingqi || 0)) < pillQi) continue;  // 留一颗丹的钱
        if (!pick || (s.buildings[b.id] || 0) < (s.buildings[pick.id] || 0)) pick = b;
      }
      if (!pick) break;
      if (!eco.buyBuilding(pick.id)) break;
      by[pick.id] = (by[pick.id] || 0) + 1;
      n++;
    }
    return { n: n, by: by };
  }

  /** 把升级明细拼成「灵田 +3、灵泉 +2」；种类超过 5 个只列前 5 并加「等」 */
  function buyallSummary(by) {
    const bal = g.LS.BAL;
    const rows = Object.keys(by || {}).map((id) => {
      const b = bal && bal.buildings ? bal.buildings.find((x) => x.id === id) : null;
      return { name: b ? b.name : id, n: by[id] };
    }).sort((a, b) => b.n - a.n);
    const shown = rows.slice(0, 5).map((r) => r.name + ' +' + r.n);
    return shown.join('、') + (rows.length > shown.length ? ' 等' : '');
  }

  function renderBuildings() {
    const bal = g.LS.BAL, s = g.LS.S, eco = g.LS.economy;
    const sig = buildingUnlockSig();
    const structureChanged = sig !== buildingSig;
    if (structureChanged) {
      buildingSig = sig;
      refs.buildingList.innerHTML = '';
      lastStr.bbtn = {};
      // 技能按钮跟卡片一起被清空重造：ab_ 缓存必须一并作废，否则脏比对会跳过写入，按钮就一直空着
      for (const k in lastStr) { if (k.indexOf('ab_') === 0) delete lastStr[k]; }
      for (const b of bal.buildings) {
        const unlocked = b.unlock_realm <= s.realm.index;
        const card = document.createElement('div');
        card.className = 'b-card' + (unlocked ? '' : ' locked');
        card.dataset.id = b.id;
        if (unlocked) {
          const cost = eco.buildingCost(b.id);
          const realmName = bal.realms[b.unlock_realm] ? bal.realms[b.unlock_realm].name : '';
          const rateTxt = b.effects.rate ? Object.keys(b.effects.rate).map(res => {
            const rn = bal.resources.find(x => x.id === res);
            return '+' + b.effects.rate[res] + ' ' + (rn ? rn.name : res) + '/秒/级';
          }).join('，') : (b.effects.pill_per_level ? '每级每 60 秒产 1 颗丹（耗 50 灵气/颗）' : specialEffectText(b));
          const ab = bal.active_abilities && bal.active_abilities[b.id];
          // B3 首购建议：首次买得起后追加进 tooltip
          const sug = (bal.help && bal.help.building_suggest) || {};
          const sugTip = (s.first_afford_seen && s.first_afford_seen[b.id] && (s.buildings[b.id] || 0) === 0 && sug[b.id]) ? '\n建议：' + sug[b.id] : '';
          card.innerHTML =
            '<div class="b-head"><svg class="b-icon" viewBox="0 0 48 48"><use href="#ic-' + b.id + '"/></svg><span class="b-name">' + b.name + '</span><span class="b-lv">Lv.' + (s.buildings[b.id] || 0) + '</span></div>' +
            '<div class="b-desc" data-tip="' + b.desc + '\n当前：' + rateTxt + sugTip + '">' + b.desc + '</div>' +
            '<div class="b-rate">' + rateTxt + '</div>' +
            '<button class="b-buy"></button>' +
            (ab && (s.buildings[b.id] || 0) > 0 ? '<button class="b-ability" data-ab="' + b.id + '"></button>' : '');
          if (newBuildingUntil[b.id] > Date.now()) {
            const badge = document.createElement('span');
            badge.className = 'new-badge';
            badge.textContent = '新';
            card.appendChild(badge);
          }
          const btn = card.querySelector('.b-buy');
          btn.addEventListener('click', () => {
            if (g.LS.economy.buyBuilding(b.id)) sfx('click');
            renderBuildings(); renderResources();
          });
          const abBtn = card.querySelector('.b-ability');
          if (abBtn) abBtn.addEventListener('click', () => {
            const r = g.LS.economy.useAbility(b.id);
            if (r.ok) { sfx('guqin'); toast(r.msg); }
            else toast(r.reason || '暂不可用');
            renderBuildings();
          });
        } else {
          const realmName = bal.realms[b.unlock_realm] ? bal.realms[b.unlock_realm].name : '';
          card.innerHTML = '<div class="b-head"><span class="b-name">' + b.name + '</span></div><div class="b-desc">「' + realmName + '」境解锁</div>';
        }
        refs.buildingList.appendChild(card);
      }
    }
    // 每 tick 只刷新数字与可购态
    const now = Date.now();
    let anyAffordable = false;
    for (const card of refs.buildingList.children) {
      const b = bal.buildings.find(x => x.id === card.dataset.id);
      if (!b) continue;
      const unlocked = b.unlock_realm <= s.realm.index;
      if (!unlocked) continue;
      const lv = s.buildings[b.id] || 0;
      const lvEl = card.querySelector('.b-lv');
      if (lvEl && lastStr['lv_' + b.id] !== String(lv)) { lvEl.textContent = 'Lv.' + lv; lastStr['lv_' + b.id] = String(lv); }
      const btn = card.querySelector('.b-buy');
      if (!btn) continue;
      const cost = eco.buildingCost(b.id);
      const ok = eco.canAfford(cost);
      btn.disabled = !ok;
      if (ok) anyAffordable = true;
      const txt = (lv === 0 ? '建造' : '升级') + ' · ' + eco.costText(cost);
      if (lastStr.bbtn[b.id] !== txt) { btn.textContent = txt; lastStr.bbtn[b.id] = txt; }
      // 首次买得起：只登记 first_afford_seen（tooltip 从此刻起会追加「建议」一行，玩家自己查）
      // 2026-09-19 去掉这里的 toast —— 破境解锁已有交互向导，不再用消息条把同一件事讲一遍
      if (ok && !(s.first_afford_seen || {})[b.id]) {
        if (!s.first_afford_seen) s.first_afford_seen = {};
        s.first_afford_seen[b.id] = true;
      }
      // 建筑主动技能：冷却倒计时与可用态
      const abBtn = card.querySelector('.b-ability');
      if (abBtn) {
        const def = eco.abilityDef(b.id);
        const left = eco.abilityCooldownLeft(b.id);
        const abTxt = def.name + (left > 0 ? '（' + Math.ceil(left / 1000) + 's）' : '！');
        if (lastStr['ab_' + b.id] !== abTxt) { abBtn.textContent = abTxt; lastStr['ab_' + b.id] = abTxt; }
        abBtn.disabled = left > 0;
      }
      // "新"角标 30 秒到期清理
      if (newBuildingUntil[b.id] && newBuildingUntil[b.id] < now) {
        delete newBuildingUntil[b.id];
        const badge = card.querySelector('.new-badge');
        if (badge) badge.remove();
      }
    }
    // 一键升级按钮：有可升级 = 深色实心，无可升 = 浅色
    if (refs.btnBuyAll) refs.btnBuyAll.classList.toggle('on', anyAffordable);
  }

  function specialEffectText(b) {
    const e = b.effects;
    const parts = [];
    if (e.click_qi_per_level) parts.push('点击 +' + e.click_qi_per_level + ' 灵气/次，修为 +' + e.click_xp_per_level + '/次');
    if (e.xp_mult_per_level) parts.push('修为获取 +' + Math.round(e.xp_mult_per_level * 100) + '%/级');
    if (e.all_mult_per_level) parts.push('全局产量 +' + Math.round(e.all_mult_per_level * 100) + '%/级');
    if (e.offline_eff_per_level) parts.push('离线效率 +' + Math.round(e.offline_eff_per_level * 100) + '%/级');
    if (e.pill_speed_per_level) parts.push('炼丹效率 +' + Math.round(e.pill_speed_per_level * 100) + '%/级');
    if (e.click_mult_per_level) parts.push('+' + e.click_mult_per_level * 100 + ' 灵气/秒，点击 +' + Math.round(e.click_mult_per_level * 100) + '%/级');
    return parts.join('，') || b.desc;
  }

  function markNewBuildings(ids) {
    (ids || []).forEach(id => { newBuildingUntil[id] = Date.now() + 30000; });
    buildingSig = ''; // 强制重建
  }

  /* ── 中央修炼区 ── */
  function renderCenter() {
    const bal = g.LS.BAL, s = g.LS.S;
    // 游戏历法（山中无甲子）+ 现实时钟 · 本世修行
    if (refs.gameDate) {
      const gd = g.LS.util.fmtGameDate(s.game_days || 0);
      if (lastStr.gameDate !== gd) { refs.gameDate.textContent = gd; lastStr.gameDate = gd; }
      const d = new Date();
      const dps = (bal.game_time && bal.game_time.day_per_second) || 1;
      const lifeDays = Math.max(0, (Date.now() - (s.rebirth_at || s.created_at)) / 1000 * dps);
      const rt = '现实 ' + d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
        String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') +
        ' · 本世修行 ' + g.LS.util.fmtGameDur(lifeDays);
      if (lastStr.realTime !== rt) { refs.realTime.textContent = rt; lastStr.realTime = rt; }
      // A3 天气：ambient 层按现实时间 2~5 分钟翻新（雨/雪/雾），笔记由 ambient 记录
      if (g.LS.ambient) {
        g.LS.ambient.rollWeather(s.game_days);
        // A2 墨鹤：每分钟碰一次运气
        if (!renderCenter._craneT || Date.now() - renderCenter._craneT > 60000) {
          renderCenter._craneT = Date.now();
          g.LS.ambient.maybeCrane();
        }
      }
      // 山色四时：每季从 2~3 种天时变体随机锁定一种，换季换月时换天色；现实时钟定昼夜（整页夜色主题）
      if (refs.tintSeason) {
        const monthsPerYear = (bal.game_time && bal.game_time.months_per_year) || 12;
        const dayPerMonth = (bal.game_time && bal.game_time.days_per_month) || 30;
        const seasonIdx = Math.min(3, Math.floor(((s.game_days || 0) % monthsPerYear) / (monthsPerYear / 4)));
        const monthIdx = Math.floor((s.game_days || 0) / dayPerMonth) % monthsPerYear;
        const seasonCfg = (bal.seasons || [])[seasonIdx];
        const monthKey = monthIdx + ':' + seasonIdx;
        if (lastStr.monthIdx !== monthKey) {
          lastStr.monthIdx = monthKey;
          if (seasonCfg && seasonCfg.tints.length) {
            const pick = seasonCfg.tints[Math.floor(Math.random() * seasonCfg.tints.length)];
            lastStr.seasonTint = pick;
            refs.tintSeason.style.background = pick;
          }
        } else if (lastStr.seasonTint && refs.tintSeason.style.background !== lastStr.seasonTint) {
          refs.tintSeason.style.background = lastStr.seasonTint;
        }
        // 昼夜：入夜（20 点~次日 5 点）整页切换夜色主题，黄昏一层朱砂残照
        const hh = d.getHours();
        const isNight = hh >= 20 || hh < 5;
        if (document.documentElement.classList.contains('night') !== isNight) {
          document.documentElement.classList.toggle('night', isNight);
        }
        const duskTint = (hh >= 17 && hh < 20) ? 'rgba(168,50,50,.14)' : 'rgba(0,0,0,0)';
        const dayKey = 'n' + isNight + duskTint;
        if (lastStr.day !== dayKey) {
          refs.tintDay.style.background = duskTint;
          refs.tintDay.classList.toggle('moon', isNight);
          lastStr.day = dayKey;
        }
      }
    }
    const realm = bal.realms[s.realm.index];
    const nameStr = realm.name;
    if (lastStr.realm !== nameStr) { refs.realmName.textContent = nameStr; lastStr.realm = nameStr; }
    // 太极小人：境界排面（data-realm 0~9，特效随境界华丽）+ 中咒邪相（debuff 染黑邪雾）
    if (refs.taichiMonk) {
      if (refs.taichiMonk.dataset.realm !== String(s.realm.index)) {
        refs.taichiMonk.dataset.realm = String(s.realm.index);
      }
      const cursed = (s.buffs || []).some(b =>
        b.id === 'qihuo_debuff' || b.id === 'xinmo_debuff' ||
        b.id === 'pill_toxic_debuff' || b.id === 'chidun_debuff' || b.id === 'zhuoyuan_debuff');
      refs.taichiMonk.classList.toggle('cursed', cursed);
    }
    // 境界小层（初期/中期/后期/大圆满）+ 灵根 + 道心：三行小字
    if (refs.daoHeart) {
      const tiers = bal.daoxin.tiers || [];
      const tier = tiers.find(t => s.dao_heart >= t.min);
      const nextR0 = bal.realms[s.realm.index + 1];
      const need0 = nextR0 && nextR0.need_xp ? nextR0.need_xp : 1;
      const frac0 = Math.min(0.999, (s.resources.xiufu || 0) / need0);
      const stageNames = ['初期', '中期', '后期', '大圆满'];
      const stage = stageNames[Math.floor(frac0 * 4)];
      const rootTxt = s.spirit_root ? '　灵根·' + s.spirit_root.key + s.spirit_root.element : '';
      const xm = typeof s.xinmo === 'number' && s.xinmo > 0 ? '　<span style="color:var(--cinnabar)">心魔 ' + s.xinmo + (s.xinmo >= 85 ? '·入魔' : s.xinmo >= 60 ? '·缠身' : s.xinmo >= 30 ? '·滋生' : '') + '</span>' : '';
      const dStr = stage + rootTxt + '　道心 ' + (s.dao_heart > 0 ? '+' : '') + s.dao_heart + (tier ? ' · ' + tier.name : '') + xm;
      if (lastStr.dao !== dStr) { refs.daoHeart.innerHTML = dStr; lastStr.dao = dStr; } // innerHTML：心魔段带朱色 span（内容均为内部数据）
    }
    const next = bal.realms[s.realm.index + 1];
    if (next && next.need_xp) {
      const pct = Math.min(100, (s.resources.xiufu / next.need_xp) * 100);
      const fillStr = pct.toFixed(1);
      if (lastStr.xpFill !== fillStr) { refs.xpFill.style.width = fillStr + '%'; lastStr.xpFill = fillStr; }
      // 进度条境界色：当前境界的双色渐变，高对比可辨（十境递进）
      const curRealm = bal.realms[s.realm.index];
      const bar = curRealm.bar || ['#6b9bd1', '#3a6ba1'];
      const bgStr = 'linear-gradient(90deg, ' + bar[0] + ', ' + bar[1] + ')';
      if (lastStr.barBg !== bgStr) { refs.xpFill.style.background = bgStr; lastStr.barBg = bgStr; }
      // A4 流转加速：按住吐纳时灵气流转加倍
      if (refs.xpFill) refs.xpFill.classList.toggle('fast', !!uiState.holdingBreath);
      // Q 版太极小人：站在进度条最前端，随进度右移（每 tick 同步，防境界/需求切换时脱节）
      if (refs.taichiMonk) refs.taichiMonk.style.left = `calc(${fillStr}% )`;
      const full = s.resources.xiufu >= next.need_xp;
      if (refs.xpBar) refs.xpBar.classList.toggle('full', full);
      const txt = '修为 ' + fmtSafe(s.resources.xiufu) + ' / ' + fmtSafe(next.need_xp);
      if (lastStr.xpText !== txt) { refs.xpText.textContent = txt; lastStr.xpText = txt; }
      const can = full && !(s.bt && s.bt.fail_cooldown_until > Date.now());
      refs.btnBreak.classList.toggle('hidden', !can);
    } else {
      refs.xpFill.style.width = '100%';
      refs.xpText.textContent = '已至' + (((g.LS.BAL.realms[s.realm.index] || {}).name) || '飞升') + '之境';
      refs.btnBreak.classList.add('hidden');
      if (refs.taichiMonk) refs.taichiMonk.style.left = '100%'; // 满境小人也走到最前端
      if (refs.xpBar) refs.xpBar.classList.add('full');
    }
  }

  /* ── 见闻栏 ── */
  function pushLog(entry) {
    const el = document.createElement('div');
    el.className = 'log-item';
    el.innerHTML = '<span class="log-title">【' + escapeHtml(entry.title || '') + '】</span> ' +
      (entry.choice ? '<span class="log-choice">' + escapeHtml(entry.choice) + '</span> ' : '') +
      (entry.gainText ? '<span class="log-gain">' + escapeHtml(entry.gainText) + '</span>' : '');
    refs.logList.insertBefore(el, refs.logList.firstChild);
    while (refs.logList.children.length > 50) refs.logList.removeChild(refs.logList.lastChild);
  }

  function renderChronicle() {
    refs.logList.innerHTML = '';
    const log = (g.LS.S.event_state.log || []).slice(0, 5);
    for (let i = log.length - 1; i >= 0; i--) {
      pushLog({ title: log[i].title, choice: log[i].choice });
    }
  }

  function fmtEl(el) {
    if (!el) return '无相';
    if (el === 'root') return '随灵根';
    return Array.isArray(el) ? el.join('·') : String(el);
  }
  function escapeHtml(t) {
    return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── 福泽栏 ── */
  function renderPermList() {
    const s = g.LS.S;
    const totalPct = Math.round((s.perm_bonus.all || 0) * 100);
    const counts = {};
    (s.prestige.bought || []).forEach(id => { counts[id] = (counts[id] || 0) + 1; });
    const names = Object.keys(counts).map(id => {
      const u = g.LS.BAL.prestige.upgrades.find(x => x.id === id);
      if (!u) return id;
      const maxLv = u.max_lv || 1;
      return u.name + (maxLv > 1 ? ' ' + counts[id] + '/' + maxLv + '重' : '');
    });
    const html = '<div class="perm-total">永久加成：+' + totalPct + '%</div>' +
      names.map(n => '<div class="perm-item">· ' + escapeHtml(n) + '</div>').join('');
    if (lastStr.perm !== html) { refs.permList.innerHTML = html; lastStr.perm = html; }
  }

  /* ── LLM 状态灯 ── */
  const LLM_TIPS = {
    ok: '仙缘已至：方舟 {model} 连接正常，奇遇由活水生成。',
    degraded: '仙缘在途：方舟暂时不应（超时或限流），本次奇遇由内置池出题，稍后自动恢复。',
    off: '云深不知处：未配置密钥或本地代理未启动，奇遇由内置池出题，玩法不受影响。'
  };
  function setLLMStatus(st, modelName) {
    if (!refs.llmDot) return;
    refs.llmDot.className = 'dot ' + st;
    refs.llmDot.dataset.tip = (LLM_TIPS[st] || LLM_TIPS.off).replace('{model}', modelName || 'GLM 模型');
  }

  function setForewarn(v) { refs.forewarn.classList.toggle('hidden', !v); }

  /* ── 弹窗基建 ── */
  function isModalOpen() {
    return refs.modalRoot ? refs.modalRoot.children.length > 0 : false;
  }
  function makeModal(onMaskClose) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    const card = document.createElement('div');
    card.className = 'modal-card';
    mask.appendChild(card);
    // 点遮罩空白关闭（事件弹窗传入「离去」回调）
    mask.addEventListener('click', (e) => {
      if (e.target === mask && onMaskClose) onMaskClose();
    });
    refs.modalRoot.appendChild(mask);
    return { mask, card };
  }
  function removeModals() {
    refs.modalRoot.innerHTML = '';
    // 启动弹窗不轮询；当前弹窗释放后，按「招式录 → 更新公告」尝试一次。
    if (pendingDeckPrompt) setTimeout(tryShowScheduledDeckPrompt, 60);
    else if (pendingUpdateNotes) setTimeout(tryShowScheduledUpdate, 60);
  }

  /* ── 奇遇候选（2026-09-21 玩家口径「5 选 1」）：一次摊开几桩事，玩家自己挑一件经历 ──
     只在普通触发路径用；因果回收/故人上门/剧情链这类「该来的」不走选单。 */
  function showEventPicker(list, onPick, opts) {
    sfx('guqin');
    removeModals();
    const o = opts || {};
    const { card } = makeModal(() => onPick(list[0] && list[0].key));   // 点罩子＝直接挑第一件
    card.classList.add('ev-pick');
    card.innerHTML =
      '<div class="modal-title">' + escapeHtml(o.title || '山 中 数 事') + '</div>' +
      '<div class="modal-desc">' + escapeHtml(o.desc || '今日山中同时起了这么几桩事——你想先看哪一件？') + '</div>' +
      list.map(it =>
        '<button class="ev-option tactic-row ev-pick-row" data-pick-key="' + escapeHtml(it.key) + '">' +
          '<b>' + escapeHtml(it.title) + '</b>' +
          (it.desc ? '　<span class="ev-pick-desc">' + escapeHtml(it.desc) + '</span>' : '') +
        '</button>').join('');
    card.querySelectorAll('[data-pick-key]').forEach(b => b.addEventListener('click', () => {
      const key = b.dataset.pickKey;
      removeModals();
      onPick(key);
    }));
  }

  /* ── 奇遇弹窗（不暂停产量） ── */
  function showEventModal(ev) {
    sfx('guqin');
    removeModals();
    const { mask, card } = makeModal(() => g.LS.events.chooseOption('C')); // 中途关闭等同于「离去」
    // A6 卷轴初展：横卷展开仪式（500ms 锁死；仙品先一道朱线扫过）
    mask.classList.add('scroll-open');
    if ((ev.rarity || '') === '仙') {
      const sweep = document.createElement('div');
      sweep.className = 'cinnabar-sweep';
      card.appendChild(sweep);
    }
    card.classList.add('rarity-' + (ev.rarity || '凡'));
    const srcTag = ev.source === 'chain' ? '续' : (ev.source === 'visitor' ? '访' : (ev.source === 'dream' ? '梦' : (ev.source === 'llm' ? 'AI 执笔' : null)));
    // 三世缘：本幕涉及前几世结缘的故人 → 隔世标 + 前缀一行
    const pastLife = ev.builtinTags && ev.builtinTags.some(t => g.LS.events.isPastLife(t.key));
    const fullTag = '<span class="rarity-tag">' + (ev.rarity || '凡') + '</span>' +
      (srcTag ? '<span class="rarity-tag">' + srcTag + '</span>' : '') +
      (pastLife ? '<span class="rarity-tag ev-badge-chain">隔世</span>' : '');
    card.innerHTML =
      '<div class="modal-title">' + fullTag + escapeHtml(ev.title) + '</div>' +
      '<div class="ev-countdown" id="ev-cd"></div>' +
      (pastLife ? '<div class="past-life-line">（前尘旧影，依稀是故人来。）</div>' : '') +
      '<div class="modal-desc">' + escapeHtml(ev.desc) + '</div>';
    for (const opt of ev.options) {
      if (ev.no_choice && opt.key !== 'A') continue;   // 离线事件不给选择，只留一个「知道了」
      const btn = document.createElement('button');
      btn.className = 'ev-option' + (opt.key === 'C' ? ' ev-leave' : '');
      // 选项不再挂效果方向标签（势/仁/益/耗/恒/缘/异/贪 一律去掉，2026-09-21 玩家口径）
      const tail = (opt.key === 'C' || ev.no_choice || ev.five_choice) ? '' : '（' + (opt.key === 'A' ? '其一' : '其二') + '）';
      const missingXinmo = opt.requires_xinmo ? Math.max(0, opt.requires_xinmo - (g.LS.S.xinmo || 0)) : 0;
      btn.disabled = missingXinmo > 0;
      btn.innerHTML = escapeHtml(opt.text) + tail + (missingXinmo ? '<small>（再积 ' + missingXinmo + ' 点心魔）</small>' : '');
      btn.addEventListener('click', () => g.LS.events.chooseOption(opt.key));
      card.appendChild(btn);
    }
    // 倒计时：归零自动「离去」
    const total = g.LS.BAL.events.modal_timeout_s || 30;
    let left = total;
    const cdEl = card.querySelector('#ev-cd');
    clearInterval(evTimer);
    evTimer = setInterval(() => {
      left -= 1;
      if (cdEl) cdEl.textContent = Math.max(0, left) + ' 息';
      if (left <= 0) { clearInterval(evTimer); evTimer = null; g.LS.events.chooseOption('C'); }
    }, 1000);
    if (cdEl) cdEl.textContent = total + ' 息';
  }

  function closeEventModal() {
    clearInterval(evTimer);
    evTimer = null;
    removeModals();
  }

  /* ── 离线结算卷轴 ── */
  function showOfflinePopup(result) {
    if (!result) return;
    sfx('bell');
    const bal = g.LS.BAL;
    const t = bal.texts;
    removeModals();
    const { mask, card } = makeModal();
    card.classList.add('offline-scroll');
    // 兜底：结算单被外部清掉（玩家中途打开别的面板 → removeModals）时别把事件队列卡死。
    // 正常「收取」路径先清 open 再 remove，这里判 open 已归零就不会重复放行。
    try {
      const mo = new MutationObserver(() => {
        if (document.body.contains(mask)) return;
        mo.disconnect();
        const st = g.LS.S && g.LS.S.event_state;
        if (st && st.open && st.open.kind === 'settle') {
          st.open = null;
          setTimeout(() => { if (g.LS.events && g.LS.events.pumpQueue) g.LS.events.pumpQueue(0); }, 400);
        }
      });
      mo.observe(refs.modalRoot, { childList: true });
    } catch (e) {}
    const resName = (id) => { const r = bal.resources.find(x => x.id === id); return r ? r.name : id; };
    let rows = '';
    const order = ['lingqi', 'xiufu', 'lingshi', 'danyao'];
    for (const k of order) {
      const v = result.gains[k] || 0;
      if (Math.abs(v) < 1e-9) continue;
      rows += '<div class="offline-gain-row"><span>' + resName(k) + '</span><b class="og-' + k + '">+' + fmtSafe(v) + '</b></div>';
    }
    const durTxt = g.LS.util.fmtGameDur(result.gap * ((bal.game_time && bal.game_time.day_per_second) || 1)); // 离山游戏时长：山中无甲子
    const cappedTxt = result.capped ? '<div class="offline-capped">' + t.offline_capped_hint + '</div>' : '';
    card.innerHTML =
      '<div class="modal-title">' + t.offline_title + '</div>' +
      '<div class="modal-desc">你离山 ' + durTxt + '，弟子们不敢懈怠：</div>' +
      rows + cappedTxt +
      '<div class="modal-desc" style="font-size:12px;color:var(--ink-soft)">按 ' + Math.round(result.eff * 100) + '% 效率结算 ' + g.LS.util.fmtDur(result.secs) + '</div>';
    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.textContent = '收取';
    btn.addEventListener('click', () => {
      // 数字滚动
      for (const k of order) {
        const el = card.querySelector('.og-' + k);
        if (el) tweenNumber(el, 0, result.gains[k] || 0);
      }
      setTimeout(() => {
        // 只移除离线卷轴自己的弹窗（保留玩家可能打开的其他面板，如斗法/设置）
        mask.remove();
        if (g.LS.save) g.LS.save.save();
        // 离线归来：结算单是队列首条（见 events.queueOfflineReturn），看完就放下一条
        g.LS.S.event_state.open = null;
        setTimeout(() => g.LS.events.pumpQueue(0), 520);
      }, 520);
    });
    card.appendChild(btn);
  }

  /* ── 突破过场 ── */
  function showBreakthroughOverlay(text, gainText, realmIdx) {
    sfx('bell');
    if (g.LS.ui.sfx) sfx('drum'); // A5 鼓点：钟鸣里垫一声低沉下扫
    // 突破爆发（v0.21.2）：屏息压暗 0.48s → 一次炸亮（CSS 见 ms-upgrade.css「突破爆发特效」，单次不连闪）
    try {
      const B = document.body;
      B.classList.remove('is-holding', 'is-breaking'); // 防连触叠加残留
      B.classList.add('is-holding');
      setTimeout(() => {
        B.classList.remove('is-holding');
        B.classList.add('is-breaking');
        setTimeout(() => B.classList.remove('is-breaking'), 1400);
      }, 480);
      setTimeout(() => {
        B.appendChild(ov);
      }, 500); // 过场画面在炸亮瞬间出现，压暗拍期间保持原画面
    } catch (e) {}
    const ov = document.createElement('div');
    ov.id = 'breakthrough-overlay';
    for (let i = 0; i < 5; i++) {
      const sp = document.createElement('span');
      sp.className = 'ink-splash';
      const size = 120 + Math.random() * 260;
      sp.style.width = size + 'px';
      sp.style.height = size + 'px';
      sp.style.left = (10 + Math.random() * 80) + '%';
      sp.style.top = (10 + Math.random() * 70) + '%';
      sp.style.animationDelay = (i * 0.12) + 's';
      ov.appendChild(sp);
    }
    // 突破雷光：金丹起每次破境天有异象——两道横向雷光扫过（渡劫以上更烈）
    if (realmIdx >= 2) {
      for (let i = 0; i < (realmIdx >= 8 ? 3 : 2); i++) {
        const lt = document.createElement('div');
        lt.className = 'bt-lightning';
        lt.style.top = (12 + i * 22 + Math.random() * 8) + '%';
        lt.style.animationDelay = (i * 0.18) + 's';
        if (realmIdx >= 8) lt.style.height = '3px';
        ov.appendChild(lt);
      }
    }
    // A5 一笔通玄：凌空大字横笔写出（clip-path 揭示模拟笔势），末了朱印落款
    const charRow = document.createElement('div');
    charRow.style.marginBottom = '14px';
    const ch = document.createElement('span');
    ch.className = 'br-write' + (realmIdx >= 7 ? ' cinnabar' : '');
    ch.textContent = breakthroughChar(realmIdx);
    const seal = document.createElement('span');
    seal.className = 'br-seal';
    seal.textContent = '灵山';
    charRow.appendChild(ch);
    charRow.appendChild(seal);
    ov.appendChild(charRow);
    const div = document.createElement('div');
    div.className = 'bt-text';
    div.textContent = text || '';
    ov.appendChild(div);
    if (gainText) {
      const gt = document.createElement('div');
      gt.className = 'bt-text';
      gt.style.color = 'var(--cinnabar)';
      gt.style.fontSize = '17px';
      gt.textContent = gainText;
      ov.appendChild(gt);
    }
    const hint = document.createElement('div');
    hint.className = 'bt-hint';
    hint.textContent = '点击任意处继续';
    ov.appendChild(hint);
    if (!ov.parentNode) document.body.appendChild(ov); // 时序：突破爆发炸亮瞬间才挂载
    const close = () => {
      ov.remove();
      renderAll();
      drainBtToastQueue();   // 过场看完，把排队等着的提示依次放出来
    };
    ov.addEventListener('click', close); // 用户要求：过场画面点一下才关，不自动消失（动画照常播完，看完再点）
  }

  /** 概念即遇即讲：每个关键节点首次出现时解释一句（seen_hints 去重） */
  function hintOnce(key, fallbackText) {
    const s = g.LS.S;
    if (!s.seen_hints) s.seen_hints = {};
    if (s.seen_hints[key]) return;
    s.seen_hints[key] = true;
    const hints = (g.LS.BAL.texts && g.LS.BAL.texts.hints) || {};
    toast(hints[key] || fallbackText || '', 4200);
  }
  const HINT_CHECKS = {
    first_max_xp: (s) => { const nx = g.LS.BAL.realms[s.realm.index + 1]; return nx && nx.need_xp && s.resources.xiufu >= nx.need_xp; },
    first_pill_stock: (s) => Object.keys(s.pill_stock || {}).some(k => s.pill_stock[k] > 0),
    first_toxic: (s) => (s.pill_toxic || 0) >= 10,
    first_visitor: (s) => !!s.visitor_seen && Object.keys(s.visitor_seen).length > 0,
    first_buff: (s) => s.buffs.length > 0,
    first_rebirth_ready: (s) => s.realm.index >= (g.LS.BAL.prestige.unlock_realm_index || 4),
    first_fail: (s) => (s.bt && s.bt.fail_streak > 0) || s.first_fail_flag === true,
    first_insight: (s) => (s.chronicle_lines || []).some(l => l.indexOf('悟') !== -1),
    first_xinmo: (s) => (s.chronicle_lines || []).some(l => l.indexOf('心魔') !== -1)
  };
  function checkHints() {
    const s = g.LS.S;
    if (!s.seen_hints) return;
    for (const key in HINT_CHECKS) {
      if (!s.seen_hints[key] && HINT_CHECKS[key](s)) {
        hintOnce(key);
        break; // 一次 tick 只讲一条，不刷屏
      }
    }
  }

  /* ── A5 一笔通玄：突破大字（数据来自 help.json breakthrough_chars） ── */
  function breakthroughChar(idx) {
    const chars = (g.LS.BAL.help && g.LS.BAL.help.breakthrough_chars) || {};
    return chars[String(idx)] || chars.default || '破';
  }

  /* ── 渡劫天劫：闪电劈小人 → 成功金光升级 / 失败跪地吐血后爬起 ── */
  function playTribulation(success, done) {
    if (!refs.taichiMonk) { done(); return; }
    if (g.LS.ambient && g.LS.ambient.isReduced && g.LS.ambient.isReduced()) { done(); return; } // 降级直接出结果
    const rect = refs.taichiMonk.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const layer = document.createElement('div');
    layer.className = 'tribulation';
    // 锯齿闪电：从天顶劈到小人位置
    const segs = 6;
    let d = 'M' + (cx + 30) + ' 0';
    let y = 0, x = cx + 30;
    for (let i = 1; i <= segs; i++) {
      y = (rect.top + rect.height / 2) * (i / segs);
      x = cx + (Math.random() * 60 - 30) * (1 - i / segs);
      d += ' L' + Math.round(x) + ' ' + Math.round(y);
    }
    d += ' L' + Math.round(cx) + ' ' + Math.round(rect.top + rect.height / 2);
    layer.innerHTML =
      '<svg class="bolt" style="left:0;top:0" width="' + window.innerWidth + '" height="' + window.innerHeight + '">' +
      '<path d="' + d + '" fill="none" stroke="rgba(160,200,255,.5)" stroke-width="7" stroke-linejoin="round"/>' +
      '<path d="' + d + '" fill="none" stroke="#eef4ff" stroke-width="2.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(layer);
    sfx('thunder');
    // 两记白闪 + 闪电明灭
    const flash = (times, cb) => {
      if (times <= 0) { layer.classList.remove('flash'); cb(); return; }
      layer.classList.add('flash');
      setTimeout(() => { layer.classList.remove('flash'); setTimeout(() => flash(times - 1, cb), 110); }, 90);
    };
    flash(2, () => {
      if (success) {
        // 成功：小人金光爆盛，接飞升升级过场
        refs.taichiMonk.classList.add('cursed');
        setTimeout(() => {
          layer.remove();
          refs.taichiMonk.classList.remove('cursed');
          done();
        }, 500);
      } else {
        // 失败：小人跪地吐血，血墨溅地，片刻后站起继续
        refs.taichiMonk.classList.add('kneel');
        const useEl = refs.taichiMonk.querySelector('.monk-svg use');
        if (useEl) useEl.setAttribute('href', '#taichi-monk-kneel');
        const wrap = refs.taichiMonk.parentElement;
        for (let i = 0; i < 3; i++) {
          const bd = document.createElement('span');
          bd.className = 'blood-drop';
          bd.style.left = (rect.left + rect.width / 2 + (i - 1) * 10 + Math.random() * 8) + 'px';
          bd.style.top = (rect.top + 8) + 'px';
          wrap.appendChild(bd);
          setTimeout(((el) => () => el.remove())(bd), 850);
        }
        setTimeout(() => {
          if (useEl) useEl.setAttribute('href', '#taichi-monk');
          refs.taichiMonk.classList.remove('kneel');
          layer.remove();
          done();
        }, 1400);
      }
    });
  }

  /* ── 突破失败 / 走火入魔过场（暗色水墨，数值代价显式呈现） ── */
  function showFailOverlay(title, text, isQihuo, details) {
    sfx(isQihuo ? 'shihuo' : 'breakfail');   // 失败另有一声闷锣/气逆声：与成功的清钟分得开（2026-09-21）
    const ov = document.createElement('div');
    ov.id = 'breakthrough-overlay';
    ov.style.background = isQihuo ? '#2b2222' : '#3a3330';
    for (let i = 0; i < 5; i++) {
      const sp = document.createElement('span');
      sp.className = 'ink-splash';
      const size = 120 + Math.random() * 260;
      sp.style.width = size + 'px';
      sp.style.height = size + 'px';
      sp.style.left = (10 + Math.random() * 80) + '%';
      sp.style.top = (10 + Math.random() * 70) + '%';
      sp.style.animationDelay = (i * 0.12) + 's';
      sp.style.background = 'radial-gradient(circle, rgba(168,50,50,.35), transparent 70%)';
      ov.appendChild(sp);
    }
    const t = document.createElement('div');
    t.className = 'bt-text';
    t.style.color = '#f5f0e6';
    t.style.fontSize = '30px';
    t.textContent = '【' + title + '】';
    ov.appendChild(t);
    const div = document.createElement('div');
    div.className = 'bt-text';
    div.style.color = 'rgba(245,240,230,.85)';
    div.textContent = text || '';
    ov.appendChild(div);
    // 数值代价明细：让玩家知道到底失去了什么
    if (details) {
      const dtl = document.createElement('div');
      dtl.className = 'bt-text';
      dtl.style.color = 'rgba(245,240,230,.65)';
      dtl.style.fontSize = '14px';
      dtl.style.marginTop = '10px';
      const parts = ['修为剩余 ' + fmtSafe(details.xpLeft)];
      if (isQihuo) parts.push('走火入魔：全局产量减半');
      parts.push('调息 ' + details.cooldown + ' 秒后可再冲');
      dtl.textContent = parts.join(' · ');
      ov.appendChild(dtl);
    }
    const hint = document.createElement('div');
    hint.className = 'bt-hint';
    hint.style.color = 'rgba(245,240,230,.5)';
    hint.textContent = '点击任意处继续';
    ov.appendChild(hint);
    document.body.appendChild(ov);
    const close = () => { ov.remove(); renderAll(); };
    ov.addEventListener('click', close); // 用户要求：过场画面点一下才关，不自动消失（动画照常播完，看完再点）
  }

  /* ── 突破策略面板：稳扎稳打 / 常规 / 兵行险着 + 服丹护法 ── */
  function showBreakthroughPanel(next) {
    removeModals();
    const { card } = makeModal();
    const bal = g.LS.BAL;
    const bt = bal.breakthrough || {};
    const render = (selTactic, usePill) => {
      const tactics = bt.tactics || {};
      const pill = bt.pill_guard || {};
      // 面板不显示任何概率、不给新手推荐（2026-09-21 玩家口径），只留连败保底提示
      const emperor = next.index >= 10;
      const odds = emperor && g.LS.realm.emperorOdds ? g.LS.realm.emperorOdds(usePill && pill.rate_add ? pill.rate_add : 0) : null;
      let rows = '';
      ['steady', 'normal', 'bold'].forEach(k => {
        const t = tactics[k];
        if (!t) return;
        const sel = selTactic === k;
        const badge = (emperor && t.reward_mult !== 1)
          ? '<span class="ev-badge ' + (t.reward_mult > 1 ? 'ev-badge-good' : 'ev-badge-bad') + '">突破灵石 ×' + t.reward_mult + '</span> '
          : '';
        rows += '<button class="ev-option tactic-row' + (sel ? ' tactic-sel' : '') + '" data-t="' + k + '">' +
          badge +
          '<b>' + escapeHtml(t.name) + '</b>　' + escapeHtml(t.desc) +
          (emperor ? '' : (t.reward_mult !== 1 ? '　<span class="log-gain">灵石 ×' + t.reward_mult + '</span>' : '')) + '</button>';
      });
      const canPill = g.LS.economy.pillCount ? g.LS.economy.pillCount('pozhang') > 0 : false;
      const head = emperor && odds
        ? '<div class="modal-title">冲关 · ' + escapeHtml(next.name) + '</div>' +
          '<div class="modal-desc">帝劫 · 九重雷劫：连受 <b>' + odds.strikes + '</b> 道天雷，每道单独判定；' +
          '落空不超过 <b>' + odds.layers + '</b> 道即可破境称帝' +
          (odds.hasMingdao ? '（名刀在身，多容一道）' : '') + '。</div>'
        : '<div class="modal-title">冲关 · ' + escapeHtml(next.name) + '</div>' +
          '<div class="modal-desc">气机已满，只待叩门。' +
          (g.LS.S.dao_heart > (bt.dao_heart_bonus || {}).high ? '（道心加持）' : (g.LS.S.dao_heart < (bt.dao_heart_bonus || {}).low ? '（道心拖累）' : '')) +
          '　连败保底：' + (bt.pity_success || 3) + ' 次必成</div>';
      const tail = emperor
        ? '<div class="modal-desc" style="font-size:12px;color:var(--ink-soft)">每道落空：修为 −' + Math.round((odds.perStrikeLoss || 0.3) * 100) + '%（至多结算 3 层）；落空 ≥ 3 道 → <b>形神俱灭</b>，需名刀碎裂或还魂甲裹魂方能保命。</div>'
        : '<div class="modal-desc" style="font-size:12px;color:var(--ink-soft)">若失败：修为保留一半，可能走火入魔（全局产量减半片刻）——但连败三次必成，不必过虑。</div>';
      card.innerHTML =
        head +
        rows +
        '<div class="set-row"><label>破障丹护法（1 颗，' + (emperor ? '护住每一道天雷' : '护住这一关的气机') + '）— 丹房现有 ' + (g.LS.economy.pillCount ? g.LS.economy.pillCount('pozhang') : 0) + '</label>' +
        '<input type="checkbox" id="bt-use-pill" ' + (usePill ? 'checked' : '') + (canPill ? '' : ' disabled') + '></div>' +
        tail +
        '<div style="text-align:center;margin-top:10px"><button class="btn-primary" id="bt-go" style="padding:10px 34px;font-size:16px">出 关</button> ' +
        '<button class="icon-btn" id="bt-cancel">再想想</button></div>';
      card.querySelectorAll('[data-t]').forEach(b => {
        b.addEventListener('click', () => render(b.dataset.t, card.querySelector('#bt-use-pill').checked));
      });
      card.querySelector('#bt-use-pill').addEventListener('change', (e) => render(selTactic, e.target.checked));
      card.querySelector('#bt-cancel').addEventListener('click', removeModals);
      card.querySelector('#bt-go').addEventListener('click', () => {
        removeModals();
        g.LS.realm.doBreakthrough({ tactic: selTactic || 'normal', usePill: !!card.querySelector('#bt-use-pill') && card.querySelector('#bt-use-pill').checked });
      });
    };
    render('normal', false);
  }

  /* ── 难度选择：新档首入弹窗 + 设置页随时可换 ── */
  function showDifficultyPick(onDone) {
    removeModals();
    const { card, mask } = makeModal(onDone === 'settings' ? removeModals : null);
    const bal = g.LS.BAL;
    const desc = (k) => (bal.difficulty && bal.difficulty[k] && bal.difficulty[k].desc) || '';
    const label = (k) => (bal.difficulty && bal.difficulty[k] && bal.difficulty[k].label) || k;
    card.innerHTML =
      '<div class="modal-title">选 择 道 途</div>' +
      '<div class="modal-desc">三种修行难度，随时可在「设置」里更改——只影响节奏，不影响任何内容。</div>' +
      ['easy', 'normal', 'hard'].map(k =>
        '<button class="ev-option tactic-row" data-diff="' + k + '"><b>' + escapeHtml(label(k)) + '</b>　' + escapeHtml(desc(k)) + '</button>'
      ).join('');
    card.querySelectorAll('[data-diff]').forEach(btn => {
      btn.addEventListener('click', () => {
        g.LS.S.settings.difficulty = btn.dataset.diff;
        g.LS.save.save();
        removeModals();
        toast('道途已定：' + label(btn.dataset.diff) + (onDone === 'settings' ? '' : '。点「吐纳」开始修行'), 3600);
        if (typeof onDone === 'function') onDone();
      });
    });
  }

  /* ── 斗法 UI：对阵牌 / 回合制选牌战斗视图（杀戮尖塔式，引擎在 battle.js v3） ── */
  function showBattleArena(info, onStart) {
    removeModals();
    const { card, mask } = makeModal(() => { g.LS.battle.abort(); removeModals(); });
    card.innerHTML =
      '<div class="modal-title">斗 法 · 论 道</div>' +
      (info.senior ? '<div class="modal-desc" style="text-align:center;color:var(--cinnabar)">大师兄·' + escapeHtml(info.tierLabel || '凌云子') + '前来指教——看意图、排牌序，先手夺势。<br><span style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(info.tierDesc || '') + '</span></div>' : '') +
      '<div class="battle-card-row"><div class="bc-side">' +
        '<div class="bc-dao"><b>' + escapeHtml(info.my.dao) + '</b></div>' +
        '<div class="bc-line">' + escapeHtml(info.my.realm) + '境 · ' + escapeHtml(info.my.weapon) + '</div>' +
        '<div class="bc-line">' + escapeHtml(info.my.tech) + '</div>' +
        '<div class="bc-line">灵根 ' + escapeHtml(info.my.el) + ' · 道基 ' + info.my.hp + ' · 招式 ' + info.my.cards + ' 式</div>' +
      '</div><div class="bc-vs">对</div><div class="bc-side">' +
        '<div class="bc-dao"><b>' + escapeHtml(info.op.dao) + '</b></div>' +
        '<div class="bc-line">' + escapeHtml(info.op.realm) + '境 · ' + escapeHtml(info.op.weapon || '未知') + '</div>' +
        '<div class="bc-line">' + escapeHtml(info.op.tech || '未知') + '</div>' +
        '<div class="bc-line">灵根 ' + escapeHtml(info.op.el) + ' · 道基 ' + info.op.hp + '</div>' +
      '</div></div>' +
      (info.elRel ? '<div class="modal-desc" style="text-align:center;color:var(--cinnabar)">' + escapeHtml(info.elRel) + '</div>' : '') +
      '<div class="modal-desc" style="text-align:center">' + escapeHtml(info.weather) + '</div>' +
      '<div class="modal-desc" style="font-size:11px;color:var(--ink-soft)">行动点=自身境界+1：出招按招式所需点数扣减，用光了点「调息 · 让招」回满（代价是白让一手）；手牌即你<b>招式录</b>里配好的那套卡组（付不起的置灰），一回合只出一招；罡气护罩只保当回合。</div>' +
      '<div style="text-align:center;margin-top:10px"><button class="btn-primary" id="battle-start" style="padding:10px 34px;font-size:16px">开 战</button> ' +
      '<button class="icon-btn" id="battle-cancel">改日再战</button></div>';
    card.querySelector('#battle-start').addEventListener('click', () => { onStart(); });
    card.querySelector('#battle-cancel').addEventListener('click', () => { g.LS.battle.abort(); removeModals(); });
  }

  function showBattleScreen(my, op) {
    const mask = document.querySelector('.modal-mask');
    if (!mask) return;
    const card = mask.querySelector('.modal-card');
    card.innerHTML =
      '<div class="battle-hp-row"><div class="bh-side"><b>' + escapeHtml(my.dao) + '</b>' +
        '<div class="bh-hp"><div class="bh-fill" id="bh-my" style="width:100%"></div></div>' +
        '<div class="bc-line">气血 <span id="bh-my-num">' + Math.ceil(my.hp) + '</span> / ' + my.hpMax +
          ' <span class="bh-shield" id="bh-my-shield" style="display:none"></span></div></div>' +
      '<div class="bh-vs">战</div>' +
      '<div class="bh-side" style="text-align:right"><b>' + escapeHtml(op.dao) + '</b>' +
        '<div class="bh-hp"><div class="bh-fill op" id="bh-op" style="width:100%"></div></div>' +
        '<div class="bc-line">气血 <span id="bh-op-num">' + Math.ceil(op.hp) + '</span> / ' + op.hpMax +
          ' <span class="bh-shield" id="bh-op-shield" style="display:none"></span></div></div></div>' +
      '<div id="battle-intent" class="battle-intent is-empty"></div>' +
      '<div id="battle-stage" class="battle-stage"></div>' +
      '<div class="battle-qi"><span id="battle-round">第 1 回合</span> · 行动点 <span id="battle-qi-stars"></span><span class="battle-qi-note">出招消耗 · 调息回满</span></div>' +
      '<div class="battle-note">手牌 · 点一张打出（每回合限一张）</div>' +
      '<div id="battle-hands" class="battle-hands"></div>' +
      '<div class="battle-note">弟子术 · 回合外施放（每人每战一次）</div>' +
      '<div id="battle-disciple-skills" class="battle-hands battle-disciple-skills"></div>' +
      '<div class="battle-rest-wrap"><button class="btn-primary" id="battle-end" title="不出招，行动点回满——对方趁机出手">调 息 · 让 招</button>' +
        '<div class="battle-note">不出招 · 行动点回满，本回合让给对方</div></div>';
    card.querySelector('#battle-end').addEventListener('click', () => { g.LS.battle.endTurn(); });
    // 舞台：两位小人上场（演出层 battle_fx.js）
    const stage = document.getElementById('battle-stage');
    if (stage && g.LS.battleFx) {
      g.LS.battleFx.mount(stage, { my: { dao: my.dao, el: my.element }, op: { dao: op.dao, el: op.element } });
      setTimeout(() => { if (g.LS.battleFx) g.LS.battleFx.kick(); }, 80);
    }
  }

  /* 首次进斗法的一次性说明：点「知道了」回调开打（此后不再弹，标记在 seen_hints.battle_guide） */
  function showBattleGuide(onOk) {
    const card = document.querySelector('.modal-card');
    if (!card) { onOk(); return; }
    const gd = document.createElement('div');
    gd.className = 'battle-guide';
    gd.innerHTML =
      '<div class="bg-title">斗 法 须 知</div>' +
      '<ul class="bg-list">' +
        '<li>出战的牌就是你<b>招式录</b>里配好的卡组（8 槽：攻式 3 · 五行 2 · 守式 2 · 回式 1）：每回合这套牌全在手，只按<b>行动点</b>决定你能使哪几张，一回合只出 <b>一张</b>。</li>' +
        '<li>每局由<b>你先出手</b>——先手在你；日后或另立定先手之规，眼下不必挂心。</li>' +
        '<li>出招消耗 <b>行动点</b>（= 自身境界 + 1）；用光了点「调息 · 让招」回满，代价是白让一手。</li>' +
        '<li>对手吃同一套行动条：他的点数也会耗光，耗光那一手只能调息（意图里会写出来）——那是你的机会。</li>' +
        '<li>对方头顶的<b>意图</b>就是他这一手要出的招——据此决定攻还是守。</li>' +
        '<li>罡气护罩只保当回合；胜负只看气血归零。第 13 回合起双方进入<b>气机枯竭</b>，每回合承受递增自伤。</li>' +
      '</ul>' +
      '<div class="bg-sub">界 面 怎 么 看</div>' +
      '<ul class="bg-list bg-list-2">' +
        '<li>顶上两条血条：左是你、右是对方；名字旁那个「罡气 N」是只保当回合的护罩。</li>' +
        '<li>血条下方那行横条：<b>对方意图</b>——他这一手要出什么招，据此决定攻守。</li>' +
        '<li>中间方框：<b>对战舞台</b>，招式、护罩、伤害数字都在这里演。</li>' +
        '<li>「行动点」一行：亮着的点就是你还剩的行动点，出招按费用扣。</li>' +
        '<li>「<b>手牌</b>」一栏：你这一手能用的招都在这里，点其中一张打出去（每回合限一张）。</li>' +
        '<li>最下「<b>调息 · 让招</b>」：不出招，把行动点回满，本回合让给对方。</li>' +
      '</ul>' +
      '<div class="bg-actions"><button class="btn-primary" id="bg-ok" style="padding:9px 34px">知 道 了</button></div>';
    card.appendChild(gd);
    gd.querySelector('#bg-ok').addEventListener('click', function () {
      if (gd.parentNode) gd.parentNode.removeChild(gd);
      onOk();
    });
  }

  /* 舞台化（2026-09-13）：原来的逐行文字战报换成小人对战+飘字，
     这里只留内存缓冲（调试与兜底），不再往界面写文字行。 */
  const battleBuf = [];
  function battleLog(text) {
    battleBuf.push(text);
    if (battleBuf.length > 300) battleBuf.shift();
  }
  function battleAppend(lines) {
    for (let i = lines.length - 1; i >= 0; i--) battleLog(lines[i]);
  }
  function updateBattleHP(myHp, myMax, opHp, opMax) {
    const m = document.getElementById('bh-my');
    const o = document.getElementById('bh-op');
    const mn = document.getElementById('bh-my-num');
    const on = document.getElementById('bh-op-num');
    if (m) m.style.width = Math.max(0, Math.min(100, myHp / myMax * 100)) + '%';
    if (o) o.style.width = Math.max(0, Math.min(100, opHp / opMax * 100)) + '%';
    if (mn) mn.textContent = Math.ceil(myHp);
    if (on) on.textContent = Math.ceil(opHp);
  }
  function updateBattleShields(myS, opS) {
    const m = document.getElementById('bh-my-shield');
    const o = document.getElementById('bh-op-shield');
    if (m) { m.style.display = myS > 0 ? '' : 'none'; m.textContent = '罡气' + myS; }
    if (o) { o.style.display = opS > 0 ? '' : 'none'; o.textContent = '罡气' + opS; }
  }
  function updateBattleQi(qi, max) {
    const box = document.getElementById('battle-qi-stars');
    if (!box) return;
    let html = '';
    for (let i = 0; i < max; i++) html += '<span class="qi-dot' + (i < qi ? ' on' : '') + '">●</span>';
    box.innerHTML = html;
  }
  function updateBattleRound(round, exhausted) {
    const box = document.getElementById('battle-round');
    if (!box) return;
    box.innerHTML = '第 ' + round + ' 回合' + (exhausted ? ' <span class="ev-badge" style="color:var(--cinnabar)">气机枯竭</span>' : '');
  }
  function renderBattleHands(cards) {
    const box = document.getElementById('battle-hands');
    if (!box) return;
    const skillCards = cards.map(c =>
      '<button class="hand-card' + (c.disabled ? ' hand-card-off' : '') + '" data-idx="' + c.idx + '" ' + (c.disabled ? 'disabled' : '') + '>' +
        '<span class="hc-cost">' + c.cost + '</span><b>' + escapeHtml(c.name) + '</b>' +
        '<span class="hc-el">' + fmtEl(c.el) + '</span>' +
        '<span class="hc-eff">' +
          (c.cdLeft > 0 ? '气机未复·余' + c.cdLeft + '回合' :
          (c.dmg ? '杀 ' + c.dmg : '') + (c.heal ? ' 回 ' + c.heal : '') + (c.shield ? ' 护 ' + c.shield : '') +
          (!c.dmg && !c.heal && !c.shield ? '—' : '')) + '</span>' +
      '</button>'
    ).join('');
    box.innerHTML = skillCards;
    box.querySelectorAll('.hand-card[data-idx]').forEach(btn => {
      btn.addEventListener('click', () => { g.LS.battle.playCard(Number(btn.dataset.idx)); });
    });
  }
  /* 意图横幅始终占着那一行（空时 visibility:hidden 而非 display:none）：
     否则回合切换时横幅整行消失，弹窗是 flex 居中的，卡片高度一变整块内容就上下弹一次。*/
  function showBattleIntent(text) {
    const box = document.getElementById('battle-intent');
    if (!box) return;
    if (!text) { box.classList.add('is-empty'); box.textContent = ''; return; }
    box.classList.remove('is-empty');
    box.textContent = text;
  }
  function showBattleResult(win, info) {
    removeModals();
    const { card, mask } = makeModal(removeModals);
    card.innerHTML =
      '<div class="modal-title">' + (win ? '斗 法 得 胜' : '斗 法 惜 败') + '</div>' +
      '<div class="modal-desc">' + (win
        ? '招式连绵，灵机压过一头——' + (info.diff >= 2 ? '以下克上，一战成名！' : (info.senior ? '大师兄颔首：拳怕少壮，后生可畏。' : (info.trial ? '野修授首。' : '旗鼓相当，技高一筹。'))) +
          (info.trial ? '<br>' + info.trial : ('<br>论道积分 +' + info.honor))
        : '招式被看穿，' + (info.senior ? '大师兄收剑：回去把功法练熟再来。' : '胜败乃修士常事，道心不坠即可。')) + '</div>' +
      '<div style="text-align:center;margin-top:10px"><button class="btn-primary" id="br-close">归 位</button></div>';
    card.querySelector('#br-close').addEventListener('click', removeModals);
  }

  /** 大帝九重雷劫演出：逐雷滚动结果 + 劫伤层数展示（引擎已先算好 results/survived） */
  function playEmperorTribulation(p, results, survived, onDone) {
    removeModals();
    const { card, mask } = makeModal(null);
    const failLayers = results.filter(x => !x).length;
    card.innerHTML =
      '<div class="modal-title" style="color:var(--cinnabar)">帝 劫 · 九 重 雷 罚</div>' +
      '<div class="modal-desc" style="text-align:center">每重天雷通过率约 <b>' + Math.round(p * 100) + '%</b> —— 劫伤两重，形神俱灭。</div>' +
      '<div id="emp-strip" style="min-height:150px;font-size:14px;line-height:2.1"></div>' +
      '<div style="text-align:center;margin-top:8px"><button class="btn-primary" id="emp-ok" style="display:none;padding:8px 30px">接受天命</button></div>';
    const strip = card.querySelector('#emp-strip');
    let i = 0;
    const names = ['第一重', '第二重', '第三重', '第四重', '第五重', '第六重', '第七重', '第八重', '第九重'];
    const step = () => {
      if (i >= results.length) {
        const div = document.createElement('div');
        div.style.cssText = 'text-align:center;margin-top:10px;font-size:16px;color:' + (survived ? 'var(--gold,#e8c34a)' : 'var(--cinnabar)');
        div.textContent = survived ? '—— 九雷纳体，万道臣服，大 帝 成 就 ——' : ('—— 劫伤 ' + failLayers + ' 重，道基崩碎 ——');
        strip.appendChild(div);
        card.querySelector('#emp-ok').style.display = '';
        card.querySelector('#emp-ok').addEventListener('click', () => { removeModals(); onDone(); });
        return;
      }
      const ok = results[i];
      const div = document.createElement('div');
      div.className = 'battle-line';
      div.style.color = ok ? 'var(--ink,#e8dcc8)' : 'var(--cinnabar)';
      div.textContent = names[i] + '雷' + (ok ? ' —— 顶住了，道基嗡鸣不破。' : ' —— 没顶住！气血翻涌，劫伤加身（-30% 修为）。');
      strip.appendChild(div);
      strip.scrollTop = strip.scrollHeight;
      i += 1;
      setTimeout(step, 650);
    };
    setTimeout(step, 500);
  }

  /* ── 奇遇强敌弹窗：战力预判明示，死是「你非要打」的死 ── */
  function showAmbushModal(info) {
    removeModals();
    const { card } = makeModal(null);
    const myCP = g.LS.battle.combatPower();
    const ratio = myCP / Math.max(1, info.enemyCP);
    const F = g.LS.util.fmt;
    const judge = ratio >= 1.2 ? { txt: '此獠色厉内荏——战力占优（我 ' + F(myCP) + ' / 敌 ' + F(info.enemyCP) + '）', color: 'var(--gold,#e8c34a)', canFleeFree: true }
      : ratio >= 0.6 ? { txt: '五五之数，胜负难料（我 ' + F(myCP) + ' / 敌 ' + F(info.enemyCP) + '）', color: 'var(--ink,#e8dcc8)' }
      : { txt: '十死无生！战力被碾压（我 ' + F(myCP) + ' / 敌 ' + F(info.enemyCP) + '）', color: 'var(--cinnabar,#c0392b)' };
    card.innerHTML =
      '<div class="modal-title" style="color:var(--cinnabar)">杀 机 骤 至</div>' +
      '<div class="modal-desc">' + escapeHtml(info.name) + '拦住去路——招式：' + escapeHtml(info.moves) +
        '<br><b style="color:' + judge.color + '">' + escapeHtml(judge.txt) + '</b>' +
        (info.xinmo >= 30 ? '<br><span style="font-size:11px;color:var(--cinnabar)">你业力缠身，仇家寻上门来。</span>' : '') + '</div>' +
      '<div style="display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap">' +
        '<button class="btn-primary" id="am-fight" style="padding:8px 22px">正 面 一 战</button>' +
        '<button class="icon-btn" id="am-pay">破财免灾（失 15% 灵石）</button>' +
        '<button class="icon-btn" id="am-flee">转身逃遁（失 20% 灵石）</button></div>';
    const s = g.LS.S;
    card.querySelector('#am-pay').addEventListener('click', () => {
      s.resources.lingshi = Math.floor(s.resources.lingshi * 0.85);
      g.LS.save.save();
      toast('留下买路财，对方掂量一番放行了。');
      removeModals();
    });
    card.querySelector('#am-flee').addEventListener('click', () => {
      s.resources.lingshi = Math.floor(s.resources.lingshi * 0.8);
      g.LS.save.save();
      toast('你遁光一展，狼狈走脱——背后传来嗤笑。');
      removeModals();
    });
    card.querySelector('#am-fight').addEventListener('click', () => {
      removeModals();
      g.LS.battle.startAmbushFight(info.spec, {
        cpScale: info.cpScale,
        name: info.name,
        onWin: () => {
          const gain = Math.max(50, Math.floor(g.LS.economy.computePerSecond('lingshi') * 180));
          s.resources.lingshi += gain;
          s.xinmo = Math.min(100, (s.xinmo || 0) + 5);
          if (g.LS.path && s.path === 'xie') g.LS.path.addXuesha(((g.LS.BAL.xuesha || {}).sources || {}).kill_ambush || 0);
          g.LS.save.save();
          g.LS.ui.toast('斩杀' + info.name + '——夺其囊中灵石 +' + g.LS.util.fmt(gain) + '，心魔 +5。', 4200);
          g.LS.ui.renderAll();
        },
        onLose: () => {
          if (info.cpScale >= 1.3 && g.LS.realm.resolveDeath) {
            const how = g.LS.realm.resolveDeath('battle');
            if (how === 'death') return;
            g.LS.ui.toast('重伤垂死之际保住一命——修为十不存一。', 4200);
            s.resources.xiufu *= 0.1;
            g.LS.save.save();
          } else {
            const lost = Math.floor(s.resources.lingshi * 0.2);
            s.resources.lingshi -= lost;
            g.LS.save.save();
            g.LS.ui.toast('不敌' + info.name + '——被夺走灵石 ' + g.LS.util.fmt(lost) + '，侥幸留得性命。', 4200);
          }
          g.LS.ui.renderAll();
        }
      });
    });
  }

  /* ── 页面注册：地图 / 丹房 / 市场（page.js 路由） ── */
  function registerPages() {
    if (!g.LS.page || g.LS.page._registered) return;
    g.LS.page._registered = true;

    // 见闻区下方的舆图微缩：**与地图页同一份画**（竖屏 scene / 宽屏 wide），
    // 不再另画一张 —— 这样两边看上去就是同一幅，标记百分比也天然一致
    /* 舆图地点坐标 —— 唯一定义处，地图页与见闻区微缩共用同一份。
       语义 = 标记正中所在的百分比位置（.map-spot 与微缩标记都是中心对齐），
       所以同一串数字在两边落在同一处地物上，不会再各写各的。 */
    function mapSpots(W) {
      return W ? [
        { id: 'dannfang', name: '丹 房', x: 11.6, y: 84.4, desc: '炼丹服丹' },
        { id: 'market', name: '市 场', x: 49.6, y: 83.2, desc: '灵石买卖' },
        { id: 'arena', name: '擂 台', x: 45.3, y: 56.6, desc: '论道切磋' },
        { id: 'locked1', name: '？', x: 85.7, y: 24.8, locked: true },
        { id: 'modao', name: '魔 道', x: 7.4, y: 69.8, desc: '血祭与魔功', locked: g.LS.S.path !== 'xie' },
        { id: 'seek', name: '寻 徒', x: 88.2, y: 89.8, desc: '下山访贤' },
        { id: 'locked4', name: '？', x: 18.2, y: 83.1, locked: true }
      ] : [
        { id: 'dannfang', name: '丹 房', x: 17.3, y: 81.4, desc: '炼丹服丹' },
        { id: 'market', name: '市 场', x: 41.8, y: 85.9, desc: '灵石买卖' },
        { id: 'arena', name: '擂 台', x: 49.2, y: 52.7, desc: '论道切磋' },
        { id: 'locked1', name: '？', x: 68.9, y: 18.0, locked: true },
        { id: 'modao', name: '魔 道', x: 5.9, y: 58.0, desc: '血祭与魔功', locked: g.LS.S.path !== 'xie' },
        { id: 'seek', name: '寻 徒', x: 70.4, y: 88.3, desc: '下山访贤' },
        { id: 'locked4', name: '？', x: 58.9, y: 73.7, locked: true }
      ];
    }

    function paintMini(st) {
      const W = mapIsWide();
      st.dataset.mode = W ? 'wide' : 'tall';
      const oldSvg = st.querySelector('.map-svg');
      if (oldSvg) oldSvg.remove();
      st.insertAdjacentHTML('afterbegin', W
        ? (g.MAPART.wide ? g.MAPART.wide() : '')
        : (g.MAPART.scene ? g.MAPART.scene() : ''));
      // 标记随视口取同一份坐标 —— 换了构图就一起换，永不脱节
      const dots = [...st.querySelectorAll('span')];
      mapSpots(W).forEach((sp, i) => {
        const d = dots[i];
        if (!d) return;
        d.style.left = sp.x + '%';
        d.style.top = sp.y + '%';
      });
    }

    function buildMini() {
      const mm = document.getElementById('map-mini');
      if (!mm || !g.MAPART) return;
      let st = mm.querySelector('.map-stage');
      if (!st) {
        st = document.createElement('div');
        st.className = 'map-stage';
        while (mm.firstChild) st.appendChild(mm.firstChild);
        mm.appendChild(st);
      }
      paintMini(st);
    }
    if (!window.__miniBound) {
      window.__miniBound = true;
      window.addEventListener('resize', () => {
        try {
          const st = document.querySelector('#map-mini .map-stage');
          if (!st) return;
          if ((st.dataset.mode === 'wide') !== mapIsWide()) paintMini(st);
        } catch (e) {}
      });
    }
    try { buildMini(); } catch (e) {}

    /* 舆图画卷自适应：画面按 390:720（手机竖幅）或 1200:600（宽屏横卷）等比，
       宽屏时不再出现"竖画塞进横屏"的压扁/留白 */
    function fitMapStage() {
      const c = document.querySelector('.map-canvas');
      if (!c) return;
      const st = c.querySelector('.map-stage');
      if (!st) return;
      const r = c.getBoundingClientRect();
      const K = (st.dataset.mode === 'wide') ? (1200 / 600) : (390 / 720);
      let w = r.width, h = w / K;
      if (h > r.height) { h = r.height; w = h * K; }
      st.style.width = Math.max(1, Math.floor(w)) + 'px';
      st.style.height = Math.max(1, Math.floor(h)) + 'px';
    }
    function mapIsWide() { return (window.innerWidth || 0) >= 900; }
    if (!window.__mapStageBound) {
      window.__mapStageBound = true;
      window.addEventListener('resize', () => {
        try {
          const st = document.querySelector('.map-canvas .map-stage');
          if (!st) return;
          // 跨过宽窄阈值就整页重画（换构图也换点位），否则只重量尺寸
          if ((st.dataset.mode === 'wide') !== mapIsWide()) g.LS.page.refresh();
          else fitMapStage();
        } catch (e) {}
      });
    }

    g.LS.page.register('map', { title: '灵 山 舆 图', render: () => {
      // 两套构图两套坐标，各自对得上自己画布里的地物；不变的是落点 ——
      // 擂台在山巅平台、丹房在西侧山腰瀑溪旁、市场在山脚溪口与灵田之间，
      // 四个待开化点分别落在云中、左岸/西麓、泽心礁洲、近景坡地。
      const W = mapIsWide();
      const spots = mapSpots(W);   // 与见闻区微缩同一份坐标
      // 山水与地点剪影都来自 js/mapart.js；未加载时退化成空背景，地点仍可点
      const drawScene = (W && g.MAPART && g.MAPART.wide) ? g.MAPART.wide
                     : ((g.MAPART && g.MAPART.scene) ? g.MAPART.scene : null);
      const art = drawScene ? drawScene() : '';
      const glyph = (id) => ((g.MAPART && g.MAPART.glyph) ? g.MAPART.glyph(id) : '');
      const spotHtml = spots.map(s => s.locked
        ? '<div class="map-spot locked" style="left:' + s.x + '%;top:' + s.y + '%"><div class="ms-icon">' + glyph('locked') + '</div><span>待开化</span></div>'
        : '<button class="map-spot" data-spot="' + s.id + '" style="left:' + s.x + '%;top:' + s.y + '%"><div class="ms-icon">' + glyph(s.id) + '</div><span>' + escapeHtml(s.name) + '</span><i>' + escapeHtml(s.desc) + '</i></button>'
      ).join('');
      return '<div class="map-canvas"><div class="map-stage" data-mode="' + (W ? 'wide' : 'tall') + '">' +
        art + spotHtml + '<div class="map-note">─── 山径所至，皆是机缘 ───</div></div></div>';
    },
    mount: () => {
      // 刚建视图时还没布局（宽高为 0），所以下一帧与稍后各再量一次
      const run = () => { try { fitMapStage(); } catch (e) {} };
      run();
      if (window.requestAnimationFrame) requestAnimationFrame(run);
      setTimeout(run, 150);
    } });

    g.LS.page.register('dannfang', { title: '丹 房', render: () => {
      // 与丹房弹窗同一套内容（服丹/丹毒条）
      const eco = g.LS.economy;
      const s = g.LS.S;
      const q = eco.pillQualityCfg() || { toxic_penalty: {} };
      const toxic = s.pill_toxic || 0;
      const penalty = Math.min(q.toxic_penalty.cap || 0.30, Math.floor(toxic / 10) * (q.toxic_penalty.per_10_points || 0.05));
      let rows = '';
      for (const p of ((g.LS.BAL.pills && g.LS.BAL.pills.pills) || [])) {
        const qBtns = ['劣', '凡', '灵', '珍', '仙'].map(q2 => {
          const n = (s.pill_stock || {})[eco.pillStockKey ? eco.pillStockKey(p.id, q2) : p.id + '_' + q2] || 0;
          if (!n) return '';
          return '<button class="icon-btn" data-pill="' + p.id + '" data-q="' + q2 + '" style="padding:2px 8px;font-size:11px;min-height:0">' + q2 + '×' + n + '</button>';
        }).filter(Boolean).join(' ');
        rows += '<div class="rebirth-item"><div><b>' + escapeHtml(p.name) + '</b>' +
          '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(p.desc) + '</div></div>' +
          '<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">' + (qBtns || '<span style="font-size:11px;color:var(--ink-soft)">无库存</span>') + '</div></div>';
      }
      return '<div class="modal-desc">丹毒 <b style="color:' + (toxic >= 30 ? 'var(--cinnabar)' : 'inherit') + '">' + Math.floor(toxic) + '</b>' +
        '（当前产量 ' + (penalty > 0 ? '-' + Math.round(penalty * 100) + '%' : '无碍') + '）' +
        '<br><span style="font-size:11px;color:var(--ink-soft)">丹毒随时间缓缓消散；清心丹可大幅化解；兵解转世丹毒尽去。点品质按钮即服。</span></div>' + rows;
    },
    mount: (root) => {
      root.querySelectorAll('[data-pill]').forEach(btn => btn.addEventListener('click', () => {
        const r = g.LS.economy.consumePill(btn.dataset.pill, btn.dataset.q || '灵');
        if (r.ok) { sfx('click'); toast(r.msg); }
        g.LS.page.refresh();
        renderResources();
      }));
    }});

    g.LS.page.register('arena', { title: '擂 台', render: () => {
      const s = g.LS.S;
      const ranks = (g.LS.BAL.battle || {}).ranks || [];
      let rank = ranks[0] || { name: '凡品' };
      for (const r of ranks) if ((s.honor || 0) >= r.min) rank = r;
      const rec = s.record || { win: 0, lose: 0 };
      let html = '<div class="modal-desc" style="text-align:center">论道积分 <b>' + (s.honor || 0) + '</b> · 段位 <b style="color:var(--cinnabar)">' + escapeHtml(rank.name) + '</b> · 战绩 ' + rec.win + ' 胜 ' + rec.lose + ' 负</div>';
      const tiers = g.LS.battle.SENIOR_TIERS;
      html += '<h3 class="panel-title" style="font-size:14px">挑战大师兄（人机陪练）</h3>';
      html += '<div class="senior-row">' + Object.values(tiers).map(t => {
        const oppIdx = Math.max(0, Math.min(9, s.realm.index + t.offset));
        const rel = t.offset === 0 ? '与你同境' : (t.offset < 0 ? '低你一境' : '高你一境');
        return '<button class="senior-tier" data-tier="' + t.key + '"><b>' + escapeHtml(t.label) + '</b>' +
          '<span class="st-rel">凌云子 · ' + escapeHtml((g.LS.BAL.realms[oppIdx] || {}).name || '?') + '境（' + rel + '）</span>' +
          '<span class="st-desc">' + escapeHtml(t.desc) + '</span></button>';
      }).join('') + '</div>';
      const fr = s.friends || [];
      html += '<h3 class="panel-title" style="font-size:14px;margin-top:14px">道友切磋（化神起）</h3>';
      html += fr.length ? fr.map((f, i) =>
        '<div class="rebirth-item"><div><b>' + escapeHtml(f.dao || '无名道友') + '</b>' +
        '<div style="font-size:11px;color:var(--ink-soft)">境界 ' + escapeHtml(f.realmName || '?') + ' · 战绩 ' + (f.myWin || 0) + ' 胜 ' + (f.myLose || 0) + ' 负</div></div>' +
        '<button class="btn-primary" data-arena-fight="' + i + '" style="padding:4px 12px">斗 法</button></div>').join('')
        : '<div class="modal-desc" style="font-size:11px;color:var(--ink-soft)">还没有道友——去道友录交换名片。</div>';
      return html;
    },
    mount: (root) => {
      root.querySelectorAll('[data-tier]').forEach(btn => btn.addEventListener('click', () => {
        removeModals();
        g.LS.battle.challengeSenior(btn.dataset.tier);
      }));
      root.querySelectorAll('[data-arena-fight]').forEach(btn => btn.addEventListener('click', () => {
        const f = (g.LS.S.friends || [])[Number(btn.dataset.arenaFight)];
        if (f) { removeModals(); g.LS.battle.prepareBattle(f); }
      }));
    }});
    g.LS.page.register('market', { title: '市 场', render: () => {
      const d = g.LS.market.renderData();
      let html = '<div class="modal-desc">散修集市——价格随你的产业水涨船高，不会白送也不会天价。灵石 <b data-live-resource="lingshi">' + fmtResourceById('lingshi', g.LS.S.resources.lingshi) + '</b></div>';
      html += '<h3 class="panel-title" style="font-size:14px">购 买</h3>';
      html += d.items.map(it =>
        '<div class="rebirth-item"><div><b>' + escapeHtml(it.name) + '</b>' +
        (it.note ? '<span class="ev-badge ev-badge-buff">' + escapeHtml(it.note) + '</span>' : '') +
        '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(it.desc) + '</div></div>' +
        '<button class="icon-btn" data-mbuy="' + it.id + '" data-market-cost="' + it.price + '" ' + (g.LS.S.resources.lingshi >= it.price ? '' : 'disabled') + '>' + g.LS.util.fmt(it.price) + ' 灵石</button></div>').join('');
      html += '<h3 class="panel-title" style="font-size:14px;margin-top:12px">卖 出</h3>';
      html += d.sellable.length ? d.sellable.map(p =>
        '<div class="rebirth-item"><div style="font-size:12.5px">' + escapeHtml(p.name) + '</div>' +
        '<button class="icon-btn" data-msellpill="' + p.key + '">得 ' + g.LS.util.fmt(p.gain) + ' 灵石</button></div>').join('')
        : '<div class="modal-desc" style="font-size:11px;color:var(--ink-soft)">没有可卖的丹药。</div>';
      html += d.gearSell.length ? d.gearSell.map(gp =>
        '<div class="rebirth-item"><div style="font-size:12.5px">' + escapeHtml(gp.name) + '<span style="font-size:10px;color:var(--ink-soft)">（非佩戴）</span></div>' +
        '<button class="icon-btn" data-msellgear="' + gp.kind + ':' + gp.id + '">回售 ' + g.LS.util.fmt(gp.gain) + '</button></div>').join('')
        : '<div class="modal-desc" style="font-size:11px;color:var(--ink-soft)">没有多余的装备。</div>';
      return html;
    },
    mount: (root) => {
      root.querySelectorAll('[data-mbuy]').forEach(btn => btn.addEventListener('click', () => {
        const r = g.LS.market.buy(btn.dataset.mbuy);
        toast(r.msg, r.ok ? 3600 : 2200);
        if (r.ok) { sfx('guqin'); g.LS.page.refresh(); renderResources(); }
      }));
      root.querySelectorAll('[data-msellpill]').forEach(btn => btn.addEventListener('click', () => {
        const parts = btn.dataset.msellpill.split('_');
        const q = parts[parts.length - 1];
        const id = parts.slice(0, -1).join('_');
        const r = g.LS.market.sellPill(id, q);
        toast(r.msg);
        if (r.ok) { sfx('click'); g.LS.page.refresh(); renderResources(); }
      }));
      root.querySelectorAll('[data-msellgear]').forEach(btn => btn.addEventListener('click', () => {
        const [kind, id] = btn.dataset.msellgear.split(':');
        const r = g.LS.market.sellGear(kind, id);
        toast(r.msg);
        if (r.ok) { sfx('click'); g.LS.page.refresh(); renderResources(); }
      }));
    }});
  }

  /* ── 快速切磋（道友录「斗法」）：一键论道——CP+道心判定，10 分钟冷却，防连点刷收益 ── */
  function quickDuel(f, btn) {
    const s = g.LS.S;
    const now = Date.now();
    s.quick_duel_cd = s.quick_duel_cd || 0;
    if (now < s.quick_duel_cd) {
      return { ok: false, msg: '论道气机未复（还需 ' + Math.ceil((s.quick_duel_cd - now) / 60000) + ' 分钟）' };
    }
    if (s.realm.index < 4) return { ok: false, msg: '化神方可与道友切磋' };
    // 战力判定（乙§2.3 公式，双方同构）：名片 realm+装备锋锐 → CP
    const cul = g.LS.BAL.cultivation || {};
    const mySharp = ((cul.weapons || []).find(x => x.id === s.equip.weapon) || {}).sharp || 5;
    const frSharp = ((cul.weapons || []).find(x => x.id === (f.card && f.card.weapon)) || {}).sharp || 5;
    const myCP = 100 * Math.pow(2.05, s.realm.index) * (1 + Math.min(0.6, mySharp / 400)) * Math.max(0.8, 1 - (s.pill_toxic || 0) * 0.002);
    const frRealm = (f.card && f.card.realm) || 0;
    const frCP = 100 * Math.pow(2.05, frRealm) * (1 + Math.min(0.6, frSharp / 400));
    const daoGap = ((s.dao_heart || 0) - ((f.card && f.card.daoxin) || 30)) * 0.002;
    const winRate = Math.max(0.3, Math.min(0.85, 0.5 * Math.pow(myCP / frCP, 0.55) + 0.05 + daoGap));
    const win = Math.random() < winRate;
    s.quick_duel_cd = now + 600000; // 10 分钟冷却
    const lines = [];
    const eco = g.LS.economy;
    let headline, color;
    if (win) {
      const gain = Math.max(50, Math.floor(eco.computePerSecond('lingshi') * 90));
      s.resources.lingshi += gain;
      s.honor = (s.honor || 0) + 6;
      g.LS.state.changeDaoHeart(1);
      headline = '论 道 得 胜';
      color = 'var(--gold,#e8c34a)';
      lines.push('你与' + (f.dao || '道友') + '切磋三回合：');
      lines.push('首回合你以五行术抢占先机；次回合对方罡气护体勉力支撑；末回合你一招' + ((g.LS.BAL.cultivation.battle_cards.my_cards.find(c => c.kind === 'attack') || {}).name || '飞剑') + '破开罡气——');
      lines.push('胜！论道积分 +6，切磋礼金灵石 +' + g.LS.util.fmt(gain) + '。');
    } else {
      const lost = Math.floor((s.resources.xiufu || 0) * 0.04);
      s.resources.xiufu = Math.max(0, (s.resources.xiufu || 0) - lost);
      headline = '论 道 惜 败';
      color = 'var(--cinnabar,#c0392b)';
      lines.push('你与' + (f.dao || '道友') + '切磋三回合：');
      lines.push('对方识破你的起手，中盘反压一头；末回合你收势认负——');
      lines.push('惜败。修为损失 ' + g.LS.util.fmt(lost) + '（4%），得对方一句「承让」。');
    }
    g.LS.save.save();
    // 结果弹窗（简要战报逐行显影）
    removeModals();
    const { card } = makeModal(removeModals);
    card.innerHTML =
      '<div class="modal-title" style="color:' + color + '">' + headline + '</div>' +
      '<div class="modal-desc" style="text-align:left">' + lines.map((l, i) =>
        '<div class="un-line" style="animation:none;opacity:0;text-align:left" data-line="' + i + '">' + escapeHtml(l) + '</div>').join('') +
      '</div>' +
      '<div class="modal-desc" style="font-size:11px;color:var(--ink-soft)">胜率评估 ' + Math.round(winRate * 100) + '%（我 ' + g.LS.util.fmt(Math.round(myCP)) + ' / 敌 ' + g.LS.util.fmt(Math.round(frCP)) + '）· 冷却 10 分钟</div>' +
      '<div style="text-align:center"><button class="btn-primary" id="qd-close" style="padding:6px 22px">归 位</button></div>';
    card.querySelectorAll('.un-line').forEach((l, i) => {
      l.style.transition = 'opacity .3s ease ' + (i * 0.45) + 's';
      requestAnimationFrame(() => { l.style.opacity = '1'; });
    });
    card.querySelector('#qd-close').addEventListener('click', removeModals);
    sfx(win ? 'bell' : 'click');
    return { ok: true, win };
  }

  /* ── 主线面板 v2：欠账补领制——全部章节平铺，达标即可领，独立领奖钮 ── */
  function showQuest() {
    removeModals();
    const { card } = makeModal(removeModals);
    card.classList.add('quest-card');
    const chapters = (g.LS.BAL.story || {}).chapters || [];
    const render = () => {
      const T = g.LS.quest;
      let firstOpen = true;
      let html = '<div class="modal-title">主 线 · 掌 门 之 路<button class="icon-btn" id="q-close" style="float:right;font-size:12px;padding:3px 12px">合 上</button></div>';
      html += '<div class="modal-desc" style="font-size:11px;color:var(--ink-soft)">达标即可领，可跳可欠——任何时候回来都不丢奖励。</div>';
      for (let c = 0; c < chapters.length; c++) {
        const ch = chapters[c];
        const prog = T.chapterProgress(c);
        const claimables = ch.tasks.filter((t, i) => T.taskState(c, i) === 'claimable').length;
        const isOpen = claimables > 0 || (firstOpen && c === 0 && prog.claimed === 0) || (claimables === 0 && prog.claimed === prog.total && firstOpen && c === 0);
        if (claimables > 0 && firstOpen) firstOpen = false;
        html += '<div class="quest-ch" data-ch="' + c + '" style="margin:8px 0"><div class="quest-ch-hd" data-toggle="' + c + '" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 2px">' +
          '<b style="font-size:13.5px;color:' + (prog.allClaimed ? 'var(--ms-ink-4,#7a6a55)' : 'var(--ink,#3a3226)') + '">' + escapeHtml(ch.name) + '</b>' +
          '<span style="font-size:11px;color:var(--ms-ink-4,#a6987f)">' + prog.claimed + '/' + prog.total + '</span>' +
          (claimables ? '<span class="ev-badge" style="color:var(--cinnabar);border-color:var(--cinnabar)">可领 ×' + claimables + '</span>' : '') +
          (prog.allClaimed ? '<span style="font-size:11px;color:var(--ms-ink-5,#a6987f)">✓ 已完成</span>' : '') +
          '<span style="margin-left:auto;font-size:10px;color:var(--ms-ink-5,#a6987f)">' + (isOpen ? '收起 ▴' : '展开 ▾') + '</span></div>';
        html += '<div class="quest-ch-bd" style="display:' + (isOpen ? '' : 'none') + '">';
        if (isOpen) html += '<div class="modal-desc" style="font-size:11.5px;color:var(--ink-soft)">' + escapeHtml(ch.intro) + '</div>';
        for (let i = 0; i < ch.tasks.length; i++) {
          const t = ch.tasks[i];
          const stt = T.taskState(c, i);
          const done = stt === 'claimed';
          const ok = stt === 'claimable';
          html += '<div class="rebirth-item' + (done ? ' bought' : '') + '" style="' + (ok ? 'border-color:var(--gold);box-shadow:0 0 10px rgba(232,195,74,.25)' : '') + '"><div>' +
            '<b>' + (done ? '✓ ' : ok ? '◆ ' : '▸ ') + escapeHtml(t.desc) + '</b>' +
            (t.reward && t.reward.lingshi ? '<span style="font-size:11px;color:#e8c34a">　灵石 +' + g.LS.util.fmt(t.reward.lingshi) + '</span>' : '') +
            (stt !== 'progress' ? '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(t.story || '') + '</div>' : '') + '</div>' +
            (ok ? '<button class="btn-primary" data-claim="' + c + '_' + i + '" style="padding:5px 16px;animation:ms-breath 2.3s var(--ms-ease-soft) infinite">领 奖</button>' : done ? '<span class="stamp">已 领</span>' : '') +
            '</div>';
        }
        if (isOpen && prog.allClaimed) html += '<div class="modal-desc" style="border:1px dashed rgba(192,57,43,.4);border-radius:8px"><b>章末</b><br>' + escapeHtml(ch.outro) + '</div>';
        html += '</div></div>';
      }
      card.innerHTML = html;
      card.querySelectorAll('#q-close').forEach(btn => btn.addEventListener('click', removeModals));
      card.querySelectorAll('[data-toggle]').forEach(hd => hd.addEventListener('click', () => {
        const bd = hd.parentElement.querySelector('.quest-ch-bd');
        bd.style.display = bd.style.display === 'none' ? '' : 'none';
        hd.querySelector('span:last-child').textContent = bd.style.display === 'none' ? '展开 ▾' : '收起 ▴';
      }));
      card.querySelectorAll('[data-claim]').forEach(btn => btn.addEventListener('click', () => {
        const [c, i] = btn.dataset.claim.split('_').map(Number);
        const r = g.LS.quest.claim(c, i);
        if (r) queueQuestClaimToast(r);   // 合并成一条，防连点刷屏
        render();
        renderAll();
      }));
    };
    render();
  }

  /* ── 传承面板：亲传弟子 / 投喂 / 代际 ── */
  /* ── 主线领奖提示合并（2026-09-19）────────────────────────────────────────
     主线 10 章 31 个任务，补领制下可以积压一堆可领；连点领奖原本每个任务弹一条
     「灵石 +XXX」、每章再弹一条章末长文案，一次领完能刷出 40 条、糊满手机屏。
     这里把短时间内的多次领奖汇总成一条，500ms 静默后一起弹。
     章末剧情文案不再弹 toast —— 同一句本来就在主线面板的章末块里渲染（showQuest），
     弹到屏幕上属于同句重复。 */
  let questClaimBuf = null;
  function queueQuestClaimToast(r) {
    const buf = questClaimBuf || (questClaimBuf = { n: 0, lingshi: 0, timer: null });
    buf.n += 1;
    const gain = (r.task && r.task.reward && r.task.reward.lingshi) || 0;
    buf.lingshi += gain;
    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = setTimeout(flushQuestClaimToast, 500);
  }
  function flushQuestClaimToast() {
    const buf = questClaimBuf;
    questClaimBuf = null;
    if (!buf) return;
    const head = buf.n > 1 ? '主线领奖 ×' + buf.n : '主线领奖';
    toast(head + (buf.lingshi > 0 ? ' · 灵石 +' + fmtSafe(buf.lingshi) : ''), 3000);
  }

  function showDiscipleSeek() {
    removeModals();
    const { card } = makeModal(removeModals);
    const routes = [
      { id: 'village', name: '村镇访孤', desc: '偏向忠厚、善良与勤勉之人。' },
      { id: 'market', name: '坊市访贤', desc: '偏向聪慧之人，也可能遇到逐利之徒。' },
      { id: 'secret', name: '秘境寻缘', desc: '灵根与术法更佳，心性却更难预料。' }
    ];
    card.innerHTML = '<div class="modal-title">下 山 寻 徒</div><div class="modal-desc">每次寻访耗时三十日，同一地点九十日后才会再有新人。三名候选中只能带回一人。</div>' +
      '<div class="disciple-route-grid">' + routes.map(route => '<button class="disciple-route" data-seek="' + route.id + '"><b>' + route.name + '</b><span>' + route.desc + '</span></button>').join('') + '</div>' +
      '<div class="disciple-modal-actions"><button class="icon-btn" id="seek-close">暂不下山</button></div>';
    card.querySelector('#seek-close').addEventListener('click', removeModals);
    card.querySelectorAll('[data-seek]').forEach(btn => btn.addEventListener('click', () => {
      const result = g.LS.disciples.seekCandidates(btn.dataset.seek);
      if (!result.ok) { toast(result.msg); return; }
      showDiscipleRecruit(result.candidates, {
        title: '寻 徒 归 山',
        desc: '此行耗时三十日。择一人收入门下，亦可空手而归。',
        maxSelect: 1,
        acceptText: '收为弟子',
        rejectText: '空手归山'
      });
      renderAll();
    }));
  }

  function showDiscipleTrial() {
    removeModals();
    const { card } = makeModal(removeModals);
    const n = g.LS.disciples.active().length;
    const cost = 3000 + n * 250;
    const exams = [
      { id: 'heart', name: '问心', desc: '更易选出忠厚善良之人' },
      { id: 'root', name: '测灵根', desc: '从多次测定中保留更佳灵根' },
      { id: 'battle', name: '斗法', desc: '候选人掌握更多术法' },
      { id: 'endure', name: '耐性', desc: '偏向勤勉隐忍，成熟度更高' }
    ];
    card.innerHTML = '<div class="modal-title">宗 门 试 炼</div><div class="modal-desc">选择两项考核，遴选五名候选，最终可录取一至三人。举办本次试炼需灵石 ' + fmtSafe(cost) + '。</div>' +
      '<div class="disciple-exam-grid">' + exams.map(exam => '<label class="disciple-exam"><input type="checkbox" value="' + exam.id + '"><b>' + exam.name + '</b><span>' + exam.desc + '</span></label>').join('') + '</div>' +
      '<div class="disciple-modal-actions"><button class="btn-primary" id="trial-start">开 试</button><button class="icon-btn" id="trial-close">取 消</button></div>';
    card.querySelectorAll('.disciple-exam input').forEach(input => input.addEventListener('change', () => {
      const checked = card.querySelectorAll('.disciple-exam input:checked');
      if (checked.length > 2) { input.checked = false; toast('只能选择两项考核。'); }
    }));
    card.querySelector('#trial-close').addEventListener('click', showDisciple);
    card.querySelector('#trial-start').addEventListener('click', () => {
      const picked = Array.from(card.querySelectorAll('.disciple-exam input:checked')).map(input => input.value);
      const result = g.LS.disciples.trialCandidates(picked);
      if (!result.ok) { toast(result.msg); return; }
      showDiscipleRecruit(result.candidates, {
        title: '试 炼 放 榜',
        desc: '试炼已毕，可录取一至三人。未选中者自行下山。',
        maxSelect: 3,
        acceptText: '收入门下',
        rejectText: '本届不录'
      });
      renderAll();
    });
  }

  function showDisciple() {
    removeModals();
    const { card } = makeModal(removeModals);
    card.classList.add('disciple-manager-card');
    const render = () => {
      const s = g.LS.S;
      const disciples = g.LS.disciples ? g.LS.disciples.active() : [];
      const party = g.LS.disciples && g.LS.disciples.battleParty ? g.LS.disciples.battleParty() : [];
      let html = '<div class="modal-title">传 承 · 掌 门 亲 传<button class="icon-btn" id="d-close" style="float:right;font-size:12px;padding:3px 12px">合 上</button></div>';
      html += '<div class="disciple-manager-head"><div><b>门下 ' + disciples.length + ' / 20</b><span>出战 ' + party.length + ' / 3 · 每人携带一项术法</span></div><button class="btn-primary" id="d-trial" ' + (disciples.length >= 20 ? 'disabled' : '') + '>宗门试炼</button></div>';
      html += '<div class="modal-desc disciple-generation">第 ' + ((s.generation || 0) + 1) + ' 代掌门 · 历代传承加成：' + (s.heirloom ? Object.keys(s.heirloom).length + ' 项生效' : '尚无（转正后选定）') + '</div>';
      if (!disciples.length) {
        html += '<div class="modal-desc">尚未收徒——推进主线「第一章·开山立派」，首位亲传弟子将叩山门。</div>';
      } else {
        const stages = (g.LS.BAL.disciple || {}).stages || [];
        const traitText = d => (d.traits || []).map(t => {
          const def = g.LS.disciples.traitDef(t.key);
          return t.revealed ? escapeHtml(def ? def.name : t.key) : '?';
        }).join(' · ');
        const skillText = d => (d.skills || []).map(sk => {
          const def = g.LS.disciples.skillDef(sk.id);
          return sk.revealed ? escapeHtml(def ? def.name : sk.id) : '?';
        }).join(' · ');
        html += '<div class="disciple-list">' + disciples.map(d => {
          const pct = Math.floor(d.progress || 0);
          const mayTransmit = s.path === 'xie' && (d.mood === 'resentful' || (d.traits || []).some(t => (g.LS.disciples.traitDef(t.key) || {}).polarity < 0));
          const revealedSkills = (d.skills || []).filter(skill => skill.revealed);
          const skillOptions = revealedSkills.map(skill => {
            const def = g.LS.disciples.skillDef(skill.id);
            return '<option value="' + skill.id + '" ' + (skill.id === d.battle_skill_id ? 'selected' : '') + '>' + escapeHtml(def ? def.name : skill.id) + '</option>';
          }).join('');
          const referReady = d.stage >= 2 && (s.game_days || 0) >= (d.referral_ready_day || 0);
          return '<article class="disciple-card' + (d.battle_selected ? ' is-battle' : '') + '"><div class="disciple-card-main"><div class="disciple-name"><b>' + escapeHtml(d.name) + '</b>' + (d.agent ? '<span class="ev-badge ev-badge-buff">代理掌门</span>' : '') + (d.battle_selected ? '<span class="ev-badge">出战</span>' : '') + '</div>' +
            '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml((stages[d.stage] || {}).name || '入门') + ' · 境界 ' + escapeHtml((g.LS.BAL.realms[d.realm] || {}).name || '练气') + ' · 怀疑 ' + Math.floor(d.suspicion || 0) + '</div>' +
            '<div style="font-size:10.5px;color:var(--ink-soft)">来处：' + escapeHtml(d.source || '山门来投') + '</div>' +
            '<div style="font-size:11px;margin-top:4px">性情：' + traitText(d) + '</div><div style="font-size:11px">术法：' + skillText(d) + '</div>' +
            '<div class="bh-hp" style="margin-top:6px"><div class="bh-fill" style="width:' + pct + '%"></div></div>' +
            '<div style="font-size:10.5px;color:var(--ink-soft)">成熟度 ' + pct + '% · 投喂 ' + (d.fed || 0) + ' 颗 · 自动 ' + (0.02 * (s.realm.index + 1) * (d.agent ? 2 : 1) * 60).toFixed(1) + '%/分钟</div>' +
            '<div class="disciple-battle-config"><label><input type="checkbox" data-d-battle="' + d.id + '" ' + (d.battle_selected ? 'checked' : '') + (revealedSkills.length ? '' : ' disabled') + '>出战</label><select data-d-skill="' + d.id + '" ' + (revealedSkills.length ? '' : 'disabled') + '>' + (skillOptions || '<option>尚无术法</option>') + '</select></div>' +
            '<div class="disciple-card-actions"><button class="icon-btn" data-d-feed="' + d.id + '">投喂</button><button class="icon-btn" data-d-heart="' + d.id + '">问心</button>' +
            (d.stage >= 2 ? '<button class="icon-btn" data-d-refer="' + d.id + '" title="' + (referReady ? '请这名亲传弟子举荐一名新人' : '还需 ' + Math.ceil((d.referral_ready_day || 0) - (s.game_days || 0)) + ' 日') + '" ' + (referReady ? '' : 'disabled') + '>举荐</button>' : '') +
            (mayTransmit ? '<button class="icon-btn" data-d-magic="' + d.id + '">传魔功</button>' : '') + '<button class="icon-btn" data-d-expel="' + d.id + '">逐出</button></div></div></article>';
        }).join('') + '</div>';
      }
      if (disciples.some(d => d.agent)) html += '<div class="modal-desc" style="margin-top:8px"><b>太上长老纪要</b><br>你已传位垂帘。代理掌门升至化神大圆满时，将触发「代际传承」四选一。</div>';
      card.innerHTML = html;
      const dc = card.querySelector('#d-close');
      if (dc) dc.addEventListener('click', removeModals);
      const trial = card.querySelector('#d-trial');
      if (trial) trial.addEventListener('click', showDiscipleTrial);
      card.querySelectorAll('[data-d-battle]').forEach(input => input.addEventListener('change', () => {
        const done = g.LS.disciples.configureBattle(input.dataset.dBattle, input.checked, null);
        if (!done.ok) { input.checked = !input.checked; toast(done.msg); return; }
        render();
      }));
      card.querySelectorAll('[data-d-skill]').forEach(select => select.addEventListener('change', () => {
        const done = g.LS.disciples.configureBattle(select.dataset.dSkill, null, select.value);
        toast(done.ok ? '出战术法已更换。' : done.msg);
      }));
      card.querySelectorAll('[data-d-refer]').forEach(btn => btn.addEventListener('click', () => {
        const done = g.LS.disciples.referralCandidate(btn.dataset.dRefer);
        if (!done.ok) { toast(done.msg); return; }
        showDiscipleRecruit(done.candidates, {
          title: '弟 子 举 荐',
          desc: done.referrer + '带来一位相识之人。可收入门下，也可婉拒。',
          maxSelect: 1,
          acceptText: '收为弟子',
          rejectText: '婉拒举荐'
        });
      }));
      card.querySelectorAll('[data-d-feed]').forEach(df => df.addEventListener('click', () => {
        const order = ['仙', '珍', '灵', '凡', '劣'];
        const stock = s.pill_stock || {};
        let done = null;
        for (const q of order) {
          for (const key of Object.keys(stock)) {
            if (key.slice(-(q.length + 1)) === '_' + q && stock[key] > 0) {
              done = g.LS.quest.feedDisciple(key.slice(0, key.length - q.length - 1), q, df.dataset.dFeed);
              break;
            }
          }
          if (done && done.ok) break;
        }
        if (!done) done = { ok: false, msg: '丹房无丹可喂' };
        toast(done.msg);
        if (done.ok) { sfx('guqin'); render(); }
      }));
      card.querySelectorAll('[data-d-heart]').forEach(btn => btn.addEventListener('click', () => {
        const done = g.LS.disciples.askHeart(btn.dataset.dHeart); toast(done.msg); if (done.ok) { g.LS.save.save(); render(); }
      }));
      card.querySelectorAll('[data-d-magic]').forEach(btn => btn.addEventListener('click', () => {
        const done = g.LS.disciples.transmitMagic(btn.dataset.dMagic); toast(done.msg); if (done.ok) { g.LS.save.save(); render(); }
      }));
      card.querySelectorAll('[data-d-expel]').forEach(btn => btn.addEventListener('click', () => {
        const d = g.LS.disciples.byId(btn.dataset.dExpel);
        if (!d || !window.confirm('逐出' + d.name + '？此举损伤道心，且可能埋下寻仇因果。')) return;
        const done = g.LS.disciples.expel(d.id); toast(done.msg); if (done.ok) { g.LS.save.save(); render(); }
      }));
    };
    render();
  }

  function renderDiscipleSkills(disciples) {
    const box = document.getElementById('battle-disciple-skills');
    if (!box) return;
    box.innerHTML = (disciples || []).map(d => {
      const skills = (d.skills || []).map(skill => {
        const disabled = skill.used || d.betrayed || d.blocked;
        const status = skill.used ? '本战已用' : (d.betrayed ? '背刺离阵' : (d.blocked ? '迟疑不出' : '所属：' + d.name));
        return '<button class="hand-card disciple-skill-card' + (disabled ? ' hand-card-off' : '') + '" data-disciple-slot="' + d.slotIdx + '" data-disciple-skill="' + skill.id + '" ' + (disabled ? 'disabled' : '') + '><b>' + escapeHtml(skill.name) + '</b><span class="disciple-skill-desc">' + escapeHtml(skill.desc || '暂无效果说明') + '</span><span class="hc-eff">' + escapeHtml(status) + '</span></button>';
      }).join('');
      return skills || '<span class="battle-note">' + escapeHtml(d.name) + '尚无已揭示术法</span>';
    }).join('') || '<span class="battle-note">此战未带弟子</span>';
    box.querySelectorAll('[data-disciple-skill]').forEach(btn => btn.addEventListener('click', () => {
      const result = g.LS.battle.useDiscipleSkill(Number(btn.dataset.discipleSlot), btn.dataset.discipleSkill);
      if (!result.ok) toast(result.msg);
    }));
  }

  function showDiscipleRecruit(candidates, options) {
    options = options || {};
    removeModals();
    const { card } = makeModal(null);
    card.classList.add('disciple-recruit-card');
    const room = Math.max(0, ((g.LS.BAL.disciple || {}).max_slots || 20) - g.LS.disciples.active().length);
    const maxSelect = Math.min(room, options.maxSelect || 3);
    card.innerHTML = '<div class="modal-title">' + escapeHtml(options.title || '山 门 来 投') + '</div><div class="modal-desc">' + escapeHtml(options.desc || '三名来客候在山门。外相可察，心性与所学仍藏在雾中。可收一至三人，也可尽数遣返。') + '</div>' +
      '<div class="senior-row">' + candidates.map((d, i) => '<label class="senior-tier disciple-recruit-option"><input type="checkbox" data-recruit="' + i + '">' +
        '<b>' + escapeHtml(d.name) + '</b><span class="st-desc">灵根：' + escapeHtml((d.root && d.root.key) || '未知') + ' · 性情 ? · 术法 ' + ((d.skills || []).length || '?') + ' 门</span><span class="st-rel">' + escapeHtml(d.hidden_hint || d.source || '') + '</span></label>').join('') + '</div>' +
      '<div class="disciple-modal-actions"><button class="btn-primary" id="dr-accept">' + escapeHtml(options.acceptText || '收入门下') + '</button><button class="icon-btn" id="dr-reject">' + escapeHtml(options.rejectText || '尽数遣返') + '</button></div>';
    const finish = selected => { g.LS.disciples.recruit(selected); removeModals(); renderAll(); };
    card.querySelectorAll('[data-recruit]').forEach(input => input.addEventListener('change', () => {
      const checked = card.querySelectorAll('[data-recruit]:checked');
      if (checked.length > maxSelect) { input.checked = false; toast('本次最多录取 ' + maxSelect + ' 人。'); }
    }));
    card.querySelector('#dr-accept').addEventListener('click', () => {
      const selected = Array.from(card.querySelectorAll('[data-recruit]:checked')).map(x => candidates[Number(x.dataset.recruit)]).slice(0, maxSelect);
      if (!selected.length) { toast('至少选择一名弟子，或选择尽数遣返。'); return; }
      finish(selected);
      toast('山门新收弟子 ' + selected.length + ' 人。');
    });
    card.querySelector('#dr-reject').addEventListener('click', () => { finish([]); toast('山门重归寂静。'); });
  }

  /* ── 代际传承四选一（转正） ── */
  function showGenerationChoice() {
    removeModals();
    const { card } = makeModal(null);
    card.innerHTML =
      '<div class="modal-title" style="color:var(--cinnabar)">代 际 传 承</div>' +
      '<div class="modal-desc">代理掌门已至化神大圆满，灵山要交出去了。你以什么身份注视新一代？——结局决定下一代的起点。</div>' +
      '<div class="senior-row">' +
      [{ k: 'keep', n: '继续当掌门', d: '灵山不可一日无主', b: '下一代初始灵气 +20%，传承点 +10%' },
       { k: 'elder', n: '成为太上长老', d: '垂帘听政，扶一代又一代', b: '下一代修为速度 +8%，灵根概率 +15%' },
       { k: 'wander', n: '云游四海', d: '天地为庐，处处是山门', b: '下一代奇遇仙品 +2、传承点 +15%' },
       { k: 'seclude', n: '闭关不出', d: '一闭关，山外已百年', b: '下一代点击产量 +15%，突破成功率 +3%' }
      ].map(o => '<button class="senior-tier" data-gen="' + o.k + '"><b>' + o.n + '</b><span class="st-desc">' + o.d + '</span><span class="st-rel">' + o.b + '</span></button>').join('') +
      '</div>';
    card.querySelectorAll('[data-gen]').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.gen;
      const s = g.LS.S;
      s.heirloom = {
        keep: { qi_mult: 1.2, points_mult: 1.1 },
        elder: { xp_mult: 1.08, root_luck: 0.15 },
        wander: { xian_weight: 2, event_freq: 0.9, points_mult: 1.15 },
        seclude: { click_mult: 1.15, bt_add: 0.03 }
      }[k];
      s.generation = (s.generation || 0) + 1;
      s.generation_chosen = false;
      s.disciples = [];
      if (g.LS.disciples) g.LS.disciples.recruit([g.LS.disciples.makeCandidate()]);
      g.LS.save.save();
      toast('【代际传承】新一代掌门继位——结局加成伴随后代一世。', 5200);
      g.LS.realm.doRebirth(true);
      removeModals();
      renderAll();
    }));
  }

  /* ── 新手引导（首次 5 步，可跳过可重看） ── */
  function showTutorialSteps() {
    const steps = [
      { t: '吐 纳', d: '点击「吐纳」聚灵气；长按可持续加速——灵气是万物的根。' },
      { t: '资 源', d: '灵气化修为（自动吞吐）→突破境界；灵石来自坊市灵田，丹药出自丹炉。' },
      { t: '突 破', d: '修为攒满点「突破」——金丹起有雷劫，失败会走火甚至殒命，备好保命装。' },
      { t: '丹房与地图', d: '右栏「地图」进丹房服丹、市场做买卖——地图是灵山全部去处。' },
      { t: '主线与试炼', d: '「主线」推掌门之路拿剧情奖励；「试炼塔」练手拿掉落——化神后可与道友切磋。' }
    ];
    removeModals();
    let i = 0;
    const { card } = makeModal(null);
    const render = () => {
      const st = steps[i];
      card.innerHTML =
        '<div class="modal-title">新 手 引 导 ' + (i + 1) + '/' + steps.length + '</div>' +
        '<div class="modal-desc"><b style="font-size:18px;letter-spacing:4px">' + st.t + '</b><br>' + st.d + '</div>' +
        '<div style="text-align:center;margin-top:10px;display:flex;gap:8px;justify-content:center">' +
        '<button class="icon-btn" id="tu-skip">跳 过</button>' +
        '<button class="btn-primary" id="tu-next" style="padding:7px 22px">' + (i < steps.length - 1 ? '下一步' : '开始修行') + '</button></div>';
      card.querySelector('#tu-skip').addEventListener('click', finish);
      card.querySelector('#tu-next').addEventListener('click', () => { i += 1; if (i >= steps.length) finish(); else render(); });
    };
    const finish = () => { try { localStorage.setItem('lingshan_tutorial_done', '1'); } catch (e) {} removeModals(); };
    render();
  }

  /* ── 破境解锁向导（2026-09-19）─────────────────────────────────────────
     破境之后逐屏交代这一层新开了什么：本层概述 → 每个新解锁的建筑 / 功能一屏，
     底部「知道了」点一下进下一屏，最后一屏「明白了」收尾。
     过场（点击才关）看完之后才弹，避免两张大图叠一起。 */
  function showRealmUnlockGuide(realmIdx) {
    const bal = g.LS.BAL;
    const realm = bal.realms[realmIdx];
    if (!realm) return;
    if (document.querySelector('.modal-mask')) { setTimeout(() => showRealmUnlockGuide(realmIdx), 2500); return; }
    const steps = [];
    const guides = (bal.texts && bal.texts.guide_by_realm) || [];
    steps.push({ t: '破 境 · ' + realm.name, d: guides[realmIdx] || (realm.name + '境已成，山中气象一新。'), icon: null });
    for (const bid of (realm.unlock_buildings || [])) {
      const b = (bal.buildings || []).find(x => x.id === bid);
      if (!b) continue;
      steps.push({ t: '新解锁 · ' + b.name, d: b.desc, icon: bid, eff: specialEffectText(b) });
    }
    const traits = realm.traits || [];
    if (traits.indexOf('unlock_rebirth') !== -1) {
      steps.push({ t: '新解锁 · 转生', d: '兵解转世：修为换传承点，买永久加成，下一世快得多。右栏「转生」可查看与开转。', icon: null });
    }
    if (traits.indexOf('ascension') !== -1) {
      steps.push({ t: '新解锁 · 碑林', d: '本世山志将刻入碑林，隔世的故人与传承都跟着你走。', icon: null });
    }
    if (steps.length <= 1) return;   // 这一层没开新东西就别打扰
    removeModals();
    let i = 0;
    const { card } = makeModal(null);
    const render = () => {
      const st = steps[i];
      const last = i >= steps.length - 1;
      card.innerHTML =
        '<div class="modal-title">' + escapeHtml(st.t) +
          '<span style="font-size:12px;color:var(--ink-soft);margin-left:8px">' + (i + 1) + ' / ' + steps.length + '</span></div>' +
        '<div class="modal-desc">' +
          (st.icon ? '<svg class="b-icon" style="width:30px;height:30px;vertical-align:-6px;margin-right:8px;opacity:.9"><use href="#ic-' + st.icon + '"/></svg>' : '') +
          escapeHtml(st.d) + '</div>' +
        (st.eff && st.eff !== st.d ? '<div class="modal-desc" style="font-size:12px;color:var(--ink-soft)">效果：' + escapeHtml(st.eff) + '</div>' : '') +
        '<div style="text-align:center;margin-top:10px"><button class="btn-primary" id="ug-ok" style="padding:7px 26px">' +
          (last ? '明 白 了' : '知 道 了') + '</button></div>';
      card.querySelector('#ug-ok').addEventListener('click', () => {
        if (last) { removeModals(); return; }
        i += 1;
        render();
      });
    };
    render();
  }

  /* ── 邪修面板：劫掠/血祭/黑市（心魔≥30 解锁） ── */
  function showMoPanel() {
    if (!g.LS.path || !g.LS.path.isXie()) { toast('尚未堕魔，魔道之门不显。'); return; }
    removeModals();
    const { card } = makeModal(removeModals);
    const render = () => {
      const s = g.LS.S, path = g.LS.path;
      const realm = path.moRealm() || { name: '炼血' };
      const nextIndex = (s.mo_realm && s.mo_realm.index || 0) + 1;
      const need = path.moNeed(nextIndex);
      const xieChapters = (g.LS.BAL.story || {}).xie_chapters || [];
      const chapterIdx = Math.max(0, Math.min(xieChapters.length - 1, (s.xie_chapter || 1) - 1));
      const chapter = xieChapters[chapterIdx];
      const chapterTasks = chapter ? chapter.tasks.map((task, idx) => {
        const state = g.LS.quest.xieTaskState(chapterIdx, idx);
        return '<div class="rebirth-item"><div><b>' + escapeHtml(task.desc) + '</b></div>' +
          (state === 'claimed' ? '<span class="stamp">已领</span>' : '<button class="icon-btn" data-xie-claim="' + idx + '" ' + (state === 'claimable' ? '' : 'disabled') + '>' + (state === 'claimable' ? '领 取' : '进行中') + '</button>') + '</div>';
      }).join('') : '';
      const buildings = (g.LS.BAL.mo_buildings || []).map(def => {
        const level = path.buildingLevel(def.id), cost = path.buildingCost(def.id), unlocked = path.buildingUnlocked(def);
        const costText = cost ? Object.keys(cost).map(key => (key === 'xuesha' ? Math.floor(cost[key]) + ' 血煞' : fmtSafe(cost[key]) + ' 灵石')).join(' + ') : '';
        return '<div class="rebirth-item"><div><b>' + escapeHtml(def.name) + '</b><span class="ev-badge ev-badge-buff">' + level + ' 级</span>' +
          '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml((def.effects && def.effects.note) || '以血煞供养的魔道建筑') + '</div></div>' +
          '<button class="icon-btn" data-mo-build="' + def.id + '" ' + (unlocked ? '' : 'disabled') + '>' + (unlocked ? costText : '未解锁') + '</button></div>';
      }).join('');
      const cul = g.LS.BAL.cultivation || {};
      const magicCards = (((cul.battle_cards || {}).my_cards) || []).filter(item => item.path === 'xie').map(item => {
        const owned = item.default || (s.mo_cards_owned || []).indexOf(item.id) !== -1;
        const lockedRealm = (item.unlock_realm || 0) > s.realm.index;
        const lockedMo = (item.unlock_mo_realm || 0) > ((s.mo_realm || {}).index || 0);
        const affordable = (s.resources.lingshi || 0) >= (item.price || 0) && (s.xuesha || 0) >= (item.xuesha_cost || 0);
        const stateText = lockedRealm ? '正道境界不足' : (lockedMo ? '魔道第 ' + ((item.unlock_mo_realm || 0) + 1) + ' 阶解锁' : '');
        return '<div class="rebirth-item"><div><b>' + escapeHtml(item.name) + '</b><span class="ev-badge ev-badge-buff">' + escapeHtml((g.LS.battle.XIE_KIND_NAME || {})[item.kind] || item.kind) + '</span>' +
          '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(item.desc || '') + '</div></div><div>' +
          (owned ? '<span class="stamp">已参悟</span>' : (stateText ? '<button class="icon-btn" disabled>' + stateText + '</button>' : '<button class="icon-btn" data-mo-card="' + item.id + '" ' + (affordable ? '' : 'disabled') + '>' + fmtSafe(item.price || 0) + ' 灵石 + ' + (item.xuesha_cost || 0) + ' 血煞</button>')) + '</div></div>';
      }).join('');
      const magicGear = ['weapons', 'techniques'].map(key => ((cul[key] || []).filter(item => item.path === 'xie').map(item => {
        const kind = key === 'weapons' ? 'weapon' : 'technique';
        const owned = (s[key + '_owned'] || []).indexOf(item.id) !== -1;
        const equipped = s.equip[kind] === item.id;
        const buildingReady = path.buildingLevel(item.sold_at) > 0;
        const affordable = (s.resources.lingshi || 0) >= (item.price || 0) && (s.xuesha || 0) >= (item.xuesha_cost || 0);
        const building = path.buildingDef(item.sold_at);
        let action = '<button class="icon-btn" data-mo-gear="' + item.id + '" data-mo-gear-kind="' + kind + '">装备</button>';
        if (equipped) action = '<span class="stamp">装备中</span>';
        else if (!owned && !buildingReady) action = '<button class="icon-btn" disabled>需建' + escapeHtml((building || {}).name || '魔道建筑') + '</button>';
        else if (!owned) action = '<button class="icon-btn" data-mo-gear="' + item.id + '" data-mo-gear-kind="' + kind + '" ' + (affordable ? '' : 'disabled') + '>' + fmtSafe(item.price || 0) + ' 灵石 + ' + (item.xuesha_cost || 0) + ' 血煞</button>';
        return '<div class="rebirth-item"><div><b>' + escapeHtml(item.name) + '</b><span class="ev-badge ev-badge-chain">' + escapeHtml(item.grade || '') + ' · ' + (kind === 'weapon' ? '魔兵' : '魔典') + '</span>' +
          '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(item.desc || '') + '</div></div><div>' +
          action + '</div></div>';
      }).join(''))).join('');
      const needText = need ? '修为 ' + fmtSafe(need.xiufu) + ' + 血煞 ' + need.xuesha : '已至魔君';
      card.innerHTML =
        '<div class="modal-title">魔 道 血 途<button class="icon-btn" id="mo-close" style="float:right;font-size:12px;padding:3px 12px">离 开</button></div>' +
        '<div class="modal-desc"><b style="color:var(--cinnabar)">' + escapeHtml(realm.name) + '</b> · 血煞 <b>' + Math.floor(s.xuesha || 0) + '</b>' +
        ' · 心魔压制 ' + Math.round(path.xinmoSuppress() * 100) + '%<br><span style="font-size:11px;color:var(--ink-soft)">' +
        escapeHtml(chapter ? chapter.name + '：' + chapter.intro : '血路已开，旧道仍在身后。') + '</span></div>' +
        '<h3 class="panel-title" style="font-size:14px">魔道阶梯</h3>' +
        '<div class="rebirth-item"><div><b>' + (need ? '血祭突破 · ' + escapeHtml((g.LS.BAL.mo_realms[nextIndex] || {}).name || '') : '魔君') + '</b>' +
        '<div style="font-size:11px;color:var(--ink-soft)">' + needText + (need ? ' · 成功率 ' + Math.round(path.moBreakthroughRate() * 100) + '%' : '') + '</div></div>' +
        (need ? '<button class="btn-primary" id="mo-break">血祭突破</button>' : '<span class="stamp">已登极</span>') + '</div>' +
        (s.mo_pending_breakthrough ? '<div class="rebirth-item"><div><b>心魔献祭</b><div style="font-size:11px;color:var(--ink-soft)">献祭 40 心魔，挽回血祭败局</div></div><button class="icon-btn" id="mo-sacrifice" ' + ((s.xinmo || 0) < 40 ? 'disabled' : '') + '>献 祭</button></div>' : '') +
        '<h3 class="panel-title" style="font-size:14px">魔道主线</h3>' + chapterTasks +
        '<h3 class="panel-title" style="font-size:14px">魔道建筑</h3>' + buildings +
        '<h3 class="panel-title" style="font-size:14px">魔功</h3>' + magicCards +
        '<h3 class="panel-title" style="font-size:14px">魔兵与魔典</h3>' + magicGear +
        '<div class="rebirth-item"><div><b>还俗</b><div style="font-size:11px;color:var(--ink-soft)">心魔须不高于 29；血煞归零、建筑封存、道心 -5。</div></div>' +
        '<button class="icon-btn" id="mo-exit" ' + ((s.xinmo || 0) > 29 ? 'disabled' : '') + '>还 俗</button></div>';
      card.querySelector('#mo-close').addEventListener('click', removeModals);
      card.querySelectorAll('[data-mo-build]').forEach(btn => btn.addEventListener('click', () => { const r = path.buyBuilding(btn.dataset.moBuild); toast(r.msg); render(); renderAll(); }));
      card.querySelectorAll('[data-mo-card]').forEach(btn => btn.addEventListener('click', () => { const r = path.buyMoCard(btn.dataset.moCard); toast(r.msg); if (r.ok) sfx('guqin'); render(); renderAll(); }));
      card.querySelectorAll('[data-mo-gear]').forEach(btn => btn.addEventListener('click', () => { const r = path.buyMoEquipment(btn.dataset.moGear, btn.dataset.moGearKind); toast(r.msg); if (r.ok) sfx('guqin'); render(); renderAll(); }));
      card.querySelectorAll('[data-xie-claim]').forEach(btn => btn.addEventListener('click', () => { const r = g.LS.quest.xieClaim(chapterIdx, Number(btn.dataset.xieClaim)); if (r) toast(r.gainText || r.task.story, 4200); render(); renderAll(); }));
      const breakBtn = card.querySelector('#mo-break');
      if (breakBtn) breakBtn.addEventListener('click', () => { const r = path.moBreakthrough(false); toast(r.msg, 4200); render(); renderAll(); });
      const sacrificeBtn = card.querySelector('#mo-sacrifice');
      if (sacrificeBtn) sacrificeBtn.addEventListener('click', () => { const r = path.sacrificeXinmo(); toast(r.msg, 4200); render(); renderAll(); });
      card.querySelector('#mo-exit').addEventListener('click', () => { const r = path.exitXie(); toast(r.msg, 4200); if (r.ok) removeModals(); renderAll(); });
    };
    render();
  }

  function showXinmo() {
    removeModals();
    const { card } = makeModal(removeModals);
    const render = () => {
      const s = g.LS.S;
      g.LS.economy.xinmoDecay();
      const xm = s.xinmo || 0;
      const th = ((g.LS.BAL.xinmo || {}).thresholds || []);
      const tier = th.filter(t => xm >= t.min).pop();
      const acts = (g.LS.BAL.xinmo || {}).acts || {};
      const rows = Object.keys(acts).map(k => {
        const a = acts[k];
        const cd = (s.xinmo_cd || {})[k];
        const left = cd && cd > Date.now() ? Math.ceil((cd - Date.now()) / 60000) : 0;
        const minRealm = a.min_realm == null ? 0 : a.min_realm;
        const unlockXinmo = a.unlock_xinmo == null ? ((g.LS.BAL.xinmo || {}).unlock || 30) : a.unlock_xinmo;
        const realmLocked = s.realm.index < minRealm;
        const xinmoLocked = xm < unlockXinmo;
        const lockText = realmLocked ? g.LS.BAL.realms[minRealm].name + '解锁' : (xinmoLocked ? '心魔 ' + unlockXinmo + ' 解锁' : '');
        return '<div class="rebirth-item"><div><b>' + escapeHtml(a.name) + '</b>' +
          '<span class="ev-badge" style="color:var(--cinnabar)">心魔 +' + a.xinmo + '</span>' +
          '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(a.desc) + '</div></div>' +
          '<button class="icon-btn" data-xact="' + k + '" ' + (left || realmLocked || xinmoLocked ? 'disabled' : '') + '>' +
          (left ? left + ' 分' : (lockText || '行 事')) + '</button></div>';
      }).join('');
      card.innerHTML =
        '<div class="modal-title">邪 修 之 道<button class="icon-btn" id="xm-close" style="float:right;font-size:12px;padding:3px 12px">离 开</button></div>' +
        '<div class="modal-desc">心魔 <b style="color:var(--cinnabar)">' + xm + '</b>/100' + (tier ? '（' + escapeHtml(tier.name) + '：' + escapeHtml(tier.desc) + '）' : '（心境清明）') +
        '<br><span style="font-size:11px;color:var(--ink-soft)">心魔每两分钟缓消 0.5 点；缠身后清心丹的净心效果减半。干坏事来钱快——雷劫与突破的账，迟早要还。</span></div>' +
        rows;
      card.querySelector('#xm-close').addEventListener('click', removeModals);
      card.querySelectorAll('[data-xact]').forEach(btn => btn.addEventListener('click', () => {
        const r = g.LS.economy.xinmoAct(btn.dataset.xact);
        toast(r.msg, r.ok ? 4200 : 2600);
        if (r.ok) { sfx('guqin'); render(); renderResources(); renderAll(); }
      }));
    };
    render();
  }

  /* ── 试炼塔面板：10 章×5 关 + 帝路（trial.js 结算） ── */
  function showTrial() {
    removeModals();
    const { card } = makeModal(removeModals);
    const render = () => {
      const T = g.LS.trial;
      const LVd = g.LS.BAL.levels || {};
      const s = g.LS.S;
      let rows = '';
      for (const ch of (LVd.chapters || [])) {
        const unlocked = T.chapterUnlocked(ch);
        const curRealm = s.realm.index === ch.realm;
        rows += '<div class="rebirth-item" style="' + (unlocked ? '' : 'opacity:.45') + '"><div><b>' + escapeHtml(ch.name) + '</b>' +
          (curRealm ? '<span class="ev-badge ev-badge-buff">当前境</span>' : '') +
          '<div style="font-size:11px;color:var(--ink-soft)">' + (unlocked ? '已通 ' + ch.levels.filter((l, i) => T.isCleared(ch.realm, i + 1)).length + '/5 关 · 首通掉落装备/丹药' : '境界「' + escapeHtml(ch.name.split('·')[1] || '') + '」解锁') + '</div></div>' +
          '<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:230px">' +
          ch.levels.map((l, i) => {
            const idx = i + 1;
            const open = T.levelUnlocked(ch.realm, idx);
            const cleared = T.isCleared(ch.realm, idx);
            if (!open) return '<button class="icon-btn" disabled style="min-height:0;padding:3px 8px;font-size:11px">🔒' + idx + '</button>';
            return '<button class="icon-btn" data-trial="' + ch.realm + ':' + idx + '" style="min-height:0;padding:3px 8px;font-size:11px;' + (cleared ? '' : 'border-color:var(--cinnabar);color:var(--cinnabar)') + '">' + (cleared ? '✓' : (l.kind === 'boss' ? 'BOSS' : idx)) + '</button>';
          }).join(' ') + '</div></div>';
      }
      // 帝路
      const impOpen = T.imperialUnlocked();
      rows += '<div class="rebirth-item" style="' + (impOpen ? '' : 'opacity:.45') + '"><div><b>帝 路 · 三 关</b>' +
        '<div style="font-size:11px;color:var(--ink-soft)">飞升后可闯——各得帝纹×1（大帝雷劫 +2%/枚），禁扫荡</div></div>' +
        '<div style="display:flex;gap:4px">' +
        [1, 2, 3].map(idx => {
          const open = T.imperialUnlocked(idx);
          const cleared = !!((s.trial || {}).cleared || {})['imperial_' + idx];
          if (!open) return '<button class="icon-btn" disabled style="min-height:0;padding:3px 8px;font-size:11px">🔒</button>';
          return '<button class="icon-btn" data-imperial="' + idx + '" style="min-height:0;padding:3px 8px;font-size:11px;' + (cleared ? '' : 'border-color:var(--cinnabar);color:var(--cinnabar)') + '">' + (cleared ? '✓' : '关' + idx) + '</button>';
        }).join(' ') + '</div></div>';
      card.innerHTML =
        '<div class="modal-title">试 炼 塔<button class="icon-btn" id="tt-close" style="float:right;font-size:12px;padding:3px 12px">离 开</button></div>' +
        '<div class="modal-desc">每关首通有灵石与掉落；已通关可扫荡（90 秒产量/次，每关 5 次/小时）。1~8 境在此熟悉斗法机制，帝路在飞升后等你。</div>' +
        rows;
      card.querySelector('#tt-close').addEventListener('click', removeModals);
      card.querySelectorAll('[data-trial]').forEach(btn => btn.addEventListener('click', () => {
        const [r, i] = btn.dataset.trial.split(':').map(Number);
        removeModals();
        g.LS.trial.fight(r, i);
      }));
      card.querySelectorAll('[data-imperial]').forEach(btn => btn.addEventListener('click', () => {
        removeModals();
        g.LS.trial.fightImperial(Number(btn.dataset.imperial));
      }));
    };
    render();
  }

  /* ── 体系一览：游戏内弹窗嵌入《修炼体系一览.html》（tools/gen_codex_page.js 生成的静态页） ── */
  function showCodexPage() {
    removeModals();
    const { card, mask } = makeModal(removeModals);
    card.classList.add('codexpage-card');
    card.innerHTML =
      '<div class="modal-title">修 炼 体 系 一 览<button class="icon-btn" id="cp-close" style="float:right;font-size:12px;padding:3px 12px">合 上</button></div>' +
      '<iframe class="codexpage-frame" src="修炼体系一览.html?v=' + Date.now() + '"></iframe>' +
      '<div style="text-align:center;margin-top:6px"><button class="icon-btn" id="cp-newwin">新窗口全屏阅读</button></div>';
    card.querySelector('#cp-close').addEventListener('click', removeModals);
    card.querySelector('#cp-newwin').addEventListener('click', () => {
      window.open('修炼体系一览.html', '_blank');
    });
  }

  /* ── 更新公告中心：独立于游戏存档的设备级已读状态 + 可回看的历史版本 ── */
  function updateEntries(data) {
    if (data && Array.isArray(data.entries)) return data.entries.filter(x => x && (x.id || x.version));
    if (data && data.version) return [Object.assign({ id: data.version }, data)];
    return [];
  }
  function updateReadIds() {
    try {
      const v = JSON.parse(localStorage.getItem(UPDATE_READ_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function storeUpdateRead(ids) {
    try { localStorage.setItem(UPDATE_READ_KEY, JSON.stringify(Array.from(new Set(ids)).slice(-100))); } catch (e) {}
  }
  function markUpdatesRead(ids) {
    const read = updateReadIds();
    (ids || []).forEach(id => { if (id && read.indexOf(id) === -1) read.push(id); });
    storeUpdateRead(read);
  }
  function migrateLegacyUpdateRead(version) {
    if (version) markUpdatesRead([version]);
  }
  function unreadUpdateCount(data) {
    const read = updateReadIds();
    return updateEntries(data).filter(e => read.indexOf(e.id || e.version) === -1).length;
  }
  function updateBody(entry) {
    const sections = Array.isArray(entry.sections) ? entry.sections : [];
    if (sections.length) return sections.map(section =>
      '<section class="update-section"><h3>' + escapeHtml(section.title || '本次更新') + '</h3><ul>' +
      (section.items || []).map(item => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul></section>'
    ).join('');
    return '<div class="update-lines">' + (entry.lines || []).map(line => '<div class="un-line">' + escapeHtml(line) + '</div>').join('') + '</div>';
  }
  function showUpdateNotes(data, options) {
    const entries = updateEntries(data);
    if (!entries.length) return;
    // 全服公告独立维护，不随版本号或更新公告自动变化。
    const serverNotice = (data && data.server_notice) || {
      date: '',
      title: '全服公告',
      lines: ['如果大家对游戏优化有什么建议，请在设置页面底部的留言栏积极留言哦！']
    };
    clearTimeout(updateNotesTimer);
    updateNotesTimer = null;
    pendingUpdateNotes = null;
    removeModals();
    const opts = options || {};
    const read = updateReadIds();
    let activePage = opts.page === 'server' ? 'server' : 'updates';
    let activeId = opts.entryId || (entries.find(e => read.indexOf(e.id || e.version) === -1) || entries[0]).id || entries[0].version;
    const viewed = new Set();
    const { card } = makeModal(null);
    card.classList.add('update-center');
    const render = () => {
      const entry = entries.find(e => (e.id || e.version) === activeId) || entries[0];
      activeId = entry.id || entry.version;
      if (activePage === 'updates') viewed.add(activeId);
      const currentRead = updateReadIds();
      const updateLayout = '<div class="update-layout"><nav class="update-versions" aria-label="历史版本">' + entries.map(e => {
        const id = e.id || e.version;
        const unread = currentRead.indexOf(id) === -1;
        return '<button class="update-version' + (id === activeId ? ' is-active' : '') + '" data-update-id="' + escapeHtml(id) + '">' +
          '<span>' + escapeHtml(e.version || id) + '</span><small>' + escapeHtml(e.date || '') + '</small>' + (unread ? '<i>新</i>' : '') + '</button>';
      }).join('') + '</nav>' +
        '<article class="update-article"><div class="update-article-head"><span class="update-date">' + escapeHtml(entry.date || '') + '</span><h2>' + escapeHtml(entry.title || '版本更新') + '</h2>' +
        (entry.summary ? '<p>' + escapeHtml(entry.summary) + '</p>' : '') + '</div><div class="update-notes">' + updateBody(entry) + '</div></article></div>';
      const serverLayout = '<div class="update-layout update-layout-notice"><article class="update-article"><div class="update-article-head"><span class="update-date">' + escapeHtml(serverNotice.date || '') + '</span><h2>' + escapeHtml(serverNotice.title || '全服公告') + '</h2>' +
        (serverNotice.summary ? '<p>' + escapeHtml(serverNotice.summary) + '</p>' : '') + '</div>' +
        '<div class="update-notes">' + updateBody(serverNotice) + '</div></article></div>';
      card.innerHTML =
        '<div class="update-head"><div><div class="update-tabs" role="tablist"><button class="update-tab' + (activePage === 'server' ? ' is-active' : '') + '" data-update-page="server" role="tab">全服公告</button><button class="update-tab' + (activePage === 'updates' ? ' is-active' : '') + '" data-update-page="updates" role="tab">更新公告</button></div><div class="update-current">当前版本 ' + escapeHtml((data && data.current_version) || entry.version || '') + '</div></div>' +
        '<button class="icon-btn update-close" id="un-close" title="关闭" aria-label="关闭">✕</button></div>' +
        (activePage === 'server' ? serverLayout : updateLayout) +
        '<div class="update-actions">' + (activePage === 'updates' ? '<button class="icon-btn" id="un-read-all">全部标为已读</button>' : '<span></span>') + '<button class="btn-primary" id="un-ok">知 道 了</button></div>';
      const close = () => { markUpdatesRead(Array.from(viewed)); removeModals(); };
      card.querySelector('#un-close').addEventListener('click', close);
      card.querySelector('#un-ok').addEventListener('click', close);
      const readAll = card.querySelector('#un-read-all');
      if (readAll) readAll.addEventListener('click', () => {
        markUpdatesRead(entries.map(e => e.id || e.version));
        render();
      });
      card.querySelectorAll('[data-update-page]').forEach(btn => btn.addEventListener('click', () => { activePage = btn.dataset.updatePage; render(); }));
      card.querySelectorAll('[data-update-id]').forEach(btn => btn.addEventListener('click', () => { activeId = btn.dataset.updateId; render(); }));
    };
    render();
  }
  function tryShowScheduledUpdate() {
    if (!pendingUpdateNotes || isModalOpen() || (g.LS.battle && g.LS.battle.active)) return;
    const pending = pendingUpdateNotes;
    pendingUpdateNotes = null;
    showUpdateNotes(pending.data, { entryId: pending.entryId, startup: true });
  }
  function scheduleUpdateNotes(data, delay) {
    const entries = updateEntries(data), read = updateReadIds();
    const latest = entries.find(e => e.important !== false && read.indexOf(e.id || e.version) === -1);
    if (!latest) return;
    pendingUpdateNotes = { data: data, entryId: latest.id || latest.version };
    clearTimeout(updateNotesTimer);
    updateNotesTimer = setTimeout(tryShowScheduledUpdate, Math.max(0, delay || 0));
  }

  function localDayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function tryShowScheduledDeckPrompt() {
    if (!pendingDeckPrompt || isModalOpen() || (g.LS.battle && g.LS.battle.active)) return;
    pendingDeckPrompt = false;
    showDeckEditor({ loginPrompt: true });
  }
  function scheduleDeckPrompt(delay) {
    try {
      if (localStorage.getItem(DECK_PROMPT_DAY_KEY) === localDayKey()) return;
    } catch (e) {}
    pendingDeckPrompt = true;
    clearTimeout(deckPromptTimer);
    deckPromptTimer = setTimeout(tryShowScheduledDeckPrompt, Math.max(0, delay || 0));
  }

  /* ── 大师兄档位选择（师弟/同门/师兄，正常修炼都能赢） ── */
  function showSeniorPick() {
    removeModals();
    const { card } = makeModal(removeModals);
    const tiers = g.LS.battle.SENIOR_TIERS;
    const realmName = i => (g.LS.BAL.realms[i] || {}).name || '?';
    const myIdx = g.LS.S.realm.index;
    const rows = Object.values(tiers).map(t => {
      const oppIdx = Math.max(0, Math.min(9, myIdx + t.offset));
      const rel = t.offset === 0 ? '与你同境' : (t.offset < 0 ? '低你一境' : '高你一境');
      return '<button class="senior-tier" data-tier="' + t.key + '"><b>' + escapeHtml(t.label) + '</b>' +
        '<span class="st-rel">大师兄 · ' + realmName(oppIdx) + '境（' + rel + '）</span>' +
        '<span class="st-desc">' + escapeHtml(t.desc) + '</span></button>';
    }).join('');
    card.innerHTML =
      '<div class="modal-title">挑 战 大 师 兄<button class="icon-btn" id="sp-close" style="float:right;font-size:12px;padding:3px 12px">合 上</button></div>' +
      '<div class="modal-desc">凌云子随你挑档位过招——三档都留了活路，正常修炼都能赢，看你想稳还是想搏。</div>' +
      '<div class="senior-row">' + rows + '</div>';
    card.querySelector('#sp-close').addEventListener('click', removeModals);
    card.querySelectorAll('[data-tier]').forEach(btn => btn.addEventListener('click', () => {
      removeModals();
      g.LS.battle.challengeSenior(btn.dataset.tier);
    }));
  }

  /* ── 坊市：兵器/功法/秘传牌购买与装备（坊市炼器为主获取） ── */
  function showMarket() {
    removeModals();
    const { card } = makeModal(removeModals);
    const s = g.LS.S;
    const cul = g.LS.BAL.cultivation || {};
    const wx = cul.wuxing || { names: [] };
    const KIND_NAME = { attack: '攻式', element: '五行', defense: '守式', heal: '回式' };
    const render = (tabName) => {
      let rows = '';
      if (tabName === 'relics') {
        const relics = (g.LS.BAL.relics || []);
        const own = s.relics || {};
        for (const r of relics) {
          const broken = !!own[r.id + '_broken'];
          const used = r.id === 'huanhunjia' && !!own.huanhunjia_used;
          const has = !!own[r.id] && !broken;
          let act;
          if (broken) {
            const fee = r.reforge_price || Math.round(r.price / 2);
            act = '<button class="icon-btn" data-reforge="' + r.id + '" data-market-cost="' + fee + '" ' + (s.resources.lingshi >= fee ? '' : 'disabled') + '>重铸 ' + g.LS.util.fmt(fee) + ' 灵石</button>';
          }
          else if (has) act = '<span class="stamp">随 身</span>' + (used ? '<div style="font-size:10px;color:var(--ink-soft)">本世已触发</div>' : '');
          else act = '<button class="icon-btn" data-buyrelic="' + r.id + '" data-market-cost="' + r.price + '" ' + (s.resources.lingshi >= r.price ? '' : 'disabled') + '>' + g.LS.util.fmt(r.price) + ' 灵石</button>';
          rows += '<div class="rebirth-item"><div><b>' + escapeHtml(r.name) + '</b>' +
            '<span class="ev-badge ev-badge-chain">保命</span>' +
            '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(r.desc) + '</div></div>' +
            '<div>' + act + '</div></div>';
        }
        rows += '<div class="modal-desc" style="font-size:11px;color:var(--ink-soft)">名刀碎裂后半价重铸；还魂甲一世触发一次、转生重置。渡劫有死亡率，命只有一条——或花灵石买后备。</div>';
      } else if (tabName === 'cards') {
        const pool = ((cul.battle_cards || {}).my_cards || []).filter(c => c.price && c.path !== 'xie');
        const owned = s.cards_owned || [];
        for (const c of pool) {
          const has = owned.indexOf(c.id) !== -1;
          const canBuy = !has && s.resources.lingshi >= (c.price || 0);
          rows += '<div class="rebirth-item"><div><b>' + escapeHtml(c.name) + '</b>' +
            '<span class="ev-badge ev-badge-buff">' + (KIND_NAME[c.kind] || c.kind) + (c.el && c.el !== 'root' ? '·' + escapeHtml(c.el) : '') + '</span>' +
            '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(c.desc) + '（' + c.cost + ' 行动点' +
            (c.dmg ? ' 杀' : '') + (c.shield ? ' 护' + c.shield : '') + (c.heal ? ' 回' + c.heal : '') + (c.dmg ? ' ' + c.dmg : '') + '）</div></div>' +
            '<div>' + (has ? '<span class="stamp">已 参 悟</span>'
              : '<button class="icon-btn" data-buycard="' + c.id + '" data-market-cost="' + (c.price || 0) + '" ' + (canBuy ? '' : 'disabled') + '>' + g.LS.util.fmt(c.price) + ' 灵石</button>') + '</div></div>';
        }
        rows += '<div class="modal-desc" style="font-size:11px;color:var(--ink-soft)">秘传牌参悟后自动进抽牌池：斗法每回合从「已参悟的招 + 基础牌」里按行动点摸牌，不用手动编入。</div>';
      } else {
        const list = (tabName === 'tech' ? (cul.techniques || []) : (cul.weapons || [])).filter(it => it.path !== 'xie');
        const ownedArr = tabName === 'tech' ? (s.techniques_owned || []) : (s.weapons_owned || []);
        const equipped = tabName === 'tech' ? s.equip.technique : s.equip.weapon;
        for (const it of list) {
          const owned = ownedArr.indexOf(it.id) !== -1;
          const equippedNow = equipped === it.id;
          const canBuy = !owned && s.resources.lingshi >= (it.price || 0);
          rows += '<div class="rebirth-item"><div><b>' + escapeHtml(it.name) + '</b>' +
            '<span class="ev-badge ev-badge-buff">' + escapeHtml(it.grade) + '·' + fmtEl(it.element) + (Array.isArray(it.element) ? '（兼修）' : '') + '</span>' +
            (it.rare_only ? '<span class="ev-badge ev-badge-chain">珍稀</span>' : '') +
            '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(it.desc) +
            (it.sharp ? '<br>锋锐 ' + it.sharp : '') + '</div></div>' +
            '<div>' + (owned
              ? (equippedNow ? '<span class="stamp">装 备 中</span>' : '<button class="icon-btn" data-equip="' + it.id + '" data-kind="' + tabName + '">装备</button>')
              : '<button class="icon-btn" data-buy="' + it.id + '" data-kind="' + tabName + '" data-market-cost="' + (it.price || 0) + '" ' + (canBuy ? '' : 'disabled') + '>' + g.LS.util.fmt(it.price) + ' 灵石</button>') + '</div></div>';
        }
      }
      card.innerHTML =
        '<div class="modal-title">坊 市<button class="icon-btn" id="mk-close" style="float:right;font-size:12px;padding:3px 12px">离 开</button></div>' +
        '<div class="modal-desc">灵石 <b data-live-resource="lingshi">' + fmtResourceById('lingshi', s.resources.lingshi) + '</b>　·　斗法用的兵器、功法与秘传牌在此置办——五行相克，未必越贵越好。</div>' +
        '<div class="set-row" style="justify-content:center">' +
        '<button class="icon-btn" data-tab="weapon" style="' + (tabName === 'weapon' ? 'border-color:var(--cinnabar);color:var(--cinnabar)' : '') + '">兵 器</button>' +
        '<button class="icon-btn" data-tab="tech" style="' + (tabName === 'tech' ? 'border-color:var(--cinnabar);color:var(--cinnabar)' : '') + '">功 法</button>' +
        '<button class="icon-btn" data-tab="cards" style="' + (tabName === 'cards' ? 'border-color:var(--cinnabar);color:var(--cinnabar)' : '') + '">秘 传</button>' +
        '<button class="icon-btn" data-tab="relics" style="' + (tabName === 'relics' ? 'border-color:var(--cinnabar);color:var(--cinnabar)' : '') + '">法 宝</button></div>' +
        rows;
      card.querySelector('#mk-close').addEventListener('click', removeModals);
      card.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => render(b.dataset.tab)));
      card.querySelectorAll('[data-buyrelic]').forEach(btn => btn.addEventListener('click', () => {
        const r = (g.LS.BAL.relics || []).find(x => x.id === btn.dataset.buyrelic);
        if (!r) return;
        if (s.resources.lingshi < r.price) { toast('灵石不够'); return; }
        s.resources.lingshi -= r.price;
        s.relics = s.relics || {};
        s.relics[r.id] = true;
        if (r.id === 'huanhunjia') s.relics.huanhunjia_used = false;
        sfx('guqin');
        toast('已请得【' + r.name + '】——命硬一分。');
        render('relics');
        g.LS.save.save();
      }));
      card.querySelectorAll('[data-reforge]').forEach(btn => btn.addEventListener('click', () => {
        const r = (g.LS.BAL.relics || []).find(x => x.id === btn.dataset.reforge);
        if (!r) return;
        const fee = r.reforge_price || Math.round(r.price / 2);
        if (s.resources.lingshi < fee) { toast('灵石不够'); return; }
        s.resources.lingshi -= fee;
        s.relics[r.id + '_broken'] = false;
        sfx('guqin');
        toast('【' + r.name + '】重铸如新。');
        render('relics');
        g.LS.save.save();
      }));
      card.querySelectorAll('[data-buycard]').forEach(btn => btn.addEventListener('click', () => {
        const c = (((cul.battle_cards || {}).my_cards) || []).find(x => x.id === btn.dataset.buycard);
        if (!c) return;
        if (s.resources.lingshi < (c.price || 0)) { toast('灵石不够'); return; }
        s.resources.lingshi -= c.price;
        s.cards_owned = s.cards_owned || [];
        s.cards_owned.push(c.id);
        sfx('guqin');
        toast('已参悟秘传「' + c.name + '」');
        render('cards');
        g.LS.save.save();
      }));
      card.querySelectorAll('[data-buy]').forEach(btn => btn.addEventListener('click', () => {
        const list2 = btn.dataset.kind === 'tech' ? (cul.techniques || []) : (cul.weapons || []);
        const it = list2.find(x => x.id === btn.dataset.buy);
        if (!it) return;
        if (s.resources.lingshi < (it.price || 0)) { toast('灵石不够'); return; }
        s.resources.lingshi -= it.price;
        if (btn.dataset.kind === 'tech') { s.techniques_owned.push(it.id); s.equip.technique = it.id; }
        else { s.weapons_owned.push(it.id); s.equip.weapon = it.id; }
        sfx('guqin');
        toast('已购入「' + it.name + '」并装备');
        render(btn.dataset.kind);
        renderResources();
        g.LS.save.save();
      }));
      card.querySelectorAll('[data-equip]').forEach(btn => btn.addEventListener('click', () => {
        if (btn.dataset.kind === 'tech') s.equip.technique = btn.dataset.equip;
        else s.equip.weapon = btn.dataset.equip;
        sfx('click');
        toast('已装备');
        render(btn.dataset.kind);
        renderResources();
        g.LS.save.save();
      }));
    };
    render('weapon');
  }

  /* ── 招式录：斗法出战卡组编成（四类各限槽数，共 8 槽）＋ 已参悟招式一览 ── */
  function showDeckEditor(options) {
    const opts = options || {};
    let suppressToday = false;
    const rememberPromptChoice = () => {
      if (!opts.loginPrompt || !suppressToday) return;
      try { localStorage.setItem(DECK_PROMPT_DAY_KEY, localDayKey()); } catch (e) {}
    };
    const closeEditor = () => { rememberPromptChoice(); removeModals(); };
    removeModals();
    const { card } = makeModal(closeEditor);
    card.classList.add('deck-editor-card');
    const s = g.LS.S;
    const initialDeck = Array.isArray(s.deck) ? s.deck.slice() : [];
    const allCards = ((g.LS.BAL.cultivation || {}).battle_cards || {}).my_cards || [];
    const pool = allCards.filter(c => g.LS.battle.cardInPath(c));
    const KINDS = g.LS.battle.KINDS;
    const KIND_NAME = s.path === 'xie' ? g.LS.battle.XIE_KIND_NAME : g.LS.battle.KIND_NAME;
    const owned = () => s.cards_owned || [];
    const render = () => {
      let cols = '';
      for (const kind of KINDS) {
        const inDeckIds = (s.deck || []).filter(id => { const c = pool.find(x => x.id === id); return c && c.kind === kind; });
        const inDeck = inDeckIds[0];
        let items = '';
        for (const c of pool.filter(x => x.kind === kind)) {
          const has = g.LS.battle.ownsCard(c);
          const lockedRealm = (c.unlock_realm || 0) > s.realm.index;
          const lockedMo = c.path === 'xie' && (c.unlock_mo_realm || 0) > ((s.mo_realm || {}).index || 0);
          const locked = lockedRealm || lockedMo;
          const activeNow = inDeckIds.indexOf(c.id) !== -1;
          if (!has) {
            items += '<div class="deck-card deck-card-locked"><b>' + escapeHtml(c.name) + '</b><span>' +
              (lockedRealm ? '正道境界「' + ((g.LS.BAL.realms[c.unlock_realm] || {}).name || '?') + '」解锁' : (lockedMo ? '魔道第 ' + ((c.unlock_mo_realm || 0) + 1) + ' 阶解锁' : (c.path === 'xie' ? '魔道面板可参悟' : (c.price ? '坊市秘传可参悟' : '尚未参悟')))) + '</span></div>';
          } else {
            items += '<button class="deck-card' + (activeNow ? ' deck-card-on' : ' deck-card-off') + '" data-pick="' + c.id + '" aria-pressed="' + (activeNow ? 'true' : 'false') + '">' +
              '<b>' + escapeHtml(c.name) + '</b><span class="deck-card-meta">' + c.cost + '行动点 ' +
              (c.dmg ? '杀' + c.dmg : '') + (c.shield ? '护' + c.shield : '') + (c.heal ? '回' + c.heal : '') +
              (c.el ? ' · ' + fmtEl(c.el) : (c.weapon ? ' · 随武器' : '')) + '</span></button>';
          }
        }
        cols += '<div class="deck-col"><div class="deck-kind">' + (KIND_NAME[kind] || kind) + '</div>' + items + '</div>';
      }
      const ordered = (s.deck || []).map((id, index) => {
        const c = pool.find(x => x.id === id);
        return c ? '<div class="deck-order-item"><span class="deck-order-index">' + (index + 1) + '</span><b>' + escapeHtml(c.name) + '</b><span class="deck-order-kind">' + escapeHtml(KIND_NAME[c.kind] || c.kind) + '</span><button class="icon-btn deck-move deck-remove" data-deck-remove="' + index + '" title="取消这张招式">×</button><button class="icon-btn deck-move" data-move="up" data-order="' + index + '" title="前移"' + (index === 0 ? ' disabled' : '') + '>↑</button><button class="icon-btn deck-move" data-move="down" data-order="' + index + '" title="后移"' + (index === (s.deck || []).length - 1 ? ' disabled' : '') + '>↓</button></div>' : '';
      }).join('') || '<div class="deck-order-empty">尚未编入招式</div>';
      card.innerHTML =
        '<div class="modal-title">招 式 录<button class="icon-btn" id="dk-close" style="float:right;font-size:12px;padding:3px 12px">合 上</button></div>' +
        '<div class="modal-desc"><b>斗法出战的就是你在这里配的卡组</b>（' + (s.path === 'xie' ? '攻式 3 · 劫掠 2 · 守式 2 · 血祭 1' : '攻式 3 · 五行 2 · 守式 2 · 回式 1') + '，共 8 槽）——每回合整套摊在手上，只按<b>行动点</b>决定你能使哪几张，每回合出一张。付不起、气血不足或在冷却的会置灰；没配满的槽会从你已参悟的招里自动补位。</div>' +
        '<div class="deck-order"><div class="deck-order-title">战斗招式位置</div>' + ordered + '</div>' +
        '<div class="deck-row">' + cols + '</div>' +
        '<div class="deck-actions"><button class="btn-primary" id="dk-save">保 存 标 记</button>' +
        '<button class="icon-btn" id="dk-reset">清 空 标 记</button></div>' +
        (opts.loginPrompt ? '<div class="deck-login-actions"><label><input type="checkbox" id="dk-today"' + (suppressToday ? ' checked' : '') + '> 今日内不再弹出 <small>（勾选后今日内不再弹出）</small></label><button class="icon-btn" id="dk-skip">无需修改</button></div>' : '');
      card.querySelector('#dk-close').addEventListener('click', closeEditor);
      card.querySelector('#dk-save').addEventListener('click', () => {
        g.LS.save.save();
        toast('卡组已保存——下一场斗法就按这套出牌。');
        closeEditor();
      });
      const todayCheck = card.querySelector('#dk-today');
      if (todayCheck) todayCheck.addEventListener('change', () => { suppressToday = todayCheck.checked; });
      const skip = card.querySelector('#dk-skip');
      if (skip) skip.addEventListener('click', () => {
        s.deck = initialDeck.slice();
        g.LS.save.save();
        closeEditor();
      });
      card.querySelector('#dk-reset').addEventListener('click', () => { s.deck = []; g.LS.save.save(); toast('已清空卡组（下次进斗法按已参悟的招自动补位）'); render(); });
      card.querySelectorAll('[data-move]').forEach(btn => btn.addEventListener('click', () => {
        const i = Number(btn.dataset.order), j = btn.dataset.move === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || i >= s.deck.length || j >= s.deck.length) return;
        const next = s.deck.slice(), tmp = next[i]; next[i] = next[j]; next[j] = tmp; s.deck = next;
        sfx('click'); g.LS.save.save(); render();
      }));
      card.querySelectorAll('[data-deck-remove]').forEach(btn => btn.addEventListener('click', () => {
        const index = Number(btn.dataset.deckRemove);
        if (index < 0 || index >= (s.deck || []).length) return;
        s.deck = removeDeckCardAt(s.deck, index);
        sfx('click'); g.LS.save.save(); render();
      }));
      card.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', () => {
        const id = btn.dataset.pick;
        const c = pool.find(x => x.id === id);
        if (!c) return;
        const result = toggleDeckCard(s.deck, c, pool, g.LS.battle.KIND_LIMITS || {});
        if (!result.ok) { toast((KIND_NAME[c.kind] || c.kind) + '槽位已满，请先从上方招式列表移除一张。'); return; }
        s.deck = result.deck;
        sfx('click');
        render();
      }));
    };
    render();
  }

  /* ── 好友面板：名片 / 添加 / 列表挑战 ── */
  function showFriends() {
    removeModals();
    const { card } = makeModal(removeModals);
    const s = g.LS.S;
    const myCard = g.LS.battle.makeCard();
    const cardStr = btoa(unescape(encodeURIComponent(JSON.stringify(myCard))));
    const render = () => {
      const fr = s.friends || [];
      let rows = fr.length ? fr.map((f, i) =>
        '<div class="rebirth-item"><div><b>' + escapeHtml(f.dao || '无名道友') + '</b>' +
        '<div style="font-size:11px;color:var(--ink-soft)">境界 ' + escapeHtml(f.realmName || '?') + ' · 战绩 ' + (f.myWin || 0) + '胜' + (f.myLose || 0) + '负</div></div>' +
        '<button class="btn-primary" data-fight="' + i + '" style="padding:4px 12px">斗 法</button></div>').join('')
        : '<div class="codex-chain">尚无好友——复制你的名片发给道友，或让他们把名片发你。</div>';
      card.innerHTML =
        '<div class="modal-title">道 友 录<button class="icon-btn" id="fr-close" style="float:right;font-size:12px;padding:3px 12px">合上</button></div>' +
        '<div class="modal-desc">我的名片（复制发给道友，对方粘贴即可被你挑战）：</div>' +
        '<textarea class="set-textarea" id="fr-mycard" readonly>' + escapeHtml(cardStr) + '</textarea>' +
        '<div class="set-row"><button class="icon-btn" id="fr-copy">复制名片</button><button class="icon-btn" id="fr-copy-close">复制并合上</button></div>' +
        '<div class="modal-desc">添加好友（粘贴对方名片）：</div>' +
        '<textarea class="set-textarea" id="fr-paste" placeholder="粘贴对方名片码"></textarea>' +
        '<div class="set-row"><button class="btn-primary" id="fr-add" style="padding:6px 16px">添加好友</button></div>' +
        '<div class="set-row" style="justify-content:center;gap:8px"><button class="btn-primary" id="fr-arena" style="padding:6px 16px">擂 台</button></div>' +
        '<div class="set-row" id="fr-join-row" style="display:none"><input class="set-input" id="fr-room-code" placeholder="输入房间码" style="flex:1"></div>' +
        '<h3 class="panel-title">道友录（' + fr.length + '）</h3><div class="modal-desc">论道积分 ' + (s.honor || 0) + ' · 段位 <b>' + (function(){ const ranks=(g.LS.BAL.battle||{}).ranks||[]; let cur=ranks[0]||{name:'凡品'}; for(const r of ranks){ if((s.honor||0)>=r.min) cur=r; } return cur.name; })() + '</b></div>' + rows +
        '<div style="text-align:center;margin-top:10px"><button class="icon-btn" id="fr-close2">合上</button></div>';
      card.querySelector('#fr-close').addEventListener('click', removeModals);
      card.querySelector('#fr-close2').addEventListener('click', removeModals);
      const copyAll = () => {
        const ta = card.querySelector('#fr-mycard');
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        try { navigator.clipboard.writeText(ta.value); } catch (e) {}
        toast('名片已复制，发给道友吧');
      };
      card.querySelector('#fr-copy').addEventListener('click', copyAll);
      card.querySelector('#fr-copy-close').addEventListener('click', () => { copyAll(); removeModals(); });
      card.querySelector('#fr-add').addEventListener('click', () => {
        const raw = (card.querySelector('#fr-paste').value || '').trim();
        if (!raw) { toast('请先粘贴名片'); return; }
        try {
          const obj = JSON.parse(decodeURIComponent(escape(atob(raw))));
          if (!obj || ![1, 3].includes(obj.v) || typeof obj.realm !== 'number') throw new Error('格式不对');
          s.friends = s.friends || [];
          if (s.friends.some(f => f.dao === obj.dao)) { toast('这位道友已在录中'); return; }
          s.friends.push({ dao: obj.dao, card: obj, realmName: (g.LS.BAL.realms[obj.realm] || {}).name || '?', myWin: 0, myLose: 0 });
          g.LS.save.save();
          toast('道友「' + (obj.dao || '无名') + '」已入录，可随时斗法');
          render();
        } catch (e) { toast('名片无法辨识'); }
      });
      card.querySelectorAll('[data-fight]').forEach(btn => {
        btn.addEventListener('click', () => {
          const f = (s.friends || [])[Number(btn.dataset.fight)];
          if (!f) return;
          const r = quickDuel(f, btn);
          if (r && !r.ok && r.msg) toast(r.msg);
        });
      });
      // 擂台：与地图擂台同达（斗法总入口）
      card.querySelector('#fr-arena').addEventListener('click', () => {
        removeModals();
        g.LS.page.go('arena');
      });
    };
    render();
  }

  /* ── B1 仙途指要：分节帮助面板（文案在 help.json help_topics） ── */
  function showHelpPanel() {
    removeModals();
    const { card } = makeModal(removeModals);
    const topics = (g.LS.BAL.help && g.LS.BAL.help.help_topics) || {};
    let html = '<div class="modal-title">仙 途 指 要<button class="icon-btn" id="hp-close" style="float:right;font-size:12px;padding:3px 12px">合上</button></div>';
    for (const key in topics) {
      const t = topics[key];
      html += '<h3 class="panel-title">' + escapeHtml(t.title) + '</h3>' +
        t.lines.map(l => '<div class="codex-chain">' + escapeHtml(l) + '</div>').join('');
    }
    html += '<div style="text-align:center;margin-top:12px"><button class="icon-btn" id="hp-close2">合上</button></div>';
    card.innerHTML = html;
    card.querySelector('#hp-close').addEventListener('click', removeModals);
    card.querySelector('#hp-close2').addEventListener('click', removeModals);
  }

  /* ── 丹房：丹药库存一览 / 服用 / 丹毒 ── */
  function showPillHouse() { g.LS.page.go('dannfang'); }
  function showPillHouseModal() {
    removeModals();
    const { card } = makeModal(removeModals);
    const eco = g.LS.economy;
    const render = () => {
      const s = g.LS.S;
      const q = eco.pillQualityCfg() || { toxic_penalty: {} };
      const toxic = s.pill_toxic || 0;
      const penalty = Math.min(q.toxic_penalty.cap || 0.30, Math.floor(toxic / 10) * (q.toxic_penalty.per_10_points || 0.05));
      const poisioningSoon = toxic >= (q.toxic_penalty.poisoning_threshold || 60);
      let rows = '';
      for (const p of ((g.LS.BAL.pills && g.LS.BAL.pills.pills) || [])) {
        // 按品质分行可选（v0.20：吃哪个品质自己点），无库存品质不显示
        const qBtns = ['劣', '凡', '灵', '珍', '仙'].map(q2 => {
          const n = (s.pill_stock || {})[eco.pillStockKey ? eco.pillStockKey(p.id, q2) : p.id + '_' + q2] || 0;
          if (!n) return '';
          return '<button class="icon-btn" data-pill="' + p.id + '" data-q="' + q2 + '" style="padding:2px 8px;font-size:11px;min-height:0">' + q2 + '×' + n + '</button>';
        }).filter(Boolean).join(' ');
        rows += '<div class="rebirth-item"><div><b>' + escapeHtml(p.name) + '</b>' +
          '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(p.desc) + '</div></div>' +
          '<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">' + (qBtns || '<span style="font-size:11px;color:var(--ink-soft)">无库存</span>') + '</div></div>';
      }
      card.innerHTML =
        '<div class="modal-title">丹 房<button class="icon-btn" id="ph-close" style="float:right;font-size:12px;padding:3px 12px">合上</button></div>' +
        '<div class="modal-desc">丹毒 <b style="color:' + (toxic >= 30 ? 'var(--cinnabar)' : 'inherit') + '">' + Math.floor(toxic) + '</b>' +
        '（当前产量 ' + (penalty > 0 ? '-' + Math.round(penalty * 100) + '%' : '无碍') + '）' +
        (poisioningSoon ? '<span class="log-gain">　⚠ 再服低品丹将丹毒攻心！</span>' : '') +
        '<br><span style="font-size:11px;color:var(--ink-soft)">丹毒随时间缓缓消散；清心丹可大幅化解；兵解转世丹毒尽去。</span></div>' +
        rows +
        '<div style="text-align:center;margin-top:10px"><button class="icon-btn" id="ph-close2">合上</button></div>';
      card.querySelector('#ph-close').addEventListener('click', removeModals);
      card.querySelector('#ph-close2').addEventListener('click', removeModals);
      card.querySelectorAll('[data-pill]').forEach(btn => {
        btn.addEventListener('click', () => {
          const r = eco.consumePill(btn.dataset.pill, btn.dataset.q || '灵');
          if (r.ok) { sfx('click'); toast(r.msg); }
          render();
          renderResources();
          renderAll();
        });
      });
    };
    render();
  }

  /* ── 图鉴面板：奇遇收集 / 剧情链 / 因果故人（跨转生保留） ── */
  function showCodex() {
    removeModals();
    const { card } = makeModal();
    const s = g.LS.S;
    const bal = g.LS.BAL;
    let evRows = '';
    let got = 0;
    for (const ev of g.LS.EVT) {
      const n = s.collection[ev.id] || 0;
      if (n) got++;
      evRows += '<div class="codex-cell' + (n ? ' seen rarity-' + ev.rarity : '') + '" data-tip="' + (n ? escapeHtml(ev.title) + '（遇过 ' + n + ' 次）' : '尚未遇见') + '">' +
        (n ? escapeHtml(ev.title) : '？') + '</div>';
    }
    let chainRows = '';
    for (const c of (g.LS.CHAINS || [])) {
      const seenN = s.chain_seen[c.id] || 0;
      chainRows += '<div class="codex-chain">' +
        '<b>' + (seenN ? escapeHtml(c.stages[0].title) : '？？') + '</b>　' +
        '<span class="log-choice">剧情链 ' + seenN + '/' + c.stages.length + ' 幕</span></div>';
    }
    let tagRows = '';
    const tagNames = (bal.codex && bal.codex.tag_names) || {};
    for (const k in s.tags) {
      const t = s.tags[k];
      const leg = (s.karma_legacy || {})[k];
      tagRows += '<div class="codex-chain"><b>' + escapeHtml(tagNames[k] || k) + '</b>　' +
        '<span class="' + (t.recycled ? 'log-choice' : 'log-gain') + '">' +
        (t.stance || '') + '·' + (t.recycled ? '已了结' : '未了') + '（' + (t.weight || 1) + '）</span>' +
        (leg && leg.worlds ? '<span class="ev-badge ev-badge-chain">隔世 ' + leg.worlds + '</span>' : '') + '</div>';
    }
    if (!tagRows) tagRows = '<div class="codex-chain">此世尚无因果纠缠</div>';
    // 碑林：历世碑文（跨转生保留）
    let steleRows = '';
    for (const st of (s.steles || []).slice().reverse()) {
      steleRows += '<div class="stele"><div class="stele-title">' + escapeHtml(st.title) + '</div>' +
        '<pre class="stele-body">' + escapeHtml(st.body.join('\n')) + '\n' + escapeHtml(st.footer || '') + '</pre>' +
        '<button class="icon-btn stele-copy" style="font-size:11px;padding:2px 8px;min-height:0">复制</button></div>';
    }
    if (!steleRows) steleRows = '<div class="codex-chain">碑林尚空——飞升或兵解时，此世山志将刻为碑文。</div>';
    // 图鉴三册：丹药 / 兵器 / 功法（数据源 pills.json 与 cultivation.json）
    const pills = (bal.pills && bal.pills.pills) || [];
    const cul = bal.cultivation || {};
    const weapons = cul.weapons || [];
    const techniques = cul.techniques || [];
    let pillRows = '';
    for (const p of pills) {
      const ownedN = Object.keys(s.pill_stock || {}).filter(k => k.indexOf(p.id + '_') === 0)
        .reduce((a, k) => a + s.pill_stock[k], 0);
      pillRows += '<div class="rebirth-item"><div><b>' + escapeHtml(p.name) + '</b>' +
        '<span class="ev-badge ev-badge-buff">' + escapeHtml(p.rarity_default || '灵') + '</span>' +
        '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(p.desc) +
        (ownedN ? '<br><span class="log-choice">持有 ' + ownedN + ' 颗</span>' : '') + '</div></div></div>';
    }
    let weaponRows = '';
    for (const w of weapons) {
      const owned = (s.weapons_owned || []).indexOf(w.id) !== -1;
      weaponRows += '<div class="rebirth-item"><div><b>' + escapeHtml(w.name) + '</b>' +
        '<span class="ev-badge ev-badge-buff">' + escapeHtml(w.grade) + '·' + escapeHtml(w.element) + '</span>' +
        '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(w.desc) + '　锋锐 ' + w.sharp +
        (owned ? '<br><span class="log-choice">已入手' + (s.equip.weapon === w.id ? '（装备中）' : '') + '</span>' : '<br><span style="opacity:.6">坊市 ' + g.LS.util.fmt(w.price) + ' 灵石</span>') + '</div></div></div>';
    }
    let techRows = '';
    for (const t of techniques) {
      const owned = (s.techniques_owned || []).indexOf(t.id) !== -1;
      techRows += '<div class="rebirth-item"><div><b>' + escapeHtml(t.name) + '</b>' +
        '<span class="ev-badge ev-badge-buff">' + escapeHtml(t.grade) + '·' + escapeHtml(t.element) + '</span>' +
        '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(t.desc) +
        (owned ? '<br><span class="log-choice">已参悟' + (s.equip.technique === t.id ? '（主修中）' : '') + '</span>' : '<br><span style="opacity:.6">坊市 ' + g.LS.util.fmt(t.price) + ' 灵石</span>') + '</div></div></div>';
    }
    // 页签切换（六页：奇遇/丹药/兵器/功法/因果/碑林）
    card.innerHTML =
      '<div class="modal-title">见 闻 录</div>' +
      '<div class="modal-desc">奇遇集齐 ' + got + ' / ' + g.LS.EVT.length + '　·　图鉴、因果与碑林跨转生保留</div>' +
      '<div class="set-row" style="justify-content:center;flex-wrap:wrap;gap:4px">' +
      [['ev', '奇遇'], ['pill', '丹药'], ['weapon', '兵器'], ['tech', '功法'], ['tag', '因果'], ['stele', '碑林']].map(p2 =>
        '<button class="icon-btn codex-tab" data-codex-tab="' + p2[0] + '">' + p2[1] + '</button>').join('') + '</div>' +
      '<div id="codex-body"></div>' +
      '<div style="text-align:center;margin-top:12px"><button class="icon-btn" id="codex-close">合上</button></div>';
    const renderTab = (tab2) => {
      const body = card.querySelector('#codex-body');
      if (tab2 === 'ev') body.innerHTML = '<h3 class="panel-title">奇遇图鉴</h3><div class="codex-grid">' + evRows + '</div>' +
        '<h3 class="panel-title">剧情链</h3>' + chainRows;
      else if (tab2 === 'pill') body.innerHTML = '<h3 class="panel-title">丹药图谱</h3>' + pillRows;
      else if (tab2 === 'weapon') body.innerHTML = '<h3 class="panel-title">兵器谱</h3>' + weaponRows;
      else if (tab2 === 'tech') body.innerHTML = '<h3 class="panel-title">功法谱</h3>' + techRows;
      else if (tab2 === 'tag') body.innerHTML = '<h3 class="panel-title">因果故人</h3>' + tagRows;
      else if (tab2 === 'stele') body.innerHTML = '<h3 class="panel-title">碑林（山志）</h3>' + steleRows;
    };
    card.querySelectorAll('.codex-tab').forEach(b => {
      b.addEventListener('click', () => {
        card.querySelectorAll('.codex-tab').forEach(x => { x.style.borderColor = ''; x.style.color = ''; });
        b.style.borderColor = 'var(--cinnabar)';
        b.style.color = 'var(--cinnabar)';
        renderTab(b.dataset.codexTab);
      });
    });
    // 默认开奇遇页
    const firstTab = card.querySelector('.codex-tab');
    if (firstTab) { firstTab.style.borderColor = 'var(--cinnabar)'; firstTab.style.color = 'var(--cinnabar)'; renderTab('ev'); }
    card.querySelector('#codex-close').addEventListener('click', removeModals);
    card.querySelectorAll('.stele-copy').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        const st = (s.steles || []).slice().reverse()[idx];
        if (st) {
          const text = st.title + '\n' + st.body.join('\n') + '\n' + (st.footer || '');
          try { navigator.clipboard.writeText(text); toast('碑文已复制，可粘贴分享'); } catch (e) { toast('复制失败，请手动选择文本'); }
        }
      });
    });
  }

  /* ── 弦外之音：WebAudio 合成古琴 BGM（D 宫五声，留白即曲） ── */
  const BGM_SCALE = [220.0, 293.66, 329.63, 369.99, 440.0, 493.88, 587.33];
  let bgmTimer = null, bgmNext = 0, bgmCount = 0;
  const bgmSources = new Set();

  function trackBgmSource(source) {
    bgmSources.add(source);
    source.addEventListener('ended', () => bgmSources.delete(source), { once: true });
    return source;
  }

  function stopBgmSources() {
    for (const source of bgmSources) {
      try { source.stop(); } catch (e) {}
    }
    bgmSources.clear();
    bgmNext = 0;
  }

  function bgmPluck(freq, when, vol) {
    const ctx = audioCtx;
    const t = when || ctx.currentTime;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1200;
    g.connect(lp); lp.connect(ctx.destination);
    const o1 = trackBgmSource(ctx.createOscillator()); o1.type = 'triangle'; o1.frequency.value = freq;
    const o2 = trackBgmSource(ctx.createOscillator()); o2.type = 'sine'; o2.frequency.value = freq * 1.003;
    const og = ctx.createGain(); og.gain.value = 0.5;
    o1.connect(og); o2.connect(og); og.connect(g);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol || 0.045, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.01), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 120);
    const nb = trackBgmSource(ctx.createBufferSource()); nb.buffer = buf;
    const ng = ctx.createGain(); ng.gain.value = 0.03;
    nb.connect(ng); ng.connect(lp);
    o1.start(t); o2.start(t); nb.start(t);
    o1.stop(t + 1.9); o2.stop(t + 1.9);
  }

  function bgmXiao(when) {
    const ctx = audioCtx;
    const t = when;
    const o = trackBgmSource(ctx.createOscillator()); o.type = 'sine'; o.frequency.value = 293.66;
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.026, t + 0.8);
    g.gain.setValueAtTime(0.026, t + 1.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    o.start(t); o.stop(t + 3.3);
  }

  function bgmStep() {
    if (!g.LS.S || !g.LS.S.settings.music || document.hidden) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      if (bgmNext < now) bgmNext = now + 0.6;
      if (bgmNext < now + 2) {
        const f = BGM_SCALE[Math.floor(Math.random() * BGM_SCALE.length)];
        bgmPluck(f, bgmNext);
        if (Math.random() < 0.18) bgmPluck(BGM_SCALE[(BGM_SCALE.indexOf(f) + 3) % BGM_SCALE.length], bgmNext + 0.14, 0.03);
        bgmCount++;
        if (bgmCount % 14 === 0) bgmXiao(bgmNext + 0.3); // 每十几音进一声箫
        bgmNext += 2 + Math.random() * 7; // 音间留白 2~9 秒
      }
    } catch (e) { /* 音频失败静默 */ }
  }

  function setBgm(on) {
    if (on) {
      if (!bgmTimer) bgmTimer = setInterval(bgmStep, 800);
      bgmStep();
    } else {
      clearInterval(bgmTimer);
      bgmTimer = null;
      stopBgmSources();
    }
  }

  // 手机浏览器与桌面壳退出时必须主动停掉 WebAudio；仅靠定时器自然结束会在后台继续发声。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(bgmTimer);
      bgmTimer = null;
      stopBgmSources();
      if (audioCtx && audioCtx.state === 'running') audioCtx.suspend().catch(() => {});
      return;
    }
    if (!audioCtx || !g.LS.S || !g.LS.S.settings) return;
    const restart = () => {
      stopBgmSources();
      bgmNext = audioCtx.currentTime + 0.8;
      if (g.LS.S.settings.music) setBgm(true);
    };
    if (audioCtx.state === 'suspended' && (g.LS.S.settings.sound || g.LS.S.settings.music)) {
      audioCtx.resume().then(restart).catch(() => {});
    } else if (audioCtx.state === 'running') {
      restart();
    }
  });
  window.addEventListener('pagehide', () => {
    clearInterval(bgmTimer);
    bgmTimer = null;
    stopBgmSources();
    const closing = audioCtx;
    audioCtx = null;
    if (closing && closing.state !== 'closed') closing.close().catch(() => {});
  });
  window.addEventListener('pageshow', () => {
    if (g.LS.S && g.LS.S.settings && g.LS.S.settings.music) setBgm(true);
  });

  /* ── 留言板（2026-09-21）：递给本地代理落盘；代理没开就存本机，下次进来自动补交 ── */
  const FB_KEY = 'lingshan_feedback_pending';
  /** 页面由代理托管时同源提交（端口以 config.json 为准，不写死）；file:// 直开则退回默认代理地址 */
  function fbBase() {
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) return '';
    return (g.LS.llm && g.LS.llm.PROXY) || 'http://127.0.0.1:8787';
  }
  function fbVer() { const el = document.getElementById('version-mark'); return el ? (el.textContent || '').trim() : ''; }
  function fbPending() { try { return JSON.parse(localStorage.getItem(FB_KEY) || '[]'); } catch (e) { return []; } }
  function fbStore(q) { try { localStorage.setItem(FB_KEY, JSON.stringify((q || []).slice(-50))); } catch (e) {} }
  function fbPost(rec) {
    return fetch(fbBase() + '/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec)
    }).then(r => { if (!r.ok) throw new Error('http ' + r.status); return true; });
  }
  /** 递交一条：成功返回 {local:false}；代理不可用则存本机排队（{local:true}），绝不丢玩家的字 */
  function fbSend(text) {
    const s = g.LS.S || {};
    const rec = { text: text, realm: (s.realm && s.realm.index) || 0, version: fbVer() };
    return fbPost(rec).then(() => ({ local: false }))
      .catch(() => { const q = fbPending(); q.push(Object.assign({ t: Date.now() }, rec)); fbStore(q); return { local: true }; });
  }
  /** 启动/打开设置时补交本机暂存的留言 */
  function fbFlush() {
    const q = fbPending();
    if (!q.length) return;
    (async () => {
      const rest = [];
      for (const rec of q) {
        try { await fbPost(rec); } catch (e) { rest.push(rec); }
      }
      fbStore(rest);
    })();
  }

  /* ── 设置面板 ── */
  /** 低性能模式（设置开关）：给 html 挂 .lowfx 交给 CSS 简化背景，并停掉环境 canvas 与天气粒子 */
  function applyLowFx() {
    const on = !!(g.LS.S && g.LS.S.settings && g.LS.S.settings.lowfx);
    document.documentElement.classList.toggle('lowfx', on);
    if (g.LS.ambient && g.LS.ambient.setLowFx) g.LS.ambient.setLowFx(on);
    return on;
  }

  function showSettings() {
    removeModals();
    const { card, mask } = makeModal(removeModals);
    const s = g.LS.S;
    const label = (k) => (g.LS.BAL.difficulty && g.LS.BAL.difficulty[k] && g.LS.BAL.difficulty[k].label) || k;
    const bindDiff = () => {
      card.querySelectorAll('[data-setdiff]').forEach(btn => {
        btn.addEventListener('click', () => {
          s.settings.difficulty = btn.dataset.setdiff;
          g.LS.save.save();
          toast('难度已切换：' + label(btn.dataset.setdiff));
          showSettings(); // 重绘高亮
        });
      });
    };
    bindDiff();
    card.innerHTML =
      '<div class="modal-title">设 置<button class="icon-btn" id="set-close" style="float:right;font-size:12px;padding:3px 12px">合上</button></div>' +
      '<div class="set-row"><label>难度</label><span id="set-diff">' +
      ['easy', 'normal', 'hard'].map(k =>
        '<button class="icon-btn" data-setdiff="' + k + '" style="' + (s.settings.difficulty === k ? 'border-color:var(--cinnabar);color:var(--cinnabar)' : '') + '">' + escapeHtml(label(k)) + '</button>'
      ).join(' ') + '</span></div>' +
      '<div class="set-row"><label>音效</label><input type="checkbox" id="set-sound" ' + (s.settings.sound ? 'checked' : '') + '></div>' +
      '<div class="set-row"><label>低性能模式</label><input type="checkbox" id="set-lowfx" ' + (s.settings.lowfx ? 'checked' : '') + '></div>' +
      '<div class="modal-desc" style="font-size:11px;color:var(--ink-soft)">低性能模式：去掉全屏模糊、雾层、纸纹与云幕动画，画面略简、GPU 占用大降（老机器或高分屏更顺）。</div>' +
      '<div class="set-row"><label>古琴（环境曲，留白即曲）</label><input type="checkbox" id="set-music" ' + (s.settings.music && !s.settings.custom_music ? 'checked' : '') + '></div>' +
      '<div class="set-row"><label>自定义背景乐</label><input type="file" id="set-bgm-file" accept="audio/*" style="max-width:170px;font-size:11px"></div>' +
      '<div class="set-row"><label>　播放自定义乐</label><input type="checkbox" id="set-custom-music" ' + (s.settings.custom_music ? 'checked' : '') + '></div>' +
      '<div class="set-row"><label>　清除导入</label><button class="icon-btn" id="set-bgm-clear">删 除</button></div>' +
      '<div class="set-row"><label>LLM 动态奇遇</label><input type="checkbox" id="set-llm" ' + (s.settings.llm_enabled ? 'checked' : '') + '></div>' +
      '<div class="set-llm-status">奇遇文案由火山方舟免费额度生成；不填或额度耗尽时自动改用内置事件池，游戏始终完整可玩，绝不产生任何费用。</div>' +
      '<div class="set-row"><label>密钥（写入 config.json）</label><input class="set-input" id="set-key" type="password" placeholder="粘贴 ark_api_key"><button class="btn-primary" id="set-key-save">保存</button></div>' +
      '<div class="set-row"><button class="icon-btn" id="set-retry-llm">重试 LLM</button><button class="icon-btn" id="set-savenow">立即存档</button></div>' +
      '<div class="set-row"><label>导出存档</label><button class="icon-btn" id="set-export">生成文本</button></div>' +
      '<textarea class="set-textarea" id="set-io" placeholder="导出后复制保存；导入时粘贴至此"></textarea>' +
      '<div class="set-row"><label>导入存档</label><button class="icon-btn" id="set-import">读取文本</button></div>' +
      '<div class="fb-box">' +
        '<div class="fb-title">留 言 板</div>' +
        '<div class="modal-desc" style="font-size:11px;color:var(--ink-soft)">玩着哪里别扭、想要什么新玩法、哪里数值不对——写在这里，我一条条看。</div>' +
        '<textarea class="set-textarea fb-textarea" id="fb-text" maxlength="500" placeholder="（500 字以内）"></textarea>' +
        '<div class="set-row" style="justify-content:flex-end"><button class="btn-primary" id="fb-send" style="padding:6px 22px">递 上 留 言</button></div>' +
        '<div class="fb-slogan">你们的建议都是我们前进的动力！</div>' +
      '</div>' +
      '<div class="danger-zone set-row"><label>重置游戏（长按 3 秒）</label><button id="btn-reset"><span class="hold-fill"></span>长按重置</button></div>';

    bindDiff(); // 难度三选按钮事件（需在 innerHTML 渲染后绑定）
    card.querySelector('#set-sound').addEventListener('change', (e) => { s.settings.sound = e.target.checked; g.LS.save.save(); });
    card.querySelector('#set-lowfx').addEventListener('change', (e) => {
      s.settings.lowfx = e.target.checked;
      applyLowFx();
      g.LS.save.save();
      toast(s.settings.lowfx ? '低性能模式已开：背景特效简化。' : '低性能模式已关：背景特效恢复。');
    });
    card.querySelector('#set-music').addEventListener('change', (e) => {
      if (e.target.checked && s.settings.custom_music) { e.target.checked = false; toast('已启用自定义背景乐——如需古琴请先关闭「播放自定义乐」'); return; }
      s.settings.music = e.target.checked;
      setBgm(s.settings.music);
      g.LS.save.save();
    });
    card.querySelector('#set-llm').addEventListener('change', (e) => { s.settings.llm_enabled = e.target.checked; g.LS.save.save(); });
    card.querySelector('#set-savenow').addEventListener('click', () => { g.LS.save.save(); toast('已存档'); });
    card.querySelector('#set-retry-llm').addEventListener('click', () => { g.LS.llm.retryLLM(); toast('正在重新探测 LLM……'); });
    card.querySelector('#set-export').addEventListener('click', () => {
      const ta = card.querySelector('#set-io');
      ta.value = g.LS.save.exportToText();
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      toast('存档已导出到文本框，请复制保存。');
    });
    card.querySelector('#set-import').addEventListener('click', () => {
      const ta = card.querySelector('#set-io');
      const str = ta.value.trim();
      if (!str) { toast('请先在文本框粘贴存档文本'); return; }
      if (!confirm('导入将覆盖当前进度（当前档已自动备份），确定吗？')) return;
      const r = g.LS.save.importFromText(str);
      if (r.ok) { toast('导入成功，已按存档重新开局。'); setTimeout(() => location.reload(), 600); }
      else toast('导入失败：' + (r.reason || '存档不合法'));
    });
    card.querySelector('#set-key-save').addEventListener('click', async () => {
      const key = card.querySelector('#set-key').value.trim();
      if (!key) { toast('密钥不能为空'); return; }
      try {
        const r = await fetch(g.LS.llm.PROXY + '/api/key', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ark_api_key: key })
        });
        if (r.ok) { toast('密钥已保存，状态灯转绿即表示可用。'); g.LS.llm.retryLLM(); }
        else toast('密钥校验未通过：请检查 config.json 的 ark_api_key，或重新生成密钥。');
      } catch (e) {
        toast('本地代理未启动：请双击 start.bat，等窗口出现提示后刷新页面。');
      }
    });
    // 长按 3 秒重置
    const resetBtn = card.querySelector('#btn-reset');
    const fill = resetBtn.querySelector('.hold-fill');
    let holdTO = null, startT = 0;
    resetBtn.addEventListener('pointerdown', () => {
      startT = Date.now();
      fill.style.transition = 'width 3s linear';
      fill.style.width = '100%';
      holdTO = setTimeout(() => {
        g.LS.save.resetAll();
        location.reload();
      }, 3000);
    });
    ['pointerup', 'pointerleave'].forEach(ev => resetBtn.addEventListener(ev, () => {
      clearTimeout(holdTO);
      fill.style.transition = 'width .2s';
      fill.style.width = '0%';
    }));
    card.querySelector('#fb-send').addEventListener('click', async () => {
      const ta = card.querySelector('#fb-text');
      const txt = ((ta && ta.value) || '').trim();
      if (!txt) { toast('先写点什么吧'); return; }
      const btn = card.querySelector('#fb-send');
      btn.disabled = true;
      const r = await fbSend(txt);
      btn.disabled = false;
      if (r.local) toast('本地代理没开，留言先替你收在本机了——下次带着 start.bat 进来会自动递上。', 4600);
      else { if (ta) ta.value = ''; toast('留言已递上。你们的建议都是我们前进的动力！', 3800); }
    });
    fbFlush();   // 顺手把上次没递出去的补上
    card.querySelector('#set-close').addEventListener('click', removeModals);
  }

  /* ── 转生面板 ── */
  function showRebirthPanel() {
    removeModals();
    const { card } = makeModal();
    const bal = g.LS.BAL;
    const render = () => {
      const s = g.LS.S;
      const gain = g.LS.realm.rebirthGain();
      let rows = '';
      for (const u of bal.prestige.upgrades) {
        const st = g.LS.economy.upgradeState(u);
        const bought = st === 'bought';
        const lv = g.LS.economy.talentLv(u.id);
        const maxLv = u.max_lv || 1;
        const nextCost = (u.costs && u.costs[lv]) != null ? u.costs[lv] : u.cost;
        const lvTxt = maxLv > 1 ? '<span style="color:var(--gold,#e8c34a)">' + lv + '/' + maxLv + '重</span> ' : '';
        const stateTxt = bought
          ? '<span class="stamp">圆 满</span>'
          : '<span style="font-size:12px;margin-right:6px">' + nextCost + ' 点</span>';
        rows += '<div class="rebirth-item' + (bought ? ' bought' : '') + '">' +
          '<div><b>' + escapeHtml(u.name) + '</b> ' + lvTxt + '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(u.desc) + '</div></div>' +
          '<div>' + stateTxt +
          (bought ? '' : '<button class="icon-btn" data-up="' + u.id + '" ' + (st === 'ok' ? '' : 'disabled') + '>承' + (maxLv > 1 && lv > 0 ? '再承' : '悟') + '</button>') + '</div></div>';
      }
      card.innerHTML =
        '<div class="modal-title">' + bal.texts.rebirth_panel_title + '</div>' +
        '<div class="modal-desc" style="color:var(--ink-soft)">' + bal.texts.rebirth_panel_quote + '</div>' +
        '<div class="modal-desc">此世可获传承点：<b style="color:var(--cinnabar)">' + gain + '</b>　历世转生：' + s.prestige.count + ' 次　现有传承点：' + s.prestige.points + '</div>' +
        rows +
        '<div style="text-align:center;margin-top:14px"><button class="btn-primary" id="btn-do-rebirth" style="font-size:18px;padding:12px 40px">兵解转生</button> ' +
        '<button class="icon-btn" id="btn-close-rebirth">再看看</button></div>';
      card.querySelectorAll('[data-up]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (g.LS.economy.buyUpgrade(btn.dataset.up)) { toast('传承已承'); render(); renderPermList(); }
        });
      });
      card.querySelector('#btn-close-rebirth').addEventListener('click', removeModals);
      card.querySelector('#btn-do-rebirth').addEventListener('click', () => {
        if (!confirm(bal.texts.rebirth_confirm)) return;
        g.LS.realm.doRebirth();
        removeModals();
      });
    };
    render();
  }

  /* ── 引导 ── */
  function showTutorial(arr) {
    arr.forEach((t, i) => setTimeout(() => toast(t, 4000), i * 4200));
  }

  /* ── toast 与数字补间 ── */
  /* 突破过场期间的提示排队（2026-09-19）：过场是「点击任意处继续」的整屏大动画，
     期间冒出来的提示（境界引导 / 飞升 / 转生 / 概念提示）原本直接叠在画面上。
     改成静默入队，玩家点掉过场后按 1.2 秒间隔依次播，最多留 3 条。
     判定走 DOM 存在性，过场一被移除就自动恢复，不需要额外状态位。 */
  const btToastQueue = [];
  function btOverlayShowing() { return !!document.getElementById('breakthrough-overlay'); }
  function drainBtToastQueue() {
    if (!btToastQueue.length) return;
    const it = btToastQueue.shift();
    toast(it.msg, it.dur);
    if (btToastQueue.length) setTimeout(drainBtToastQueue, 1200);
  }

  /* 同屏提示条上限（2026-09-19，桌面/移动统一）：任何来源刷屏都顶掉最旧的，
     防“主线连领 / 批量买建筑”这类瞬时多提示把屏幕铺满、压住境界名。 */
  const TOAST_MAX = 3;
  function toast(msg, dur) {
    // 突破过场期间：先入队，等过场关掉再依次播
    if (btOverlayShowing()) {
      btToastQueue.push({ msg: msg, dur: dur });
      while (btToastQueue.length > 3) btToastQueue.shift();
      return;
    }
    // 顶栏换行变高时动态下移提示条，保证永不遮挡资源栏
    if (refs.topbar && refs.toastRoot) {
      refs.toastRoot.style.top = (refs.topbar.offsetHeight + 18) + 'px';
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    refs.toastRoot.appendChild(el);
    while (refs.toastRoot.childElementCount > TOAST_MAX) {
      refs.toastRoot.removeChild(refs.toastRoot.firstElementChild);
    }
    setTimeout(() => el.remove(), dur || 2600);
  }

  function tweenNumber(el, from, to) {
    const t0 = performance.now();
    const dur = 500;
    function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      const v = from + (to - from) * p;
      el.textContent = '+' + fmtSafe(v);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ── Canvas 远山（只画一次，resize 防抖重画） ── */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function drawBg() {
    const cv = refs.bg;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = cv.width = window.innerWidth;
    const h = cv.height = window.innerHeight;
    const seed = (g.LS.BAL.bg && g.LS.BAL.bg.seed) || 42;
    const alphas = (g.LS.BAL.bg && g.LS.BAL.bg.layer_alphas) || [0.10, 0.18, 0.30];
    const rnd = mulberry32(seed);
    ctx.clearRect(0, 0, w, h);
    for (let layer = 0; layer < 3; layer++) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      const baseY = h * (0.55 + layer * 0.14);
      let x = 0;
      ctx.lineTo(0, baseY);
      while (x < w) {
        const span = w * (0.12 + rnd() * 0.15);
        const peak = baseY - h * (0.08 + rnd() * (0.16 - layer * 0.04));
        ctx.quadraticCurveTo(x + span / 2, peak, x + span, baseY + (rnd() - 0.5) * h * 0.05);
        x += span;
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      const mountain = g.LS.S && g.LS.S.path === 'xie' ? '119, 28, 31' : '61, 90, 108';
      ctx.fillStyle = 'rgba(' + mountain + ', ' + alphas[layer] + ')';
      ctx.fill();
    }
  }

  /* ── 总渲染 ── */
  function renderAll() {
    try {
      const qd = document.getElementById('quest-dot');
      if (qd) qd.style.display = (g.LS.quest && g.LS.quest.hasClaimable()) ? '' : 'none'; // 主线可领奖红点（补领制）
    } catch (e) {}
    if (!g.LS.S || !g.LS.BAL) return;
    const isXie = g.LS.S.path === 'xie';
    document.documentElement.classList.toggle('xie', isXie);
    if (uiState.lastXie !== isXie) {
      uiState.lastXie = isXie;
      drawBg();
    }
    const moBtn = document.getElementById('btn-mo');
    if (moBtn) moBtn.classList.toggle('hidden', g.LS.S.path !== 'xie');
    renderResources();
    renderBuildings();
    renderCenter();
    renderPermList();
  }

  window.addEventListener('resize', (() => {
    let t = null;
    return () => { clearTimeout(t); t = setTimeout(drawBg, 200); };
  })());

  g.LS.ui = {
    initRefs, renderAll, renderResources, renderBuildings, renderCenter,
    renderChronicle, renderPermList, pushLog, markNewBuildings, isModalOpen, hintOnce,
    showEventModal, showEventPicker, closeEventModal, showOfflinePopup, showBreakthroughOverlay, showFailOverlay,
    showRealmUnlockGuide,
    showSettings, showRebirthPanel, showTutorial, showPillHouse, showHelpPanel, showMarket, showFriends, showDeckEditor, scheduleDeckPrompt, showSeniorPick, showCodexPage, showUpdateNotes, scheduleUpdateNotes, migrateLegacyUpdateRead, unreadUpdateCount, playEmperorTribulation, showTrial, showXinmo, showMoPanel, showAmbushModal, showQuest, showDisciple, showDiscipleRecruit, showGenerationChoice, showTutorialSteps,
    showBattleArena, showBattleGuide, updateBattleHP, updateBattleShields, updateBattleQi, renderBattleHands, showBattleIntent,
    showBattleScreen, battleLog, battleAppend, showBattleResult, renderDiscipleSkills, updateBattleRound,
    toast, tweenNumber, setBgm, applyLowFx, fbFlush, toggleDeckCard, removeDeckCardAt,
    setLLMStatus, setForewarn, updateBuffBar, drawBg, sfx, playTribulation,
  };
})(typeof window !== 'undefined' ? window : globalThis);
