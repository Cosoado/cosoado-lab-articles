#!/usr/bin/env node
// 投稿してよい日かを判定するゲート
//
// 背景:
//   Zenn / Qiita の自動執筆エージェントが別々のスケジュールで並行稼働している。
//   Qiita 側プロンプトには「7 日以内に公開していたらスキップ」という文章ルールが
//   あったが、Zenn 側プロンプトには頻度ガードが一切なかった。
//   さらに両者は互いの投稿を見ていないため、媒体をまたいだ連投を防げない。
//   PUBLISHING_POLICY.md 1 の頻度ルールを、文章ではなく実行可能な形にする。
//
// 使い方:
//   node scripts/check-publish-window.mjs --platform zenn
//   node scripts/check-publish-window.mjs --platform qiita
//
//   exit 0 = 公開してよい / exit 1 = 今日はスキップして終了
//
// 判定ルール (PUBLISHING_POLICY.md 1「上限」):
//   1. 同一媒体で 7 日以内に公開していたら NG (週 1 本)
//   2. 媒体を問わず 3 日以内に公開していたら NG (中 3 日・同日 1 媒体を含む)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIN_DAYS_SAME_PLATFORM = 7;
const MIN_DAYS_ANY_PLATFORM = 3;

const PLATFORM_DIR = { zenn: 'articles', qiita: 'qiita' };

function lastPublishedAt(dir) {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return null;
  let latest = null;
  for (const name of fs.readdirSync(abs)) {
    if (!name.endsWith('.md')) continue; // _drafts/ はディレクトリなので自然に除外される
    let iso;
    try {
      iso = execFileSync(
        'git',
        ['log', '--diff-filter=A', '--format=%aI', '-1', '--', path.join(dir, name)],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      ).trim();
    } catch {
      continue;
    }
    if (!iso) continue; // 未コミットのファイル
    const t = new Date(iso);
    if (!latest || t > latest) latest = t;
  }
  return latest;
}

// 暦日 (JST) の差で数える。経過時間 (86400000ms 単位) で比べると、実行時刻が前回公開より
// 数分早いだけで 6.99 日になり、7 日ちょうどの回が毎回「境界値」で SKIP されて公開が 1 日ずつ遅れる。
const JST_OFFSET_MS = 9 * 3600000;
function waitingDrafts(dir) {
  const d = path.join(REPO_ROOT, dir, '_drafts');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter(n => n.endsWith('.md'))
    .map(n => n.slice(0, -3))
    .filter(slug => !fs.existsSync(path.join(REPO_ROOT, dir, `${slug}.md`)));
}

function daysSince(date, now) {
  const day = d => Math.floor((d.getTime() + JST_OFFSET_MS) / 86400000);
  return day(now) - day(date);
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--platform');
  const platform = i >= 0 ? argv[i + 1] : null;
  if (!platform || !PLATFORM_DIR[platform]) {
    console.error('Usage: check-publish-window.mjs --platform <zenn|qiita>');
    process.exit(2);
  }

  const now = new Date();
  const own = lastPublishedAt(PLATFORM_DIR[platform]);
  const others = Object.entries(PLATFORM_DIR)
    .filter(([p]) => p !== platform)
    .map(([p, dir]) => ({ platform: p, at: lastPublishedAt(dir) }))
    .filter(o => o.at);

  const fmt = d => (d ? d.toISOString().slice(0, 10) : '(なし)');
  console.log(`platform : ${platform}`);
  console.log(`最終公開 : ${platform}=${fmt(own)}` +
    others.map(o => ` / ${o.platform}=${fmt(o.at)}`).join(''));

  const blockers = [];

  if (own) {
    const d = daysSince(own, now);
    if (d < MIN_DAYS_SAME_PLATFORM) {
      blockers.push(
        `同一媒体 (${platform}) の前回公開から ${d} 日 ` +
        `(必要: ${MIN_DAYS_SAME_PLATFORM} 日 / 週 1 本)`);
    }
  }

  for (const o of others) {
    const d = daysSince(o.at, now);
    if (d < MIN_DAYS_ANY_PLATFORM) {
      blockers.push(
        `他媒体 (${o.platform}) の公開から ${d} 日 ` +
        `(必要: ${MIN_DAYS_ANY_PLATFORM} 日 / 中 3 日・同日 1 媒体)`);
    }
  }

  if (blockers.length) {
    console.log('\n判定: ⏸ SKIP — 今日は公開しない');
    for (const b of blockers) console.log(`  - ${b}`);
    console.log('\n記事は _drafts/ に残し、commit / push せず終了すること。');
    console.log('（バックログへの追記だけは commit してよい）');
    process.exit(1);
  }

  console.log('\n判定: ✅ GO — 公開してよい');
  const waiting = waitingDrafts(PLATFORM_DIR[platform]);
  if (waiting.length) {
    console.log(`\n公開待ちの下書き (${waiting.length} 本): 新規を書く前に、100/100 のものがあれば先に昇格すること`);
    for (const w of waiting) console.log(`  - ${PLATFORM_DIR[platform]}/_drafts/${w}.md`);
  }
  process.exit(0);
}

main();
