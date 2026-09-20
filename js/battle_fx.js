/**
 * battle_fx.js —— 斗法舞台演出层（纯 DOM + SVG + CSS 动画，零依赖）。
 *  舞台在原 #battle-log 的方框里：左我方、右对方各一修仙风小人；
 *  出招 → 招式按【五行】走出不同的形态与命中特效 → 对方受击、飘伤害数字。
 *  五行形态（2026-09-13 第二版）：
 *    金＝斜切剑光（刃影 + 白线斩痕）      木＝藤蔓缠绕（弯藤 + 绿叶）
 *    水＝水箭 + 同心波纹                  火＝火球跳动 + 火苗上窜
 *    土＝旋转岩块 + 碎石崩落              无相＝气浪圆环 + 冲击波
 *  罡气护罩：不再是一闪而过的圈，而是顶在身前的六棱罡罩（升起→缓转→受击涟漪→碎裂）。
 *  API（引擎调用）：
 *    mount(box, {my, op}) / kick() / unmount()
 *    play(side, card, events, done)   演出一次出招
 *    setShield(side, value)           护罩随罡气值增删（引擎每帧同步）
 *    intent(side, card) / down(side) / float(side, text, kind)
 */
(function (g) {
  'use strict';
  g.LS = g.LS || {};

  var EL_KEY = { '金': 'metal', '木': 'wood', '水': 'water', '火': 'fire', '土': 'earth', '五行': 'qi' };
  var EL_COLOR = { '金': '#d9b45a', '木': '#6fa96a', '水': '#5b93bd', '火': '#c85a3a', '土': '#a9885c', '五行': '#b9a06a' };

  function elKey(el) { return EL_KEY[el] || 'qi'; }

  /* 招牌招式的专属形态（按牌 id 认；没列到的按五行走）*/
  var CARD_FX = {
    // 大招（5 费以上）逐张一套
    dayan_shenlei: 'leichi',      // 大衍神雷：九雷连环 + 雷池
    tianleipo: 'giantbolt',       // 天雷破：一道巨雷
    wulei_zhengfa: 'fivebolt',    // 五雷正法：五行五色雷
    zhanxian_feidao: 'flyingblade', // 斩仙飞刀：刀气贯穿 + 血线
    xingchenzhi: 'starfingers',   // 星辰指：星芒贯穿
    fentianjin: 'skyfire',        // 焚天劲：冲天火柱
    liaoyuanhuo: 'prairiefire',   // 燎原火：地面火线蔓延
    canghaitun: 'whirlpool',      // 沧海吞：吞噬漩涡
    hunyuanyiqi: 'chaos',         // 混元一气：气旋爆
    taiqing_zaohua: 'lotus',      // 太清造化：青莲 + 生命光雨
    yujianshu: 'swordring',       // 御剑术：五剑绕身 1s 再齐射（用户指定）
    // 守式：每张一套（护体罡气走通用罡气护罩）
    jinzhongzhao: 'bell', tiebushan: 'ironbody', xuanwu_zhenyue: 'xuanwu',
    jingang_buhuai: 'sutra', zhoutian_xingdou: 'starmap', guixigong: 'turtle',
    // ── 第二批专属形态（2026-09-20 wkh 逐张选定）──
    tunazhang: 'breathring',     // 吐纳掌：吐纳一息（呼吸光环 → 掌风无声推出）
    pojunzhan: 'crosscut',       // 破军斩：十字斩（斜劈接横切）
    xunleiji: 'triplebolt',      // 迅雷击：三连小雷
    zhuifengjian: 'windblades',  // 追风剑：三道剑影掠过 + 风痕
    jingangquan: 'palmseal',     // 金刚拳：金刚一印（留印缓慢消退）
    wuxingshu: 'fivecol',        // 五行术：五行光柱（五色柱自天而降）
    xuanbingjian: 'frostbite',   // 玄冰箭：冰晶结霜（冰花地纹）
    qingmuchan: 'rootlock',      // 青木缠：木根锁足（根须自地面收紧）
    gengjinrui: 'goldburst',     // 庚金锐：金屑迸散
    houtu_qing: 'sinkhole',      // 厚土诀：地陷合拢
    zhoutian: 'acupoint',        // 周天运转：经脉光点依次亮起
    chunhuijue: 'sprout',        // 春回诀：枯木新芽（先枯后荣）
    benming: 'swordarc',         // 本命飞剑：剑光绕弧贯入
    sanmeihuo: 'flamespiral',    // 三昧真火：三簇螺旋合一
    qingtengfu: 'vinecage',      // 青藤缚：古藤成笼
    yusui_danfang: 'cauldron'    // 玉髓丹方：丹鼎虚影洒药光
  };
  function fxOf(card, el) {
    var k = card && card.id ? CARD_FX[card.id] : null;
    return k || elKey(el);
  }
  function elColor(el) { return EL_COLOR[el] || EL_COLOR['五行']; }
  function esc(t) { return String(t == null ? '' : t).replace(/[<>&]/g, function (m) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[m]; }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function cls(el, name, on) { if (el) el.classList[on ? 'add' : 'remove'](name); }

  /* ── 小人（60×96 视口） ───────────────────────────── */
  function fighter(which, cfg) {
    var c = cfg || {};
    var robe = c.robe || (which === 'my' ? '#2f6f63' : '#8c3b2e');
    var robe2 = c.robe2 || (which === 'my' ? '#255a51' : '#6d2c22');
    var trim = c.trim || '#e8dcc8';
    var hair = c.hair || '#241f1a';
    var skin = c.skin || '#e8c9a0';
    var aura = elColor(c.el);
    var sword = c.sword !== false;
    var flip = which === 'my' ? '' : ' transform="scale(-1,1) translate(-64,0)"';
    var s = '';
    s += '<svg class="bfx-body" viewBox="0 0 64 104" width="100%" height="100%">';
    s += '<ellipse class="bfx-aura" cx="32" cy="62" rx="22" ry="34" fill="' + aura + '" opacity=".14"/>';
    s += '<ellipse class="bfx-shadow" cx="32" cy="100" rx="17" ry="4.6" fill="rgba(0,0,0,.32)"/>';
    s += '<g class="bfx-fig"' + flip + '>';
    s += '<rect x="23" y="72" width="8" height="20" rx="3.4" fill="' + robe2 + '"/>';
    s += '<rect x="33" y="72" width="8" height="20" rx="3.4" fill="' + robe2 + '"/>';
    s += '<rect x="19.5" y="90" width="14" height="6" rx="3" fill="#2b2620"/>';
    s += '<rect x="30.5" y="90" width="14" height="6" rx="3" fill="#2b2620"/>';
    s += '<path d="M32 30 L48 47 L45 78 L19 78 L16 47 Z" fill="' + robe + '"/>';
    s += '<path d="M32 30 L48 47 L45 78 L32 78 Z" fill="' + robe2 + '" opacity=".5"/>';
    s += '<path d="M32 31 L25 49 L32 60 L39 49 Z" fill="' + trim + '" opacity=".85"/>';
    s += '<rect x="18" y="58" width="28" height="5.5" rx="2.6" fill="' + trim + '" opacity=".72"/>';
    s += '<path d="M22 80 q10 5 20 0" stroke="' + trim + '" stroke-width="1.4" fill="none" opacity=".5"/>';
    s += '<rect class="bfx-arm-l" x="11" y="42" width="8" height="26" rx="4" fill="' + robe + '"/>';
    s += '<rect class="bfx-arm-r" x="45" y="42" width="8" height="26" rx="4" fill="' + robe + '"/>';
    s += '<circle class="bfx-hand-l" cx="15" cy="70" r="4.2" fill="' + skin + '"/>';
    s += '<circle class="bfx-hand-r" cx="49" cy="70" r="4.2" fill="' + skin + '"/>';
    s += '<circle cx="32" cy="22" r="13.5" fill="' + skin + '"/>';
    s += '<path d="M18.5 21 a13.5 13.5 0 0 1 27 0 q-13.5 -7.5 -27 0 Z" fill="' + hair + '"/>';
    s += '<circle cx="32" cy="6" r="5.6" fill="' + hair + '"/>';
    s += '<rect x="24.5" y="6.5" width="15" height="3" rx="1.5" fill="' + trim + '" opacity=".9"/>';
    s += '<circle cx="27" cy="23" r="1.9" fill="#3b3229"/>';
    s += '<circle cx="37" cy="23" r="1.9" fill="#3b3229"/>';
    s += '<path d="M28.5 28.5 q3.5 2.4 7 0" stroke="#b98a63" stroke-width="1.2" fill="none" opacity=".8"/>';
    if (sword) {
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

  var box = null, layer = null, floatLayer = null, myEl = null, opEl = null;
  var myCamp = null, opCamp = null, busy = false;
  var elem = { my: null, op: null };      // 各自的灵根元素（root 牌要换成它）
  var guards = { my: null, op: null };     // 护罩节点
  var guardVal = { my: 0, op: 0 };

  function mount(el, info) {
    unmount();
    box = el;
    if (!box) return;
    var my = (info && info.my) || {}, op = (info && info.op) || {};
    elem.my = my.el || null; elem.op = op.el || null;
    box.innerHTML =
      '<div class="bfx-stage" id="bfx-stage">' +
        '<div class="bfx-ground"></div>' +
        '<div class="bfx-fighter bfx-side-my" id="bfx-my">' + fighter('my', { el: my.el }) + '</div>' +
        '<div class="bfx-fighter bfx-side-op" id="bfx-op">' + fighter('op', { el: op.el, sword: op.sword !== false }) + '</div>' +
        '<div class="bfx-fx" id="bfx-fx"></div>' +
        '<div class="bfx-floats" id="bfx-floats"></div>' +
        '<div class="bfx-name bfx-name-my">' + esc(my.dao) + '</div>' +
        '<div class="bfx-name bfx-name-op">' + esc(op.dao) + '</div>' +
      '</div>';
    layer = box.querySelector('#bfx-fx');
    floatLayer = box.querySelector('#bfx-floats');
    myEl = box.querySelector('#bfx-my');
    opEl = box.querySelector('#bfx-op');
    myCamp = null; opCamp = null;
    guards = { my: null, op: null };
    guardVal = { my: 0, op: 0 };
    busy = false;
  }

  function unmount() {
    if (box) box.innerHTML = '';
    box = null; layer = null; floatLayer = null; myEl = null; opEl = null;
    myCamp = null; opCamp = null; guards = { my: null, op: null }; guardVal = { my: 0, op: 0 }; busy = false;
  }

  function sideEl(side) { return side === 'my' ? myEl : opEl; }
  function foeSide(side) { return side === 'my' ? 'op' : 'my'; }

  function centerOf(side) {
    var el = sideEl(side);
    if (!el || !box) return { x: 0, y: 0 };
    var r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height * 0.42 };
  }

  /* ── 飘字 ─────────────────────────────────────────── */
  function float(side, text, kind) {
    if (!floatLayer) return;
    var d = document.createElement('div');
    // kind 必须挂在 bfx-float- 之下：bfx-heal / bfx-shield 会撞上舞台光晕/护罩的样式
    d.className = 'bfx-float bfx-float-' + side + (kind ? ' bfx-float-' + kind : '');
    d.style.left = ((side === 'my' ? 18 : 82) + (Math.random() * 12 - 6)) + '%';
    d.textContent = text;
    floatLayer.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1400);
  }

  /* ── 招式飞影：按五行给不同形态 ───────────────────── */
  function projNode(fx) {
    var d = document.createElement('div');
    var k = fx;
    d.className = 'bfx-proj proj-' + k;
    if (k === 'leichi') {
      d.innerHTML = '<i class="lc-cloud"></i><svg viewBox="0 0 20 24" width="20" height="24">' +
        '<path d="M12 1 L5 13 L10 13 L8 23" stroke="#e6e0ff" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>';
    } else if (k === 'giantbolt') {
      d.innerHTML = '<i class="gb-cloud"></i>';
    } else if (k === 'fivebolt') {
      d.innerHTML = '<i></i><i></i><i></i><i></i><i></i>';
    } else if (k === 'flyingblade') {
      d.innerHTML = '<i class="fb-blade"></i>';
    } else if (k === 'starfingers') {
      d.innerHTML = '<i class="sf-ray"></i><i class="sf-ray v"></i><i class="sf-core"></i>';
    } else if (k === 'swordblade') {
      d.innerHTML = '<i class="sw"></i>';
    } else if (k === 'skyfire' || k === 'prairiefire') {
      d.innerHTML = '<i class="fire-core"></i><i class="fire-tail"></i><i class="fire-spark"></i>';
    } else if (k === 'whirlpool') {
      d.innerHTML = '<i class="wp-ring b"></i><i class="wp-ring"></i><i class="wp-core"></i>';
    } else if (k === 'chaos') {
      d.innerHTML = '<i class="ch-core"></i>';
    } else if (k === 'thunder') {
      d.innerHTML = '<i class="th-cloud"></i><svg viewBox="0 0 24 28" width="24" height="28">' +
        '<path d="M15 1 L6 15 L12 15 L9 27" stroke="#f6f2ff" stroke-width="2.4" fill="none" stroke-linejoin="round"/></svg>';
    } else if (k === 'blade') {
      d.innerHTML = '<i class="knife-handle"></i><i class="knife"></i>';
    } else if (k === 'star') {
      d.innerHTML = '<i class="star-ray"></i><i class="star-ray v"></i><i class="star-core"></i>';
    } else if (k === 'fist') {
      d.innerHTML = '<i class="fist-core"></i>';
    } else if (k === 'fireblast') {
      d.innerHTML = '<i class="fire-core"></i><i class="fire-tail"></i><i class="fire-spark"></i>';
    } else if (k === 'whirl') {
      d.innerHTML = '<i class="wh-ring b"></i><i class="wh-ring"></i><i class="wh-core"></i>';
    } else if (k === 'burst') {
      d.innerHTML = '<i class="bu-core"></i>';
    } else if (k === 'metal') {
      d.innerHTML = '<i class="blade-glow"></i><i class="blade-core"></i>';
    } else if (k === 'wood') {
      d.innerHTML = '<svg viewBox="0 0 52 20" width="52" height="20">' +
        '<path d="M2 16 Q14 3 26 13 T50 5" stroke="#6ea85f" stroke-width="3.6" fill="none" stroke-linecap="round"/>' +
        '<path d="M20 12 q7 -8 14 -3 q-8 8 -14 3" fill="#8cc47a" opacity=".95"/>' +
        '<path d="M30 8 q6 -6 11 -1 q-6 6 -11 1" fill="#a8d693" opacity=".9"/></svg>';
    } else if (k === 'water') {
      d.innerHTML = '<i class="water-tip"></i><i class="water-wake"></i>';
    } else if (k === 'fire') {
      d.innerHTML = '<i class="fire-core"></i><i class="fire-tail"></i><i class="fire-spark"></i>';
    } else if (k === 'earth') {
      d.innerHTML = '<i class="rock r1"></i><i class="rock r2"></i>';
    } else {
      d.innerHTML = '<i class="qi-ring"></i><i class="qi-core"></i>';
    }
    return d;
  }

  function spawnFx(el, from, to, dur) {
    if (!layer) return;
    var d = projNode(el);
    d.style.setProperty('--fx-to-x', (to.x - from.x) + 'px');
    d.style.setProperty('--fx-to-y', (to.y - from.y) + 'px');
    d.style.left = from.x + 'px';
    d.style.top = from.y + 'px';
    d.style.animationDuration = (dur || 420) + 'ms';
    layer.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, (dur || 420) + 160);
    return d;
  }

  /* ── 命中：按五行给不同的爆点 ─────────────────────── */
  function sparkAt(at, cls2, dx, dy, delay) {
    var d = document.createElement('div');
    d.className = 'bfx-spark ' + cls2;
    d.style.left = at.x + 'px';
    d.style.top = at.y + 'px';
    d.style.setProperty('--sx', dx + 'px');
    d.style.setProperty('--sy', dy + 'px');
    if (delay) d.style.animationDelay = delay + 'ms';
    layer.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 900 + (delay || 0));
    return d;
  }

  function flashAt(at) {
    var fl = document.createElement('div');
    fl.className = 'bfx-flashbig';
    fl.style.setProperty('--fx-x', at.x + 'px');
    fl.style.setProperty('--fx-y', at.y + 'px');
    layer.appendChild(fl);
    (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 520); })(fl);
  }

  function boltAt(at, dx, delay, scale) {
    var d = document.createElement('div');
    d.className = 'bfx-bolt';
    d.innerHTML = '<svg viewBox="0 0 28 100" width="28" height="100">' +
      '<path d="M17 0 L6 44 L14 46 L9 100" stroke="#eae4ff" stroke-width="3" fill="none" stroke-linejoin="round"/></svg>';
    d.style.left = (at.x + dx) + 'px';
    d.style.top = at.y + 'px';
    if (delay) d.style.animationDelay = delay + 'ms';
    if (scale) { d.style.width = (28 * scale) + 'px'; d.style.height = (100 * scale) + 'px'; d.style.margin = (-100 * scale) + 'px 0 0 ' + (-14 * scale) + 'px'; }
    layer.appendChild(d);
    (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 700 + (delay || 0)); })(d);
  }

  /* ── 招式专属形态（批次一，2026-09-20）──────────────────────────
     独立成函数、在 impact 入口前置调用，原 impact 一行未动。
     设计取向：招式之间要一眼能分辨，所以「起手方式 + 命中瞬间」都各写各的。 */
  function impactNew(fx, at, strong) {
    if (!layer) return true;
    var i, ang, dist, n, el, d;
    var add = function (node, ms) {
      layer.appendChild(node);
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, ms);
    };
    var box = function (cls2, x, y) {
      var e2 = document.createElement('div');
      e2.className = cls2;
      e2.style.left = (x == null ? at.x : x) + 'px';
      e2.style.top = (y == null ? at.y : y) + 'px';
      return e2;
    };

    if (fx === 'breathring') {
      // 吐纳掌：先起一圈呼吸光环（吸气），再无声推出一记掌风
      var ring = box('bfx-breathring');
      add(ring, 900);
      setTimeout(function () { add(box('bfx-palmwave'), 700); }, 220);
      for (i = 0; i < 6; i++) {
        ang = Math.PI * 2 * i / 6;
        sparkAt(at, 'sp-qi', Math.cos(ang) * 16, Math.sin(ang) * 10, 260 + i * 26);
      }
    } else if (fx === 'crosscut') {
      // 破军斩：斜劈接横切，两道斩痕叠成十字
      var cut = function (rot, delay, wide) {
        var sl = box('bfx-cut');
        sl.style.setProperty('--r', rot + 'deg');     // 角度走变量，keyframes 会读它
        sl.style.animationDelay = delay + 'ms';
        add(sl, 560 + delay);
      };
      cut(38, 0);
      cut(128, 150, 1.15);
      flashAt(at);
      setTimeout(function () {
        for (i = 0; i < 7; i++) {
          ang = Math.PI * 2 * i / 7;
          dist = 20 + Math.random() * 22;
          sparkAt(at, 'sp-metal', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 26);
        }
      }, 150);
      shake(foeSideByAt(at), 1);
    } else if (fx === 'triplebolt') {
      // 迅雷击：极快三下，一下比一下短
      var d3 = [-18, 2, 18];
      for (i = 0; i < 3; i++) {
        (function (idx) {
          setTimeout(function () {
            boltAt(at, d3[idx], 0, 0.72);
            for (n = 0; n < 4; n++) {
              ang = Math.PI * 2 * n / 4 + idx;
              sparkAt(at, 'sp-thunder', Math.cos(ang) * (14 + idx * 4), Math.sin(ang) * (12 + idx * 3), 0);
            }
            if (idx === 2) flashAt(at);
          }, idx * 140);
        })(i);
      }
    } else if (fx === 'windblades') {
      // 追风剑：三道极细剑影几乎同时掠过，拖出风痕
      for (i = 0; i < 3; i++) {
        (function (idx) {
          var sl = box('bfx-slash');
          sl.classList.add('thin');
          sl.style.setProperty('--r', (80 + idx * 6) + 'deg');
          sl.style.animationDelay = (idx * 70) + 'ms';
          add(sl, 520 + idx * 70);
          setTimeout(function () { add(box('bfx-gale'), 460); }, idx * 70);
        })(i);
      }
      for (i = 0; i < 5; i++) {
        ang = Math.PI * 2 * i / 5;
        sparkAt(at, 'sp-qi', Math.cos(ang) * 24, Math.sin(ang) * 18, 40 + i * 30);
      }
    } else if (fx === 'palmseal') {
      // 金刚拳：一记重拳落下，目标身上留一枚拳印缓缓消退
      var seal = box('bfx-palmseal');
      add(seal, 1100);
      impactFlashRing(at, '#f0d78a');
      for (i = 0; i < 8; i++) {
        ang = Math.PI * 2 * i / 8;
        dist = 22 + Math.random() * 20;
        sparkAt(at, 'sp-metal', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 22);
      }
      flashAt(at);
      shake('op', 2);
    } else if (fx === 'fivecol') {
      // 五行术：五色光柱自天而降，围住对手
      var cols = ['#f0e2a0', '#9ed69a', '#a8d8f0', '#f0a87c', '#d8bd8a'];
      for (i = 0; i < 5; i++) {
        (function (idx) {
          var col = box('bfx-fivecol', at.x - 32 + idx * 16, at.y - 58);
          col.style.color = cols[idx];
          col.style.animationDelay = (idx * 90) + 'ms';
          add(col, 1000 + idx * 90);
        })(i);
      }
      setTimeout(function () {
        flashAt(at);
        for (i = 0; i < 8; i++) {
          ang = Math.PI * 2 * i / 8;
          sparkAt(at, 'sp-qi', Math.cos(ang) * 26, Math.sin(ang) * 18, i * 24);
        }
      }, 420);
    } else if (fx === 'frostbite') {
      // 玄冰箭：命中处结出冰花地纹，寒气滞留一瞬
      var fr = box('bfx-frost');
      add(fr, 1400);
      setTimeout(function () {
        for (i = 0; i < 7; i++) {
          ang = Math.PI * 2 * i / 7;
          dist = 16 + Math.random() * 20;
          sparkAt(at, 'sp-drop', Math.cos(ang) * dist, Math.sin(ang) * dist * 0.7, i * 30);
        }
      }, 120);
      for (i = 0; i < 3; i++) {
        (function (idx) {
          var spike = box('bfx-icespike');
          spike.style.setProperty('--r', (idx * 120 + 20) + 'deg');
          spike.style.animationDelay = (idx * 70) + 'ms';
          add(spike, 800 + idx * 70);
        })(i);
      }
    } else if (fx === 'rootlock') {
      // 青木缠：细根须自地面升起缠住双脚，缓缓收紧
      for (i = 0; i < 6; i++) {
        (function (idx) {
          var rt = box('bfx-root');
          rt.style.setProperty('--r', (idx * 60) + 'deg');
          rt.style.animationDelay = (idx * 60) + 'ms';
          add(rt, 1200 + idx * 60);
        })(i);
      }
      setTimeout(function () {
        for (i = 0; i < 6; i++) {
          ang = Math.PI * 2 * i / 6;
          sparkAt(at, 'sp-leaf', Math.cos(ang) * 20, Math.abs(Math.sin(ang)) * 8 + 4, i * 40);
        }
      }, 300);
    } else if (fx === 'goldburst') {
      // 庚金锐：金屑迸散
      impactFlashRing(at, '#fff6d0');
      flashAt(at);
      for (i = 0; i < 12; i++) {
        ang = Math.PI * 2 * i / 12 + Math.random() * 0.3;
        dist = 18 + Math.random() * 26;
        sparkAt(at, 'sp-metal', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 16);
      }
      var shine = box('bfx-goldshine');
      add(shine, 620);
    } else if (fx === 'sinkhole') {
      // 厚土诀：脚下地面下陷，两侧土石向内合拢
      var hole = box('bfx-sinkhole', at.x, at.y + 14);
      add(hole, 1100);
      for (i = 0; i < 8; i++) {
        (function (idx) {
          var side2 = idx < 4 ? -1 : 1;
          var off = (idx % 4) * 13 + 8;
          var rub = box('bfx-rubble', at.x + side2 * off, at.y + 6 + (idx % 3) * 9);
          rub.style.setProperty('--dx', (-side2 * 16) + 'px');
          rub.style.animationDelay = (idx * 55) + 'ms';
          add(rub, 1100 + idx * 55);
        })(i);
      }
      setTimeout(function () {
        for (i = 0; i < 7; i++) {
          ang = Math.PI * (0.15 + Math.random() * 0.7);
          sparkAt(at, 'sp-rock', Math.cos(ang) * (26 + Math.random() * 16),
                  -Math.abs(Math.sin(ang)) * 18, i * 32);
        }
      }, 220);
      shake(foeSideByAt(at), 1);
    } else if (fx === 'acupoint') {
      // 周天运转：己身一圈穴点依次亮起，再连成一线
      var mx = layer.clientWidth * (at.x > layer.clientWidth / 2 ? 0.22 : 0.78);
      var myy = at.y;
      for (i = 0; i < 9; i++) {
        (function (idx) {
          var aa = -Math.PI / 2 + (idx / 9) * Math.PI * 2;
          var pp = box('bfx-acupoint', mx + Math.cos(aa) * 26, myy + Math.sin(aa) * 30);
          pp.style.animationDelay = (idx * 85) + 'ms';
          add(pp, 1500 + idx * 85);
        })(i);
      }
      setTimeout(function () {
        var ln = box('bfx-meridian', mx, myy);
        add(ln, 900);
      }, 620);
    } else if (fx === 'sprout') {
      // 春回诀：先显枯纹，再抽新芽
      var mx2 = layer.clientWidth * (at.x > layer.clientWidth / 2 ? 0.22 : 0.78);
      var wit = box('bfx-wither', mx2, at.y);
      add(wit, 800);
      for (i = 0; i < 7; i++) {
        (function (idx) {
          var aa2 = -Math.PI / 2 + (idx / 7) * Math.PI * 2;
          var sp2 = box('bfx-sprout', mx2 + Math.cos(aa2) * 24, at.y + 22 + Math.sin(aa2) * 12);
          sp2.style.setProperty('--rot', (Math.cos(aa2) * 26) + 'deg');
          sp2.style.animationDelay = (330 + idx * 70) + 'ms';
          add(sp2, 1500 + idx * 70);
        })(i);
      }
      setTimeout(function () {
        for (i = 0; i < 8; i++) {
          sparkAt({ x: mx2, y: at.y - 10 }, 'sp-leaf',
                  (Math.random() - 0.5) * 46, 14 + Math.random() * 26, i * 60);
        }
      }, 420);
    } else if (fx === 'swordarc') {
      // 本命飞剑：剑光自上方绕一弧贯入
      var arc = box('bfx-swordarc', at.x - 34, at.y - 62);
      add(arc, 760);
      setTimeout(function () {
        var pierce = box('bfx-swordpierce', at.x, at.y);
        add(pierce, 560);
        flashAt(at);
        for (i = 0; i < 7; i++) {
          ang = Math.PI * 2 * i / 7;
          sparkAt(at, 'sp-metal', Math.cos(ang) * 20, Math.sin(ang) * 16, i * 22);
        }
      }, 330);
    } else if (fx === 'flamespiral') {
      // 三昧真火：三簇火苗自下窜起、螺旋合一成柱
      for (i = 0; i < 3; i++) {
        (function (idx) {
          var fl = box('bfx-flamespiral', at.x - 22 + idx * 22, at.y + 24);
          fl.style.setProperty('--sx', ((idx - 1) * 20) + 'px');
          fl.style.animationDelay = (idx * 110) + 'ms';
          add(fl, 1000 + idx * 110);
        })(i);
      }
      setTimeout(function () {
        var pil = box('bfx-flamepillar2', at.x, at.y - 20);
        add(pil, 800);
        for (i = 0; i < 10; i++) {
          ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
          dist = 20 + Math.random() * 26;
          sparkAt(at, 'sp-fire', Math.cos(ang) * dist * 0.8, Math.sin(ang) * dist, i * 26);
        }
      }, 340);
    } else if (fx === 'vinecage') {
      // 青藤缚：四角粗藤升起，交织成笼
      for (i = 0; i < 4; i++) {
        (function (idx) {
          var vx = at.x + (idx < 2 ? -26 : 26);
          var vy = at.y + (idx % 2 === 0 ? -16 : 26);
          var vc = box('bfx-vinecage', vx, vy);
          vc.style.setProperty('--rot', (idx < 2 ? -8 : 8) + 'deg');
          vc.style.animationDelay = (idx * 90) + 'ms';
          add(vc, 1300 + idx * 90);
        })(i);
      }
      setTimeout(function () {
        var lid = box('bfx-vinecage-lid', at.x, at.y - 30);
        add(lid, 1000);
        for (i = 0; i < 7; i++) {
          ang = Math.PI * (0.1 + Math.random() * 0.8);
          sparkAt(at, 'sp-leaf', Math.cos(ang) * (20 + Math.random() * 14),
                  -Math.abs(Math.sin(ang)) * 14, i * 40);
        }
      }, 460);
    } else if (fx === 'cauldron') {
      // 玉髓丹方：一尊丹鼎虚影在己身头顶转一圈、洒下药光
      var mx3 = layer.clientWidth * (at.x > layer.clientWidth / 2 ? 0.22 : 0.78);
      var caul = box('bfx-cauldron', mx3, at.y - 26);
      add(caul, 1500);
      for (i = 0; i < 9; i++) {
        (function (idx) {
          var dd = box('bfx-pilldrop', mx3 + (Math.random() * 40 - 20), at.y - 12);
          dd.style.animationDelay = (300 + idx * 90) + 'ms';
          add(dd, 1500 + idx * 90);
        })(i);
      }
      setTimeout(function () { impactFlashRing({ x: mx3, y: at.y }, '#e8dcc8'); }, 500);
    } else {
      return false;   // 不是这批新增的形态，交回原 impact 处理
    }
    return true;
  }

  /* 命中处一圈泛光（金刚拳等重击的通用配件） */
  function impactFlashRing(at, color) {
    if (!layer) return;
    var r = document.createElement('div');
    r.className = 'bfx-hitring';
    if (color) r.style.color = color;
    r.style.left = at.x + 'px';
    r.style.top = at.y + 'px';
    layer.appendChild(r);
    setTimeout(function () { if (r.parentNode) r.parentNode.removeChild(r); }, 620);
  }
  /* impact 只知道命中点，震屏要按"挨打的是谁"来 —— 命中点在对手半场就震对手 */
  function foeSideByAt(at) {
    try { return at.x < (layer.clientWidth || 300) / 2 ? 'my' : 'op'; } catch (e) { return 'op'; }
  }

  function impact(fx, at, strong) {
    if (!layer) return;
    if (impactNew(fx, at, strong)) return;   // 新增招式形态优先（批次一）
    var k = fx;
    var i, ang, dist;
    if (k === 'leichi') {
      // 九雷连环 + 雷池
      for (i = 0; i < 9; i++) boltAt(at, -26 + (i % 3) * 26, Math.floor(i / 3) * 90 + (i % 3) * 22);
      var lp = document.createElement('div');
      lp.className = 'bfx-leipool';
      lp.style.left = at.x + 'px';
      layer.appendChild(lp);
      (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 800); })(lp);
      flashAt(at);
      for (i = 0; i < 10; i++) {
        ang = Math.PI * 2 * i / 10;
        dist = 26 + Math.random() * 24;
        sparkAt(at, 'sp-thunder', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 24);
      }
    } else if (k === 'giantbolt') {
      var bt = boltAt(at, 0, 0, 3.2);
      flashAt(at);
      for (i = 0; i < 9; i++) {
        ang = Math.PI * 2 * i / 9;
        dist = 24 + Math.random() * 22;
        sparkAt(at, 'sp-thunder', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 22);
      }
    } else if (k === 'fivebolt') {
      var cols = ['#f0e2a0', '#9ed69a', '#a8d8f0', '#f0a87c', '#d8bd8a'];
      for (i = 0; i < 5; i++) {
        var fc = document.createElement('div');
        fc.className = 'bfx-fivebolt-col';
        fc.style.color = cols[i];
        fc.style.left = (at.x - 32 + i * 16) + 'px';
        fc.style.top = at.y + 'px';
        fc.style.animationDelay = (i * 70) + 'ms';
        layer.appendChild(fc);
        (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 900); })(fc);
      }
      flashAt(at);
      for (i = 0; i < 9; i++) {
        ang = Math.PI * 2 * i / 9;
        dist = 24 + Math.random() * 20;
        sparkAt(at, 'sp-thunder', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 20);
      }
    } else if (k === 'swordring') {
      // 五剑齐至：交错斩痕 + 火星
      for (i = 0; i < 3; i++) {
        var sl2 = document.createElement('div');
        sl2.className = 'bfx-slash';
        sl2.style.left = at.x + 'px'; sl2.style.top = at.y + 'px';
        sl2.style.transform = 'rotate(' + (28 + i * 26) + 'deg)';
        sl2.style.animationDelay = (i * 60) + 'ms';
        layer.appendChild(sl2);
        (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 560); })(sl2);
      }
      for (i = 0; i < 10; i++) {
        ang = -0.6 + (Math.random() - 0.5) * 0.7;
        dist = 24 + Math.random() * 26;
        sparkAt(at, 'sp-metal', Math.cos(ang) * dist * (i % 2 ? 1 : -1), Math.sin(ang) * dist, i * 18);
      }
    } else if (k === 'flyingblade') {
      // 刀气贯穿 + 血线
      var bls = document.createElement('div');
      bls.className = 'bfx-slash';
      bls.style.left = at.x + 'px'; bls.style.top = at.y + 'px';
      layer.appendChild(bls);
      (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 560); })(bls);
      var bl = document.createElement('div');
      bl.className = 'bfx-bloodline';
      bl.style.left = at.x + 'px'; bl.style.top = at.y + 'px';
      layer.appendChild(bl);
      (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 620); })(bl);
      // 命中后 0.4s 在目标身上留下一道渐隐刀痕（2.6s）
      (function (p2) {
        setTimeout(function () {
          if (!layer) return;
          var sc = document.createElement('div');
          sc.className = 'bfx-scar';
          sc.style.left = p2.x + 'px'; sc.style.top = p2.y + 'px';
          layer.appendChild(sc);
          setTimeout(function () { if (sc.parentNode) sc.parentNode.removeChild(sc); }, 2800);
        }, 400);
      })(at);
      for (i = 0; i < 10; i++) {
        ang = -0.55 + (Math.random() - 0.5) * 0.5;
        dist = 28 + Math.random() * 26;
        sparkAt(at, 'sp-metal', Math.cos(ang) * dist * (i % 2 ? 1 : -1), Math.sin(ang) * dist, i * 15);
      }
    } else if (k === 'starfingers') {
      var sb2 = document.createElement('div');
      sb2.className = 'bfx-starburst';
      sb2.style.left = at.x + 'px'; sb2.style.top = at.y + 'px';
      layer.appendChild(sb2);
      (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 700); })(sb2);
      var ray = document.createElement('div');
      ray.className = 'bfx-starshot';
      ray.style.left = at.x + 'px'; ray.style.top = at.y + 'px';
      layer.appendChild(ray);
      (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 620); })(ray);
      for (i = 0; i < 9; i++) {
        ang = Math.PI * 2 * i / 9 + 0.2;
        dist = 22 + Math.random() * 22;
        sparkAt(at, 'sp-qi', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 18);
      }
    } else if (k === 'skyfire') {
      // 冲天火柱 + 火苗
      var pil = document.createElement('div');
      pil.className = 'bfx-firepillar';
      pil.style.left = at.x + 'px'; pil.style.top = (at.y + 30) + 'px';
      layer.appendChild(pil);
      (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 900); })(pil);
      for (i = 0; i < 3; i++) {
        var f3 = document.createElement('div');
        f3.className = 'bfx-flame f' + i;
        f3.style.left = (at.x - 16 + i * 16) + 'px';
        f3.style.top = (at.y + 14) + 'px';
        f3.style.animationDelay = (i * 60) + 'ms';
        layer.appendChild(f3);
        (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1000); })(f3);
      }
      for (i = 0; i < 12; i++) {
        ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
        dist = 22 + Math.random() * 30;
        sparkAt(at, 'sp-fire', Math.cos(ang) * dist * 0.8, Math.sin(ang) * dist, i * 22);
      }
    } else if (k === 'prairiefire') {
      for (i = 0; i < 2; i++) {
        var fl2 = document.createElement('div');
        fl2.className = 'bfx-fireline';
        fl2.style.left = at.x + 'px';
        fl2.style.top = (at.y + 34) + 'px';
        if (i === 1) { fl2.style.transform = 'scaleX(-1)'; fl2.style.transformOrigin = 'left center'; }
        fl2.style.animationDelay = (i * 80) + 'ms';
        layer.appendChild(fl2);
        (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1000); })(fl2);
      }
      for (i = 0; i < 10; i++) {
        ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
        dist = 18 + Math.random() * 24;
        sparkAt(at, 'sp-fire', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 26);
      }
    } else if (k === 'whirlpool') {
      for (i = 0; i < 2; i++) {
        var dv = document.createElement('div');
        dv.className = 'bfx-devour';
        dv.style.left = at.x + 'px'; dv.style.top = at.y + 'px';
        dv.style.animationDelay = (i * 120) + 'ms';
        layer.appendChild(dv);
        (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1100); })(dv);
      }
      for (i = 0; i < 10; i++) {
        ang = Math.PI * 2 * i / 10;
        dist = 24 + Math.random() * 18;
        sparkAt(at, 'sp-drop', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 26);
      }
    } else if (k === 'chaos') {
      for (i = 0; i < 2; i++) {
        var cb = document.createElement('div');
        cb.className = 'bfx-chaosburst';
        cb.style.left = at.x + 'px'; cb.style.top = at.y + 'px';
        cb.style.animationDelay = (i * 110) + 'ms';
        layer.appendChild(cb);
        (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1000); })(cb);
      }
      var stg2 = box.querySelector('.bfx-stage');
      if (stg2) { cls(stg2, 'bfx-quake', true); setTimeout(function () { cls(stg2, 'bfx-quake', false); }, 380); }
      for (i = 0; i < 10; i++) {
        ang = Math.PI * 2 * i / 10;
        dist = 22 + Math.random() * 24;
        sparkAt(at, 'sp-qi', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 20);
      }
    } else if (k === 'thunder') {
      for (i = 0; i < 3; i++) boltAt(at, -18 + i * 18, i * 70);
      var fl = document.createElement('div');
      fl.className = 'bfx-flashbig';
      fl.style.setProperty('--fx-x', at.x + 'px');
      fl.style.setProperty('--fx-y', at.y + 'px');
      layer.appendChild(fl);
      (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 520); })(fl);
      for (i = 0; i < 9; i++) {
        ang = Math.PI * 2 * i / 9;
        dist = 22 + Math.random() * 20;
        sparkAt(at, 'sp-thunder', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 20);
      }
    } else if (k === 'blade') {
      var sl = document.createElement('div');
      sl.className = 'bfx-slash';
      sl.style.left = at.x + 'px'; sl.style.top = at.y + 'px';
      layer.appendChild(sl);
      (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 480); })(sl);
      for (i = 0; i < 9; i++) {
        ang = -0.5 + (Math.random() - 0.5) * 0.6;
        dist = 26 + Math.random() * 24;
        sparkAt(at, 'sp-metal', Math.cos(ang) * dist * (i % 2 ? 1 : -1), Math.sin(ang) * dist, i * 16);
      }
    } else if (k === 'star') {
      var sb = document.createElement('div');
      sb.className = 'bfx-starburst';
      sb.style.left = at.x + 'px'; sb.style.top = at.y + 'px';
      layer.appendChild(sb);
      (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 660); })(sb);
      for (i = 0; i < 8; i++) {
        ang = Math.PI * 2 * i / 8 + 0.2;
        dist = 20 + Math.random() * 22;
        sparkAt(at, 'sp-qi', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 18);
      }
    } else if (k === 'fist' || k === 'burst') {
      for (i = 0; i < (k === 'burst' ? 2 : 1); i++) {
        var wv = document.createElement('div');
        wv.className = 'bfx-wave';
        wv.style.left = at.x + 'px'; wv.style.top = at.y + 'px';
        wv.style.animationDelay = (i * 120) + 'ms';
        layer.appendChild(wv);
        (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 900); })(wv);
      }
      var stg = box.querySelector('.bfx-stage');
      if (stg) { cls(stg, 'bfx-quake', true); setTimeout(function () { cls(stg, 'bfx-quake', false); }, 380); }
      for (i = 0; i < 8; i++) {
        ang = Math.PI * 2 * i / 8;
        dist = 20 + Math.random() * 22;
        sparkAt(at, 'sp-qi', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 18);
      }
    } else if (k === 'fireblast') {
      for (i = 0; i < 4; i++) {
        var f2 = document.createElement('div');
        f2.className = 'bfx-flame f' + i;
        f2.style.left = (at.x - 24 + i * 16) + 'px';
        f2.style.top = (at.y + 10) + 'px';
        f2.style.animationDelay = (i * 50) + 'ms';
        f2.style.width = '22px'; f2.style.height = '28px';
        layer.appendChild(f2);
        (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1000); })(f2);
      }
      for (i = 0; i < 12; i++) {
        ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
        dist = 20 + Math.random() * 28;
        sparkAt(at, 'sp-fire', Math.cos(ang) * dist * 0.8, Math.sin(ang) * dist, i * 22);
      }
    } else if (k === 'whirl') {
      for (i = 0; i < 2; i++) {
        var ww = document.createElement('div');
        ww.className = 'bfx-waterwrap' + (i ? ' w2' : '');
        ww.style.left = at.x + 'px'; ww.style.top = at.y + 'px';
        layer.appendChild(ww);
        (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1000); })(ww);
      }
      for (i = 0; i < 9; i++) {
        ang = Math.PI * 2 * i / 9;
        dist = 22 + Math.random() * 18;
        sparkAt(at, 'sp-drop', Math.cos(ang) * dist, Math.sin(ang) * dist - 4, i * 24);
      }
    } else if (k === 'metal') {
      // 白线斩痕 + 直线飞散的火星
      var slash = document.createElement('div');
      slash.className = 'bfx-slash';
      slash.style.left = at.x + 'px'; slash.style.top = at.y + 'px';
      layer.appendChild(slash);
      setTimeout(function () { if (slash.parentNode) slash.parentNode.removeChild(slash); }, 420);
      for (i = 0; i < 8; i++) {
        ang = -0.55 + (Math.random() - 0.5) * 0.5;
        dist = 26 + Math.random() * 22;
        sparkAt(at, 'sp-metal', Math.cos(ang) * dist * (i % 2 ? 1 : -1), Math.sin(ang) * dist, i * 18);
      }
    } else if (k === 'wood') {
      // 藤蔓从命中点攀出 + 落叶
      for (i = 0; i < 3; i++) {
        var vine = document.createElement('div');
        vine.className = 'bfx-vine v' + i;
        vine.style.left = at.x + 'px'; vine.style.top = at.y + 'px';
        layer.appendChild(vine);
        (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1000); })(vine);
      }
      for (i = 0; i < 7; i++) {
        ang = Math.PI * (0.15 + Math.random() * 0.7);
        dist = 18 + Math.random() * 20;
        sparkAt(at, 'sp-leaf', Math.cos(ang) * dist, -Math.abs(Math.sin(ang)) * dist * 0.6, i * 40);
      }
    } else if (k === 'water') {
      // 同心波纹
      for (i = 0; i < 3; i++) {
        var rip = document.createElement('div');
        rip.className = 'bfx-ripple';
        rip.style.left = at.x + 'px'; rip.style.top = at.y + 'px';
        rip.style.animationDelay = (i * 90) + 'ms';
        layer.appendChild(rip);
        (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1100); })(rip);
      }
      for (i = 0; i < 8; i++) {
        ang = Math.PI * 2 * i / 8;
        dist = 20 + Math.random() * 16;
        sparkAt(at, 'sp-drop', Math.cos(ang) * dist, Math.sin(ang) * dist - 6, i * 22);
      }
    } else if (k === 'fire') {
      // 火苗上窜 + 火星
      for (i = 0; i < 3; i++) {
        var flame = document.createElement('div');
        flame.className = 'bfx-flame f' + i;
        flame.style.left = (at.x - 17 + i * 17) + 'px';
        flame.style.top = (at.y + 12) + 'px';
        flame.style.animationDelay = (i * 60) + 'ms';
        layer.appendChild(flame);
        (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1000); })(flame);
      }
      for (i = 0; i < 10; i++) {
        ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        dist = 18 + Math.random() * 26;
        sparkAt(at, 'sp-fire', Math.cos(ang) * dist * 0.8, Math.sin(ang) * dist, i * 26);
      }
    } else if (k === 'earth') {
      // 碎石崩落
      for (i = 0; i < 6; i++) {
        ang = Math.PI * (0.15 + Math.random() * 0.7);
        dist = 24 + Math.random() * 20;
        sparkAt(at, 'sp-rock', Math.cos(ang) * dist, -Math.abs(Math.sin(ang)) * dist * 0.5, i * 30);
      }
      var dust = document.createElement('div');
      dust.className = 'bfx-dust';
      dust.style.left = at.x + 'px'; dust.style.top = (at.y + 18) + 'px';
      layer.appendChild(dust);
      setTimeout(function () { if (dust.parentNode) dust.parentNode.removeChild(dust); }, 900);
    } else {
      // 无相：冲击波 + 气点
      var wave = document.createElement('div');
      wave.className = 'bfx-wave';
      wave.style.left = at.x + 'px'; wave.style.top = at.y + 'px';
      layer.appendChild(wave);
      setTimeout(function () { if (wave.parentNode) wave.parentNode.removeChild(wave); }, 700);
      for (i = 0; i < 7; i++) {
        ang = Math.PI * 2 * i / 7 + Math.random() * 0.4;
        dist = 16 + Math.random() * 20;
        sparkAt(at, 'sp-qi', Math.cos(ang) * dist, Math.sin(ang) * dist, i * 20);
      }
    }
  }

  function shake(side, strong) {
    var el = sideEl(side);
    if (!el) return;
    cls(el, 'bfx-hurt', true);
    if (strong) cls(el, 'bfx-hurt-strong', true);
    setTimeout(function () { cls(el, 'bfx-hurt', false); cls(el, 'bfx-hurt-strong', false); }, 460);
  }

  /* ── 罡气护罩：升起 / 常驻缓转 / 受击涟漪 / 碎裂 ───── */
  function guardNode(side) {
    var d = document.createElement('div');
    d.className = 'bfx-guard guard-' + side;
    d.innerHTML =
      '<div class="guard-dome"></div>' +
      '<div class="guard-shields"><i class="gs s0"></i><i class="gs s1"></i><i class="gs s2"></i><i class="gs s3"></i></div>' +
      '<div class="guard-hex"></div>' +
      '<div class="guard-runegrid"></div>' +
      '<div class="guard-base"></div>';
    return d;
  }
  /** 引擎每帧同步罡气值：>0 起罩，减少时涟漪，归零碎裂 */
  function setShield(side, value) {
    if (!box) return;
    var v = Math.max(0, Math.round(value || 0));
    var prev = guardVal[side] || 0;
    if (v === prev) return;
    guardVal[side] = v;
    var node = guards[side];
    if (v > 0 && !node) {
      node = guardNode(side);
      var st = box.querySelector('.bfx-stage');
      if (st) st.appendChild(node);
      guards[side] = node;
      cls(node, 'guard-up', true);
    } else if (node) {
      if (v <= 0) {
        cls(node, 'guard-break', true);
        guards[side] = null;
        (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 620); })(node);
      } else if (v < prev) {
        cls(node, 'guard-hit', true);
        setTimeout(function () { cls(node, 'guard-hit', false); }, 500);
      } else {
        cls(node, 'guard-bump', true);
        setTimeout(function () { cls(node, 'guard-bump', false); }, 340);
      }
    }
  }

  /* ── 演出一次出招 ─────────────────────────────────── */
  function play(side, card, events, done, onHit) {
    if (!box || !myEl || !opEl) { if (done) done(); return; }
    var me = sideEl(side), foe = foeSide(side);
    var dmgEvent = null, healEvent = null, shieldEvent = null;
    (events || []).forEach(function (e) {
      if (e.type === 'hit') dmgEvent = dmgEvent || e;
      if (e.type === 'heal') healEvent = e;
      if (e.type === 'shield') shieldEvent = e;
    });
    var el = (dmgEvent && dmgEvent.el) || (card && card.el) || null;
    if (el === 'root') el = elem[side] || null;
    var fx = fxOf(card, el);   // 招牌招式走专属形态，其余按五行

    busy = true;
    cls(me, 'bfx-act', true);
    cls(me, shieldEvent ? 'bfx-cast' : 'bfx-lunge', true);

    var steps = [];
    steps.push(function () { return wait(300); });   // 起手
    var ringNode = null;
    if (dmgEvent) {
      if (fx === 'swordring') {
        steps.push(function () {                      // 起剑：五剑绕身
          var host = sideEl(side);
          if (host) {
            ringNode = document.createElement('div');
            ringNode.className = 'bfx-swordring';
            for (var si2 = 0; si2 < 5; si2++) {
              var swd = document.createElement('i');
              swd.style.setProperty('--rot', (si2 * 72) + 'deg');
              swd.style.transform = 'rotate(' + (si2 * 72) + 'deg) translateY(-54px) rotate(90deg)';
              ringNode.appendChild(swd);
            }
            host.appendChild(ringNode);
          }
          return wait(1000);                          // 绕足 1 秒
        });
        steps.push(function () {                      // 齐射
          var from2 = centerOf(side), to2 = centerOf(foe);
          if (ringNode) { cls(ringNode, 'fired', true); }
          for (var qi2 = 0; qi2 < 5; qi2++) {
            (function (n2) {
              setTimeout(function () {
                if (!layer) return;
                spawnFx('swordblade', { x: from2.x + (side === 'my' ? 16 : -16), y: from2.y - 22 + n2 * 11 }, to2, 340);
              }, n2 * 45);
            })(qi2);
          }
          if (ringNode) {
            (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 460); })(ringNode);
            ringNode = null;
          }
          return wait(420);
        });
      } else {
        steps.push(function () {                      // 飞影
          var from = centerOf(side), to = centerOf(foe);
          spawnFx(fx, { x: from.x + (side === 'my' ? 20 : -20), y: from.y }, to, 420);
          return wait(430);
        });
      }
      steps.push(function () {                        // 命中
        var to = centerOf(foe);
        impact(fx, to, dmgEvent.dealt >= 25);
        shake(foe, dmgEvent.dealt >= 25);
        var blocked = dmgEvent.absorbed && !dmgEvent.dealt;
        float(foe, blocked ? ('罡 -' + dmgEvent.absorbed) : ('-' + (dmgEvent.dealt || 0)),
          blocked ? 'block' : (dmgEvent.dealt >= 30 ? 'crit' : 'dmg'));
        if (dmgEvent.elMult > 1) float(foe, '克 制', 'tag');
        else if (dmgEvent.elMult < 1) float(foe, '被 克', 'tag-weak');
        if (dmgEvent.pierce) float(foe, '破 罡', 'tag');
        if (dmgEvent.steal) float(side, '+' + dmgEvent.steal, 'heal');
        if (onHit) onHit();            // 打到身上这一刻，才让血条/罡气跟着变
        return wait(320);
      });
    }
    if (healEvent) steps.push(function () {
      var hkey = fxOf(card, el);
      if (hkey === 'lotus') {
        var host = sideEl(side);
        if (host) {
          var lw = document.createElement('div');
          lw.className = 'bfx-castfx';
          var jets = '<div class="bfx-spring-jet"></div><div class="bfx-spring-pool"></div>';
          for (var si = 0; si < 6; si++) {
            var sa = Math.PI * (0.15 + Math.random() * 0.7);
            jets += '<i class="bfx-spring-drop" style="left:' + (26 + Math.random() * 44) + 'px;top:34px;--sx:' +
              Math.round(Math.cos(sa) * 26) + 'px;--sy:' + Math.round(Math.sin(sa) * 12) + 'px"></i>';
          }
          lw.innerHTML = '<div class="bfx-healpillar"></div>' + jets +
            '<div class="bfx-lotus"><svg viewBox="0 0 96 56">' +
              '<ellipse cx="48" cy="48" rx="34" ry="7" fill="rgba(120,200,140,.25)"/>' +
              '<path d="M48 44 q-6 -28 0 -36 q6 8 0 36" fill="rgba(198,248,212,.9)"/>' +
              '<path d="M48 46 q-16 -19 -27 -17 q7 15 27 17" fill="rgba(164,232,184,.75)"/>' +
              '<path d="M48 46 q16 -19 27 -17 q-7 15 -27 17" fill="rgba(164,232,184,.75)"/>' +
              '<path d="M48 48 q-25 -11 -35 -2 q17 13 35 2" fill="rgba(142,216,166,.6)"/>' +
              '<path d="M48 48 q25 -11 35 -2 q-17 13 -35 2" fill="rgba(142,216,166,.6)"/>' +
              '</svg></div>';
          for (var ri = 0; ri < 8; ri++) {
            var rn = document.createElement('i');
            rn.className = 'bfx-healrain';
            rn.style.left = (12 + Math.random() * 58) + 'px';
            rn.style.top = (4 + Math.random() * 30) + 'px';
            rn.style.animationDelay = (ri * 90) + 'ms';
            lw.appendChild(rn);
          }
          host.appendChild(lw);
          (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 2000); })(lw);
        }
        float(side, '+' + healEvent.amount, 'heal');
        return wait(520);
      }
      healGlow(side, healEvent.amount);
      if (onHit) onHit();
      return wait(340);
    });
    if (shieldEvent) steps.push(function () {
      var gkey = fxOf(card, el);
      if (GUARD_FX[gkey]) guardCast(gkey, side);   // 守式各自动画（护体罡气＝通用罡气护罩）
      float(side, '+' + shieldEvent.amount, 'shield');
      if (onHit) onHit();
      return wait(620);
    });
    if (!dmgEvent && !healEvent && !shieldEvent) steps.push(function () { float(side, '调 息', 'tag-weak'); return wait(300); });
    steps.push(function () { return wait(150); });

    return steps.reduce(function (p, step) {
      return p.then(step).then(function () {});
    }, Promise.resolve()).then(function () {
      cls(me, 'bfx-act', false); cls(me, 'bfx-lunge', false); cls(me, 'bfx-cast', false);
      busy = false;
      if (done) done();
    });
  }

  /* ── 守式专属动画（在自己身上播；护体罡气＝通用罡气护罩） ── */
  var GUARD_FX = { bell: 1, ironbody: 1, xuanwu: 1, sutra: 1, starmap: 1, turtle: 1 };

  function guardCast(key, side) {
    var host = sideEl(side);
    if (!host || !GUARD_FX[key]) return;
    var wrap = document.createElement('div');
    wrap.className = 'bfx-castfx';
    var i, a, html = '';
    if (key === 'bell') {
      wrap.innerHTML = '<div class="bfx-bell"></div><div class="bfx-bell-ring"></div>';
    } else if (key === 'ironbody') {
      html = '<div class="bfx-iron"></div>';
      for (i = 0; i < 7; i++) {
        a = Math.PI * 2 * i / 7 + Math.random() * 0.4;
        html += '<i class="bfx-ironsand" style="left:50%;top:55%;--sx:' + Math.round(Math.cos(a) * 34) + 'px;--sy:' + Math.round(Math.sin(a) * 30) + 'px"></i>';
      }
      wrap.innerHTML = html;
    } else if (key === 'xuanwu') {
      wrap.innerHTML =
        '<div class="bfx-shell-wall"></div>' +
        '<div class="bfx-xuanwu"><svg viewBox="0 0 104 48">' +
          '<ellipse cx="44" cy="28" rx="28" ry="15" fill="rgba(110,155,120,.45)" stroke="#9ec9a6" stroke-width="1.6"/>' +
          '<path d="M44 13 q11 15 0 30" stroke="#9ec9a6" stroke-width="1.1" fill="none" opacity=".8"/>' +
          '<circle cx="76" cy="23" r="6.5" fill="rgba(110,155,120,.5)" stroke="#9ec9a6" stroke-width="1.4"/>' +
          '<path d="M22 40 q-4 5 -11 5" stroke="#9ec9a6" stroke-width="2" fill="none"/>' +
          '<path d="M64 40 q5 5 12 4" stroke="#9ec9a6" stroke-width="2" fill="none"/>' +
          '<path d="M4 34 q18 -20 38 -5 q17 14 33 -7" stroke="#7fb8d6" stroke-width="2.4" fill="none" stroke-dasharray="5 3"/>' +
        '</svg></div>';
    } else if (key === 'sutra') {
      var chars = '金刚不坏般若蜜'.split('');
      html = '<div class="bfx-sutra">';
      for (i = 0; i < chars.length; i++) {
        a = Math.PI * 2 * i / chars.length - Math.PI / 2;
        html += '<span style="left:' + (52 + Math.cos(a) * 46) + 'px;top:' + (52 + Math.sin(a) * 46) + 'px">' + chars[i] + '</span>';
      }
      wrap.innerHTML = html + '</div>';
    } else if (key === 'starmap') {
      var pts = [[12, 26], [30, 20], [44, 27], [60, 22], [76, 29], [90, 24], [104, 33]];
      var d = pts.map(function (p2, i2) { return (i2 ? 'L' : 'M') + p2[0] + ' ' + p2[1]; }).join(' ');
      var dots = pts.map(function (p2) { return '<circle cx="' + p2[0] + '" cy="' + p2[1] + '" r="2.8" fill="#fff6d6"/>'; }).join('');
      wrap.innerHTML = '<div class="bfx-starmap"><svg viewBox="0 0 116 60">' +
        '<path d="' + d + '" stroke="rgba(255,246,214,.75)" stroke-width="1.2" fill="none"/>' + dots +
        '</svg></div><div class="bfx-star-curtain"></div>';
    } else if (key === 'turtle') {
      cls(host, 'bfx-crouch', true);
      setTimeout(function () { cls(host, 'bfx-crouch', false); }, 1400);
      html = '<div class="bfx-turtle-mist"></div>';
      for (i = 0; i < 7; i++) {
        a = Math.PI * 2 * i / 7;
        html += '<i class="bfx-qi-in" style="left:50%;top:52%;--ix:' + Math.round(Math.cos(a) * 72) + 'px;--iy:' + Math.round(Math.sin(a) * 64) + 'px"></i>';
      }
      wrap.innerHTML = html;
    }
    host.appendChild(wrap);
    var life = (key === 'bell' || key === 'xuanwu' || key === 'starmap') ? 2600 : 2000;
    (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, life); })(wrap);
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

  function down(side) {
    var el = sideEl(side);
    if (!el) return;
    cls(el, 'bfx-down', true);
    var gd = guards[side];
    if (gd) { cls(gd, 'guard-break', true); guards[side] = null; }
  }

  g.LS.battleFx = {
    mount: mount, unmount: unmount, play: play, intent: intent, kick: kick,
    float: float, down: down, setShield: setShield,
    get busy() { return busy; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
