#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const ROOT = path.join(__dirname, '..');

function mainTag() {
  for (const ref of ['main', 'refs/remotes/origin/main']) {
    try {
      const tags = childProcess.execFileSync('git', ['tag', '--merged', ref, '--sort=-v:refname', '--list', 'v[0-9]*'], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      if (tags) return tags.split(/\r?\n/)[0];
    } catch (e) {}
  }
  return '';
}

const version = (process.argv[2] || process.env.GITHUB_REF_NAME || mainTag()).trim();
if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('用法：node tools/sync-version.js v0.22.2');
  console.error('版本必须来自正式 Tag，格式为 v主版本.次版本.修订号。');
  process.exit(1);
}

const target = path.join(ROOT, 'data', 'version.json');
fs.writeFileSync(target, JSON.stringify({ version }, null, 2) + '\n');

// 兼容仍直接读取 balance/changelog 的旧页面与工具；Tag 始终是这些镜像字段的唯一写入来源。
for (const relative of ['data/balance.json', 'data/changelog.json']) {
  const file = path.join(ROOT, relative);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (relative.endsWith('balance.json')) data.version = version;
  else data.current_version = version;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
console.log('游戏版本已同步为 ' + version);
