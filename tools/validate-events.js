#!/usr/bin/env node
/**
 * validate-events.js —— 《灵山掌门》事件数据校验脚本
 * 零依赖：仅使用 Node 内置模块（fs / path）。
 *
 * 用法：node tools/validate-events.js [--stats]
 *   --stats  额外输出「池 × 稀有度」计数矩阵、稀有度合计与各池条数。
 *
 * 退出码：0 = 全部通过；1 = 存在违规；2 = 数据文件缺失 / 非法 JSON / 带 BOM。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const EVENTS_PATH = path.join(__dirname, '..', 'data', 'events.json');
const BALANCE_PATH = path.join(__dirname, '..', 'data', 'balance.json');

const EXPECTED_TOTAL = 61;
const POOLS = 'ABCDEFGHIJ';
const RARITIES = ['凡', '灵', '珍', '仙'];
const STANCES = ['恩', '怨', '缘', '债'];
const AFTERS = ['恩', '怨', '缘', '债', '清'];
const FITS_ALLOWED = new Set(['A', 'B', 'C', 'D', 'E', 'F']);
const EXPECTED_RARITY = { 凡: 24, 灵: 17, 珍: 12, 仙: 8 };

/* ── 规则 4：禁数字（裁决后定稿） ──
 * [0-9０-９] 与汉字数字 [零三四五六七八九十百千万亿] 一律违规；
 * 「一」「半」「两」例外：向后 2 字内出现量词白名单字即放行（覆盖「一大群」），
 * 另设固定词组例外表（成语/固定搭配，不含任何数量信息）。
 * 白名单由规格建议清单去重整理，并按 2026-08-29 裁决增补：
 * 炉战程曲手用线闪拍（一炉丹/一战/一程/一曲/一手/一用/一线/一闪/半拍）。
 * 「里」不在白名单（防「十里」类距离数量表达）。 */
const ASCII_DIGIT_RE = /[0-9]/;
const FW_DIGIT_RE = /[０-９]/;
const CNUM_STRICT_RE = /[零三四五六七八九十百千万亿]/;
const ONE_HALF = new Set(['一', '半', '两']);
const PHRASE_OK = ['零零碎碎', '夜半', '半透明', '一乞翁', '一涨一落', '垂青一顾'];
const MEASURE_WORDS = new Set(
  '名阵卷缕朵枚株只条位座间粒颗滴片道声口句批群担坛壶盏张把柄支枝丝抹圈团簇池汪弯轮痕点袭串份页行字步招式回番截段节升斗石丈尺拳掌指笔画窗门户桥舟车马鞭杖刀剑弓箭枪棍锄锹桶篮筐笼箱袋包篓尾窝峰峦处趟遭种样副幅联贴剂服炷香觉梦羽鳞甲瓣叶茎杆炉战程曲手用线闪拍'
);

let violations = 0;        // 全局违规计数
let currentViolations = 0; // 当前事件违规计数（用于逐条 [OK] 判定）
let warnings = 0;          // 提示级计数（不计入 FAIL）

function fail(id, field, reason) {
  violations += 1;
  currentViolations += 1;
  console.log(`[FAIL ${id} ${field} ${reason}]`);
}

function readJson(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`错误：找不到 ${label}：${p}`);
    process.exit(2);
  }
  const raw = fs.readFileSync(p, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) {
    console.error(`错误：${label} 带 UTF-8 BOM，请去除后重试`);
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`错误：${label} 不是合法 JSON：${e.message}`);
    process.exit(2);
  }
}

const charLen = (s) => [...s].length;

function contextOf(chars, i) {
  const start = Math.max(0, i - 5);
  const end = Math.min(chars.length, i + 6);
  return (start > 0 ? '…' : '') + chars.slice(start, end).join('') + (end < chars.length ? '…' : '');
}

