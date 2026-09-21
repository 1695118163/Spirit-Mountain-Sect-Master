/**
 * disciples.js —— 多弟子招募、成长揭示、词条漂移与处置。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  function BAL() { return g.LS.BAL; }
  function DATA() { return BAL().disciples || { names: [], traits: [], skills: [], drift: [] }; }
  function CFG() { return BAL().disciple || {}; }
  function S() { return g.LS.S; }
  function active() { return (S().disciples || []).filter(d => d.status === 'active'); }
  function byId(id) { return active().find(d => d.id === id) || null; }
  function traitDef(key) { return (DATA().traits || []).find(t => t.key === key) || null; }
  function skillDef(id) { return (DATA().skills || []).find(sk => sk.id === id) || null; }

  function weightedTrait(excluded) {
    const pool = (DATA().traits || []).filter(t => excluded.indexOf(t.key) === -1);
    return g.LS.util.weightedPick(pool, t => S().path === 'xie' && t.polarity < 0 ? (CFG().negative_weight_xie || 2) : 1);
  }

  function makeCandidate(profile) {
    profile = typeof profile === 'string' ? { source: profile } : (profile || {});
    const traits = [], count = g.LS.util.randInt(2, 4);
    while (traits.length < count) {
      const excluded = traits.map(t => t.key);
      const pool = (DATA().traits || []).filter(def => excluded.indexOf(def.key) === -1);
      const preferred = profile.traits || [];
      const def = g.LS.util.weightedPick(pool, item => {
        const base = preferred.indexOf(item.key) !== -1 ? 2.2 : 1;
        return S().path === 'xie' && item.polarity < 0 ? base * (CFG().negative_weight_xie || 2) : base;
      });
      if (!def) break;
      traits.push({ key: def.key, revealed: false });
    }
    const skillPool = (DATA().skills || []).filter(sk => S().path === 'xie' ? sk.path === 'xie' : !sk.path);
    const skills = [], skillMin = Math.max(1, profile.skill_min || 1);
    const skillCount = g.LS.util.randInt(skillMin, Math.min(3, skillPool.length));
    while (skills.length < skillCount) {
      const def = g.LS.util.weightedPick(skillPool.filter(item => !skills.some(skill => skill.id === item.id)), item => {
        const matched = (item.affinity || []).some(key => traits.some(trait => trait.key === key));
        const preferred = (profile.skills || []).indexOf(item.id) !== -1;
        return (matched ? 4 : 1) * (preferred ? 1.5 : 1);
      });
      if (def && !skills.some(sk => sk.id === def.id)) skills.push({ id: def.id, revealed: false, used_in_battle: false });
    }
    const rootRank = { '伪': 0, '真': 1, '异': 2, '天': 3 };
    let root = g.LS.state.rollSpiritRoot();
    for (let i = 1; i < (profile.root_rolls || 1); i++) {
      const rolled = g.LS.state.rollSpiritRoot();
      if ((rootRank[rolled.key] || 0) > (rootRank[root.key] || 0)) root = rolled;
    }
    if (profile.reveal_trait && traits[0]) traits[0].revealed = true;
    const revealSkills = Math.min(skills.length, profile.reveal_skills || 0);
    for (let i = 0; i < revealSkills; i++) skills[i].revealed = true;
    const hintTrait = traitDef(traits[0] && traits[0].key);
    const names = DATA().names || [];
    return {
      id: g.LS.util.uid(),
      name: names.length ? names[g.LS.util.randInt(0, names.length - 1)] : '无名弟子',
      root, stage: 0, progress: profile.progress || 0, traits, skills,
      suspicion: 0, mood: 'normal', events_log: [], betray_warned: false,
      status: 'active', fed: 0, agent: false, realm: 0,
      battle_selected: false, battle_skill_id: null, source: profile.source || '山门来投',
      hidden_hint: hintTrait ? hintTrait.hidden_hint : '沉默地候在山门外。'
    };
  }

  function recruit(candidates) {
    const s = S(), max = CFG().max_slots || 5;
    s.disciples = s.disciples || [];
    const room = Math.max(0, max - active().length);
    const picked = (candidates || []).slice(0, room);
    for (const candidate of picked) {
      delete candidate.hidden_hint;
      if (typeof candidate.battle_selected !== 'boolean') candidate.battle_selected = false;
      if (candidate.battle_skill_id === undefined) candidate.battle_skill_id = null;
      s.disciples.push(candidate);
      revealToStage(candidate, candidate.stage || 0);
    }
    syncLegacy();
    s.disciple_recruit_at = Date.now() + (((CFG().recruit || {}).interval_s || 900) * 1000);
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return picked.length;
  }

  function syncLegacy() {
    const first = active()[0];
    S().disciple = first ? {
      recruited: true, name: first.name, root: first.root,
      progress: first.progress || 0, realm: first.realm || 0,
      agent: !!first.agent, fed: first.fed || 0, id: first.id
    } : null;
  }

  function normalizeBattleParty() {
    const list = active();
    const max = ((CFG().battle_slots || {}).max || 3);
    if (list.length && !list.some(d => typeof d.battle_selected === 'boolean')) {
      list.forEach((d, index) => { d.battle_selected = index < max; });
    }
    let used = 0;
    for (const disciple of list) {
      if (disciple.battle_selected && used++ >= max) disciple.battle_selected = false;
      const revealed = (disciple.skills || []).filter(skill => skill.revealed);
      if (!revealed.some(skill => skill.id === disciple.battle_skill_id)) {
        disciple.battle_skill_id = revealed.length ? revealed[0].id : null;
      }
    }
    return list.filter(d => d.battle_selected).slice(0, max);
  }

  function battleParty() { return normalizeBattleParty(); }

  function configureBattle(id, selected, skillId) {
    const disciple = byId(id);
    if (!disciple) return { ok: false, msg: '弟子不在门中。' };
    if (skillId != null) {
      const skill = (disciple.skills || []).find(item => item.id === skillId && item.revealed);
      if (!skill) return { ok: false, msg: '这门术法尚未领悟。' };
      disciple.battle_skill_id = skillId;
    }
    if (selected != null) {
      const others = active().filter(d => d.id !== id && d.battle_selected).length;
      if (selected && others >= (((CFG().battle_slots || {}).max) || 3)) return { ok: false, msg: '出战弟子最多三人。' };
      disciple.battle_selected = !!selected;
    }
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return { ok: true, msg: disciple.battle_selected ? disciple.name + '已列入出战阵容。' : disciple.name + '已退出出战阵容。' };
  }

  function profileForSource(source, exams) {
    if (source === 'village') return { source: '村镇寻访', traits: ['zhonghou', 'shanliang', 'qinmian'], reveal_trait: true };
    if (source === 'market') return { source: '坊市访贤', traits: ['conghui', 'tanlan'], skill_min: 2, reveal_trait: true };
    if (source === 'secret') return { source: '秘境相逢', traits: ['yinren', 'aoman'], root_rolls: 3, skill_min: 2, reveal_skills: 1 };
    if (source === 'event_orphan') return { source: '奇遇收徒', traits: ['shanliang', 'zhonghou'], reveal_trait: true };
    if (source === 'event_rogue') return { source: '点化散修', traits: ['conghui', 'yinren'], root_rolls: 2, skill_min: 2, reveal_skills: 1 };
    if (source === 'event_dark') return { source: '收服邪修', traits: ['shisha', 'yinhen'], skill_min: 2, reveal_trait: true, reveal_skills: 1 };
    const picked = exams || [];
    const profile = { source: '宗门试炼', traits: [], reveal_trait: false, root_rolls: 1, skill_min: 1, progress: 0 };
    if (picked.indexOf('heart') !== -1) { profile.traits.push('zhonghou', 'shanliang'); profile.reveal_trait = true; }
    if (picked.indexOf('root') !== -1) profile.root_rolls = 4;
    if (picked.indexOf('battle') !== -1) { profile.skill_min = 3; profile.reveal_skills = 1; }
    if (picked.indexOf('endure') !== -1) { profile.traits.push('qinmian', 'yinren'); profile.progress = 12; }
    return profile;
  }

  function seekCandidates(location) {
    const s = S(), max = CFG().max_slots || 20;
    if (active().length >= max) return { ok: false, msg: '门下已满二十人。' };
    s.disciple_seek_ready_day = s.disciple_seek_ready_day || {};
    const ready = s.disciple_seek_ready_day[location] || 0;
    if ((s.game_days || 0) < ready) return { ok: false, msg: '此地人缘未复，还需 ' + Math.ceil(ready - (s.game_days || 0)) + ' 日。' };
    s.game_days = (s.game_days || 0) + 30;
    s.disciple_seek_ready_day[location] = s.game_days + 90;
    const candidates = [];
    for (let i = 0; i < 3; i++) candidates.push(makeCandidate(profileForSource(location)));
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return { ok: true, candidates, days: 30 };
  }

  function referralCandidate(id) {
    const disciple = byId(id), day = S().game_days || 0;
    if (!disciple || disciple.stage < 2) return { ok: false, msg: '亲传弟子方可举荐同道。' };
    if (day < (disciple.referral_ready_day || 0)) return { ok: false, msg: '还需 ' + Math.ceil(disciple.referral_ready_day - day) + ' 日才有新的举荐。' };
    disciple.referral_ready_day = day + 180;
    const traits = (disciple.traits || []).filter(t => t.revealed).map(t => t.key);
    const inheritedSkills = (disciple.skills || []).filter(skill => skill.revealed).map(skill => skill.id);
    const candidate = makeCandidate({ source: disciple.name + '举荐', traits, skills: inheritedSkills, skill_min: 2, reveal_trait: true });
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return { ok: true, candidates: [candidate], referrer: disciple.name };
  }

  function trialCandidates(exams) {
    const picked = Array.from(new Set(exams || []));
    if (picked.length !== 2) return { ok: false, msg: '须选定两项考核。' };
    if (active().length >= (CFG().max_slots || 20)) return { ok: false, msg: '门下已满二十人。' };
    const cost = 3000 + active().length * 250;
    if ((S().resources.lingshi || 0) < cost) return { ok: false, msg: '举办试炼需灵石 ' + cost + '。' };
    S().resources.lingshi -= cost;
    const profile = profileForSource('trial', picked), candidates = [];
    for (let i = 0; i < 5; i++) candidates.push(makeCandidate(profile));
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return { ok: true, candidates, cost };
  }

  function recruitFromEvent(source) {
    if (active().length >= (CFG().max_slots || 20)) return { ok: false, msg: '门下已满二十人。' };
    const candidate = makeCandidate(profileForSource(source));
    recruit([candidate]);
    return { ok: true, disciple: candidate, msg: candidate.name + '已拜入山门。' };
  }

  function scheduleRecruit(now) {
    const s = S(), rec = CFG().recruit || {};
    if (active().length >= (CFG().max_slots || 5)) return false;
    if (!s.disciple_recruit_at) {
      s.disciple_recruit_at = now + (rec.first_delay_s || 600) * 1000;
      return false;
    }
    if (now < s.disciple_recruit_at) return false;
    const candidates = [];
    for (let i = 0; i < (rec.candidates || 3); i++) candidates.push(makeCandidate());
    s.disciple_recruit_at = now + (rec.interval_s || 900) * 1000;
    if (g.LS.ui && g.LS.ui.showDiscipleRecruit) g.LS.ui.showDiscipleRecruit(candidates);
    return true;
  }

  function revealOneTrait(disciple, allowDelay) {
    const hidden = (disciple.traits || []).filter(t => !t.revealed && !(t.reveal_after_stage > disciple.stage));
    if (!hidden.length) return null;
    const positive = hidden.filter(t => (traitDef(t.key) || {}).polarity > 0);
    const pick = positive.length ? positive[g.LS.util.randInt(0, positive.length - 1)] : hidden[0];
    const def = traitDef(pick.key);
    if (allowDelay && def && def.polarity < 0 && disciple.stage < 3 && Math.random() < (((CFG().growth || {}).negative_reveal_delay_chance) || 0.30)) {
      pick.reveal_after_stage = disciple.stage + 1;
      return null;
    }
    pick.revealed = true;
    disciple.events_log.push({ time: Date.now(), text: '显露性情：' + (def ? def.name : pick.key) });
    if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('【' + disciple.name + '】性情显露：' + (def ? def.name : pick.key));
    return pick;
  }

  function revealOneSkill(disciple) {
    const skill = (disciple.skills || []).find(sk => !sk.revealed);
    if (!skill) return null;
    skill.revealed = true;
    const def = skillDef(skill.id);
    disciple.events_log.push({ time: Date.now(), text: '悟得术法：' + (def ? def.name : skill.id) });
    if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast('【' + disciple.name + '】悟得术法：' + (def ? def.name : skill.id));
    return skill;
  }

  function revealToStage(disciple, stage) {
    const stageCfg = (CFG().stages || [])[stage];
    if (!stageCfg) return;
    const beforeTraits = (disciple.traits || []).filter(t => t.revealed).length;
    const beforeSkills = (disciple.skills || []).filter(sk => sk.revealed).length;
    for (let i = beforeTraits; i < stageCfg.reveal_traits; i++) revealOneTrait(disciple, true);
    for (let i = beforeSkills; i < stageCfg.reveal_skills; i++) revealOneSkill(disciple);
  }

  function tick(dt) {
    const s = S(), growth = CFG().growth || {};
    for (const disciple of active()) {
      const rate = (growth.base_rate || 0.02) * (s.realm.index + 1) * (disciple.agent ? (growth.agent_mult || 2) : 1);
      disciple.progress = Math.min(100, (disciple.progress || 0) + rate * dt);
      disciple.realm = Math.min(s.realm.index, Math.floor(disciple.progress / 10));
      let target = Math.min(3, Math.floor(disciple.progress / 25));
      while (target > disciple.stage) {
        const next = disciple.stage + 1;
        const stageCfg = (CFG().stages || [])[next];
        if (stageCfg && s.realm.index < stageCfg.realm_min) break;
        disciple.stage = next;
        revealToStage(disciple, next);
      }
    }
    syncLegacy();
    scheduleRecruit(Date.now());
  }

  function askHeart(id) {
    const disciple = byId(id), cfg = CFG().ask_heart || {};
    if (!disciple) return { ok: false, msg: '弟子不在门中。' };
    if ((S().resources.lingshi || 0) < (cfg.lingshi_cost || 5000)) return { ok: false, msg: '灵石不足。' };
    if ((disciple.progress || 0) < (cfg.progress_cost || 10)) return { ok: false, msg: '弟子修行进度不足。' };
    const hidden = (disciple.traits || []).find(t => !t.revealed);
    if (!hidden) return { ok: false, msg: '其性情已尽数明了。' };
    S().resources.lingshi -= cfg.lingshi_cost || 5000;
    disciple.progress -= cfg.progress_cost || 10;
    hidden.revealed = true;
    const def = traitDef(hidden.key);
    disciple.events_log.push({ time: Date.now(), text: '问心照见：' + (def ? def.name : hidden.key) });
    return { ok: true, msg: '问心照见「' + (def ? def.name : hidden.key) + '」。' };
  }

  function revealAfterBattle(id) {
    const disciple = byId(id);
    if (!disciple) return null;
    const hidden = (disciple.traits || []).find(t => !t.revealed);
    if (!hidden) return null;
    hidden.revealed = true;
    return hidden;
  }

  function addSuspicion(id, amount, cause) {
    const disciple = id ? byId(id) : active()[0];
    if (!disciple) return 0;
    disciple.suspicion = g.LS.util.clamp((disciple.suspicion || 0) + amount, 0, ((CFG().betray || {}).suspicion_max || 100));
    if (disciple.suspicion >= 80) disciple.mood = 'resentful';
    else if (disciple.suspicion >= 40) disciple.mood = 'doubting';
    if (cause) disciple.events_log.push({ time: Date.now(), text: cause + '：怀疑 ' + (amount >= 0 ? '+' : '') + amount });
    return disciple.suspicion;
  }

  function driftTrait(disciple, fromKey, toKey, cause) {
    if (typeof disciple === 'string') disciple = byId(disciple);
    if (!disciple) return false;
    const trait = (disciple.traits || []).find(t => t.key === fromKey);
    if (!trait || (disciple.traits || []).some(t => t.key === toKey)) return false;
    trait.key = toKey;
    trait.revealed = true;
    disciple.events_log.push({ time: Date.now(), text: (cause || '因果漂移') + '：' + ((traitDef(fromKey) || {}).name || fromKey) + '→' + ((traitDef(toKey) || {}).name || toKey) });
    return true;
  }

  function applyEvent(eventId, effect, optionKey, requires) {
    if (!effect) return false;
    if (effect.recruit && (!effect.recruit_on || effect.recruit_on.indexOf(optionKey) !== -1)) {
      const joined = recruitFromEvent(effect.recruit);
      if (g.LS.ui && g.LS.ui.toast) g.LS.ui.toast(joined.msg);
      return joined.ok;
    }
    const candidates = active().filter(disciple => {
      if (requires && requires.trait && !(disciple.traits || []).some(t => t.key === requires.trait)) return false;
      if (requires && requires.suspicion_min != null && (disciple.suspicion || 0) < requires.suspicion_min) return false;
      if (requires && requires.suspicion_range && ((disciple.suspicion || 0) < requires.suspicion_range[0] || (disciple.suspicion || 0) > requires.suspicion_range[1])) return false;
      return true;
    });
    const disciple = candidates[0] || active()[0];
    if (!disciple) return false;
    if (effect.drift) driftTrait(disciple, effect.drift[0], effect.drift[1], eventId);
    if (effect.suspicion) addSuspicion(disciple.id, effect.suspicion, eventId);
    if (effect.reveal_trait) revealOneTrait(disciple, false);
    if (effect.lose_pills) {
      const keys = Object.keys(S().pill_stock || {});
      let left = effect.lose_pills;
      for (const key of keys) { const take = Math.min(left, S().pill_stock[key]); S().pill_stock[key] -= take; left -= take; if (S().pill_stock[key] <= 0) delete S().pill_stock[key]; if (!left) break; }
    }
    if (effect.leave) disciple.status = 'expelled';
    if (effect.calm_if_given && optionKey === 'A') addSuspicion(disciple.id, -Math.abs(effect.calm_if_given), eventId);
    syncLegacy();
    return true;
  }

  function expel(id) {
    const disciple = byId(id), cfg = CFG().expel || {};
    if (!disciple) return { ok: false, msg: '弟子不在门中。' };
    disciple.status = 'expelled';
    g.LS.state.changeDaoHeart(-(cfg.daoxin_cost || 5));
    S().disciple_revenge = S().disciple_revenge || [];
    S().disciple_revenge.push({ id: disciple.id, name: disciple.name, due_day: (S().game_days || 0) + (cfg.revenge_delay_days || 240), chance: cfg.revenge_chance || 0.5 });
    if (g.LS.events && g.LS.events.chronicle) g.LS.events.chronicle('disciple_expel', { name: disciple.name });
    syncLegacy();
    return { ok: true, msg: disciple.name + '已被逐出师门，道心 -' + (cfg.daoxin_cost || 5) + '。' };
  }

  function transmitMagic(id) {
    const disciple = byId(id);
    if (!disciple || S().path !== 'xie') return { ok: false, msg: '不可传魔。' };
    const hasNegative = (disciple.traits || []).some(t => (traitDef(t.key) || {}).polarity < 0);
    if (disciple.mood !== 'resentful' && !hasNegative) return { ok: false, msg: '此子心性未染，拒绝受魔功。' };
    if (!(disciple.skills || []).some(sk => sk.id === 'shi_xue')) disciple.skills.push({ id: 'shi_xue', revealed: true, used_in_battle: false });
    addSuspicion(disciple.id, 20, '传授魔功');
    if (g.LS.path) g.LS.path.addXuesha(((BAL().xuesha || {}).sources || {}).disciple_devour || 30);
    S().xie_stats = S().xie_stats || {};
    S().xie_stats.demonic_disciple = (S().xie_stats.demonic_disciple || 0) + 1;
    return { ok: true, msg: disciple.name + '受下饮血咒，血煞翻涌。' };
  }

  function feed(id, quality) {
    const disciple = byId(id), add = ((CFG().growth || {}).feed_progress || {})[quality] || 1;
    if (!disciple) return { ok: false, msg: '弟子不在门中。' };
    disciple.fed = (disciple.fed || 0) + 1;
    disciple.progress = Math.min(100, (disciple.progress || 0) + add);
    return { ok: true, msg: '修行进度 +' + add + '%' };
  }

  function betrayScore(disciple) {
    let score = disciple.suspicion || 0;
    for (const trait of disciple.traits || []) score += (traitDef(trait.key) || {}).betray_add || 0;
    return g.LS.util.clamp(score, 0, 100);
  }

  g.LS.disciples = {
    active, byId, traitDef, skillDef, makeCandidate, recruit, scheduleRecruit, tick, syncLegacy,
    revealOneTrait, revealOneSkill, revealAfterBattle, askHeart, addSuspicion, driftTrait, applyEvent,
    expel, transmitMagic, feed, betrayScore, battleParty, configureBattle, seekCandidates,
    referralCandidate, trialCandidates, recruitFromEvent
  };
})(typeof window !== 'undefined' ? window : globalThis);
