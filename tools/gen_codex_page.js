/**
 * gen_codex_page.js —— 修炼体系一览页生成器
 * 读 data/balance.json + cultivation.json + pills.json，渲染静态《修炼体系一览.html》。
 * 数值永远与游戏数据同源：改了数据重跑 `node tools/gen_codex_page.js` 即可。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const B = JSON.parse(fs.readFileSync(path.join(root, 'data/balance.json'), 'utf8'));
const C = JSON.parse(fs.readFileSync(path.join(root, 'data/cultivation.json'), 'utf8'));
const P = JSON.parse(fs.readFileSync(path.join(root, 'data/pills.json'), 'utf8'));

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = n => n == null ? '—' : (n >= 1e8 ? (n / 1e8).toFixed(n % 1e8 ? 1 : 0) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(n % 1e4 ? 1 : 0) + '万' : String(n));
const VERSION = 'v0.18.1';

/* 境界特性中文名（只列引擎已生效的；auto_pill/rarity_high/prestige_gain_mult 尚未实现，展示会虚假宣传） */
const TRAIT_CN = t => {
  if (t.indexOf('interval_mult_') === 0) return '奇遇节奏 ×' + parseFloat(t.slice(14)) + '（越小遇事越勤）';
  if (t === 'ascension') return '功行圆满，可飞升立碑';
  if (t === 'unlock_rebirth') return '解锁「转生」';
  return null;
};

/* ── 一、境界十层 ── */
const bName = id => { const b = (B.buildings || []).find(x => x.id === id); return b ? b.name : id; };
const realmsRows = (B.realms || []).map(r => {
  const unlocks = (r.unlock_buildings || []).map(bName).join('、') || '—';
  return '<tr><td><span class="realm-dot" style="background:' + (r.bar ? r.bar[0] : '#888') + '"></span>' + esc(r.name) + '</td>' +
    '<td>' + (r.need_xp == null ? '—（起始）' : fmt(r.need_xp) + ' 修为') + '</td>' +
    '<td>×' + r.mult_passive + '</td>' +
    '<td>' + esc(unlocks) + '</td>' +
    '<td>' + ((r.traits || []).map(TRAIT_CN).filter(Boolean).join('；') || '—') + '</td></tr>';
}).join('\n');

/* ── 二、灵根 ── */
const srRows = ((B.spirit_root || {}).types || []).map(t =>
  '<tr><td>' + esc(t.key) + '</td><td>' + t.weight + '%</td><td>×' + t.xp_mult + '</td><td class="muted">' + esc(t.desc) + '</td></tr>').join('\n');
const wx = C.wuxing || {};
const cycle = wx.cycle || {};
const cycleTxt = Object.keys(cycle).map(k => k + ' 克 ' + cycle[k]).join('，');

/* ── 三、兵器谱（含斗法招） ── */
const fmtEl = el => !el ? '无相' : (Array.isArray(el) ? el.join('·') + '（兼修）' : String(el));
const wm = (C.moves || {}).weapon_moves || {};
const weaponsRows = (C.weapons || []).map(w => {
  const mv = wm[w.id];
  return '<tr><td><b>' + esc(w.name) + '</b></td><td>' + esc(w.grade) + '</td><td>' + fmtEl(w.element) + '</td>' +
    '<td>' + w.sharp + '</td><td class="muted">' + (mv ? esc(mv.name) + '（威力 ×' + mv.mult + '）' : '—') + '</td>' +
    '<td>' + fmt(w.price) + ' 灵石</td></tr>';
}).join('\n');

/* ── 四、功法谱（含斗法招） ── */
const tm = (C.moves || {}).technique_moves || {};
const techRows = (C.techniques || []).map(t => {
  const mv = tm[t.id];
  return '<tr><td><b>' + esc(t.name) + '</b></td><td>' + esc(t.grade) + '</td><td>' + fmtEl(t.element) + '</td>' +
    '<td class="muted">' + (mv ? esc(mv.name) + (mv.guard ? '（威力 ×' + mv.mult + '，附带罡气）' : '（威力 ×' + mv.mult + '）') : '—') + '</td>' +
    '<td>' + fmt(t.price) + ' 灵石</td></tr>';
}).join('\n');

