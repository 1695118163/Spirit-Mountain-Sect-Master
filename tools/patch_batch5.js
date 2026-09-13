/* patch_batch5.js —— 斗法无响应修复+快速切磋+自动吐纳拨钮+自定义BGM（用后即删） */
'use strict';
const fs = require('fs');
let total = 0;
const rep = (file, a, b, tag) => {
  let s = fs.readFileSync(file, 'utf8');
  if (!s.includes(a)) { console.error('✗ ' + tag); process.exit(1); }
  s = s.replace(a, b);
  fs.writeFileSync(file, s);
  total++;
};

/* ── A. 斗法无响应根因修复：prepareBattle 未传影子 tierCfg（v3 加参后漏配）→ buildOp 读 tierCfg.offset 崩 ── */
rep('js/battle.js',
  `  function prepareBattle(friend) {
    if (active) return;
    // 竞技门槛（乙§7）：化神以下禁与道友切磋（大师兄/试炼塔不限）
    if (S().realm.index < 4) { g.LS.ui.toast('化神方可与道友切磋——此前请以大师兄与试炼塔磨砺招式。'); return; }
    if (!friend.card) { g.LS.ui.toast('这位道友还没有递过名片'); return; }
    const my = buildMe();
    const op = buildOp(friend, false);`,
`  const SHADOW_CFG = { offset: 0, hpMult: 1, follow: 0.55, dmgAdd: 0 }; // 好友影子档（无 tier 概念，v3 参数补位）
  function prepareBattle(friend) {
    if (active) return;
    // 竞技门槛（乙§7）：化神以下禁与道友切磋（大师兄/试炼塔不限）
    if (S().realm.index < 4) { g.LS.ui.toast('化神方可与道友切磋——此前请以大师兄与试炼塔磨砺招式。'); return; }
    if (!friend.card) { g.LS.ui.toast('这位道友还没有递过名片'); return; }
    const my = buildMe();
    const op = buildOp(friend, false, SHADOW_CFG);`, 'A-shadow-cfg');

/* ── B. 快速切磋（道友录「斗法」=一键论道：判定/收益/代价/10分钟冷却/简要战报弹窗） ── */
rep('js/ui.js',
  `      card.querySelectorAll('[data-fight]').forEach(btn => {
        btn.addEventListener('click', () => {
          const f = (s.friends || [])[Number(btn.dataset.fight)];
          if (f) { removeModals(); g.LS.battle.prepareBattle(f); }
        });
      });`,
`      card.querySelectorAll('[data-fight]').forEach(btn => {
        btn.addEventListener('click', () => {
          const f = (s.friends || [])[Number(btn.dataset.fight)];
          if (!f) return;
          const r = quickDuel(f, btn);
          if (r && !r.ok && r.msg) toast(r.msg);
        });
      });`, 'quick-duel-bind');

/* quickDuel 实现（showQuest 前插入） */
rep('js/ui.js',
  `  /* ── 主线面板：当前章任务 + 领奖 + 剧情 ── */`,
`  /* ── 快速切磋（道友录「斗法」）：一键论道——CP+道心判定，10 分钟冷却，防连点刷收益 ── */
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

  /* ── 主线面板：当前章任务 + 领奖 + 剧情 ── */`, 'quick-duel-fn');

/* ── C. 自动吐纳拨钮 ── */
rep('js/state.js',
  `      xinmo: 0,`,
  `      xinmo: 0,
      auto_breath: false,`, 'state-auto');

rep('js/ui.js',
  `    refs.btnBreath.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      uiState.holdingBreath = true;
      doBreath();
      clearInterval(holdTimer);
      holdTimer = setInterval(doBreath, 150);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
      refs.btnBreath.addEventListener(ev, () => { clearInterval(holdTimer); uiState.holdingBreath = false; }));`,
`    refs.btnBreath.addEventListener('pointerdown', (e) => {
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
    }`, 'auto-breath');

