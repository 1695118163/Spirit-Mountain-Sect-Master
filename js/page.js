/**
 * page.js v2 —— 页面切换制路由（转场升级版）：
 *  - 真 hash 路由：#/map #/dannfang #/market #/quest #/disciple——浏览器/手机返回键直接可用；
 *  - 转场：前进=新页从右滑入，返回=从左滑回（0.26s），不再是「同页滑动」的观感；
 *  - 栈驱动方向判断；「返回首页」清栈回 #/home。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const registry = {};
  let current = null;          // 当前页 id（null=首页）
  let animating = false;
  let suppressHash = false;    // 程序内跳转时防止 hashchange 重复渲染

  function register(id, def) { registry[id] = def; }

  function shellHTML(id, inner) {
    const def = registry[id] || {};
    return '<div class="page-topbar">' +
      '<button class="icon-btn" data-nav="home">返回首页</button>' +
      '<b class="page-title">' + (def.title || id) + '</b>' +
      '<button class="icon-btn" data-nav="back">返回上一页</button></div>' +
      '<div class="page-body">' + inner + '</div>';
  }

  /** 渲染某页（dir: 'fwd' 前进滑入 | 'back' 返回滑入 | 'none' 无动画刷新） */
  function render(id, dir) {
    const root = document.getElementById('page-root');
    if (!root) return;
    const def = registry[id];
    if (!def) { close(); return; }
    current = id;
    root.innerHTML = shellHTML(id, def.render());
    root.classList.add('open');
    root.scrollTop = 0;
    const body = root.querySelector('.page-body');
    if (body && dir !== 'none' && !animating) {
      animating = true;
      body.classList.add(dir === 'back' ? 'page-in-back' : 'page-in-fwd');
      body.addEventListener('animationend', () => { body.classList.remove('page-in-fwd', 'page-in-back'); animating = false; }, { once: true });
    }
    root.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.nav === 'home') home();
      else back();
    }));
    if (def.mount) def.mount(root);
  }

  function close() {
    current = null;
    const root = document.getElementById('page-root');
    if (root) { root.classList.remove('open'); root.innerHTML = ''; }
  }

  /** 打开页面：写 hash，转场交给 hashchange */
  function go(id) {
    if (id === current) return;
    suppressHash = false;
    location.hash = '#/' + id;
  }

  function back() {
    if (current && location.hash !== '#/home' && location.hash !== '') history.back();
    else home();
  }

  function home() {
    suppressHash = false;
    if (location.hash && location.hash !== '#/home') location.hash = '#/home';
    else { current = null; close(); }
  }

  /** hash 变化 → 判断方向并渲染 */
  function onHash() {
    if (suppressHash) { suppressHash = false; return; }
    const id = (location.hash || '#/home').replace(/^#\//, '') || 'home';
    if (id === 'home') { current = null; close(); return; }
    if (!registry[id]) { current = null; close(); return; }
    if (id === current) return;
    // 方向：回退到栈中已存在的页=back；新页=fwd。用 history.length 变化不可靠，
    // 简化：维护一个访问序数组，出现序号<当前=回退。
    const dir = visitOrder.indexOf(id) !== -1 && visitOrder.indexOf(id) < visitOrder.indexOf(current || 'home') ? 'back' : 'fwd';
    if (visitOrder.indexOf(id) === -1) visitOrder.push(id);
    render(id, dir);
  }

  const visitOrder = ['home'];

  /** 页面内操作后刷新当前页（不播转场） */
  function refresh() {
    if (current && registry[current]) {
      const root = document.getElementById('page-root');
      if (!root) return;
      root.innerHTML = shellHTML(current, registry[current].render());
      root.scrollTop = 0;
      root.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.nav === 'home') home(); else back();
      }));
      if (registry[current].mount) registry[current].mount(root);
    }
  }

  function pageId() { return current; }

  window.addEventListener('hashchange', onHash);
  // 启动时若 URL 已带页 hash（刷新/分享链接），直接落到该页
  if ((location.hash || '').indexOf('#/') === 0 && location.hash !== '#/home') {
    const id = location.hash.replace(/^#\//, '');
    setTimeout(() => { if (registry[id]) render(id, 'fwd'); }, 0);
  }

  g.LS.page = { register, go, back, home, refresh, pageId };
})(typeof window !== 'undefined' ? window : globalThis);