/* ── 五、丹药 ── */
const q = P.quality || {};
const qRows = (q.keys || []).map(k =>
  '<tr><td>' + esc(k) + '</td><td>×' + ((q.effect_mult || {})[k] || 1) + '</td><td>+' + ((q.toxic_by_quality || {})[k] != null ? (q.toxic_by_quality || {})[k] : '?') + ' 丹毒</td></tr>').join('\n');
const pillsRows = (P.pills || []).map(p => {
  const e = p.effect || {};
  let eff = [];
  if (e.mult) eff.push('全局 ×' + e.mult + '（' + (e.duration_s || 0) + ' 秒）');
  if (e.click_mult) eff.push('点击 ×' + e.click_mult + '（' + (e.duration_s || 0) + ' 秒）');
  if (e.bt_rate_add) eff.push('下次突破 ' + (e.bt_rate_add > 0 ? '+' : '') + Math.round(e.bt_rate_add * 100) + '%');
  if (e.cure) eff.push('解负面');
  if (e.toxic_clear) eff.push('丹毒' + (e.toxic_clear >= 100 ? '清零' : '-' + e.toxic_clear));
  if (e.perm_mult_add) eff.push('永久产量 +' + Math.round(e.perm_mult_add * 100) + '%');
  if (e.lingshi) eff.push('灵石 +' + fmt(e.lingshi));
  if (e.must_success) eff.push('下次突破必成' + (e.max_realm_index != null ? '（≤' + ((B.realms[e.max_realm_index] || {}).name || e.max_realm_index) + '）' : ''));
  if (!eff.length) eff.push(p.desc || '—');
  return '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.rarity_default) + '</td><td class="muted">' + esc(eff.join('；')) + '</td></tr>';
}).join('\n');

/* ── 六、斗法卡组 ── */
const bc = C.battle_cards || {};
const KIND_NAME = { attack: '攻式', element: '五行', defense: '守式', heal: '回式' };
const cardsRows = (bc.my_cards || []).map(c => {
  let get = '初始参悟';
  if (c.price) get = fmt(c.price) + ' 灵石（坊市·秘传）';
  if (c.unlock_realm) get = '境界「' + ((B.realms[c.unlock_realm] || {}).name || c.unlock_realm) + '」自动参悟';
  const eff = (c.dmg ? '杀 ' + c.dmg : '') + (c.shield ? ' 护 ' + c.shield : '') + (c.heal ? ' 回 ' + c.heal : '') || '—';
  return '<tr><td>' + (KIND_NAME[c.kind] || c.kind) + '</td><td><b>' + esc(c.name) + '</b></td><td>' + c.cost + '</td>' +
    '<td>' + (c.el === 'root' ? '随自身灵根' : esc(c.el || '无相')) + '</td><td>' + eff + '</td><td class="muted">' + esc(get) + '</td></tr>';
}).join('\n');
const lz = ((bc.ai_cards || {}).lingyunzi || {});
const seniorMoves = (lz.moves || []).map(m =>
  '<span class="chip">' + esc(m.name) + ' ' + m.cost + ' 费' + (m.dmg ? ' 杀' + m.dmg : '') + (m.shield ? ' 护' + m.shield : '') + (m.heal ? ' 回' + m.heal : '') + (m.cd ? '（' + m.cd + ' 回合冷却）' : '') + '</span>').join(' ');

/* ── 七、段位 & 难度 ── */
const rankRows = (((B.battle || {}).ranks) || []).map(r => '<span class="chip">' + esc(r.name) + '（积分 ≥ ' + r.min + '）</span>').join(' ');
const diffRows = Object.entries(B.difficulty || {}).filter(([, d]) => d && d.label).map(([k, d]) =>
  '<tr><td>' + esc(d.label) + '</td><td>修为 ×' + d.xp_mult + '</td><td>突破失败率 ' + (d.fail_rate_add > 0 ? '+' : '') + Math.round((d.fail_rate_add || 0) * 100) + '%</td><td class="muted">' + esc(d.desc || '') + '</td></tr>').join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>灵山掌门 · 修炼体系一览</title>
