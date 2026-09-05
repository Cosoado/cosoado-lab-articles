# 記事トピックバックログ（自動執筆エージェント用）

執筆エージェントは、ここから 1 つを選んで記事化する。

**先に [PUBLISHING_POLICY.md](./PUBLISHING_POLICY.md) を読むこと。** 投稿頻度の上限・下限と、トピックのスコアリング基準（一次体験 4 / 検索需要 3 / 鮮度 3、7 点以上で採用、一次体験 0 点は即却下）はそちらで定義している。

**重複防止ルール**: 既に `articles/` または `qiita/` (もしくは `_drafts/`) に存在する slug のトピックは絶対に再選しない。

---

## Zenn 用（深め技術系）

初版 11 件は 2026-08-31 の `wcag-contrast-gate-in-generated-images` で全て公開済み。
以下は 2026-09-05 に GitHub release notes から再収集した第 2 期。
**選定理由の軸は「自分が既に書いた記事の前提を壊す変更」**（PUBLISHING_POLICY.md 2-3）。

| slug | トピック | 一次体験の根拠 |
|---|---|---|
| `nextjs16-public-runtime-config-removal` | Next.js 16 で `publicRuntimeConfig` / `serverRuntimeConfig` が削除された。env var 設計をどう移行したか | 既出 `nextjs-env-var-genre-config-pattern` の前提が直撃で壊れた |
| `nextjs16-images-domains-to-localpatterns` | `images.domains` 廃止 → `images.localPatterns` への移行 | 既出 OG 画像記事 2 本の設定が対象 |
| `nextjs16-image-cache-ttl-4h-ogp-stale` | `images.minimumCacheTTL` が 1 分 → 4 時間に変更。OGP 差し替えが反映されない罠 | OGP 生成・差し替えを実運用中 |
| `nextjs16-middleware-to-proxy-migration` | middleware が Proxy API に置き換え。codemod で移行してどこが残るか | App Router を 3 アプリで運用中 |
| `nextjs16-turbopack-default-build-cache` | Turbopack がデフォルト化。build cache の効き方がどう変わったか | 既出 `vercel-build-cache-not-shared-across-projects` の続編 |
| `supabase-data-api-opt-in-new-tables` | 新規 public schema テーブルの Data API 公開が opt-in 化。RLS 運用への影響 | 既出 RLS 記事 3 本の前提に関わる |
| `supabase-pooler-listen-notify-multigres` | Multigres で pooled connection 越しの LISTEN/NOTIFY が通るようになった | 既出 `supabase-pooler-url-migration-vs-runtime` の続編 |

