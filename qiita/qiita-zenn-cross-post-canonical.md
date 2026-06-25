---
title: "Zenn と Qiita に同じ記事を投稿して canonical を壊さない3つのルール"
tags: ["Zenn", "Qiita", "SEO", "クロスポスト", "個人開発"]
published: true
qiita_id: "4e7353d400340583c007"
qiita_url: "https://qiita.com/Cosoado/items/4e7353d400340583c007"
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/qiita-zenn-cross-post-canonical/

## TL;DR

- Zenn も Qiita も、API / frontmatter で `rel=canonical` を外部 URL に向ける機能を持っていない
- 転載側の記事冒頭に原本 URL を書くことが、現状取れる唯一の現実的な対処
- 自社ブログに掲載するなら `<link rel="canonical">` を HTML head に入れるのが確実な手

---

Zenn と Qiita の両方に記事を出す人向けの話だ。

Cosoado Lab の記事を Zenn と Qiita 両方に出す仕組みを GHA で組んでいたとき、最初の 3 本は canonical の処理を何もせずに両方に投稿してしまっていた。気づいたのは 1 ヶ月後、Google Search Console を開いて「同じ内容の zenn.dev の URL と qiita.com の URL が並んでいる」を見たときだ。どちらも「検出済み・インデックス未登録」でうろうろしていた。Google がどちらを正規版とすべきか判断できていない状態だった。

## canonical URL とは何で、なぜクロスポストで問題になるか

同一内容が複数 URL で存在すると、Google は「どの URL を正式版として評価するか」を自分で決める。そのとき被リンクやクリック率などのシグナルが 2 URL に分散する。最悪のケースでは、両方が互いに重複コンテンツと判定され、どちらも十分なランキングシグナルを受け取れなくなる。

`<link rel="canonical" href="URL">` は HTML `<head>` に置く 1 行で、「この URL が正規版です」と Google に伝えるシグナルだ（参照: [Google Search セントラル — 重複 URL の統合](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)）。転載先の HTML head にこれが入っていれば、転載先のシグナルが指定 URL に集約される。

```html
<link rel="canonical" href="https://zenn.dev/cosoado/articles/my-article" />
```

問題は、Zenn と Qiita のどちらもこれをユーザーが外から設定する手段を提供していない点だ。

## Zenn と Qiita それぞれの canonical の扱い

### Zenn

Zenn の GitHub 連携で使える frontmatter フィールドは `title / emoji / type / topics / published / published_at / publication_name` だ（[zenn-dev/zenn-editor — types.ts](https://github.com/zenn-dev/zenn-editor/blob/main/packages/zenn-model/src/types.ts)）。`canonical_url` フィールドは存在しない。Zenn が記事 HTML に設定する `rel=canonical` は、常に Zenn 自身の URL を指す。frontmatter に `canonical_url: https://...` と書いても、現時点では無視される。

### Qiita

Qiita API v2 の `POST /api/v2/items` で送れるパラメータは `title / body / tags / private / tweet / coediting / group_url_name` だ。`canonical_url` パラメータは存在しない。Qiita の記事 HTML にも `rel=canonical` が自動設定されるが、常に Qiita 自身の URL になる。API から外部の canonical URL を注入する方法はない。

結論として、**Zenn にも Qiita にも、外部 URL を `rel=canonical` として設定する手段が API / frontmatter レベルで存在しない**。

## そこで取れる 3 つの対処

### 1. 投稿前に「どちらが原本か」を決める

後から決めようとすると、Zenn と Qiita がほぼ同時に公開され、どちらが「先発」か曖昧になる。Cosoado Lab では Zenn を原本、Qiita を転載と決め、Zenn に push してから GHA cron で翌日 10:00 JST に Qiita に投稿する順番にした。これだけで「Zenn が先に公開された事実」が Google のクロールタイムラインに残る。

### 2. 転載側の記事冒頭に原本 URL を書く

`rel=canonical` は設定できないが、原本 URL を記事の冒頭テキストに書くことで、クロールボットが転載関係を文脈から判断しやすくなる。**末尾ではなく冒頭に書く**のが重要だ。クローラーが最初に読む位置に置く。

Zenn が原本で Qiita に転載する場合、記事の一行目に：

```markdown
> 本記事は Zenn で先に公開しています: https://zenn.dev/cosoado/articles/<slug>
```

Qiita が原本で Zenn に転載する場合、Zenn の `:::message` ブロックを使う：

```markdown
:::message
本記事は Qiita で先に公開しています: https://qiita.com/Cosoado/items/<id>
:::
```

### 3. 自社ブログに掲載するなら `<link rel="canonical">` を入れる

Zenn・Qiita と違い、自分が管理するブログは HTML を完全に制御できる。ここが `rel=canonical` を確実に設定できる唯一の場所だ。

Next.js App Router の場合：

```tsx
// app/blog/[slug]/page.tsx
export async function generateMetadata(
  { params }: { params: { slug: string } }
): Promise<Metadata> {
  return {
    alternates: {
      canonical: `https://zenn.dev/cosoado/articles/${params.slug}`,
    },
  };
}
```

これで `<head>` に `<link rel="canonical" href="https://zenn.dev/cosoado/articles/<slug>">` が出力される。ブログ経由の流入があっても、シグナルは Zenn の URL に集約される。

## やりがちな落とし穴

**Zenn と Qiita に同じ日に投稿してしまった**のが一番やった失敗だ。記事を書いて「今日中に出したい」と Zenn に push し、直後に GHA の `workflow_dispatch` で Qiita にも投稿した。数秒差で両方が公開され、どちらが先か明確でない状態になった。その後 Google Search Console で確認すると Qiita の URL が canonical として選ばれており、Zenn が「重複」扱いになっていた。技術読者の多い Zenn を優先させたかったが、後から直す手段がない。「原本を先に決め、時間差を作る」の 1 手で防げた話だ。

## まとめ

Zenn と Qiita はどちらも `rel=canonical` を外部 URL に向けるための API / frontmatter フィールドを持っていない。現状できる対処は 3 手だけだ。

1. 投稿前に原本プラットフォームを決め、意図的に時間差を作る
2. 転載側の記事冒頭（末尾ではなく）に原本 URL をテキストで書く
3. 自社ブログに掲載するなら `<link rel="canonical">` を HTML head に入れる

`rel=canonical` のような確実なシグナルは送れないが、これだけで重複コンテンツの評価分散を多少なりとも緩和できる。

---

- SparMate — https://sparmate.cosoado-lab.com
- NetaPair — https://netapair.cosoado-lab.com
- BoardLink — https://boardlink.cosoado-lab.com
- Cosoado Lab — https://cosoado-lab.com