<style>
  :root { --bg:#15130f; --card:#1e1b15; --ink:#e8dcc8; --soft:#a6987f; --line:#3a332a; --cinnabar:#c0392b; --gold:#e8c34a; }
  * { box-sizing:border-box; }
  body { margin:0; padding:32px 16px 64px; background:var(--bg); color:var(--ink); font-family:"Kaiti SC","KaiTi","STKaiti",serif; line-height:1.75; }
  .wrap { max-width:920px; margin:0 auto; }
  h1 { text-align:center; font-size:30px; letter-spacing:10px; font-weight:normal; margin:8px 0 4px; }
  .sub { text-align:center; color:var(--soft); font-size:13px; margin-bottom:26px; }
  .sub b { color:var(--gold); }
  nav { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin-bottom:30px; position:sticky; top:0; background:linear-gradient(var(--bg) 82%, transparent); padding:10px 0; z-index:5; }
  nav a { color:var(--soft); text-decoration:none; border:1px solid var(--line); border-radius:16px; padding:3px 14px; font-size:13px; }
  nav a:hover { color:var(--cinnabar); border-color:var(--cinnabar); }
  section { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px 24px; margin-bottom:26px; }
  h2 { font-size:19px; letter-spacing:5px; font-weight:normal; border-left:3px solid var(--cinnabar); padding-left:12px; margin:2px 0 14px; }
  h2 small { font-size:12px; color:var(--soft); letter-spacing:1px; margin-left:10px; }
  table { width:100%; border-collapse:collapse; font-size:13.5px; }
  th { color:var(--soft); font-weight:normal; text-align:left; border-bottom:1px solid var(--line); padding:6px 8px; white-space:nowrap; }
  td { border-bottom:1px dashed rgba(58,51,42,.6); padding:7px 8px; vertical-align:top; }
  tr:last-child td { border-bottom:none; }
  .muted { color:var(--soft); font-size:12.5px; }
  .realm-dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; }
  .chip { display:inline-block; border:1px solid var(--line); border-radius:14px; padding:2px 12px; font-size:12.5px; color:var(--soft); margin:3px 4px 3px 0; }
  .note { background:rgba(192,57,43,.08); border:1px dashed rgba(192,57,43,.45); border-radius:8px; padding:10px 14px; font-size:13px; margin:12px 0 4px; }
  .rule { font-size:13.5px; padding-left:20px; margin:0; }
  .rule li { margin-bottom:5px; }
  .cycle { text-align:center; font-size:15px; letter-spacing:2px; margin:10px 0 2px; color:var(--gold); }
  .foot { text-align:center; color:var(--soft); font-size:12px; margin-top:34px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>修 炼 体 系 一 览</h1>
  <div class="sub">《灵山掌门》 <b>${esc(VERSION)}</b> · 生成于 ${new Date().toLocaleDateString('zh-CN')} · 数值与游戏数据同源（改数据重跑 tools/gen_codex_page.js 即同步）</div>
  <nav>
    <a href="#realm">境界十层</a><a href="#root">灵根</a><a href="#weapon">兵器谱</a><a href="#tech">功法谱</a><a href="#pill">丹药五阶</a><a href="#cards">斗法与卡组</a><a href="#misc">段位与难度</a>
  </nav>

  <section id="realm">
    <h2>境界十层<small>练气 → 飞升：突破所需修为 / 全局产量被动 / 解锁内容</small></h2>
    <table><tr><th>境界</th><th>突破所需修为</th><th>产量被动</th><th>解锁建筑</th><th>特性</th></tr>
${realmsRows}
    </table>
    <div class="note">小层：每境分初期 / 中期 / 后期 / 大圆满四段，修为在境内持续累积。金丹起突破必渡劫雷劈——成功晋境，失败走火（修为折半 + 产量减半），连败三次天道怜悯必成。</div>
  </section>

  <section id="root">
    <h2>灵根<small>开局随机，转生重抽——修为速度与斗法五行</small></h2>
    <table><tr><th>灵根</th><th>出现率</th><th>修为倍率</th><th>描述</th></tr>
${srRows}
    </table>
    <div class="cycle">${esc(cycleTxt)}（克制 ×${wx.counter_mult || 1.25}，被克 ×${wx.countered_mult || 0.85}）</div>
    <div class="muted" style="text-align:center">${esc((B.spirit_root || {}).element_note || '')}</div>
    <div class="note">专精与兼修：功法、兵器大部分<b>专精单一五行</b>；功法五行（兼修任一行亦算）与灵根契合时<b>修为获取 ×${(wx.tech_fit_mult || 1.08)}</b>——选对自家灵根的功法修行最快。少数兼修神器（两仪剑·水火、混沌钟·五行皆容）出招时自动取克制敌方的一行。坊市「秘传」的异行五行牌同理，可针对对手换克制。</div>
  </section>

  <section id="weapon">
    <h2>兵器谱<small>坊市购买 · 锋锐加斗法气血与招式威力</small></h2>
    <table><tr><th>兵器</th><th>品阶</th><th>五行</th><th>锋锐</th><th>斗法招式</th><th>价格</th></tr>
${weaponsRows}
    </table>
  </section>

  <section id="tech">
    <h2>功法谱<small>坊市购买 · 决定斗法五行招式</small></h2>
    <table><tr><th>功法</th><th>品阶</th><th>五行</th><th>斗法招式</th><th>价格</th></tr>
${techRows}
    </table>
  </section>

  <section id="pill">
    <h2>丹药五阶<small>劣 &lt; 凡 &lt; 灵 &lt; 珍 &lt; 仙：越高越纯，越低越毒</small></h2>
    <table><tr><th>品阶</th><th>药效倍率</th><th>积毒</th></tr>
${qRows}
    </table>
    <div class="note">丹毒：每 10 点全局产量 −3%（封顶 −30%），随时间消散，清心丹速排，洗髓丹清零，转生清空；丹毒 ≥${(q.toxic_penalty || {}).poisoning_threshold || 60} 进入「丹毒攻心」。境界不匹配的丹：药效 ×0.6、丹毒 ×1.5。</div>
    <table><tr><th>丹药</th><th>品阶</th><th>药效</th></tr>
${pillsRows}
    </table>
  </section>

  <section id="cards">
    <h2>斗法与卡组<small>杀戮尖塔式回合制选牌 + 皇室战争式构筑</small></h2>
    <ul class="rule">
      <li>每回合 <b>3 点灵力</b>，点手牌出招；<b>每张牌每回合限出一次</b>（气机未复），结束回合进入下一回合。</li>
      <li>对方每回合先亮<b>意图</b>（将出什么招、约多少伤害）再动手——看意图排牌序：他出杀招你开罡气，他凝罡你趁机回气。</li>
      <li><b>罡气护罩只保当回合</b>；五行克制 ×${wx.counter_mult || 1.25}；雨天助水行、落雪寒气；丹毒每回合自伤。</li>
      <li>大师兄还会藏<b>连招后手</b>：意图只亮主招，剩余灵力可能再补一招。</li>
    </ul>
    <div class="note">卡组构筑：攻式 / 五行 / 守式 / 回式四类，<b>每类限带一张、只能从已参悟的牌里挑</b>。道友录「整备卡组」定编；异行五行牌在坊市「秘传」购买，可针对对手灵根换克制。</div>
    <table><tr><th>类别</th><th>牌</th><th>灵力</th><th>五行</th><th>效果</th><th>获取</th></tr>
${cardsRows}
    </table>
    <h2 style="margin-top:22px">大师兄·凌云子<small>同境切磋人机陪练：筑基起步、气血厚 30%、剑修卡组</small></h2>
    <div>${seniorMoves}</div>
    <div class="muted" style="margin-top:6px">战胜得论道积分（以下克上翻倍），败了道心小损——他不会赶尽杀绝。</div>
  </section>

  <section id="misc">
    <h2>段位与难度</h2>
    <div>斗法段位（按论道积分）：${rankRows}</div>
    <table style="margin-top:12px"><tr><th>难度</th><th>修为倍率</th><th>突破失败率</th><th>说明</th></tr>
${diffRows}
    </table>
  </section>

  <div class="foot">灵山掌门 · 修炼体系一览 —— 本页由 tools/gen_codex_page.js 从 data/*.json 生成，非手写，数值与游戏实时一致。</div>
</div>
</body>
</html>`;

const out = path.join(root, '修炼体系一览.html');
fs.writeFileSync(out, html, 'utf8');
console.log('已生成：' + out + '（' + Math.round(html.length / 1024) + ' KB）');
