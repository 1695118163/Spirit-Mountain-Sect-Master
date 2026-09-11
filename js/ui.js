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
  const newBuildingUntil = {};
  let buildingSig = '';
  let audioCtx = null;

  function $id(id) { return document.getElementById(id); }
  function fmtSafe(v) { return (g.LS.util && g.LS.util.fmt) ? g.LS.util.fmt(v) : String(Math.floor(v || 0)); }

  /* ── WebAudio 合成音效（零素材） ── */
  function sfx(type) {
    if (!g.LS.S || !g.LS.S.settings || !g.LS.S.settings.sound) return;
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
        // 天劫雷声：噪声爆裂 + 低频轰鸣
        const nb = ctx.createBufferSource();
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * .5), ctx.sampleRate);
        const dd = buf.getChannelData(0);
        for (let i = 0; i < dd.length; i++) dd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (dd.length / 4));
        nb.buffer = buf;
        const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 900;
        const ng = ctx.createGain(); ng.gain.setValueAtTime(.4, t); ng.gain.exponentialRampToValueAtTime(.001, t + .5);
        nb.connect(nf); nf.connect(ng); ng.connect(ctx.destination);
        nb.start(t);
        const o2 = ctx.createOscillator(); o2.type = 'sine';
        o2.frequency.setValueAtTime(90, t); o2.frequency.exponentialRampToValueAtTime(38, t + .5);
        const g2 = ctx.createGain(); g2.gain.setValueAtTime(.28, t); g2.gain.exponentialRampToValueAtTime(.001, t + .55);
        o2.connect(g2); g2.connect(ctx.destination);
        o2.start(t); o2.stop(t + .6);
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
    refs.buildingList = $id('building-list');
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
    // 面板按钮统一事件委托（document 级）：元素被任何方式重建/替换都不会丢绑定
    document.addEventListener('click', (e) => {
      const t = e.target.closest('#btn-market, #btn-friends, #btn-help, #btn-codex, #btn-pillhouse, #btn-settings');
      if (!t) return;
      if (t.id === 'btn-market') showMarket();
      else if (t.id === 'btn-friends') showFriends();
      else if (t.id === 'btn-help') showHelpPanel();
      else if (t.id === 'btn-codex') showCodex();
      else if (t.id === 'btn-pillhouse') showPillHouse();
      else if (t.id === 'btn-settings') showSettings();
    });
    refs.logList = $id('log-list');
    refs.permList = $id('perm-list');
    refs.buffBar = $id('buff-bar');
    refs.llmDot = $id('llm-dot');
    refs.forewarn = $id('forewarn');
    refs.modalRoot = $id('modal-root');
    refs.toastRoot = $id('toast-root');
    refs.topbar = $id('topbar');
    refs.tintSeason = $id('tint-season');
    refs.tintDay = $id('tint-day');
    refs.bg = $id('bg');

    // 吐纳：点击 + 按住连点（每 150ms）
    let holdTimer = null;
    const doBreath = () => {
      const r = g.LS.economy.breath();
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
      if (g.LS.economy.servePill()) { sfx('guqin'); toast('丹药入腹，灵机鼓荡（60 秒 ×2）'); }
      else toast('暂时无法服丹（无丹药或冷却中）');
      renderAll();
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
  function renderResources() {
    const s = g.LS.S;
    const eco = g.LS.economy;
    for (const res in refs.resRows) {
      const r = refs.resRows[res];
      // 丹药行显示细分库存总数（各品类丹药之和）
      const v = res === 'danyao' && eco.pillTotal ? eco.pillTotal() : (s.resources[res] || 0);
      const str = fmtSafe(v);
      if (lastStr['v_' + res] !== str) {
        if (lastStr['v_' + res] !== undefined) {
          r.val.classList.add('tick-flash');
          setTimeout(((el) => () => el.classList.remove('tick-flash'))(r.val), 180);
          popIfMilestone(r.val, v); // 跨整千/整万弹跳
        }
        r.val.textContent = str;
        lastStr['v_' + res] = str;
      }
      const rate = eco.computePerSecond(res);
      const rStr = rate > 0 ? fmtSafe(rate) + '/秒' : '';
      if (lastStr['r_' + res] !== rStr) { r.rate.textContent = rStr; lastStr['r_' + res] = rStr; }
    }
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
      const detail = BUFF_DETAIL[b.id] || { name: label, txt: '' };
      chip.title = detail.name + '：' + detail.txt + '（剩 ' + left + ' 秒）';
      const multTxt = (b.mult && b.mult > 1 ? '×' + b.mult.toFixed(1) + ' ' : '') + (b.click_mult ? '点击×' + b.click_mult.toFixed(0) + ' ' : '');
      chip.textContent = (detail.badge || label) + ' ' + multTxt + left + 's';
      refs.buffBar.appendChild(chip);
    }
  }

  /* ── 建筑面板（结构只在解锁/购买时重建） ── */
  function buildingUnlockSig() {
    return g.LS.BAL.buildings.map(b => b.id + ':' + (g.LS.S.buildings[b.id] || 0) + ':' + (b.unlock_realm <= g.LS.S.realm.index ? 1 : 0)).join(',');
  }

  function renderBuildings() {
    const bal = g.LS.BAL, s = g.LS.S, eco = g.LS.economy;
    const sig = buildingUnlockSig();
    const structureChanged = sig !== buildingSig;
    if (structureChanged) {
      buildingSig = sig;
      refs.buildingList.innerHTML = '';
      lastStr.bbtn = {};
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
      const txt = (lv === 0 ? '建造' : '升级') + ' · ' + eco.costText(cost);
      if (lastStr.bbtn[b.id] !== txt) { btn.textContent = txt; lastStr.bbtn[b.id] = txt; }
      // B3 首次买得起：登记 + toast 一次建议（tooltip 从此刻起追加建议行）
      if (ok && !(s.first_afford_seen || {})[b.id]) {
        if (!s.first_afford_seen) s.first_afford_seen = {};
        s.first_afford_seen[b.id] = true;
        const sug = (bal.help && bal.help.building_suggest) || {};
        if (sug[b.id] && lv === 0) toast('【' + b.name + '】' + sug[b.id], 4600);
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
      const dStr = stage + rootTxt + '　道心 ' + (s.dao_heart > 0 ? '+' : '') + s.dao_heart + (tier ? ' · ' + tier.name : '');
      if (lastStr.dao !== dStr) { refs.daoHeart.textContent = dStr; lastStr.dao = dStr; }
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
      refs.xpText.textContent = '已至飞升之境';
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

  function escapeHtml(t) {
    return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ── 福泽栏 ── */
  function renderPermList() {
    const s = g.LS.S;
    const totalPct = Math.round((s.perm_bonus.all || 0) * 100);
    const names = (s.prestige.bought || []).map(id => {
      const u = g.LS.BAL.prestige.upgrades.find(x => x.id === id);
      return u ? u.name : id;
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
      const btn = document.createElement('button');
      btn.className = 'ev-option' + (opt.key === 'C' ? ' ev-leave' : '');
      // 效果方向徽章（不给数值，只给方向感）
      let badge = '';
      if (opt.slot) {
        const T = { A: ['益', 'ev-badeg-good'], B: ['耗', 'ev-badge-bad'], C: ['势', 'ev-badge-buff'], D: ['恒', 'ev-badge-perm'], E: ['缘', 'ev-badge-chain'], F: ['异', 'ev-badge-bad'] };
        const t = T[opt.slot.type];
        if (t) badge = '<span class="ev-badge ' + t[1] + '">' + t[0] + '</span>';
        if (opt.daoxin > 0) badge += '<span class="ev-badge ev-badge-good">仁</span>';
        else if (opt.daoxin < 0) badge += '<span class="ev-badge ev-badge-bad">贪</span>';
      }
      const tail = opt.key === 'C' ? '' : '（' + (opt.key === 'A' ? '其一' : '其二') + '）';
      btn.innerHTML = badge + ' ' + escapeHtml(opt.text) + tail;
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
        // 离线归来：故人候在山门外 / 弟子梦中来报——塞入事件队列随后弹出
        const visitor = g.LS.events.maybeVisitor('offline');
        if (visitor) { g.LS.S.event_state.queue.push(visitor); g.LS.S.stats.events_total += 1; }
        const dream = g.LS.events.rollDream(result.gap);
        if (dream) { g.LS.S.event_state.queue.push(dream); g.LS.S.stats.events_total += 1; }
        if (g.LS.S.event_state.queue.length) setTimeout(() => g.LS.events.pumpQueue(0), 700);
      }, 520);
    });
    card.appendChild(btn);
  }

  /* ── 突破过场 ── */
  function showBreakthroughOverlay(text, gainText, realmIdx) {
    sfx('bell');
    if (g.LS.ui.sfx) sfx('drum'); // A5 鼓点：钟鸣里垫一声低沉下扫
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
    document.body.appendChild(ov);
    const close = () => { ov.remove(); renderAll(); };
    ov.addEventListener('click', close);
    setTimeout(() => { if (ov.parentNode) close(); }, (g.LS.BAL.breakthrough && g.LS.BAL.breakthrough.anim_ms) || 1500);
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
    sfx('bell');
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
    ov.addEventListener('click', close);
    setTimeout(() => { if (ov.parentNode) close(); }, (g.LS.BAL.breakthrough && g.LS.BAL.breakthrough.anim_ms) || 1500);
  }

  /* ── 突破策略面板：稳扎稳打 / 常规 / 兵行险着 + 服丹护法 ── */
  function showBreakthroughPanel(next) {
    removeModals();
    const { card } = makeModal();
    const bal = g.LS.BAL;
    const bt = bal.breakthrough || {};
    const render = (selTactic, usePill) => {
      const base = g.LS.realm.breakthroughRate(next);
      const tactics = bt.tactics || {};
      const pill = bt.pill_guard || {};
      const novice = (g.LS.S.stats.breakthroughs || 0) < 2; // 前两次突破给新手推荐
      let rows = '';
      ['steady', 'normal', 'bold'].forEach(k => {
        const t = tactics[k];
        if (!t) return;
        let r = Math.max(0.05, Math.min(1, base + t.rate_add + (usePill && pill.rate_add ? pill.rate_add : 0)));
        const sel = selTactic === k;
        const rec = novice && k === 'normal';
        rows += '<button class="ev-option tactic-row' + (sel ? ' tactic-sel' : '') + '" data-t="' + k + '">' +
          '<span class="ev-badge ' + (t.rate_add > 0 ? 'ev-badge-good' : (t.rate_add < 0 ? 'ev-badge-bad' : 'ev-badge-buff')) + '">' + Math.round(r * 100) + '%</span> ' +
          '<b>' + escapeHtml(t.name) + '</b>' + (rec ? '<span class="ev-badge ev-badge-good">新手推荐</span>' : '') + '　' + escapeHtml(t.desc) +
          (t.reward_mult !== 1 ? '　<span class="log-gain">灵石 ×' + t.reward_mult + '</span>' : '') + '</button>';
      });
      const canPill = g.LS.economy.pillCount ? g.LS.economy.pillCount('pozhang') > 0 : false;
      card.innerHTML =
        '<div class="modal-title">冲关 · ' + escapeHtml(next.name) + '</div>' +
        '<div class="modal-desc">基础成功率 <b>' + Math.round(base * 100) + '%</b>' +
        (g.LS.S.dao_heart > (bt.dao_heart_bonus || {}).high ? '（道心加持）' : (g.LS.S.dao_heart < (bt.dao_heart_bonus || {}).low ? '（道心拖累）' : '')) +
        '　连败保底：' + (bt.pity_success || 3) + ' 次必成</div>' +
        rows +
        '<div class="set-row"><label>破障丹护法（1 颗，成功率 +' + Math.round((pill.rate_add || 0) * 100) + '%）— 丹房现有 ' + (g.LS.economy.pillCount ? g.LS.economy.pillCount('pozhang') : 0) + '</label>' +
        '<input type="checkbox" id="bt-use-pill" ' + (usePill ? 'checked' : '') + (canPill ? '' : ' disabled') + '></div>' +
        '<div class="modal-desc" style="font-size:12px;color:var(--ink-soft)">若失败：修为保留一半，可能走火入魔（全局产量减半片刻）——但连败三次必成，不必过虑。</div>' +
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
      (info.senior ? '<div class="modal-desc" style="text-align:center;color:var(--cinnabar)">大师兄凌云子前来指教——看意图、排牌序，先手夺势。</div>' : '') +
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
      '<div class="modal-desc" style="font-size:11px;color:var(--ink-soft)">每回合 3 点灵力，可连出多招；罡气护罩只保当回合。看对方意图再排牌。</div>' +
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
      '<div id="battle-intent" class="battle-intent" style="display:none"></div>' +
      '<div id="battle-log" class="battle-log"></div>' +
      '<div class="battle-qi">灵力 <span id="battle-qi-stars"></span></div>' +
      '<div id="battle-hands" class="battle-hands"></div>' +
      '<div style="text-align:center"><button class="btn-primary" id="battle-end" style="padding:8px 26px">结 束 回 合</button></div>';
    card.querySelector('#battle-end').addEventListener('click', () => { g.LS.battle.endTurn(); });
  }

  function battleLog(text) {
    const log = document.getElementById('battle-log');
    if (!log) return;
    log.insertBefore(Object.assign(document.createElement('div'), { className: 'codex-chain battle-line', textContent: text }), log.firstChild);
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
  function renderBattleHands(cards) {
    const box = document.getElementById('battle-hands');
    if (!box) return;
    box.innerHTML = cards.map(c =>
      '<button class="hand-card' + (c.disabled ? ' hand-card-off' : '') + '" data-idx="' + c.idx + '"' + (c.disabled ? ' disabled' : '') + '>' +
        '<span class="hc-cost">' + c.cost + '</span><b>' + escapeHtml(c.name) + '</b>' +
        '<span class="hc-el">' + (c.el ? escapeHtml(c.el) : '无相') + '</span>' +
        '<span class="hc-eff">' +
          (c.dmg ? '杀 ' + c.dmg : '') + (c.heal ? ' 回 ' + c.heal : '') + (c.shield ? ' 护 ' + c.shield : '') +
          (!c.dmg && !c.heal && !c.shield ? '—' : '') + '</span>' +
      '</button>'
    ).join('');
    box.querySelectorAll('.hand-card').forEach(btn => {
      btn.addEventListener('click', () => { g.LS.battle.playCard(Number(btn.dataset.idx)); });
    });
  }
  function showBattleIntent(text) {
    const box = document.getElementById('battle-intent');
    if (!box) return;
    if (!text) { box.style.display = 'none'; return; }
    box.style.display = '';
    box.textContent = text;
  }
  function showBattleResult(win, info) {
    removeModals();
    const { card, mask } = makeModal(removeModals);
    card.innerHTML =
      '<div class="modal-title">' + (win ? '斗 法 得 胜' : '斗 法 惜 败') + '</div>' +
      '<div class="modal-desc">' + (win
        ? '招式连绵，灵机压过一头——' + (info.diff >= 2 ? '以下克上，一战成名！' : (info.senior ? '大师兄颔首：拳怕少壮，后生可畏。' : '旗鼓相当，技高一筹。')) +
          '<br>论道积分 +' + info.honor
        : '招式被看穿，' + (info.senior ? '大师兄收剑：回去把功法练熟再来。' : '胜败乃修士常事，道心不坠即可。')) + '</div>' +
      '<div style="text-align:center;margin-top:10px"><button class="btn-primary" id="br-close">归 位</button></div>';
    card.querySelector('#br-close').addEventListener('click', removeModals);
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
      if (tabName === 'cards') {
        const pool = ((cul.battle_cards || {}).my_cards || []).filter(c => c.price);
        const owned = s.cards_owned || [];
        for (const c of pool) {
          const has = owned.indexOf(c.id) !== -1;
          const canBuy = !has && s.resources.lingshi >= (c.price || 0);
          rows += '<div class="rebirth-item"><div><b>' + escapeHtml(c.name) + '</b>' +
            '<span class="ev-badge ev-badge-buff">' + (KIND_NAME[c.kind] || c.kind) + (c.el && c.el !== 'root' ? '·' + escapeHtml(c.el) : '') + '</span>' +
            '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(c.desc) + '（' + c.cost + ' 灵力' +
            (c.dmg ? ' 杀' : '') + (c.shield ? ' 护' + c.shield : '') + (c.heal ? ' 回' + c.heal : '') + (c.dmg ? ' ' + c.dmg : '') + '）</div></div>' +
            '<div>' + (has ? '<span class="stamp">已 参 悟</span>'
              : '<button class="icon-btn" data-buycard="' + c.id + '" ' + (canBuy ? '' : 'disabled') + '>' + g.LS.util.fmt(c.price) + ' 灵石</button>') + '</div></div>';
        }
        rows += '<div class="modal-desc" style="font-size:11px;color:var(--ink-soft)">秘传牌参悟后，去道友录「整备卡组」编入出战（每类限带一张）。</div>';
      } else {
        const list = tabName === 'tech' ? (cul.techniques || []) : (cul.weapons || []);
        const ownedArr = tabName === 'tech' ? (s.techniques_owned || []) : (s.weapons_owned || []);
        const equipped = tabName === 'tech' ? s.equip.technique : s.equip.weapon;
        for (const it of list) {
          const owned = ownedArr.indexOf(it.id) !== -1;
          const equippedNow = equipped === it.id;
          const canBuy = !owned && s.resources.lingshi >= (it.price || 0);
          rows += '<div class="rebirth-item"><div><b>' + escapeHtml(it.name) + '</b>' +
            '<span class="ev-badge ev-badge-buff">' + escapeHtml(it.grade) + '·' + escapeHtml(it.element) + '</span>' +
            (it.rare_only ? '<span class="ev-badge ev-badge-chain">珍稀</span>' : '') +
            '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(it.desc) +
            (it.sharp ? '<br>锋锐 ' + it.sharp : '') + '</div></div>' +
            '<div>' + (owned
              ? (equippedNow ? '<span class="stamp">装 备 中</span>' : '<button class="icon-btn" data-equip="' + it.id + '" data-kind="' + tabName + '">装备</button>')
              : '<button class="icon-btn" data-buy="' + it.id + '" data-kind="' + tabName + '" ' + (canBuy ? '' : 'disabled') + '>' + g.LS.util.fmt(it.price) + ' 灵石</button>') + '</div></div>';
        }
      }
      card.innerHTML =
        '<div class="modal-title">坊 市<button class="icon-btn" id="mk-close" style="float:right;font-size:12px;padding:3px 12px">离 开</button></div>' +
        '<div class="modal-desc">灵石 <b>' + g.LS.util.fmt(s.resources.lingshi) + '</b>　·　斗法用的兵器、功法与秘传牌在此置办——五行相克，未必越贵越好。</div>' +
        '<div class="set-row" style="justify-content:center">' +
        '<button class="icon-btn" data-tab="weapon" style="' + (tabName === 'weapon' ? 'border-color:var(--cinnabar);color:var(--cinnabar)' : '') + '">兵 器</button>' +
        '<button class="icon-btn" data-tab="tech" style="' + (tabName === 'tech' ? 'border-color:var(--cinnabar);color:var(--cinnabar)' : '') + '">功 法</button>' +
        '<button class="icon-btn" data-tab="cards" style="' + (tabName === 'cards' ? 'border-color:var(--cinnabar);color:var(--cinnabar)' : '') + '">秘 传</button></div>' +
        rows;
      card.querySelector('#mk-close').addEventListener('click', removeModals);
      card.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => render(b.dataset.tab)));
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
        g.LS.save.save();
      }));
      card.querySelectorAll('[data-equip]').forEach(btn => btn.addEventListener('click', () => {
        if (btn.dataset.kind === 'tech') s.equip.technique = btn.dataset.equip;
        else s.equip.weapon = btn.dataset.equip;
        sfx('click');
        toast('已装备');
        render(btn.dataset.kind);
        g.LS.save.save();
      }));
    };
    render('weapon');
  }

  /* ── 卡组整备（皇室战争式）：四类各选 1 张出战，只能从已参悟的牌里挑 ── */
  function showDeckEditor() {
    removeModals();
    const { card } = makeModal(removeModals);
    const s = g.LS.S;
    const pool = ((g.LS.BAL.cultivation || {}).battle_cards || {}).my_cards || [];
    const KINDS = g.LS.battle.KINDS;
    const KIND_NAME = g.LS.battle.KIND_NAME;
    const owned = () => s.cards_owned || [];
    const render = () => {
      let cols = '';
      for (const kind of KINDS) {
        const inDeck = (s.deck || []).find(id => { const c = pool.find(x => x.id === id); return c && c.kind === kind; });
        let items = '';
        for (const c of pool.filter(x => x.kind === kind)) {
          const has = g.LS.battle.ownsCard(c);
          const locked = c.unlock_realm && s.realm.index < c.unlock_realm;
          const activeNow = inDeck === c.id;
          if (!has) {
            items += '<div class="deck-card deck-card-locked"><b>' + escapeHtml(c.name) + '</b><span>' +
              (locked ? '境界「' + ((g.LS.BAL.realms[c.unlock_realm] || {}).name || '?') + '」解锁' : (c.price ? '坊市秘传可参悟' : '尚未参悟')) + '</span></div>';
          } else {
            items += '<button class="deck-card' + (activeNow ? ' deck-card-on' : '') + '" data-pick="' + c.id + '">' +
              '<b>' + escapeHtml(c.name) + '</b><span>' + c.cost + '灵力 ' +
              (c.dmg ? '杀' + c.dmg : '') + (c.shield ? '护' + c.shield : '') + (c.heal ? '回' + c.heal : '') +
              (c.el && c.el !== 'root' ? ' · ' + escapeHtml(c.el) : (c.el === 'root' ? ' · 随灵根' : '')) + '</span></button>';
          }
        }
        cols += '<div class="deck-col"><div class="deck-kind">' + (KIND_NAME[kind] || kind) + '</div>' + items + '</div>';
      }
      const deckDesc = (s.deck || []).map(id => { const c = pool.find(x => x.id === id); return c ? c.name : ''; }).filter(Boolean).join('、') || '基础套（各类默认招式）';
      card.innerHTML =
        '<div class="modal-title">整 备 卡 组<button class="icon-btn" id="dk-close" style="float:right;font-size:12px;padding:3px 12px">合 上</button></div>' +
        '<div class="modal-desc">斗法四类招式，每类限带一张、只能从已参悟的里面挑。当前出战：' + escapeHtml(deckDesc) + '</div>' +
        '<div class="deck-row">' + cols + '</div>' +
        '<div style="text-align:center;margin-top:8px"><button class="btn-primary" id="dk-save" style="padding:7px 26px">定 编</button> ' +
        '<button class="icon-btn" id="dk-reset">恢复基础套</button></div>';
      card.querySelector('#dk-close').addEventListener('click', removeModals);
      card.querySelector('#dk-save').addEventListener('click', () => {
        g.LS.save.save();
        toast('卡组已定编：' + ((s.deck || []).length ? '自定义' : '基础套'));
        removeModals();
      });
      card.querySelector('#dk-reset').addEventListener('click', () => { s.deck = []; g.LS.save.save(); toast('已恢复基础套'); render(); });
      card.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', () => {
        const id = btn.dataset.pick;
        const c = pool.find(x => x.id === id);
        if (!c) return;
        s.deck = (s.deck || []).filter(did => { const d = pool.find(x => x.id === did); return !d || d.kind !== c.kind; });
        s.deck.push(id);
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
        '<div class="set-row" style="justify-content:center;gap:8px"><button class="btn-primary" id="fr-duel-senior" style="padding:6px 16px">挑战大师兄</button><button class="icon-btn" id="fr-deck" style="padding:6px 12px">整备卡组</button><button class="icon-btn" id="fr-duel-join" style="padding:6px 12px;display:none">加入约战</button></div>' +
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
          if (f) { removeModals(); g.LS.battle.prepareBattle(f); }
        });
      });
      // 挑战大师兄（回合制选牌人机陪练）
      card.querySelector('#fr-duel-senior').addEventListener('click', () => {
        removeModals();
        g.LS.battle.challengeSenior();
      });
      // 整备卡组（四类各带一张，皇室战争式构筑）
      card.querySelector('#fr-deck').addEventListener('click', () => {
        removeModals();
        showDeckEditor();
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
  function showPillHouse() {
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
        const total = eco.pillCount(p.id);
        const perQ = ['凡', '灵', '珍', '仙'].map(q2 => {
          const n = (s.pill_stock || {})[eco.pillStockKey ? eco.pillStockKey(p.id, q2) : p.id + '_' + q2] || 0;
          return n ? q2 + '×' + n : '';
        }).filter(Boolean).join(' ') || '无';
        rows += '<div class="rebirth-item"><div><b>' + escapeHtml(p.name) + '</b>' +
          '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(p.desc) + '<br>库存：' + perQ + '</div></div>' +
          '<button class="icon-btn" data-pill="' + p.id + '"' + (total ? '' : ' disabled') + '>服用</button></div>';
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
          // 同一种丹从低品质先服
          const order = ['凡', '灵', '珍', '仙'];
          for (const q2 of order) {
            const r = eco.consumePill(btn.dataset.pill, q2);
            if (r.ok) { sfx('click'); toast(r.msg); break; }
          }
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

  function bgmPluck(freq, when, vol) {
    const ctx = audioCtx;
    const t = when || ctx.currentTime;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1200;
    g.connect(lp); lp.connect(ctx.destination);
    const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 1.003;
    const og = ctx.createGain(); og.gain.value = 0.5;
    o1.connect(og); o2.connect(og); og.connect(g);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol || 0.045, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.01), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 120);
    const nb = ctx.createBufferSource(); nb.buffer = buf;
    const ng = ctx.createGain(); ng.gain.value = 0.03;
    nb.connect(ng); ng.connect(lp);
    o1.start(t); o2.start(t); nb.start(t);
    o1.stop(t + 1.9); o2.stop(t + 1.9);
  }

  function bgmXiao(when) {
    const ctx = audioCtx;
    const t = when;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 293.66;
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
    if (on) { if (!bgmTimer) { bgmTimer = setInterval(bgmStep, 800); bgmStep(); } }
    else { clearInterval(bgmTimer); bgmTimer = null; }
  }

  /* ── 设置面板 ── */
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
      '<div class="set-row"><label>古琴（环境曲，留白即曲）</label><input type="checkbox" id="set-music" ' + (s.settings.music ? 'checked' : '') + '></div>' +
      '<div class="set-row"><label>LLM 动态奇遇</label><input type="checkbox" id="set-llm" ' + (s.settings.llm_enabled ? 'checked' : '') + '></div>' +
      '<div class="set-llm-status">奇遇文案由火山方舟免费额度生成；不填或额度耗尽时自动改用内置事件池，游戏始终完整可玩，绝不产生任何费用。</div>' +
      '<div class="set-row"><label>密钥（写入 config.json）</label><input class="set-input" id="set-key" type="password" placeholder="粘贴 ark_api_key"><button class="btn-primary" id="set-key-save">保存</button></div>' +
      '<div class="set-row"><button class="icon-btn" id="set-retry-llm">重试 LLM</button><button class="icon-btn" id="set-savenow">立即存档</button></div>' +
      '<div class="set-row"><label>导出存档</label><button class="icon-btn" id="set-export">生成文本</button></div>' +
      '<textarea class="set-textarea" id="set-io" placeholder="导出后复制保存；导入时粘贴至此"></textarea>' +
      '<div class="set-row"><label>导入存档</label><button class="icon-btn" id="set-import">读取文本</button></div>' +
      '<div class="danger-zone set-row"><label>重置游戏（长按 3 秒）</label><button id="btn-reset"><span class="hold-fill"></span>长按重置</button></div>';

    bindDiff(); // 难度三选按钮事件（需在 innerHTML 渲染后绑定）
    card.querySelector('#set-sound').addEventListener('change', (e) => { s.settings.sound = e.target.checked; g.LS.save.save(); });
    card.querySelector('#set-music').addEventListener('change', (e) => {
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
        rows += '<div class="rebirth-item' + (bought ? ' bought' : '') + '">' +
          '<div><b>' + escapeHtml(u.name) + '</b><div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(u.desc) + '</div></div>' +
          '<div>' + (bought
            ? '<span class="stamp">已承</span>'
            : '<span style="font-size:12px;margin-right:6px">' + u.cost + ' 点</span>') +
          (bought ? '' : '<button class="icon-btn" data-up="' + u.id + '" ' + (st === 'ok' ? '' : 'disabled') + '>兑换</button>') + '</div></div>';
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
  function toast(msg, dur) {
    // 顶栏换行变高时动态下移提示条，保证永不遮挡资源栏
    if (refs.topbar && refs.toastRoot) {
      refs.toastRoot.style.top = (refs.topbar.offsetHeight + 18) + 'px';
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    refs.toastRoot.appendChild(el);
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
      ctx.fillStyle = 'rgba(61, 90, 108, ' + alphas[layer] + ')';
      ctx.fill();
    }
  }

  /* ── 总渲染 ── */
  function renderAll() {
    if (!g.LS.S || !g.LS.BAL) return;
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
    showEventModal, closeEventModal, showOfflinePopup, showBreakthroughOverlay, showFailOverlay,
    showSettings, showRebirthPanel, showTutorial, showPillHouse, showHelpPanel, showMarket, showFriends, showDeckEditor,
    showBattleArena, updateBattleHP, updateBattleShields, updateBattleQi, renderBattleHands, showBattleIntent,
    showBattleScreen, battleLog, battleAppend, showBattleResult,
    toast, tweenNumber, setBgm,
    setLLMStatus, setForewarn, updateBuffBar, drawBg, sfx, playTribulation,
  };
})(typeof window !== 'undefined' ? window : globalThis);
