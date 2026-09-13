/**
 * quest.js v2 —— 主线「掌门之路」欠账补领制：
 *  - 每个任务独立判定（checkTask 全为 ≥ 型）+ 独立已领记录（claimed_set["章_序"]）；
 *  - 达标即可领，跳级/超级永不丢失；已领永久标记，杜绝重复领取；
 *  - 旧档迁移：线性版（ch/idx/claimed）进度折算成 claimed_set——已推进的任务全部标已领，不重发；
 *  - 章完成钩子：第一章全领→收亲传弟子；第四章全领→传位太上长老。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const STORY = () => g.LS.BAL.story || {};
  const S = () => g.LS.S;
  const U = () => g.LS.util;

  /** 状态入口（含旧档一次性迁移：线性进度 → claimed_set，已领不重置） */
  function state() {
    const s = S();
    if (!s.mainquest) s.mainquest = { ch: 0, idx: 0, claimed: 0, done: false };
    const st = s.mainquest;
    if (!st.claimed_set) {
      st.claimed_set = {};
      const chapters = STORY().chapters || [];
      for (let c = 0; c < st.ch && c < chapters.length; c++)
        for (let i = 0; i < chapters[c].tasks.length; i++) st.claimed_set[c + '_' + i] = 1;
      if (st.ch < chapters.length)
        for (let i = 0; i < st.idx && i < chapters[st.ch].tasks.length; i++) st.claimed_set[st.ch + '_' + i] = 1;
      if (st.claimed > 0) st.claimed_set[st.ch + '_' + st.idx] = 1;
      st.idx = 0; st.claimed = 0; // 线性字段退役
    }
    return st;
  }

  function isClaimed(ch, idx) { return !!state().claimed_set[ch + '_' + idx]; }

  function checkTask(task) {
    const s = S();
    const c = task.check || [];
    try {
      switch (c[0]) {
        case 'b': return (s.buildings[c[1]] || 0) >= c[2];
        case 'res': return (s.resources[c[1]] || 0) >= c[2];
        case 'stat': return (s.stats[c[1]] || (c[1] === 'honor' ? s.honor : 0)) >= c[2];
        case 'realm': return s.realm.index >= c[1];
        case 'gear': return ((s.weapons_owned || []).length + (s.techniques_owned || []).length) >= c[1];
        case 'gear_grade': {
          const cul = g.LS.BAL.cultivation || {};
          const owned = (s.weapons_owned || []).concat(s.techniques_owned || []);
          return owned.some(id => {
            const it = (cul.weapons || []).find(x => x.id === id) || (cul.techniques || []).find(x => x.id === id);
            return it && it.grade === c[1];
          });
        }
        case 'disciple': return !!(s.disciple && s.disciple.recruited);
        case 'disciple_realm': return !!(s.disciple && s.disciple.recruited && (s.disciple.realm || 0) >= c[1]);
        case 'senior_win': return (s.record && s.record.win || 0) >= 1;
        case 'trial': {
          const t = s.trial && s.trial.cleared || {};
          for (let i = 1; i <= 5; i++) if (!t[c[1] + '_' + i]) return false;
          return true;
        }
        case 'trial_total': return Object.keys(s.trial && s.trial.cleared || {}).filter(k => k.indexOf('_') !== -1 && k.indexOf('imperial') === -1).length >= c[1];
        case 'imperial': return !!(s.trial && s.trial.cleared && s.trial.cleared['imperial_' + c[1]]);
        case 'diwen': return (s.diwen || 0) >= c[1];
        case 'relic': {
          const r = s.relics || {};
          return (r.mingdao && !r.mingdao_broken) || (r.huanhunjia && !r.huanhunjia_used);
        }
        case 'toxic_zero': return (s.pill_toxic || 0) <= 0;
        default: return false;
      }
    } catch (e) { return false; }
  }

  /** 单任务状态：'claimed' 已领 | 'claimable' 达标可领 | 'progress' 进行中 */
  function taskState(chIdx, idx) {
    const ch = (STORY().chapters || [])[chIdx];
    if (!ch || !ch.tasks[idx]) return 'claimed';
    if (isClaimed(chIdx, idx)) return 'claimed';
    return checkTask(ch.tasks[idx]) ? 'claimable' : 'progress';
  }

  /** 是否存在可领（红点） */
  function hasClaimable() {
    const chapters = STORY().chapters || [];
    for (let c = 0; c < chapters.length; c++)
      for (let i = 0; i < chapters[c].tasks.length; i++)
        if (taskState(c, i) === 'claimable') return true;
    return false;
  }

  function poll() { return hasClaimable(); }

  /** 章进度 {claimed, total, allClaimed} */
  function chapterProgress(chIdx) {
    const ch = (STORY().chapters || [])[chIdx];
    if (!ch) return { claimed: 0, total: 0, allClaimed: true };
    let n = 0;
    for (let i = 0; i < ch.tasks.length; i++) if (isClaimed(chIdx, i)) n += 1;
    return { claimed: n, total: ch.tasks.length, allClaimed: n >= ch.tasks.length };
  }

  /** 章完成一次性钩子 */
  function chapterHooks(chIdx) {
    const s = S();
    if (chIdx === 1 && (!s.disciple || !s.disciple.recruited)) recruitDisciple();
    if (chIdx === 4 && s.disciple && s.disciple.recruited && !s.disciple.agent) promoteElder();
  }

  /** 领奖：达标+未领 → 发奖+标记；章全领触发钩子一次（hooked 记录防重） */
  function claim(chIdx, idx) {
    const st = state();
    const ch = (STORY().chapters || [])[chIdx];
    if (!ch || !ch.tasks[idx]) return null;
    if (isClaimed(chIdx, idx)) return null; // 杜绝重复领取
    const task = ch.tasks[idx];
    if (!checkTask(task)) return null;
    st.claimed_set[chIdx + '_' + idx] = 1;
    let gainText = '';
    const r = task.reward || {};
    if (r.lingshi) { S().resources.lingshi += r.lingshi; gainText = '灵石 +' + U().fmt(r.lingshi); }
    // 章钩子：全章领完触发；特例——第一章收徒任务要求「已收徒」，改由其余任务全领时即收徒（防鸡生蛋死锁）
    const prog = chapterProgress(chIdx);
    const othersDone = ch.tasks.every((t, i) => (t.check && t.check[0] === 'disciple') || i === idx || isClaimed(chIdx, i)); // 收徒任务自身除外（防鸡生蛋死锁）
    let hooked = false;
    const tryHook = (cond) => {
      st.hooked = st.hooked || {};
      if (cond && !st.hooked[chIdx]) {
        st.hooked[chIdx] = 1;
        chapterHooks(chIdx);
        hooked = true;
      }
    };
    if (chIdx === 1) tryHook(othersDone);
    else tryHook(prog.allClaimed);
    g.LS.save.save();
    return { gainText, chapter: ch, task, hooked };
  }

  /* ── 传承钩子 ── */
  function recruitDisciple() {
    const s = S();
    s.disciple = s.disciple || { recruited: true, progress: 0, realm: 0, agent: false, fed: 0 };
    s.disciple.recruited = true;
    if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('【亲传弟子】首位亲传入门——传承面板可查看与投喂。', 5200);
  }
  function promoteElder() {
    const s = S();
    if (!s.disciple || !s.disciple.recruited || s.disciple.agent) return;
    s.disciple.agent = true;
    if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('【传位大典】你升任太上长老，亲传弟子升代理掌门——弟子成长加倍。', 5200);
  }

  /** 弟子成长（tick 每秒） */
  function tickDisciple() {
    const s = S();
    // 存量档兜底：第一章其余任务已领但收徒未触发（老版本死锁遗留）→ 补收徒
    if ((!s.disciple || !s.disciple.recruited) && !(s.mainquest && s.mainquest.hooked && s.mainquest.hooked[1])) {
      const ch1 = (STORY().chapters || [])[1];
      if (ch1 && ch1.tasks.every((t, i) => (t.check && t.check[0] === 'disciple') || isClaimed(1, i))) {
        s.mainquest.hooked = s.mainquest.hooked || {};
        s.mainquest.hooked[1] = 1;
        recruitDisciple();
      }
    }
    if (!s.disciple || !s.disciple.recruited) return;
    const rate = 0.02 * (s.realm.index + 1) * (s.disciple.agent ? 2 : 1);
    s.disciple.progress = Math.min(100, (s.disciple.progress || 0) + rate);
    s.disciple.realm = Math.min(s.realm.index, Math.floor((s.disciple.progress || 0) / 10));
  }

  /** 投喂 */
  function feedDisciple(pillId, quality) {
    const s = S();
    if (!s.disciple || !s.disciple.recruited) return { ok: false, msg: '尚无亲传弟子' };
    const eco = g.LS.economy;
    const key = eco.pillStockKey ? eco.pillStockKey(pillId, quality) : pillId + '_' + quality;
    if (!(s.pill_stock || {})[key]) return { ok: false, msg: '没有这颗丹' };
    s.pill_stock[key] -= 1;
    if (s.pill_stock[key] <= 0) delete s.pill_stock[key];
    const add = { '劣': 0.5, '凡': 1, '灵': 2, '珍': 4, '仙': 8 }[quality] || 1;
    s.disciple.fed = (s.disciple.fed || 0) + 1;
    s.disciple.progress = Math.min(100, (s.disciple.progress || 0) + add);
    s.disciple.realm = Math.min(s.realm.index, Math.floor((s.disciple.progress || 0) / 10));
    g.LS.save.save();
    return { ok: true, msg: '弟子服下丹药，修为精进（进度 +' + add + '%）' };
  }

  g.LS.quest = {
    state, taskState, hasClaimable, poll, chapterProgress, claim,
    checkTask, recruitDisciple, promoteElder, tickDisciple, feedDisciple, isClaimed
  };
})(typeof window !== 'undefined' ? window : globalThis);
