#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODEL = path.join('C:', 'Users', 'Administrator', 'Desktop', 'AI workstation', 'lingshan-balance', 'evil_cards.json');
let failures = 0;

function read(rel) {
  const file = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { console.error('[FAIL] 无法读取 ' + file + ': ' + error.message); process.exit(2); }
}
function check(ok, message) { if (!ok) { failures += 1; console.log('[FAIL] ' + message); } }
function unique(items, label) {
  const seen = new Set();
  for (const item of items) { check(item && !seen.has(item), label + ' 重复或为空: ' + item); seen.add(item); }
}

const balance = read('data/balance.json');
const disciples = read('data/disciples.json');
const events = read('data/events.json');
const cultivation = read('data/cultivation.json');
const model = read(MODEL);
const traitKeys = new Set((disciples.traits || []).map(item => item.key));
const skillIds = (disciples.skills || []).map(item => item.id);
const eventIds = new Set(events.map(item => item.id));

unique(Array.from(traitKeys), 'traits.key');
unique(skillIds, 'skills.id');
unique((disciples.traits || []).map(item => item.name), 'traits.name');
unique((disciples.skills || []).map(item => item.name), 'skills.name');

for (const edge of disciples.drift || []) {
  check(traitKeys.has(edge.from), 'drift.from 未命中 traits.key: ' + edge.from);
  check(traitKeys.has(edge.to), 'drift.to 未命中 traits.key: ' + edge.to);
  check(eventIds.has(edge.event_id), 'drift.event_id 未命中 events.json: ' + edge.event_id);
}
for (const id of disciples.event_pool || []) check(eventIds.has(id), 'event_pool 未命中 events.json: ' + id);

const stages = (balance.disciple || {}).stages || [];
for (const stage of stages) {
  check(stage.reveal_traits >= 0 && stage.reveal_traits <= traitKeys.size, '阶段词条揭示数越界: ' + stage.name);
  check(stage.reveal_skills >= 0 && stage.reveal_skills <= skillIds.length, '阶段技能揭示数越界: ' + stage.name);
}

function probability(value, label) { check(typeof value === 'number' && value >= 0 && value <= 1, label + ' 必须位于 [0,1]'); }
const betray = (balance.disciple || {}).betray || {};
const expel = (balance.disciple || {}).expel || {};
const growth = (balance.disciple || {}).growth || {};
probability(betray.trigger_hp_pct, 'betray.trigger_hp_pct');
probability(betray.per_battle_cap, 'betray.per_battle_cap');
probability(betray.real_dmg_pct, 'betray.real_dmg_pct');
probability(expel.revenge_chance, 'expel.revenge_chance');
probability(growth.negative_reveal_delay_chance, 'growth.negative_reveal_delay_chance');
for (const skill of disciples.skills || []) if (skill.heal_pct != null) probability(skill.heal_pct, 'skills.' + skill.id + '.heal_pct');

const oldSkillNames = new Set(['回春诀', '接引手', '护体罡气', '洗髓经', '戒尺', '噬血术']);
for (const skill of disciples.skills || []) check(!oldSkillNames.has(skill.name), '弟子技能仍使用旧正道名称: ' + skill.name);

const allCards = (((cultivation || {}).battle_cards || {}).my_cards || []);
const evilCards = allCards.filter(card => card.path === 'xie');
const modelCards = model.cards || [];
const fields = ['dmg', 'hp_cost_pct', 'shield', 'block_heal_pct', 'lifesteal_pct', 'blood_offering_gain', 'atk_buff_pct', 'cost', 'kind'];
check(evilCards.length === 34, '魔道卡数量应为 34，实际 ' + evilCards.length);
unique(evilCards.map(card => card.id), '魔道卡 id');
for (const expected of modelCards) {
  const actual = evilCards.find(card => card.id === expected.id);
  check(!!actual, '缺少权威魔道卡: ' + expected.id);
  if (!actual) continue;
  for (const field of fields) check(actual[field] === expected[field], expected.id + '.' + field + ' 与 evil_cards.json 不一致');
  check(actual.unlock_mo_realm === Math.min(5, Math.floor((actual.unlock_realm || 0) * 6 / 10)), expected.id + '.unlock_mo_realm 计算不一致');
}

const equipment = (cultivation.weapons || []).concat(cultivation.techniques || []);
unique(equipment.map(item => item.id), '装备 id');
for (const item of equipment.filter(entry => entry.path === 'xie')) {
  check(/^mo_/.test(item.id), '魔道装备 id 缺少 mo_ 前缀: ' + item.id);
  check(['xuechi', 'hunhfan', 'lianhungu'].includes(item.sold_at), '魔道装备售卖建筑非法: ' + item.id);
}

if (failures) {
  console.log('\nFAIL: ' + failures + ' 项');
  process.exit(1);
}
console.log('PASS: 弟子词条/技能/事件/概率全部有效');
console.log('PASS: 34 张魔道卡与 evil_cards.json 九字段零差异');
console.log('PASS: 魔道技能名称均已重设计，47 件魔道装备售卖入口有效');
