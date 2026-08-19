---
title: "LP の「近日公開」はいつ嘘になるか — iTunes Lookup API でストア表記のズレを検出する"
tags: ["iOS", "AppStore", "API", "個人開発", "CI"]
published: true
qiita_id: "867e7fe7998a58a02b15"
qiita_url: "https://qiita.com/Cosoado/items/867e7fe7998a58a02b15"
---

> Cosoado Lab Blog にも同時掲載予定です（公開でき次第このブロックにリンクを追記します）。

自分でアプリの LP を運用している個人開発者向けの話です。

## TL;DR

- リンク切れ検査で見つかるのは「死んだ URL」だけ。LP の**文言**とストアの**実態**がズレていても無風で通る
- iTunes Lookup API は 1 リクエストで価格・バージョン・公開日・対応言語まで返すので、文言との突き合わせに使える
- 公式の制限は「約 20 calls / 分」。超えたときの挙動はドキュメントに記載がないが、実際には `429` が返る

## 点検したら 3 種類のズレが出てきた

止めていた SNS の定期投稿を再開するにあたって、遷移先の LP を一通り見に行きました。広告を出す前に着地点を確認する、程度の軽い気持ちでした。

出てきたのは 3 件です。

**1. 存在しない App Store ID を指していた**

あるアプリの LP が `id6739487979` にリンクしていました。ストアボタンも、JSON-LD の `downloadUrl` も、`apple-itunes-app` メタタグも、3 箇所すべて同じ ID。実際に配信されているのは別の ID でした。

**2.「近日公開」のまま、アプリは 3 日前から配信されていた**

別のアプリの LP には「App Store で近日公開」と書いてありました。ストアボタンは押せますが、飛び先はページ内の `#price` セクションです。アプリ自体は 3 日前からストアに並んでいました。

HTML の先頭にはご丁寧にこんなコメントまで残っていました。

```html
<!--
  App Store 公開後、次の1コマンドでストアバッジを本番リンクに切り替えてください:
  ...
-->
```

書いた本人が、公開後にこのコメントを読み返さなかった。

**3.「Android 近日公開」と書いてあるが、Play では配信中**

トップページの製品カードに「App Store 配信中 / Android 近日公開」。Play の URL を叩いたら `200` でした。

## リンク切れ検査では 1 しか見つからない

死んだ App Store ID がどう見えるか確かめました。

```bash
$ curl -s -o /dev/null -w '%{http_code}\n' -L \
    'https://apps.apple.com/jp/app/example/id6739487979'
404
```

1 は `404` なので、ふつうのリンクチェッカで拾えます。**拾えないのは 2 と 3 のほう**でした。

2 のリンクは `#price` へのページ内アンカーです。リンクとしては 100% 生きている。「ボタンのラベルが `App Store` なのに飛び先が自ページ」という状態は、HTTP のレイヤーからは何の異常にも見えません。

3 に至っては、Play へのリンクが存在しないことが問題です。「無いリンク」はチェッカの守備範囲外です。

つまり、URL の死活だけを見ていると、**LP が事実と食い違っている状態**は永久に検出されません。しかも自分の LP のストアボタンは、自分では押さない。壊れていても気づく機会がない。

## Lookup API は実態を返してくれる

iTunes Search API の lookup エンドポイントは、ID を渡すと現在の実態を返します。

```bash
curl -s 'https://itunes.apple.com/lookup?id=6756719838&country=jp'
```

```json
{
  "resultCount": 1,
  "results": [
    {
      "trackName": "謎かけメーカー",
      "formattedPrice": "無料",
      "version": "1.4.4",
      "currentVersionReleaseDate": "2026-08-03T15:10:36Z",
      "languageCodesISO2A": ["EN"],
      "minimumOsVersion": "15.0",
      "trackContentRating": "4+"
    }
  ]
}
```

存在しない ID なら `resultCount` が `0` になります。ここが判定の芯です。

| 判定したいこと | 使うフィールド |
| --- | --- |
| ID が生きているか | `resultCount` |
| 「無料」表記が今も正しいか | `formattedPrice` |
| 「近日公開」が嘘になっていないか | `resultCount` が 1 なら公開済み |
| 「日英対応」等の表記が正しいか | `languageCodesISO2A` |
| 対応 OS の表記が古くないか | `minimumOsVersion` |

`404` チェックでは絶対に取れない情報が、同じ 1 リクエストで返ってきます。

## LP の文言と突き合わせる

やっていることは単純で、LP の HTML に含まれる文言と、Lookup の応答を照合するだけです。

```javascript
const CHECKS = [
  { id: '6756719838', lp: 'https://example.com/app-a/' },
  { id: '6751740564', lp: 'https://example.com/app-b/' },
];

async function lookup(id) {
  const res = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=jp`);
  if (res.status === 429) throw new Error('rate limited');
  const { resultCount, results } = await res.json();
  return resultCount === 0 ? null : results[0];
}

for (const { id, lp } of CHECKS) {
  const app = await lookup(id);
  const html = await (await fetch(lp)).text();

  if (!app) {
    console.error(`[dead] ${lp} が存在しない ID ${id} を指している`);
    continue;
  }
  if (/近日公開|まもなく公開|coming soon/i.test(html)) {
    console.error(`[stale] ${lp} が「近日公開」のまま。実際は公開済み (${app.version})`);
  }
  if (/無料/.test(html) && app.formattedPrice !== '無料') {
    console.error(`[price] ${lp} が「無料」表記。実際は ${app.formattedPrice}`);
  }
  await new Promise(r => setTimeout(r, 3500)); // 約 20 req/min の制限に合わせる
}
```

「近日公開」という語が LP に残っているのに `resultCount` が 1、という条件だけで、上の 2 番目は落とせます。文字列マッチなので雑ですが、雑でも人間の目視より確実に動きます。半年に一度しか読まない HTML の、しかも自分で書いたコメントを信用するよりはるかにましでした。

## 制限は約 20 calls / 分。超えると 429

叩きすぎました。公式ドキュメントにはこう書いてあります。

> The Search API is limited to approximately 20 calls per minute (subject to change).
> — [Search API — Apple Performance Partners](https://performance-partners.apple.com/search-api)

超えたときの挙動については、ドキュメントに記載がありません。実際に検証中に何度も叩いていたら、まず `apps.apple.com` 側が `429` を返しはじめました。数十秒待てば戻ります。

lookup エンドポイント自体で `429` を踏んだわけではないので、上のコードの `res.status === 429` は保険です。制限が「約」としか書かれていない以上、踏んでから考えるより先に置いておくほうが安いと判断しました。

なので、上のスクリプトではリクエスト間に 3.5 秒のスリープを入れています。20 req/min = 3 秒間隔なので、少し余裕を持たせた値です。アプリが 10 本あっても 35 秒で終わるので、CI に置いても邪魔になりません。

## まとめ

- リンクチェッカが見るのは URL の死活だけ。「ラベルは App Store なのに飛び先が自ページ」は正常として通る
- LP の文言とストアの実態の照合には Lookup API が要る。`resultCount` / `formattedPrice` / `languageCodesISO2A` あたりで足りる
- 「近日公開」という文字列が LP に残っているのに `resultCount` が 1、という条件だけで実害の大きいズレが取れる
- 制限は約 20 calls / 分。ドキュメントには書いていないが超えると `429`。3.5 秒スリープで十分

自分の LP のストアボタンは自分では押しません。押さないものは壊れていても気づけないので、機械に押させるのが結局いちばん安上がりでした。
