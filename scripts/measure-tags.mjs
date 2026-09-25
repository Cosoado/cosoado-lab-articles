#!/usr/bin/env node
// Zenn topics / Qiita tags の使用件数を測って scripts/tag-stats.json に書き込む。
//
// 使い方:
//   node scripts/measure-tags.mjs                        # 記事で使っているタグのうち未計測のもの
//   node scripts/measure-tags.mjs zenn:react qiita:React # 候補を足して測る (計測済みでも測り直す)
//   node scripts/measure-tags.mjs --refresh              # 記事で使っている全タグを測り直す
//
// validate-articles.mjs はこのファイルの件数を見て、min_count 未満や未計測のタグを
// Major にする (誰も検索しないタグで記事が埋もれるのを防ぐ・2026-09-25)。
// 新しいタグを使うときは、先にこのスクリプトで件数を確かめる。
//
// Qiita は未認証だと 1 時間 60 回まで。QIITA_TOKEN があれば 1,000 回まで使える。
// 上限に当たったら、そこまでの結果を書いて止める。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const STATS_PATH = path.join(__dirname, 'tag-stats.json');

function listTags(dir, key) {
  const out = [];
  for (const sub of ['', '_drafts']) {
    const d = path.join(REPO_ROOT, dir, sub);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter(n => n.endsWith('.md'))) {
      // validate-articles.mjs の parseFrontmatter と同じ読み方 (単一引用符も受け付ける)
      const m = fs.readFileSync(path.join(d, f), 'utf8').match(new RegExp(`^${key}:\\s*\\[(.*)\\]\\s*$`, 'm'));
      if (m) out.push(...m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean));
    }
  }
  return out;
}

async function fetchCount(kind, tag) {
  const headers = { 'User-Agent': 'cosoado-lab-articles/measure-tags' };
  if (kind === 'zenn') {
    const res = await fetch(`https://zenn.dev/api/topics/${encodeURIComponent(tag.toLowerCase())}`, { headers });
    if (res.status === 404) return 0;
    if (!res.ok) throw new Error(`zenn ${tag}: HTTP ${res.status}`);
    return (await res.json()).topic?.taggings_count ?? 0;
  }
  if (process.env.QIITA_TOKEN) headers.Authorization = `Bearer ${process.env.QIITA_TOKEN}`;
  const res = await fetch(`https://qiita.com/api/v2/tags/${encodeURIComponent(tag)}`, { headers });
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`qiita ${tag}: HTTP ${res.status}`);
  return (await res.json()).items_count ?? 0;
}

async function main() {
  const stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh');
  const unmeasured = (kind, tags) =>
    tags.filter(t => refresh || stats[kind][kind === 'zenn' ? t.toLowerCase() : t] === undefined);
  const wanted = {
    zenn: new Set(unmeasured('zenn', listTags('articles', 'topics'))),
    qiita: new Set(unmeasured('qiita', listTags('qiita', 'tags'))),
  };
  for (const arg of args.filter(a => a !== '--refresh')) {
    const [kind, ...rest] = arg.split(':');
    const tag = rest.join(':').trim();
    if (!wanted[kind] || !tag) {
      console.error(`引数は zenn:<topic> か qiita:<tag> の形で渡す: ${arg}`);
      process.exit(1);
    }
    wanted[kind].add(tag);
  }

  let stopped = false;
  measure: for (const kind of ['zenn', 'qiita']) {
    for (const tag of wanted[kind]) {
      const key = kind === 'zenn' ? tag.toLowerCase() : tag;
      try {
        stats[kind][key] = await fetchCount(kind, tag);
        console.log(`${kind}\t${tag}\t${stats[kind][key]}`);
      } catch (e) {
        console.error(`止めた (ここまでの結果は保存する): ${e.message}`);
        stopped = true;
        break measure;
      }
      await new Promise(r => setTimeout(r, kind === 'zenn' ? 300 : 700));
    }
  }
  stats.measured_at = new Date().toISOString().slice(0, 10);
  for (const kind of ['zenn', 'qiita']) {
    stats[kind] = Object.fromEntries(Object.entries(stats[kind]).sort(([a], [b]) => a.localeCompare(b)));
  }
  fs.writeFileSync(STATS_PATH, `${JSON.stringify(stats, null, 2)}\n`);
  if (stopped) process.exit(1);
}

main();
