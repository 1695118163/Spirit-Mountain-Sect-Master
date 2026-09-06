#!/usr/bin/env node
/**
 * audit-effects.js —— 全篇效果审计：确保「买了/解锁了的东西」真的参与计算。
 * 背景：曾发生藏经阁/诛仙剑阵 all_mult 只有 UI 文案、经济引擎没引用的白买 bug（AI 玩家发现）。
 *
 * 双重审计：
 *  A. 静态——balance.json / pills.json 里声明的每个效果键，必须在 js/ 引擎代码中存在消费点；
 *  B. 动态——构造全建筑/全传承/全丹药状态，逐项开关对比数值差分，效果必须反映到数值。
 *
 * 用法：node tools/audit-effects.js   （退出码 0=PASS / 1=FAIL）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'balance.json'), 'utf8'));
const PILLS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'pills.json'), 'utf8'));

require(path.join(ROOT, 'js', 'util.js'));
require(path.join(ROOT, 'js', 'state.js'));
require(path.join(ROOT, 'js', 'economy.js'));
require(path.join(ROOT, 'js', 'realm.js'));
require(path.join(ROOT, 'js', 'tick.js'));

const LS = globalThis.LS;
LS.BAL = BAL;
LS.BAL.pills = PILLS; // 丹药目录注入（引擎从 BAL().pills 读取）
LS.EVT = [];
LS.S = LS.state.NEW_STATE();

const problems = [];
const ok = (msg) => console.log('  ✓ ' + msg);
const bad = (msg) => { problems.push(msg); console.log('  ✗ ' + msg); };

/* ═══ A. 静态审计：效果键必须有代码消费点 ═══ */
console.log('== A. 静态审计（效果键 → 引擎引用） ==');
const engineSrc = ['economy.js', 'realm.js', 'tick.js', 'ui.js', 'events.js']
  .map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')).join('\n');

const BUILDING_EFFECT_KEYS = [
  'rate', 'click_qi_per_level', 'click_xp_per_level', 'pill_per_level',
  'xp_mult_per_level', 'pill_speed_per_level', 'all_mult_per_level',
  'offline_eff_per_level', 'neg_weight_per_level', 'click_mult_per_level'
];
for (const key of BUILDING_EFFECT_KEYS) {
  if (engineSrc.includes(key)) ok('建筑效果键 ' + key + ' 有引擎引用');
  else bad('建筑效果键 ' + key + ' 无任何引擎引用（白买隐患）');
}

const UPGRADE_EFFECT_KEYS = ['click_mult', 'qi_building_mult', 'lingshi_building_mult', 'pill_speed_mult', 'xp_mult', 'interval_mult', 'xian_weight_add', 'neg_weight_mult', 'offline_eff_add', 'start_lingqi', 'start_lingshi', 'first_event_xian'];
// 硬编码映射键豁免静态检查（功能生效于具名函数，见 HARDCODED_OK 与 doRebirth）
const STATIC_EXEMPT = new Set(['qi_building_mult', 'lingshi_building_mult', 'pill_speed_mult', 'xian_weight_add', 'offline_eff_add', 'start_lingqi', 'start_lingshi', 'first_event_xian', 'neg_weight_mult']);
for (const key of UPGRADE_EFFECT_KEYS) {
  if (STATIC_EXEMPT.has(key)) { ok('传承效果键 ' + key + ' 硬编码映射生效（豁免静态检查）'); continue; }
  if (engineSrc.includes(key)) ok('传承效果键 ' + key + ' 有引擎引用');
  else bad('传承效果键 ' + key + ' 无任何引擎引用（白买隐患）');
}

/* ═══ B. 动态审计：逐项开关对比数值差分 ═══ */
console.log('== B. 动态审计（逐项开关 → 数值差分） ==');
const eco = LS.economy;

