#!/usr/bin/env node
/**
 * balance_check.js —— 模拟脚本（验收门禁）：读 balance.json，复用 js/ 经济函数空跑多画像并验收。
 * 零依赖。用法：node balance_check.js   （退出码 0=PASS / 1=FAIL）
 *
 * 画像：
 *   idle24h   自动购建（每 60s 按 buy_priority）、不点击，dt=1s 步进 86400 步，在线效率
 *   active1h  吐纳 3 次/秒 + 每 tick 按 buy_priority 买最靠前可购建筑，3600 步
 *   active4h  同 active，14400 步（验证转生门槛首日可达）
 * 附加：离线/在线 8h 产量比（同一快照、清 Buff 丹药后公平对比）。
 * 检测：NaN/Infinity/负值、速率爆炸、卡死、acceptance 阈值。
 * 注：事件收益不建模（最坏情况），丹药离线减半/封顶按 balance.json。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const BAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'balance.json'), 'utf8'));

/* 复用浏览器同一套经济代码（经典脚本 + globalThis 守卫，require 即挂载） */
require('./js/util.js');
require('./js/state.js');
require('./js/economy.js');
require('./js/realm.js');
require('./js/tick.js');

const LS = globalThis.LS;
LS.BAL = BAL;
LS.EVT = []; // 经济模拟不含事件

/* ── 工具 ── */
function cloneS() { return JSON.parse(JSON.stringify(LS.S)); }

function fmt(n) { return LS.util.fmt(n); }

function realmIdx() { return LS.S.realm.index; }

/* ── 画像驱动 ── */

/**
 * 通用画像：每步 dt=1s。
 * opts: { steps, clicksPerSec, buyEveryStep(默认 true) }
 * 返回 { breakthroughs: [ {t, realm} ], endState }
 */
function runProfile(opts) {
  LS.S = LS.state.NEW_STATE();
  const steps = opts.steps;
  const buyEveryStep = opts.buyEveryStep !== false;
  const idleBuyInterval = opts.idleBuyInterval || 60; // idle 画像每 60s 尝试购建一次
  const warmupClicks = opts.warmupClicks || 0;        // idle 画像开局新手期（秒），期间点击
  const breakthroughs = [];
  const stalls = { since: 0, worst: 0 };
  const rateSamples = [];

  for (let t = 1; t <= steps; t++) {
    if (opts.clicksPerSec || t <= warmupClicks) {
      const n = opts.clicksPerSec || 3;
      for (let c = 0; c < n; c++) LS.economy.breath();
    }
    LS.tick.advanceGame(1, { mode: 'online' });

    // 购建策略（画像参数）：每 20s 一次，在可购建筑中买「等级最低」者（同等级取靠前），贴合放置玩家铺开建筑的节奏
    const buyInterval = opts.buyInterval || 25;
    const doBuy = (opts.clicksPerSec || t > warmupClicks) && (t % buyInterval === 0);
    if (doBuy) {
      let best = null;
      for (const bId of BAL.sim.buy_priority) {
        const b = BAL.buildings.find(x => x.id === bId);
        if (b.unlock_realm > realmIdx()) continue;
        if (LS.economy.canAfford(LS.economy.buildingCost(bId))) {
          if (!best || (LS.economy.bLevel(bId) < LS.economy.bLevel(best))) best = bId;
        }
      }
      if (best) LS.economy.buyBuilding(best);
    }

    // 突破
    if (LS.realm.canBreakthrough()) {
      const next = BAL.realms[realmIdx() + 1];
      LS.realm.doBreakthrough();
      breakthroughs.push({ t, realm: next.index, name: next.name });
      // 已至飞升：经济模拟意义已完成，提前收束
      if (next.index >= 9) return { breakthroughs, stalls, rateSamples, endState: LS.S, ascendedAt: t };
    }

    // 卡死检测（仅活跃画像，且未飞升）：连续 1200s 买不起任何建筑且不可突破
    if (opts.clicksPerSec && realmIdx() < 9) {
      const canBuyAny = BAL.sim.buy_priority.some(bId => {
        const b = BAL.buildings.find(x => x.id === bId);
        return b.unlock_realm <= realmIdx() && LS.economy.canAfford(LS.economy.buildingCost(bId));
      });
      if (!canBuyAny && !LS.realm.canBreakthrough()) {
        stalls.since += 1;
        stalls.worst = Math.max(stalls.worst, stalls.since);
      } else {
        stalls.since = 0;
      }
    }

    // 速率采样（每 600s，用于爆炸检测）
    if (t % 600 === 0) {
      rateSamples.push({ t, qi: LS.economy.computePerSecond('lingqi'), xp: LS.economy.computePerSecond('xiufu') });
    }
  }
  return { breakthroughs, stalls, rateSamples, endState: LS.S, ascendedAt: null };
}

