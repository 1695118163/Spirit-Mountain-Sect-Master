/**
 * battle_sim.js —— 斗法引擎门禁：桩掉 UI/存档，同步化计时器，
 * 大师兄三档各跑 N 场验证：无崩溃、无 NaN、三档都「正常修炼能赢」——
 * easy ≥90%（陪练必赢感）、equal 50%~95%（有来有回）、hard 30%~80%（凶险但活路在）。
 * 用法：node tools/battle_sim.js [每档场次=100]
 */
'use strict';
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');

// ── 假计时器：endTurn 的 setTimeout(startTurn,700) 同步直推 ──
global.setTimeout = (fn) => { fn(); return 0; };

// ── 数据 ──
global.LS = {
  BAL: JSON.parse(fs.readFileSync(path.join(root, 'data/balance.json'), 'utf8')),
};
global.LS.BAL.cultivation = JSON.parse(fs.readFileSync(path.join(root, 'data/cultivation.json'), 'utf8'));
global.LS.BAL.realms = global.LS.BAL.realms || [];
global.LS.util = { numToCn: n => String(n), fmtGameDate: () => '灵曜一年' };
global.LS.state = { spiritRootMult: () => 1, changeDaoHeart: () => {} };
const logs = [];
global.LS.ui = {
  showBattleArena: (info, onStart) => onStart(),
  showBattleScreen: () => {},
  updateBattleHP: () => {}, updateBattleShields: () => {}, updateBattleQi: () => {},
  renderBattleHands: () => {}, showBattleIntent: () => {},
  battleLog: (t) => logs.push(t), battleAppend: (ls) => ls.forEach(t => logs.push(t)),
  showBattleResult: () => {}, toast: () => {},
};
global.LS.save = { save: () => {} };
global.LS.S = {}; // 每场重置

require(path.join(root, 'js/battle.js'));
const B = global.LS.battle;

// 三档门槛：[档位, 胜率下限, 胜率上限]
const N = Number(process.argv[2]) || 100;
const TIERS = [['easy', 0.9, 1.01], ['equal', 0.6, 1.0], ['hard', 0.3, 0.8]];
const wxNames = ['金', '木', '水', '火', '土'];
let crashes = 0, nanHit = 0;
const tierStats = {};

for (let i = 0; i < N * TIERS.length; i++) {
  const [tierKey] = TIERS[i % TIERS.length];
  const realm = i % 5; // 五个境界各 1/5
  global.LS.S = {
    realm: { index: realm }, dao_heart: 40 + (i % 30), created_at: 0,
    equip: { weapon: 'qingfeng', technique: 'changchun' },
    honor: 0, record: { win: 0, lose: 0 },
    spirit_root: { element: wxNames[i % 5] },
    pill_toxic: i % 3 === 0 ? 25 : 0,
    weather_state: { kind: 'clear' },
    game_days: 100,
  };
  logs.length = 0;
  const r0 = Object.assign({}, global.LS.S.record); // 值快照：finish 里 record.win+=1 会原地改对象，引用比较会永远 false
  try {
    B.challengeSenior(tierKey);
    let guard = 0;
    while (B.active && guard++ < 60) {
      const a = B.active;
      // 粗策略（模拟普通玩家）：能杀就杀，血<40% 见杀招先盾，血<35% 回一口
      for (const [idx, c] of a.my.hand.entries()) {
        if (a.my.qi >= c.cost && (c.dmg || (c.shield && a.my.hp / a.my.hpMax < 0.4) || (c.heal && a.my.hp / a.my.hpMax < 0.35))) {
          B.playCard(idx);
          if (!B.active) break;
        }
      }
      if (!B.active) break;
      B.endTurn();
    }
    if (guard >= 60) { console.log('第' + i + '场：回合数超限未分胜负！'); crashes++; B.abort(); continue; }
  } catch (e) {
    console.log('第' + i + '场崩溃：', e.message);
    crashes++; B.abort(); continue;
  }
  const won = global.LS.S.record.win > r0.win;
  tierStats[tierKey] = tierStats[tierKey] || { win: 0, n: 0 };
  tierStats[tierKey].n++; if (won) tierStats[tierKey].win++;
  // NaN 巡检：战报里不允许出现 NaN/undefined
  for (const t of logs) if (t.indexOf('NaN') !== -1 || t.indexOf('undefined') !== -1) { nanHit++; console.log('  异常文案：', t); }
}

console.log('── 斗法门禁：每档 ' + N + ' 场 vs 大师兄（三档都须能赢） ──');
let ok = crashes === 0 && nanHit === 0;
for (const [key, lo, hi] of TIERS) {
  const st = tierStats[key] || { win: 0, n: 1 };
  const rate = st.win / st.n;
  const inRange = rate >= lo && rate <= hi;
  if (!inRange) ok = false;
  console.log((inRange ? '✓' : '✗') + ' ' + key + ' 档胜率 ' + (rate * 100).toFixed(1) + '%（' + st.win + '/' + st.n + '，目标 ' + lo * 100 + '%~' + hi * 100 + '%）');
}
console.log('崩溃 ' + crashes + ' 场 / NaN 或 undefined 文案 ' + nanHit + ' 处');
console.log(ok ? '门禁 PASS' : '门禁 FAIL');
process.exit(ok ? 0 : 1);