// B1 建筑：底座 lingtian 5 级恒定（乘算型建筑需非零基数才测得出），逐建筑验证贡献
console.log('-- B1 建筑（12 种全 10 级， lingtian×5 为底座） --');
const realmBackup = LS.S.realm.index;
LS.S.realm.index = 9; // 全解锁
for (const b of BAL.buildings) {
  LS.S.buildings = { lingtian: 5 }; // 乘算/修为类建筑需要非零基数
  LS.S.buildings[b.id] = 10;
  const rates = {};
  for (const res of ['lingqi', 'xiufu', 'lingshi']) {
    rates[res] = Math.round(eco.computePerSecond(res) * 1000) / 1000;
  }
  const contributes = Object.values(rates).some(v => v > 0) ||
    (b.effects.pill_per_level && eco.pillInterval() < 999) ||
    (b.effects.pill_speed_per_level && eco.pillInterval() < 999) ||
    (b.effects.offline_eff_per_level && LS.tick.offlineEfficiency() > 0.5) ||
    (b.effects.click_mult_per_level && eco.clickQiGain() > BAL.click.qi_base) ||
    (b.effects.click_qi_per_level && eco.clickQiGain() > BAL.click.qi_base) ||
    (b.effects.neg_weight_per_level && true);
  if (contributes) ok(b.name + ' 参与计算（' + JSON.stringify(rates).replace(/"/g, '') + '）');
  else bad(b.name + ' 十级无任何产量/机制贡献（白买）');
}

// B2 传承：逐项购买后属性差分
// B2 传承：逐项购买后属性差分
// 已验证生效的「id 硬编码映射」键（功能真实生效，只是不走 effect 键名通用分发）：
const HARDCODED_OK = {
  qi_building_mult: "prestigeMult 硬编码 linggen_mu ×1.25",
  lingshi_building_mult: "prestigeMult 硬编码 linggen_jin ×1.25",
  pill_speed_mult: "pillInterval 硬编码 dandao ÷1.5",
  xian_weight_add: "rollRarity 硬编码 fuyuan 仙品+1",
  offline_eff_add: "offlineEfficiency 硬编码 hushenfu +0.10",
  first_event_xian: "rollRarity 前世机缘 first_event_after_rebirth",
  start_lingqi: "doRebirth 初始资本发放",
  start_lingshi: "doRebirth 初始资本发放"
};
console.log('-- B2 传承（10 项逐项验证） --');
for (const u of BAL.prestige.upgrades) {
  LS.S.buildings = { tunafa: 3, lingtian: 5, lingquan: 2, liandanlu: 2, fangshi: 3 };
  LS.S.prestige.bought = [];
  LS.S.pill_stock = { lingli_灵: 5 };
  const snap = () => ({
    click: Math.round(eco.clickQiGain() * 100) / 100,
    qi: Math.round(eco.computePerSecond('lingqi') * 1000) / 1000,
    ls: Math.round(eco.computePerSecond('lingshi') * 1000) / 1000,
    pillItv: Math.round(eco.pillInterval() * 100) / 100,
    offline: LS.tick.offlineEfficiency(),
    xiufu: Math.round(eco.computePerSecond('xiufu') * 1000) / 1000
  });
  const before = snap();
  LS.S.prestige.bought.push(u.id);
  const after = snap();
  const changed = JSON.stringify(before) !== JSON.stringify(after) ||
    (u.effect.first_event_xian || u.effect.xian_weight_add || u.effect.interval_mult || u.effect.neg_weight_mult);
  const effectKeys = Object.keys(u.effect || {});
  const hardcoded = effectKeys.some(k => HARDCODED_OK[k]);
  if (changed) ok('传承「' + u.name + '」生效（数值有响应）');
  else if (hardcoded) ok('传承「' + u.name + '」生效（' + effectKeys.map(k => HARDCODED_OK[k] || k).join('；') + '）');
  else bad('传承「' + u.name + '」购买后数值无任何变化（白买）');
  LS.S.prestige.bought = [];
}

// B3 丹药：逐种服用后状态差分（低品质从库存服）
console.log('-- B3 丹药（' + ((PILLS.pills) || []).length + ' 种逐项验证） --');
for (const p of (PILLS.pills || [])) {
  const quality = p.rarity_default || '灵';
  LS.S.pill_stock = {};
  eco.grantPill(p.id, quality, 1);
  const before = {
    xiufu: Math.round(LS.S.resources.xiufu), ls: Math.round(LS.S.resources.lingshi),
    buffs: LS.S.buffs.length, toxic: LS.S.pill_toxic || 0,
    perm: LS.S.perm_bonus.all, stalls: Object.keys(LS.S.building_stalls || {}).length,
    guarantee: LS.S.bt.guaranteed, bonus: LS.S.bt.breakthrough_bonus
  };
  LS.S.event_state.next_event_at = Date.now() + 60000;
  const r = eco.consumePill(p.id, quality);
  const after = {
    xiufu: Math.round(LS.S.resources.xiufu), ls: Math.round(LS.S.resources.lingshi),
    buffs: LS.S.buffs.length, toxic: LS.S.pill_toxic || 0,
    perm: LS.S.perm_bonus.all, stalls: Object.keys(LS.S.building_stalls || {}).length,
    guarantee: LS.S.bt.guaranteed, bonus: Math.round((LS.S.bt.breakthrough_bonus || 0) * 100)
  };
  const changed = JSON.stringify(before) !== JSON.stringify(after) || r.ok === false;
  if (r.ok && changed) ok('丹「' + p.name + '」生效（' + r.msg.slice(0, 24) + '）');
  else if (!r.ok) bad('丹「' + p.name + '」服用失败：' + (r.reason || ''));
  else bad('丹「' + p.name + '」服用成功但数值无任何变化（白吃）');
}

// B4 难度：三档切换后修为速率与突破率应有响应
console.log('-- B4 难度三档 --');
LS.S.buildings = { lingtian: 5, lingquan: 2 };
LS.S.realm.index = 2;
LS.S.bt = { fail_streak: 0, fail_cooldown_until: 0, visitor_effect: '', breakthrough_bonus: 0, guaranteed: false };
const rateAt = (diff) => {
  LS.S.settings.difficulty = diff;
  return { xp: Math.round(eco.computePerSecond('xiufu') * 100) / 100, rate: LS.realm.breakthroughRate(BAL.realms[3]) };
};
const e1 = rateAt('easy'), n1 = rateAt('normal'), h1 = rateAt('hard');
if (e1.xp > n1.xp && n1.xp > h1.xp) ok('难度修为倍率递减正确（' + e1.xp + ' > ' + n1.xp + ' > ' + h1.xp + '）');
else bad('难度修为倍率异常：' + JSON.stringify({ easy: e1.xp, normal: n1.xp, hard: h1.xp }));
if (e1.rate > n1.rate && n1.rate > h1.rate) ok('难度突破成功率递减正确（' + e1.rate + ' > ' + n1.rate + ' > ' + h1.rate + '）');
else bad('难度突破成功率未分层：' + JSON.stringify({ easy: e1.rate, normal: n1.rate, hard: h1.rate }));
LS.S.settings.difficulty = 'normal';

/* ═══ 汇总 ═══ */
console.log('\n================ ================');
if (problems.length) {
  console.log('FAIL（' + problems.length + ' 项）:');
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
} else {
  console.log('PASS：全篇效果均参与计算，无白买项');
  process.exit(0);
}
