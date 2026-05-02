# 記事執筆テンプレート（SEO・セキュリティ対策込み）

このドキュメントは Zenn / Qiita 記事を執筆する際の SEO・セキュリティチェックリストです。
全ての記事はこのテンプレートに沿って書かれ、`scripts/validate-articles.mjs` のチェックを通る必要があります。

---

## 1. タイトル設計（SERP 最適化）

| 観点 | 基準 |
|---|---|
| 文字数 | 30〜60 字（70 字超は SERP で truncate） |
| 構造 | `[キーワード] × [価値訴求] × [数字]` |
| 例 | ✅ "Vercel で同じ GitHub repo を 4 プロジェクトに紐付けてジャンル別ビルドする" |
|  | ❌ "私のスタックの話"（抽象的、検索 1 件もヒットしない） |

## 2. frontmatter テンプレート

### Zenn (`articles/<slug>.md`)
```yaml
---
title: "30〜60 字のタイトル"
emoji: "🎯"        # 1 文字の絵文字必須
type: "tech"       # tech または idea
topics: ["nextjs", "supabase", "vercel", "個人開発", "マルチテナント"]   # 1〜5
published: false   # レビュー合格まで false
---
```

### Qiita (`qiita/<slug>.md`)
```yaml
---
title: "30〜60 字のタイトル"
tags: ["Next.js", "Supabase", "Vercel", "個人開発", "マルチテナント"]   # 1〜5、大文字小文字を canonical 名に揃える
published: true    # GHA cron が拾う条件
qiita_id:          # 投稿後にスクリプトが自動で書き戻す
qiita_url:
---
```

## 3. 本文の構造（SEO・読了率の両立）

```
1. リード（3〜5 行） — 想定読者と「読んだら何が分かるか」を 1 文で
2. TL;DR（任意） — 結論を最初に
3. 背景・課題（1〜2 段落）
4. 解決策（コード + 解説） — 必ずコードブロックに言語指定
5. 結果・効果 — 定量値があれば具体数字、なければ「体感」と明記
6. はまりどころ（あれば）
7. まとめ + 次に読むと良い記事への内部リンク
8. canonical / cross-post 注記（クロスポスト時のみ）
```

### 必須要素（validator が検査）
- [ ] 本文 1,500〜15,000 字（理想は 2,000〜6,000 字）
- [ ] H2 見出しが 2 個以上
- [ ] 全コードブロックに言語指定（` ```ts ` 等）
- [ ] 公式ドキュメントへの外部リンク 1 件以上
- [ ] cross-post 時は canonical 注記必須

## 4. クロスポスト戦略（重複コンテンツ回避）

```
[原本] Zenn (technical audience)
  ↓ canonical URL を共有
[syndication] Qiita ─→ 冒頭に "本記事は Zenn で先に公開しています: <Zenn URL>"
[syndication] cosoado-lab.com/blog ─→ <link rel="canonical" href="<Zenn URL>">
```

### クロスポスト用の冒頭注記スニペット

**Qiita 後発の場合（Zenn が原本）**:
```markdown
> 本記事は Zenn で先に公開しています: https://zenn.dev/cosoado/articles/<slug>
> Qiita 版は同じ内容を、Qiita 検索ユーザー向けに転載したものです。
```

**Zenn 後発の場合（Qiita が原本）**:
```markdown
:::message
本記事は Qiita で先に公開しています: https://qiita.com/Cosoado/items/<id>
:::
```

## 5. セキュリティチェック（投稿前の自己点検）

`validate-articles.mjs` で自動検出される項目：

- [ ] secrets リテラル（AWS / GitHub / Stripe / Supabase / Postgres URL / JWT 等）が**コードブロックに含まれていない**
- [ ] `process.env.X` または `<YOUR_TOKEN>` 等の placeholder のみ使用
- [ ] cosoadooo@gmail.com 以外のメールアドレスを露出していない
- [ ] 電話番号らしきパターンを露出していない
- [ ] 40 文字以上の hex 連続（git SHA の引用以外）を含んでいない

git SHA を SHA pinning の例として引用する場合は、コードブロック内で文脈を明確に示す（validator は MAJOR で警告のみ）。

## 6. 内部リンク戦略（domain authority）

各記事は次のリンクを持つことを推奨：

1. **公式ドキュメントへの外部リンク**（信頼性シグナル）: 必ず 1 件以上
2. **同シリーズの関連記事**（滞在時間延長）: 直前 / 直後の関連記事へ 1〜2 件
3. **cosoado-lab.com への遷移**（ドメイン強化）: フッター / 著者プロフィール経由

## 7. トピック粒度の指針（オーナー方針）

> 「なるべく 1 回の投稿に詰めすぎず、部分部分で部分部分の技術にフォーカスしてトピック化」

- 1 記事 = 1 つのコア技術トピック
- 5 トピックを混ぜたら 5 記事に分割
- "全部入り" 概要記事は、小粒記事を 5 本以上書いた後に「概要 + 個別記事へのリンク集」として最後に書く

## 8. レビュー部門との連動

- 執筆後は `articles/_drafts/` または `qiita/_drafts/` に配置
- `.company/reviews/rubrics/article-review.md` で採点
- **100/100 + Critical/Major/Minor 全 0** で初めて `articles/` または `qiita/` 直下に昇格
- レビューレポートは `.company/reviews/reports/article-<slug>-YYYY-MM-DD.md` に保存

## 9. 投稿後の運用

- Qiita: GHA cron が翌 10:00 JST に自動投稿し、qiita_id を frontmatter に書き戻す
- Zenn: main へ push した瞬間に Zenn 連携で公開（数秒以内）
- 修正は `_drafts/` に戻さず、直下のファイルを編集して push
  - Zenn: 即時反映
  - Qiita: GHA 翌実行時に PATCH（qiita_id 一致時）
