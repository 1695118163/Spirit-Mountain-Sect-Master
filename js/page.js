/**
 * page.js —— 页面切换制路由（v0.22 批二）：
 *  - hash 路由：#/home #/map #/dannfang #/market #/quest #/disciple
 *  - 页面全屏覆盖层 #page-root，顶部固定「返回首页」「返回上一页」；
 *  - 页面注册表 renderRegistry[pageId] 返回 HTML 字符串 + 可选 afterMount 回调；
 *  - 返回上一页 = 内部栈 pop；返回首页 = 清栈。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const stack = ['home'];           // 页面栈：stack[stack.length-1] 为当前页
  let current = null;               // 当前页 id
  const registry = {};              // { pageId: { title, render(): string, mount?(root) } }

  function register(id, def) { registry[id] = def; }

  function shellHTML(id, inner) {
    const def = registry[id] || {};
    return '<div class="page-topbar">' +
      '<button class="icon-btn" data-nav="home">返回首页</button>' +
      '<b class="page-title">' + (def.title || id) + '</b>' +
      '<button class="icon-btn" data-nav="back">返回上一页</button></div>' +
      '<div class="page-body">' + inner + '</div>';
  }

  /** 打开/切换页面（首页以外都会入栈） */
  function go(id) {
    if (id === current) return;
    if (id !== 'home') stack.push(id);
    render(id);
  }

  function back() {
    if (stack.length > 1) stack.pop();
    render(stack[stack.length - 1]);
  }

  function home() {
    stack.length = 0;
    stack.push('home');
    close();
  }

  function render(id) {
    const root = document.getElementById('page-root');
    if (!root) return;
    if (id === 'home') { close(); return; }
    const def = registry[id];
    if (!def) { close(); return; }
    current = id;
    root.innerHTML = shellHTML(id, def.render());
    root.classList.add('open');
    root.scrollTop = 0;
    root.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.nav === 'home') home(); else back();
    }));
    if (def.mount) def.mount(root);
  }

  function close() {
    current = null;
    const root = document.getElementById('page-root');
    if (root) { root.classList.remove('open'); root.innerHTML = ''; }
  }

  /** 当前页 id（供条件渲染） */
  function pageId() { return current; }

  /** 面板内刷新当前页（页面内操作后重渲染） */
  function refresh() { if (current && registry[current]) render(current); }

  g.LS.page = { register, go, back, home, refresh, pageId };
})(typeof window !== 'undefined' ? window : globalThis);
