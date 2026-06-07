#!/usr/bin/env node
// 記事バリデーター
//
// 役割:
//   - articles/<slug>.md  (Zenn 投稿対象)
//   - qiita/<slug>.md     (Qiita 投稿対象)
//   をチェックして Critical があれば exit 1。
//   _drafts/ 配下は警告のみで exit には影響させない（執筆中だから）。
//
// チェック項目:
//   1. frontmatter 必須フィールド
//   2. SEO: タイトル長 / topics or tags 数 / 本文長 / 外部リンク有無
//   3. Secret スキャン: API key, JWT, DB URL, 個人情報パターン
//   4. クロスポスト: canonical 注記の有無（warn）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const ALLOWED_EMAIL = 'cosoadooo@gmail.com';

// 既知の secret/PII パターン（誤検出より見落とし防止優先）
const SECRET_PATTERNS = [
  { name: 'AWS Access Key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS Secret Access Key', re: /aws_secret_access_key\s*[:=]\s*['"][^'"]+['"]/i },
  { name: 'GitHub Personal Access Token', re: /\bghp_[A-Za-z0-9]{36,}\b/ },
  { name: 'GitHub OAuth Token', re: /\bgho_[A-Za-z0-9]{36,}\b/ },
  { name: 'GitHub Server Token', re: /\bghs_[A-Za-z0-9]{36,}\b/ },
  { name: 'GitHub Refresh Token', re: /\bghr_[A-Za-z0-9]{36,}\b/ },
  { name: 'GitHub User Token', re: /\bghu_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack Token', re: /\bxox[abopr]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe Live Key', re: /\b(sk|pk|rk)_live_[A-Za-z0-9]{20,}\b/ },
  { name: 'Stripe Test Key', re: /\b(sk|pk|rk)_test_[A-Za-z0-9]{20,}\b/ },
  { name: 'Google API Key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Postgres URL', re: /postgres(?:ql)?:\/\/[^\s'")]+/i },
  { name: 'MySQL URL', re: /mysql:\/\/[^\s'")]+/i },
  { name: 'MongoDB URL', re: /mongodb(?:\+srv)?:\/\/[^\s'")]+/i },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'Bearer token (40+ hex)', re: /Bearer\s+[a-f0-9]{40,}/i },
  { name: 'Generic 40+ hex (likely token)', re: /\b[a-f0-9]{40,}\b/ },
  { name: 'Supabase service_role key', re: /\bSUPABASE_SERVICE_ROLE_KEY\s*=\s*[A-Za-z0-9._-]+/ },
  { name: 'Qiita token literal', re: /\bQIITA_TOKEN\s*=\s*[A-Za-z0-9_-]+/ },
];

// PII（許可ペンネーム/メール以外）
const PII_PATTERNS = [
  { name: 'Email (other than allowed)', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, allowList: [ALLOWED_EMAIL] },
  { name: 'Phone-like (JP)', re: /\b0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}\b/ },
];

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: null, body: raw };
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

function listMarkdown(dir, includeSubdirs = false) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (includeSubdirs) stack.push(p);
        continue;
      }
      if (ent.isFile() && ent.name.endsWith('.md')) out.push(p);
    }
  }
  return out;
}

function checkSecrets(text, addIssue) {
  for (const { name, re } of SECRET_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    // git SHA (40 hex) は記事中に SHA pinning 例として出るため、明確に branded な秘密以外は MAJOR
    const level = name.startsWith('Generic ') ? 'MAJOR' : 'CRITICAL';
    addIssue(level, `Secret pattern detected: ${name} → "${m[0].slice(0, 24)}…"`);
  }
  for (const { name, re, allowList } of PII_PATTERNS) {
    if (re.flags.includes('g')) {
      const matches = text.match(re) || [];
      for (const m of matches) {
        if (allowList && allowList.includes(m)) continue;
        addIssue('CRITICAL', `PII pattern detected: ${name} → "${m}"`);
      }
    } else {
      const m = text.match(re);
      if (m) {
        if (allowList && allowList.includes(m[0])) continue;
        addIssue('CRITICAL', `PII pattern detected: ${name} → "${m[0]}"`);
      }
    }
  }
}

