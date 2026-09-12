/**
 * battle.js v3 —— 斗法引擎（杀戮尖塔式回合制选牌）：
 *  - 每回合双方 3 点灵力，从招式牌出招；护盾本回合有效；对方 AI 先亮「意图」再出手，玩家据此排牌博弈；
 *  - 五行克制 ×1.25 / 被克 ×0.85，天时（雨助水行/雪寒）微调，丹毒每回合自伤；
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

  /** 出战卡组解析：S().deck 按类取前 N 张合法牌（8 槽）；缺槽回退该类默认牌 */
  function resolveDeck() {
    const s = S();
    const pool = CARDS().my_cards || [];
    const deck = Array.isArray(s.deck) ? s.deck.slice() : [];
    const picked = [];
    for (const kind of KINDS) {
      const limit = KIND_LIMITS[kind] || 1;
      let taken = 0;
      for (const id of deck) {
        if (taken >= limit) break;
        const c = pool.find(x => x.id === id && x.kind === kind);
        if (c && ownsCard(c) && picked.indexOf(c) === -1) { picked.push(c); taken += 1; }
      }
      if (taken === 0) {
        const defaults = pool.filter(x => x.kind === kind && x.default);
        for (const fb of (defaults.length ? defaults : pool.filter(x => x.kind === kind))) {
          if (taken >= limit) break;
          picked.push(fb); taken += 1;
        }
      }
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
    const sharp = w ? w.sharp : 5;
    const rootMult = g.LS.state.spiritRootMult ? g.LS.state.spiritRootMult() : 1;
    const hpMax = Math.round((80 + realm * 45 + sharp * 0.8) * Math.min(1.3, rootMult));
    const hand = resolveDeck()
      .filter(c => !c.unlock_realm || realm >= c.unlock_realm)
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
      hpMax, hp: hpMax, qi: realm + 1, qiMax: realm + 1, shield: 0, hand // AP=境界+1（乙§2）
    };
  }

  /** 大师兄三档（用户口径：正常修炼都能打败，只是难易与收益不同） */
  const SENIOR_TIERS = {
    easy:  { key: 'easy',  label: '师弟切磋', offset: -1, hpMult: 0.85, follow: 0.35, dmgAdd: 0, desc: '低你一境的师弟陪练——稳，胜负手筋基本不亏。' },
    equal: { key: 'equal', label: '同门论道', offset: 0,  hpMult: 1.2, follow: 0.65, dmgAdd: 0, desc: '与你同境的同门——有来有回，看意图排牌可稳占上风。' },
    hard:  { key: 'hard',  label: '师兄指教', offset: +1, hpMult: 1.6, follow: 0.8, dmgAdd: 2, desc: '高你一境的师兄——凶险，胜则论道积分更多，以下克上可留名碑林。' }
  };

  /** 对方战斗单位：大师兄（按档位：境界偏移/气血倍率/补招概率/招式加成）或好友影子（通用卡组） */
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
    const base = 80 + realm * 45 + sharp * 0.8;
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

  /* ── 伤害结算：护盾先抵 → 气血；五行克制；天时 ── */
  function applyHit(src, dst, move, isMe) {
    const weather = active.weather;
    let el = move.el;
    if (el === 'root') el = src.element;
    let mult = 1;
    const relTxt = el && dst.element ? (function () {
      const m = elementMult(el, dst.element);
      if (m > 1) { mult *= m; return ' 克制！'; }
      if (m < 1) { mult *= m; return ' 被克。'; }
      return '';
    })() : '';
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
    return (isMe ? '' : '对方') + '施放「' + move.name + '」' + relTxt + '，' + parts.join('、') + '。';
  }

  function applyHeal(unit, amount, name, isMe) {
    const healed = Math.min(amount, unit.hpMax - unit.hp);
    unit.hp += healed;
    return (isMe ? '' : '对方') + '运转「' + name + '」，回复 ' + healed + ' 点气血。';
  }

  function applyShield(unit, amount, name, isMe, attrs) {
    unit.shield = (unit.shield || 0) + amount;
    unit.shieldAttrs = attrs || unit.shieldAttrs || {}; // 机制盾（反伤/挡后回血）：同回合双盾取后出者
    return (isMe ? '' : '对方') + '祭出「' + name + '」，凝起 ' + amount + ' 点罡气护罩。';
  }

  /* ── AI 拟人策略 + 杀戮尖塔式意图预告 ── */
  function rollIntent(op) {
    const moves = op.hand;
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
    op.hand.forEach(m => { if (m.cd && m !== pick && m.cdLeft > 0) m.cdLeft -= 1; });
    if (pick && pick.cd) pick.cdLeft = pick.cd + 1;
    op.intent = Object.assign({}, pick);
  }
  function pickAny(pool, key) {
    const hits = pool.filter(m => m[key]);
    return hits.length ? hits[Math.floor(Math.random() * hits.length)] : pool[0];
  }
  function intentText(op) {
    const it = op.intent;
    if (!it) return '';
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

  /** 战力评估（乙§2.3）：CP=100×2.05^境×装备锋锐系数×丹毒折损，事件判定/强敌/劫掠唯一出处 */
  function combatPower() {
    const s = S();
    const bal = g.LS.BAL;
    const w = (bal.cultivation.weapons || []).find(x => x.id === s.equip.weapon);
    const sharp = w ? w.sharp : 5;
    const cp = 100 * Math.pow(2.05, s.realm.index)
      * (1 + Math.min(0.6, sharp / 400))
      * Math.max(0.8, 1 - (s.pill_toxic || 0) * 0.002)
      * (1 + 0.03 * (s.prestige && s.prestige.count || 0)); // 转生加战力口子
    return Math.round(cp);
  }

  /* ── 对阵牌 ── */
  function prepareBattle(friend) {
    if (active) return;
    // 竞技门槛（乙§7）：化神以下禁与道友切磋（大师兄/试炼塔不限）
    if (S().realm.index < 4) { g.LS.ui.toast('化神方可与道友切磋——此前请以大师兄与试炼塔磨砺招式。'); return; }
    if (!friend.card) { g.LS.ui.toast('这位道友还没有递过名片'); return; }
    const my = buildMe();
    const op = buildOp(friend, false);
    active = { my, op, friend, weather: currentWeatherMod(), round: 0, mode: 'shadow' };
    openArena();
  }

  /** 挑战大师兄（三档人机陪练：easy 师弟 / equal 同门 / hard 师兄） */
  function challengeSenior(tier) {
    if (active) return;
    const tierCfg = SENIOR_TIERS[tier] || SENIOR_TIERS.equal;
    const my = buildMe();
    const op = buildOp(null, true, tierCfg);
    active = { my, op, friend: { dao: op.dao }, weather: currentWeatherMod(), round: 0, mode: 'senior', tier: tierCfg, aiFollow: tierCfg.follow };
    openArena();
  }

  function openArena() {
    const a = active;
    const elRel = a.my.element && a.op.element ? (function () {
      const m = elementMult(a.my.element, a.op.element);
      return m > 1 ? '（灵根克制对方）' : (m < 1 ? '（灵根被克）' : '');
    })() : '';
    g.LS.ui.showBattleArena({
      my: { dao: a.my.dao, realm: a.my.realmName, weapon: a.my.weaponName, tech: a.my.techName, el: a.my.element || '—', hp: a.my.hpMax, cards: a.my.hand.length },
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
    g.LS.ui.battleLog('斗法开始——' + a.my.dao + ' 对 ' + a.op.dao + (a.mode === 'senior' ? '（大师兄指教）' : '') + '！');
    startTurn();
  }

  /** 回合开始：灵力回满、罡气清零、弃牌堆洗回、AI 亮意图、丹毒结算 */
  function startTurn() {
    const a = active;
    if (!a) return;
    a.round += 1;
    a.my.qi = a.my.qiMax + (a.my.apBonus || 0); // 龟息功等「下回合+AP」
    a.my.apBonus = 0;
    a.my.shield = 0;
    a.my.played = []; // StS 规则：每张牌每回合限出一次，回合结束洗回
    (a.my.hand || []).forEach(c => { if (c._cdLeft > 0) c._cdLeft -= 1; }); // 招式 CD 流转
    a.op.qi = a.op.qiMax + (a.op.apBonus || 0);
    a.op.apBonus = 0;
    rollIntent(a.op);
    const lines = [];
    if (a.my.toxic >= 10) {
      const dot = Math.min(12, Math.floor(a.my.toxic / 10) * 3);
      a.my.hp -= dot;
      lines.push('丹毒发作，' + a.my.dao + '气血翻涌（-' + dot + '）。');
    }
    if (lines.length) g.LS.ui.battleAppend(lines);
    if (a.my.hp <= 0) { finish(false, []); return; }
    g.LS.ui.showBattleIntent(intentText(a.op));
    syncUI();
  }

  /** 我方出牌：立即结算；每张牌每回合限一次（打出入弃牌堆），灵力不足/已出时按钮禁用 */
  function playCard(idx) {
    const a = active;
    if (!a) return;
    const card = a.my.hand[idx];
    if (!card || a.my.qi < (card.cost || 0)) return;
    if ((a.my.played || []).indexOf(card.id) !== -1) { g.LS.ui.toast('此招本回合已使出，气机未复'); return; }
    a.my.played = a.my.played || [];
    a.my.played.push(card.id);
    if (card.cd) card._cdLeft = card.cd + 1; // 出牌进 CD（本回合末 startTurn -1 抵消当下）
    a.my.qi -= card.cost || 0;
    if (card.ap_next) a.my.apBonus = (a.my.apBonus || 0) + card.ap_next; // 出牌后下回合+AP
    const lines = [];
    let el = card.el;
    if (el === 'root') el = a.my.element;
    if (card.dmg) lines.push(applyHit(a.my, a.op, card, true));
    if (card.heal) lines.push(applyHeal(a.my, card.heal, card.name, true));
    if (card.shield) lines.push(applyShield(a.my, card.shield, card.name, true, { thorns_pct: card.thorns_pct || 0, block_heal: card.block_heal || 0 }));
    if (card.ap_drain) { a.op.apBonus = (a.op.apBonus || 0) - card.ap_drain; lines.push('青藤缠身——' + a.op.dao + '下回合约少一分行功。'); }
    if (!card.dmg && !card.heal && !card.shield) lines.push(a.my.dao + '运功调整气息。');
    g.LS.ui.battleAppend(lines);
    syncUI();
    if (a.op.hp <= 0) { finish(true, []); return; }
  }

  /** 结束回合 → 对方按意图出招（剩余灵力可能补后手）→ 进入下一回合 */
  function endTurn() {
    const a = active;
    if (!a) return;
    const it = a.op.intent;
    const lines = [];
    a.op.shield = 0; // StS 规则：对方回合开始先散旧罡气，出招再凝新罩
    if (it) {
      if (it.dmg) lines.push(applyHit(a.op, a.my, it, false));
      if (it.heal) lines.push(applyHeal(a.op, it.heal, it.name, false));
      if (it.shield) lines.push(applyShield(a.op, it.shield, it.name, false));
      a.op.qi -= it.cost || 0;
      // 连招后手：意图只亮主招，剩余灵力按档位概率再补一招——看破主招不等于稳赢
      let follow = 0;
      const followCap = Math.max(2, Math.floor((a.op.qiMax || 3) / 3));
      while (follow < followCap && a.op.qi > 0 && Math.random() < (a.aiFollow || 0.55)) {
        const pool = a.op.hand.filter(m => m !== it && (m.cost || 0) <= a.op.qi && (m.cd || 0) === 0 || m !== it && (m.cost || 0) <= a.op.qi && m.cdLeft <= 0);
        if (!pool.length) break;
        const extra = pool[Math.floor(Math.random() * pool.length)];
        a.op.qi -= extra.cost || 0;
        if (extra.dmg) lines.push(applyHit(a.op, a.my, extra, false));
        if (extra.heal) lines.push(applyHeal(a.op, extra.heal, extra.name, false));
        if (extra.shield) lines.push(applyShield(a.op, extra.shield, extra.name, false, { thorns_pct: extra.thorns_pct || 0, block_heal: extra.block_heal || 0 }));
        follow += 1;
      }
      if (follow) lines.push('（' + a.op.dao + '招式连绵，竟藏了后手！）');
    }
    // 挡后回气（玄武镇岳）：敌方出招结束我方罡气尚存 → 回气
    if (a.my.shield > 0 && a.my.shieldAttrs && a.my.shieldAttrs.block_heal) {
      const h = a.my.shieldAttrs.block_heal;
      a.my.hp = Math.min(a.my.hpMax, a.my.hp + h);
      lines.push('罡气未破——' + a.my.dao + '借势回气 ' + h + ' 点。');
    }
    g.LS.ui.battleAppend(lines);
    g.LS.ui.showBattleIntent('');
    syncUI();
    if (a.my.hp <= 0) { finish(false, lines); return; }
    if (a.op.hp <= 0) { finish(true, lines); return; }
    // 天道裁定（乙§2）：12 回合未分胜负，按剩余气血百分比判，防双龟流与 AI 卡壳死局
    if (a.round >= 12) {
      const myPct = a.my.hp / a.my.hpMax, opPct = a.op.hp / a.op.hpMax;
      lines.push('十二回合已满，天道裁定：' + (myPct > opPct ? a.my.dao + '气机更完足，判胜！' : (myPct < opPct ? a.op.dao + '气机更完足，判胜。' : '气机相当，挑战方让半招——判负。')));
      g.LS.ui.battleAppend(lines);
      finish(myPct > opPct, []);
      return;
    }
    setTimeout(startTurn, 700);
  }

  function syncUI() {
    const a = active;
    if (!a) return;
    g.LS.ui.updateBattleHP(Math.max(0, Math.ceil(a.my.hp)), a.my.hpMax, Math.max(0, Math.ceil(a.op.hp)), a.op.hpMax);
    g.LS.ui.updateBattleShields(a.my.shield, a.op.shield);
    g.LS.ui.updateBattleQi(a.my.qi, a.my.qiMax);
    g.LS.ui.renderBattleHands(a.my.hand.map((c, i) => ({
      idx: i, name: c.name, cost: c.cost || 0, desc: c.desc || '',
      dmg: c.dmg ? c.dmgFinal : 0, heal: c.heal || 0, shield: c.shield || 0,
      el: c.el === 'root' ? (a.my.element || '五行') : (c.el || null),
      cdLeft: c._cdLeft || 0,
      disabled: a.my.qi < (c.cost || 0) || (a.my.played || []).indexOf(c.id) !== -1 || (c._cdLeft || 0) > 0
    })));
  }

  function finish(win, lines) {
    const a = active;
    if (!a) return;
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
    setTimeout(() => {
      g.LS.ui.showBattleResult(win, { honor, diff, hpLeft: Math.max(0, Math.ceil(a.my.hp)), senior: a.mode === 'senior' });
      g.LS.save.save();
      active = null;
    }, 600);
  }

  function skip() { if (active) endTurn(); }
  function abort() { active = null; }

  g.LS.battle = {
    makeCard, cardPower, elementMult, myDaoHao,
    prepareBattle, challengeSenior, playCard, endTurn, skip, abort,
    resolveDeck, ownsCard, KINDS, KIND_NAME, KIND_LIMITS, SENIOR_TIERS, combatPower, talentLv,
    get active() { return active; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
