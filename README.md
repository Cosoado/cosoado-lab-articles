# Cosoado Lab Articles

Zenn / Qiita 等の外部技術ブログ向け記事ソース。
**このリポジトリには Cosoado Lab のプロダクト・サービスのソースコードは含まない**。
記事 markdown と画像のみを管理する独立リポジトリ。

## なぜ独立リポジトリなのか

- 本体プロダクト (`matching-app-template` 他) は private で、外部連携サービスに pull 権限を与えたくない
- 記事用フォルダだけを Zenn / Qiita に渡せば、本体ソースは完全に隔離される
- 公開・非公開の判断ミスでソース流出する事故を構造的に防ぐ
- このリポジトリは公開（public）。本体は引き続き private のまま

## ディレクトリ構成

```
cosoado-lab-articles/
├── articles/                # Zenn 連携用（Zenn が main から自動取得）
│   ├── _drafts/            # 執筆中・レビュー前の下書き（Zenn は published: false で無視）
│   └── <slug>.md           # レビュー合格済み記事
├── qiita/                   # Qiita 用（GHA cron で API 投稿）
│   ├── _drafts/            # 執筆中・レビュー前の下書き
│   └── <slug>.md           # レビュー合格済み記事（投稿後 frontmatter に qiita_id が付く）
├── scripts/
│   └── post-to-qiita.mjs   # Qiita API 投稿スクリプト
├── .github/workflows/
│   └── qiita-publish.yml   # 毎日 10:00 JST に新規記事をチェックして投稿
└── README.md
```

## Zenn 連携（1 度だけ設定）

1. [Zenn](https://zenn.dev/) にログイン
2. ダッシュボード → **GitHub からのデプロイ** → **連携リポジトリを追加**
3. リポジトリ `Cosoado/cosoado-lab-articles` を選択
4. 連携対象ブランチ: `main`
5. `articles/` 直下の `published: true` ファイルが自動公開される

## Qiita 連携（1 度だけ設定）

1. [Qiita 設定 → アプリケーション](https://qiita.com/settings/applications) で個人用アクセストークンを発行
   - スコープ: **read_qiita** + **write_qiita**
2. GitHub の `Settings → Secrets and variables → Actions` で `QIITA_TOKEN` を追加
3. 以降は `qiita/<slug>.md` (published: true) を main に push するだけで GHA が翌日投稿

## Zenn 記事 frontmatter

```yaml
---
title: "記事タイトル"
emoji: "🎯"
type: "tech"           # tech (技術) or idea (アイデア)
topics: ["nextjs", "supabase"]   # 5 個まで
published: false       # true で公開、false で下書き
---
```

## Qiita 記事 frontmatter

```yaml
---
title: "記事タイトル"
tags: ["Next.js", "Supabase", "個人開発"]   # Qiita のタグは大文字小文字区別あり
published: true        # 自動投稿対象にする場合 true
qiita_id:              # 投稿後にスクリプトが自動で書き戻す
qiita_url:             # 投稿後にスクリプトが自動で書き戻す
---
```

## 公開フロー（自動化）

```
[執筆] articles/_drafts/<slug>.md または qiita/_drafts/<slug>.md
   ↓
[レビュー] .company/reviews/rubrics/article-review.md で採点
   ↓
[100/100 合格時のみ] _drafts/ から直下へ git mv
   ↓
[自動公開]
  Zenn  → main に push → 数秒で公開
  Qiita → 翌 10:00 JST に GHA が API POST（1 回 1 件まで安全策）
```

## 撤回・更新

- `published: false` に戻して push → Zenn 側で「下書き」状態に戻る（Qiita は手動非公開）
- 本文修正 + push → Zenn は更新即反映、Qiita は qiita_id がある場合のみ PATCH

## ローカルプレビュー（任意）

```bash
npx zenn preview
```

## 記事の単位ルール

オーナー方針: **1 投稿 1 技術トピック**。詰めすぎず、部分部分で部分部分の技術にフォーカスする。

## 自動執筆エージェント

スケジュールプロンプトの正規ソースは [SCHEDULED_PROMPT.md](./SCHEDULED_PROMPT.md)（媒体別の索引）。
Zenn と Qiita は別スケジュールで並行稼働するため、投稿前に必ず次のゲートを通す。

```bash
node scripts/check-publish-window.mjs --platform <zenn|qiita>
```

## 投稿頻度とトピック選定

**[PUBLISHING_POLICY.md](./PUBLISHING_POLICY.md) が正典。自動執筆エージェントは執筆前に必ず読む。**

要約:

- **頻度**: Zenn 週 1 本（最大週 2）。中 3 日以上空ける。1 実行 1 本。Zenn と Qiita の同日投稿は禁止
- **凍結リスクの主因は頻度ではなく内容**（2026-06-07 の Qiita spam 判定は宣伝リンク羅列が原因）
- **枯渇監視**: バックログ残 3 本以下で警告、0 本で執筆せず通知して終了（2026 年夏の 51 日停止の再発防止）
- **トピック**: 一次体験 4 / 検索需要 3 / 鮮度 3 で採点し 7 点以上を採用。**一次体験 0 点は即却下**
- **情報源**: この環境から到達できるのは実質 github.com のみ（zenn.dev / qiita.com / 各製品公式ドキュメントは egress ブロック）