function checkZennFrontmatter(meta, body, addIssue) {
  if (!meta) return addIssue('CRITICAL', 'Missing frontmatter');
  const required = ['title', 'emoji', 'type', 'topics', 'published'];
  for (const k of required) {
    if (meta[k] === undefined) addIssue('CRITICAL', `Missing frontmatter field: ${k}`);
  }
  if (meta.type && !['tech', 'idea'].includes(meta.type)) {
    addIssue('CRITICAL', `Invalid type "${meta.type}" (must be tech|idea)`);
  }
  if (meta.title) {
    const len = [...meta.title].length;
    if (len > 70) addIssue('MAJOR', `Title is ${len} chars (>70 hurts SERP truncation)`);
    if (len < 15) addIssue('MAJOR', `Title is ${len} chars (<15 lacks SEO keywords)`);
  }
  if (meta.topics) {
    const t = Array.isArray(meta.topics) ? meta.topics : [];
    if (t.length === 0) addIssue('MAJOR', 'topics is empty (lose tag-based discovery)');
    if (t.length > 5) addIssue('CRITICAL', `topics has ${t.length} items (Zenn limit is 5)`);
  }
  if (meta.emoji) {
    const eLen = [...meta.emoji].length;
    if (eLen !== 1) addIssue('MAJOR', `emoji should be a single char, got "${meta.emoji}"`);
  }
}

function checkQiitaFrontmatter(meta, body, addIssue) {
  if (!meta) return addIssue('CRITICAL', 'Missing frontmatter');
  const required = ['title', 'tags', 'published'];
  for (const k of required) {
    if (meta[k] === undefined) addIssue('CRITICAL', `Missing frontmatter field: ${k}`);
  }
  if (meta.title) {
    const len = [...meta.title].length;
    if (len > 70) addIssue('MAJOR', `Title is ${len} chars (>70 hurts SERP truncation)`);
    if (len < 15) addIssue('MAJOR', `Title is ${len} chars (<15 lacks SEO keywords)`);
  }
  if (meta.tags) {
    const t = Array.isArray(meta.tags) ? meta.tags : [];
    if (t.length === 0) addIssue('MAJOR', 'tags is empty (lose Qiita tag-based discovery)');
    if (t.length > 5) addIssue('CRITICAL', `tags has ${t.length} items (Qiita limit is 5)`);
  }
}