function checkTextNumbers(id, field, text) {
  const chars = [...text];
  // 例外词组命中的位置整体跳过（成语/固定搭配，不含数量信息）
  const skip = new Array(chars.length).fill(false);
  for (const ph of PHRASE_OK) {
    const pch = [...ph];
    for (let i = 0; i + pch.length <= chars.length; i++) {
      if (pch.every((c, j) => chars[i + j] === c)) {
        for (let j = 0; j < pch.length; j++) skip[i + j] = true;
      }
    }
  }
  for (let i = 0; i < chars.length; i++) {
    if (skip[i]) continue;
    const ch = chars[i];
    if (ASCII_DIGIT_RE.test(ch) || FW_DIGIT_RE.test(ch)) {
      fail(id, field, `禁数字「${ch}」｜上下文「${contextOf(chars, i)}」`);
    } else if (CNUM_STRICT_RE.test(ch)) {
      fail(id, field, `禁汉字数字「${ch}」｜上下文「${contextOf(chars, i)}」`);
    } else if (ONE_HALF.has(ch)) {
      // 「一/半/两」：向后 2 字内出现量词白名单字即放行（覆盖「一大群」「两位」）
      const near = [chars[i + 1], chars[i + 2]].filter(Boolean);
      if (!near.some((c) => MEASURE_WORDS.has(c))) {
        const nextDesc = chars[i + 1] === undefined ? '<文末>' : `「${chars[i + 1]}」`;
        fail(id, field, `「${ch}」后接${nextDesc}不在量词白名单｜上下文「${contextOf(chars, i)}」`);
      }
    }
  }
}

/* ── 主流程 ── */
const showStats = process.argv.includes('--stats');

const events = readJson(EVENTS_PATH, 'events.json');
const balance = readJson(BALANCE_PATH, 'balance.json');

if (!Array.isArray(events)) {
  console.log('[FAIL - events.json 顶层须为 JSON 数组]');
  process.exit(1);
}

// 规则 1：恰好 61 条
if (events.length !== EXPECTED_TOTAL) {
  fail('-', 'events.json', `条数须为 ${EXPECTED_TOTAL}｜实际 ${events.length}`);
}

// 规则 5 准备：balance.json pools 节 → no_negative 为 true 的池
// 兼容两种结构：数组（元素含 id 字段）或以池字母为键的对象。
let noNegPools = new Set();
if (!balance || typeof balance !== 'object' || !balance.pools ||
    typeof balance.pools !== 'object') {
  fail('-', 'balance.json', '缺少 pools 节｜规则5低池负面禁令按空集处理');
} else {
  noNegPools = new Set(Object.entries(balance.pools)
    .filter(([, cfg]) => cfg && typeof cfg === 'object' && cfg.no_negative === true)
    .map(([k, cfg]) => (cfg && typeof cfg.id === 'string' ? cfg.id : k)));
}

// 预收集全库 tags[].key（规则 2 recycle 起源校验用）
const tagKeys = new Set();
for (const ev of events) {
  if (ev && typeof ev === 'object' && Array.isArray(ev.tags)) {
    for (const t of ev.tags) {
      if (t && typeof t === 'object' && typeof t.key === 'string') tagKeys.add(t.key);
    }
  }
}

const seenIds = new Map();    // id 唯一性
const titleOwner = new Map(); // title 全库唯一性

