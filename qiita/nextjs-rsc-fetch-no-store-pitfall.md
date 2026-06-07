---
title: "Next.js App Router: fetch に no-store を設定しないと静かに古いデータが出る理由"
tags: ["Next.js", "AppRouter", "fetch", "キャッシュ", "個人開発"]
published: true
qiita_id: "4a5c61d2ae5de57659df"
qiita_url: "https://qiita.com/Cosoado/items/4a5c61d2ae5de57659df"
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/nextjs-rsc-fetch-no-store-pitfall/

## TL;DR

Next.js 14 以前の App Router では `fetch()` が **`force-cache` をデフォルト** として使う。意識せずに `fetch` しているとビルド時のデータを延々と返し続け、エラーも警告も出ない。解決は `{ cache: 'no-store' }` の明示指定。ただし `no-cache` との混同に注意。

---

## 深夜に気づいた「何もしていないのに壊れている」状態

NetaPair のお笑いマッチング機能に「直近に登録したユーザー一覧」を追加した翌日、本番確認をしていたときのことです。ステージングでは確かに動いていた。でも本番は空のまま。スマホで見ても、4G に切り替えてもおなじ。ブラウザの DevTools のネットワークパネルを開くと `200 OK` は返っているのに、ペイロードが空の配列。

Vercel のビルドログは全プロジェクト分とも緑。デプロイは成功している。

「え、なんで？」と 2 時間ほど調べて、ようやく気づいた。**問題はブラウザやネットワークではなく、Next.js が内部でかけている fetch キャッシュだった。**

データ取得のコードはこうだった。

```ts
// app/matches/page.tsx
async function getRecentMatches() {
  const res = await fetch(`${process.env.API_BASE_URL}/api/matches/recent`);
  if (!res.ok) throw new Error('fetch failed');
  return res.json();
}
```

`fetch` に何も渡していない。これが原因の全てだった。

## Next.js 14 の fetch は「デフォルトでキャッシュ済み」として動く

App Router の Server Component 内では、Node 標準の `fetch` を Next.js が独自にパッチしている。**何も指定しないと `cache: 'force-cache'` として扱われ**、最初のリクエスト時のレスポンスが Data Cache に保存される。

```ts
// 以下の 2 つは Next.js 14 では同じ挙動
const res1 = await fetch('https://api.example.com/data');
const res2 = await fetch('https://api.example.com/data', { cache: 'force-cache' });
```

一度キャッシュされると、**再デプロイしても、時間が経っても、同じデータが返り続ける**。`revalidateTag` や `revalidatePath` を呼ぶか、`revalidate` の時間が切れるまで新しいデータは取得されない。

この挙動はエラーを出さない。警告も出さない。ただ静かに古いデータを返すだけ。静的コンテンツには理想的だが、ユーザーごとに変わるデータや「投稿直後に反映したい」データには致命的な設定だ。

参照: [Next.js 14 Caching ドキュメント (GitHub)](https://github.com/vercel/next.js/tree/v14.2.29/docs/02-app/01-building-your-application/04-caching)

## no-store と no-cache: 似ているが別物

最初の失敗がここだった。「`cache: 'no-cache'` にすれば毎回取りに行くのでは？」と考え、`no-cache` を指定してデプロイした。しかし一覧は依然として更新されなかった。

原因は HTTP の仕様上の違いにある。

| オプション | キャッシュへの保存 | 使用前のサーバー再検証 | 実際の動作 |
|---|---|---|---|
| `force-cache` | する | しない | 永久キャッシュ（変更なし） |
| `no-cache` | する | 毎回する | 保存はするが使用前に必ずサーバーと照合 |
| `no-store` | しない | しない | キャッシュを一切使わず毎回フレッシュ取得 |

`no-cache` は「キャッシュに保存した上で、毎回サーバーに確認してから使う」という意味だ。**キャッシュへの保存自体は行われる**。Next.js の Data Cache 実装ではこの挙動が意図通りに効かないケースもあり、結局 `no-store` にしなければ問題は解消しなかった。

`no-store` は「キャッシュに保存しない、使わない」の一択。毎回 origin にリクエストが飛ぶ。

## 修正: 動的データには no-store を明示する

```ts
// app/matches/page.tsx
async function getRecentMatches() {
  const res = await fetch(`${process.env.API_BASE_URL}/api/matches/recent`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('fetch failed');
  return res.json();
}
```

これだけで、デプロイ後に一覧が正しく最新データを返すようになった。

### データの性質ごとの使い分け

| データの性質 | 推奨オプション | 具体例 |
|---|---|---|
| 毎リクエスト最新が必要 | `cache: 'no-store'` | マッチング一覧、ユーザー設定 |
| 数分〜数時間で更新でよい | `next: { revalidate: N }` | ブログ記事、商品在庫 |
| ビルド時に確定する | `cache: 'force-cache'` | 静的ページ、マーケティングコンテンツ |

ISR スタイルで更新頻度を制御するなら `next.revalidate` が使いやすい。

```ts
// 5 分ごとに再取得（それまでは古いデータを返してよい場合）
const res = await fetch('https://api.example.com/data', {
  next: { revalidate: 300 },
});
```

### ページ全体を動的にする場合

コンポーネント内のすべての fetch に `no-store` を付けて回るのが大変なら、ルートセグメント設定で一括指定できる。

```ts
// app/matches/page.tsx の先頭に追加
export const dynamic = 'force-dynamic';
```

これで当該ページの fetch が全て動的扱いになる。ただし Partial Prerendering が無効になるなど、パフォーマンス面での副作用は把握しておく必要がある。

## Next.js 15 での変更点

Next.js 15 でこの問題は構造的に緩和された。[v15.0.0 のリリースノート](https://github.com/vercel/next.js/releases/tag/v15.0.0) に "Breaking: Disable automatic fetch caching" として記載されており、**`fetch` の自動キャッシュが無効化**されデフォルトが非キャッシュ寄りに変更された。

つまり v15 では「何も指定しない fetch」が毎回 origin にリクエストを投げるようになる。古いデータが出にくくなった点ではいいが、v14 で意図的に `force-cache` に頼っていたコードはパフォーマンスが下がる。

v14 → v15 の移行では、`cache` オプションを明示していない fetch を洗い出し、意図に合わせて `force-cache` / `no-store` / `revalidate` を明示的に書くのが最も安全だ。バージョンに依存しない設計になる。

## まとめ

- Next.js 14 以前の App Router では `fetch` はデフォルトで `force-cache`（ビルド時キャッシュ）
- 動的データには必ず `{ cache: 'no-store' }` を明示する
- `no-cache` と `no-store` は別物。「毎回フレッシュに取得する」なら `no-store`
- ページ全体を動的にするなら `export const dynamic = 'force-dynamic'` が手軽
- Next.js 15 ではデフォルトが変わったが、明示的な指定でバージョン非依存な設計にする方が堅牢
