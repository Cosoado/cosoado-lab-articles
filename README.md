# Cosoado Lab Articles

Zenn / Qiita 等の外部技術ブログ向け記事ソース。
**このリポジトリには Cosoado Lab のプロダクト・サービスのソースコードは含まない**。
記事 markdown と画像のみを管理する独立リポジトリ。

## なぜ独立リポジトリなのか

- 本体プロダクト (`matching-app-template` 他) は private で、外部連携サービスに pull 権限を与えたくない
- 記事用の `articles/` フォルダだけを Zenn に渡せば、本体ソースは完全に隔離される
- 公開・非公開の判断ミスでソース流出する事故を構造的に防ぐ

## ディレクトリ構成

```
cosoado-lab-articles/
├── articles/          # Zenn 記事 (1 ファイル = 1 記事)
│   └── *.md           # frontmatter 必須
├── books/             # (今後使う場合) Zenn の本
└── README.md
```

## Zenn 連携セットアップ (1 度だけ)

1. [Zenn](https://zenn.dev/) でアカウント作成
2. Zenn ダッシュボード → **GitHub からのデプロイ** → **連携リポジトリを追加**
3. リポジトリ `Cosoado/cosoado-lab-articles` を選択
4. 連携対象ブランチ: `main`
5. Zenn が GitHub App 経由で `articles/` フォルダだけを読みに来る (他は触らない)
6. `published: true` のファイルが自動公開される

## 記事フォーマット (frontmatter 必須)

```yaml
---
title: "記事タイトル"
emoji: "🎯"
type: "tech"          # tech (技術) or idea (アイデア)
topics: ["nextjs", "supabase"]   # 5 個まで
published: false      # true で公開、false で下書き
---

(本文 Markdown)
```

## 公開フロー

1. `articles/<slug>.md` を編集 (`published: false` で下書き)
2. プレビュー: `npx zenn preview` (要 zenn-cli)
3. `published: true` に変更
4. `git push origin main` → Zenn 側で数秒以内に公開

## 撤回・更新

- `published: false` に戻して push → Zenn 側で「下書き」状態に戻る
- 本文修正 + push → Zenn 側で更新される (URL は維持される)

## 現在の記事

| ファイル | タイトル | 状態 |
|---|---|---|
| `articles/3-matching-apps-one-codebase.md` | 1 つの env var で 3 つのマッチングアプリを量産した話 | 下書き (published: false) |
