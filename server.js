#!/usr/bin/env node
/**
 * server.js —— 《灵山掌门》本地代理（127.0.0.1:8787）
 * 职责：转发方舟 GLM-5.3-Flash（OpenAI 兼容 /chat/completions）+ CORS + 静态托管 + 健康检查。
 * 零依赖：仅 Node 内置模块 http/fs/path/url。绝不内置任何付费调用路径。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const VERSION = '1.0.0';

/* ── 配置加载 ── */
const CONFIG_PATH = path.join(ROOT, 'config.json');
const CONFIG_EXAMPLE_PATH = path.join(ROOT, 'config.example.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    try {
      fs.copyFileSync(CONFIG_EXAMPLE_PATH, CONFIG_PATH);
      console.log('[灵山掌门代理] 已从 config.example.json 生成 config.json，请填写 ark_api_key 后重启即可启用 LLM。');
    } catch (e) {
      console.error('[灵山掌门代理] 生成 config.json 失败：' + e.message);
    }
  }
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { cfg = {}; }
  return {
    port: cfg.port || 8787,
    ark_base_url: cfg.ark_base_url || 'https://ark.cn-beijing.volces.com/api/v3',
    ark_model: cfg.ark_model || '',
    ark_api_key: cfg.ark_api_key || '',
    timeout_ms: cfg.timeout_ms || 5000,
    failure_threshold: cfg.failure_threshold || 3,
    local_mode_minutes: cfg.local_mode_minutes || 10,
    max_tokens: cfg.max_tokens || 300,
    temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.9
  };
}

let CONFIG = loadConfig();

/* ── LLM 状态机 ── */
const state = {
  consecutive_failures: 0,
  local_mode_until: 0,
  started_at: Date.now()
};

/* ── System Prompt（山海客，全文定稿） ── */
const SYSTEM_PROMPT = [
  '你是一部修仙放置游戏《灵山掌门》的奇遇执笔人，化名"山海客"。你的文风：志怪笔记体，古白话，',
  '克制、有画面感，写具体的人与物（货郎、断碑、井底剑鸣、檐下纸鸢），不写空泛套话。',
  '',
  '任务：为玩家（一位修仙宗门的掌门）写一张奇遇卡。玩家会看到标题、描述和两个选项。',
  '',
  '硬性规则（违反即作废）：',
  '1. 只输出一个 JSON 对象，不要输出任何解释、不要使用 markdown 代码围栏以外的多余文字。',
  '2. JSON 格式：{"title":"…","desc":"…","optionA":"…","optionB":"…"}',
  '3. 字数上限：title 不超过 12 个汉字；desc 不超过 80 个汉字；optionA/optionB 各不超过 16 个汉字。',
  '4. 全部字段禁止出现阿拉伯数字、百分号、"倍"字，禁止出现任何具体效果数值或收益描述',
  '   （效果由系统结算，你只负责叙事）。',
  '5. optionA 与 optionB 必须是两个不同行动，语义上分别对应"用户消息"里 slots.A 与 slots.B 的',
  '   含义（如 A 是拾取/接受、B 是拒绝/离开之类的对仗，以 slots 实际含义为准），选项文案要能',
  '   让玩家预感代价或收获的方向，但不许写出量。',
  '6. 呼应玩家的过往：参考"tags"（恩/怨/缘/债）与"recent"（近期奇遇）。若存在高权重 tag，',
  '   描述或选项中点到一处分歧或回响即可（老熟人、旧怨上门、前缘再续），不许堆砌复述历史。',
  '7. "dao_heart"（道心 0-100）决定叙事底色：低于 30 偏阴郁诡谲，高于 70 偏澄明开阔，中间持平实。',
  '8. 称呼玩家用"你"。不要出现"玩家""系统""游戏"字样。',
  '',
  '输出示例（仅示意格式与文风，不要照抄内容）：',
  '{"title":"雨夜叩门人","desc":"山雨骤急，一名湿透的货郎叩门借宿，担中隐约有铃音。你说铃是旧物，他笑而不答。","optionA":"留他一夜","optionB":"闭门谢客"}'
].join('\n');

