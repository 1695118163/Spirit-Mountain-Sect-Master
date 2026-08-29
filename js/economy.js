/**
 * economy.js —— 经济引擎：产量计算（唯一出口 computePerSecond）、成本公式、买卖建筑、支付/发放、
 * 吐纳点击、炼丹推进、传承兑换。
 *
 * computePerSecond 乘算顺序（全游戏唯一实现，禁另写第二份）：
 *   第1步 基础产量  base = Σ_b 建筑b.count × rate[res]        （F 类停产建筑跳过）
 *   第2步 建筑自身平加（本作无独立 flat 项，预留）
 *   第3步 境界被动  × realmMult()
 *   第4步 永久加成  × (1 + perm_bonus.all + perm_bonus[res])
 *   第5步 传承加成  × prestigeMult(res)
 *   第6步 临时Buff  × Π buff.mult（按 S.buffs 数组顺序遍历，杜绝浮点顺序歧义）
 *   第7步 模式系数  × modeFactor（online=1；offline=离线效率）
 * 平加（flat）一律并入第 1~2 步，乘算从第 3 步开始且顺序永不动。
 * 修为特殊：每秒修为 = 灵气每秒产量(含 mode) × 0.1 × 修为加成（剑冢/洞府/悟性）。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  function BAL() { return g.LS.BAL; }
  function S() { return g.LS.S; }
  function bLevel(id) { const b = S().buildings[id]; return b || 0; }

  function hasPrestige(id) { return S().prestige.bought.indexOf(id) !== -1; }

  /** 境界总乘算 = 各段 mult_passive 叠乘（realm.js 提供，Node 下防未加载直接内联兜底） */
  function realmMultSafe() {
    if (g.LS.realm && g.LS.realm.realmMult) return g.LS.realm.realmMult();
    const realms = BAL().realms;
    let m = 1;
    for (let k = 1; k <= S().realm.index; k++) m *= realms[k].mult_passive;
    return m;
  }

  /** 第5步：传承对资源的乘算（灵根·木→灵气类建筑、灵根·金→灵石类建筑；悟性→修为在 xiuMult 内） */
  function prestigeMult(res) {
    let m = 1;
    if (res === 'lingqi' && hasPrestige('linggen_mu')) m *= 1.25;
    if (res === 'lingshi' && hasPrestige('linggen_jin')) m *= 1.25;
    return m;
  }

  /** 修为获取总加成：剑冢 +10%/级、洞府 +25%/级（乘算）、悟性 ×1.5 */
  function xiuMult() {
    let m = 1;
    m *= 1 + 0.1 * bLevel('jianzhong');
    m *= 1 + 0.25 * bLevel('dongfu');
    if (hasPrestige('wuxing')) m *= 1.5;
    return m;
  }

  function stalled(id, now) {
    const st = S().building_stalls;
    return !!(st && st[id] && st[id] > now);
  }

  /**
   * 唯一产量出口。opts: { mode:'online'|'offline', efficiency:Number }
   * 返回 每秒产量（xiufu 为每秒修为；danyao 为理论颗/秒，实际产出走 pillTick）。
   */
  function computePerSecond(resId, opts) {
    const bal = BAL(), s = S();
    const now = (opts && opts.now) || Date.now();
    const mode = (opts && opts.mode) || 'online';
    const modeFactor = mode === 'offline' ? (opts && opts.efficiency) || 0.5 : 1;

    if (resId === 'chuancheng') return 0;

    if (resId === 'danyao') {
      const n = bLevel('liandanlu');
      if (!n) return 0;
      return n / pillInterval();
    }

    if (resId === 'xiufu') {
      const qiRate = computePerSecond('lingqi', opts);
      return qiRate * bal.xiuwei_rate_factor * xiuMult();
    }

    // 第1步：基础产量
    let base = 0;
    for (const b of bal.buildings) {
      const rate = b.effects && b.effects.rate && b.effects.rate[resId];
      if (!rate) continue;
      if (stalled(b.id, now)) continue; // F 类建筑异常：停产
      base += bLevel(b.id) * rate;
    }

    // 第3~6步：乘算层
    let v = base;
    v *= realmMultSafe();
    v *= 1 + (s.perm_bonus.all || 0) + (s.perm_bonus[resId] || 0);
    v *= prestigeMult(resId);
    for (const buff of s.buffs) {
      if (buff.mult && buff.ts_end > now) v *= buff.mult;
    }
    // 第7步：模式系数
    v *= modeFactor;
    return v;
  }

  /* ── 点击产量 ── */

  function prestigeClickMult() {
    let m = 1;
    if (hasPrestige('chuwu')) m *= 2;
    if (hasPrestige('shenru')) m *= 3;
    return m;
  }

  function clickMult(now) {
    now = now || Date.now();
    let m = 1 + 0.1 * bLevel('lingshoulan');
    m *= realmMultSafe();
    m *= 1 + (S().perm_bonus.all || 0);
    for (const buff of S().buffs) {
      if (buff.ts_end <= now) continue;
      if (buff.mult) m *= buff.mult;
      if (buff.click_mult) m *= buff.click_mult;
    }
    m *= prestigeClickMult();
    return m;
  }

  /** 吐纳点击灵气 = (1 + 吐纳法等级) × 点击乘算 */
  function clickQiGain(now) {
    const bal = BAL();
    const tunafa = bal.buildings[0]; // 吐纳法恒为第一条
    const base = bal.click.qi_base + (tunafa.effects.click_qi_per_level || 0) * bLevel('tunafa');
    return base * clickMult(now);
  }

  /** 吐纳点击修为 = 0.5 × 吐纳法等级 × 修为加成 × buff（不乘境界叠乘：境界被动作用于全局产量，点击修为自成线性成长线） */
  function clickXpGain(now) {
    now = now || Date.now();
    const lv = bLevel('tunafa');
    if (!lv) return 0;
    let m = BAL().click.xp_per_tunafa_level * lv;
    m *= xiuMult() * (1 + (S().perm_bonus.all || 0) + (S().perm_bonus.xiufu || 0));
    for (const buff of S().buffs) {
      if (buff.ts_end > now && buff.mult) m *= buff.mult;
    }
    return m;
  }

  /** 吐纳一次：返回 {qi, xp} 实际入账 */
  function breath() {
    const s = S();
    const now = Date.now();
    const qi = clickQiGain(now);
    const xp = clickXpGain(now);
    s.resources.lingqi += qi;
    s.resources.xiufu += xp;
    s.stats.clicks += 1;
    return { qi, xp };
  }

  /* ── 成本与支付 ── */

  /** 单价：首级成本 × 增长系数^已拥有数 */
  function buildingCost(bId) {
    const b = BAL().buildings.find(x => x.id === bId);
    const n = bLevel(bId);
    const out = {};
    for (const res in b.base_cost) {
      out[res] = Math.floor(b.base_cost[res] * Math.pow(b.cost_growth, n));
    }
    return out;
  }

  /** 批量 k 的总价 = 等比求和：base × g^n × (g^k - 1) / (g - 1) */
  function bulkCost(bId, k) {
    const b = BAL().buildings.find(x => x.id === bId);
    const n = bLevel(bId);
    const grow = b.cost_growth;
    const out = {};
    for (const res in b.base_cost) {
      out[res] = Math.floor(b.base_cost[res] * Math.pow(grow, n) * (Math.pow(grow, k) - 1) / (grow - 1));
    }
    return out;
  }

  function canAfford(costMap) {
    const s = S();
    for (const res in costMap) {
      if ((s.resources[res] || 0) < costMap[res]) return false;
    }
    return true;
  }

  function pay(costMap) {
    const s = S();
    for (const res in costMap) s.resources[res] = (s.resources[res] || 0) - costMap[res];
  }

  function grant(resId, amount) {
    const s = S();
    if (!(resId in s.resources)) return;
    s.resources[resId] = (s.resources[resId] || 0) + amount;
  }

  function costText(costMap) {
    const bal = BAL();
    const nameOf = (id) => { const r = bal.resources.find(x => x.id === id); return r ? r.name : id; };
    return Object.keys(costMap).map(res => g.LS.util.fmt(costMap[res]) + ' ' + nameOf(res)).join(' + ');
  }

  function buyBuilding(bId) {
    const cost = buildingCost(bId);
    if (!canAfford(cost)) return false;
    pay(cost);
    S().buildings[bId] = bLevel(bId) + 1;
    if (g.LS.ui && g.LS.ui.renderBuildings) g.LS.ui.renderBuildings();
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return true;
  }

  /* ── 炼丹 ── */

  /** 丹药产出间隔（秒）= 60 ÷ (1 + 0.2×药园等级) ÷ (丹道心得?1.5:1) */
  function pillInterval() {
    const bal = BAL();
    let itv = bal.pill.base_interval_s;
    itv /= 1 + 0.2 * bLevel('yaoyuan');
    if (hasPrestige('dandao')) itv /= 1.5;
    return itv;
  }

  /**
   * 炼丹推进。opts: { rateFactor:1 在线 / 0.5 离线, maxPills: 上限（离线 20），efficiency }
   * 产丹需灵气（每颗 50），灵气不足时炼制暂停（progress 保留）。
   */
  function pillTick(dt, opts) {
    const bal = BAL(), s = S();
    const n = bLevel('liandanlu');
    if (!n || dt <= 0) return { produced: 0 };
    const rateFactor = (opts && opts.rateFactor) || 1;
    const maxPills = (opts && opts.maxPills) || Infinity;
    let produced = 0;
    s.pill.progress_s += dt * rateFactor * n;
    const itv = pillInterval();
    while (produced < maxPills && s.pill.progress_s >= itv) {
      if (s.resources.lingqi < bal.pill.cost_lingqi_per_pill) break; // 灵气不足，暂停
      s.resources.lingqi -= bal.pill.cost_lingqi_per_pill;
      s.resources.danyao = Math.min(bal.pill.stock_cap, s.resources.danyao + 1);
      s.pill.progress_s -= itv;
      produced += 1;
    }
    if (s.pill.progress_s > itv * 2) s.pill.progress_s = itv; // 防异常膨胀
    return { produced };
  }

  /** 服丹：1 颗 → 60 秒全局产量 ×2（冷却 90 秒） */
  function servePill() {
    const bal = BAL(), s = S();
    const now = Date.now();
    if (s.resources.danyao < 1) return false;
    if (now - (s.pill.last_serve_at || 0) < bal.pill.serve_cooldown_s * 1000) return false;
    s.resources.danyao -= 1;
    s.pill.last_serve_at = now;
    g.LS.state.addBuff({ id: 'pill', mult: bal.pill.serve_buff_mult, ts_end: now + bal.pill.serve_duration_s * 1000 });
    return true;
  }

  /** 自动服丹（元婴被动）：丹药≥5 时每 5 分钟自动服 1 颗 */
  function autoPillTick(now) {
    const bal = BAL(), s = S();
    if (s.realm.index < 3) return false; // 元婴(index3)解锁
    if (s.resources.danyao < bal.pill.auto_serve_threshold) return false;
    if (now - (s.pill.last_serve_at || 0) < bal.pill.auto_serve_interval_s * 1000) return false;
    return servePill();
  }

  /* ── 传承兑换 ── */

  function upgradeState(u) {
    const p = S().prestige;
    if (p.bought.indexOf(u.id) !== -1) return 'bought';
    if (u.requires && p.bought.indexOf(u.requires) === -1) return 'locked';
    if (p.points < u.cost) return 'poor';
    return 'ok';
  }

  function buyUpgrade(uId) {
    const bal = BAL(), s = S();
    const u = bal.prestige.upgrades.find(x => x.id === uId);
    if (!u) return false;
    const st = upgradeState(u);
    if (st !== 'ok') return false;
    s.prestige.points -= u.cost;
    s.prestige.spent += u.cost;
    s.prestige.bought.push(u.id);
    if (g.LS.ui && g.LS.ui.renderPermList) g.LS.ui.renderPermList();
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return true;
  }

  /* ── 防护 ── */

  function clampAll() {
    const bal = BAL(), s = S();
    const ceiling = bal.sim && bal.sim.value_ceiling ? bal.sim.value_ceiling : (bal.value_ceiling || 9e15);
    for (const res in s.resources) {
      let v = s.resources[res];
      if (!isFinite(v)) { console.warn('[灵山掌门] 非有限值资源已钳制：' + res); v = 0; }
      if (v < 0) v = 0;
      if (v > ceiling) v = ceiling;
      s.resources[res] = v;
    }
    if (!isFinite(s.pill.progress_s)) s.pill.progress_s = 0;
  }

  g.LS.economy = {
    computePerSecond, xiuMult, prestigeMult, realmMultSafe,
    clickMult, clickQiGain, clickXpGain, breath,
    buildingCost, bulkCost, canAfford, pay, grant, costText, buyBuilding,
    pillInterval, pillTick, servePill, autoPillTick,
    upgradeState, buyUpgrade, hasPrestige, bLevel, clampAll
  };
})(typeof window !== 'undefined' ? window : globalThis);