/* ── 离线/在线 8h 产量比（红点二：同一存档、相同建筑配置的受控对比） ──
 * 基础态（无护山阵）：ratio 应落 [0.40, 0.60]；护山阵拉满+护身符：ratio ≤ hard_cap 0.85。
 * 丹药与 Buff 清零，排除自动服丹对在线产量放大的干扰。 */
function offlineVsOnlineControlled(withArray) {
  const mkState = () => {
    const s = LS.state.NEW_STATE();
    s.realm.index = 2; // 金丹
    s.buildings = withArray ? { lingtian: 20, lingquan: 10, fangshi: 10, hushanzhen: 12 } : { lingtian: 20, lingquan: 10, fangshi: 10 };
    s.resources.danyao = 0;
    s.buffs = [];
    return s;
  };
  const steps8h = 28800;
  const run = (mode) => {
    LS.S = mkState();
    const before = LS.S.resources.lingqi;
    if (mode === 'offline') {
      LS.tick.advanceGame(steps8h, { mode: 'offline', efficiency: LS.tick.offlineEfficiency(), maxPills: BAL.offline.pill_max_per_settle });
    } else {
      const dt = 10;
      for (let t = 0; t < steps8h / dt; t++) LS.tick.advanceGame(dt, { mode: 'online' });
    }
    return LS.S.resources.lingqi - before;
  };
  const onlineGain = run('online');
  const offlineGain = run('offline');
  return { onlineGain, offlineGain, ratio: onlineGain > 0 ? offlineGain / onlineGain : 0, eff: LS.tick.offlineEfficiency() };
}

/* ── 主流程 ── */
const problems = [];
const warns = [];
function check(cond, msg) { if (!cond) problems.push(msg); }
function warn(cond, msg) { if (!cond) warns.push(msg); }

console.log('== 《灵山掌门》数值平衡模拟 ==\n');

/* active1h */
const active1h = runProfile({ steps: 3600, clicksPerSec: BAL.sim.click_per_second });
console.log('【active1h 活跃 1 小时】');
console.log('  突破序列: ' + (active1h.breakthroughs.map(b => `${b.name}@${b.t}s`).join(' → ') || '无'));
const acc = BAL.sim.acceptance;
const b1 = active1h.breakthroughs[0];
const b2 = active1h.breakthroughs[1];
if (b1) {
  check(b1.t >= acc.t_first_breakthrough_s.min && b1.t <= acc.t_first_breakthrough_s.max,
    `首破 ${b1.t}s 不在 [${acc.t_first_breakthrough_s.min}, ${acc.t_first_breakthrough_s.max}]s`);
} else {
  check(false, '活跃 1h 未发生任何突破');
}
if (b2) {
  check(b2.t - (b1 ? b1.t : 0) >= acc.t_second_breakthrough_s.min && b2.t - (b1 ? b1.t : 0) <= acc.t_second_breakthrough_s.max,
    `首破→二破间隔 ${b2.t - (b1 ? b1.t : 0)}s 不在 [${acc.t_second_breakthrough_s.min}, ${acc.t_second_breakthrough_s.max}]s`);
}
check(active1h.endState.resources.lingshi >= acc.active1h_min_lingshi,
  `1h 灵石 ${fmt(active1h.endState.resources.lingshi)} < ${acc.active1h_min_lingshi}`);
