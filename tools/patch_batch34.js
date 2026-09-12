/* patch_batch34.js —— 批三批四接线：quest/disciple/heirloom/引导（用后即删） */
'use strict';
const fs = require('fs');
let n = 0;
const rep = (file, a, b, tag) => {
  let s = fs.readFileSync(file, 'utf8');
  if (!s.includes(a)) { console.error('✗ ' + tag); process.exit(1); }
  s = s.replace(a, b);
  fs.writeFileSync(file, s);
  n++;
};

/* 1) index.html：script + 右栏主线/传承按钮 + story 加载 */
rep('index.html', '<script src="js/market.js"></script>',
  `<script src="js/quest.js"></script>
<script src="js/market.js"></script>`, 'script-quest');
rep('index.html',
  `<div class="set-row" style="gap:6px"><button id="btn-trial" class="icon-btn" style="flex:1">试 炼 塔</button><button id="btn-codexpage" class="icon-btn" style="flex:1">体 系</button><button id="btn-xinmo" class="icon-btn" style="flex:1">邪 修</button></div>`,
  `<div class="set-row" style="gap:6px"><button id="btn-quest" class="btn-primary" style="flex:1">主 线</button><button id="btn-disciple" class="btn-primary" style="flex:1">传 承</button></div>
  <div class="set-row" style="gap:6px"><button id="btn-trial" class="icon-btn" style="flex:1">试 炼 塔</button><button id="btn-codexpage" class="icon-btn" style="flex:1">体 系</button><button id="btn-xinmo" class="icon-btn" style="flex:1">邪 修</button></div>`, 'quest-btn');
rep('js/boot.js',
  `          try {
            const r7 = await fetch('./data/levels.json');
            if (r7.ok) balance.levels = (await r7.json());
          } catch (e) {}`,
  `          try {
            const r7 = await fetch('./data/levels.json');
            if (r7.ok) balance.levels = (await r7.json());
          } catch (e) {}
          try {
            const r8 = await fetch('./data/story.json');
            if (r8.ok) balance.story = (await r8.json());
          } catch (e) {}`, 'story-load');

/* 2) state.js：主线/弟子/代际/传承加成字段 */
rep('js/state.js',
  `      xinmo: 0,`,
  `      xinmo: 0,
      mainquest: { ch: 0, idx: 0, claimed: 0, done: false },
      disciple: null,
      generation: 0,
      heirloom: null,
      generation_chosen: false,`, 'state-fields');

/* 3) tick.js：每秒主线 poll + 弟子成长 + 转正判定 */
rep('js/tick.js',
  `    if (eco.hasPrestige('hushenfu')) eff += 0.10;`,
  `    if (eco.hasPrestige('hushenfu')) eff += 0.10; // （旧档兼容）`, 'tick-anchor-keep');
rep('js/tick.js',
  `  function startLoop() {`,
  `  /** 每秒轻量钩子：主线任务检查 + 弟子成长 + 转正判定 */
  function questTick() {
    try {
      if (g.LS.quest) {
        if (g.LS.quest.poll() && g.LS.ui && g.LS.ui.toast) {
          const cur = g.LS.quest.current();
          if (cur && cur.type === 'task') g.LS.ui.toast('【主线】任务达成：' + cur.task.desc + '——去主线页领取奖励。', 4200);
        }
        g.LS.quest.tickDisciple();
        const s = g.LS.S;
        if (s.disciple && s.disciple.agent && s.disciple.realm >= 4 && !s.generation_chosen && g.LS.ui && g.LS.ui.showGenerationChoice) {
          s.generation_chosen = true;
          g.LS.ui.showGenerationChoice();
        }
      }
    } catch (e) {}
  }

  function startLoop() {`, 'tick-quest');
// 找 tick 循环体插入 questTick()——锚点用 startLoop 内已有节奏调用（保守：1 秒 interval 处）
rep('js/tick.js',
  `    setInterval(() => g.LS.llm.checkHealth(), 60000);`,
  `    setInterval(() => g.LS.llm.checkHealth(), 60000);
    setInterval(questTick, 1000);`, 'tick-interval');

