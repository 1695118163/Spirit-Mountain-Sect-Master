/**
 * llm.js —— 组装历史摘要、调本地代理、二道校验、LLM 结果与 slots 合并、失败降级。
 * 免费红线：QUOTA 即停用 LLM 并提示，绝不自动尝试任何付费路径。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  const PROXY = 'http://127.0.0.1:8787';
  let health = 'off';          // ok | degraded | off
  let disabledByQuota = false;
  let mockRaw = null;          // dev.mockLLM 注入，测校验降级

  function BAL() { return g.LS.BAL; }
  function S() { return g.LS.S; }

  function isHealthy() { return health === 'ok' && !disabledByQuota; }
  function getStatus() { return disabledByQuota ? 'off' : health; }
  function retryLLM() { disabledByQuota = false; checkHealth(); }

  let modelName = '';
  function setStatus(st) {
    health = st;
    if (g.LS.ui && g.LS.ui.setLLMStatus) g.LS.ui.setLLMStatus(getStatus(), modelName);
  }

  function fetchTimeout(u, ms, opts) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(u, Object.assign({ signal: ctrl.signal }, opts || {})).finally(() => clearTimeout(t));
  }

  /** 启动/定期探测代理健康（静态托管打开时同源可测；file:// 时依赖 CORS） */
  async function checkHealth() {
    if (typeof fetch === 'undefined' || typeof window === 'undefined') return;
    try {
      const r = await fetchTimeout(PROXY + '/api/health', 2500);
      const j = await r.json();
      if (disabledByQuota) return;         // 额度停用后不自动复活，等用户重试
      modelName = j.model || '';
      setStatus(j.ok && j.has_key ? 'ok' : 'off');
    } catch (e) {
      if (!disabledByQuota) setStatus('off');
    }
  }

  /** 槽类型+稀有度 → 无数字语义短语（映射表在 balance.json events.briefs） */
  function briefFor(slot) {
    const b = BAL().events.briefs;
    const prefix = (b.prefix_by_rarity && b.prefix_by_rarity[slot.rarity]) || '';
    return prefix + (b.by_type[slot.type] || '有所遭遇');
  }

  function buildHistoryPayload(slots, hint) {
    const s = S();
    const byStance = {};
    Object.keys(s.tags).forEach(k => {
      const t = s.tags[k];
      (byStance[t.stance] = byStance[t.stance] || []).push(t);
    });
    const tags = [];
    for (const st in byStance) {
      byStance[st].sort((a, b) => b.weight - a.weight).slice(0, 2)
        .forEach(t => tags.push({ type: st, label: t.key, weight: t.weight }));
    }
    const recent = (s.event_state.log || []).slice(0, 5).map(l => ({ title: l.title, chosen: l.choice }));
    return {
      realm: { index: s.realm.index, name: BAL().realms[s.realm.index].name },
      // 游戏内道心 ±100，映射到 system prompt 约定的 0-100 区间
      dao_heart: Math.round((s.dao_heart + 100) / 2),
      tags,
      recent,
      stats: { play_seconds: Math.floor(s.stats.play_seconds), total_events: s.stats.events_total },
      slots: slots.map((sl, i) => ({ key: ['A', 'B', 'D', 'E', 'F'][i], type: sl.type, rarity: sl.rarity || '', brief: briefFor(sl) })),
      hint: hint || ''
    };
  }

  function stripFences(raw) {
    return String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }

  function extractLocal(text) {
    let t = stripFences(text);
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a === -1 || b <= a) return null;
    t = t.slice(a, b + 1);
    const tries = [t, t.replace(/,\s*([}\]])/g, '$1')];
    for (const s of tries) { try { return JSON.parse(s); } catch (e) {} }
    return null;
  }

  /** 页面侧二道校验（与代理同规则，双保险） */
  function validateLLMJson(obj) {
    const F = ['title', 'desc', 'optionA', 'optionB', 'optionD', 'optionE', 'optionF'];
    if (!obj || F.some(k => typeof obj[k] !== 'string')) return 'field_missing';
    const caps = { title: 12, desc: 80, optionA: 16, optionB: 16, optionD: 16, optionE: 16, optionF: 16 };
    for (const k of F) {
      const s = obj[k].trim();
      if (!s) return 'empty';
      if ([...s].length > caps[k]) return 'too_long';
      if (/[\d%]|×\s*\d|倍/.test(s)) return 'contains_numbers';
    }
    if (new Set(F.slice(2).map(k => obj[k].trim())).size !== 5) return 'same_options';
    return null;
  }

  async function requestEvent(payload) {
    // dev mock：下一次 LLM 响应被替换为 raw 字符串（测校验降级）
    if (mockRaw !== null) {
      const raw = mockRaw;
      mockRaw = null;
      const parsed = extractLocal(raw);
      const bad = validateLLMJson(parsed);
      if (bad) { setStatus('degraded'); throw new Error('mock invalid: ' + bad); }
      return parsed;
    }
    if (typeof fetch === 'undefined') throw new Error('no fetch');
    const r = await fetchTimeout(PROXY + '/api/event', 21000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (!j.ok) {
      if (j.code === 'QUOTA') {
        disabledByQuota = true;
        setStatus('off');
        if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('免费额度可能已用完，已切换本地奇遇池；确认额度后可在设置里点「重试 LLM」。');
      } else if (j.code === 'NO_CONFIG' || j.code === 'LOCAL_MODE') {
        setStatus('off');
      } else {
        setStatus('degraded');
      }
      throw new Error(j.code || 'LLM_FAIL');
    }
    const bad = validateLLMJson(j);
    if (bad) { setStatus('degraded'); throw new Error('validate: ' + bad); }
    setStatus('ok');
    return { title: j.title, desc: j.desc, optionA: j.optionA, optionB: j.optionB, optionD: j.optionD, optionE: j.optionE, optionF: j.optionF };
  }

  function mergeLLMEvent(obj, slots, rarity) {
    return {
      id: g.LS.util.uid(),
      source: 'llm',
      rarity: rarity || '凡',
      title: obj.title,
      desc: obj.desc,
      options: [
        { text: obj.optionA, fits: [slots[0].type], daoxin: 0 },
        { text: obj.optionB, fits: [slots[1].type], daoxin: 0 },
        { text: obj.optionD, fits: [slots[2].type], daoxin: 0 },
        { text: obj.optionE, fits: [slots[3].type], daoxin: 0 },
        { text: obj.optionF, fits: [slots[4].type], daoxin: 0 }
      ]
    };
  }

  function _setMock(raw) { mockRaw = raw; }

  g.LS.llm = {
    PROXY, isHealthy, getStatus, retryLLM, checkHealth,
    buildHistoryPayload, stripFences, validateLLMJson, requestEvent, mergeLLMEvent,
    _setMock
  };
})(typeof window !== 'undefined' ? window : globalThis);