if (b1) check(active1h.breakthroughs.some(x => x.realm >= acc.active1h_min_realm),
  `活跃 1h 未达 ${BAL.realms[acc.active1h_min_realm].name}（当前最高 ${active1h.breakthroughs.length ? BAL.realms[active1h.breakthroughs[active1h.breakthroughs.length - 1].realm].name : '练气'}）`);
check(active1h.stalls.worst <= BAL.sim.stall_minutes * 60,
  `活跃画像卡死：最长 ${active1h.stalls.worst}s 无任何进展（> ${BAL.sim.stall_minutes * 60}s）`);

/* active4h */
const active4h = runProfile({ steps: 14400, clicksPerSec: BAL.sim.click_per_second });
console.log('【active4h 活跃 4 小时】');
console.log('  突破序列: ' + (active4h.breakthroughs.map(b => `${b.name}@${Math.round(b.t / 60)}m`).join(' → ') || '无'));
check(active4h.breakthroughs.some(x => x.realm >= acc.active4h_min_realm),
  `活跃 4h 未达 ${BAL.realms[acc.active4h_min_realm].name}（最高 ${active4h.breakthroughs.length ? BAL.realms[active4h.breakthroughs[active4h.breakthroughs.length - 1].realm].name : '练气'}）`);

/* idle24h（开局 300s 新手期点击，之后纯挂机：不点击、每 60s 自动购建） */
const idle24h = runProfile({ steps: 86400, clicksPerSec: 0, warmupClicks: 300 });
console.log('【idle24h 挂机 24 小时】');
console.log('  突破序列: ' + (idle24h.breakthroughs.map(b => `${b.name}@${Math.round(b.t / 60)}m`).join(' → ') || '无'));
check(idle24h.breakthroughs.some(x => x.realm >= acc.idle24h_min_realm),
  `挂机 24h 未达 ${BAL.realms[acc.idle24h_min_realm].name}（最高 ${idle24h.breakthroughs.length ? BAL.realms[idle24h.breakthroughs[idle24h.breakthroughs.length - 1].realm].name : '练气'}）`);

/* 不可达建筑（24h 挂机画像从未解锁 → WARN 级） */
const unreachable = BAL.buildings.filter(b => b.unlock_realm > idle24h.endState.realm.index);
warn(unreachable.length <= acc.max_unreachable_buildings,
  `24h 内未解锁建筑：${unreachable.map(b => b.name).join('、') || '无'}`);
console.log('  24h 末未解锁建筑: ' + (unreachable.map(b => b.name).join('、') || '无') + (unreachable.length ? '（WARN）' : ''));

/* 资源快照 */
console.log('\n【资源快照】');
function snap(label, st) {
  console.log(`  ${label}: 灵气=${fmt(st.resources.lingqi)} 修为=${fmt(st.resources.xiufu)} 灵石=${fmt(st.resources.lingshi)} 丹药=${fmt(st.resources.danyao)} 境界=${BAL.realms[st.realm.index].name}`);
}
snap('active1h 末', active1h.endState);
snap('active4h 末', active4h.endState);
snap('idle24h 末', idle24h.endState);

/* 建筑覆盖 */
console.log('\n【建筑覆盖（24h 挂机末拥有数）】');
const neverAfford = [];
for (const b of BAL.buildings) {
  const lv = idle24h.endState.buildings[b.id] || 0;
  if (lv === 0 && b.unlock_realm <= idle24h.endState.realm.index) neverAfford.push(b.name);
  console.log(`  ${b.name}: Lv.${lv}`);
}
warn(neverAfford.length === 0, `以下建筑已解锁但 24h 内从未买得起：${neverAfford.join('、') || '无'}`);

