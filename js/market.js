/**
 * market.js —— 市场页（v0.22 批二新增）：灵石买卖。
 *  - 买：息壤（即时灵气）/聚灵符（灵气+25% 30min）/悟道茶（修为+20% 60min）——价格锚实时产量，随成长水涨船高；
 *  - 卖：多余丹药换灵石（按品质）、重复非佩戴装备折半回售。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const S = () => g.LS.S;
  const U = () => g.LS.util;

  /** 价格锚（实时产量换算，随成长水涨船高） */
  function priceOf(itemId) {
    const eco = g.LS.economy;
    if (itemId === 'xirang') return Math.max(30, Math.floor(eco.computePerSecond('lingshi') * 480));   // 8 分钟产量
    if (itemId === 'julingfu') return Math.max(60, Math.floor(eco.computePerSecond('lingshi') * 900)); // 15 分钟
    if (itemId === 'wudaocha') return Math.max(120, Math.floor(eco.computePerSecond('lingshi') * 1200)); // 20 分钟
    return 0;
  }

  function buy(itemId) {
    const s = S();
    const eco = g.LS.economy;
    const price = priceOf(itemId);
    if (s.resources.lingshi < price) return { ok: false, msg: '灵石不够（需 ' + U().fmt(price) + '）' };
    const now = Date.now();
    if (itemId === 'xirang') {
      const gain = Math.max(100, Math.floor(eco.computePerSecond('lingqi') * 600));
      s.resources.lingqi += gain;
      return { ok: true, msg: '息壤入土——灵气 +' + U().fmt(gain) + '（10 分钟产量即时到账）' };
    }
    if (itemId === 'julingfu') {
      g.LS.state.addBuff({ id: 'julingfu_buff', mult: 1.25, ts_end: now + 1800000, tag: '灵气' });
      return { ok: true, msg: '聚灵符展开——灵气获取 +25%（30 分钟）' };
    }
    if (itemId === 'wudaocha') {
      g.LS.state.addBuff({ id: 'wudaocha_buff', mult: 1.2, ts_end: now + 3600000, xp_only: true });
      return { ok: true, msg: '悟道茶入喉——修为获取 +20%（60 分钟）' };
    }
    return { ok: false, msg: '查无此货' };
  }

  /** 卖出：多余丹药（非佩戴概念，全部可卖但保留 1 颗珍/仙以下每种？——设计：按品质单价，卖指定品质整批） */
  function sellPill(pillId, quality) {
    const s = S();
    const eco = g.LS.economy;
    const key = eco.pillStockKey ? eco.pillStockKey(pillId, quality) : pillId + '_' + quality;
    const n = (s.pill_stock || {})[key] || 0;
    if (!n) return { ok: false, msg: '没有' + quality + '品存货' };
    const unit = { '劣': 1, '凡': 3, '灵': 8, '珍': 20, '仙': 60 }[quality] || 3;
    const gain = unit * n;
    delete s.pill_stock[key];
    s.resources.lingshi += gain;
    g.LS.save.save();
    return { ok: true, msg: '卖出' + quality + '品丹 ×' + n + '——灵石 +' + U().fmt(gain) };
  }

  /** 卖出：重复非佩戴装备（weapons_owned/techniques_owned 中重复 id 或非当前佩戴的旧档冗余）折半价回售 */
  function sellGear(kind, id) {
    const s = S();
    const cul = g.LS.BAL.cultivation || {};
    const equipped = kind === 'weapon' ? s.equip.weapon : s.equip.technique;
    if (id === equipped) return { ok: false, msg: '此物正在佩戴' };
    const arr = kind === 'weapon' ? s.weapons_owned : s.techniques_owned;
    const pool = kind === 'weapon' ? (cul.weapons || []) : (cul.techniques || []);
    const it = pool.find(x => x.id === id);
    if (!it) return { ok: false, msg: '查无此物' };
    const cnt = arr.filter(x => x === id).length;
    const equippedCnt = arr.filter(x => x === equipped).length;
    if (cnt <= (id === equipped ? 1 : 0)) return { ok: false, msg: '没有多余的可卖' };
    if (cnt <= equippedCnt && id !== equipped) { /* 仅有一件且非佩戴也允许卖（装备自由） */ }
    const gain = Math.max(1, Math.floor((it.price || 0) / 2));
    arr.splice(arr.indexOf(id), 1);
    s.resources.lingshi += gain;
    g.LS.save.save();
    return { ok: true, msg: '回售「' + it.name + '」——灵石 +' + U().fmt(gain) };
  }

  /** 市场页数据（page.js 渲染用） */
  function renderData() {
    const s = S();
    const eco = g.LS.economy;
    const items = [
      { id: 'xirang', name: '息壤', desc: '生生不息之土——10 分钟灵气产量即时入账。', price: priceOf('xirang') },
      { id: 'julingfu', name: '聚灵符', desc: '灵气获取 +25%，持续 30 分钟。', price: priceOf('julingfu') },
      { id: 'wudaocha', name: '悟道茶', desc: '修为获取 +20%，持续 60 分钟。', price: priceOf('wudaocha') }
    ];
    // 可卖丹药汇总
    const sellable = [];
    for (const key of Object.keys(s.pill_stock || {})) {
      const n = s.pill_stock[key];
      if (!n) continue;
      const parts = key.split('_');
      const q = parts[parts.length - 1];
      const id = parts.slice(0, -1).join('_');
      const pill = (g.LS.BAL.pills && g.LS.BAL.pills.pills || []).find(p => p.id === id);
      const unit = { '劣': 1, '凡': 3, '灵': 8, '珍': 20, '仙': 60 }[q] || 3;
      sellable.push({ key, name: (pill ? pill.name : id) + '·' + q + '品 ×' + n, gain: unit * n });
    }
    // 可卖重复装备（同 id 多于 1 件，或非佩戴件）
    const cul = g.LS.BAL.cultivation || {};
    const gearSell = [];
    const pushGear = (kind, arr, pool) => {
      const cnt = {};
      arr.forEach(id => { cnt[id] = (cnt[id] || 0) + 1; });
      Object.keys(cnt).forEach(id => {
        const it = pool.find(x => x.id === id);
        if (!it) return;
        const equipped = kind === 'weapon' ? s.equip.weapon : s.equip.technique;
        const keep = id === equipped ? 1 : 0;
        const extra = cnt[id] - keep;
        if (extra > 0) gearSell.push({ kind, id, name: it.name + (extra > 1 ? ' ×' + extra : ''), gain: Math.max(1, Math.floor((it.price || 0) / 2)) });
      });
    };
    pushGear('weapon', s.weapons_owned || [], cul.weapons || []);
    pushGear('technique', s.techniques_owned || [], cul.techniques || []);
    return { items, sellable, gearSell };
  }

  g.LS.market = { priceOf, buy, sellPill, sellGear, renderData };
})(typeof window !== 'undefined' ? window : globalThis);
