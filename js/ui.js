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
    refs.xpFill = $id('xp-fill');
    refs.xpText = $id('xp-text');
    refs.btnBreath = $id('btn-breath');
    refs.btnBreak = $id('btn-break');
    refs.btnPill = $id('btn-pill');
    refs.btnSettings = $id('btn-settings');
    refs.btnRebirth = $id('btn-rebirth');
    refs.logList = $id('log-list');
    refs.permList = $id('perm-list');
    refs.buffBar = $id('buff-bar');
    refs.llmDot = $id('llm-dot');
    refs.forewarn = $id('forewarn');
    refs.modalRoot = $id('modal-root');
    refs.toastRoot = $id('toast-root');
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

    refs.btnBreak.addEventListener('click', () => g.LS.realm.doBreakthrough());
    refs.btnPill.addEventListener('click', () => {
      if (g.LS.economy.servePill()) { sfx('guqin'); toast('丹药入腹，灵机鼓荡（60 秒 ×2）'); }
      else toast('暂时无法服丹（无丹药或冷却中）');
      renderAll();
    });
    refs.btnSettings.addEventListener('click', showSettings);
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
          card.innerHTML =
            '<div class="b-head"><span class="b-name">' + b.name + '</span><span class="b-lv">Lv.' + (s.buildings[b.id] || 0) + '</span></div>' +
            '<div class="b-desc" data-tip="' + b.desc + '\n当前：' + rateTxt + '">' + b.desc + '</div>' +
            '<div class="b-rate">' + rateTxt + '</div>' +
            '<button class="b-buy"></button>';
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
    const realm = bal.realms[s.realm.index];
    const nameStr = realm.name;
    if (lastStr.realm !== nameStr) { refs.realmName.textContent = nameStr; lastStr.realm = nameStr; }
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
  function makeModal() {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    const card = document.createElement('div');
    card.className = 'modal-card';
    mask.appendChild(card);
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
    const { mask, card } = makeModal();
    card.classList.add('rarity-' + (ev.rarity || '凡'));
    const rarityTag = '<span class="rarity-tag">' + (ev.rarity || '凡') + '</span>';
    card.innerHTML =
      '<div class="modal-title">' + rarityTag + escapeHtml(ev.title) + '</div>' +
      '<div class="ev-countdown" id="ev-cd"></div>' +
      '<div class="modal-desc">' + escapeHtml(ev.desc) + '</div>';
    for (const opt of ev.options) {
      const btn = document.createElement('button');
      btn.className = 'ev-option' + (opt.key === 'C' ? ' ev-leave' : '');
      btn.textContent = opt.text + (opt.key === 'C' ? '' : '（' + (opt.key === 'A' ? '其一' : '其二') + '）');
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
    const durTxt = g.LS.util.fmtDur(result.gap);
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
      setTimeout(() => { removeModals(); if (g.LS.save) g.LS.save.save(); }, 520);
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

  /* ── 设置面板 ── */
  function showSettings() {
    removeModals();
    const { card } = makeModal();
    const s = g.LS.S;
    card.innerHTML =
      '<div class="modal-title">设 置</div>' +
      '<div class="set-row"><label>音效</label><input type="checkbox" id="set-sound" ' + (s.settings.sound ? 'checked' : '') + '></div>' +
      '<div class="set-row"><label>LLM 动态奇遇</label><input type="checkbox" id="set-llm" ' + (s.settings.llm_enabled ? 'checked' : '') + '></div>' +
      '<div class="set-llm-status">奇遇文案由火山方舟免费额度生成；不填或额度耗尽时自动改用内置事件池，游戏始终完整可玩，绝不产生任何费用。</div>' +
      '<div class="set-row"><label>密钥（写入 config.json）</label><input class="set-input" id="set-key" type="password" placeholder="粘贴 ark_api_key"><button class="btn-primary" id="set-key-save">保存</button></div>' +
      '<div class="set-row"><button class="icon-btn" id="set-retry-llm">重试 LLM</button><button class="icon-btn" id="set-savenow">立即存档</button></div>' +
      '<div class="set-row"><label>导出存档</label><button class="icon-btn" id="set-export">生成文本</button></div>' +
      '<textarea class="set-textarea" id="set-io" placeholder="导出后复制保存；导入时粘贴至此"></textarea>' +
      '<div class="set-row"><label>导入存档</label><button class="icon-btn" id="set-import">读取文本</button></div>' +
      '<div class="danger-zone set-row"><label>重置游戏（长按 3 秒）</label><button id="btn-reset"><span class="hold-fill"></span>长按重置</button></div>';

    card.querySelector('#set-sound').addEventListener('change', (e) => { s.settings.sound = e.target.checked; g.LS.save.save(); });
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
    showSettings, showRebirthPanel, showTutorial, toast, tweenNumber,
    setLLMStatus, setForewarn, updateBuffBar, drawBg, sfx
  };
})(typeof window !== 'undefined' ? window : globalThis);
