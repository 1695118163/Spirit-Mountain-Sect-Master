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
  function bLevel(id) {
    const normal = S().buildings[id];
    if (normal) return normal;
    return (S().path === 'xie' && S().mo_buildings_level && S().mo_buildings_level[id]) || 0;
  }
  function productionBuildings() {
    const bal = BAL();
    return S().path === 'xie' ? bal.buildings.concat(bal.mo_buildings || []) : bal.buildings;
  }

  function hasPrestige(id) { return S().prestige.bought.indexOf(id) !== -1; }
  /** 天赋等级 = bought 中出现次数（多级天赋：每级重算，甲§4陷阱①） */
  function talentLv(id) { const b = S().prestige.bought; return b ? b.filter(x => x === id).length : 0; }
  /** 代际传承加成（四选一结局，保一世） */
  function heirloomOf() { return S().heirloom || null; }

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
    if (res === 'lingqi') m *= 1 + 0.10 * talentLv('linggen_mu');
    if (res === 'lingshi') m *= 1 + 0.10 * talentLv('linggen_jin');
    return m;
  }

  /** 修为获取总加成：剑冢 +10%/级、洞府 +25%/级（乘算）、悟性 ×1.5、功法契合灵根 ×1.08 */
  function xiuMult() {
    let m = 1;
    m *= 1 + 0.1 * bLevel('jianzhong');
    m *= 1 + 0.25 * bLevel('dongfu');
    m *= 1 + 0.12 * talentLv('wuxing');
    m *= techFitMult();
    m *= gearXpMult(); // 装备修为词条（甲§5：佩戴中的武器/功法 bonus.xp_mult 加算）
    return m;
  }

  /** 装备修为词条：佩戴中的武器+功法 bonus.xp_mult 加算（全套 ≈ +63% 上限设计） */
  function gearXpMult() {
    const s = S();
    const cul = BAL().cultivation || {};
    let add = 0;
    const w = (cul.weapons || []).find(x => x.id === s.equip.weapon);
    const t = (cul.techniques || []).find(x => x.id === s.equip.technique);
    if (w && w.bonus && w.bonus.xp_mult) add += w.bonus.xp_mult;
    if (t && t.bonus && t.bonus.xp_mult) add += t.bonus.xp_mult;
    return 1 + add;
  }

  /** 功法五行契合：装备功法（兼修任一行亦算）与灵根五行一致 → 修为 ×1.08（数据 cultivation.wuxing.tech_fit_mult） */
  function techFitMult() {
    const s = S();
    if (!s.spirit_root || !s.spirit_root.element) return 1;
    const cul = (BAL().cultivation || {});
    const mult = (cul.wuxing && cul.wuxing.tech_fit_mult) || 1.08;
    const t = (cul.techniques || []).find(x => x.id === s.equip.technique);
    if (!t || !t.element) return 1;
    const els = Array.isArray(t.element) ? t.element : [t.element];
    return els.indexOf(s.spirit_root.element) !== -1 ? mult : 1;
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
      const sr = (S().spirit_root && g.LS.state.spiritRootMult) ? g.LS.state.spiritRootMult() : 1;
      return qiRate * bal.xiuwei_rate_factor * xiuMult() * difficultyCfg().xp_mult * sr;
    }

    // 第1步：基础产量
    let base = 0;
    for (const b of productionBuildings()) {
      const rate = b.effects && b.effects.rate && b.effects.rate[resId];
      if (!rate) continue;
      if (stalled(b.id, now)) continue; // F 类建筑异常：停产
      base += bLevel(b.id) * rate;
    }

    // 第2.5步：建筑全局乘算（藏经阁/诛仙剑阵 all_mult_per_level，乘算层）
    let allMult = 1;
    for (const b of productionBuildings()) {
      const am = b.effects && b.effects.all_mult_per_level;
      if (am && bLevel(b.id) > 0 && !stalled(b.id, now)) allMult *= 1 + am * bLevel(b.id);
    }

    // 第3~6步：乘算层
    let v = base;
    v *= allMult;
    v *= realmMultSafe();
    v *= 1 + (s.perm_bonus.all || 0) + (s.perm_bonus[resId] || 0);
    v *= prestigeMult(resId);
    // 丹毒惩罚：每 10 点丹毒 −3% 产量，封顶 −30%；前尘心障（丹瘾种因）再 −15%
    const toxic = s.pill_toxic || 0;
    if (toxic > 0) {
      const tp = (bal.pills && bal.pills.quality && bal.pills.quality.toxic_penalty) || { per_10_points: 0.03, cap: 0.30 };
      v *= 1 - Math.min(tp.cap || 0.30, Math.floor(toxic / 10) * tp.per_10_points);
    }
    if (Array.isArray(s.persistent_curses) && s.persistent_curses.length) v *= 0.85;
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
    m *= Math.pow(1.5, talentLv('tuna_yaojue'));
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
    const sr = (S().spirit_root && g.LS.state.spiritRootMult) ? g.LS.state.spiritRootMult() : 1;
    let m = BAL().click.xp_per_tunafa_level * lv * difficultyCfg().xp_mult * sr;
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
    // 升级坊市：赶集冷却立即刷新（用户提议「升级刷新」）
    if (bId === 'fangshi' && S().ability_cd) delete S().ability_cd.ganji;
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
    if (talentLv('dandao')) itv /= 1 + 0.15 * talentLv('dandao');
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
      const out = rollPillOutput();
      grantPill(out.id, out.quality, 1);
      s.pill.progress_s -= itv;
      produced += 1;
    }
    if (s.pill.progress_s > itv * 2) s.pill.progress_s = itv; // 防异常膨胀
    return { produced };
  }

  /** 服丹（快捷服灵力丹）：从库存低品质先扣，全局产量增益随品质倍增，丹毒随之 */
  function servePill() {
    const bal = BAL(), s = S();
    const now = Date.now();
    if (!s.pill_stock) return false;
    if (now - (s.pill.last_serve_at || 0) < bal.pill.serve_cooldown_s * 1000) return false;
    const order = ['凡', '灵', '珍', '仙'];
    let key = null;
    for (const q of order) {
      const k = pillStockKey('lingli', q);
      if (s.pill_stock[k]) { key = k; break; }
    }
    if (!key) return false;
    s.pill_stock[key] -= 1;
    if (s.pill_stock[key] <= 0) delete s.pill_stock[key];
    const quality = key.split('_')[1];
    const em = (pillQualityCfg().effect_mult)[quality] || 1;
    s.pill.last_serve_at = now;
    g.LS.state.addBuff({ id: 'pill', mult: bal.pill.serve_buff_mult * em, ts_end: now + bal.pill.serve_duration_s * 1000 });
    addToxic((pillQualityCfg().toxic_by_quality)[quality] || 0);
    return true;
  }

  /** 炼丹产出：按权重 roll 丹药种类与品质入库（种类权重表在 pills.json output_weights） */
  function rollPillOutput() {
    const cfg = BAL().pills || {};
    const weights = cfg.output_weights || { lingli: 40, juqi: 25, ningshen: 10, qingxin: 8, pozhang: 5, xisui: 3, huanling: 4, bidust: 2, hugu: 2, yuanhang: 1 };
    const ids = Object.keys(weights);
    const id = g.LS.util.weightedPick(ids, k => weights[k]);
    const cat = pillCat(id);
    return cat ? { id, quality: rollPillQuality() } : { id: 'lingli', quality: '灵' };
  }

  /** 元婴被动：自动服丹（灵力丹库存 ≥5 时每 5 分钟自动服 1 颗） */
  function autoPillTick(now) {
    const bal = BAL(), s = S();
    if (s.realm.index < 3) return false; // 元婴(index3)解锁
    if (pillCount('lingli') < bal.pill.auto_serve_threshold) return false;
    if (now - (s.pill.last_serve_at || 0) < bal.pill.auto_serve_interval_s * 1000) return false;
    return servePill();
  }

  /* ── 传承兑换 ── */

  /** 天赋等级：bought 中出现次数（多级天赋，每级重算） */

  function upgradeState(u) {
    const p = S().prestige;
    const lv = talentLv(u.id);
    const maxLv = u.max_lv || 1;
    if (lv >= maxLv) return 'bought';
    const cost = (u.costs && u.costs[lv]) != null ? u.costs[lv] : u.cost;
    if (u.requires && p.bought.indexOf(u.requires) === -1) return 'locked';
    if (p.points < cost) return 'poor';
    return 'ok';
  }

  function buyUpgrade(uId) {
    const bal = BAL(), s = S();
    const u = bal.prestige.upgrades.find(x => x.id === uId);
    if (!u) return false;
    const st = upgradeState(u);
    if (st !== 'ok') return false;
    const lv = talentLv(uId);
    const cost = (u.costs && u.costs[lv]) != null ? u.costs[lv] : u.cost;
    s.prestige.points -= cost;
    s.prestige.spent += cost;
    s.prestige.bought.push(uId);
    if (g.LS.ui && g.LS.ui.renderPermList) g.LS.ui.renderPermList();
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return true;
  }

  /* ── 邪修行为（甲§7）：心魔≥30 解锁，CD 现实时间，收益随产量水涨船高 ── */
  function xinmoAct(actId) {
    const s = S(), bal = BAL();
    const cfg = bal.xinmo && bal.xinmo.acts && bal.xinmo.acts[actId];
    if (!cfg) return { ok: false, msg: '查无此道' };
    const xm = s.xinmo || 0;
    if (xm < (bal.xinmo.unlock || 30)) return { ok: false, msg: '心境清明，无需此道（心魔 ≥' + (bal.xinmo.unlock || 30) + ' 解锁）' };
    s.xinmo_cd = s.xinmo_cd || {};
    const now = Date.now();
    if (s.xinmo_cd[actId] && s.xinmo_cd[actId] > now) {
      const left = Math.ceil((s.xinmo_cd[actId] - now) / 60000);
      return { ok: false, msg: cfg.name + ' 气机未复（还需 ' + left + ' 分钟）' };
    }
    s.xinmo_cd[actId] = now + cfg.cd_s * 1000;
    s.xinmo = Math.min(100, xm + cfg.xinmo);
    if (cfg.no_decay_s) s.xinmo_no_decay_until = Math.max(s.xinmo_no_decay_until || 0, now + cfg.no_decay_s * 1000);
    s.xie_stats = s.xie_stats || {};
    s.xie_stats[actId] = (s.xie_stats[actId] || 0) + 1;
    if (g.LS.path && BAL().xuesha && BAL().xuesha.sources) g.LS.path.addXuesha(BAL().xuesha.sources[actId] || 0);
    const lines = [cfg.name + '——心魔 +' + cfg.xinmo + '（现 ' + s.xinmo + '）'];
    if (actId === 'lve') {
      const ls = Math.max(50, Math.floor(computePerSecond('lingshi') * (120 + Math.random() * 120) * (1 + xm / 100)));
      s.resources.lingshi += ls;
      const next = bal.realms[s.realm.index + 1];
      const xp = next && next.need_xp ? Math.floor(next.need_xp * 0.03) : 0;
      s.resources.xiufu += xp;
      lines.push('劫得灵石 +' + g.LS.util.fmt(ls) + (xp ? '，夺修为 +' + g.LS.util.fmt(xp) : ''));
    } else if (actId === 'xueji') {
      g.LS.state.addBuff({ id: 'xueji_buff', mult: 2, ts_end: now + 120000 });
      lines.push('血祭功成——全局产量 ×2（120 秒）。鼎中呜咽，你权当没听见。');
    } else if (actId === 'heishi') {
      const q = Math.random() < 0.5 ? '劣' : '凡';
      const pool = ['xiuling', 'zhuyuan', 'qingxin'];
      const id = pool[Math.floor(Math.random() * pool.length)];
      s.pill_stock = s.pill_stock || {};
      const key = id + '_' + q;
      s.pill_stock[key] = (s.pill_stock[key] || 0) + 2;
      lines.push('黑市两颗' + q + '品丹到手（' + key + '），来路不明，服前三思。');
    }
    g.LS.save.save();
    return { ok: true, msg: lines.join('；') };
  }
  function xinmoDecay(now) {
    // 惰性自然消退：间隔与每次衰减量都由 balance.xinmo 驱动。
    const s = S();
    if (typeof s.xinmo !== 'number' || s.xinmo <= 0) return;
    now = now || Date.now();
    if (now < (s.xinmo_no_decay_until || 0)) { s.xinmo_ts = now; return; }
    if (!s.xinmo_ts) { s.xinmo_ts = now; return; }
    const cfg = BAL().xinmo || {};
    const interval = cfg.decay_ms_per_year || 120000;
    const periods = Math.floor((now - s.xinmo_ts) / interval);
    if (periods > 0) {
      s.xinmo = Math.max(0, s.xinmo - periods * (cfg.decay_per_game_year == null ? 0.5 : cfg.decay_per_game_year));
      s.xinmo_ts += periods * interval;
    }
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
    if (g.LS.path) s.xuesha = g.LS.util.clamp(Number(s.xuesha) || 0, 0, (bal.xuesha && bal.xuesha.cap) || 100000);
    if (!isFinite(s.pill.progress_s)) s.pill.progress_s = 0;
  }

  /* ── 建筑主动技能（开炉/赶集） ── */

  function abilityDef(bId) {
    const bal = BAL();
    return (bal.active_abilities && bal.active_abilities[bId]) || null;
  }

  function abilityCooldownLeft(bId) {
    const def = abilityDef(bId);
    const s = S();
    if (!def) return Infinity;
    const until = (s.ability_cd && s.ability_cd[def.key]) || 0;
    return Math.max(0, until - Date.now());
  }

  /** 使用建筑主动技能：开炉=立得丹药（耗灵气）；赶集=奇遇提前上门 */
  function useAbility(bId) {
    const def = abilityDef(bId);
    const s = S();
    if (!def) return { ok: false, reason: '无此技能' };
    if (s.realm.index < (BAL().buildings.find(x => x.id === bId) || {}).unlock_realm) return { ok: false, reason: '未解锁' };
    if ((s.buildings[bId] || 0) < 1) return { ok: false, reason: '尚未建造' };
    if (abilityCooldownLeft(bId) > 0) return { ok: false, reason: '冷却中' };
    const bal = BAL();
    if (def.key === 'kailu') {
      // 猛火催丹：按炉数立即产丹，每颗照常耗灵气，灵气不足部分炼不成
      const furnaces = bLevel('liandanlu');
      let made = 0;
      const want = (def.pills || 5) + Math.floor(furnaces / 2);
      for (let i = 0; i < want; i++) {
        if (s.resources.lingqi < bal.pill.cost_lingqi_per_pill) break;
        if (s.resources.danyao >= bal.pill.stock_cap) break;
        s.resources.lingqi -= bal.pill.cost_lingqi_per_pill;
        s.resources.danyao += 1;
        made++;
      }
      if (!made) return { ok: false, reason: '灵气不足' };
      s.ability_cd[def.key] = Date.now() + def.cooldown_s * 1000;
      return { ok: true, msg: '丹炉轰然作响，得丹 ' + made + ' 颗' };
    }
    if (def.key === 'ganji') {
      s.event_state.next_event_at = Date.now() + (def.next_event_in_s || 30) * 1000;
      s.ability_cd[def.key] = Date.now() + def.cooldown_s * 1000;
      return { ok: true, msg: '弟子下山张罗，奇遇将至' };
    }
    return { ok: false, reason: '未知技能' };
  }

  /* ── 丹药细分：库存 / 服用 / 丹毒（数据在 data/pills.json） ── */

  function pillCat(id) { return ((BAL().pills || {}).pills || []).find(p => p.id === id) || null; }
  /** 难度配置（简单/正常/困难）：xp_mult 修为倍率、fail_rate_add 突破成功率修正、qihuo_add 走火概率修正 */
  function difficultyCfg() {
    const all = BAL().difficulty || {};
    return all[(S().settings && S().settings.difficulty) || 'normal'] || all.normal || { xp_mult: 2.0, fail_rate_add: 0, qihuo_add: 0 };
  }

  const FALLBACK_QUALITY = {
    keys: ['劣', '凡', '灵', '珍', '仙'],
    effect_mult: { 劣: 1.0, 凡: 1.0, 灵: 1.5, 珍: 2.0, 仙: 2.5 },
    toxic_by_quality: { 劣: 8, 凡: 6, 灵: 3, 珍: 1, 仙: 0 },
    toxic_decay_per_minute: 1,
    toxic_penalty: { per_10_points: 0.03, cap: 0.30, poisoning_threshold: 60, poisoning_mult: 0.75, poisoning_duration_s: 300 }
  };
  function pillQualityCfg() { return (BAL().pills || {}).quality || FALLBACK_QUALITY; }
  function pillStockKey(id, q) { return id + '_' + q; }
  function pillTotal() {
    const st = S().pill_stock || {};
    return Object.keys(st).reduce((a, k) => a + (st[k] || 0), 0);
  }
  function pillCount(id) {
    const st = S().pill_stock || {};
    return Object.keys(st).filter(k => k.indexOf(id + '_') === 0).reduce((a, k) => a + (st[k] || 0), 0);
  }
  function grantPill(id, quality, n) {
    const s = S();
    if (!s.pill_stock) s.pill_stock = {};
    const key = pillStockKey(id, quality);
    s.pill_stock[key] = Math.min(99, (s.pill_stock[key] || 0) + n);
  }
  function rollPillQuality() {
    const q = pillQualityCfg();
    if (!q) return '灵';
    const weights = { 凡: 60, 灵: 25, 珍: 12, 仙: 3 };
    return g.LS.util.weightedPick(q.keys, k => weights[k] || 0);
  }

  /** 丹毒累积 + 攻心判定（每次服丹/获得低品丹药时调用） */
  function addToxic(n) {
    if (!n) return;
    const s = S();
    const q = pillQualityCfg();
    const tp = q.toxic_penalty || {};
    s.pill_toxic = (s.pill_toxic || 0) + n;
    if (!s.pill_toxic_flag && s.pill_toxic >= (tp.poisoning_threshold || 60)) {
      s.pill_toxic_flag = true;
      g.LS.state.addBuff({ id: 'pill_toxic_debuff', mult: tp.poisoning_mult || 0.75, ts_end: Date.now() + (tp.poisoning_duration_s || 300) * 1000 });
      if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast((q.texts && q.texts.poisoning_toast) || '丹毒攻心！');
    }
  }

  /** 服用一颗丹：应用效果、累积丹毒、可能丹毒攻心 */
  function consumePill(id, quality) {
    const cat = pillCat(id);
    const s = S();
    if (!cat) return { ok: false, reason: '查无此丹' };
    quality = quality || '灵';
    const key = pillStockKey(id, quality);
    if (!s.pill_stock || !s.pill_stock[key]) return { ok: false, reason: '没有这味' + quality + '品' + cat.name };
    s.pill_stock[key] -= 1;
    if (s.pill_stock[key] <= 0) delete s.pill_stock[key];
    const q = pillQualityCfg() || { effect_mult: { 灵: 1 }, toxic_by_quality: { 灵: 3 } };
    let em = q.effect_mult[quality] || 1;
    const now = Date.now();
    const bal = BAL();
    let msg = quality + '品' + cat.name + '入腹';
    // 境界匹配（凡人设定：境界不符药性有隐患）——低于建议境界段：药效打折丹毒加重
    const fit = (q.fit_realms || {})[quality];
    let mismatch = false;
    if (fit && (s.realm.index < fit[0] || s.realm.index > fit[1])) {
      mismatch = true;
      em *= ((q.mismatch || {}).effect_mult) || 0.6;
      msg += '（境界不符，药力十存六七）';
    }
    // 丹毒 ≥50：体质已差，所有丹的增益效果减半
    const toxicDamped = (s.pill_toxic || 0) >= 50;
    if (toxicDamped && em > 1) {
      em *= 0.5;
      msg += '（丹毒缠身，药效减半）';
    }
    // 丹种自带丹毒（劣品丹的 toxic_add 覆盖品质默认）
    let toxicGain = (cat.toxic_add != null ? cat.toxic_add : ((q.toxic_by_quality || {})[quality] || 0)) * (mismatch ? ((q.mismatch || {}).toxic_mult) || 1.5 : 1);

    switch (cat.category) {
      case 'prod': {
        const mult = cat.effect.mult * em;
        g.LS.state.addBuff({ id: 'pill_prod', mult, ts_end: now + cat.effect.duration_s * 1000 });
        msg += '，产量 ×' + mult.toFixed(1) + '（' + cat.effect.duration_s + ' 秒）';
        break;
      }
      case 'xp': {
        const next = bal.realms[s.realm.index + 1];
        const need = next && next.need_xp ? next.need_xp : 1000;
        const span = cat.effect.xp_pct_of_need_max - cat.effect.xp_pct_of_need_min;
        const gain = need * (cat.effect.xp_pct_of_need_min + Math.random() * span) * em;
        s.resources.xiufu += gain;
        msg += '，修为 +' + g.LS.util.fmt(gain);
        break;
      }
      case 'breakthrough': {
        s.bt.breakthrough_bonus = (s.bt.breakthrough_bonus || 0) + cat.effect.rate_add * em;
        msg += '，下次冲关成功率 +' + Math.round(cat.effect.rate_add * em * 100) + '%';
        break;
      }
      case 'cure': {
        // 清心丹按品质显式净排毒（甲§1）：豁免境界不符与丹毒减半——「去病」不被「病」打折，永不净增毒
        const bq = cat.effect_by_quality && cat.effect_by_quality[quality];
        let reduce, xadd = 0;
        if (bq) {
          reduce = bq.toxic_reduce;
          xadd = bq.toxic_add || 0;
          if (bq.xinmo_reduce && typeof s.xinmo === 'number') {
            const xinmoReduce = s.xinmo >= 60 ? bq.xinmo_reduce * 0.5 : bq.xinmo_reduce;
            s.xinmo = Math.max(0, s.xinmo - xinmoReduce);
          }
        } else {
          reduce = cat.effect.toxic_reduce * em;
        }
        s.pill_toxic = Math.max(0, (s.pill_toxic || 0) - reduce);
        toxicGain = xadd; // 清心丹积毒以本表为准（劣品 +5、凡品 +2）
        const before = s.buffs.length;
        s.buffs = s.buffs.filter(bf => bf.id !== 'qihuo_debuff' && bf.id !== 'xinmo_debuff' && bf.id !== 'pill_toxic_debuff');
        msg += '，丹毒 −' + reduce + (xadd ? '（药性驳杂，反积 ' + xadd + ' 毒）' : '') + (s.buffs.length < before ? '，神台复明' : '');
        break;
      }
      case 'perm': {
        const cap = ((bal.events.effect.D.cap_pct) || 100) / 100;
        const add = cat.effect.perm_all_pct * em;
        s.perm_bonus.all = g.LS.util.clamp((s.perm_bonus.all || 0) + add, 0, cap);
        msg += '，永久产量 +' + Math.round(add * 100) + '%';
        break;
      }
      case 'click': {
        g.LS.state.addBuff({ id: 'pill_click', mult: 1, click_mult: cat.effect.click_mult * em, ts_end: now + cat.effect.duration_s * 1000 });
        msg += '，点击 ×' + (cat.effect.click_mult * em).toFixed(0) + '（' + cat.effect.duration_s + ' 秒）';
        break;
      }
      case 'shield': {
        g.LS.state.addBuff({ id: 'pill_shield', mult: 1, ts_end: now + cat.effect.duration_s * 1000 });
        msg += '，邪祟暂避（' + cat.effect.duration_s + ' 秒）';
        break;
      }
      case 'heal': {
        s.building_stalls = {};
        msg += '，产业气机尽复';
        break;
      }
      case 'fortune': {
        s.event_state.next_event_at = now + cat.effect.next_event_in_s * 1000;
        msg += '，机缘将至';
        break;
      }
      case 'insight': {
        const next = bal.realms[s.realm.index + 1];
        const need = next && next.need_xp ? next.need_xp : 1000;
        const gain = need * 0.4 * em;
        s.resources.xiufu += gain;
        g.LS.state.addBuff({ id: 'insight_click', mult: 1, click_mult: 3, ts_end: now + 60000 });
        msg += '，豁然贯通，修为 +' + g.LS.util.fmt(gain);
        break;
      }
      case 'luck': {
        const qi = Math.max(100, computePerSecond('lingqi') * 120 * em);
        const ls = Math.max(50, computePerSecond('lingshi') * 120 * em);
        s.resources.lingqi += qi;
        s.resources.lingshi += ls;
        msg += '，灵气 +' + g.LS.util.fmt(qi) + '，灵石 +' + g.LS.util.fmt(ls);
        break;
      }
      case 'lingshi': {
        // 浊元丹：一笔灵石进项，附带浊气 debuff
        const span = cat.effect.lingshi_seconds_max - cat.effect.lingshi_seconds_min;
        const ls = Math.max(50, computePerSecond('lingshi') * (cat.effect.lingshi_seconds_min + Math.random() * span) * em);
        s.resources.lingshi += ls;
        msg += '，灵石 +' + g.LS.util.fmt(ls);
        if (cat.curse_debuff) {
          g.LS.state.addBuff({ id: 'zhuoyuan_debuff', mult: cat.curse_debuff.mult, ts_end: now + cat.curse_debuff.duration_s * 1000 });
        }
        break;
      }
      case 'rescue': {
        // 天元/渡厄丹：当前境界 index≤8 时下次冲关必成；渡劫（index8）冲飞升（index9）天道考验，改大幅 +30%
        const curIdx = S().realm.index;
        if (curIdx <= (cat.effect.guarantee_max_index || 8)) {
          s.bt.guaranteed = true;
          msg += '，下次冲关必成';
        } else {
          s.bt.breakthrough_bonus = (s.bt.breakthrough_bonus || 0) + (cat.effect.rate_add_high || 0.30);
          msg += '，天道面前丹力有穷——下次冲关大幅 +30%';
        }
        // 丹瘾种因：转生也不清，须来世以身证道（碑林记一世渡劫以上）化解
        if (cat.effect.danyin_curse) {
          if (!Array.isArray(s.persistent_curses)) s.persistent_curses = [];
          if (s.persistent_curses.indexOf('danyin') === -1) {
            s.persistent_curses.push('danyin');
            msg += '；然药力逆天，丹瘾已种——转世亦随行，唯以身证道可解';
          }
        }
        break;
      }
      default:
        msg += '。';
    }

    // 丹毒：丹种覆盖值优先（劣品丹），否则按品质累积，可能丹毒攻心
    if (toxicGain) addToxic(toxicGain);
    return { ok: true, msg };
  }

  /** 丹毒随时间缓慢消散（主循环每 250ms 调） */
  function toxicDecay(dtSec) {
    const s = S();
    const q = pillQualityCfg();
    if (!q || !s.pill_toxic) return;
    const perMin = q.toxic_decay_per_minute || 1;
    s.pill_toxic = Math.max(0, s.pill_toxic - (dtSec / 60) * perMin);
    if (s.pill_toxic < 30) s.pill_toxic_flag = false;
  }

  g.LS.economy = {
    computePerSecond, xiuMult, prestigeMult, realmMultSafe,
    clickMult, clickQiGain, clickXpGain, breath,
    buildingCost, bulkCost, canAfford, pay, grant, costText, buyBuilding,
    pillInterval, pillTick, servePill, autoPillTick,
    upgradeState, buyUpgrade, hasPrestige, talentLv, gearXpMult, xinmoAct, xinmoDecay, bLevel, clampAll,
    abilityDef, abilityCooldownLeft, useAbility,
    pillCat, pillQualityCfg, pillTotal, pillCount, grantPill, rollPillQuality, rollPillOutput, consumePill, toxicDecay, difficultyCfg, heirloomOf,};
})(typeof window !== 'undefined' ? window : globalThis);