/* ── D. 设置页：导入自定义背景音乐（IDB 存 Blob，刷新保留；优先于合成古琴） ── */
rep('js/ui.js',
  `      '<div class="set-row"><label>古琴（环境曲，留白即曲）</label><input type="checkbox" id="set-music" ' + (s.settings.music ? 'checked' : '') + '></div>' +`,
`      '<div class="set-row"><label>古琴（环境曲，留白即曲）</label><input type="checkbox" id="set-music" ' + (s.settings.music && !s.settings.custom_music ? 'checked' : '') + '></div>' +
      '<div class="set-row"><label>自定义背景乐</label><input type="file" id="set-bgm-file" accept="audio/*" style="max-width:170px;font-size:11px"></div>' +
      '<div class="set-row"><label>　播放自定义乐</label><input type="checkbox" id="set-custom-music" ' + (s.settings.custom_music ? 'checked' : '') + '></div>' +
      '<div class="set-row"><label>　清除导入</label><button class="icon-btn" id="set-bgm-clear">删 除</button></div>' +`, 'settings-ui');
rep('js/ui.js',
  `    render();`,
`    // 自定义背景乐：IDB 存 Blob（刷新保留），优先于合成古琴
    const idbOpen = () => new Promise((res) => {
      const rq = indexedDB.open('lingshan_bgm', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('f');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    });
    const idbSet = async (blob) => { const db = await idbOpen(); if (!db) return null; return new Promise((res) => { const tx = db.transaction('f', 'readwrite'); tx.objectStore('f').put(blob, 'bgm'); tx.oncomplete = () => res(true); }); };
    const idbGet = async () => { const db = await idbOpen(); if (!db) return null; return new Promise((res) => { const rq = db.transaction('f').objectStore('f').get('bgm'); rq.onsuccess = () => res(rq.result || null); }); };
    const idbDel = async () => { const db = await idbOpen(); if (!db) return; db.transaction('f', 'readwrite').objectStore('f').delete('bgm'); };
    const setCustomBgm = (on) => {
      s.settings.custom_music = on;
      g.LS.save.save();
      if (on) {
        idbGet().then((blob) => {
          if (!blob) { toast('尚未导入音乐文件'); s.settings.custom_music = false; g.LS.save.save(); return; }
          setBgm(false);
          if (!window.__customAudio) window.__customAudio = new Audio();
          if (window.__customAudio.src !== URL.createObjectURL) window.__customAudio.src = URL.createObjectURL(blob);
          window.__customAudio.loop = true;
          window.__customAudio.volume = 0.5;
          window.__customAudio.play().catch(() => {});
          const cb = document.getElementById('set-music'); if (cb) cb.checked = false;
          toast('自定义背景乐播放中');
        });
      } else {
        if (window.__customAudio) window.__customAudio.pause();
        if (s.settings.music) setBgm(true);
      }
    };
    const fileInput = card.querySelector('#set-bgm-file');
    if (fileInput) fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0];
      if (!f) return;
      await idbSet(f);
      s.settings.custom_music = true;
      g.LS.save.save();
      const cm = card.querySelector('#set-custom-music'); if (cm) cm.checked = true;
      setCustomBgm(true);
      toast('已导入「' + f.name + '」作为背景乐');
    });
    const cmBox = card.querySelector('#set-custom-music');
    if (cmBox) cmBox.addEventListener('change', () => setCustomBgm(cmBox.checked));
    const bgmClear = card.querySelector('#set-bgm-clear');
    if (bgmClear) bgmClear.addEventListener('click', async () => {
      await idbDel();
      s.settings.custom_music = false;
      g.LS.save.save();
      setCustomBgm(false);
      toast('已清除自定义背景乐');
      render();
    });
    render();`, 'settings-custom-bgm');

/* 合成古琴开关尊重 custom_music 优先（set-music 勾选处理处已有 setBgm——查原绑定改条件） */
rep('js/ui.js',
  `      const mb = card.querySelector('#set-music');
      if (mb) mb.addEventListener('change', () => {`,
`      const mb = card.querySelector('#set-music');
      if (mb) mb.addEventListener('change', () => {
        if (mb.checked && s.settings.custom_music) { mb.checked = false; toast('已启用自定义背景乐，如需古琴请先关闭「播放自定义乐」'); return; }`, 'set-music-guard');

fs.writeFileSync('js/ui.js', s);
console.log('批五补丁完成，替换 ' + total + ' 处');
