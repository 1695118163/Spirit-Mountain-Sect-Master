/**
 * quest.js —— 主线「掌门之路」（v0.23 批三）：
 *  - story.json 10 章任务链；check 类型：b建筑等级/res资源/stat统计键/realm境界/gear装备件数/
 *    gear_grade品阶/disciple弟子存在/disciple_realm弟子境界/senior_win胜大师兄/trial塔章/
 *    trial_total塔总关/imperial帝路/diwen帝纹/relic保命装/toxic_zero丹毒归零；
 *  - 进度存 s.mainquest={ch, idx, claimed}；tick 惰性检查当前任务→完成可领奖（领奖推剧情）。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const STORY = () => g.LS.BAL.story || {};
  const S = () => g.LS.S;
  const U = () => g.LS.util;

  function state() {
    const s = S();
    if (!s.mainquest) s.mainquest = { ch: 0, idx: 0, claimed: 0, done: false };
    return s.mainquest;
  }

  function checkTask(task) {
    const s = S();
    const c = task.check || [];
    const kind = c[0];
    try {
      switch (kind) {
        case 'b': return (s.buildings[c[1]] || 0) >= c[2];
        case 'res': return (s.resources[c[1]] || 0) >= c[2];
        case 'stat': return (s.stats[c[1]] || (c[1] === 'honor' ? s.honor : 0)) >= c[2];
        case 'realm': return s.realm.index >= c[1];
        case 'gear': {
          const w = s.weapons_owned || [], t = s.techniques_owned || [];
          return (w.length + t.length) >= c[1];
        }
        case 'gear_grade': {
          const cul = g.LS.BAL.cultivation || {};
          const grade = c[1];
          const owned = (s.weapons_owned || []).concat(s.techniques_owned || []);
          return owned.some(id => {
            const it = (cul.weapons || []).find(x => x.id === id) || (cul.techniques || []).find(x => x.id === id);
            return it && it.grade === grade;
          });
        }
        case 'disciple': return !!(s.disciple && s.disciple.recruited);
        case 'disciple_realm': return !!(s.disciple && s.disciple.recruited && (s.disciple.realm || 0) >= c[1]);
        case 'senior_win': return (s.record && s.record.win || 0) >= 1 && (s.ambush_wins || 0) >= 0; // 大师兄任一档胜场
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

  /** 当前任务（已完成章取 outro；全部完成 done） */
  function current() {
    const st = state();
    if (st.done) return null;
    const ch = (STORY().chapters || [])[st.ch];
    if (!ch) { st.done = true; return null; }
    if (st.idx >= ch.tasks.length) return { type: 'outro', chapter: ch };
    return { type: 'task', chapter: ch, task: ch.tasks[st.idx] };
  }

  /** 检查当前任务是否完成（tick 惰性调用） */
  function poll() {
    const st = state();
    if (st.done || st.claimed > 0) return false; // 有奖未领不推进
    const cur = current();
    if (!cur || cur.type !== 'task') return false;
    if (checkTask(cur.task)) { st.claimed = 1; return true; }
    return false;
  }

  /** 领奖：发奖励+推进任务指针（章末领奖推下一章） */
  function claim() {
    const st = state();
    const cur = current();
    if (!cur) return null;
    const ch = cur.chapter;
    let gainText = '';
    if (cur.type === 'task') {
      if (!st.claimed) return null;
      const r = cur.task.reward || {};
      if (r.lingshi) { S().resources.lingshi += r.lingshi; gainText = '灵石 +' + U().fmt(r.lingshi); }
      st.claimed = 0;
      st.idx += 1;
    } else {
      st.ch += 1;
      st.idx = 0;
      // 章末钩子：第一章完成且未收徒 → 自动收徒剧情
      if (ch.idx === 1 && (!S().disciple || !S().disciple.recruited)) recruitDisciple();
      if (ch.idx === 4 && S().disciple && S().disciple.recruited && !S().disciple.agent) promoteElder();
    }
    g.LS.save.save();
    return { gainText, chapter: ch };
  }

  /* ── 传承联动钩子（批四共用） ── */
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

  /** 弟子成长（tick 每秒）：0.02×(掌门境界+1)/秒，代理掌门 ×2；境界=floor(progress/10) 封顶掌门境界 */
  function tickDisciple() {
    const s = S();
    if (!s.disciple || !s.disciple.recruited) return;
    const rate = 0.02 * (s.realm.index + 1) * (s.disciple.agent ? 2 : 1);
    s.disciple.progress = Math.min(100, (s.disciple.progress || 0) + rate);
    const cap = s.realm.index;
    s.disciple.realm = Math.min(cap, Math.floor((s.disciple.progress || 0) / 10));
  }

  /** 投喂：消耗一颗丹药加速弟子（劣0.5/凡1/灵2/珍4/仙8 进度点） */
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

  g.LS.quest = { state, current, poll, claim, checkTask, recruitDisciple, promoteElder, tickDisciple, feedDisciple };
})(typeof window !== 'undefined' ? window : globalThis);