> 出典: [next.js releases](https://github.com/vercel/next.js/releases) / [supabase releases](https://github.com/supabase/supabase/releases)
> 執筆時は該当リリースノートを WebFetch で再確認し、引用元 URL を本文に含める。

## Qiita 用（howto・実装手順系）

### 公開済み（選定禁止）

| slug | 公開日 |
|---|---|
| `github-actions-cron-replace-mac-launchd` | 2026-05-28 |
| `resend-domain-auth-30min` | 2026-06-04 |
| `qiita-zenn-cross-post-canonical` | 2026-06-25 |
| `vercel-env-add-cli-bulk` | 2026-06-11 |
| `supabase-cli-db-push-migration-flow` | 2026-05-14前後 |
| `lucide-react-replace-emoji-icons` | 2026-06-18 |
| `nextjs-rsc-fetch-no-store-pitfall` | 2026-05-19前後 |
| `gh-secret-set-stdin-no-history` | 2026-05-21 |
| `itunes-lookup-api-detect-dead-appstore-id` | 2026-08-19 |

### 未執筆（ここから選ぶ）

| slug | トピック | フォーカス | 根拠トレンド |
|---|---|---|---|
| `nextjs15-fetch-cache-migration` | Next.js 14→15 の fetch キャッシュ破壊的変更と最小移行チェックリスト | App Router | Next.js 15 GA、Qiita で移行記事が急増 |
| `claude-code-personal-dev-loop` | Claude Code で個人開発のコード→レビュー→デプロイを自走させて1ヶ月経った話 | AI/個人開発 | ClaudeCodeタグがQiitaで急増中（2026年最熱） |
| `hono-vercel-edge-api-split` | Next.js から重い API を Hono + Edge Functions に切り出す最小構成 | Edge/API | Hono が Express 後継として急速に普及 |
| `supabase-pgvector-similarity-search` | Supabase pgvector で類似検索を 3 ステップで実装する（embedding 生成→保存→検索） | DB/AI | pgvector × Supabase 組み合わせが個人開発で定番化 |
| `react19-use-hook-suspense` | React 19 の use() フックで Suspense + データ取得コードを半分に削る | React | React 19 stable リリース後の移行需要 |
| `bun-shell-replace-npm-scripts` | npm scripts を Bun Shell に置き換えたら CI のインストールが 40 秒速くなった | Bun | Bun 1.x production 普及、比較記事が人気 |
| `mcp-supabase-claude-code` | Claude Code に自分の Supabase を喋らせる MCP サーバーを 30 分で作る | MCP/AI | MCP が個人開発者にも広がりつつある |
| `gha-claude-api-pr-review` | GitHub Actions + Claude API でプルリクの差分を自動レビューコメントする | AI/CI | AI × CI の自動化がQiitaで連続ヒット |
| `supabase-realtime-presence` | Supabase Realtime Presence で「今オンラインのユーザー」を表示する | Realtime | Supabase Realtime 記事の需要が高い |
| `vercel-speed-insights-lcp-fix` | Vercel Speed Insights で LCP ボトルネックを見つけて 3 秒→1 秒に改善した話 | パフォーマンス | Core Web Vitals × Vercel の組み合わせは安定需要 |

---

## 選定基準

スコアリングの正典は [PUBLISHING_POLICY.md](./PUBLISHING_POLICY.md) 2-2。要約:

1. **既出 slug 除外**: `ls articles/ articles/_drafts/ qiita/ qiita/_drafts/` で確認
2. **一次体験 4 点が必須**: 触ったことのない題材は他が満点でも却下（人間味 15 点に到達できない）
3. **検索需要 3 点**: 破壊的変更・移行・エラー文言など「調べる理由」があるか
4. **鮮度 3 点**: 直近リリース・直近の議論
5. **事実確認は github.com で行う**: zenn.dev / qiita.com / 各製品の公式ドキュメントサイトは egress ブロック済み
6. **1 記事 1 トピック特化**: 詰め込みすぎない

## 追加方針

残スロットが **3 本以下で警告、0 本で執筆せず通知して終了**（PUBLISHING_POLICY.md 1「下限」）。
枯渇を検知したら、GitHub の release notes / trending / 高コメント issue から再収集して補充する。

## 投稿ベストプラクティス（バン対策）

頻度ルールの正典は [PUBLISHING_POLICY.md](./PUBLISHING_POLICY.md) 1。ここは補足のみ。

| ルール | 理由 |
|---|---|
| **週 1 本まで**（中 3 日以上空ける） | 同一アカウントからの短期間連投はスパム検知に引っかかるリスクがある |
| **同じタグを 3 週連続させない** | タグ多様性がアカウントの評価に影響する |
| **文字数は媒体別**（正典: [REVIEW_CHECKLIST.md](./REVIEW_CHECKLIST.md) 1-1） | Zenn 2,000〜4,000 / Qiita 1,500〜3,000。短すぎると低品質判定、長すぎると読了率が落ちる |
| **100/100 + Critical/Major 0 を厳守** | AI 生成っぽい文体が残ると品質フィルタが反応する可能性がある |
| **外部リンク必須（公式 docs 1 件以上）** | リンク構造がない記事はスパムとみなされやすい |

> 曜日について: 実際の公開日は 2026-08-19(水) / 08-24(月) / 08-31(月) / 09-05(土) で固定曜日ではない。
> 曜日は Claude Code の Scheduled Tasks 設定側で決まる。ここで曜日を断定しないこと。

## 補充履歴

- 2026-09-05: 再度ネタ切れ（全 9 件公開済み）のため 10 件補充。
  トレンド分析（WebSearch）を実施し、2026 年 Qiita で急増中の
  ClaudeCode・Hono・Next.js 15・pgvector・MCP タグから選定。
  同時に投稿ベストプラクティスセクションを追加。
- 2026-08-18: 初版 16 件が全て公開済み（ネタ切れ）になっていたため 8 件補充。
  執筆が 2026-06-29 で止まっていた直接の原因はバックログの枯渇で、
  仕組みの故障ではない。以後もここが空になったら同じ止まり方をする。
- 2026-09-05: Zenn 第 1 期 11 件が全て公開済みになったため 7 件補充。
  併せて枯渇の再発防止として PUBLISHING_POLICY.md を新設し、
  残スロット数の監視（3 本以下で警告 / 0 本で停止通知）を必須化した。
  補充ネタは GitHub release notes から収集し、
  「既存記事の前提を壊す変更」を優先する方式に切り替えた。

## 保留（条件が揃うまで書かない）

| slug | トピック | 保留理由 |
|---|---|---|
| `meta-graph-long-lived-token-expiry-ops` | Instagram / Threads の長期トークン失効運用 | 自分のトークンが失効したまま復旧していない。解決していない問題の「対策記事」は一次体験の説得力が出ない |
| `x-api-402-payment-required-triage` | X API の 402 切り分け | 同上。402 の原因が未特定 |

## 却下

| slug | 却下理由 |
|---|---|
| `supabase-cross-schema-read-from-one-deploy` | 公開済みの `vercel-cron-jobs-aggregate-daily-metrics-email` が 1 デプロイからの全スキーマ集約を既に扱っている |
| `pillow-hiragino-social-card-generator` | 単体では目新しさが薄い。`wcag-contrast-gate-in-generated-images` に吸収した |