/* ── 健壮解析与校验 ── */
function extractJSON(text) {
  if (typeof text !== 'string') return null;
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  t = t.slice(a, b + 1);
  const tries = [t, t.replace(/,\s*([}\]])/g, '$1')];
  for (const s of tries) { try { return JSON.parse(s); } catch (e) {} }
  return null;
}

function validateLLM(obj) {
  const F = ['title', 'desc', 'optionA', 'optionB'];
  if (!obj || F.some(k => typeof obj[k] !== 'string')) return 'field_missing';
  const caps = { title: 12, desc: 80, optionA: 16, optionB: 16 };
  for (const k of F) {
    const s = obj[k].trim();
    if (!s) return 'empty';
    if ([...s].length > caps[k]) return 'too_long';
    if (/[\d%]|×\s*\d|倍/.test(s)) return 'contains_numbers';
  }
  if (obj.optionA.trim() === obj.optionB.trim()) return 'same_options';
  return null;
}

/* ── 通用响应 ── */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, corsHeaders()));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ── 上游调用 ── */
async function callArk(payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.timeout_ms);
  const started = Date.now();
  try {
    const resp = await fetch(CONFIG.ark_base_url.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + CONFIG.ark_api_key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: CONFIG.ark_model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) }
        ],
        temperature: CONFIG.temperature,
        max_tokens: CONFIG.max_tokens,
        stream: false,
        // GLM-5.2 等思考型模型默认开启思考，会吃满超时；奇遇文案不需要思考链
        thinking: { type: 'disabled' }
      }),
      signal: ctrl.signal
    });
    const latency = Date.now() - started;
    const text = await resp.text();
    if (!resp.ok) {
      let code = 'UPSTREAM_ERROR';
      if (resp.status === 401 || resp.status === 403) code = 'AUTH';
      else if (resp.status === 429 || /quota|额度|欠费/i.test(text)) code = 'QUOTA';
      const err = new Error(text.slice(0, 300));
      err.code = code;
      err.status = resp.status;
      throw err;
    }
    let data;
    try { data = JSON.parse(text); } catch (e) {
      const err = new Error('上游响应非 JSON');
      err.code = 'UPSTREAM_ERROR';
      throw err;
    }
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : null;
    const obj = extractJSON(content);
    if (!obj) {
      const err = new Error('模型输出无法提取 JSON');
      err.code = 'INVALID_JSON';
      throw err;
    }
    const bad = validateLLM(obj);
    if (bad) {
      const err = new Error('模型输出校验未通过：' + bad);
      err.code = 'VALIDATION_FAIL';
      throw err;
    }
    return { ok: true, latency_ms: latency, title: obj.title, desc: obj.desc, optionA: obj.optionA, optionB: obj.optionB };
  } catch (e) {
    if (e.code) throw e;
    if (e.name === 'AbortError') {
      const err = new Error('上游超时 ' + CONFIG.timeout_ms + 'ms');
      err.code = 'TIMEOUT';
      throw err;
    }
    const err = new Error(e.message || '网络错误');
    err.code = 'UPSTREAM_ERROR';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function recordFailure() {
  state.consecutive_failures += 1;
  if (state.consecutive_failures >= CONFIG.failure_threshold) {
    state.local_mode_until = Date.now() + CONFIG.local_mode_minutes * 60 * 1000;
    console.log('[灵山掌门代理] 连续失败 ' + state.consecutive_failures + ' 次，进入纯本地模式 ' + CONFIG.local_mode_minutes + ' 分钟。');
  }
}

function inLocalMode() {
  return Date.now() < state.local_mode_until;
}

/* ── 静态托管 ── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (p === '/' || p === '') p = '/index.html';
  const full = path.normalize(path.join(ROOT, p));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    res.writeHead(403, corsHeaders());
    res.end('403');
    return;
  }
  const ext = path.extname(full).toLowerCase();
  if (!MIME[ext] || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, corsHeaders()));
    res.end(JSON.stringify({ ok: false, message: 'not found' }));
    return;
  }
  res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext], 'Cache-Control': 'no-cache' }, corsHeaders()));
  fs.createReadStream(full).pipe(res);
}

/* ── 路由 ── */
async function handle(req, res) {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJSON(res, 200, {
      ok: true,
      model: CONFIG.ark_model || '',
      has_key: !!CONFIG.ark_api_key,
      local_mode: inLocalMode(),
      consecutive_failures: state.consecutive_failures,
      uptime_s: Math.floor((Date.now() - state.started_at) / 1000),
      version: VERSION
    });
  }

  if (req.method === 'GET' && pathname === '/api/balance') {
    try {
      const balance = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'balance.json'), 'utf8'));
      const events = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'events.json'), 'utf8'));
      let chains = [];
      try {
        chains = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chains.json'), 'utf8')).chains || [];
      } catch (e) { /* chains.json 可选 */ }
      return sendJSON(res, 200, { ok: true, balance, events, chains });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, message: '读取数据文件失败：' + e.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/key') {
    try {
      const body = JSON.parse(await readBody(req));
      const key = typeof body.ark_api_key === 'string' ? body.ark_api_key.trim() : '';
      if (!key) return sendJSON(res, 400, { ok: false, message: 'ark_api_key 不能为空' });
      CONFIG.ark_api_key = key; // 热重载
      let cfgObj = {};
      try { cfgObj = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { cfgObj = JSON.parse(fs.readFileSync(CONFIG_EXAMPLE_PATH, 'utf8')); }
      cfgObj.ark_api_key = key;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfgObj, null, 2) + '\n', 'utf8');
      console.log('[灵山掌门代理] API Key 已更新（热重载生效）。');
      return sendJSON(res, 200, { ok: true });
    } catch (e) {
      return sendJSON(res, 400, { ok: false, message: '请求不合法：' + e.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/event') {
    if (inLocalMode()) {
      return sendJSON(res, 503, { ok: false, code: 'LOCAL_MODE', message: '纯本地模式中，稍后自动恢复' });
    }
    if (!CONFIG.ark_model || !CONFIG.ark_api_key) {
      return sendJSON(res, 503, { ok: false, code: 'NO_CONFIG', message: '未配置 ark_model 或 ark_api_key' });
    }
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (e) {
      return sendJSON(res, 400, { ok: false, code: 'UPSTREAM_ERROR', message: '请求体非 JSON' });
    }
    try {
      const r = await callArk(payload);
      state.consecutive_failures = 0;
      state.local_mode_until = 0;
      return sendJSON(res, 200, Object.assign({ ok: true, source: 'llm', model: CONFIG.ark_model }, r));
    } catch (e) {
      recordFailure();
      return sendJSON(res, 502, { ok: false, code: e.code || 'UPSTREAM_ERROR', message: String(e.message || e).slice(0, 300) });
    }
  }

  if (pathname.startsWith('/api/')) {
    return sendJSON(res, 404, { ok: false, message: 'unknown api path' });
  }

  if (req.method === 'GET') return serveStatic(req, res, pathname);

  res.writeHead(405, corsHeaders());
  res.end();
}

/* ── 启动 ── */
const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    try { sendJSON(res, 500, { ok: false, message: '内部错误：' + e.message }); } catch (e2) {}
  });
});

