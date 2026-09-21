/**
 * path.js —— 正邪路线、血煞、魔道建筑与独立魔道境界。
 */
(function (g) { 'use strict';
  g.LS = g.LS || {};

  function BAL() { return g.LS.BAL; }
  function S() { return g.LS.S; }
  function cfg() { return BAL().path || {}; }
  function xieCfg() { return cfg().xie || {}; }
  function realms() { return BAL().mo_realms || []; }
  function isXie() { return S().path === 'xie'; }

  function addXuesha(amount) {
    const cap = (BAL().xuesha && BAL().xuesha.cap) || Number.MAX_SAFE_INTEGER;
    S().xuesha = g.LS.util.clamp((S().xuesha || 0) + amount, 0, cap);
    return S().xuesha;
  }

  function moRealm() {
    const index = Math.max(0, Math.min(realms().length - 1, Number((S().mo_realm || {}).index) || 0));
    return realms()[index] || null;
  }

  function xinmoSuppress() {
    if (!isXie()) return 0;
    const index = Math.max(0, Number((S().mo_realm || {}).index) || 0);
    let total = 0;
    for (let i = 0; i <= index && i < realms().length; i++) total += realms()[i].xinmo_suppress || 0;
    return Math.min(0.60, total);
  }

  function xinmoPenalty(xinmo) {
    const value = xinmo == null ? (S().xinmo || 0) : xinmo;
    const base = value >= 85 ? 0.20 : (value >= 60 ? 0.12 : (value >= 30 ? 0.05 : 0));
    return base * (1 - xinmoSuppress());
  }

  function enterXie(deep) {
    const s = S(), enter = cfg().enter || {}, xc = xieCfg();
    if (isXie()) return { ok: false, msg: '你已在魔道之中。' };
    if (s.flags && s.flags[enter.refuse_flag || 'refused_dark']) return { ok: false, msg: '此世已亲手关上这扇门。' };
    if ((s.xinmo || 0) < (enter.xinmo_min || 50)) return { ok: false, msg: '心魔不足，还差 ' + ((enter.xinmo_min || 50) - (s.xinmo || 0)) + ' 点。' };
    s.path = 'xie';
    s.mo_realm = { index: 0, progress: 0 };
    s.xie_chapter = Math.max(1, s.xie_chapter || 0);
    s.xie_idx = 0;
    s.xie_claimed = s.xie_claimed || {};
    s.xie_steles = (s.xie_steles || 0) + 1;
    if (deep && xc.deep_optional) {
      s.resources.xiufu = Math.max(0, (s.resources.xiufu || 0) * (1 - (xc.deep_daoxing_cost || 0)));
      s.xinmo = Math.max(s.xinmo || 0, xc.deep_xinmo || 85);
    }
    if (g.LS.events && g.LS.events.chronicle) g.LS.events.chronicle('xie_enter', { name: (realms()[0] || {}).name || '炼血' });
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return { ok: true, msg: deep ? '血门洞开，你舍去三成修为，直坠入魔之境。' : '旧路在身后合拢。魔道第一阶：炼血。' };
  }

  function refuseDark() {
    const s = S(), flag = ((cfg().enter || {}).refuse_flag || 'refused_dark');
    s.flags = s.flags || {};
    s.flags[flag] = 1;
    return { ok: true, msg: '你熄了灯。此世，那人不会再来。' };
  }

  function exitXie() {
    const s = S(), exit = xieCfg().exit || {};
    if (!isXie()) return { ok: false, msg: '你本在正道，无俗可还。' };
    if ((s.xinmo || 0) > (exit.xinmo_max == null ? 29 : exit.xinmo_max)) return { ok: false, msg: '心魔未净，须降至 ' + exit.xinmo_max + ' 以下。' };
    s.path = 'zheng';
    s.xuesha = 0;
    s.xinmo = 0;
    if (g.LS.state && g.LS.state.changeDaoHeart) g.LS.state.changeDaoHeart(-(exit.daoxin_penalty || 0));
    if (g.LS.events && g.LS.events.chronicle) g.LS.events.chronicle('xie_exit', {});
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return { ok: true, msg: '你封存魔道建筑，散尽血煞，重归正道。' };
  }

  function buildingDef(id) { return (BAL().mo_buildings || []).find(item => item.id === id) || null; }
  function buildingLevel(id) { return Number((S().mo_buildings_level || {})[id]) || 0; }
  function buildingUnlocked(def) {
    if (!def || !isXie()) return false;
    if (def.unlock_path && def.unlock_path !== S().path) return false;
    if (S().realm.index < (def.unlock_realm || 0)) return false;
    if (def.id === 'hunhfan' && (S().xie_chapter || 0) < 2) return false;
    if (def.id === 'lianhungu' && (S().xie_chapter || 0) < 3) return false;
    return true;
  }
  function buildingCost(id) {
    const def = buildingDef(id);
    if (!def) return null;
    const level = buildingLevel(id), out = {};
    for (const key in def.base_cost) out[key] = Math.floor(def.base_cost[key] * Math.pow(def.cost_growth, level));
    return out;
  }
  function canAfford(cost) {
    if (!cost) return false;
    for (const key in cost) {
      const value = key === 'xuesha' ? (S().xuesha || 0) : (S().resources[key] || 0);
      if (value < cost[key]) return false;
    }
    return true;
  }
  function buyBuilding(id) {
    const def = buildingDef(id), cost = buildingCost(id), s = S();
    if (!buildingUnlocked(def)) return { ok: false, msg: '尚未解锁这座魔道建筑。' };
    if (!canAfford(cost)) return { ok: false, msg: '灵石或血煞不足。' };
    for (const key in cost) {
      if (key === 'xuesha') s.xuesha -= cost[key];
      else s.resources[key] -= cost[key];
    }
    s.mo_buildings_level = s.mo_buildings_level || {};
    s.mo_buildings_level[id] = buildingLevel(id) + 1;
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return { ok: true, msg: def.name + '升至 ' + s.mo_buildings_level[id] + ' 级。' };
  }

  function buyMoCard(id) {
    const s = S(), cards = ((((BAL().cultivation || {}).battle_cards || {}).my_cards) || []);
    const card = cards.find(item => item.id === id && item.path === 'xie');
    if (!isXie() || !card) return { ok: false, msg: '魔功不应现于此世。' };
    if ((card.unlock_realm || 0) > s.realm.index || (card.unlock_mo_realm || 0) > ((s.mo_realm || {}).index || 0)) return { ok: false, msg: '境界尚不足以承受此术。' };
    if (card.default) return { ok: false, msg: '此术已烙入血脉。' };
    s.mo_cards_owned = s.mo_cards_owned || [];
    if (s.mo_cards_owned.indexOf(card.id) !== -1) return { ok: false, msg: '此术已经参悟。' };
    if ((s.resources.lingshi || 0) < (card.price || 0) || (s.xuesha || 0) < (card.xuesha_cost || 0)) return { ok: false, msg: '灵石或血煞不足。' };
    s.resources.lingshi -= card.price || 0;
    s.xuesha -= card.xuesha_cost || 0;
    s.mo_cards_owned.push(card.id);
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return { ok: true, msg: '已参悟「' + card.name + '」。' };
  }

  function buyMoEquipment(id, kind) {
    const s = S(), key = kind === 'technique' ? 'techniques' : 'weapons';
    const item = ((BAL().cultivation || {})[key] || []).find(entry => entry.id === id && entry.path === 'xie');
    if (!isXie() || !item) return { ok: false, msg: '魔物不应现于此世。' };
    if (!item.sold_at || buildingLevel(item.sold_at) <= 0) return { ok: false, msg: '对应魔道建筑尚未建成。' };
    const ownedKey = kind === 'technique' ? 'techniques_owned' : 'weapons_owned';
    s[ownedKey] = s[ownedKey] || [];
    if (s[ownedKey].indexOf(item.id) !== -1) { s.equip[kind] = item.id; return { ok: true, msg: '已装备「' + item.name + '」。' }; }
    if ((s.resources.lingshi || 0) < (item.price || 0) || (s.xuesha || 0) < (item.xuesha_cost || 0)) return { ok: false, msg: '灵石或血煞不足。' };
    s.resources.lingshi -= item.price || 0;
    s.xuesha -= item.xuesha_cost || 0;
    s[ownedKey].push(item.id);
    s.equip[kind] = item.id;
    if (g.LS.save && g.LS.save.save) g.LS.save.save();
    return { ok: true, msg: '已购得并装备「' + item.name + '」。' };
  }

  function xueshaRate() {
    if (!isXie()) return 0;
    const bloodPool = buildingDef('xuechi');
    const base = bloodPool && bloodPool.effects && bloodPool.effects.rate ? (bloodPool.effects.rate.xuesha || 0) : 0;
    const mult = (moRealm() && moRealm().xuesha_rate_mult) || 1;
    return base * buildingLevel('xuechi') * mult;
  }

  function tick(dt) {
    if (!(dt > 0) || !isXie()) return;
    const s = S();
    addXuesha(xueshaRate() * dt);
    const banner = buildingDef('hunhfan');
    const perMin = banner && banner.effects ? (banner.effects.xinmo_per_min || 0) : 0;
    if (perMin && buildingLevel('hunhfan')) s.xinmo = Math.min(100, (s.xinmo || 0) + perMin * buildingLevel('hunhfan') * dt / 60);
    const cul = BAL().cultivation || {};
    const tech = (cul.techniques || []).find(item => item.id === s.equip.technique);
    if (tech && tech.path === 'xie' && tech.mo_cost && tech.mo_cost.daoxin_per_game_year) {
      const gt = BAL().game_time || {};
      const yearDays = (gt.months_per_year || 12) * (gt.days_per_month || 30);
      s.mo_cost_days = (s.mo_cost_days || 0) + dt * (gt.day_per_second || 1);
      while (s.mo_cost_days >= yearDays) {
        s.mo_cost_days -= yearDays;
        g.LS.state.changeDaoHeart(tech.mo_cost.daoxin_per_game_year);
      }
    }
  }

  function moNeed(index) {
    const target = realms()[index];
    if (!target) return null;
    const next = BAL().realms[Math.min(BAL().realms.length - 1, S().realm.index + 1)] || BAL().realms[S().realm.index];
    return { xiufu: Math.floor((next.need_xp || 0) * target.need_xp_mult), xuesha: target.need_xuesha };
  }
  function moBreakthroughRate() {
    const bc = xieCfg().breakthrough || {};
    return Math.min(bc.cap || 0.90, (bc.base || 0.60) + (bc.xinmo_add || 0.05) * ((S().xinmo || 0) / (bc.xinmo_step || 20)));
  }
  function finishMoBreakthrough(targetIndex) {
    S().mo_realm.index = targetIndex;
    S().mo_realm.progress = 0;
    S().mo_pending_breakthrough = null;
    if (targetIndex === realms().length - 1 && g.LS.events && g.LS.events.chronicle) g.LS.events.chronicle('xie_tribulation', {});
    return { ok: true, success: true, msg: '血祭功成，魔道进境至「' + realms()[targetIndex].name + '」。' };
  }
  function moBreakthrough(forceSuccess) {
    const s = S();
    if (!isXie()) return { ok: false, msg: '正道之身不可行血祭突破。' };
    const current = Math.max(0, Number((s.mo_realm || {}).index) || 0), targetIndex = current + 1;
    const need = moNeed(targetIndex);
    if (!need) return { ok: false, msg: '已至魔君之巅。' };
    if ((s.resources.xiufu || 0) < need.xiufu || (s.xuesha || 0) < need.xuesha) return { ok: false, msg: '血祭所需修为或血煞不足。', need };
    s.resources.xiufu -= need.xiufu;
    const success = !!forceSuccess || Math.random() < moBreakthroughRate();
    if (success) {
      s.xuesha -= need.xuesha;
      return finishMoBreakthrough(targetIndex);
    }
    s.xuesha -= Math.ceil(need.xuesha / 2);
    s.xinmo = Math.min(100, (s.xinmo || 0) + (((xieCfg().breakthrough || {}).fail_xinmo) || 15));
    s.mo_pending_breakthrough = { targetIndex: targetIndex };
    return { ok: true, success: false, canSacrifice: (s.xinmo || 0) >= ((xieCfg().xinmo_as_currency || {}).per_breakthrough_cost || 40), msg: '血祭崩散，血煞折半，心魔反噬。' };
  }
  function sacrificeXinmo() {
    const s = S(), pending = s.mo_pending_breakthrough;
    const cost = (xieCfg().xinmo_as_currency || {}).per_breakthrough_cost || 40;
    if (!pending) return { ok: false, msg: '没有可挽回的血祭。' };
    if ((s.xinmo || 0) < cost) return { ok: false, msg: '心魔不足 ' + cost + '。' };
    s.xinmo -= cost;
    return finishMoBreakthrough(pending.targetIndex);
  }

  function applyEventSpecial(ev, opt) {
    const s = S(), special = ev && ev.special;
    if (special) {
      if (special.xinmo) s.xinmo = Math.min(100, (s.xinmo || 0) + special.xinmo);
      if (special.next_xp_pct) {
        const next = BAL().realms[s.realm.index + 1];
        if (next) s.resources.xiufu += next.need_xp * special.next_xp_pct;
      }
      if (special.lingshi_seconds) s.resources.lingshi += g.LS.economy.computePerSecond('lingshi') * special.lingshi_seconds;
      if (special.disciple_suspicion && g.LS.disciples) g.LS.disciples.addSuspicion(null, special.disciple_suspicion, ev.id);
    }
    const choice = opt && opt.special;
    if (choice && choice.free_pill && g.LS.economy.grantPill) g.LS.economy.grantPill('lingli', choice.free_pill, 1);
    if (choice && choice.toxic) s.pill_toxic = (s.pill_toxic || 0) + choice.toxic;
    if (ev && ev.disciple_effect && g.LS.disciples) g.LS.disciples.applyEvent(ev.id, ev.disciple_effect, opt && opt.key);
  }

  g.LS.path = {
    isXie, enterXie, refuseDark, exitXie, addXuesha, moRealm, xinmoSuppress, xinmoPenalty,
    buildingDef, buildingLevel, buildingUnlocked, buildingCost, buyBuilding, buyMoCard, buyMoEquipment, xueshaRate, tick,
    moNeed, moBreakthroughRate, moBreakthrough, sacrificeXinmo, applyEventSpecial
  };
})(typeof window !== 'undefined' ? window : globalThis);
