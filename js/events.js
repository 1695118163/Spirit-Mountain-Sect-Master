/**
 * events.js —— 奇遇调度、effect_slots 预掷、内置事件池选取、弹窗选项应用、因果/保底。
 * 抽取管线（顺序固定）：触发 → 因果回收判定 → 稀有度 roll（含保底）→ 选池选卡 → 预掷 slots → LLM 或内置文案 → 弹窗。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  function BAL() { return g.LS.BAL; }
  function EVT() { return g.LS.EVT || []; }
  function S() { return g.LS.S; }
  function U() { return g.LS.util; }
  function ECO() { return g.LS.economy; }

  function hasPrestige(id) { return S().prestige.bought.indexOf(id) !== -1; }
  function talentLv(id) { const b = S().prestige.bought; return b ? b.filter(x => x === id).length : 0; }

  /* ── 解锁集合 ── */

  function poolsUnlocked() {
    const s = S();
    return BAL().pools.filter(p => {
      if (p.unlock_realm > s.realm.index) return false;
      if (p.id === 'DARK') {
        if (s.path === 'xie') return true;
        return (s.xinmo || 0) >= ((BAL().events.pool_weight || {}).xinmo_high_threshold || 12)
          && !(s.flags && s.flags[((BAL().path || {}).enter || {}).refuse_flag || 'refused_dark']);
      }
      if (p.id === 'DISCIPLE') return (s.disciples || []).some(d => d.status === 'active');
      return true;
    }).map(p => p.id);
  }

  function eventEligible(ev) {
    const s = S(), req = ev.requires || {};
    if (ev.min_realm != null && s.realm.index < ev.min_realm) return false;
    if (req.not_flag && s.flags && s.flags[req.not_flag]) return false;
    const active = (s.disciples || []).filter(d => d.status === 'active');
    if (req.active_disciple && !active.length) return false;
    if (req.disciple_room && active.length >= (((BAL().disciple || {}).max_slots) || 20)) return false;
    if (req.trait && !active.some(d => (d.traits || []).some(t => t.key === req.trait))) return false;
    if (req.suspicion_min != null && !active.some(d => (d.suspicion || 0) >= req.suspicion_min)) return false;
    if (req.suspicion_range && !active.some(d => (d.suspicion || 0) >= req.suspicion_range[0] && (d.suspicion || 0) <= req.suspicion_range[1])) return false;
    if (req.pill_min != null && g.LS.economy && g.LS.economy.pillTotal && g.LS.economy.pillTotal() < req.pill_min) return false;
    return true;
  }

  /* ── 奇遇频率 ── */

  function realmIntervalMult() {
    const r = BAL().realms[S().realm.index];
    const t = (r && r.traits || []).find(x => x.indexOf('interval_mult_') === 0);
    return t ? parseFloat(t.slice('interval_mult_'.length)) : 1;
  }

  function intervalMs() {
    const ev = BAL().events;
    let itv = U().rand(ev.interval_base_s - ev.interval_jitter_s, ev.interval_base_s + ev.interval_jitter_s);
    itv *= realmIntervalMult();                 // 金丹被动 −10%
    itv *= Math.max(0.7, 1 - 0.05 * talentLv('fuyuan'));     // 福缘 −5%/级
    return Math.max(ev.interval_min_s, itv) * 1000;
  }

  function scheduleNext() {
    S().event_state.next_event_at = Date.now() + intervalMs();
  }

  /* ── 稀有度与保底 ── */

  function rollRarity() {
    const s = S();
    const cfg = BAL().events.rarity;
    if (s.prestige.first_event_after_rebirth) return ['灵', '珍', '仙'][Math.min(2, talentLv('qianshijiyuan') - 1)] || '仙'; // 前世机缘三档：必灵→必珍→必仙
    if (s.event_state.since_xian >= cfg.pity_no_xian) return '仙';
    if (s.event_state.since_rare >= cfg.pity_no_rare) return '珍';
    const high = s.realm.index >= cfg.high_realm_index;
    const weights = Object.assign({}, high ? cfg.weights_high : cfg.weights_default);
    weights['仙'] += talentLv('fuyuan');          // 福缘仙品权重 +1/级
    return U().weightedPick(cfg.keys, k => weights[k]);
  }

  /** 连续 2 次抽到含负面 → 下次必纯正面 */
  function forcePositiveNow() {
    return S().event_state.recent_negatives >= (BAL().events.negative.consecutive_neg_then_pure || 2);
  }

  /* ── 因果回收 ── */

  function karmaCheck() {
    const s = S();
    const active = Object.keys(s.tags).map(k => s.tags[k]).filter(t => !t.recycled && t.weight >= 1);
    const hits = active.filter(t => Math.random() < (BAL().events.karma.hit_base || 0.3) * t.weight);
    if (!hits.length) return null;
    const t = U().weightedPick(hits, x => x.weight);
    const pools = poolsUnlocked();
    const cands = EVT().filter(e => e.recycle === t.key && pools.indexOf(e.pool) !== -1);
    return cands.length ? cands[0] : null;
  }

  function resolveTag(key, after) {
    const s = S();
    const t = s.tags[key];
    if (!t) return;
    const map = { '恩': '缘', '缘': '恩', '债': '清', '怨': '清' };
    const ns = after || map[t.stance] || '清';
    t.recycled = true;
    t.resolved_realm = s.realm.index;
    if (ns !== '清') { // 两段式因果链：转化为新 stance 继续
      t.stance = ns;
      t.weight = 1;
      t.recycled = false;
      t.since_realm = s.realm.index;
    }
  }

  /* ── 选池选卡 ── */

  function pickByRarity(rarity) {
    const s = S();
    const cfg = BAL().events.rarity;
    const now = Date.now();
    const blocked = new Set((s.event_state.recent_ids || [])
      .filter(x => now - x.ts < cfg.recent_repeat_block_ms).map(x => x.id));
    const pw = BAL().events.pool_weight;
    let poolIds = poolsUnlocked();
    for (let attempt = 0; attempt < 6 && poolIds.length; attempt++) {
      const pool = U().weightedPick(poolIds, p => {
        let w = 1;
        if (s.dao_heart > pw.dao_high_threshold && pw.pools_dao_high.indexOf(p) !== -1) w *= pw.boost_mult;
        if (s.dao_heart < pw.dao_low_threshold && pw.pools_dao_low.indexOf(p) !== -1) w *= pw.boost_mult;
        const xm = s.xinmo || 0;
        if (xm >= pw.xinmo_high_threshold && (pw.pools_xinmo_high || []).indexOf(p) !== -1) {
          w *= Math.min(pw.xinmo_linear_cap, 1 + xm / 50) * pw.xinmo_boost_mult;
        }
        return w;
      });
      const cands = EVT().filter(e => e.pool === pool && e.rarity === rarity && !e.recycle && !blocked.has(e.id) && eventEligible(e));
      if (cands.length) return cands[U().randInt(0, cands.length - 1)];
      poolIds = poolIds.filter(p => p !== pool); // 该池此稀有度无库存，换池
    }
    return null;
  }

  /** 普通奇遇固定展示五个行动。旧事件数据保留两条专属文案，其余行动在此补齐。 */
  function fiveChoiceDefs(ev) {
    const defs = (ev.options || []).slice(0, 5).map(opt => Object.assign({}, opt));
    const fallbacks = [
      { text: '先查清其中蹊跷', fits: ['C'] },
      { text: '召集门人共同商议', fits: ['A', 'C'] },
      { text: '暂且静观其变', fits: ['C', 'F'] }
    ];
    for (const fallback of fallbacks) {
      if (defs.length >= 5) break;
      if (!defs.some(opt => opt.text === fallback.text)) defs.push(Object.assign({}, fallback));
    }
    return defs.slice(0, 5);
  }

  /** 同稀有度候选卡：选池逻辑与 pickByRarity 同源（道心偏好的池加权），但要凑够 n 张不同的卡 */
  function pickCandidates(rarity, n) {
    const s = S();
    const cfg = BAL().events.rarity;
    const now = Date.now();
    const blocked = new Set((s.event_state.recent_ids || [])
      .filter(x => now - x.ts < cfg.recent_repeat_block_ms).map(x => x.id));
    const picked = [];
    const poolsLeft = poolsUnlocked();
    const pw = BAL().events.pool_weight;
    let guard = 0;
    while (picked.length < n && poolsLeft.length && guard++ < 60) {
      const pool = U().weightedPick(poolsLeft, p => {
        let w = 1;
        if (s.dao_heart > pw.dao_high_threshold && pw.pools_dao_high.indexOf(p) !== -1) w *= pw.boost_mult;
        if (s.dao_heart < pw.dao_low_threshold && pw.pools_dao_low.indexOf(p) !== -1) w *= pw.boost_mult;
        const xm = s.xinmo || 0;
        if (xm >= pw.xinmo_high_threshold && (pw.pools_xinmo_high || []).indexOf(p) !== -1) {
          w *= Math.min(pw.xinmo_linear_cap, 1 + xm / 50) * pw.xinmo_boost_mult;
        }
        return w;
      });
      const cands = EVT().filter(e => e.pool === pool && e.rarity === rarity && !e.recycle
        && !blocked.has(e.id) && !picked.some(x => x.id === e.id) && eventEligible(e));
      if (!cands.length) { poolsLeft.splice(poolsLeft.indexOf(pool), 1); continue; }   // 该池此稀有度没库存了
      picked.push(cands[U().randInt(0, cands.length - 1)]);
    }
    return picked;
  }

  /* ── effect_slots 预掷（LLM 只产文案，数值本地预掷注入） ── */

  function materializeSlot(type, rarity, evId) {
    const eff = BAL().events.effect;
    const s = S();
    const eco = ECO();
    switch (type) {
      case 'A': {
        const which = U().randInt(0, 3);
        if (which === 0) {
          const secs = U().rand(eff.A.qi_seconds_min, eff.A.qi_seconds_max);
          return { type: 'A', res: 'lingqi', rarity, amount: Math.max(10, eco.computePerSecond('lingqi') * secs) };
        }
        if (which === 1) {
          const secs = U().rand(eff.A.lingshi_seconds_min, eff.A.lingshi_seconds_max);
          return { type: 'A', res: 'lingshi', rarity, amount: Math.max(5, eco.computePerSecond('lingshi') * secs) };
        }
        if (which === 2) return { type: 'A', res: 'danyao', rarity, amount: U().randInt(eff.A.pill_min, eff.A.pill_max) };
        const next = BAL().realms[s.realm.index + 1];
        const need = next && next.need_xp ? next.need_xp : 100;
        return { type: 'A', res: 'xiufu', rarity, amount: need * U().rand(eff.A.xp_pct_of_need_min, eff.A.xp_pct_of_need_max) };
      }
      case 'B': {
        const which = U().randInt(0, 2);
        if (which === 0) return { type: 'B', res: 'lingqi', rarity, amount: -(s.resources.lingqi * U().rand(eff.B.qi_pct_min, eff.B.qi_pct_max)) };
        if (which === 1) {
          const next = BAL().realms[s.realm.index + 1];
          const need = next && next.need_xp ? next.need_xp : 100;
          return { type: 'B', res: 'xiufu', rarity, amount: -(need * U().rand(eff.B.xp_pct_of_need_min, eff.B.xp_pct_of_need_max)) };
        }
        return { type: 'B', res: 'danyao', rarity, amount: -U().randInt(eff.B.pill_min, eff.B.pill_max) };
      }
      case 'C': {
        const range = eff.C.mult_by_rarity[rarity] || eff.C.mult_by_rarity['凡'];
        const dur = U().randInt(eff.C.duration_min_s, eff.C.duration_max_s);
        if (Math.random() < 0.5) {
          return { type: 'C', rarity, mult: 1, click_mult: eff.C.click_mult_by_rarity[rarity] || 2, duration_s: dur, clickOnly: true };
        }
        return { type: 'C', rarity, mult: U().rand(range[0], range[1]), click_mult: 0, duration_s: dur };
      }
      case 'D': {
        const cap = (eff.D.cap_pct || 100) / 100;
        if (s.perm_bonus.all >= cap - 1e-9) {
          // 满 +100%：仙品及以上 D 类自动转为等值资源包
          const a = materializeSlot('A', '仙', evId);
          a.fromD = true;
          return a;
        }
        return { type: 'D', rarity, pct: (eff.D.perm_by_rarity[rarity] || 1) / 100 };
      }
      case 'E':
        return { type: 'E', rarity, seedEventId: evId, dueIn: U().randInt(eff.E.chain_due_min, eff.E.chain_due_max) };
      case 'F': {
        const ids = g.LS.realm.unlockedBuildingIds().filter(id => id !== 'tunafa');
        return { type: 'F', rarity, buildingId: ids.length ? ids[U().randInt(0, ids.length - 1)] : 'lingtian', duration_s: U().randInt(eff.F.duration_min_s, eff.F.duration_max_s) };
      }
      default:
        return { type: 'A', rarity, res: 'lingqi', amount: 10 };
    }
  }

    // 效果槽预掷：练气/筑基、避尘丹护体期间，B/F 槽重掷为 A/C；
    // 护山阵每级 −2% 负面权重（B/F 槽按概率被净化为增益槽，下限 50% 保留）
    function negativeSuppression() {
      const s = S();
      let p = 0;
      if (s.realm.index <= 1) p = 1;                                  // 低境零负面
      if (s.buffs.some(b => b.id === 'pill_shield' && b.ts_end > Date.now())) p = 1; // 避尘丹护体
      const hushan = (BAL().buildings.find(x => x.id === 'hushanzhen').effects || {}).neg_weight_per_level || 0.02;
      p = Math.max(p, Math.min(0.9, g.LS.economy.bLevel('hushanzhen') * Math.abs(hushan))); // 每级 +2% 净化率
      if (g.LS.economy.talentLv && g.LS.economy.talentLv('hushenfu')) p = Math.max(p, Math.min(0.9, 0.15 * g.LS.economy.talentLv('hushenfu') + 0.05)); // 护身符：负面净化 20%/35%/50%（净权−15%/级）
      return p;
    }
    function rollSlots(ev) {
      const suppress = negativeSuppression();
      return ev.options.map(opt => {
        let fits = (opt.fits || ['A']).slice();
        if (suppress > 0) {
          fits = fits.map(t => (t === 'B' || t === 'F')
            ? (Math.random() < suppress ? (Math.random() < 0.5 ? 'A' : 'C') : t)
            : t);
        }
        const type = fits[U().randInt(0, fits.length - 1)];
        return materializeSlot(type, ev.rarity, ev.id);
      });
    }

  /* ── 事件对象构建 ── */

  function buildBuiltinFinal(ev, slots, choiceDefs) {
    const defs = choiceDefs || fiveChoiceDefs(ev);
    const keys = ['A', 'B', 'D', 'E', 'F']; // C 专用于超时/关闭时的「离去」
    return {
      id: ev.id,
      source: 'builtin',
      rarity: ev.rarity,
      recycle: ev.recycle || null,
      after: ev.after || null,
      builtinTags: ev.tags || [],
      title: ev.title,
      desc: ev.desc,
      special: ev.special || null,
      disciple_effect: ev.disciple_effect || null,
      requires: ev.requires || null,
      five_choice: true,
      options: defs.map((opt, index) => ({
        key: keys[index],
        text: opt.text,
        slot: slots[index],
        daoxin: opt.daoxin || 0,
        special: opt.special || null
      }))
    };
  }

  /** 降级：LLM 失败 → 内置同源模板套用同一份预掷 slots（数值不受影响），用户无感知 */
  function buildFallbackEvent(ev, slots, rarity) {
    const f = buildBuiltinFinal(ev, slots);
    f.rarity = rarity || ev.rarity;
    return f;
  }

  /* ── 主流程 ── */

  /* ── 事件队列：同一时间只弹一个，未处理的排队（上限 3 条，超出丢最旧） ── */

  function enqueueOrShow(finalEv) {
    const s = S();
    const busy = !!s.event_state.open || (g.LS.ui && g.LS.ui.isModalOpen && g.LS.ui.isModalOpen());
    if (busy) {
      if (s.event_state.queue.length >= 3) {
        s.event_state.queue.shift();
        if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('见闻太多，一则旧事随风散去。');
      }
      s.event_state.queue.push(finalEv);
      return;
    }
    s.event_state.open = finalEv;
    s.event_state.opened_at = Date.now();
    if (g.LS.ui && g.LS.ui.showEventModal) g.LS.ui.showEventModal(finalEv);
  }

  /** 当前弹窗结算后调用：依次展示队列中的下一条（面板被玩家占用时轮询等待） */
  function pumpQueue(attempt) {
    const s = S();
    if (!s.event_state.queue.length || s.event_state.open) return;
    if (g.LS.ui && g.LS.ui.isModalOpen && g.LS.ui.isModalOpen()) {
      if ((attempt || 0) < 60) setTimeout(() => pumpQueue((attempt || 0) + 1), 2000); // 面板开着就等
      return;
    }
    const ev = s.event_state.queue.shift();
    s.event_state.open = ev;
    s.event_state.opened_at = Date.now();
    // 离线结算单：走卷轴样式（收益明细 + 收取），不是普通事件弹窗
    if (ev.kind === 'settle' && g.LS.ui && g.LS.ui.showOfflinePopup) {
      g.LS.ui.showOfflinePopup(ev.payload);
      return;
    }
    // 山门来报（离线 5 选 1）：挑一桩，选中后才成型
    if (ev.kind === 'pick' && g.LS.ui && g.LS.ui.showEventPicker) {
      const pickEv = ev;
      g.LS.ui.showEventPicker(pickEv.candidates, (key) => {
        const st = S();
        st.event_state.open = null;
        const entry = ((offlinePoolCfg() || {}).events || []).find(e => e.id === key)
          || (((offlinePoolCfg() || {}).events || [])[0]);
        if (!entry) { pumpQueue(0); return; }
        const fin = buildOfflineFinal(entry, pickEv.gap);
        st.event_state.open = fin;
        st.event_state.opened_at = Date.now();
        if (g.LS.ui && g.LS.ui.showEventModal) g.LS.ui.showEventModal(fin);
      }, { title: '山 门 来 报', desc: '弟子们在殿外候着——你离山这几日的山中事，先听哪一桩？' });
      return;
    }
    if (g.LS.ui && g.LS.ui.showEventModal) g.LS.ui.showEventModal(ev);
  }

  function openEventFlow(ev, rarity, fromKarma) {
    const s = S();
    const choiceDefs = fiveChoiceDefs(ev);
    const slots = rollSlots(Object.assign({}, ev, { options: choiceDefs }));
    let finalEv = buildBuiltinFinal(ev, slots, choiceDefs);
    if (rarity) finalEv.rarity = rarity;
    const hint = fromKarma ? '本次事件必须与此前的『' + ev.title + '』形成呼应，写它回来报恩或讨债' : '';

    const proceed = (useLLMResult) => {
      s.event_state.pending = false; // 管线结束，允许下一次触发
      if (useLLMResult) {
        finalEv = {
          id: U().uid(),
          source: 'llm',
          rarity: rarity || ev.rarity,
          recycle: null,
          after: null,
          builtinTags: ev.tags || [],
          disciple_effect: ev.disciple_effect || null,
          requires: ev.requires || null,
          title: useLLMResult.title,
          desc: useLLMResult.desc,
          five_choice: true,
          options: ['A', 'B', 'D', 'E', 'F'].map((key, index) => ({
            key,
            text: useLLMResult['option' + key],
            slot: slots[index],
            daoxin: choiceDefs[index].daoxin || 0,
            special: choiceDefs[index].special || null
          }))
        };
        S().stats.events_llm += 1;
      } else {
        S().stats.events_fallback += 1;
      }
      enqueueOrShow(finalEv);
      finalEv.baseId = ev.id; // LLM 文案事件也按其内置模板 id 计入去重，防「同一件事 4 分钟两遇」
    };

    const llmOk = ev.pool !== 'DARK' && ev.pool !== 'DISCIPLE'
      && g.LS.llm && g.LS.llm.isHealthy() && s.settings.llm_enabled;
    if (llmOk) {
      const payload = g.LS.llm.buildHistoryPayload(slots, hint);
      // LLM 与 20s 兜底竞速：超时/失败即内置池，玩家无感知
      Promise.race([
        g.LS.llm.requestEvent(payload).catch(() => null),
        new Promise(res => setTimeout(() => res(null), 20000))
      ]).then(r => proceed(r));
    } else {
      proceed(null);
    }
  }

  function drawEvent() {
    const s = S();
    if (s.event_state.pending) return; // 防重入：管线占用时不触发；弹窗开着的新事件由队列承接
    s.event_state.pending = true;
    scheduleNext(); // 触发即重排：无论后续成败，绝不连发顶掉当前事件
    let ev = null;
    let rarity = null;
    let fromKarma = false;

    // ① 因果回收（先于稀有度 roll；回收事件稀有度固定、不参与 roll）
    const kc = karmaCheck();
    if (kc) { ev = kc; fromKarma = true; }

    // ② 稀有度 roll + 选卡（含 仙→珍→灵→凡 回退与保底顺延）
    let pickedRarity = null;
    if (!ev) {
      rarity = rollRarity();
      const order = [rarity, '仙', '珍', '灵', '凡'];
      for (const rr of order) {
        ev = pickByRarity(rr); // 每次只随机一件奇遇，五选一发生在事件内部
        if (ev) { pickedRarity = rr; break; }
      }
      if (ev) {
        // 保底计数：出仙清双计数；出珍清 since_rare；库存顺延（用 pickedRarity 判定而非 rarity）
        if (pickedRarity === '仙') { s.event_state.since_xian = 0; s.event_state.since_rare = 0; }
        else if (pickedRarity === '珍') { s.event_state.since_rare = 0; s.event_state.since_xian += 1; }
        else { s.event_state.since_rare += 1; s.event_state.since_xian += 1; }
        if (s.prestige.first_event_after_rebirth && pickedRarity === '仙') {
          s.prestige.first_event_after_rebirth = false; // 前世机缘已兑现
        }
      }
    } else if (fromKarma) {
      pickedRarity = ev.rarity;
    }

    if (!ev) {
      s.event_state.pending = false; // 无库存等异常：释放管线，下个周期再试
      scheduleNext();
      return;
    }

    // 预告条 3 秒后弹窗（弹窗出现前主界面角落预告）
    if (g.LS.ui && g.LS.ui.setForewarn) g.LS.ui.setForewarn(true);
    setTimeout(() => {
      if (g.LS.ui && g.LS.ui.setForewarn) g.LS.ui.setForewarn(false);
      openEventFlow(ev, pickedRarity, fromKarma);
    }, 3000);
  }

  /* ── 结算 ── */

  function describeGain(slot, applied) {
    const U2 = U();
    if (!slot) return '';
    if (slot.type === 'A') return (g.LS.BAL.resources.find(r => r.id === slot.res) || { name: slot.res }).name + ' +' + U2.fmt(applied ? applied.delta : slot.amount);
    if (slot.type === 'B') return (g.LS.BAL.resources.find(r => r.id === slot.res) || { name: slot.res }).name + ' ' + U2.fmt(applied ? applied.delta : slot.amount);
    if (slot.type === 'C') {
      if (slot.clickOnly) return '点击增益 ' + slot.duration_s + ' 秒';
      return '全局 ×' + slot.mult.toFixed(1) + '（' + slot.duration_s + ' 秒）';
    }
    if (slot.type === 'D') return '永久加成 +' + Math.round(slot.pct * 100) + '%';
    if (slot.type === 'E') return '因果已种下';
    if (slot.type === 'F') return '产业异状 ' + slot.duration_s + ' 秒';
    return '';
  }

  function isNegativeSlot(slot) { return slot && (slot.type === 'B' || slot.type === 'F'); }

  /* ── 剧情链：起点事件选了特定选项 → 按概率接续下一幕（每幕照常预掷结算），「离去」即断 ── */

  /* ── 故人上门（visitor）：突破前/离线归来，有未了因果的故人亲身登门 ── */

  function buildVisitorFinal(entry) {
    const stageEv = {
      id: 'visitor:' + entry.karma,
      pool: 'VISITOR',
      rarity: '灵',
      title: entry.title,
      desc: entry.desc,
      options: entry.options,
      tags: []
    };
    const slots = rollSlots(stageEv);
    return {
      id: 'visitor:' + entry.karma,
      source: 'visitor',
      rarity: '灵',
      recycle: null,
      after: null,
      builtinTags: [],
      title: entry.title,
      desc: entry.desc,
      options: [
        { key: 'A', text: entry.options[0].text, slot: slots[0], daoxin: entry.options[0].daoxin || 0, effect: entry.options[0].effect || 'none' },
        { key: 'B', text: entry.options[1].text, slot: slots[1], daoxin: entry.options[1].daoxin || 0, effect: entry.options[1].effect || 'none' },
        { key: 'C', text: BAL().texts.event_leave, slot: null, daoxin: 0, effect: 'none' }
      ]
    };
  }

  /** moment: 'breakthrough' | 'offline'。命中返回 finalEv（调用方弹窗），否则 null。每 karma 每世一次。 */
  function maybeVisitor(moment) {
    const bal = BAL();
    const cfg = bal.visitors;
    if (!cfg || !cfg.entries || !cfg.entries.length) return null;
    const s = S();
    if (!s.visitor_seen) s.visitor_seen = {};
    const chance = moment === 'breakthrough' ? cfg.pre_breakthrough_chance : cfg.offline_chance;
    if (Math.random() >= chance) return null;
    const unresolved = Object.keys(s.tags).map(k => s.tags[k]).filter(t => !t.recycled && t.weight >= 1);
    const cands = [];
    for (const entry of cfg.entries) {
      if (s.visitor_seen[entry.karma]) continue;
      if (unresolved.some(t => t.key === entry.karma)) cands.push(entry);
    }
    if (!cands.length) return null;
    const entry = cands[U().randInt(0, cands.length - 1)];
    s.visitor_seen[entry.karma] = true;
    return buildVisitorFinal(entry);
  }

  /** 三世缘：该因果 key 是否在前几世结过缘（转生结转计数） */
  function isPastLife(key) {
    const leg = S().karma_legacy || {};
    return !!(leg[key] && leg[key].worlds >= 1);
  }

  /* ── 托梦：长离线归来，弟子来报山中这几日 ── */

  function rollDream(gapSec) {
    const cfg = BAL().offline_dreams;
    if (!cfg || Math.random() >= (cfg.chance || 0.5)) return null;
    const hours = gapSec / 3600;
    const tier = (cfg.tiers || []).find(t => hours >= t.min_hours && hours < t.max_hours);
    if (!tier || !tier.events.length) return null;
    const tpl = tier.events[U().randInt(0, tier.events.length - 1)];
    const stageEv = { id: 'dream:' + tpl.title, pool: 'DREAM', rarity: '灵', title: tpl.title, desc: tpl.desc, options: tpl.options, tags: [] };
    const slots = rollSlots(stageEv);
    return {
      id: 'dream:' + tpl.title,
      source: 'dream',
      rarity: '灵',
      recycle: null,
      after: null,
      builtinTags: [],
      title: tpl.title,
      desc: tpl.desc,
      options: [
        { key: 'A', text: tpl.options[0].text, slot: slots[0], daoxin: tpl.options[0].daoxin || 0, effect: tpl.options[0].effect || 'none' },
        { key: 'B', text: tpl.options[1].text, slot: slots[1], daoxin: tpl.options[1].daoxin || 0, effect: tpl.options[1].effect || 'none' },
        { key: 'C', text: BAL().texts.event_leave, slot: null, daoxin: 0, effect: 'none' }
      ]
    };
  }

  /* ── 离线归来独立事件池（2026-09-19）────────────────────────────────────
     data/offline_events.json 与日常奇遇池互不影响。离线越久抽得越多
     （count_by_hours），同一次离线不重复；结算单本身也作为队列首条事件。 */
  function offlinePoolCfg() {
    return (g.LS.BAL && g.LS.BAL.offline_events) || null;
  }

  /** 离线时长 → 抽几条（取最后一个满足的档） */
  function offlineEventCount(gapSec) {
    const cfg = offlinePoolCfg();
    if (!cfg) return 0;
    const hours = gapSec / 3600;
    let n = 0;
    for (const pair of (cfg.count_by_hours || [])) if (hours >= pair[0]) n = pair[1];
    return n;
  }

  function offlineCondOk(ev) {
    const c = ev.cond;
    if (!c || c === 'always') return true;
    const s = S();
    if (c === 'tag') {
      const tags = s.tags || {};
      return Object.keys(tags).some(k => tags[k] && !tags[k].recycled && tags[k].weight >= 1);
    }
    if (c === 'lingshoulan') return !!(g.LS.economy && g.LS.economy.bLevel('lingshoulan') >= 1);
    if (c === 'hushanzhen') return !!(g.LS.economy && g.LS.economy.bLevel('hushanzhen') >= 1);
    if (c === 'xinmo') return (s.xinmo || 0) > 30;
    if (c === 'daoxin') return (s.dao_heart || 0) >= 0;   // 道心不亏的人家才有人来上香
    return true;
  }

  /** 抽离线事件（加权、不重复、按条件过滤）→ finalEv 数组，结构与托梦一致 */
  /** 离线时长 → 口语化时间词（文案里用 {away} 占位，按真实离线时长替换） */
  function awayWord(gapSec) {
    const cfg = offlinePoolCfg();
    const table = (cfg && cfg.away_words) || [[2, '这一两个时辰'], [8, '这半日'], [26, '这一夜'], [192, '这几日'], [99999, '这大半月']];
    const h = (gapSec || 0) / 3600;
    for (let i = 0; i < table.length; i++) if (h < table[i][0]) return table[i][1];
    return table[table.length - 1][1];
  }

  /** 单个离线事件 → finalEv：正/负与效果槽在这里才掷（所以候选卡只漏标题、不漏结果） */
  function buildOfflineFinal(e, gapSec) {
    const cfg = offlinePoolCfg() || {};
    const rarity = cfg.default_rarity || '灵';
    const away = awayWord(gapSec);
    // 正/负随机：同一件事（比如弟子来报）可能是好事也可能是坏事。
    // 权重 = 数据里的基线（这件事本身的倾向） + 玩家状态浮动：
    //   道心厚则好事多，心魔重则坏事多 —— 「你修成什么样，山门就遇什么样的事」
    const st0 = S();
    const dx01 = Math.max(0, Math.min(120, st0.dao_heart || 0)) / 120;
    const xm01 = Math.max(0, Math.min(100, st0.xinmo || 0)) / 100;
    const shift = (dx01 - xm01) * 3;
    const pw = Math.max(0.5, (e.pos_weight == null ? 5 : e.pos_weight) + shift);
    const nw = Math.max(0.5, (e.neg_weight == null ? 5 : e.neg_weight) - shift);
    const isGood = Math.random() * (pw + nw) < pw;
    // 每个方向都是一组文案（好事也有好几种说法），随机挑一条，来回多挂几次不会老看同一句
    const pickSide = (v) => Array.isArray(v) ? (v.length ? v[Math.floor(Math.random() * v.length)] : null) : (v || null);
    const side = pickSide(isGood ? e.pos : e.neg) || pickSide(isGood ? e.neg : e.pos) || {};
    const desc = String(side.desc || e.desc || '').split('{away}').join(away);   // 「离山这几日」按真实离线时长落字
    const choiceDefs = ((cfg.choice_options || {})[e.id] || [
      { text: '稳妥处置', fits: ['A'] },
      { text: '亲自过问', fits: ['C'] },
      { text: '顺势而为', fits: ['A', 'C'] },
      { text: '从严处置', fits: ['A', 'F'] },
      { text: '暂且搁置', fits: ['F'] }
    ]).slice(0, 5);
    const stageEv = { id: e.id, pool: 'OFFLINE', rarity: rarity, title: e.title, desc: desc, options: choiceDefs, tags: [] };
    const slots = rollSlots(stageEv);
    return {
      id: 'offline:' + e.id,
      source: 'offline',
      rarity: rarity,
      recycle: null,
      after: null,
      builtinTags: [],
      title: e.title,
      desc: desc,
      five_choice: true,
      good: isGood,
      options: choiceDefs.map((choice, index) => ({
        key: 'O' + (index + 1),
        text: choice.text,
        slot: slots[index],
        daoxin: choice.daoxin || 0,
        effect: choice.effect || 'none'
      }))
    };
  }

  /** 离线事件抽取：加权、不重复、按条件过滤。五选一发生在每个事件的处置选项内。 */
  function rollOfflineCandidates(gapSec, count) {
    const cfg = offlinePoolCfg();
    if (!cfg || !cfg.events || !cfg.events.length) return [];
    const n = Math.max(0, Math.floor(count == null ? (cfg.count != null ? cfg.count : offlineEventCount(gapSec)) : count));
    const pool = cfg.events.filter(offlineCondOk);
    const picked = [];
    for (let i = 0; i < n && pool.length; i++) {
      const total = pool.reduce((a, e) => a + (e.weight == null ? 1 : e.weight), 0);
      let r = Math.random() * total, hit = pool.length - 1;
      for (let j = 0; j < pool.length; j++) {
        r -= (pool[j].weight == null ? 1 : pool[j].weight);
        if (r <= 0) { hit = j; break; }
      }
      const e = pool.splice(hit, 1)[0];          // 同一次离线不重复
      picked.push({ key: e.id, title: e.title, entry: e });
    }
    return picked;
  }

  /** 一次抽 cfg.count 条成型事件；每条事件内部均为五选一。 */
  function rollOfflineEvents(gapSec) {
    const cfg = offlinePoolCfg() || {};
    const n = cfg.count != null ? cfg.count : offlineEventCount(gapSec);
    if (!n) return [];
    return rollOfflineCandidates(gapSec, n).map(c => buildOfflineFinal(c.entry, gapSec));
  }

  /** 离线归来：结算单排第一，后面跟独立池事件 + 访客 / 托梦，然后开始依次弹 */
  function queueOfflineReturn(settleResult) {
    if (!settleResult) return;
    const s = S();
    const q = s.event_state.queue;
    q.push({
      id: 'offline:settle', source: 'offline', kind: 'settle', payload: settleResult,
      rarity: '灵', title: (BAL().texts || {}).offline_title || '山中无甲子', desc: '', options: []
    });
    // 随机抽取离线事件；每个事件自身提供五种处置方式，玩家从中选一。
    rollOfflineEvents(settleResult.gap).forEach(ev => q.push(ev));
    const visitor = maybeVisitor('offline');
    if (visitor) q.push(visitor);
    const dream = rollDream(settleResult.gap);
    if (dream) q.push(dream);
    pumpQueue(0);
  }

  /* ── 山志（编年手札）：大事自动记行，飞升/转生时凝成碑文 ── */

  function chronicle(kind, vars) {
    const s = S();
    const cfg = BAL().chronicle;
    if (!cfg) return;
    let tpl = cfg.templates[kind];
    if (!tpl) return;
    const date = U().fmtGameDate(s.game_days || 0);
    let line = tpl.replace('{date}', date);
    for (const k in (vars || {})) line = line.split('{' + k + '}').join(vars[k]);
    if (!s.chronicle_lines) s.chronicle_lines = [];
    s.chronicle_lines.push(line);
    if (s.chronicle_lines.length > (cfg.cap || 40)) s.chronicle_lines.shift();
  }

  /** 飞升/转生时：把本世山志凝成一篇碑文存入碑林（跨转生保留） */
  function carveStele() {
    const s = S();
    const cfg = BAL().chronicle || {};
    if (!s.chronicle_lines || !s.chronicle_lines.length) return;
    const year = (BAL().game_time && BAL().game_time.start_year || 1) + Math.floor((s.game_days || 0) / (((BAL().game_time || {}).months_per_year || 12) * ((BAL().game_time || {}).days_per_month || 30)));
    const title = (cfg.stele_title || '第{n}世').replace('{year}', String(year)).replace('{n}', String((s.prestige.count || 0) + 1));
    const body = s.chronicle_lines.slice(-(cfg.stele_max_lines || 10));
    if (!s.steles) s.steles = [];
    s.steles.push({ title, body, footer: (cfg.stele_footer || '').replace('{realm}', BAL().realms[s.realm.index].name) });
  }

  function buildChainEvent(chain, stageIdx) {
    const stage = chain.stages[stageIdx];
    const stageEv = { id: chain.id + ':stage' + stageIdx, pool: 'CHAIN', rarity: stage.rarity || '灵', title: stage.title, desc: stage.desc, options: stage.options, tags: [] };
    const slots = rollSlots(stageEv);
    const keys = ['A', 'B', 'C'];
    return {
      id: 'chain:' + chain.id + ':' + stageIdx,
      source: 'chain',
      rarity: stage.rarity || '灵',
      recycle: null,
      after: null,
      builtinTags: stage.tags || [],
      title: stage.title,
      desc: stage.desc,
      options: stage.options.map((opt, index) => ({
        key: keys[index], text: opt.text, slot: index < 2 ? slots[index] : null, daoxin: opt.daoxin || 0,
        xinmo_add: opt.xinmo_add || 0, action: opt.action || '', requires_xinmo: opt.requires_xinmo || 0
      }))
    };
  }

  function maybeStartDarkChain() {
    const s = S(), enter = (BAL().path || {}).enter || {};
    if (s.path === 'xie' || s.realm.index < (enter.chapter_min || 2) || (s.xinmo || 0) < (enter.chain_xinmo_min || 40)) return false;
    s.flags = s.flags || {};
    if (s.flags[enter.refuse_flag || 'refused_dark'] || s.flags.dark_chain_started) return false;
    const chain = (g.LS.CHAINS || []).find(c => c.id === enter.chain_id);
    if (!chain || !chain.stages || !chain.stages.length) return false;
    s.flags.dark_chain_started = 1;
    enqueueOrShow(buildChainEvent(chain, 0));
    scheduleNext();
    return true;
  }

  function maybeContinueChain(ev, key) {
    const CH = g.LS.CHAINS || [];
    if (!CH.length || key === 'C') return;
    let chain = null;
    let stageIdx = -1;
    if (typeof ev.id === 'string' && ev.id.indexOf('chain:') === 0) {
      const parts = ev.id.split(':');
      chain = CH.find(c => c.id === parts[1]);
      stageIdx = parseInt(parts[2], 10);
    } else {
      chain = CH.find(c => c.trigger_event === ev.id && (c.trigger_option === 'any' || c.trigger_option === key));
    }
    if (!chain || !Array.isArray(chain.stages) || !chain.stages.length) return;
    if (chain.id === ((BAL().path || {}).enter || {}).chain_id) {
      S().flags = S().flags || {};
      S().flags.dark_chain_started = 1;
    }
    let chance;
    if (stageIdx === -1) {
      chance = chain.trigger_chance != null ? chain.trigger_chance : 0.6;
    } else {
      if (stageIdx >= chain.stages.length - 1) return; // 已是最后一幕
      chance = chain.continue_chance != null ? chain.continue_chance : 0.8;
    }
    if (Math.random() >= chance) return;
    const nextIdx = stageIdx + 1;
    const finalEv = buildChainEvent(chain, nextIdx);
    // 稍作停顿再续：像翻到下一页
    setTimeout(() => { if (g.LS.S && g.LS.S.event_state) enqueueOrShow(finalEv); }, 700);
  }

  function chooseOption(key) {
    const s = S();
    const ev = s.event_state.open;
    if (!ev) return;
    const selected = ev.options.find(o => o.key === key);
    if (selected && selected.requires_xinmo && (s.xinmo || 0) < selected.requires_xinmo) {
      if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('心魔不足，还差 ' + (selected.requires_xinmo - (s.xinmo || 0)) + ' 点。');
      return;
    }
    s.event_state.open = null;
    let gainText = '';
    const actionableC = key === 'C' && selected && selected.action;

    if (key !== 'C' || actionableC) {
      const opt = selected;
      if (opt) {
        if (opt.slot) {
          const applied = g.LS.state.applyEffect(opt.slot);
          gainText = describeGain(opt.slot, applied);
          if (isNegativeSlot(opt.slot)) {
            s.event_state.recent_negatives += 1;
            s.stats.negative_settled += 1;
          } else {
            s.event_state.recent_negatives = 0;
          }
          s.stats.total_settled += 1;
        }
        if (opt.daoxin) {
          g.LS.state.changeDaoHeart(opt.daoxin);
          // 邪行积业（甲§7）：损人利己的选项积心魔 6~10，转生清零
          if (opt.daoxin <= -2 && typeof s.xinmo === 'number') {
            s.xinmo = Math.min(100, s.xinmo + 6 + Math.floor(Math.random() * 5));
          }
        }
        if (opt.xinmo_add) s.xinmo = Math.min(100, (s.xinmo || 0) + opt.xinmo_add);
        if (opt.action === 'refuse_dark' && g.LS.path) gainText += ' ' + g.LS.path.refuseDark().msg;
        if (opt.action === 'enter_xie' && g.LS.path) gainText += ' ' + g.LS.path.enterXie(false).msg;
        if (opt.action === 'enter_xie_deep' && g.LS.path) gainText += ' ' + g.LS.path.enterXie(true).msg;
        if (g.LS.path && g.LS.path.applyEventSpecial) g.LS.path.applyEventSpecial(ev, opt);
        if (ev.disciple_effect && g.LS.disciples) g.LS.disciples.applyEvent(ev.baseId || ev.id, ev.disciple_effect, key, ev.requires);
        // 故人上门/托梦的即时抉择效果（boost/disturb 存给下次突破，其余立即结算）
        if (opt.effect && opt.effect !== 'none') {
          const eco = g.LS.economy;
          switch (opt.effect) {
            case 'boost': s.bt.visitor_effect = 'boost'; break;
            case 'disturb': s.bt.visitor_effect = 'disturb'; break;
            case 'gift_pill': { const q = g.LS.economy.rollPillQuality(); g.LS.economy.grantPill('lingli', q, BAL().visitors.gift_pill_n || 5); gainText += ' 得灵力丹' + (BAL().visitors.gift_pill_n || 5) + '颗（' + q + '品）'; break; }
            case 'pay_lingshi': s.resources.lingshi = Math.max(0, s.resources.lingshi * (1 - (BAL().visitors.pay_lingshi_pct || 0.05))); break;
            case 'pay_pill': s.resources.danyao = Math.max(0, s.resources.danyao - (BAL().visitors.pay_pill_n || 5)); break;
            case 'calm': s.buffs = s.buffs.filter(bf => bf.id !== 'qihuo_debuff' && bf.id !== 'xinmo_debuff'); gainText += ' 心神安宁'; break;
          }
        }
      }
      // 写 tags（种因果）
      if (ev.builtinTags && ev.builtinTags.length) {
        for (const t of ev.builtinTags) g.LS.state.addTag(t.key, t.stance, t.weight);
      }
      // 因果回收结算
      if (ev.recycle) resolveTag(ev.recycle, ev.after);
      if (gainText && g.LS.ui && g.LS.ui.toast) g.LS.ui.toast(gainText);
      if (g.LS.ui && g.LS.ui.pushLog) g.LS.ui.pushLog({ title: ev.title, choice: opt ? opt.text : '', gainText });
    } else {
      s.event_state.recent_negatives = 0;
      if (g.LS.ui && g.LS.ui.pushLog) g.LS.ui.pushLog({ title: ev.title, choice: '离去', gainText: '' });
    }

    // recent_ids（10 分钟不重复，LLM 事件按内置模板 id 去重）
    const recentId = ev.baseId || ev.id;
    s.event_state.recent_ids.unshift({ id: recentId, ts: Date.now() });
    if (s.event_state.recent_ids.length > BAL().events.rarity.recent_ids_max) s.event_state.recent_ids.pop();

    // 图鉴收录（跨转生保留）：内置事件按 id 计数；剧情链记看过的最高幕
    if (typeof ev.id === 'string' && /^[A-J][0-9]{2}$/.test(ev.id)) {
      s.collection[ev.id] = (s.collection[ev.id] || 0) + 1;
    } else if (typeof ev.id === 'string' && ev.id.indexOf('chain:') === 0) {
      const parts = ev.id.split(':');
      s.chain_seen[parts[1]] = Math.max(s.chain_seen[parts[1]] || 0, parseInt(parts[2], 10) + 1);
    }

    s.event_state.log.unshift({ time: Date.now(), title: ev.title, choice: key === 'C' ? '离去' : (ev.options.find(o => o.key === key) || {}).text || '' });
    if (s.event_state.log.length > 5) s.event_state.log.pop();

    // 山志：奇遇/上门/托梦各记一行
    chronicle(ev.source === 'visitor' ? 'visitor' : (ev.source === 'dream' ? 'dream' : 'event'), { title: ev.title, choice: key === 'C' ? '离去' : (ev.options.find(o => o.key === key) || {}).text || '' });

    scheduleNext();
    g.LS.economy.clampAll();
    if (g.LS.ui && g.LS.ui.closeEventModal) g.LS.ui.closeEventModal();
    if (g.LS.ui && g.LS.ui.renderChronicle) g.LS.ui.renderChronicle();
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    // 剧情链续接：起点/上一幕选了特定选项 → 按概率推入下一幕（复用队列，天然连贯）
    maybeContinueChain(ev, key);
    // 队列里还有排队的见闻：稍后自动弹出（面板被玩家占用时 pumpQueue 内部会等待）
    if (s.event_state.queue.length) setTimeout(() => pumpQueue(0), 800);
  }

  /* ── 调度入口（tick 每 250ms 调） ── */

  /** 奇遇强敌（乙§6）：金丹起偶遇劫匪/邪修，战力不足可能殒命——每世至多 2 次 */
  function maybeAmbush(now) {
    const s = S();
    const revenge = (s.disciple_revenge || []).find(r => !r.resolved && (s.game_days || 0) >= r.due_day);
    if ((s.realm.index < 2 && !revenge) || s.event_state.pending) return false;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
    s.ambush = s.ambush || { count: 0, next_ts: 0 };
    if (!revenge && (s.ambush.count >= 2 || now < (s.ambush.next_ts || 0))) return false;
    const xm = s.xinmo || 0;
    let p = 0.12;
    if (xm >= 30) p *= 1.5;
    if (xm >= 60) p *= 1.3;
    if (revenge && Math.random() >= revenge.chance) { revenge.resolved = true; return false; }
    if (!revenge && Math.random() >= p) { s.ambush.next_ts = now + 240000; return false; }
    const scale = [0.7, 1.0, 1.25, 1.45];
    const cpScale = scale[Math.floor(Math.random() * scale.length)];
    const names = xm >= 60 ? ['心魔化形的另一个你', '血罗刹', '黄泉引路人'] : (xm >= 30 ? ['寻仇的邪修', '黑市牙行的打手', '魔道修士'] : ['山道劫匪', '黑风寨劫匪', '断岳蛮修']);
    const name = revenge ? '叛徒' + revenge.name : names[Math.floor(Math.random() * names.length)];
    const spec = g.LS.trial.buildMob(Math.max(2, s.realm.index));
    spec.name = name;
    spec.hpMult = 1;
    spec.dmgAdd = xm >= 60 ? 2 : 0;
    const enemyCP = Math.round(g.LS.battle.combatPower() * cpScale);
    if (revenge) revenge.resolved = true;
    else s.ambush.count += 1;
    s.ambush.next_ts = now + 600000;
    g.LS.ui.showAmbushModal({
      name, cpScale, enemyCP,
      moves: spec.moves.map(m => m.name).slice(0, 3).join('、'),
      spec,
      xinmo: xm
    });
    scheduleNext();
    return true;
  }

  function maybeTriggerEvent(now) {
    if (maybeStartDarkChain()) return;
    if (maybeAmbush(now)) return;
    const s = S();
    if (s.event_state.pending) return;      // 管线占用期间不触发；弹窗开着的新事件走队列
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const maxConfiguredWait = ((BAL().events.interval_base_s || 120) + (BAL().events.interval_jitter_s || 0)) * 1000;
    if (s.event_state.next_event_at - now > maxConfiguredWait) {
      s.event_state.next_event_at = now + maxConfiguredWait; // 老存档的旧长倒计时收敛到当前频率
    }
    if (now < s.event_state.next_event_at) return;
    // 连锁标记：第 N 次抽取时插播（首发包连锁落空为一次普通抽取）
    if (s.chains.length) {
      const c = s.chains[0];
      c.dueIn -= 1;
      if (c.dueIn <= 0) s.chains.shift();
    }
    drawEvent();
  }

  g.LS.events = {
    rollOfflineEvents, queueOfflineReturn,
    drawEvent, chooseOption, maybeTriggerEvent, scheduleNext, pumpQueue, maybeContinueChain, maybeStartDarkChain, maybeAmbush,
    maybeVisitor, rollDream, isPastLife, chronicle, carveStele,
    rollSlots, rollRarity, pickByRarity, pickCandidates, fiveChoiceDefs, materializeSlot,
    rollOfflineCandidates, buildOfflineFinal,
    buildFallbackEvent, buildBuiltinFinal, karmaCheck, resolveTag,
    intervalMs, isNegativeSlot
  };
})(typeof window !== 'undefined' ? window : globalThis);