function checkSeoBody(body, addIssue) {
  const len = [...body].length;
  if (len < 1500) addIssue('MAJOR', `Body is ${len} chars (<1500 typically too thin for technical SEO)`);
  if (len > 15000) addIssue('MINOR', `Body is ${len} chars (>15000 may dilute focus, consider splitting)`);
  const h2Count = (body.match(/^##\s+/gm) || []).length;
  if (h2Count < 2) addIssue('MAJOR', `Only ${h2Count} H2 heading (need at least 2 for structure & TOC)`);
  // 開きの ``` のみを対象に「言語指定なし」を検出する（閉じの ``` を誤検出しないよう state machine）
  let inBlock = false;
  let bareOpeners = 0;
  for (const line of body.split('\n')) {
    const m = line.match(/^```(\S*)\s*$/);
    if (!m) continue;
    if (inBlock) {
      inBlock = false;
    } else {
      if (!m[1]) bareOpeners++;
      inBlock = true;
    }
  }
  if (bareOpeners > 0) addIssue('MAJOR', `${bareOpeners} code block(s) without language hint`);
  const externalLink = /\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(body);
  if (!externalLink) addIssue('MAJOR', 'No external links (cite official docs / sources for credibility)');
  // canonical / cross-post note
  const hasCanonicalNote = /(本記事は|cross-?post|canonical|同時掲載)/i.test(body);
  if (!hasCanonicalNote) addIssue('MINOR', 'No canonical / cross-post note found (recommended for SEO when cross-posting)');
}

// 2026-06-07: Qiita が `supabase-cli-db-push-migration-flow` を spam 判定 (非公開化) +
// `3-matching-apps-one-codebase` の PATCH が CloudFront WAF で 403 ブロック。
// 共通原因は記事末尾の「自社プロダクト宣伝リンク羅列フッター」。 Qiita ガイドラインで
// 明確に spam 対象とされているため、ここで CRITICAL として弾く。
//
// 検出ルール:
//   1. 本文中の Cosoado-lab subdomain への [text](url) リンクが 2 個以上
//   2. 末尾 1/3 範囲に Cosoado-lab subdomain への [text](url) リンクが 1 個以上
//      (技術記事に対する promo footer の典型パターン)
//   3. 「Cosoado Lab が開発中」「個人開発スタジオ」等の自己紹介行 + 直後に link list
//
// canonical note 1 行 (記事本文版へのリンク) は許容する。
function checkPromoFooter(body, addIssue) {
  // 1 行の canonical note (> Cosoado Lab Blog 同時掲載 …) は許容する。
  // それ以外で cosoado-lab subdomain への markdown link を全数検出。
  const PROMO_HOST_RE = /\[([^\]]+)\]\(https?:\/\/(?:[a-z0-9-]+\.)?cosoado-lab\.com[^)]*\)/g;
  const matches = [...body.matchAll(PROMO_HOST_RE)];
  if (matches.length === 0) return;

  // canonical / blockquote 内のリンクは除外 (> で始まる行)
  const bodyLines = body.split('\n');
  const lineIndexOf = (offset) => body.slice(0, offset).split('\n').length - 1;
  const nonQuotedLinks = matches.filter(m => {
    const lineIdx = lineIndexOf(m.index);
    return !/^>\s/.test(bodyLines[lineIdx] || '');
  });

  if (nonQuotedLinks.length >= 2) {
    addIssue('CRITICAL',
      `Promotional pattern: ${nonQuotedLinks.length} links to cosoado-lab.com in body. ` +
      `Qiita flags self-promo link lists as spam (incident: 2026-06-07). Use a single canonical ` +
      `blockquote (> ...) at the top instead, and remove product lists from the body.`);
    return;
  }

  // 末尾 1/3 にあるリンクは promo footer の典型 → MAJOR
  const bodyLen = body.length;
  const tailStart = Math.floor(bodyLen * 2 / 3);
  const tailLink = nonQuotedLinks.find(m => m.index >= tailStart);
  if (tailLink) {
    addIssue('CRITICAL',
      `Promo footer detected: cosoado-lab.com link "${tailLink[1]}" in last 1/3 of article. ` +
      `Move to a canonical blockquote at the top, or remove entirely. ` +
      `(Qiita spam incident: 2026-06-07)`);
  }
}

function validateFile(fpath, kind, isDraft) {
  const issues = [];
  const addIssue = (level, msg) => issues.push({ level, msg });
  const raw = fs.readFileSync(fpath, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  checkSecrets(raw, addIssue);
  if (kind === 'zenn') checkZennFrontmatter(meta, body, addIssue);
  if (kind === 'qiita') checkQiitaFrontmatter(meta, body, addIssue);
  checkSeoBody(body || '', addIssue);
  if (kind === 'qiita') checkPromoFooter(body || '', addIssue);
  return { fpath, kind, isDraft, issues };
}

function main() {
  const targets = [
    ...listMarkdown(path.join(REPO_ROOT, 'articles')).map(p => ({ p, kind: 'zenn', isDraft: false })),
    ...listMarkdown(path.join(REPO_ROOT, 'articles', '_drafts')).map(p => ({ p, kind: 'zenn', isDraft: true })),
    ...listMarkdown(path.join(REPO_ROOT, 'qiita')).map(p => ({ p, kind: 'qiita', isDraft: false })),
    ...listMarkdown(path.join(REPO_ROOT, 'qiita', '_drafts')).map(p => ({ p, kind: 'qiita', isDraft: true })),
  ];

  let critical = 0;
  let major = 0;
  let minor = 0;
  let publishCritical = 0;

  for (const { p, kind, isDraft } of targets) {
    const r = validateFile(p, kind, isDraft);
    if (r.issues.length === 0) {
      console.log(`OK  ${path.relative(REPO_ROOT, p)}`);
      continue;
    }
    console.log(`\n== ${path.relative(REPO_ROOT, p)} ${isDraft ? '(draft)' : ''} ==`);
    for (const it of r.issues) {
      console.log(`  [${it.level}] ${it.msg}`);
      if (it.level === 'CRITICAL') {
        critical++;
        if (!isDraft) publishCritical++;
      } else if (it.level === 'MAJOR') major++;
      else minor++;
    }
  }

  console.log(`\nSummary: ${critical} Critical, ${major} Major, ${minor} Minor`);
  console.log(`Published-target Critical: ${publishCritical} (must be 0 to proceed)`);

  // 公開対象 (qiita/ 直下 / articles/ 直下) で Critical があれば fail
  if (publishCritical > 0) process.exit(1);
}

main();