/* 4) ui.js：主线面板 + 传承面板 + 转正四选一 + 新手引导 + heirloom */
rep('js/ui.js',
  `  /* ── 页面注册：地图 / 丹房 / 市场（page.js 路由） ── */`,
`  /* ── 主线面板：当前章任务 + 领奖 + 剧情 ── */
  function showQuest() {
    removeModals();
    const { card } = makeModal(removeModals);
    const render = () => {
      const st = g.LS.quest.state();
      const chapters = (g.LS.BAL.story || {}).chapters || [];
      const cur = g.LS.quest.current();
      let html = '<div class="modal-title">主 线 · 掌 门 之 路<button class="icon-btn" id="q-close" style="float:right;font-size:12px;padding:3px 12px">合 上</button></div>';
      if (!cur) { html += '<div class="modal-desc">主线已全部完成——灵山万年，代代掌门。</div>'; }
      else {
        const ch = cur.chapter;
        html += '<div class="modal-desc"><b>第' + '一二三四五六七八九十'[ch.idx] + '章 · ' + escapeHtml(ch.name.split('·')[1] || ch.name) + '</b>' +
          '（第 ' + (st.ch + 1) + '/' + chapters.length + ' 章）<br><span style="font-size:11.5px;color:var(--ink-soft)">' + escapeHtml(ch.intro) + '</span></div>';
        html += '<div style="margin:8px 0">';
        for (const [i, t] of ch.tasks.entries()) {
          const done = i < st.idx || (i === st.idx && st.claimed);
          const currentT = i === st.idx && !st.claimed;
          html += '<div class="rebirth-item' + (done ? ' bought' : '') + '" style="' + (currentT ? 'border-color:var(--cinnabar)' : '') + '"><div>' +
            '<b>' + (done ? '✓ ' : currentT ? '▸ ' : '　') + escapeHtml(t.desc) + '</b>' +
            (t.reward && t.reward.lingshi ? '<span style="font-size:11px;color:var(--gold,#e8c34a)">　灵石 +' + g.LS.util.fmt(t.reward.lingshi) + '</span>' : '') +
            (done || currentT ? '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(t.story || '') + '</div>' : '') + '</div>' +
            (currentT && st.claimed ? '<button class="btn-primary" id="q-claim" style="padding:5px 16px">领 奖</button>' : '') +
            '</div>';
        }
        html += '</div>';
        if (st.idx >= ch.tasks.length) {
          html += '<div class="modal-desc" style="border:1px dashed rgba(192,57,43,.4);border-radius:8px"><b>章末</b><br>' + escapeHtml(ch.outro) + '</div>' +
            '<div style="text-align:center"><button class="btn-primary" id="q-claim" style="padding:7px 24px">开启下一章</button></div>';
        }
      }
      card.innerHTML = html;
      card.querySelector('#q-close')?.addEventListener('click', removeModals);
      card.querySelector('#q-claim')?.addEventListener('click', () => {
        const r = g.LS.quest.claim();
        if (r) {
          toast((r.gainText ? r.gainText + '　' : '') + (r.chapter ? escapeHtml(r.chapter.outro).slice(0, 0) : ''), 3000);
          if (r.gainText) toast(r.gainText);
          if (r.chapter) toast('【' + r.chapter.name + '】' + r.chapter.outro, 6000);
        }
        render();
        renderAll();
      });
    };
    render();
  }

  /* ── 传承面板：亲传弟子 / 投喂 / 代际 ── */
  function showDisciple() {
    removeModals();
    const { card } = makeModal(removeModals);
    const render = () => {
      const s = g.LS.S;
      const d = s.disciple;
      let html = '<div class="modal-title">传 承 · 掌 门 亲 传<button class="icon-btn" id="d-close" style="float:right;font-size:12px;padding:3px 12px">合 上</button></div>';
      html += '<div class="modal-desc">第 ' + ((s.generation || 0) + 1) + ' 代掌门 · 历代传承加成：' + (s.heirloom ? Object.keys(s.heirloom).length + ' 项生效' : '尚无（转正后选定）') + '</div>';
      if (!d || !d.recruited) {
        html += '<div class="modal-desc">尚未收徒——推进主线「第一章·开山立派」，首位亲传弟子将叩山门。</div>';
      } else {
        const cap = s.realm.index;
        const pct = Math.floor(d.progress || 0);
        html += '<div class="rebirth-item"><div><b>亲传弟子</b>' + (d.agent ? '<span class="ev-badge ev-badge-buff">代理掌门</span>' : '') +
          '<div style="font-size:11px;color:var(--ink-soft)">境界 ' + escapeHtml((g.LS.BAL.realms[d.realm] || {}).name || '练气') +
          '（跟随掌门，上限当前境界）· 投喂加速 ' + (d.fed || 0) + ' 颗</div>' +
          '<div class="bh-hp" style="margin-top:6px"><div class="bh-fill" style="width:' + pct + '%"></div></div>' +
          '<div style="font-size:10.5px;color:var(--ink-soft)">成熟度 ' + pct + '% / 100%——每满 10% 升一小境；自动成长 ' + (0.02 * (s.realm.index + 1) * (d.agent ? 2 : 1) * 60).toFixed(1) + '%/分钟</div></div></div>';
        html += '<div class="modal-desc" style="font-size:11px">投喂丹药加速弟子成长（劣+0.5% 凡+1% 灵+2% 珍+4% 仙+8%）——从丹房选丹，这里一键喂库存最优：</div>';
        html += '<div style="text-align:center"><button class="btn-primary" id="d-feed" style="padding:7px 22px">投喂一颗库存丹（按仙→劣优先）</button></div>';
      }
      if (d && d.agent) html += '<div class="modal-desc" style="margin-top:8px"><b>太上长老纪要</b><br>你已传位垂帘。弟子升至化神大圆满时，将触发「代际传承」四选一。</div>';
      card.innerHTML = html;
      card.querySelector('#d-close')?.addEventListener('click', removeModals);
      card.querySelector('#d-feed')?.addEventListener('click', () => {
        const order = ['仙', '珍', '灵', '凡', '劣'];
        const stock = s.pill_stock || {};
        let done = null;
        for (const q of order) {
          for (const key of Object.keys(stock)) {
            if (key.endsWith('_' + q) && stock[key] > 0) {
              const id = key.slice(0, -(q.length + 1));
              done = g.LS.quest.feedDisciple(id, q);
              break;
            }
          }
          if (done && done.ok) break;
        }
        if (!done) done = { ok: false, msg: '丹房无丹可喂' };
        toast(done.msg);
        if (done.ok) { sfx('guqin'); render(); }
      });
    };
    render();
  }

  /* ── 代际传承四选一（转正：新掌门开局，结局加成保一世） ── */
  function showGenerationChoice() {
    removeModals();
    const { card } = makeModal(null);
    card.innerHTML =
      '<div class="modal-title" style="color:var(--cinnabar)">代 际 传 承</div>' +
      '<div class="modal-desc">代理掌门已至化神大圆满，灵山要交出去了。你以什么身份注视新一代？——结局决定下一代的起点。</div>' +
      '<div class="senior-row">' +
      [{ k: 'keep', n: '继续当掌门', d: '灵山不可一日无主', bonus: '下一代初始灵气 +20%，传承点 +10%' },
       { k: 'elder', n: '成为太上长老', d: '垂帘听政，扶一代又一代', bonus: '下一代修为速度 +8%，灵根概率 +15%' },
       { k: 'wander', n: '云游四海', d: '天地为庐，处处是山门', bonus: '下一代奇遇仙品 +2、频率 +10%，传承点 +15%' },
       { k: 'seclude', n: '闭关不出', d: '一闭关，山外已百年', bonus: '下一代点击产量 +15%，突破成功率 +3%' }
      ].map(o => '<button class="senior-tier" data-gen="' + o.k + '"><b>' + o.n + '</b><span class="st-desc">' + o.d + '</span><span class="st-rel">' + o.bonus + '</span></button>').join('') +
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
      s.disciple = { recruited: true, progress: 0, realm: 0, agent: false, fed: 0 }; // 新一代重新收徒
      g.LS.save.save();
      toast('【代际传承】新一代掌门继位——结局加成将伴随后代一世。', 5200);
      g.LS.realm.doRebirth(true);
      removeModals();
      renderAll();
    }));
  }

  /* ── 新手引导（首次 5 步，可跳过可重看） ── */
  function showTutorialSteps() {
    const steps = [
      { t: '吐 纳', d: '点击「吐纳」聚灵气；长按可持续加速——灵气是万物的根。' },
      { t: '资 源', d: '灵气→修为（自动吞吐）→突破境界；灵石来自坊市与灵田，丹药出自丹炉。' },
      { t: '突 破', d: '修为攒满点「突破」——金丹起有雷劫，失败会走火甚至殒命，备好保命装。' },
      { t: '丹房与地图', d: '右栏「地图」进丹房服丹、市场做买卖；地图是灵山全部去处。' },
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
        (i < steps.length - 1 ? '<button class="btn-primary" id="tu-next" style="padding:7px 22px">下一步</button>' : '<button class="btn-primary" id="tu-next" style="padding:7px 22px">开始修行</button>') + '</div>';
      card.querySelector('#tu-skip')?.addEventListener('click', finish);
      card.querySelector('#tu-next')?.addEventListener('click', () => { i += 1; if (i >= steps.length) finish(); else render(); });
    };
    const finish = () => {
      try { localStorage.setItem('lingshan_tutorial_done', '1'); } catch (e) {}
      removeModals();
    };
    render();
  }

  /* ── 页面注册：地图 / 丹房 / 市场（page.js 路由） ── */`, 'quest-ui');
rep('js/ui.js',
  'playEmperorTribulation, showTrial, showXinmo, showAmbushModal,',
  'playEmperorTribulation, showTrial, showXinmo, showAmbushModal, showQuest, showDisciple, showGenerationChoice, showTutorialSteps,', 'export-34');

fs.writeFileSync('js/ui.js', s);
console.log('批三批四补丁完成，替换 ' + n + ' 处');
