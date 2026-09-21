/**
 * ambient.js —— 环境动画层：云雾流动 / 墨鹤偶现 / 风霜雨雪。
 * 硬约束：独立 Canvas、环境 rAF 全局 15fps 节流、切后台即停、prefers-reduced-motion 全降级、
 * 零图片文件（离屏 Canvas 程序化生成）、不触碰 250ms 主循环（天气判定借用主循环，渲染自驱）。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const REDUCED = (typeof matchMedia !== 'undefined') && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FPS = 15;
  const FRAME_MS = 1000 / FPS;

  let cv = null, ctx = null;
  let cloudFar = null, cloudNear = null;   // A1 两条预渲染雾带（离屏）
  let rafId = 0, lastFrame = 0;
  let running = false;
  let crane = null;                        // A2 墨鹤 {x,y,dir,frame,t0}
  /* 6 帧翅姿 Path2D —— 侧视线描墨鹤：长颈前伸带喙、双翼上下扇动、尾羽后掠。
     2026-09-20 补全：原先这里只声明为 null、全文再没赋过值，
     于是 frame() 每帧对 null 取下标抛 TypeError，并连带跳过其后的天气粒子。 */
  const cranePaths = (function () {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const ang = Math.sin((i / 6) * Math.PI * 2);
      const wy = -7 + ang * 10;            // 翅尖高度：-17（上举）～ +3（下压到身下），否则下压帧与身体重叠看不出扇动
      const p = new Path2D();
      // 颈（短而带弧，前伸）与头喙
      p.moveTo(3.6, -0.8);
      p.bezierCurveTo(6.6, -2.4, 9.4, -4.4, 11.8, -4.6);
      p.lineTo(14.2, -4.2);
      // 背与腹（小而扁的身）
      p.moveTo(-3, -1.4);
      p.quadraticCurveTo(0.5, -2.4, 3.8, -1.6);
      p.moveTo(-3, 1);
      p.quadraticCurveTo(0.5, 1.6, 3.6, 0.6);
      // 双翼：自背部中段向后扇（主翅长、副翅短且略前）
      p.moveTo(0.6, -1.8);
      p.quadraticCurveTo(-3.2, wy * 0.5, -6.8, wy);
      p.moveTo(2.4, -1.4);
      p.quadraticCurveTo(0.8, wy * 0.6, -1.2, wy * 0.72);
      // 尾羽（一笔后掠）
      p.moveTo(-3, 0.4);
      p.quadraticCurveTo(-5.6, 1.0, -7.6, 1.5);
      // 腿（一笔后伸，飞鹤的辨识特征）
      p.moveTo(-2.2, 0.9);
      p.lineTo(-6.4, 2.7);
      out.push(p);
    }
    return out;
  })();
  let weather = { kind: 'clear', parts: [], until: 0 }; // A3 天气粒子
  let fireflies = [];                      // 加料：夜间萤火（灵光微点）
  let meteor = null;                       // 加料：流星 {x,y,vx,vy,t0}
  let nextMeteorAt = 0;
  let started = false;
  let lowFx = false;               // 低性能模式：停环境 canvas / 天气粒子 / 云幕烘焙

  function seedRand(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /** A1：把一条雾带（6~10 个 radialGradient 墨团）烘到离屏 Canvas，宽 2 倍视口 */
  function bakeCloudBand(height, seedOffset, alpha, puffs) {
    const w = Math.max(1200, window.innerWidth * 2);
    const c = document.createElement('canvas');
    c.width = w; c.height = height;
    const cx = c.getContext('2d');
    const rnd = seedRand((g.LS.BAL.bg && g.LS.BAL.bg.seed || 42) + seedOffset);
    for (let i = 0; i < puffs; i++) {
      const px = rnd() * w;
      const py = height * (0.3 + rnd() * 0.5);
      const r = height * (0.25 + rnd() * 0.45);
      const grd = cx.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, 'rgba(245,240,230,' + (alpha * (0.5 + rnd() * 0.5)).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(245,240,230,0)');
      cx.fillStyle = grd;
      cx.beginPath();
      cx.ellipse(px, py, r * (1.4 + rnd()), r, 0, 0, Math.PI * 2);
      cx.fill();
    }
    return c;
  }

  /** A2：墨鹤 6 帧翅姿 Path2D（简笔三笔：翅弧/身/颈），坐标系 0~40 */
  function bakeCraneFrames() {
    const frames = [];
    const wing = [
      'M6 22 Q16 8 30 14',   // 上扬
      'M6 20 Q16 12 30 16',
      'M6 20 Q16 16 30 18',  // 平
      'M6 20 Q16 20 30 20',
      'M6 20 Q16 24 30 24',  // 下压
      'M6 20 Q16 18 30 17'
    ];
    for (let f = 0; f < 6; f++) {
      const p = new Path2D();
      p.addPath(new Path2D(wing[f]));                    // 翅
      p.addPath(new Path2D('M28 18 Q34 16 38 18 L36 22 Q30 24 26 22 Z')); // 身
      p.addPath(new Path2D('M38 18 Q42 17 40 14'));      // 颈喙
      frames.push(p);
    }
    return frames;
  }

  /* ── 太极小人 v2：IK 反向运动学云手（pelican 手法移植） ──
   * 双手端点沿胸前两个相交圆轨迹运动（云手），肘部由两连杆 IK 解算；
   * 呼吸起伏 + 随机眨眼 + 中咒/跪姿时冻结摆臂。 */
  const monkIK = {
    init: false,
    els: {},
    th: 0,
    L1: 9.5, L2: 9.5,
    shoulders: { near: { x: 21.5, y: 19 }, far: { x: 26.5, y: 19.4 } },
    blinkAt: 0
  };

  function monkKneeOf(h, p) {
    const dx = p.x - h.x, dy = p.y - h.y;
    const d = Math.min(Math.hypot(dx, dy), monkIK.L1 + monkIK.L2 - 0.01);
    const a = (monkIK.L1 * monkIK.L1 - monkIK.L2 * monkIK.L2 + d * d) / (2 * d);
    const hgt = Math.sqrt(Math.max(0, monkIK.L1 * monkIK.L1 - a * a));
    const ux = dx / d, uy = dy / d;
    const mx = h.x + a * ux, my = h.y + a * uy;
    const k1 = { x: mx - hgt * uy, y: my + hgt * ux };
    const k2 = { x: mx + hgt * uy, y: my - hgt * ux };
    return k1.x < k2.x ? k1 : k2;
  }

  function monkIKInit() {
    if (monkIK.init || typeof document === 'undefined') return;
    const svg = document.getElementById('monk-ik');
    if (!svg) return;
    monkIK.init = true;
    monkIK.els = {
      armN: document.getElementById('monk-armN'),
      armF: document.getElementById('monk-armF'),
      handN: document.getElementById('monk-handN'),
      handF: document.getElementById('monk-handF'),
      eyes: document.getElementById('monk-eyes'),
      body: document.getElementById('taichi-monk')
    };
  }

  function monkIKStep(dtSec) {
    monkIKInit();
    const E = monkIK.els;
    if (!E.armN) return;
    const s = g.LS.S;
    const now = Date.now();
    // 中咒或跪地（天劫失败）时收手定格，不摆
    const frozen = s.buffs.some(b => b.id === 'qihuo_debuff' || b.id === 'xinmo_debuff') ||
      E.body.classList.contains('kneel');
    if (!frozen) monkIK.th += dtSec * 1.4; // 云手角速度
    const th = monkIK.th;
    const S2 = s2 => ({ x: 24 + 9.5 * Math.cos(s2), y: 25 + 7 * Math.sin(s2) });
    // 双手沿胸前圆轨迹，相位差 π（云手交替）
    const pN = S2(th);
    const pF = S2(th + Math.PI);
    for (const [arm, hand, shoulder, p] of [
      [E.armN, E.handN, monkIK.shoulders.near, pN],
      [E.armF, E.handF, monkIK.shoulders.far, pF]
    ]) {
      const k = monkKneeOf(shoulder, p);
      arm.setAttribute('points', shoulder.x + ',' + shoulder.y + ' ' + k.x.toFixed(1) + ',' + k.y.toFixed(1) + ' ' + p.x.toFixed(1) + ',' + p.y.toFixed(1));
      hand.setAttribute('cx', p.x.toFixed(1));
      hand.setAttribute('cy', p.y.toFixed(1));
    }
    // 呼吸起伏
    E.body.querySelector('.monk-svg').style.transform =
      'translateY(' + (Math.sin(now / 900) * 1.4).toFixed(2) + 'px)';
    // 随机眨眼
    if (now > monkIK.blinkAt) {
      E.eyes.style.transform = 'scaleY(0.12)';
      E.eyes.style.transformOrigin = '24px 8px';
      setTimeout(() => { E.eyes.style.transform = 'none'; }, 140);
      monkIK.blinkAt = now + 2600 + Math.random() * 2800;
    }
  }

  /** 环境渲染帧（15fps）：雾带由 CSS 平移自驱，这里画鹤、天气粒子、小人 IK 云手 */
  function frame(ts) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (ts - lastFrame < FRAME_MS) return;
    lastFrame = ts;
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);

    // 小人 IK 云手（DOM 操作与 Canvas 粒子共用 15fps 节拍）
    try { monkIKStep(FRAME_MS / 1000); } catch (e) { /* 失败不影响游戏 */ }

    // A2 墨鹤
    if (crane) {
      const t = (Date.now() - crane.t0) / 1000;
      if (t > 8) { crane = null; }
      else {
        const x = crane.dir > 0 ? t / 8 * (w + 80) - 40 : w + 40 - t / 8 * (w + 80);
        const y = crane.y + Math.sin(t * 1.6) * 14;    // 之字起伏
        const fi = Math.floor(t * 4) % 6;
        ctx.save();
        ctx.translate(x, y);
        if (crane.dir < 0) ctx.scale(-1, 1);
        // 墨色随昼夜翻转：夜间深墨看不见，改用浅墨。
        // 注意 night 这个 class 挂在 <html> 上（见 js/ui.js:628 的判定方式），body 上并没有，
        // 只查 body 会永远得 false —— 两处都查才稳。
        const nightNow = document.documentElement.classList.contains('night') ||
                         document.body.classList.contains('night');
        // 注意：墨鹤画在 z-index:0 的背景 canvas 上，其上是 #ms-scene 场景层（云雾/山影），
        // 所以实际可见度会被压一层 —— 这里给足亮度，落到眼睛里才是「淡墨」而不是「看不见」
        ctx.strokeStyle = nightNow ? 'rgba(255,251,240,.95)' : 'rgba(43,43,43,.55)';
        ctx.lineWidth = nightNow ? 2.9 : 2.4;
        ctx.lineCap = 'round';
        ctx.scale(1.45, 1.45);      // 原路径约 32px，放大后约 46px
        if (cranePaths) ctx.stroke(cranePaths[fi]);
        ctx.restore();
      }
    }

    // A3 天气粒子（15fps 内各自推进）
    if (weather.kind !== 'clear' && weather.parts.length) {
      const now = Date.now();
      for (const p of weather.parts) {
        p.x += p.vx; p.y += p.vy;
        if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
        if (p.x > w + 10) p.x = -10;
        if (p.x < -10) p.x = w + 10;
        if (weather.kind === 'rain') {
          ctx.strokeStyle = 'rgba(43,43,43,.30)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 1.6, p.y - p.vy * 1.6);
          ctx.stroke();
        } else if (weather.kind === 'snow') {
          ctx.fillStyle = 'rgba(245,240,230,.85)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 加料：灵光微尘——夜里萤火（青绿缓游）、白天金尘（暖金细点），全时段都有生命感
    const nightNow = document.body.classList.contains('night');
    if (weather.kind === 'clear') {
      const want = nightNow ? 18 : 12;
      if (fireflies.length < want && Math.random() < 0.05) {
        fireflies.push({
          x: Math.random() * w, y: h * (0.25 + Math.random() * 0.6),
          a: Math.random() * Math.PI * 2, sp: 0.15 + Math.random() * 0.25,
          ph: Math.random() * Math.PI * 2, r: 1.2 + Math.random() * 1.4
        });
      }
      for (let i = fireflies.length - 1; i >= 0; i--) {
        const f = fireflies[i];
        f.a += (Math.random() - 0.5) * 0.6;
        f.x += Math.cos(f.a) * f.sp;
        f.y += Math.sin(f.a) * f.sp * 0.6;
        f.ph += 0.04;
        const glow = (Math.sin(f.ph) + 1) / 2;
        if (f.x < -20 || f.x > w + 20 || f.y < h * 0.12 || f.y > h * 0.95 || (glow < 0.02 && Math.random() < 0.01)) {
          fireflies.splice(i, 1); continue;
        }
        if (nightNow) {
          ctx.fillStyle = 'rgba(190,220,160,' + (0.14 + glow * 0.5).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * (0.7 + glow * 0.6), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(184,134,11,' + (0.08 + glow * 0.22).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (fireflies.length) {
      fireflies = []; // 雨雪天微尘隐去
    }

    // 加料：流星（夜间偶发，一道细光斜划 0.7s）
    if (nightNow && !meteor) {
      const nowMs = Date.now();
      if (!nextMeteorAt) nextMeteorAt = nowMs + 30000 + Math.random() * 90000;
      if (nowMs >= nextMeteorAt) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        meteor = { x: w * (0.2 + Math.random() * 0.6), y: h * (0.05 + Math.random() * 0.18), vx: 9 * dir, vy: 4.5, t0: nowMs };
        nextMeteorAt = nowMs + 45000 + Math.random() * 120000;
      }
    }
    if (meteor) {
      const t = (Date.now() - meteor.t0) / 1000;
      if (t > 0.7) meteor = null;
      else {
        meteor.x += meteor.vx; meteor.y += meteor.vy;
        const fade = 1 - t / 0.7;
        const grad = ctx.createLinearGradient(meteor.x, meteor.y, meteor.x - meteor.vx * 14, meteor.y - meteor.vy * 14);
        grad.addColorStop(0, 'rgba(245,240,230,' + (0.85 * fade).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(245,240,230,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(meteor.x, meteor.y);
        ctx.lineTo(meteor.x - meteor.vx * 14, meteor.y - meteor.vy * 14);
        ctx.stroke();
      }
    }
  }

  function startRaf() {
    if (running || REDUCED || lowFx || typeof requestAnimationFrame === 'undefined') return;
    running = true;
    lastFrame = 0;
    rafId = requestAnimationFrame(frame);
  }
  function stopRaf() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (cv && cv.getContext) ctx.clearRect(0, 0, cv.width, cv.height);
  }

  /** A3：天气翻新（现实 2~5 分钟一换——游戏历法 1 秒=1 天，不能按游戏日翻，否则天气每秒都在变） */
  function rollWeather(gameDays) {
    const s = g.LS.S;
    if (!s) return 'clear';
    if (!s.weather_state) s.weather_state = { kind: 'clear', until: 0 };
    const ws = s.weather_state;
    const now = Date.now();
    if (now < (ws.until || 0)) return ws.kind; // 未到翻新时间
    const r = Math.random();
    let kind = 'clear';
    if (r < 0.18) kind = 'rain';
    else if (r < 0.30) kind = 'snow';
    else if (r < 0.42) kind = 'fog';
    ws.kind = kind;
    ws.until = now + (120 + Math.random() * 180) * 1000;
    applyWeather(kind);
    // 志怪笔记：天气翻新时记一句（晴天不记）
    if (kind !== 'clear' && g.LS.ui && g.LS.ui.pushLog) {
      const notes = (g.LS.BAL.help && g.LS.BAL.help.weather_notes) || {};
      const pool = notes[kind] || [];
      if (pool.length) g.LS.ui.pushLog({ title: '天时', choice: pool[Math.floor(Math.random() * pool.length)], gainText: '' });
    }
    return kind;
  }

  /** 应用天气：粒子生成 / 雾化降对比 / 清空 */
  function applyWeather(kind) {
    if (!cv) return;
    weather.kind = kind;
    weather.parts = [];
    if (REDUCED || lowFx) { weather.parts = []; return; }
    const w = cv.width, h = cv.height;
    if (kind === 'rain') {
      for (let i = 0; i < 100; i++) {
        weather.parts.push({ x: Math.random() * w, y: Math.random() * h, vx: 2.2, vy: 7 + Math.random() * 3 });
      }
    } else if (kind === 'snow') {
      for (let i = 0; i < 80; i++) {
        weather.parts.push({ x: Math.random() * w, y: Math.random() * h, vx: Math.sin(i) * 0.4, vy: 0.6 + Math.random() * 0.6, r: 1 + Math.random() * 1.6 });
      }
    }
    // fog：背景容器降对比（对 canvas 元素本体加滤镜，粒子层不管）
    cv.style.filter = kind === 'fog' ? 'contrast(.72) opacity(.85)' : '';
    startRaf();
  }

  /** A2：尝试放一只鹤（3~8 分钟一遇，主循环每分钟调一次） */
  function maybeCrane() {
    if (REDUCED || lowFx || crane || typeof requestAnimationFrame === 'undefined') return;
    if (Math.random() < 0.22) {
      crane = {
        y: window.innerHeight * (0.12 + Math.random() * 0.22),
        dir: Math.random() < 0.5 ? 1 : -1,
        t0: Date.now()
      };
      startRaf();
    }
  }

  /** 初始化：建 Canvas、烘雾带、挂 CSS 循环；resize 防抖重建 */
  function init() {
    if (started || typeof document === 'undefined') return;
    started = true;
    const bg = document.getElementById('bg');
    if (!bg) return;
    cv = document.createElement('canvas');
    cv.id = 'ambient';
    cv.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none';
    document.body.insertBefore(cv, bg.nextSibling);
    ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', () => {
      clearTimeout(init._rt);
      init._rt = setTimeout(resize, 250);
    });
    // 切后台暂停一切环境动画（visibilitychange 与页面隐藏）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopRaf();
      else if (weather.kind !== 'clear' || crane) startRaf();
    });
    window.addEventListener('pagehide', stopRaf);
  }

  function resize() {
    if (!cv) return;
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    if (REDUCED || lowFx) return; // 降级 / 低性能模式：不烘雾带（保留静态山影）
    // A1 两条雾带：远 150s/循环、近 90s/循环
    if (cloudFar) cloudFar.remove();
    if (cloudNear) cloudNear.remove();
    cloudFar = bakeCloudBand(300, 7, 0.55, 9);
    cloudNear = bakeCloudBand(240, 13, 0.75, 7);
    cloudFar.className = 'cloud-band cloud-far';
    cloudNear.className = 'cloud-band cloud-near';
    document.body.insertBefore(cloudFar, cv);
    document.body.insertBefore(cloudNear, cv);
  }

  /** 低性能模式开关（设置面板调用）：开则停掉环境 rAF、天气粒子与萤火，并清掉雾带 */
  function setLowFx(on) {
    lowFx = !!on;
    if (lowFx) {
      stopRaf();
      fireflies = [];
      weather.parts = [];
      if (cloudFar) { cloudFar.remove(); cloudFar = null; }
      if (cloudNear) { cloudNear.remove(); cloudNear = null; }
      if (cv) cv.style.filter = '';
    } else {
      resize();                                   // 关掉低性能模式：重烘雾带
      if (weather.kind !== 'clear') applyWeather(weather.kind);
      else if (crane) startRaf();
    }
  }

  g.LS.ambient = {
    init, rollWeather, maybeCrane, applyWeather, setLowFx,
    isReduced: () => REDUCED
  };
})(typeof window !== 'undefined' ? window : globalThis);
