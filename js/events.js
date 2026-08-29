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

  /* ── 解锁集合 ── */

  function poolsUnlocked() {
    return BAL().pools.filter(p => p.unlock_realm <= S().realm.index).map(p => p.id);
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
    if (hasPrestige('fuyuan')) itv *= 0.85;     // 福缘 −15%
    return Math.max(ev.interval_min_s, itv) * 1000;
  }

  function scheduleNext() {
    S().event_state.next_event_at = Date.now() + intervalMs();
  }

  /* ── 稀有度与保底 ── */

  function rollRarity() {
    const s = S();
    const cfg = BAL().events.rarity;
    if (s.prestige.first_event_after_rebirth) return '仙'; // 前世机缘
    if (s.event_state.since_xian >= cfg.pity_no_xian) return '仙';
    if (s.event_state.since_rare >= cfg.pity_no_rare) return '珍';
    const high = s.realm.index >= cfg.high_realm_index;
    const weights = Object.assign({}, high ? cfg.weights_high : cfg.weights_default);
    if (hasPrestige('fuyuan')) weights['仙'] += 1;          // 福缘仙品权重 +1%
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
        return w;
      });
      const cands = EVT().filter(e => e.pool === pool && e.rarity === rarity && !e.recycle && !blocked.has(e.id));
      if (cands.length) return cands[U().randInt(0, cands.length - 1)];
      poolIds = poolIds.filter(p => p !== pool); // 该池此稀有度无库存，换池
    }
    return null;
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

  function rollSlots(ev) {
    const lowRealm = S().realm.index <= 1; // 练气/筑基零负面
    return ev.options.map(opt => {
      let fits = (opt.fits || ['A']).slice();
      if (lowRealm) fits = fits.map(t => (t === 'B' || t === 'F') ? (Math.random() < 0.5 ? 'A' : 'C') : t);
      const type = fits[U().randInt(0, fits.length - 1)];
      return materializeSlot(type, ev.rarity, ev.id);
    });
  }

  /* ── 事件对象构建 ── */

  function buildBuiltinFinal(ev, slots) {
    return {
      id: ev.id,
      source: 'builtin',
      rarity: ev.rarity,
      recycle: ev.recycle || null,
      after: ev.after || null,
      builtinTags: ev.tags || [],
      title: ev.title,
      desc: ev.desc,
      options: [
        { key: 'A', text: ev.options[0].text, slot: slots[0], daoxin: ev.options[0].daoxin || 0 },
        { key: 'B', text: ev.options[1].text, slot: slots[1], daoxin: ev.options[1].daoxin || 0 },
        { key: 'C', text: BAL().texts.event_leave, slot: null, daoxin: 0 }
      ]
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
    if (g.LS.ui && g.LS.ui.showEventModal) g.LS.ui.showEventModal(ev);
  }

  function openEventFlow(ev, rarity, fromKarma) {
    const s = S();
    const slots = rollSlots(ev);
    let finalEv = buildBuiltinFinal(ev, slots);
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
          title: useLLMResult.title,
          desc: useLLMResult.desc,
          options: [
            { key: 'A', text: useLLMResult.optionA, slot: slots[0], daoxin: ev.options[0].daoxin || 0 },
            { key: 'B', text: useLLMResult.optionB, slot: slots[1], daoxin: ev.options[1].daoxin || 0 },
            { key: 'C', text: BAL().texts.event_leave, slot: null, daoxin: 0 }
          ]
        };
        S().stats.events_llm += 1;
      } else {
        S().stats.events_fallback += 1;
      }
      enqueueOrShow(finalEv);
    };

    const llmOk = g.LS.llm && g.LS.llm.isHealthy() && s.settings.llm_enabled;
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
        ev = pickByRarity(rr);
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

  function chooseOption(key) {
    const s = S();
    const ev = s.event_state.open;
    if (!ev) return;
    s.event_state.open = null;
    let gainText = '';

    if (key === 'A' || key === 'B') {
      const opt = ev.options.find(o => o.key === key);
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
        if (opt.daoxin) g.LS.state.changeDaoHeart(opt.daoxin);
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

    // recent_ids（10 分钟不重复）
    s.event_state.recent_ids.unshift({ id: ev.id, ts: Date.now() });
    if (s.event_state.recent_ids.length > BAL().events.rarity.recent_ids_max) s.event_state.recent_ids.pop();

    s.event_state.log.unshift({ time: Date.now(), title: ev.title, choice: key === 'C' ? '离去' : (ev.options.find(o => o.key === key) || {}).text || '' });
    if (s.event_state.log.length > 5) s.event_state.log.pop();

    scheduleNext();
    g.LS.economy.clampAll();
    if (g.LS.ui && g.LS.ui.closeEventModal) g.LS.ui.closeEventModal();
    if (g.LS.ui && g.LS.ui.renderChronicle) g.LS.ui.renderChronicle();
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    // 队列里还有排队的见闻：稍后自动弹出（面板被玩家占用时 pumpQueue 内部会等待）
    if (s.event_state.queue.length) setTimeout(() => pumpQueue(0), 800);
  }

  /* ── 调度入口（tick 每 250ms 调） ── */

  function maybeTriggerEvent(now) {
    const s = S();
    if (s.event_state.pending) return;      // 管线占用期间不触发；弹窗开着的新事件走队列
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
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
    drawEvent, chooseOption, maybeTriggerEvent, scheduleNext, pumpQueue,
    rollSlots, rollRarity, pickByRarity, materializeSlot,
    buildFallbackEvent, buildBuiltinFinal, karmaCheck, resolveTag,
    intervalMs, isNegativeSlot
  };
})(typeof window !== 'undefined' ? window : globalThis);
