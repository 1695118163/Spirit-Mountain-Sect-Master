/**
 * battle_sim.js —— 斗法引擎门禁：桩掉 UI/存档，同步化计时器，
 * 跑 N 场「玩家 vs 大师兄」验证：无崩溃、无 NaN、回合数合理、胜负不至于一边倒。
 * 用法：node tools/battle_sim.js [场次=300]
 */
'use strict';
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');

// ── 假计时器：endTurn 的 setTimeout(startTurn,700) 同步直推 ──
const realTimeout = setTimeout;
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
let honorGain = 0;
let curWin = null;
global.LS.S = {}; // 每场重置

require(path.join(root, 'js/battle.js'));
const B = global.LS.battle;

// 结算钩子：从 finish 里抓胜负（active 置 null 前无外部信号，改用 S().record 差值）
const N = Number(process.argv[2]) || 300;
const wxNames = ['金', '木', '水', '火', '土'];
let win = 0, lose = 0, crashes = 0, nanHit = 0;
const roundsAll = [];
const realmsUsed = {};

for (let i = 0; i < N; i++) {
  const realm = i % 5; // 五个境界各 1/5
  realmsUsed[realm] = (realmsUsed[realm] || 0) + 1;
  global.LS.S = {
    realm: { index: realm }, dao_heart: 40 + (i % 30), created_at: 0,
    equip: { weapon: 'iron_sword', technique: 'xuangong' },
    honor: 0, record: { win: 0, lose: 0 },
    spirit_root: { element: wxNames[i % 5] },
    pill_toxic: i % 3 === 0 ? 25 : 0,
    weather_state: { kind: 'clear' },
    game_days: 100,
  };
  logs.length = 0;
  const r0 = Object.assign({}, global.LS.S.record); // 值快照：finish 里 record.win+=1 会原地改对象，引用比较会永远 false
  try {
    B.challengeSenior();
    let guard = 0;
    while (B.active && guard++ < 60) {
      const a = B.active;
      // 简单策略：优先能杀的攻牌，血<40% 先盾，否则贪输出
      let played = false;
      for (const [idx, c] of a.my.hand.entries()) {
        if (a.my.qi >= c.cost && (c.dmg || (c.shield && a.my.hp / a.my.hpMax < 0.4) || (c.heal && a.my.hp / a.my.hpMax < 0.35))) {
          B.playCard(idx); played = true;
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
  if (won) win++; else lose++;
  // 回合数从战报估算（「丹毒发作」行不算）——用 active 关闭前难以取，改从 logs 计「施放」行数 /2
  const rounds = logs.filter(t => t.indexOf('施放') !== -1).length;
  roundsAll.push(rounds);
  // NaN 巡检：战报里不允许出现 NaN/undefined
  for (const t of logs) if (t.indexOf('NaN') !== -1 || t.indexOf('undefined') !== -1) { nanHit++; console.log('  异常文案：', t); }
}

console.log('── 斗法门禁：' + N + ' 场 vs 大师兄 ──');
console.log('玩家胜率 ' + (win / N * 100).toFixed(1) + '%（胜 ' + win + ' / 负 ' + lose + '）');
const avg = roundsAll.reduce((a, b) => a + b, 0) / roundsAll.length;
console.log('平均出招次数 ' + avg.toFixed(1) + '（双方合计，≈回合数×2）');
console.log('崩溃 ' + crashes + ' 场 / NaN 或 undefined 文案 ' + nanHit + ' 处');
const ok = crashes === 0 && nanHit === 0 && win / N > 0.4 && win / N < 0.9;
console.log(ok ? '门禁 PASS' : '门禁 FAIL');
process.exit(ok ? 0 : 1);