server.listen(CONFIG.port, '127.0.0.1', () => {
  console.log('[灵山掌门代理] 已启动 http://127.0.0.1:8787 （模型：' + (CONFIG.ark_model || '未配置') + ' / 密钥：' + (CONFIG.ark_api_key ? '已配置' : '未配置') + '）');
  if (!CONFIG.ark_model || !CONFIG.ark_api_key) {
    console.log('');
    console.log('[灵山掌门代理] config.json 缺少必填项，请完成以下两步：');
    console.log('1) 确认登录与可用模型：');
    console.log('     arkcli auth status');
    console.log('     arkcli resources list          ← 在输出的 items[].id 中找到 "glm-5-3-flash" 这一行，');
    console.log('                                      把该完整 ID 填入 config.json 的 ark_model');
    console.log('2) 获取 API Key 并填入 ark_api_key：');
    console.log('     arkcli auth apikey             ← 按交互输出获取/确认 Key（以 arkcli 实际输出为准）');
    console.log('可选自检： arkcli usage balance        ← 查看免费额度余量');
    console.log('填好后重启本程序（重开 start.bat）。');
    console.log('');
  }
});

process.on('uncaughtException', (e) => console.error('[灵山掌门代理] uncaught:', e.message));
process.on('unhandledRejection', (e) => console.error('[灵山掌门代理] unhandled:', String(e).slice(0, 200)));