for (let idx = 0; idx < events.length; idx++) {
  const ev = events[idx];
  currentViolations = 0;
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
    fail(`#${idx}`, 'event', '须为对象');
    continue;
  }
  const id = typeof ev.id === 'string' ? ev.id : `#${idx}`;

  // 规则 2：必填字段
  for (const f of ['id', 'pool', 'rarity', 'title', 'desc', 'options']) {
    if (ev[f] === undefined) fail(id, f, '缺少必填字段');
  }

  // id：格式「池字母+两位序号」、全局唯一、前缀=pool
  if (typeof ev.id === 'string') {
    if (!/^[A-J][0-9]{2}$/.test(ev.id)) fail(id, 'id', '格式须为「池字母+两位序号」');
    if (seenIds.has(ev.id)) fail(id, 'id', `与 ${seenIds.get(ev.id)} 重复`);
    else seenIds.set(ev.id, ev.id);
    if (typeof ev.pool === 'string' && ev.id[0] !== ev.pool) {
      fail(id, 'id', `前缀「${ev.id[0]}」≠pool「${ev.pool}」`);
    }
  }

  if (ev.pool !== undefined && !POOLS.includes(ev.pool)) {
    fail(id, 'pool', `「${ev.pool}」不在 A-J`);
  }
  if (ev.rarity !== undefined && !RARITIES.includes(ev.rarity)) {
    fail(id, 'rarity', `「${ev.rarity}」须为 凡/灵/珍/仙`);
  }

  // options：恰为 2 项；text/fits/daoxin
  if (ev.options !== undefined) {
    if (!Array.isArray(ev.options)) {
      fail(id, 'options', '须为数组');
    } else {
      if (ev.options.length !== 2) fail(id, 'options', `须恰为 2 项｜实际 ${ev.options.length}`);
      ev.options.forEach((opt, i) => {
        if (!opt || typeof opt !== 'object' || Array.isArray(opt)) {
          fail(id, `options[${i}]`, '须为对象');
          return;
        }
        if (typeof opt.text !== 'string' || opt.text === '') {
          fail(id, `options[${i}].text`, '缺失或非字符串');
        }
        if (!Array.isArray(opt.fits) || opt.fits.length === 0) {
          fail(id, `options[${i}].fits`, '缺失或须为非空数组');
        } else {
          for (const f of opt.fits) {
            if (!FITS_ALLOWED.has(f)) fail(id, `options[${i}].fits`, `非法槽位「${f}」｜仅 A-F`);
          }
        }
        if (opt.daoxin !== undefined &&
            (!Number.isInteger(opt.daoxin) || opt.daoxin < -5 || opt.daoxin > 5)) {
          fail(id, `options[${i}].daoxin`, `须为 -5..5 整数｜实际 ${JSON.stringify(opt.daoxin)}`);
        }
        // 规则 3 + 规则 4（选项文案）
        if (typeof opt.text === 'string') {
          const n = charLen(opt.text);
          if (n > 16) fail(id, `options[${i}].text`, `超长 ${n}＞16 字`);
          checkTextNumbers(id, `options[${i}].text`, opt.text);
        }
      });
    }
  }

  // tags：key/stance/weight
  if (ev.tags !== undefined) {
    if (!Array.isArray(ev.tags)) {
      fail(id, 'tags', '须为数组');
    } else {
      ev.tags.forEach((t, i) => {
        if (!t || typeof t !== 'object' || Array.isArray(t)) {
          fail(id, `tags[${i}]`, '须为对象');
          return;
        }
        if (typeof t.key !== 'string' || t.key === '') fail(id, `tags[${i}].key`, '缺失或非字符串');
        if (!STANCES.includes(t.stance)) fail(id, `tags[${i}].stance`, `「${t.stance}」须为 恩/怨/缘/债`);
        if (!Number.isInteger(t.weight) || t.weight < 1 || t.weight > 3) {
          fail(id, `tags[${i}].weight`, `须为 1..3 整数｜实际 ${JSON.stringify(t.weight)}`);
        }
      });
    }
  }

  // recycle：须等于某条事件 tags[].key（存在起源事件）
  if (ev.recycle !== undefined) {
    if (typeof ev.recycle !== 'string' || ev.recycle === '') {
      fail(id, 'recycle', '须为非空字符串');
    } else if (!tagKeys.has(ev.recycle)) {
      fail(id, 'recycle', `「${ev.recycle}」无起源事件｜全库无 tags[].key 与之相等`);
    }
  }

  // after
  if (ev.after !== undefined && !AFTERS.includes(ev.after)) {
    fail(id, 'after', `「${ev.after}」须为 恩/怨/缘/债/清`);
  }

  // 规则 3 + 规则 4：title/desc 字数与禁数字；规则 7：title 全库唯一
  if (typeof ev.title === 'string') {
    const n = charLen(ev.title);
    if (n > 12) fail(id, 'title', `超长 ${n}＞12 字`);
    checkTextNumbers(id, 'title', ev.title);
    if (titleOwner.has(ev.title)) {
      fail(id, 'title', `全库重复｜与 ${titleOwner.get(ev.title)} 同名「${ev.title}」`);
    } else {
      titleOwner.set(ev.title, id);
    }
  }
  if (typeof ev.desc === 'string') {
    const n = charLen(ev.desc);
    if (n > 80) fail(id, 'desc', `超长 ${n}＞80 字`);
    checkTextNumbers(id, 'desc', ev.desc);
  }

  // 规则 5：低池负面禁令（no_negative=true 的池，fits 不得含 B/F）
  if (noNegPools.has(ev.pool) && Array.isArray(ev.options)) {
    ev.options.forEach((opt, i) => {
      if (opt && Array.isArray(opt.fits)) {
        const bad = [...new Set(opt.fits.filter((f) => f === 'B' || f === 'F'))];
        if (bad.length) fail(id, `options[${i}].fits`, `池${ev.pool} no_negative=true｜fits 不得含 ${bad.join('/')}`);
      }
    });
  }

  // 规则 6（裁决 2026-08-29：降为提示级）——61 条定稿包中 E06「兽潮前兆」fits 仅 C/E，
  // 属任务书采纳的定稿内容；该规则主要约束后续批量扩充的准入门槛。
  if (ev.rarity === '珍' || ev.rarity === '仙') {
    const strong = Array.isArray(ev.options) && ev.options.some((opt) =>
      opt && Array.isArray(opt.fits) &&
      (opt.fits.includes('D') || opt.fits.includes('A') || opt.fits.includes('B')));
    if (!strong) {
      warnings += 1;
      console.log(`[WARN ${id} fits 珍/仙条目｜无任何选项 fits 含 D 或 A/B（强槽）——定稿保留，仅提示]`);
    }
  }

  if (currentViolations === 0) console.log('[OK]');
}

