/* patch_pages2.js —— 仅 ui.js 四处（用后即删） */
'use strict';
const fs = require('fs');
let s = fs.readFileSync('js/ui.js', 'utf8');
let n = 0;
const rep = (a, b, tag) => { if (!s.includes(a)) { console.error('✗ ' + tag); process.exit(1); } s = s.replace(a, b); n++; };
rep("const t = e.target.closest('#btn-market, #btn-friends, #btn-help, #btn-codex, #btn-pillhouse, #btn-settings, #btn-codexpage, #btn-trial, #btn-xinmo');",
    "const t = e.target.closest('#btn-market, #btn-friends, #btn-help, #btn-codex, #btn-pillhouse, #btn-settings, #btn-codexpage, #btn-trial, #btn-xinmo, #btn-map, #btn-quest, #btn-disciple');", 'delegation');
rep(`      if (t.id === 'btn-market') showMarket();
      else if (t.id === 'btn-friends') showFriends();`,
`      if (t.id === 'btn-market') showMarket();
      else if (t.id === 'btn-map') g.LS.page.go('map');
      else if (t.id === 'btn-quest') showQuest();
      else if (t.id === 'btn-disciple') showDisciple();
      else if (t.id === 'btn-friends') showFriends();`, 'handlers');
rep(`  function showPillHouse() {
    removeModals();
    const { card } = makeModal(removeModals);
    const eco = g.LS.economy;
    const render = () => {`,
`  function showPillHouse() { g.LS.page.go('dannfang'); }
  function showPillHouseModal() {
    removeModals();
    const { card } = makeModal(removeModals);
    const eco = g.LS.economy;
    const render = () => {`, 'pillhouse');
rep(`  /* ── 邪修面板：劫掠/血祭/黑市（心魔≥30 解锁） ── */`,
`  /* ── 页面注册：地图 / 丹房 / 市场（page.js 路由） ── */
  function registerPages() {
    if (!g.LS.page || g.LS.page._registered) return;
    g.LS.page._registered = true;
    g.LS.page.register('map', { title: '灵 山 舆 图', render: () => {
      const spots = [
        { id: 'dannfang', name: '丹 房', x: 30, y: 38, desc: '炼丹服丹 · 丹毒调理' },
        { id: 'market', name: '市 场', x: 62, y: 60, desc: '灵石买卖 · 散修集市' },
        { id: 'l1', name: '？', x: 74, y: 26, locked: true },
        { id: 'l2', name: '？', x: 18, y: 68, locked: true },
        { id: 'l3', name: '？', x: 52, y: 14, locked: true },
        { id: 'l4', name: '？', x: 84, y: 80, locked: true }
      ];
      const spotHtml = spots.map(sp => sp.locked
        ? '<div class="map-spot locked" style="left:' + sp.x + '%;top:' + sp.y + '%"><div class="ms-icon">？</div><span>待开化</span></div>'
        : '<button class="map-spot" data-spot="' + sp.id + '" style="left:' + sp.x + '%;top:' + sp.y + '%"><div class="ms-icon">' + escapeHtml(sp.name[0]) + '</div><span>' + escapeHtml(sp.name) + '</span><i>' + escapeHtml(sp.desc) + '</i></button>'
      ).join('');
      return '<div class="map-canvas">' +
        '<svg viewBox="0 0 390 620" preserveAspectRatio="xMidYMid slice" class="map-svg">' +
          '<path d="M0,120 Q80,40 160,110 T390,90 L390,0 L0,0 Z" fill="rgba(70,92,110,.18)"/>' +
          '<path d="M0,190 Q120,90 230,170 T390,150 L390,60 L0,60 Z" fill="rgba(70,92,110,.13)"/>' +
          '<path d="M-10,610 Q90,470 200,560 T400,520 L400,640 L-10,640 Z" fill="rgba(60,82,100,.20)"/>' +
          '<ellipse cx="120" cy="300" rx="90" ry="16" fill="rgba(255,255,255,.10)"/>' +
          '<ellipse cx="300" cy="420" rx="110" ry="18" fill="rgba(255,255,255,.08)"/>' +
          '<path d="M120,240 Q160,320 130,430" stroke="rgba(120,100,70,.4)" stroke-width="2" stroke-dasharray="6 5" fill="none"/>' +
          '<path d="M130,430 Q220,470 244,540" stroke="rgba(120,100,70,.4)" stroke-width="2" stroke-dasharray="6 5" fill="none"/>' +
        '</svg>' + spotHtml +
        '<div class="map-note">山径所至，皆是机缘——新去处将陆续开化。</div></div>';
    }});
    g.LS.page.register('dannfang', { title: '丹 房', render: () => {
      const eco = g.LS.economy;
      const s = g.LS.S;
      const q = eco.pillQualityCfg() || { toxic_penalty: {} };
      const toxic = s.pill_toxic || 0;
      const penalty = Math.min(q.toxic_penalty.cap || 0.30, Math.floor(toxic / 10) * (q.toxic_penalty.per_10_points || 0.05));
      let rows = '';
      for (const p of ((g.LS.BAL.pills && g.LS.BAL.pills.pills) || [])) {
        const qBtns = ['劣', '凡', '灵', '珍', '仙'].map(q2 => {
          const n2 = (s.pill_stock || {})[eco.pillStockKey ? eco.pillStockKey(p.id, q2) : p.id + '_' + q2] || 0;
          if (!n2) return '';
          return '<button class="icon-btn" data-pill="' + p.id + '" data-q="' + q2 + '" style="padding:2px 8px;font-size:11px;min-height:0">' + q2 + '×' + n2 + '</button>';
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
    g.LS.page.register('market', { title: '市 场', render: () => {
      const d = g.LS.market.renderData();
      let html = '<div class="modal-desc">散修集市——价格随你的产业水涨船高。灵石 <b>' + g.LS.util.fmt(g.LS.S.resources.lingshi) + '</b></div>';
      html += '<h3 class="panel-title" style="font-size:14px">购 买</h3>';
      html += d.items.map(it =>
        '<div class="rebirth-item"><div><b>' + escapeHtml(it.name) + '</b>' +
        '<div style="font-size:11px;color:var(--ink-soft)">' + escapeHtml(it.desc) + '</div></div>' +
        '<button class="icon-btn" data-mbuy="' + it.id + '" ' + (g.LS.S.resources.lingshi >= it.price ? '' : 'disabled') + '>' + g.LS.util.fmt(it.price) + ' 灵石</button></div>').join('');
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
        const parts = btn.dataset.msellgear.split(':');
        const r = g.LS.market.sellGear(parts[0], parts[1]);
        toast(r.msg);
        if (r.ok) { sfx('click'); g.LS.page.refresh(); renderResources(); }
      }));
    }});
  }

  /* ── 邪修面板：劫掠/血祭/黑市（心魔≥30 解锁） ── */`, 'register-pages');
rep("    refs.modalRoot = $id('modal-root');",
    `    refs.modalRoot = $id('modal-root');
    registerPages();`, 'init-register');
rep(`      else if (t.id === 'btn-xinmo') showXinmo();`,
`      else if (t.id === 'btn-xinmo') showXinmo();
      else if (t.dataset && t.dataset.spot && t.closest('.map-spot')) {
        const spot = t.dataset.spot;
        if (spot === 'dannfang' || spot === 'market') g.LS.page.go(spot);
      }`, 'map-nav');
fs.writeFileSync('js/ui.js', s);
console.log('ui.js 四处+注册 OK，替换 ' + n + ' 处');
