/**
 * util.js —— 通用工具：随机、权重抽取、格式化、clamp（无业务逻辑）。
 * 双端守卫：浏览器 <script> 与 Node require 共用。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const UNITS = [[1e32, '沟'], [1e28, '穰'], [1e24, '秭'], [1e20, '垓'], [1e16, '京'], [1e12, '兆'], [1e8, '亿'], [1e4, '万']];

  function trimZeros(s) { return s.replace(/\.?0+$/, ''); }

  /** 大数格式化：万/亿/兆/京…，非有限值输出 '--' */
  function fmt(n) {
    if (n === null || n === undefined || !isFinite(n)) return '--';
    const neg = n < 0; n = Math.abs(n);
    let out;
    if (n < 1e4) {
      out = (n < 100 && n % 1 !== 0) ? (Math.round(n * 10) / 10).toFixed(1) : String(Math.floor(n));
    } else {
      for (const pair of UNITS) {
        if (n >= pair[0]) { out = trimZeros((n / pair[0]).toFixed(2)) + pair[1]; break; }
      }
      if (!out) out = n.toExponential(2);
    }
    return (neg ? '-' : '') + out;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

  let _uid = 0;
  function uid() { return 'e' + Date.now().toString(36) + (++_uid).toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

  function weightedPick(items, weightFn) {
    let total = 0;
    for (const it of items) total += weightFn(it);
    if (total <= 0) return items.length ? items[items.length - 1] : null;
    let r = Math.random() * total;
    for (const it of items) { r -= weightFn(it); if (r <= 0) return it; }
    return items[items.length - 1];
  }

  function mapMap(obj, fn) {
    const out = {};
    for (const k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = fn(k, obj[k]);
    return out;
  }

  /** 时长（秒）→ 修仙味中文（8 小时 = 8 个时辰，与文案包一致） */
  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return h + ' 个时辰' + (m ? '又 ' + m + ' 分' : '');
    if (m > 0) return m + ' 分钟' + (s ? '又 ' + s + ' 秒' : '');
    return s + ' 秒';
  }

  /* ── 游戏历法（山中无甲子）：现实 1 秒 = 游戏 1 天，按 balance.json game_time 换算 ── */

  const CN_DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const CN_MONTH = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];

  function numToCn(n) {
    n = Math.max(0, Math.floor(n));
    if (n < 10) return CN_DIGIT[n];
    if (n < 20) return n === 10 ? '十' : '十' + CN_DIGIT[n % 10];
    if (n < 100) return CN_DIGIT[Math.floor(n / 10)] + '十' + (n % 10 ? CN_DIGIT[n % 10] : '');
    return String(n);
  }

  /** 游戏天总数 → 「灵曜三年·冬月廿一」 */
  function fmtGameDate(totalDays) {
    const gt = (g.LS.BAL && g.LS.BAL.game_time) || {};
    const yLen = gt.months_per_year || 12;
    const dLen = gt.days_per_month || 30;
    totalDays = Math.max(0, Math.floor(totalDays));
    const year = (gt.start_year || 1) + Math.floor(totalDays / (yLen * dLen));
    const dayOfYear = totalDays % (yLen * dLen);
    const month = Math.floor(dayOfYear / dLen);
    const day = dayOfYear % dLen + 1;
    return (gt.year_name || '灵曜') + numToCn(year) + '年·' + (CN_MONTH[month] || (month + 1) + '月') + numToCn(day) + '日';
  }

  /** 游戏天总数 → 时长中文：「三载零二月」/「八月」/「廿五日」 */
  function fmtGameDur(totalDays) {
    const gt = (g.LS.BAL && g.LS.BAL.game_time) || {};
    const yLen = gt.months_per_year || 12;
    const dLen = gt.days_per_month || 30;
    totalDays = Math.max(0, Math.floor(totalDays));
    const years = Math.floor(totalDays / (yLen * dLen));
    const months = Math.floor((totalDays % (yLen * dLen)) / dLen);
    const days = totalDays % dLen;
    const parts = [];
    if (years) parts.push(numToCn(years) + '载');
    if (months) parts.push((years ? '零' : '') + numToCn(months) + '月');
    if (days || !parts.length) parts.push(numToCn(days) + '日');
    return parts.join('');
  }

  g.LS.util = { fmt, clamp, rand, randInt, uid, weightedPick, mapMap, fmtDur, fmtGameDate, fmtGameDur, numToCn, trimZeros };
})(typeof window !== 'undefined' ? window : globalThis);