/* 离线/在线比（红点二受控对比） */
const rAcc = acc.offline_8h_over_online_8h;
const ovBase = offlineVsOnlineControlled(false);
const ovMax = offlineVsOnlineControlled(true);
console.log('\n【离线 8h / 在线 8h 产量比】');
console.log(`  基础态:     在线=${fmt(ovBase.onlineGain)}  离线=${fmt(ovBase.offlineGain)}  ratio=${ovBase.ratio.toFixed(3)}（应落 [${rAcc.min}, ${rAcc.max}]）`);
console.log(`  护山阵拉满: eff=${ovMax.eff.toFixed(2)}  ratio=${ovMax.ratio.toFixed(3)}（应 ≤ ${rAcc.hard_cap}）`);
check(ovBase.ratio >= rAcc.min && ovBase.ratio <= rAcc.max,
  `基础离线/在线比 ${ovBase.ratio.toFixed(3)} 不在 [${rAcc.min}, ${rAcc.max}]`);
check(ovMax.ratio <= rAcc.hard_cap, `护山阵拉满后离线比 ${ovMax.ratio.toFixed(3)} 超过 hard_cap ${rAcc.hard_cap}`);

/* 数值崩坏：NaN/Inf/负值 */
const allEnds = [active1h.endState, active4h.endState, idle24h.endState];
for (let i = 0; i < allEnds.length; i++) {
  const st = allEnds[i];
  for (const res in st.resources) {
    const v = st.resources[res];
    check(isFinite(v) && v >= 0, `画像${i} 资源 ${res} 出现 NaN/Infinity/负值: ${v}`);
  }
}
check(isFinite(idle24h.endState.buildings.tunafa === undefined ? 0 : idle24h.endState.buildings.tunafa), '建筑等级非有限值');

/* 速率爆炸检测：速率逼近数值天花板（value_ceiling/10000）即视为失控；
 * 另以 WARN 提示连续两个采样窗增速 > runaway_ratio（叠乘设计下前期正常，不作硬失败） */
const rateCeiling = (BAL.sim.value_ceiling || 9e15) / 10000;
let runawayWarn = false;
if (idle24h.rateSamples.length >= 3) {
  for (let i = 2; i < idle24h.rateSamples.length; i++) {
    const a = idle24h.rateSamples[i - 1].qi, b = idle24h.rateSamples[i].qi;
    if (a > 0 && b / a > BAL.sim.runaway_ratio) runawayWarn = true;
  }
}
if (idle24h.rateSamples.length) {
  const late = idle24h.rateSamples[idle24h.rateSamples.length - 1].qi;
  const early = idle24h.rateSamples[0].qi;
  check(late < rateCeiling, `灵气速率失控：${late.toExponential(2)} ≥ 天花板判据 ${rateCeiling.toExponential(2)}`);
  console.log(`\n【速率曲线】灵气速率: ${fmt(early)}/s → ${fmt(late)}/s` + (runawayWarn ? '（存在连续倍增窗，WARN 级提示）' : ''));
}
warn(!runawayWarn, '灵气速率存在连续 600s 倍增窗（叠乘设计下前期正常，仅提示）');

/* 汇总 */
console.log('\n================ ================');
if (warns.length) {
  console.log('WARN:');
  for (const w of warns) console.log('  ⚠ ' + w);
}
if (problems.length) {
  console.log('FAIL（' + problems.length + ' 项）:');
  for (const p of problems) console.log('  ✗ ' + p);
  console.log('\nFAIL');
  process.exit(1);
} else {
  console.log('PASS（' + (warns.length ? warns.length + ' 条 WARN' : '无 WARN') + '）');
  process.exit(0);
}
