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
  let cranePaths = null;                   // 6 帧翅姿 Path2D
  let weather = { kind: 'clear', parts: [], until: 0 }; // A3 天气粒子
  let fireflies = [];                      // 加料：夜间萤火（灵光微点）
  let meteor = null;                       // 加料：流星 {x,y,vx,vy,t0}
  let nextMeteorAt = 0;
  let started = false;

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

  /** 环境渲染帧（15fps）：雾带由 CSS 平移自驱，这里只画鹤与天气粒子 */
  function frame(ts) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (ts - lastFrame < FRAME_MS) return;
    lastFrame = ts;
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);

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
        ctx.strokeStyle = 'rgba(43,43,43,.55)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.stroke(cranePaths[fi]);
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

    // 加料：夜间萤火（晴朗夜，微光缓游，明灭呼吸）
    const nightNow = document.body.classList.contains('night');
    if (nightNow && weather.kind === 'clear') {
      if (fireflies.length < 18 && Math.random() < 0.05) {
        fireflies.push({
          x: Math.random() * w, y: h * (0.35 + Math.random() * 0.5),
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
        const glow = (Math.sin(f.ph) + 1) / 2; // 明灭呼吸
        if (f.x < -20 || f.x > w + 20 || f.y < h * 0.2 || glow < 0.02 && Math.random() < 0.01) {
          fireflies.splice(i, 1); continue;
        }
        ctx.fillStyle = 'rgba(190,220,160,' + (0.14 + glow * 0.5).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * (0.7 + glow * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (fireflies.length) {
      fireflies = []; // 白天/雨雪天萤火隐去
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
    if (running || REDUCED || typeof requestAnimationFrame === 'undefined') return;
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
    if (REDUCED) return;
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
    if (REDUCED || crane || typeof requestAnimationFrame === 'undefined') return;
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
    if (REDUCED) return; // 降级：不烘雾带（保留静态山影）
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

  g.LS.ambient = {
    init, rollWeather, maybeCrane, applyWeather,
    isReduced: () => REDUCED
  };
})(typeof window !== 'undefined' ? window : globalThis);
