#!/usr/bin/env node
// Qiita 自動投稿スクリプト
// 使い方:
//   QIITA_TOKEN=xxx node scripts/post-to-qiita.mjs
// GitHub Actions の cron / workflow_dispatch で呼ばれる想定。
//
// 動作:
//   1. qiita/*.md を全部読む（_drafts/ 配下は無視）
//   2. frontmatter に qiita_id があれば PATCH（更新）
//   3. なければ POST（新規投稿）→ 返ってきた id を frontmatter に書き戻す
//   4. published: false の記事はスキップ
//   5. レビュー未合格の記事は qiita/_drafts/ に置き、合格してから qiita/ に
//      移動する運用とする。qiita/ 直下に存在する = レビュー合格扱い。
//
// 注意:
//   - Qiita API rate limit: 認証ありで 1000 req/hour
//   - 1 度の cron 実行で大量投稿しないよう、未投稿が複数あっても 1 件に絞る

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const QIITA_DIR = path.join(REPO_ROOT, 'qiita');

// 投稿前に必ずバリデーターを通す（GHA でも事前ステップで走らせるが、二重防御）
function runValidator() {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'validate-articles.mjs')], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error('Article validator failed; aborting publish.');
    process.exit(1);
  }
}

// Body 内の secret パターン二重検査（validator と同じ規則の subset、fail-safe）
const HARD_BLOCK_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /\bgh[posru]_[A-Za-z0-9]{36,}\b/,
  /\bxox[abopr]-[A-Za-z0-9-]{10,}\b/,
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /postgres(?:ql)?:\/\/[^\s'")]+/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
];
function bodyContainsSecret(body) {
  for (const re of HARD_BLOCK_PATTERNS) {
    if (re.test(body)) return re.toString();
  }
  return null;
}
const QIITA_API = 'https://qiita.com/api/v2';

const TOKEN = process.env.QIITA_TOKEN;
if (!TOKEN) {
  console.error('QIITA_TOKEN env var is required');
  process.exit(1);
}

// 簡易 frontmatter パーサ（依存追加なしで運用するため自前実装）
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const km = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!km) continue;
    let v = km[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else v = v.replace(/^["']|["']$/g, '');
    meta[km[1]] = v;
  }
  return { meta, body: m[2] };
}

function serializeFrontmatter(meta, body) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map(x => `"${x}"`).join(', ')}]`);
    } else if (typeof v === 'boolean') {
      lines.push(`${k}: ${v}`);
    } else {
      lines.push(`${k}: "${v}"`);
    }
  }
  lines.push('---', '');
  return lines.join('\n') + body;
}

async function qiitaRequest(method, pathSuffix, body) {
  const res = await fetch(`${QIITA_API}${pathSuffix}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Qiita API ${method} ${pathSuffix} failed: ${res.status} ${txt}`);
  }
  return res.json();
}

async function main() {
  runValidator();

  if (!fs.existsSync(QIITA_DIR)) {
    console.log('No qiita/ directory; nothing to do.');
    return;
  }
  // qiita/ 直下のみ対象（_drafts/ は再帰的に拾わない）
  const files = fs.readdirSync(QIITA_DIR, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.md'))
    .map(d => d.name);
  let posted = 0;
  for (const f of files) {
    const fpath = path.join(QIITA_DIR, f);
    const raw = fs.readFileSync(fpath, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    if (meta.published !== true && meta.published !== 'true') {
      console.log(`SKIP (draft): ${f}`);
      continue;
    }
    const secretHit = bodyContainsSecret(raw);
    if (secretHit) {
      console.error(`ABORT: ${f} contains a hard-block secret pattern (${secretHit})`);
      process.exit(1);
    }
    const tags = (Array.isArray(meta.tags) ? meta.tags : []).map(name => ({ name, versions: [] }));
    const payload = {
      title: meta.title,
      body,
      tags,
      private: false,
      tweet: false,
      coediting: false,
    };
    if (meta.qiita_id) {
      console.log(`UPDATE: ${f} (id=${meta.qiita_id})`);
      await qiitaRequest('PATCH', `/items/${meta.qiita_id}`, payload);
    } else {
      console.log(`CREATE: ${f}`);
      const result = await qiitaRequest('POST', '/items', payload);
      meta.qiita_id = result.id;
      meta.qiita_url = result.url;
      fs.writeFileSync(fpath, serializeFrontmatter(meta, body));
      posted++;
      // 1 回の実行で 1 件まで（誤投稿時の被害最小化）
      if (posted >= 1) {
        console.log('Posted 1 new article; stopping for safety.');
        break;
      }
    }
  }
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