/* ── 规则 8：--stats ── */
if (showStats) {
  const matrix = {};
  for (const p of POOLS) matrix[p] = { 凡: 0, 灵: 0, 珍: 0, 仙: 0, total: 0 };
  const rTotals = { 凡: 0, 灵: 0, 珍: 0, 仙: 0 };
  let total = 0;
  for (const ev of events) {
    if (ev && typeof ev === 'object' && matrix[ev.pool] && rTotals[ev.rarity] !== undefined) {
      matrix[ev.pool][ev.rarity] += 1;
      matrix[ev.pool].total += 1;
      rTotals[ev.rarity] += 1;
      total += 1;
    }
  }
  console.log('');
  console.log('== 统计：池 × 稀有度 ==');
  console.log('池    凡   灵   珍   仙   计');
  for (const p of POOLS) {
    const m = matrix[p];
    console.log(
      `${p}   ` +
      `${String(m.凡).padStart(3)}  ${String(m.灵).padStart(3)}  ` +
      `${String(m.珍).padStart(3)}  ${String(m.仙).padStart(3)}  ${String(m.total).padStart(3)}`
    );
  }
  console.log(
    '计  ' +
    `${String(rTotals.凡).padStart(4)}  ${String(rTotals.灵).padStart(3)}  ` +
    `${String(rTotals.珍).padStart(3)}  ${String(rTotals.仙).padStart(3)}  ${String(total).padStart(3)}`
  );
  for (const r of RARITIES) {
    if (rTotals[r] !== EXPECTED_RARITY[r]) {
      fail('-', 'stats', `稀有度「${r}」计数 ${rTotals[r]} ≠ 预期 ${EXPECTED_RARITY[r]}`);
    }
  }
  if (total !== EXPECTED_TOTAL) {
    fail('-', 'stats', `总条数 ${total} ≠ 预期 ${EXPECTED_TOTAL}`);
  }
}

if (violations === 0) {
  console.log(`PASS 全部 ${events.length} 条校验通过` + (warnings ? `（另含 ${warnings} 条 WARN 提示）` : ''));
} else {
  console.log(`FAIL 共 ${violations} 处违规` + (warnings ? `（另含 ${warnings} 条 WARN 提示）` : ''));
  process.exitCode = 1;
}
