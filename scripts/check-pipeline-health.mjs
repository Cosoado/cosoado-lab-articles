#!/usr/bin/env node
// 投稿パイプラインの健全性チェック。停滞を「誰かが気づく」ではなく機械で検知する。
//
//   node scripts/check-pipeline-health.mjs            # 人間向けレポート
//   node scripts/check-pipeline-health.mjs --markdown # Issue 本文用
//
// exit 0 = 健全 / exit 1 = 要対応 (停滞・ネタ枯渇・下書き滞留)
// 要 git 履歴 (actions/checkout は fetch-depth: 0)。
//
// しきい値は PUBLISHING_POLICY.md の週 1 本 (7 日) に猶予 3 日を足したもの。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORMS = { zenn: 'articles', qiita: 'qiita' };
const STALL_DAYS = 10; // 週 1 + 猶予 3 日
const LOW_BACKLOG = 3; // PUBLISHING_POLICY.md 1「下限」
const DRAFT_STALE_DAYS = 14; // 公開待ちのまま放置された下書き

const JST = 9 * 3600000;
const dayNo = d => Math.floor((d.getTime() + JST) / 86400000);
const now = new Date();

function addedAt(file) {
  try {
    const iso = execFileSync('git', ['log', '--diff-filter=A', '--format=%aI', '-1', '--', file],
      { cwd: ROOT, encoding: 'utf8' }).trim();
    return iso ? new Date(iso) : null;
  } catch { return null; }
}

function mdSlugs(dir) {
  const d = path.join(ROOT, dir);
  return fs.existsSync(d) ? fs.readdirSync(d).filter(n => n.endsWith('.md')).map(n => n.slice(0, -3)) : [];
}

function lastPublished(dir) {
  let latest = null;
  for (const s of mdSlugs(dir)) {
    const t = addedAt(path.join(dir, `${s}.md`));
    if (t && (!latest || t > latest)) latest = t;
  }
  return latest;
}

function backlogSlugs(section) {
  const md = fs.readFileSync(path.join(ROOT, 'TOPIC_BACKLOG.md'), 'utf8');
  const start = md.indexOf(section.start);
  const end = md.indexOf(section.end, start + 1);
  if (start < 0) return [];
  return [...md.slice(start, end < 0 ? undefined : end).matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map(m => m[1]);
}

const problems = [];
const lines = [];

for (const [platform, dir] of Object.entries(PLATFORMS)) {
  const last = lastPublished(dir);
  const days = last ? dayNo(now) - dayNo(last) : null;
  lines.push(`- ${platform}: 最終公開 ${last ? last.toISOString().slice(0, 10) : '(なし)'} / ${days ?? '-'} 日経過`);
  if (days === null || days > STALL_DAYS) {
    problems.push(`${platform} が ${days ?? '∞'} 日間公開されていません (しきい値 ${STALL_DAYS} 日)`);
  }

  const waiting = mdSlugs(path.join(dir, '_drafts')).filter(s => !fs.existsSync(path.join(ROOT, dir, `${s}.md`)));
  for (const s of waiting) {
    const t = addedAt(path.join(dir, '_drafts', `${s}.md`));
    const age = t ? dayNo(now) - dayNo(t) : null;
    lines.push(`  - 公開待ち下書き: ${dir}/_drafts/${s}.md (${age ?? '?'} 日前に作成)`);
    if (age !== null && age > DRAFT_STALE_DAYS) {
      problems.push(`下書き ${dir}/_drafts/${s}.md が ${age} 日間公開されていません (100/100 なら昇格、不要なら整理)`);
    }
  }
}

const have = new Set(Object.values(PLATFORMS).flatMap(d => [...mdSlugs(d), ...mdSlugs(path.join(d, '_drafts'))]));
const backlogs = {
  zenn: backlogSlugs({ start: '## Zenn 用', end: '## Qiita 用' }),
  qiita: backlogSlugs({ start: '### 未執筆', end: '\n---' }),
};
for (const [platform, slugs] of Object.entries(backlogs)) {
  const left = slugs.filter(s => !have.has(s)).length;
  lines.push(`- ${platform} バックログ残: ${left} 本`);
  if (left === 0) problems.push(`${platform} のネタが枯渇 (0 本)。TOPIC_BACKLOG.md の補充が必要`);
  else if (left <= LOW_BACKLOG) problems.push(`${platform} のネタ残 ${left} 本 (補充推奨)`);
}

const md = process.argv.includes('--markdown');
const head = problems.length ? '要対応' : '健全';
console.log(md ? `## 投稿パイプライン: ${head}\n` : `投稿パイプライン: ${head}`);
console.log(lines.join('\n'));
if (problems.length) {
  console.log(md ? '\n### 問題' : '\n問題:');
  for (const p of problems) console.log(`- ${p}`);
}
process.exit(problems.length ? 1 : 0);
