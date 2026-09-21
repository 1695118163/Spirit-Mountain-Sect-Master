/**
 * battle.js v3 —— 斗法引擎（杀戮尖塔式回合制选牌）：
 *  - 行动点 = 境界 + 1：手牌就是玩家在「招式录」里自配的卡组（8 槽：攻 3 · 五行 2 · 守 2 · 回 1），每回合整套在手、
 *    付不起/冷却中的置灰；出招按招式费用扣点，点用光后靠「调息 · 让招」回满（代价是白让一手）；
 *    （2026-09-21 玩家口径：删掉「每回合抽 8 张」，改回自己配卡组——买的秘籍/装备才真正进牌路）
 *    出一招即把回合交给对方（一回合仅此一招）；护盾只保当回合；对方 AI 先亮「意图」再出手，玩家据此决断；
 *  - 五行克制 ×1.25 / 被克 ×0.85，天时（雨助水行/雪寒）微调，丹毒每回合自伤（按气血百分比，每档 2%）；
 *  - 大师兄「凌云子」（金丹）为内置人机陪练；好友影子斗法由影子 AI 代打（通用卡组）。
 * 数据：data/cultivation.json battle_cards（我方牌库 / AI 卡组）；QTE 与自动对垒已移除。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const CUL = () => (g.LS.BAL && g.LS.BAL.cultivation) || {};
  const CARDS = () => CUL().battle_cards || {};
  const S = () => g.LS.S;
  const U = () => g.LS.util;

  /* ── 名片与影子（好友码体系） ── */

  function myDaoHao() {
    const s = S();
    return '灵曜' + U().numToCn(((g.LS.BAL.game_time || {}).start_year || 1) + Math.floor((s.created_at || 0) / 10000) % 900 + 1) + '·掌门';
  }

  function makeCard() {
    const s = S();
    return {
      v: 3,
      dao: myDaoHao(),
      realm: s.realm.index,
      daoxin: s.dao_heart,
      weapon: s.equip.weapon,
      technique: s.equip.technique,
      honor: s.honor,
      record: s.record,
      spirit: s.spirit_root,
      pill_toxic: Math.floor(s.pill_toxic || 0),
      ts: Date.now()
    };
  }

  /** 名片 → 综合战力（0~100：境界底盘+武器锋锐+功法+丹毒惩罚） */
  function cardPower(card) {
    const bal = g.LS.BAL;
    const realmEdge = Math.pow(1.2, card.realm || 0);
    const w = (bal.cultivation.weapons || []).find(x => x.id === card.weapon);
    const sharp = w ? w.sharp : 5;
    const toxic = card.pill_toxic || 0;
    const toxicCut = Math.max(0.7, 1 - Math.floor(toxic / 10) * 0.03);
    return Math.round(Math.min(100, (realmEdge * 4 + sharp * 0.9 + 8) * toxicCut));
  }

  /* ── 五行克制（myEl 支持兼修数组：取最有利一行，两仪/混沌路数） ── */
  function elMultOne(myEl, opEl) {
    const wx = CUL().wuxing || {};
    if (myEl && opEl && wx.cycle && wx.cycle[myEl] === opEl) return wx.counter_mult || 1.25;
    if (myEl && opEl && wx.cycle && wx.cycle[opEl] === myEl) return wx.countered_mult || 0.85;
    return 1;
  }
  function elementMult(myEl, opEl) {
    if (Array.isArray(myEl)) {
      let best = 1;
      for (const e of myEl) best = Math.max(best, elMultOne(e, opEl));
      return best;
    }
    return elMultOne(myEl, opEl);
  }

  function currentWeatherMod() {
    const ws = (S().weather_state || {}).kind || 'clear';
    if (ws === 'rain') return { fire: 0.85, water: 1.15, text: '天时：细雨绵绵——水行招式顺手，火行受阻。' };
    if (ws === 'fog') return { text: '天时：晨雾锁山，招式难辨虚实。' };
    if (ws === 'snow') return { water: 1.1, fire: 0.9, text: '天时：落雪成霜，寒气助水行。' };
    return { text: '天时：晴，万里无云。' };
  }

  /* ── 斗法状态 ── */
  let active = null;   // { my, op, friend, weather, round, mode:'shadow'|'senior' }

  /* ── 卡组构筑（皇室战争式）：四类各带 1 张，从已拥有中选 ── */
  const KINDS = ['attack', 'element', 'defense', 'heal'];
  const KIND_NAME = { attack: '攻式', element: '五行', defense: '守式', heal: '回式' };

  /** 牌是否已参悟：默认牌 / cards_owned / 境界达标自动参悟（本命飞剑类） */
  function ownsCard(c) {
    if (!c) return false;
    if (c.default || (S().cards_owned || []).indexOf(c.id) !== -1) return true;
    return !!(c.unlock_realm && S().realm.index >= c.unlock_realm);
  }

  /** 卡组槽位（乙§3.2）：攻3/五2/守2/回1 = 8 槽 */
  const KIND_LIMITS = { attack: 3, element: 2, defense: 2, heal: 1 };

  /** 出战卡组解析（2026-09-21 玩家自配口径）：S().deck 按类取前 N 张合法牌（8 槽）；
      poolArr 传手牌池时用其中带 dmgFinal 的副本；缺槽再自动补位（已参悟 + 境界达标 + 付得起，
      够格的不超槽数则全给、超过随机抽）——补位只是兜底，先认玩家自己配的那几张 */
  function resolveDeck(poolArr) {
    const s = S();
    const pool = poolArr || CARDS().my_cards || [];
    const deck = Array.isArray(s.deck) ? s.deck.slice() : [];
    const picked = [], counts = {};
    // 先按玩家在招式录中的全局顺序入池；这个顺序就是战斗手牌的位置。
    for (const id of deck) {
      const c = pool.find(x => x.id === id && (!x.unlock_realm || S().realm.index >= x.unlock_realm));
      if (!c || !ownsCard(c) || picked.indexOf(c) !== -1) continue;
      const limit = KIND_LIMITS[c.kind] || 1;
      if ((counts[c.kind] || 0) >= limit) continue;
      picked.push(c); counts[c.kind] = (counts[c.kind] || 0) + 1;
    }
    for (const kind of KINDS) {
      const limit = KIND_LIMITS[kind] || 1;
      let taken = counts[kind] || 0;
      // 槽位没填满：从「已拥有 + 境界达标 + 本境付得起（费用 ≤ 境界+1）」的牌里随机补位，
      // 按强度排序（伤害+护盾+回气，同分看费用），保证出战池尽量满 8 槽、且会带重手
      if (taken < limit) {
        const qiCap = S().realm.index + 1;
        const auto = pool.filter(x => x.kind === kind && ownsCard(x)
            && (!x.unlock_realm || S().realm.index >= x.unlock_realm)
            && (x.cost || 0) <= qiCap && picked.indexOf(x) === -1);
        // 够格的牌不超过槽数就全给；多了就随机抽（洗牌取前 N）——不按强度挑，免得每局都是同样那几张
        for (let i = auto.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const t = auto[i]; auto[i] = auto[j]; auto[j] = t;
        }
        for (const c of auto) {
          if (taken >= limit) break;
          picked.push(c); taken += 1;
        }
      }
      // 这一类没有「已参悟 且 付得起」的牌 → 先空着：付不起的牌不进池（四类全空时见下方兜底）
    }
    // 极端兜底：四类都没凑出一张（存档异常等）→ 取全场费用最低的一张，保证手里有牌
    if (!picked.length) {
      const cheap = pool.slice().sort((x, y) => (x.cost || 0) - (y.cost || 0));
      if (cheap.length) picked.push(cheap[0]);
    }
    return picked;
  }

  /** 我方战斗单位：实时状态 + 出战手牌（境界≥4 解锁本命飞剑） */
  function buildMe() {
    const s = S();
    const realm = s.realm.index;
    const bal = g.LS.BAL;
    const w = (bal.cultivation.weapons || []).find(x => x.id === s.equip.weapon);
    const t = (bal.cultivation.techniques || []).find(x => x.id === s.equip.technique);
    const sharp = (w ? w.sharp : 5) + shopSharp();   // 市集「淬锋石」凿出的锋锐也算进去
    const rootMult = g.LS.state.spiritRootMult ? g.LS.state.spiritRootMult() : 1;
    // 气血整体下调 60%（2026-09-13 用户口径：一回合只出一招后，原血量让战斗过长）
    const hpMax = Math.round((80 + realm * 45 + sharp * 0.8) * 0.4 * Math.min(1.3, rootMult));
    // 手牌池＝「已参悟的招式 + 基础牌」全集；出战手牌由 resolveDeck 从 S().deck（招式录编成）取，
    // 空槽才从这里自动补位；行动点是「可驭招式上限」（2026-09-21 改回自配卡组）
    const handPool = (CARDS().my_cards || [])
      .filter(c => ownsCard(c) && (!c.unlock_realm || realm >= c.unlock_realm))
      .map(c => Object.assign({}, c, {
        dmgFinal: c.dmg ? Math.round((c.dmg + realm * 2 + (c.weapon ? sharp * 0.3 : 0)) * Math.min(1.25, rootMult)) : 0,
        // 武器牌五行随装备武器（兼修武器为数组，克制判定取最有利行）
        el: c.weapon ? (w ? w.element : null) : c.el
      }));
    return {
      dao: myDaoHao(), realm, realmName: (bal.realms[realm] || {}).name || '?',
      weaponName: w ? w.name : '徒手', techName: t ? t.name : '粗浅吐纳',
      element: (s.spirit_root && s.spirit_root.element) || (t ? t.element : null),
      daoxin: s.dao_heart, toxic: Math.floor(s.pill_toxic || 0),
      hpMax, hp: hpMax, qi: realm + 1, qiMax: realm + 1, shield: 0,
      handPool, hand: [] // AP=境界+1（乙§2）：不再是每回合资源，而是可驭招式的费用上限
    };
  }

  /** 大师兄三档（2026-09-13 重定：以当前基础气血为「正常」，同门论道＝1.0 基准）
      难度靠两件事叠加：气血倍率 / 境界偏移（hard 再加每招 +2 伤，金丹前不升境不加伤）*/
  const SENIOR_TIERS = {
    easy:  { key: 'easy',  label: '师弟切磋', offset: -1, hpMult: 0.7,  dmgAdd: 0, desc: '低你一境的师弟陪练——气血七成，稳，胜负手筋基本不亏。' },
    equal: { key: 'equal', label: '同门论道', offset: 0,  hpMult: 1.0,  dmgAdd: 0, desc: '与你同境的同门——气血相当，有来有回，看意图出招可稳占上风。' },
    hard:  { key: 'hard',  label: '师兄指教', offset: +1, hpMult: 1.35, dmgAdd: 2, desc: '高你一境的师兄——气血多三成半，凶险；胜则论道积分更多，以下克上可留名碑林。' }
  };

  /** 对方战斗单位：大师兄（按档位：境界偏移/气血倍率/招式加成）或好友影子（通用卡组） */
  function buildOp(friend, isSenior, tierCfg) {
    const aiCfg = (CARDS().ai_cards || {})[isSenior ? 'lingyunzi' : 'generic'] || { moves: [] };
    const card = friend && friend.card ? friend.card : null;
    const bal = g.LS.BAL;
    // 大师兄境界随玩家档位偏移（0~9 夹取）；好友影子按名片境界。
    // 低境界（金丹前）hard 档不升境——AP 差 + 血差的复合碾压在数学上无解，改为同境强化版留活路
    let off = tierCfg.offset;
    if (off > 0 && S().realm.index < 2) off = 0;
    const realm = isSenior ? Math.max(0, Math.min(9, S().realm.index + off)) : (card ? card.realm : 0);
    const w = card ? (bal.cultivation.weapons || []).find(x => x.id === card.weapon) : null;
    const sharp = w ? w.sharp : 5;
    const base = (80 + realm * 45 + sharp * 0.8) * 0.4;   // 气血整体下调 60%（2026-09-13）
    const hpMax = isSenior ? Math.round(base * tierCfg.hpMult) : Math.round(base);
    const t = card ? (bal.cultivation.techniques || []).find(x => x.id === card.technique) : null;
    const realmName = (bal.realms[realm] || {}).name || '?';
    const dmgAdd = isSenior ? (S().realm.index >= 2 ? (tierCfg.dmgAdd || 0) : 0) : 0;
    const hand = (aiCfg.moves || []).map(m => Object.assign({}, m, {
      dmgFinal: m.dmg ? m.dmg + realm * 2 + dmgAdd : 0,
      cdLeft: 0
    }));
    return {
      dao: isSenior ? (aiCfg.name || '凌云子') : ((friend && friend.dao) || (card && card.dao) || '无名道友'),
      title: isSenior ? (aiCfg.title || '大师兄') : '道友',
      realm, realmName,
      weaponName: w ? w.name : (isSenior ? '青锋剑' : '未知'),
      techName: t ? t.name : (isSenior ? '太上剑经' : '未知'),
      element: isSenior ? (aiCfg.moves || [])[0] && (aiCfg.moves[0].el || null) : (card && card.spirit && card.spirit.element) || (t ? t.element : null),
      daoxin: isSenior ? 60 : (card ? card.daoxin || 0 : 30),
      hpMax, hp: hpMax, qi: realm + 1, qiMax: realm + 1, shield: 0, hand, // 双方同构
      intent: null,
      tier: isSenior ? tierCfg.key : null
    };
  }

  /* ── 伤害结算：护盾先抵 → 气血；五行克制；天时。
     返回结构化事件（演出层按事件播动画/飘字）+ text（文字战报兜底） ── */
  function applyHit(src, dst, move, isMe) {
    const weather = active.weather;
    let el = move.el;
    if (el === 'root') el = src.element;
    let mult = 1;
    let elMult = 1;
    let relTxt = '';
    if (el && dst.element) {
      elMult = elementMult(el, dst.element);
      mult *= elMult;
      relTxt = elMult > 1 ? ' 克制！' : (elMult < 1 ? ' 被克。' : '');
    }
    if (weather && weather.fire != null && el === '火') mult *= weather.fire;
    if (weather && weather.water != null && el === '水') mult *= weather.water;
    const raw = Math.round((move.dmgFinal || 0) * mult * (0.92 + Math.random() * 0.16));
    let dealt = 0, absorbed = 0, thornsDealt = 0, steal = 0;
    if (dst.shield > 0 && !move.pierce) {
      absorbed = Math.min(dst.shield, raw);
      dst.shield -= absorbed;
      const at = dst.shieldAttrs; // 反伤（铁布衫）：被罡气吸收部分按比例弹回攻方
      if (at && at.thorns_pct && absorbed > 0) {
        thornsDealt = Math.max(1, Math.round(absorbed * at.thorns_pct / 100));
        src.hp -= thornsDealt;
      }
    }
    dealt = raw - absorbed;
    dst.hp -= dealt;
    if (move.lifesteal_pct && dealt > 0) { // 沧海吞：伤害 30% 转回气
      steal = Math.max(1, Math.round(dealt * move.lifesteal_pct / 100));
      src.hp += steal;
      if (src.hpMax && src.hp > src.hpMax) src.hp = src.hpMax;
    }
    const parts = [];
    if (absorbed > 0) parts.push('被罡气挡下 ' + absorbed + ' 点');
    if (dealt > 0) parts.push('造成 ' + dealt + ' 点');
    else if (absorbed > 0) parts.push('未伤分毫');
    else parts.push('但被侧身避过');
    if (move.pierce && dst.shield > 0) parts.push('（真伤破罡）');
    if (thornsDealt > 0) parts.push('罡气反噬 ' + (isMe ? '你' : '对方') + ' ' + thornsDealt + ' 点');
    if (steal > 0) parts.push('化伤为气回复 ' + steal + ' 点');
    return {
      type: 'hit', side: isMe ? 'my' : 'op', target: isMe ? 'op' : 'my',
      name: move.name, el, dealt, absorbed, thornsDealt, steal,
      pierce: !!move.pierce, elMult,
      text: (isMe ? '' : '对方') + '施放「' + move.name + '」' + relTxt + '，' + parts.join('、') + '。'
    };
  }

  function applyHeal(unit, amount, name, isMe) {
    const healed = Math.min(amount, unit.hpMax - unit.hp);
    unit.hp += healed;
    return {
      type: 'heal', side: isMe ? 'my' : 'op', target: isMe ? 'my' : 'op',
      name, amount: healed,
      text: (isMe ? '' : '对方') + '运转「' + name + '」，回复 ' + healed + ' 点气血。'
    };
  }

  function applyShield(unit, amount, name, isMe, attrs) {
    unit.shield = (unit.shield || 0) + amount;
    unit.shieldAttrs = attrs || unit.shieldAttrs || {}; // 机制盾（反伤/挡后回血）：同回合双盾取后出者
    return {
      type: 'shield', side: isMe ? 'my' : 'op', target: isMe ? 'my' : 'op',
      name, amount,
      text: (isMe ? '' : '对方') + '祭出「' + name + '」，凝起 ' + amount + ' 点罡气护罩。'
    };
  }

  /** 事件 → 文字战报（舞台化后不再逐行滚动，仅作缓冲兜底） */
  function logEvents(evs) {
    const lines = (evs || []).map(e => e && e.text).filter(Boolean);
    if (lines.length && g.LS.ui && g.LS.ui.battleAppend) g.LS.ui.battleAppend(lines);
  }

  /** 血条归零：舞台上小人倒下 */
  function fallIfDead(side) {
    if (g.LS.battleFx && g.LS.battleFx.down) g.LS.battleFx.down(side);
  }

  /* ── AI 拟人策略 + 杀戮尖塔式意图预告 ── */
  function rollIntent(op) {
    const moves = op.hand;
    // 与玩家同一套行动条：点数不够任何一招时，这一手只能「调息」——本手不出招、CD 照常流转；
    // 回满放到 opTurn 里结算，所以青藤缚的 ap_drain（下次调息少回 1 点）在这里才真正生效
    if (!moves.some(m => (m.cost || 0) <= op.qi)) {
      op.hand.forEach(m => { if (m.cd && m.cdLeft > 0) m.cdLeft -= 1; });
      op.intent = { name: '调息', cost: 0, dmg: 0, shield: 0, heal: 0, rest: true };
      return;
    }
    // AI 与玩家同规则：意图招必须本回合行动点买得起、且不在 CD（否则退而选 0 费调息）
    const affordable = moves.filter(m => (m.cost || 0) <= op.qi && (m.cd || 0) === 0 || (m.cost || 0) <= op.qi && m.cdLeft <= 0);
    const usable = affordable.filter(m => (m.cd || 0) === 0 || m.cdLeft <= 0);
    const pool = usable.length ? usable : moves.filter(m => (m.cost || 0) <= op.qi).concat(moves.filter(m => (m.cost || 0) === 0));
    const big = pool.find(m => m.cd);
    let pick = null;
    const r = Math.random();
    const lowHp = op.hp / op.hpMax < 0.4;
    if (big && big.cdLeft <= 0 && r < 0.55) pick = big;
    else if (lowHp) {
      if (r < 0.34) pick = pool.find(m => m.heal) || pickAny(pool, 'dmg');
      else if (r < 0.6) pick = pool.find(m => m.shield) || pickAny(pool, 'dmg');
      else pick = pickAny(pool, 'dmg');
    } else {
      if (r < 0.5) pick = pickAny(pool, 'dmg');
      else if (r < 0.72) pick = pool.find(m => m.shield) || pickAny(pool, 'dmg');
      else if (r < 0.86) pick = pool.find(m => m.heal) || pickAny(pool, 'dmg');
      else pick = big || pickAny(pool, 'dmg');
    }
    pick = pick || pickAny(pool, 'dmg');
    // 池子彻底空（一条买得起的招都没有）：给一条 0 费调息，别让意图变成 undefined
    if (!pick) pick = { name: '调息', cost: 0, dmg: 0, shield: 0, heal: 0 };
    op.hand.forEach(m => { if (m.cd && m !== pick && m.cdLeft > 0) m.cdLeft -= 1; });
    if (pick && pick.cd) pick.cdLeft = pick.cd + 1;
    op.intent = Object.assign({}, pick);
  }
  function pickAny(pool, key) {
    const hits = pool.filter(m => m[key]);
    return hits.length ? hits[Math.floor(Math.random() * hits.length)] : (pool[0] || null);
  }
  function intentText(op) {
    const it = op.intent;
    if (!it) return '';
    if (!it.name) it.name = '调息'; // 名字缺失时兜底，不吐 undefined
    if (it.rest) return '意图：调息 —— 这一手不出招，盘膝把行动点回满。';
    if (it.dmg) {
      let el = it.el === 'root' ? op.element : it.el;
      const m = elementMult(el, active.my.element);
      const est = Math.round((it.dmgFinal || 0) * m);
      return '意图：' + it.name + ' —— 约出 ' + est + ' 点杀招' + (m > 1 ? '（克你灵根，凶险！）' : '') + '。';
    }
    if (it.shield) return '意图：' + it.name + ' —— 将凝罡护体（攻势难破）。';
    if (it.heal) return '意图：' + it.name + ' —— 将调息回气。';
    return '意图：' + it.name + '。';
  }

  /** 天赋等级（bought 重复计数，与 economy 同口径） */
  function talentLv(id) { const b = S().prestige && S().prestige.bought; return b ? b.filter(x => x === id).length : 0; }

  /** 市集「淬锋石」凿出的永久锋锐加成（S().shop_sharp） */
  function shopSharp() {
    if (g.LS.state && g.LS.state.shopSharp) return g.LS.state.shopSharp();
    const v = S().shop_sharp;
    return typeof v === 'number' ? v : 0;
  }

  /** 战力评估（乙§2.3）：CP=100×2.05^境×装备锋锐系数×丹毒折损，事件判定/强敌/劫掠唯一出处 */
  function combatPower() {
    const s = S();
    const bal = g.LS.BAL;
    const w = (bal.cultivation.weapons || []).find(x => x.id === s.equip.weapon);
    const sharp = (w ? w.sharp : 5) + shopSharp();
    const cp = 100 * Math.pow(2.05, s.realm.index)
      * (1 + Math.min(0.6, sharp / 400))
      * Math.max(0.8, 1 - (s.pill_toxic || 0) * 0.002)
      * (1 + 0.03 * (s.prestige && s.prestige.count || 0)); // 转生加战力口子
    return Math.round(cp);
  }

  /* ── 对阵牌 ── */
  const SHADOW_CFG = { offset: 0, hpMult: 1, dmgAdd: 0 }; // 好友影子档（无 tier 概念，v3 参数补位）
  function prepareBattle(friend) {
    if (active) return;
    // 竞技门槛（乙§7）：化神以下禁与道友切磋（大师兄/试炼塔不限）
    if (S().realm.index < 4) { g.LS.ui.toast('化神方可与道友切磋——此前请以大师兄与试炼塔磨砺招式。'); return; }
    if (!friend.card) { g.LS.ui.toast('这位道友还没有递过名片'); return; }
    const my = buildMe();
    const op = buildOp(friend, false, SHADOW_CFG);
    active = { my, op, friend, weather: currentWeatherMod(), round: 0, mode: 'shadow' };
    openArena();
  }

  /** 试炼塔敌人（trial.js 组装 spec）：野怪/守关者按 spec 直接建单位 */
  function startTrialFight(spec, ctx) {
    if (active) return;
    const aiCfg = { name: spec.name || '野修', moves: spec.moves || [] };
    const op = buildOp(null, false, { offset: 0, hpMult: 1, dmgAdd: 0 });
    // 以 spec 覆盖（realm/element/moves/hpMult）
    op.dao = spec.name || '野修';
    op.realm = spec.realm != null ? spec.realm : op.realm;
    op.realmName = (g.LS.BAL.realms[op.realm] || {}).name || '?';
    op.element = spec.element || null;
    op.qiMax = op.realm + 1;
    op.qi = op.qiMax;
    const base = (80 + op.realm * 45 + 5 * 0.8) * 0.4;   // 气血整体下调 60%（2026-09-13）
    op.hpMax = Math.round(base * (spec.hpMult || 1));
    op.hp = op.hpMax;
    op.hand = (spec.moves || []).map(m => Object.assign({}, m, {
      dmgFinal: m.dmg ? m.dmg + op.realm * 2 : 0,
      cdLeft: 0
    }));
    active = { my: buildMe(), op, friend: { dao: op.dao }, weather: currentWeatherMod(), round: 0, mode: 'trial', trialCtx: ctx };
    const info = {
      my: { dao: active.my.dao, realm: active.my.realmName, weapon: active.my.weaponName, tech: active.my.techName, el: active.my.element || '—', hp: active.my.hpMax, cards: (active.my.handPool || []).length },
      op: { dao: op.dao, realm: op.realmName, weapon: '未知', tech: '野修招式', el: op.element || '—', hp: op.hpMax },
      elRel: '', weather: active.weather.text, mode: 'trial'
    };
    g.LS.ui.showBattleArena(info, () => beginFight());
  }

  /** 奇遇强敌（乙§6）：ambush 模式——败北按 cp_scale 走死亡链或掉灵石 */
  function startAmbushFight(spec, ctx) {
    if (active) return false;
    const op = buildOp(null, false, { offset: 0, hpMult: 1, dmgAdd: 0 });
    op.dao = spec.name || '邪修';
    op.realm = spec.realm != null ? spec.realm : op.realm;
    op.realmName = (g.LS.BAL.realms[op.realm] || {}).name || '?';
    op.element = spec.element || null;
    op.qiMax = op.realm + 1;
    op.qi = op.qiMax;
    const base = (80 + op.realm * 45 + 5 * 0.8) * 0.4;   // 气血整体下调 60%（2026-09-13）
    op.hpMax = Math.round(base * (spec.hpMult || 1));
    op.hp = op.hpMax;
    op.hand = (spec.moves || []).map(m => Object.assign({}, m, {
      dmgFinal: m.dmg ? m.dmg + op.realm * 2 + (spec.dmgAdd || 0) : 0,
      cdLeft: 0
    }));
    active = { my: buildMe(), op, friend: { dao: op.dao }, weather: currentWeatherMod(), round: 0, mode: 'ambush', ambushCtx: ctx };
    g.LS.ui.showBattleArena({
      my: { dao: active.my.dao, realm: active.my.realmName, weapon: active.my.weaponName, tech: active.my.techName, el: active.my.element || '—', hp: active.my.hpMax, cards: (active.my.handPool || []).length },
      op: { dao: op.dao, realm: op.realmName, weapon: '凶相毕露', tech: '邪门歪道', el: op.element || '—', hp: op.hpMax },
      elRel: '', weather: active.weather.text, mode: 'ambush'
    }, () => beginFight());
    return true;
  }

  /** 挑战大师兄（三档人机陪练：easy 师弟 / equal 同门 / hard 师兄） */
  function challengeSenior(tier) {
    if (active) return;
    const tierCfg = SENIOR_TIERS[tier] || SENIOR_TIERS.equal;
    const my = buildMe();
    const op = buildOp(null, true, tierCfg);
    active = { my, op, friend: { dao: op.dao }, weather: currentWeatherMod(), round: 0, mode: 'senior', tier: tierCfg };
    openArena();
  }

  function openArena() {
    const a = active;
    const elRel = a.my.element && a.op.element ? (function () {
      const m = elementMult(a.my.element, a.op.element);
      return m > 1 ? '（灵根克制对方）' : (m < 1 ? '（灵根被克）' : '');
    })() : '';
    g.LS.ui.showBattleArena({
      my: { dao: a.my.dao, realm: a.my.realmName, weapon: a.my.weaponName, tech: a.my.techName, el: a.my.element || '—', hp: a.my.hpMax, cards: (a.my.handPool || []).length },
      op: { dao: a.op.dao, realm: a.op.realmName, weapon: a.op.weaponName, tech: a.op.techName, el: a.op.element || '—', hp: a.op.hpMax },
      elRel, weather: a.weather.text,
      mode: a.mode, senior: a.mode === 'senior',
      tierLabel: a.tier ? a.tier.label : '',
      tierDesc: a.tier ? a.tier.desc : ''
    }, () => beginFight());
  }

  function beginFight() {
    const a = active;
    if (!a) return;
    g.LS.ui.showBattleScreen(a.my, a.op);
    syncUI();
    var startLine = '斗法开始——' + a.my.dao + ' 对 ' + a.op.dao + (a.mode === 'senior' ? '（大师兄指教）' : '') + '！';
    // 头一回踏进斗法：先把规矩讲一遍，点「知道了」才开打；此后不再弹（记在 seen_hints）
    if (!S().seen_hints) S().seen_hints = {};
    if (!S().seen_hints.battle_guide && g.LS.ui.showBattleGuide) {
      g.LS.ui.showBattleGuide(function () {
        // 点过「知道了」才算看过：半路关掉弹窗（等于没打），下次进来还会讲一遍
        S().seen_hints.battle_guide = 1;
        g.LS.save.save();
        g.LS.ui.battleLog(startLine);
        startTurn();
      });
      return;
    }
    g.LS.ui.battleLog(startLine);
    startTurn();
  }

  /* ── 手牌＝自配卡组（2026-09-21 玩家口径：删掉每回合抽 8 张）──
     每回合把招式录里那套牌整套摊在手上；行动点只决定「这一手能使得动哪几张」（付不起的置灰），
     出招依旧一回合一张。想带重手，就把坊市「秘传」的招买下来、编进卡组。 ── */
  function dealDeck(unit) {
    const deck = resolveDeck(unit.handPool || []);
    if (!deck.length) { // 极端兜底：卡组空且手牌池也空（存档异常）→ 给费用最低的一张，别让玩家无牌可动
      const cheap = (unit.handPool || []).slice().sort((x, y) => (x.cost || 0) - (y.cost || 0));
      if (cheap.length) deck.push(cheap[0]);
    }
    unit.hand = deck;
    return deck;
  }

  /** 回合开始：罡气归零、摊开卡组手牌、AI 亮意图、丹毒结算（行动点不自动回满，靠调息） */
  function startTurn() {
    const a = active;
    if (!a) return;
    a.round += 1;
    a.phase = 'my';
    a.busy = false;
    // 行动点不再每回合自动回满：出招按费用扣，用光了靠「调息 · 让招」恢复（用户口径 2026-09-13）
    if (a.round === 1) a.my.qi = a.my.qiMax;
    a.my.shield = 0;
    (a.my.handPool || []).forEach(c => { if (c._cdLeft > 0) c._cdLeft -= 1; }); // 招式 CD 流转
    dealDeck(a.my);   // 手牌＝自配卡组（不再每回合随机抽 8 张）
    rollIntent(a.op);   // 敌方行动点同样不自动回满，买不起任何一招时它这一手只能调息
    const evs = [];
    if (a.my.toxic >= 10) {
      // 丹毒自伤按气血百分比（2026-09-14 用户口径）：每满 10 点毒＝1 档，每档扣 2% 气血，
      // 下限 1 点、上限 12 点——免得低境界（练气 34 血）被固定 6 点/回合直接毒死，高境界又毫无感觉
      const dot = Math.max(1, Math.min(12, Math.round(a.my.hpMax * 0.02 * Math.floor(a.my.toxic / 10))));
      a.my.hp -= dot;
      evs.push({ type: 'poison', side: 'my', target: 'my', dealt: dot, text: '丹毒发作，' + a.my.dao + '气血翻涌（-' + dot + '）。' });
    }
    logEvents(evs);
    if (evs.length && g.LS.battleFx) g.LS.battleFx.float('my', '-' + evs[0].dealt, 'poison');
    if (a.my.hp <= 0) { fallIfDead('my'); finish(false, []); return; }
    // 卡组里全是境界压不住的招：提示一次，别让玩家干看着
    if (a.round === 1 && (a.my.hand || []).length && !a.my.hand.some(c => (c.cost || 0) <= a.my.qi)) {
      g.LS.ui.toast('行动点不足——手头的招都使不动了，先点「调息 · 让招」把行动点回满。', 4600);
    }
    g.LS.ui.showBattleIntent(intentText(a.op));
    if (a.op.intent && g.LS.battleFx) g.LS.battleFx.intent('op', a.op.intent);
    syncUI();
  }

  /** 我方出招：一回合只放一招，放完立刻把回合交给对方（2026-09-13 用户口径） */
  function playCard(idx) {
    const a = active;
    if (!a || a.busy || a.phase !== 'my') return;
    const card = a.my.hand[idx];
    if (!card) return;
    if (a.my.qi < (card.cost || 0)) { g.LS.ui.toast('行动点不足——此招需 ' + (card.cost || 0) + ' 点，先「调息 · 让招」回满'); return; }
    if ((card._cdLeft || 0) > 0) return;
    a.busy = true;
    a.phase = 'resolving-my';
    a.busySince = Date.now();
    a.my.qi -= card.cost || 0;   // 出招消耗行动点（用光了得靠「调息」回满）
    if (card.cd) card._cdLeft = card.cd + 1; // 出招进 CD（下回合 startTurn -1 抵消）
    if (card.ap_next) a.my.apBonus = (a.my.apBonus || 0) + card.ap_next; // 下回合行功更盛
    const evs = [];
    if (card.dmg) evs.push(applyHit(a.my, a.op, card, true));
    if (card.heal) evs.push(applyHeal(a.my, card.heal, card.name, true));
    if (card.shield) evs.push(applyShield(a.my, card.shield, card.name, true, { thorns_pct: card.thorns_pct || 0, block_heal: card.block_heal || 0 }));
    if (card.ap_drain) { a.op.apBonus = (a.op.apBonus || 0) - card.ap_drain; evs.push({ type: 'note', side: 'op', text: '青藤缠身——' + a.op.dao + '下回合约少一分行功。' }); }
    if (!card.dmg && !card.heal && !card.shield) evs.push({ type: 'note', side: 'my', text: a.my.dao + '运功调整气息。' });
    logEvents(evs);
    syncUI({ skipHP: true });   // 手牌/行动点立刻更新；血条等打到身上
    let settled = false;
    const after = () => {
      if (settled || active !== a) return;
      settled = true;
      clearTimeout(watchdog);
      a.busy = false;
      a.busySince = 0;
      syncHP();
      if (a.op.hp <= 0) { fallIfDead('op'); finish(true, []); return; }
      opTurn(); // 一招既出，回合交给对方
    };
    const watchdog = setTimeout(after, 6000); // 移动端后台降频或特效回调丢失时自动解锁回合
    if (g.LS.battleFx) g.LS.battleFx.play('my', card, evs, after, syncHP);
    else setTimeout(after, 420);
  }

  /** 玩家点「调 息」：不出招，行动点回满——代价是白让一手给对方 */
  function endTurn() {
    const a = active;
    if (!a) return;
    if (a.busy || a.phase !== 'my') { g.LS.ui.toast('这一手尚在结算，请稍候。'); return; }
    a.my.qi = Math.max(1, a.my.qiMax + (a.my.apBonus || 0));
    a.my.apBonus = 0;
    logEvents([{ text: a.my.dao + '盘膝调息，行动点复满。' }]);
    if (g.LS.battleFx) g.LS.battleFx.float('my', '调 息', 'shield');
    syncUI();
    opTurn();
  }

  /** 对方回合：与玩家同规则——一回合只出一招，出完进入下一回合 */
  function opTurn() {
    const a = active;
    if (!a) return;
    a.busy = true;
    a.phase = 'op';
    a.busySince = Date.now();
    const it = a.op.intent;
    a.op.shield = 0; // 对方回合开始先散旧罡气，出招再凝新罩
    const evs = [];
    if (it) {
      if (it.rest) {
        // 与玩家「调息 · 让招」同构：本手不出招，把行动点回满（apBonus 的增减在此结算）
        a.op.qi = Math.max(1, a.op.qiMax + (a.op.apBonus || 0));
        a.op.apBonus = 0;
        evs.push({ type: 'note', side: 'op', text: a.op.dao + '按剑不动，盘膝调息——行动点复满，这一手不出招。' });
      } else {
        a.op.qi -= it.cost || 0;   // 对方出招同样消耗行动点
        if (it.dmg) evs.push(applyHit(a.op, a.my, it, false));
        if (it.heal) evs.push(applyHeal(a.op, it.heal, it.name, false));
        if (it.shield) evs.push(applyShield(a.op, it.shield, it.name, false, { thorns_pct: it.thorns_pct || 0, block_heal: it.block_heal || 0 }));
        if (!it.dmg && !it.heal && !it.shield) evs.push({ type: 'note', side: 'op', text: a.op.dao + '按剑不动，调息蓄势。' });
      }
    }
    // 挡后回气（玄武镇岳）：对方出招结束我方罡气尚存 → 回气
    if (a.my.shield > 0 && a.my.shieldAttrs && a.my.shieldAttrs.block_heal) {
      const h = a.my.shieldAttrs.block_heal;
      a.my.hp = Math.min(a.my.hpMax, a.my.hp + h);
      evs.push({ type: 'heal', side: 'my', target: 'my', name: '罡气未破', amount: h, text: '罡气未破——' + a.my.dao + '借势回气 ' + h + ' 点。' });
    }
    logEvents(evs);
    g.LS.ui.showBattleIntent('');
    syncUI({ skipHP: true });   // 对方这一手打到我身上时再掉血
    let settled = false;
    const after = () => {
      if (settled || active !== a) return;
      settled = true;
      clearTimeout(watchdog);
      a.busy = false;
      a.busySince = 0;
      syncHP();
      if (a.my.hp <= 0) { fallIfDead('my'); finish(false, []); return; }
      if (a.op.hp <= 0) { fallIfDead('op'); finish(true, []); return; }
      // 天道裁定（乙§2）：12 回合未分胜负，按剩余气血百分比判，防双龟流与 AI 卡壳死局
      if (a.round >= 12) {
        const myPct = a.my.hp / a.my.hpMax, opPct = a.op.hp / a.op.hpMax;
        const line = '十二回合已满，天道裁定：' + (myPct > opPct ? a.my.dao + '气机更完足，判胜！' : (myPct < opPct ? a.op.dao + '气机更完足，判胜。' : '气机相当，挑战方让半招——判负。'));
        logEvents([{ text: line }]);
        finish(myPct > opPct, []);
        return;
      }
      setTimeout(startTurn, 260);
    };
    const watchdog = setTimeout(after, 6000);
    if (g.LS.battleFx) g.LS.battleFx.play('op', it || { name: '调息' }, evs, after, syncHP);
    else setTimeout(after, 420);
  }

  /** 只刷「气血 / 罡气」——出招时延后到招式打到身上那一刻再调（用户口径 2026-09-13） */
  function syncHP() {
    const a = active;
    if (!a) return;
    g.LS.ui.updateBattleHP(Math.max(0, Math.ceil(a.my.hp)), a.my.hpMax, Math.max(0, Math.ceil(a.op.hp)), a.op.hpMax);
    g.LS.ui.updateBattleShields(a.my.shield, a.op.shield);
    // 舞台护罩跟着罡气走：>0 起罩、减少时涟漪、归零碎裂
    if (g.LS.battleFx && g.LS.battleFx.setShield) {
      g.LS.battleFx.setShield('my', a.my.shield);
      g.LS.battleFx.setShield('op', a.op.shield);
    }
  }

  function syncUI(opts) {
    const a = active;
    if (!a) return;
    if (!(opts && opts.skipHP)) syncHP();   // 出招流程里传 {skipHP:true}，改由演出命中时刷
    g.LS.ui.updateBattleQi(a.my.qi, a.my.qiMax);
    g.LS.ui.renderBattleHands((a.my.hand || []).map((c, i) => ({
      idx: i, name: c.name, cost: c.cost || 0, desc: c.desc || '',
      dmg: c.dmg ? c.dmgFinal : 0, heal: c.heal || 0, shield: c.shield || 0,
      el: c.el === 'root' ? (a.my.element || '五行') : (c.el || null),
      cdLeft: c._cdLeft || 0,
      disabled: a.my.qi < (c.cost || 0) || (c._cdLeft || 0) > 0
    })));
  }

  function finish(win, lines) {
    const a = active;
    if (!a) return;
    syncHP();   // 收尾时血条归位（最后一击可能没走完整演出）
    const diff = Math.max(0, (a.op.realm || 0) - S().realm.index);
    const cfg = CUL().battle || {};
    let honor = 0;
    if (win) {
      honor = (cfg.win_honor_base || 12) + diff * (cfg.win_honor_per_realm_diff || 6);
      S().honor += honor;
      S().record.win += 1;
      g.LS.state.changeDaoHeart(cfg.dao_win || 2);
      lines.push('胜负已分——' + a.my.dao + '招式连绵压制，胜！');
      if (diff >= 2) {
        if (!S().chronicle_lines) S().chronicle_lines = [];
        S().chronicle_lines.push(U().fmtGameDate(S().game_days || 0) + '，与' + (a.op.dao || '道友') + '论道，以下克上，一战成名。');
      }
    } else {
      S().record.lose += 1;
      g.LS.state.changeDaoHeart(cfg.dao_lose != null ? cfg.dao_lose : -3);
      lines.push('胜负已分——' + a.op.dao + '技高一筹，' + a.my.dao + '拱手认负，来日再战。');
    }
    g.LS.ui.battleAppend(lines);
    // 奇遇强敌结算（乙§6.4）：胜=夺其财+心魔；败=强敌走死亡链、弱敌掉灵石
    if (a.mode === 'ambush' && a.ambushCtx) {
      const ctx = a.ambushCtx;
      if (win) {
        active = null;
        setTimeout(() => { if (ctx.onWin) ctx.onWin(); }, 500);
        return;
      }
      active = null;
      setTimeout(() => { if (ctx.onLose) ctx.onLose(); }, 500);
      return;
    }
    const tctx = a.trialCtx;
    let trialLines = null;
    if (win && tctx && g.LS.trial) {
      const r = g.LS.trial.settle(tctx);
      trialLines = r.lines;
      honor = 0; // 试炼塔不计论道积分
    }
    g.LS.ui.battleAppend(trialLines || []);
    setTimeout(() => {
      g.LS.ui.showBattleResult(win, {
        honor, diff, hpLeft: Math.max(0, Math.ceil(a.my.hp)),
        senior: a.mode === 'senior',
        trial: trialLines ? trialLines.join('<br>') : ''
      });
      g.LS.save.save();
      active = null;
    }, 600);
  }

  function skip() { if (active) endTurn(); }
  function abort() { active = null; }

  g.LS.battle = {
    makeCard, cardPower, elementMult, myDaoHao,
    prepareBattle, challengeSenior, playCard, endTurn, skip, abort,
    resolveDeck, ownsCard, KINDS, KIND_NAME, KIND_LIMITS, SENIOR_TIERS, combatPower, talentLv, startTrialFight, startAmbushFight,
    get active() { return active; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
