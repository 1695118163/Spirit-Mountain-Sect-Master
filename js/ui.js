/**
 * ui.js —— DOM 引用缓存与定向脏更新、数字动画、弹窗/浮层、设置面板、水墨 Canvas 背景、WebAudio 音效。
 * 渲染策略：缓存引用 + 脏比对，绝不做每秒整树 innerHTML。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const refs = {};
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
    refs.btnBreath = $id('btn-breath');
    refs.btnBreak = $id('btn-break');
    refs.btnPill = $id('btn-pill');
    refs.btnSettings = $id('btn-settings');
    refs.btnCodex = $id('btn-codex');
    refs.btnRebirth = $id('btn-rebirth');
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
    };
    refs.btnBreath.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      doBreath();
      clearInterval(holdTimer);
      holdTimer = setInterval(doBreath, 150);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
      refs.btnBreath.addEventListener(ev, () => clearInterval(holdTimer)));

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
    refs.btnSettings.addEventListener('click', showSettings);
    if (refs.btnCodex) refs.btnCodex.addEventListener('click', showCodex);
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

  /* ── 资源栏（脏比对） ── */
  function renderResources() {
    const s = g.LS.S;
    const eco = g.LS.economy;
    for (const res in refs.resRows) {
      const r = refs.resRows[res];
      const v = s.resources[res] || 0;
      const str = fmtSafe(v);
      if (lastStr['v_' + res] !== str) {
        if (lastStr['v_' + res] !== undefined) {
          r.val.classList.add('tick-flash');
          setTimeout(((el) => () => el.classList.remove('tick-flash'))(r.val), 180);
        }
        r.val.textContent = str;
        lastStr['v_' + res] = str;
      }
      const rate = eco.computePerSecond(res);
      const rStr = rate > 0 ? fmtSafe(rate) + '/秒' : '';
      if (lastStr['r_' + res] !== rStr) { r.rate.textContent = rStr; lastStr['r_' + res] = rStr; }
    }
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
      const label = b.id === 'pill' ? '丹力' : '灵机';
      const multTxt = b.mult && b.mult > 1 ? '×' + b.mult.toFixed(1) : (b.click_mult ? '点击×' + b.click_mult : '');
      chip.textContent = label + ' ' + multTxt + ' ' + Math.ceil((b.ts_end - now) / 1000) + 's';
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
          card.innerHTML =
            '<div class="b-head"><svg class="b-icon" viewBox="0 0 48 48"><use href="#ic-' + b.id + '"/></svg><span class="b-name">' + b.name + '</span><span class="b-lv">Lv.' + (s.buildings[b.id] || 0) + '</span></div>' +
            '<div class="b-desc" data-tip="' + b.desc + '\n当前：' + rateTxt + '">' + b.desc + '</div>' +
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
        if (document.body.classList.contains('night') !== isNight) {
          document.body.classList.toggle('night', isNight);
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
    // 道心值 + 分档（影响奇遇池、AI 基调、突破成功率）
    if (refs.daoHeart) {
      const tiers = bal.daoxin.tiers || [];
      const tier = tiers.find(t => s.dao_heart >= t.min);
      const dStr = '道心 ' + (s.dao_heart > 0 ? '+' : '') + s.dao_heart + (tier ? ' · ' + tier.name : '');
      if (lastStr.dao !== dStr) { refs.daoHeart.textContent = dStr; lastStr.dao = dStr; }
    }
    const next = bal.realms[s.realm.index + 1];
    if (next && next.need_xp) {
      const pct = Math.min(100, (s.resources.xiufu / next.need_xp) * 100);
      const fillStr = pct.toFixed(1);
      if (lastStr.xpFill !== fillStr) { refs.xpFill.style.width = fillStr + '%'; lastStr.xpFill = fillStr; }
      const txt = '修为 ' + fmtSafe(s.resources.xiufu) + ' / ' + fmtSafe(next.need_xp);
      if (lastStr.xpText !== txt) { refs.xpText.textContent = txt; lastStr.xpText = txt; }
      const can = s.resources.xiufu >= next.need_xp;
      refs.btnBreak.classList.toggle('hidden', !can);
    } else {
      refs.xpFill.style.width = '100%';
      refs.xpText.textContent = '已至飞升之境';
      refs.btnBreak.classList.add('hidden');
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
    card.classList.add('rarity-' + (ev.rarity || '凡'));
    const srcTag = ev.source === 'chain' ? '续' : (ev.source === 'visitor' ? '访' : (ev.source === 'dream' ? '梦' : null));
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
        removeModals();
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
  function showBreakthroughOverlay(text, gainText) {
    sfx('bell');
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

  /* ── 突破失败 / 走火入魔过场（暗色水墨） ── */
  function showFailOverlay(title, text, isQihuo) {
    sfx('bell');
    const ov = document.createElement('div');
    ov.id = 'breakthrough-overlay';
    ov.style.background = isQihuo ? '#2b2222' : '#3a3330'; // 走火入魔更暗
    for (let i = 0; i < 5; i++) {
      const sp = document.createElement('span');
      sp.className = 'ink-splash';
      const size = 120 + Math.random() * 260;
      sp.style.width = size + 'px';
      sp.style.height = size + 'px';
      sp.style.left = (10 + Math.random() * 80) + '%';
      sp.style.top = (10 + Math.random() * 70) + '%';
      sp.style.animationDelay = (i * 0.12) + 's';
      sp.style.background = 'radial-gradient(circle, rgba(168,50,50,.35), transparent 70%)'; // 朱砂墨渍
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
      let rows = '';
      ['steady', 'normal', 'bold'].forEach(k => {
        const t = tactics[k];
        if (!t) return;
        let r = Math.max(0.05, Math.min(1, base + t.rate_add + (usePill && pill.rate_add ? pill.rate_add : 0)));
        const sel = selTactic === k;
        rows += '<button class="ev-option tactic-row' + (sel ? ' tactic-sel' : '') + '" data-t="' + k + '">' +
          '<span class="ev-badge ' + (t.rate_add > 0 ? 'ev-badge-good' : (t.rate_add < 0 ? 'ev-badge-bad' : 'ev-badge-buff')) + '">' + Math.round(r * 100) + '%</span> ' +
          '<b>' + escapeHtml(t.name) + '</b>　' + escapeHtml(t.desc) +
          (t.reward_mult !== 1 ? '　<span class="log-gain">灵石 ×' + t.reward_mult + '</span>' : '') + '</button>';
      });
      const canPill = g.LS.S.resources.danyao >= (pill.pills || 3);
      card.innerHTML =
        '<div class="modal-title">冲关 · ' + escapeHtml(next.name) + '</div>' +
        '<div class="modal-desc">基础成功率 <b>' + Math.round(base * 100) + '%</b>' +
        (g.LS.S.dao_heart > (bt.dao_heart_bonus || {}).high ? '（道心加持）' : (g.LS.S.dao_heart < (bt.dao_heart_bonus || {}).low ? '（道心拖累）' : '')) +
        '　连败保底：' + (bt.pity_success || 3) + ' 次</div>' +
        rows +
        '<div class="set-row"><label>服丹护法（' + (pill.pills || 3) + ' 颗，成功率 +' + Math.round((pill.rate_add || 0) * 100) + '%）— 现有 ' + g.LS.S.resources.danyao + '</label>' +
        '<input type="checkbox" id="bt-use-pill" ' + (usePill ? 'checked' : '') + (canPill ? '' : ' disabled') + '></div>' +
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
    card.innerHTML =
      '<div class="modal-title">见 闻 录</div>' +
      '<div class="modal-desc">奇遇集齐 ' + got + ' / ' + g.LS.EVT.length + '　·　图鉴、因果与碑林跨转生保留</div>' +
      '<h3 class="panel-title">奇遇图鉴</h3><div class="codex-grid">' + evRows + '</div>' +
      '<h3 class="panel-title">剧情链</h3>' + chainRows +
      '<h3 class="panel-title">因果故人</h3>' + tagRows +
      '<h3 class="panel-title">碑林（山志）</h3>' + steleRows +
      '<div style="text-align:center;margin-top:12px"><button class="icon-btn" id="codex-close">合上</button></div>';
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
    const { mask, card } = makeModal(removeModals);
    const s = g.LS.S;
    card.innerHTML =
      '<div class="modal-title">设 置<button class="icon-btn" id="set-close" style="float:right;font-size:12px;padding:3px 12px">合上</button></div>' +
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
    renderChronicle, renderPermList, pushLog, markNewBuildings, isModalOpen,
    showEventModal, closeEventModal, showOfflinePopup, showBreakthroughOverlay, showFailOverlay,
    showSettings, showRebirthPanel, showTutorial, toast, tweenNumber, setBgm,
    setLLMStatus, setForewarn, updateBuffBar, drawBg, sfx
  };
})(typeof window !== 'undefined' ? window : globalThis);
