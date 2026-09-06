/**
 * battle.js —— 斗法引擎与界面流：
 *  - 影子斗法（离线好友）：对阵牌 → 回合制自动对垒（概率+克制+debuff，杀戮尖塔思路）
 *  - 在线约战（两人同时在线）：房间制同步回合，双方各选招、服务器结算、同时揭示
 * 数据：data/cultivation.json（武器/功法/招式表/五行/斗法参数）；QTE 已按玩家反馈移除。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const CUL = () => (g.LS.BAL && g.LS.BAL.cultivation) || {};
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
      v: 1,
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

  /* ── 五行克制 ── */
  function elementMult(myEl, opEl) {
    const wx = CUL().wuxing || {};
    if (myEl && opEl && wx.cycle && wx.cycle[myEl] === opEl) return wx.counter_mult || 1.25;
    if (myEl && opEl && wx.cycle && wx.cycle[opEl] === myEl) return wx.countered_mult || 0.85;
    return 1;
  }

  /* ── 斗法状态 ── */
  let active = null;   // 影子斗法
  let online = null;   // 在线约战 { room, token, myIdx, opDao, lastRound, submitted }

  function currentWeatherMod() {
    const ws = (S().weather_state || {}).kind || 'clear';
    if (ws === 'rain') return { fire: 0.85, water: 1.15, text: '天时：细雨绵绵——水行招式顺手，火行受阻。' };
    if (ws === 'fog') return { hit: -0.06, text: '天时：晨雾锁山——出手十有六七看得见。' };
    if (ws === 'snow') return { water: 1.1, fire: 0.9, text: '天时：落雪成霜，寒气助水行。' };
    return { text: '天时：晴，万里无云。' };
  }

  /** 战斗单位：从名片生成（我方实时含灵根/丹毒；对方影子摘要） */
  function buildFighter(card, isMe) {
    const bal = g.LS.BAL;
    const realm = card.realm || 0;
    const w = (bal.cultivation.weapons || []).find(x => x.id === card.weapon);
    const t = (bal.cultivation.techniques || []).find(x => x.id === card.technique);
    const rootMult = isMe ? (g.LS.state.spiritRootMult ? g.LS.state.spiritRootMult() : 1) : 1;
    return {
      dao: card.dao || (isMe ? myDaoHao() : '无名道友'),
      realm, realmName: (bal.realms[realm] || {}).name || '?',
      weaponName: w ? w.name : '徒手', weaponEl: w ? w.element : null,
      weaponMove: w ? (CUL().moves.weapon_moves[w.id] || null) : null,
      techName: t ? t.name : '粗浅吐纳', techEl: t ? t.element : null,
      techMove: t ? (CUL().moves.technique_moves[t.id] || null) : null,
      element: (isMe && s.spirit_root) ? s.spirit_root.element : (t ? t.element : null),
      daoxin: isMe ? s.dao_heart : (card.daoxin || 0),
      toxic: isMe ? (s.pill_toxic || 0) : 0,
      atk: Math.round((10 + realm * 6 + (w ? w.sharp * 0.4 : 3)) * (isMe ? rootMult : 1)),
      hpMax: Math.round(80 + realm * 45 + (w ? w.sharp * 0.8 : 6))
    };
  }

  /* ── 影子斗法：对阵牌 → 回合制自动对垒 ── */

  function prepareBattle(friend) {
    if (active || online) return;
    const s = S();
    if (!friend.card) { g.LS.ui.toast('这位道友还没有递过名片'); return; }
    const my = buildFighter(makeCard(), true);
    const op = buildFighter(friend.card, false);
    op.dao = friend.dao || op.dao;
    const wx = CUL().wuxing || {};
    const elRel = my.element && op.element && wx.cycle && wx.cycle[my.element] === op.element ? '（灵根克制对方）' :
      (my.element && op.element && wx.cycle[op.element] === my.element ? '（灵根被克）' : '');
    const weather = currentWeatherMod();
    active = { my, op, friend, weather };
    g.LS.ui.showBattleArena({
      my: { dao: my.dao, realm: my.realmName, weapon: my.weaponName, tech: my.techName, el: my.element || '—', hp: my.hpMax, atk: Math.round(my.atk) },
      op: { dao: op.dao, realm: op.realmName, weapon: op.weaponName || '未知', tech: op.techName || '未知', el: op.element || '—', hp: op.hpMax, atk: Math.round(op.atk) },
      elRel, weather: weather.text, online: false
    }, () => beginShadowFight());
  }

  function beginShadowFight() {
    const a = active;
    if (!a) return;
    g.LS.ui.showBattleScreen(a.my, a.op);
    g.LS.ui.updateBattleHP(a.my.hp, a.my.hpMax, a.op.hp, a.op.hpMax);
    g.LS.ui.battleLog('斗法开始——' + a.my.dao + ' 对 ' + a.op.dao + '！');
    setTimeout(stepRound, 900);
  }

  /** 单回合：双方各出一招（武器招 40% / 功法招 40% / 普攻 20%），结算克制/暴击/格挡/天时/丹毒 */
  function stepRound() {
    const a = active;
    if (!a) return;
    a.round += 1;
    const lines = [];
    if (a.my.toxic >= 10) {
      const dot = Math.min(12, Math.floor(a.my.toxic / 10) * 3);
      a.my.hp -= dot;
      lines.push('丹毒发作，' + a.my.dao + '气血翻涌（-' + dot + '）。');
    }
    const hit1 = resolveMove(a.my, a.op, a.weather, a.round, true);
    lines.push(hit1.text);
    a.op.hp -= hit1.dmg;
    if (a.op.hp <= 0) { finish(a, true, lines); return; }
    const hit2 = resolveMove(a.op, a.my, a.weather, a.round, false);
    lines.push(hit2.text);
    a.my.hp -= hit2.dmg;
    if (a.my.hp <= 0) { finish(a, false, lines); return; }
    g.LS.ui.battleAppend(lines);
    g.LS.ui.updateBattleHP(Math.max(0, a.my.hp), a.my.hpMax, Math.max(0, a.op.hp), a.op.hpMax);
    setTimeout(stepRound, 1100);
  }

  function resolveMove(atk, def, weather, round, isMe) {
    const roll = Math.random();
    let move, el, srcName;
    if (roll < 0.4 && atk.weaponMove) { move = atk.weaponMove; el = atk.weaponEl; srcName = atk.weaponName; }
    else if (roll < 0.8 && atk.techMove) { move = atk.techMove; el = atk.techEl; srcName = atk.techName; }
    else { move = CUL().moves.unarmed; el = null; srcName = '吐纳掌'; }
    let mult = move.mult || 1.0;
    const defEl = def.element;
    if (el && defEl) mult *= elementMult(el, defEl);
    if (weather && weather.fire != null && el === '火') mult *= weather.fire;
    if (weather && weather.water != null && el === '水') mult *= weather.water;
    let dmg = atk.atk * mult * (0.9 + Math.random() * 0.2);
    const critRate = 0.10 + Math.max(0, (atk.daoxin - def.daoxin)) * 0.001;
    let crit = false;
    if (Math.random() < critRate) { dmg *= 1.6; crit = true; }
    const guardRate = 0.18 + Math.max(0, def.daoxin) * 0.001;
    let guarded = false;
    if (!crit && Math.random() < guardRate) { dmg *= 0.5; guarded = true; }
    const missRate = 0.08 + ((weather && weather.hit) ? -weather.hit : 0);
    if (Math.random() < missRate) return { dmg: 0, text: (isMe ? '' : '对方') + '的「' + move.name + '」被侧身避过——没有命中。' };
    dmg = Math.max(1, Math.round(dmg));
    const relTxt = (el && defElOf(def)) ? relWord(elementMult(el, defElOf(def))) : '';
    const critTxt = crit ? '暴击！' : '';
    const guardTxt = guarded ? '（被格挡减半）' : '';
    return { dmg, text: (isMe ? '' : '对方') + '祭出「' + move.name + '」' + critTxt + guardTxt + '，造成 ' + dmg + ' 点' + relTxt + '。' };
    function defElOf(d) { return d.element; }
    function relWord(m2) { return m2 > 1 ? '克制！' : (m2 < 1 ? '被克。' : ''); }
  }

  function finish(a, win, lines) {
    const diff = Math.max(0, a.op.realm - S().realm.index);
    const cfg = CUL().battle || {};
    let honor = 0;
    if (win) {
      honor = (cfg.win_honor_base || 12) + diff * (cfg.win_honor_per_realm_diff || 6);
      S().honor += honor;
      S().record.win += 1;
      g.LS.state.changeDaoHeart(cfg.dao_win || 2);
      lines.push('胜负已分——' + a.my.dao + '灵机压过一头，胜！');
      if (diff >= 2) {
        if (!S().chronicle_lines) S().chronicle_lines = [];
        S().chronicle_lines.push(U().fmtGameDate(S().game_days || 0) + '，与' + (a.friend.dao || '道友') + '论道，以下克上，一战成名。');
      }
    } else {
      S().record.lose += 1;
      g.LS.state.changeDaoHeart(cfg.dao_lose != null ? cfg.dao_lose : -3);
      lines.push('胜负已分——' + a.op.dao + '技高一筹，' + a.my.dao + '拱手认负，来日再战。');
    }
    g.LS.ui.battleAppend(lines);
    g.LS.ui.showBattleResult(win, { honor, diff, hpLeft: Math.max(0, Math.ceil(a.my.hp)) });
    g.LS.save.save();
    active = null;
  }

  /* ── 在线约战：房间制同步回合（服务器中转，双方各选招同时揭示） ── */
  const API = '/api/duel';

  async function apiCall(path, body) {
    const r = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return r.json();
  }

  async function createDuelRoom() {
    const card = makeCard();
    const r = await apiCall('/create', { dao: myDaoHao(), card });
    if (!r.ok) { g.LS.ui.toast('创建房间失败：' + (r.error || '')); return; }
    online = { room: r.room, token: r.token, myIdx: 0, opDao: null, submittedRound: 0 };
    g.LS.ui.showOnlineRoom(r.room, () => { online = null; });
    pollOnline();
  }

  async function joinDuelRoom(code) {
    const card = makeCard();
    const r = await apiCall('/join', { room: (code || '').trim().toUpperCase(), dao: myDaoHao(), card });
    if (!r.ok) { g.LS.ui.toast('加入失败：' + (r.error || '')); return; }
    online = { room: (code || '').trim().toUpperCase(), token: r.token, myIdx: 1, opDao: null, submittedRound: 0 };
    g.LS.ui.toast('已入房，等待开战…');
    pollOnline();
  }

  async function pollOnline() {
    if (!online) return;
    try {
      const st = await apiCall('/state?room=' + online.room + '&token=' + online.token);
      if (!st.ok) return;
      if (st.winner != null) {
        const win = Number(st.winner) === online.myIdx;
        g.LS.ui.showBattleResult(win, { honor: win ? 24 : 0, diff: 0, pointer: win ? 100 : -100 });
        online = null;
        g.LS.save.save();
        return;
      }
      if (st.state === 'fighting' && st.round > online.submittedRound) {
        online.submittedRound = st.round;
        g.LS.ui.showOnlineMoves((move) => {
          apiCall('/move', { room: online.room, token: online.token, move }).catch(() => {});
          g.LS.ui.showOnlineWaiting('招式已出，等待对方…');
        });
      } else if (st.me.move_done && st.state === 'fighting') {
        g.LS.ui.showOnlineWaiting('双方招式已出——揭 示…');
      } else if (st.state === 'waiting' && online.myIdx === 0) {
        g.LS.ui.showOnlineWaiting('等待道友入房——房间码：' + online.room);
      }
    } catch (e) { /* 网络抖动继续轮询 */ }
    setTimeout(pollOnline, 1500);
  }

  async function submitOnlineMove(move) {
    if (!online) return;
    await apiCall('/move', { room: online.room, token: online.token, move }).catch(() => {});
  }

  g.LS.battle = {
    makeCard, cardPower, elementMult, myDaoHao,
    prepareBattle, skip, abort, createDuelRoom, joinDuelRoom, submitOnlineMove, pollOnline,
    get active() { return active; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
