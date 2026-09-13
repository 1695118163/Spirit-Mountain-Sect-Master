/**
 * battle_fx.js —— 斗法舞台演出层（纯 SVG + CSS 动画，零依赖）。
 *  旧版斗法在 #battle-log 里逐行滚动文字战报；本模块把同一个方框改造成对战舞台：
 *  左为我方、右为对方，各一修仙风卡通小人（道袍/发髻/飞剑），
 *  出招有起手动作、命中对方有受击反馈、伤害以飘字呈现、招式按五行/类型出特效。
 *  API（引擎调用）：
 *   LS.battleFx.mount(box, {my, op})      建舞台（返回后可直接 play）
 *   LS.battleFx.kick()                    开场亮相
 *   LS.battleFx.play(side, card, events, done)  演出一次出招（side: 'my'|'op'）
 *   LS.battleFx.intent(side, card)        蓄势（对方亮意图）
 *   LS.battleFx.unmount()                 清台
 */
(function (g) {
  'use strict';
  g.LS = g.LS || {};
  var NS = 'http://www.w3.org/2000/svg';

  var EL_COLOR = {
    '金': '#d9b45a', '木': '#6fa96a', '水': '#5b93bd',
    '火': '#c85a3a', '土': '#a9885c', '五行': '#b9a06a'
  };
  var EL_FX = {
    '金': 'fx-metal', '木': 'fx-wood', '水': 'fx-water',
    '火': 'fx-fire', '土': 'fx-earth', '五行': 'fx-qi'
  };

  function elColor(el) { return EL_COLOR[el] || EL_COLOR['五行']; }
  function fxClass(el) { return EL_FX[el] || 'fx-qi'; }

  /* ── 小人造型 ──────────────────────────────────────────────
     一具 60×96 的简笔仙侠小人：发髻+道袍+束带+云履，右手持剑（可关）。
     造型靠配色区分：我方青衫，对方按身份给赤/玄/苍。 */
  function fighter(which, cfg) {
    var c = cfg || {};
    var robe = c.robe || (which === 'my' ? '#2f6f63' : '#8c3b2e');
    var robe2 = c.robe2 || (which === 'my' ? '#255a51' : '#702e23');
    var trim = c.trim || '#e8dcc8';
    var hair = c.hair || '#241f1a';
    var skin = c.skin || '#e8c9a0';
    var aura = elColor(c.el);
    var sword = c.sword !== false;
    var flip = which === 'my' ? '' : ' transform="scale(-1,1) translate(-64,0)"';

    var s = '';
    s += '<svg class="bfx-body" viewBox="0 0 64 104" width="100%" height="100%">';
    if (aura) {
      s += '<ellipse class="bfx-aura" cx="32" cy="62" rx="22" ry="34" fill="' + aura + '" opacity=".14"/>';
    }
    s += '<ellipse class="bfx-shadow" cx="32" cy="100" rx="17" ry="4.6" fill="rgba(0,0,0,.32)"/>';
    s += '<g class="bfx-fig"' + flip + '>';
    // 腿 + 云履
    s += '<rect x="23" y="72" width="8" height="20" rx="3.4" fill="' + robe2 + '"/>';
    s += '<rect x="33" y="72" width="8" height="20" rx="3.4" fill="' + robe2 + '"/>';
    s += '<rect x="19.5" y="90" width="14" height="6" rx="3" fill="#2b2620"/>';
    s += '<rect x="30.5" y="90" width="14" height="6" rx="3" fill="#2b2620"/>';
    // 道袍（宽摆，卡通比例）
    s += '<path d="M32 30 L48 47 L45 78 L19 78 L16 47 Z" fill="' + robe + '"/>';
    s += '<path d="M32 30 L48 47 L45 78 L32 78 Z" fill="' + robe2 + '" opacity=".5"/>';
    // 衣襟 + 束带 + 下摆云纹
    s += '<path d="M32 31 L25 49 L32 60 L39 49 Z" fill="' + trim + '" opacity=".85"/>';
    s += '<rect x="18" y="58" width="28" height="5.5" rx="2.6" fill="' + trim + '" opacity=".72"/>';
    s += '<path d="M22 80 q10 5 20 0" stroke="' + trim + '" stroke-width="1.4" fill="none" opacity=".5"/>';
    // 双臂
    s += '<rect class="bfx-arm-l" x="11" y="42" width="8" height="26" rx="4" fill="' + robe + '"/>';
    s += '<rect class="bfx-arm-r" x="45" y="42" width="8" height="26" rx="4" fill="' + robe + '"/>';
    s += '<circle class="bfx-hand-l" cx="15" cy="70" r="4.2" fill="' + skin + '"/>';
    s += '<circle class="bfx-hand-r" cx="49" cy="70" r="4.2" fill="' + skin + '"/>';
    // 头（大一号）+ 发髻 + 发带
    s += '<circle cx="32" cy="22" r="13.5" fill="' + skin + '"/>';
    s += '<path d="M18.5 21 a13.5 13.5 0 0 1 27 0 q-13.5 -7.5 -27 0 Z" fill="' + hair + '"/>';
    s += '<circle cx="32" cy="6" r="5.6" fill="' + hair + '"/>';
    s += '<rect x="24.5" y="6.5" width="15" height="3" rx="1.5" fill="' + trim + '" opacity=".9"/>';
    s += '<circle cx="27" cy="23" r="1.9" fill="#3b3229"/>';
    s += '<circle cx="37" cy="23" r="1.9" fill="#3b3229"/>';
    s += '<path d="M28.5 28.5 q3.5 2.4 7 0" stroke="#b98a63" stroke-width="1.2" fill="none" opacity=".8"/>';
    if (sword) {
      // 剑握在右手、斜挑向身侧外，别插在胸口
      s += '<g class="bfx-sword" transform="rotate(-10 53.5 70)">';
      s += '<path d="M53.5 28 L56.8 34 L56.2 60 L53.5 66 L50.8 60 L51.4 34 Z" fill="#dbe3ea"/>';
      s += '<path d="M53.5 28 L56.8 34 L56.2 60 L53.5 66 Z" fill="#aebbc7" opacity=".5"/>';
      s += '<path d="M53.5 28 L53.5 60" stroke="#ffffff" stroke-width="0.8" opacity=".55"/>';
      s += '<rect x="48.5" y="64" width="10.5" height="3.4" rx="1.7" fill="' + trim + '"/>';
      s += '<rect x="52" y="67.4" width="3" height="9.5" rx="1.5" fill="#5a4a34"/>';
      s += '</g>';
    }
    s += '</g></svg>';
    return s;
  }

  var box = null, layer = null, floatLayer = null, myEl = null, opEl = null, busy = false;

  function mount(el, info) {
    unmount();
    box = el;
    if (!box) return;
    var my = (info && info.my) || {}, op = (info && info.op) || {};
    box.innerHTML =
      '<div class="bfx-stage" id="bfx-stage">' +
        '<div class="bfx-ground"></div>' +
        '<div class="bfx-fighter bfx-side-my" id="bfx-my">' + fighter('my', { el: my.el, robe: '#2f6f63', robe2: '#24564d' }) + '</div>' +
        '<div class="bfx-fighter bfx-side-op" id="bfx-op">' + fighter('op', { el: op.el, robe: op.robe || '#8c3b2e', robe2: op.robe2 || '#6d2c22', sword: op.sword !== false }) + '</div>' +
        '<div class="bfx-fx" id="bfx-fx"></div>' +
        '<div class="bfx-floats" id="bfx-floats"></div>' +
        '<div class="bfx-name bfx-name-my">' + esc(my.dao) + '</div>' +
        '<div class="bfx-name bfx-name-op">' + esc(op.dao) + '</div>' +
      '</div>';
    layer = box.querySelector('#bfx-fx');
    floatLayer = box.querySelector('#bfx-floats');
    myEl = box.querySelector('#bfx-my');
    opEl = box.querySelector('#bfx-op');
    busy = false;
  }

  function unmount() {
    if (box) box.innerHTML = '';
    box = null; layer = null; floatLayer = null; myEl = null; opEl = null; busy = false;
  }

  function esc(t) { return String(t == null ? '' : t).replace(/[<>&]/g, function (m) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[m]; }); }
  function sideEl(side) { return side === 'my' ? myEl : opEl; }
  function foeSide(side) { return side === 'my' ? 'op' : 'my'; }

  function cls(el, name, on) { if (el) el.classList[on ? 'add' : 'remove'](name); }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ── 飘字 ── */
  function float(side, text, kind) {
    if (!floatLayer) return;
    var d = document.createElement('div');
    // 注意：kind 必须挂在 bfx-float- 下 —— 直接拼 'bfx-heal'/'bfx-shield' 会撞上舞台光晕/护罩的样式
    d.className = 'bfx-float bfx-float-' + (side === 'my' ? 'my' : 'op') + (kind ? ' bfx-float-' + kind : '');
    d.style.left = ((side === 'my' ? 18 : 82) + (Math.random() * 12 - 6)) + '%';
    d.textContent = text;
    floatLayer.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1400);
  }

  /* ── 特效：在舞台上放一枚飞行的招式投影 ── */
  function spawnFx(cls2, from, to, dur) {
    if (!layer) return null;
    var d = document.createElement('div');
    d.className = 'bfx-proj ' + cls2;
    d.style.setProperty('--fx-from-x', from.x + 'px');
    d.style.setProperty('--fx-from-y', from.y + 'px');
    d.style.setProperty('--fx-to-x', (to.x - from.x) + 'px');
    d.style.setProperty('--fx-to-y', (to.y - from.y) + 'px');
    d.style.left = from.x + 'px';
    d.style.top = from.y + 'px';
    d.style.animationDuration = (dur || 380) + 'ms';
    layer.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, (dur || 380) + 120);
    return d;
  }

  function burst(at, kind) {
    if (!layer) return;
    for (var i = 0; i < 7; i++) {
      var d = document.createElement('div');
      d.className = 'bfx-spark ' + kind;
      var ang = (Math.PI * 2 * i) / 7 + Math.random() * 0.4;
      var dist = 16 + Math.random() * 18;
      d.style.left = at.x + 'px';
      d.style.top = at.y + 'px';
      d.style.setProperty('--sx', Math.round(Math.cos(ang) * dist) + 'px');
      d.style.setProperty('--sy', Math.round(Math.sin(ang) * dist) + 'px');
      layer.appendChild(d);
      (function (node) { setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 620); })(d);
    }
  }

  function centerOf(side) {
    var el = sideEl(side);
    if (!el || !box) return { x: 0, y: 0 };
    var r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height * 0.42 };
  }

  function shieldRise(side, amount) {
    var el = sideEl(side);
    if (!el) return;
    var d = document.createElement('div');
    d.className = 'bfx-shield';
    el.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1100);
    if (amount) float(side, '+' + amount, 'shield');
  }

  function healGlow(side, amount) {
    var el = sideEl(side);
    if (!el) return;
    var d = document.createElement('div');
    d.className = 'bfx-heal';
    el.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1000);
    if (amount) float(side, '+' + amount, 'heal');
  }

  function shake(side, strong) {
    var el = sideEl(side);
    if (!el) return;
    cls(el, 'bfx-hurt', true);
    if (strong) cls(el, 'bfx-hurt-strong', true);
    setTimeout(function () { cls(el, 'bfx-hurt', false); cls(el, 'bfx-hurt-strong', false); }, 460);
  }

  /* ── 核心：演出一次出招 ──
     card=招式数据, events=引擎结算出来的结构化事件数组, done=演出结束回调 */
  function play(side, card, events, done) {
    if (!box || !myEl || !opEl) { if (done) done(); return; }
    var me = sideEl(side), foe = foeSide(side);
    var el = (card && card.el) || null;
    var kind = fxClass(el);
    var dmgEvent = null, healEvent = null, shieldEvent = null;
    (events || []).forEach(function (e) {
      if (e.type === 'hit') dmgEvent = dmgEvent || e;
      if (e.type === 'heal') healEvent = e;
      if (e.type === 'shield') shieldEvent = e;
    });
    busy = true;
    cls(me, 'bfx-act', true);
    cls(me, shieldEvent ? 'bfx-cast' : 'bfx-lunge', true);

    // 每一拍都是一个函数：真正串行播放（若先建成 Promise，setTimeout 会在建数组时就跑掉）
    var steps = [];
    steps.push(function () { return wait(300); });                       // 起手：拔剑/掐诀
    if (dmgEvent) {
      steps.push(function () {                                            // 招式飞影
        var from = centerOf(side), to = centerOf(foe);
        spawnFx(kind, { x: from.x + (side === 'my' ? 18 : -18), y: from.y }, to, 340);
        return wait(340);
      });
      steps.push(function () {                                            // 命中：爆点+受击+飘字
        var to = centerOf(foe);
        burst(to, kind);
        shake(foe, dmgEvent.dealt >= 25);
        var blocked = dmgEvent.absorbed && !dmgEvent.dealt;
        float(foe, blocked ? ('罡 -' + dmgEvent.absorbed) : ('-' + (dmgEvent.dealt || 0)),
          blocked ? 'block' : (dmgEvent.dealt >= 30 ? 'crit' : 'dmg'));
        if (dmgEvent.elMult > 1) float(foe, '克 制', 'tag');
        else if (dmgEvent.elMult < 1) float(foe, '被 克', 'tag-weak');
        if (dmgEvent.pierce) float(foe, '破 罡', 'tag');
        if (dmgEvent.steal) float(side, '+' + dmgEvent.steal, 'heal');
        return wait(320);
      });
    }
    if (healEvent) steps.push(function () { healGlow(side, healEvent.amount); return wait(340); });
    if (shieldEvent) steps.push(function () { shieldRise(side, shieldEvent.amount); return wait(340); });
    if (!dmgEvent && !healEvent && !shieldEvent) steps.push(function () { float(side, '调 息', 'tag-weak'); return wait(300); });
    steps.push(function () { return wait(150); });                        // 收招

    return steps.reduce(function (p, step) {
      return p.then(step).then(function () {});
    }, Promise.resolve()).then(function () {
      cls(me, 'bfx-act', false); cls(me, 'bfx-lunge', false); cls(me, 'bfx-cast', false);
      busy = false;
      if (done) done();
    });
  }

  /** 亮意图：对方一个细微的蓄势抖动 */
  function intent(side, card) {
    var el = sideEl(side);
    if (!el) return;
    cls(el, 'bfx-ready', true);
    setTimeout(function () { cls(el, 'bfx-ready', false); }, 700);
  }

  function kick() {
    if (!box) return;
    cls(myEl, 'bfx-enter', true); cls(opEl, 'bfx-enter', true);
    setTimeout(function () { cls(myEl, 'bfx-enter', false); cls(opEl, 'bfx-enter', false); }, 900);
  }

  function updateFighter(side, cfg) {
    var el = sideEl(side);
    if (!el || !cfg) return;
    var fig = el.querySelector('.bfx-fighter-inner') || el;
    // 目前只在建台时定型；预留：元素/造型变化时重画
    if (cfg.redraw) el.innerHTML = fighter(side, cfg);
  }

  function down(side) {
    var el = sideEl(side);
    if (!el) return;
    cls(el, 'bfx-down', true);
  }

  g.LS.battleFx = {
    mount: mount, unmount: unmount, play: play, intent: intent, kick: kick,
    float: float, down: down, updateFighter: updateFighter,
    get busy() { return busy; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
