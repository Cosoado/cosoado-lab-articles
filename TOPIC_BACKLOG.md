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

| slug | トピック | フォーカス |
|---|---|---|
| `github-actions-cron-replace-mac-launchd` | GitHub Actions cron で X bot を 12h ごとに回す（Mac launchd から移行） | CI |
| `resend-domain-auth-30min` | Resend のドメイン認証を 30 分で完了させる手順 | email |
| `qiita-zenn-cross-post-canonical` | Zenn と Qiita のクロスポストで canonical を破綻させない方法 | SEO |
| `vercel-env-add-cli-bulk` | Vercel CLI で env var を一気に設定する小技 | CLI |
| `supabase-cli-db-push-migration-flow` | Supabase CLI で db push 中心のマイグレーション運用 | DB |
| `lucide-react-replace-emoji-icons` | lucide-react で UI から絵文字を排除する一貫したアイコン設計 | UI |
| `nextjs-rsc-fetch-no-store-pitfall` | Next.js App Router で fetch の no-store / force-cache を間違えると静かに古いデータが出る話 | App Router |
| `gh-secret-set-stdin-no-history` | GitHub Secret をシェル履歴に残さず登録する gh CLI のワンライナー | security |
| `itunes-lookup-api-detect-dead-appstore-id` | iTunes Lookup API で LP のストアリンク切れを機械検出する | 運用 |

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

## 補充履歴

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
