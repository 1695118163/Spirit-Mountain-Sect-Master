/**
 * page.js v3 —— 整屏视图制路由（View 常驻）：
 *  - 每页一个常驻 .page-view（首次进入创建，之后只切 display），切走不销毁 →
 *    滚动位置/表单/浏览状态天然保留，「返回上一页」即恢复原样；
 *  - 真 hash 路由：#/map #/dannfang #/market… 手机返回手势/浏览器返回键等效「返回上一页」；
 *  - 转场：前进=新页右滑入、旧页左滑淡出；返回=反向（0.2s，transform/opacity）；
 *  - 首页 = body 本身（无覆盖层时），回首页即关覆盖层，首页滚动位置天然保留；
 *  - 各视图内部自滚动（.page-view overflow-y:auto），视图之间绝不连滚。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const registry = {};      // id -> { title, render(), mount?(viewEl) }
  const views = {};         // id -> 常驻视图 DOM
  let current = null;       // 当前显示的视图 id（null=首页）
  let switching = false;

  function register(id, def) { registry[id] = def; }

  /** 确保视图 DOM 存在（只建一次；重建内容用 refresh） */
  function ensureView(id) {
    if (views[id]) return views[id];
    const root = document.getElementById('page-root');
    if (!root) return null;
    const def = registry[id];
    const el = document.createElement('div');
    el.className = 'page-view';
    el.dataset.view = id;
    el.innerHTML =
      '<div class="page-topbar">' +
        '<button class="icon-btn" data-nav="home">返回首页</button>' +
        '<b class="page-title">' + (def.title || id) + '</b>' +
        '<button class="icon-btn" data-nav="back">返回上一页</button></div>' +
      '<div class="page-body">' + (def.render ? def.render() : '') + '</div>';
    root.appendChild(el);
    el.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.nav === 'home') home(); else back();
    }));
    if (def.mount) def.mount(el);
    views[id] = el;
    return el;
  }

  /** 重填某视图内容（页面内操作后由页面主动调；保留 DOM 与滚动框架） */
  function refresh(id) {
    const id2 = id || current;
    if (!id2 || !views[id2] || !registry[id2]) return;
    const body = views[id2].querySelector('.page-body');
    if (!body) return;
    const keep = body.scrollTop;
    body.innerHTML = registry[id2].render ? registry[id2].render() : '';
    body.scrollTop = keep;
    views[id2].querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.nav === 'home') home(); else back();
    }));
    if (registry[id2].mount) registry[id2].mount(views[id2]);
  }

  /** 显示目标视图并转场（dir: fwd/back） */
  function show(id, dir) {
    const root = document.getElementById('page-root');
    if (!root) return;
    const el = ensureView(id);
    if (!el) return;
    const prev = current ? views[current] : null;
    root.classList.add('open');
    el.classList.add('open');
    el.style.display = '';
    if (!switching && prev && prev !== el) {
      switching = true;
      prev.classList.add(dir === 'back' ? 'page-out-right' : 'page-out-left');
      el.classList.add(dir === 'back' ? 'page-in-back' : 'page-in-fwd');
      const done = () => {
        prev.classList.remove('page-out-left', 'page-out-right', 'open');
        prev.style.display = 'none';
        el.classList.remove('page-in-fwd', 'page-in-back');
        switching = false;
      };
      let fired = false;
      const once = () => { if (fired) return; fired = true; done(); };
      el.addEventListener('animationend', once, { once: true });
      setTimeout(once, 300); // 动画被 reduced-motion 等截断时的兜底
    } else if (prev && prev !== el) {
      prev.classList.remove('open');
      prev.style.display = 'none';
    }
    current = id;
    if (dir !== 'back' || true) { /* 进入视图回到顶部仅首次创建时；常驻视图保留原滚动 */ }
  }

  function hideCurrent() {
    if (current && views[current]) views[current].style.display = 'none';
    current = null;
    const root = document.getElementById('page-root');
    if (root) root.classList.remove('open');
  }

  /** 打开页面：写 hash（转场在 hashchange 里做）；hash 已在目标值时（如刷新/回首页后再进同页）直接渲染 */
  function go(id) {
    if (id === current) return;
    const target = '#/' + id;
    if (location.hash === target) onHash();
    else location.hash = target;
  }

  /** 返回上一页：站内栈有下层才 history.back()（手机返回手势同款）；
   *  栈底（如直链进入/刷新后）退无可退 → 回首页，绝不退出去白屏 */
  function back() {
    if (navStack.length > 1 && current) history.back();
    else home();
  }

  function home() {
    navStack.length = 0;
    // 「返回首页」= 清栈直达（不走 history.back 的逐层回退）；手机返回手势才是逐层
    if (location.hash && location.hash !== '#/home') location.hash = '#/home';
    else hideCurrent();
  }

  /** hash 变化 → 方向判定（按访问序）+ 显示目标视图 */
  const navStack = []; // 页面 id 栈（不含首页）：栈底=最早打开的页
  function onHash() {
    const id = (location.hash || '#/home').replace(/^#\//, '') || 'home';
    if (id === 'home' || !registry[id]) { navStack.length = 0; hideCurrent(); return; }
    if (id === current) return;
    // 方向判定：目标在栈中倒数第二位 = 浏览器返回键弹栈；否则视为前进压栈
    const at = navStack.indexOf(id);
    let dir = 'fwd';
    if (at !== -1 && at === navStack.length - 2) { dir = 'back'; navStack.pop(); }
    else if (at === -1) navStack.push(id);
    else navStack.splice(at, 1); // 回到栈中更早的页（跳栈）：摘除其后的项
    show(id, dir);
  }

  function pageId() { return current; }

  window.addEventListener('hashchange', onHash);
  if ((location.hash || '').indexOf('#/') === 0 && location.hash !== '#/home') {
    const id = location.hash.replace(/^#\//, '');
    setTimeout(() => { if (registry[id]) { navStack.push(id); show(id, 'fwd'); } }, 0);
  }

  g.LS.page = { register, go, back, home, refresh, pageId };
})(typeof window !== 'undefined' ? window : globalThis);
