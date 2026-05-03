# 記事レビューチェックリスト（自動投稿前必須・100/100 基準）

合格ライン: **100/100 + Critical/Major/Minor 全 0**

## 0. 絶対条件（1 つでも該当 = 公開禁止）

- [ ] secrets リテラル一切なし（AWS key / GitHub token / Slack / Stripe / DB URL / JWT / Bearer）
- [ ] cosoadooo@gmail.com 以外のメール・電話番号なし
- [ ] 本体 private repo の内部仕様露出なし
- [ ] 全数値・API 仕様を公式 docs で照合済み（事実誤認ゼロ）
- [ ] 競合・他社サービスへの誹謗中傷なし
- [ ] frontmatter 完全（Zenn: title/emoji/type/topics/published, Qiita: title/tags/published）
- [ ] `_drafts/` に置く間は published: false

## 1. スコア配分（合計 100 点）

| カテゴリ | 配点 | チェック内容 |
|---|---|---|
| 技術正確性 | 20 | コード動作・API バージョン・概念正確性 |
| 秘密・個人情報 | 20 | `node scripts/validate-articles.mjs` で 0 Critical |
| **人間味・オーセンティシティ** | **15** | 一次体験の描写 / 失敗開示 / AI 臭い表現ゼロ |
| 読みやすさ・構成 | 15 | H2 2+ / 全 code block 言語指定 / 表・リスト |
| トピック粒度 | 10 | 1 投稿 1 トピック / 想定読者明示 / 2,000〜4,000 字 |
| SEO・タイトル | 10 | 30〜60 字 + キーワード / topics 5 / 外部リンク 1+ |
| 誇大表現排除 | 5 | 数値の根拠あり / 文脈依存性に言及 |
| ライセンス・引用 | 5 | 引用元 URL 明記 |

## 2. 人間味（最重要・15 点）の詳細

### 2-1. 一次体験の描写（6 点）
具体的な状況・時間・感情が 1 箇所以上必須。
- ✅ 例: 「火曜の夜、湿布の匂いの中で...」「profiles が 5,000 件超えたあたりから p95 が 200ms 超えてきて...」
- ❌ 例: 「アプリで使うことが多い」「一般的によくある問題」（抽象的すぎ）

### 2-2. 失敗・後悔の正直な開示（4 点）
自分が実際にハマった失敗を 1 個以上明記。
- ✅ 例: 「これが一番やった失敗です」「先に気づくべきだった」
- ❌ 例: 「ハマる人もいるかもしれません」（他人事）

### 2-3. AI 臭い表現の不在（5 点）
以下が 1 つでもあれば減点。3 件以上で 0 点。
- 「本記事では〜について解説します」
- 「〜について見ていきましょう」「いかがでしたか」
- 「〜してみましょう」「〜してみてください」を 3 回以上
- 形容詞「素晴らしい」「便利な」「強力な」の乱用
- 必要ないのに H2 で「概要」「メリット」「デメリット」を機械的に並べる
- 結論ありきの優等生的な文体

## 3. 公開フロー

```
[執筆] articles/_drafts/<slug>.md または qiita/_drafts/<slug>.md
   ↓
[validator] node scripts/validate-articles.mjs → 0 Critical
   ↓
[自己レビュー] 上記基準で採点 → 100/100
   ↓
[昇格] _drafts/ → 直下に mv + published: true に変更
   ↓
[再 validator] → 0 Critical
   ↓
[push] git commit + git push
   ↓
[公開]
  Zenn: 数秒で https://zenn.dev/cosoado/articles/<slug>
  Qiita: GHA cron で翌 10:00 JST、または gh workflow run で即時
```

## 4. 100/100 取れないとき

- `_drafts/` に置いたまま commit せず終了
- 修正案を `_drafts/<slug>.review.md` に書き残す（任意）
- 当日は無投稿で OK（無理に出さない）
