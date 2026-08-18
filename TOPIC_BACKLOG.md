# 記事トピックバックログ（自動執筆エージェント用）

執筆エージェントは、ここから 1 つを選んで記事化する。

**重複防止ルール**: 既に `articles/` または `qiita/` (もしくは `_drafts/`) に存在する slug のトピックは絶対に再選しない。

---

## Zenn 用（深め技術系）

| slug | トピック | フォーカス |
|---|---|---|
| `supabase-pooler-url-migration-vs-runtime` | Supabase の pooler URL を migration / runtime で使い分ける運用 | DB 接続 |
| `nextjs-app-router-dynamic-og-image-by-genre` | App Router で動的 OG 画像をジャンル別に生成する | 画像生成 |
| `vercel-cron-jobs-aggregate-daily-metrics-email` | Vercel Cron Jobs で日次メトリクスメールを 1 つの Hobby プロジェクトに集約 | cron |
| `supabase-auth-magic-link-with-resend` | Supabase Auth の magic link を Resend に差し替える | auth |
| `pg-policies-rls-audit-query` | pg_policies で RLS を一括棚卸する 1 行クエリ | RLS |
| `supabase-rls-with-check-vs-using-pitfall` | Supabase RLS で WITH CHECK と USING を間違えてハマる話 | RLS |
| `vercel-build-cache-not-shared-across-projects` | Vercel の build cache がプロジェクト間で共有されない話と回避策 | build |
| `nextjs-env-var-genre-config-pattern` | Next.js で env var 1 つで配色・言語・機能を切り替える設計 | 設計 |
| `gha-cron-jitter-idempotent-slots` | GitHub Actions cron の遅延 (30〜90 分) を前提に「1 スロット 3 発」撃って冪等に 1 回だけ実行する | CI |
| `smooth-weighted-round-robin-rotation` | 重み付きローテで同じ項目を連続させない平滑化 (nginx の smooth weighted round-robin) | アルゴリズム |
| `wcag-contrast-gate-in-generated-images` | 生成した OGP / SNS 画像のコントラスト比を出力前に検証して、割ったら生成を落とす | 画像生成 |
| `supabase-cross-schema-read-from-one-deploy` | 1 デプロイから全テナントスキーマを読む集約バッチの組み方と権限設計 | DB |

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
| `meta-graph-long-lived-token-expiry-ops` | Instagram / Threads の長期トークン失効を検知して定期投稿を落とさない運用 | API |
| `x-api-402-payment-required-triage` | X API が 402 Payment Required を返すときの切り分け手順 | API |
| `pillow-hiragino-social-card-generator` | Pillow + macOS 同梱ヒラギノで SNS カードを追加コスト 0 で生成する | 画像生成 |

---

## 選定基準

1. **既出 slug 除外**: `ls articles/ articles/_drafts/ qiita/ qiita/_drafts/` で確認
2. **公式 docs で事実確認可能**: WebFetch で verify できるトピックを優先
3. **1 記事 1 トピック特化**: 詰め込みすぎない
4. **個人開発者向け**: ターゲット読者の解像度が高いもの

## 追加方針

このバックログは適宜追加・整理される。ネタ切れになったら、エージェントは「該当なし」として無投稿で終了し、報告に「バックログ追加が必要」と書く。

## 補充履歴

- 2026-08-18: 初版 16 件が全て公開済み（ネタ切れ）になっていたため 8 件補充。
  執筆が 2026-06-29 で止まっていた直接の原因はバックログの枯渇で、
  仕組みの故障ではない。以後もここが空になったら同じ止まり方をする。
