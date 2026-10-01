---
title: "Next.js 14→15 のfetch キャッシュ破壊的変更と最小移行チェックリスト"
tags: ["Next.js", "AppRouter", "fetch", "キャッシュ", "個人開発"]
published: false
qiita_id:
qiita_url:
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/nextjs15-fetch-cache-migration/

v14 → v15 にアップグレードした翌朝、Vercel のダッシュボードで Serverless Function の実行数が急増しているのに気づいた。コードは何も変えていない。デプロイは成功している。なのに実行数が 1.5 倍近い。最初はコールドスタートが増えたのかと思った。違った。

原因は `fetch` のデフォルト挙動の変化だった。

## 何が変わったのか（v14 と v15 の違い）

Next.js 14 の App Router では、`fetch()` はデフォルトで `force-cache` として動く。明示的に指定しなくても、最初のリクエスト時のレスポンスを Data Cache に保存し続ける。

```ts
// v14: キャッシュオプションを書かなくても force-cache として動いていた
const res = await fetch('https://api.example.com/data');
```

[Next.js 15.0.0 リリースノート](https://github.com/vercel/next.js/releases/tag/v15.0.0) に "Breaking: Disable automatic fetch caching" とある。v15 からはデフォルトがキャッシュなし（`no-store` 相当）に変更された。

```ts
// v15: 同じコードが毎回 origin にリクエストを飛ばすようになった
const res = await fetch('https://api.example.com/data');
```

「何も書いていない = キャッシュあり」が「何も書いていない = キャッシュなし」に変わった。意図せずキャッシュに乗っかっていたコードが全部影響を受ける。

## やらかした

NetaPair の管理ページに、60 秒で更新されれば十分なデータを表示している箇所がある。v14 では `fetch` に何も書かなくてもキャッシュが効いていたので、特に意識していなかった。

```ts
// 問題だったコード（v14 のときは force-cache でキャッシュされていた）
const statsRes = await fetch(`${process.env.API_BASE_URL}/api/stats/summary`);
const matchesRes = await fetch(`${process.env.API_BASE_URL}/api/matches/recent`);
```

v15 に上げた後、この 2 つが毎リクエストで実行されるようになった。ページが重いときほどアクセスが集中するので、DB まで無駄にクエリが走る状態。「意図していなかった」では済まない。

案の定というか、`grep -r "await fetch" --include="*.ts" --include="*.tsx" .` を初めてまともに実行したら、同じような「暗黙のキャッシュ依存」が 7 か所あった。v14 ではたまたま動いていただけで、移行前から設計として雑だったのが v15 で露わになった感じ。

## 移行チェックリスト（4 パターン）

上の grep の結果を 1 行ずつ意図を確認した。4 か所は `no-store`、2 か所は `revalidate: 60`、1 か所はキャッシュを残したいので `force-cache` に書き直した。

**1. 毎回フレッシュに取る（認証済みユーザーの動的データ）**

```ts
const res = await fetch(url, { cache: 'no-store' });
```

**2. 一定間隔で更新する（ISR 相当）**

```ts
// 60 秒後に再バリデート
const res = await fetch(url, { next: { revalidate: 60 } });
```

**3. ビルド時に固定する（変わらない静的データ）**

```ts
const res = await fetch(url, { cache: 'force-cache' });
```

**4. ページ全体を動的にする**

```ts
// app/admin/stats/page.tsx の先頭に
export const dynamic = 'force-dynamic';
```

パターン 4 は手軽だが、同じページの全 fetch が動的になる。Partial Prerendering も無効になるので、細かくコントロールしたい場合は 1〜3 を使う。

## 紛らわしい: `no-cache` と `no-store` は別物

最初に `no-cache` を書いてもキャッシュが効き続けた、という話を他でも見た。自分もやった。

| オプション | キャッシュ保存 | 使用前の再検証 | 実際の動作 |
|---|---|---|---|
| `force-cache` | する | しない | 永続キャッシュ |
| `no-cache` | する | 毎回する | 保存した上でサーバーに確認 |
| `no-store` | しない | しない | 常に origin から取得 |

「毎回最新を取りたい」なら `no-store` の一択。`no-cache` は保存した上で再検証するので、Next.js の Data Cache 実装では意図通りに動かないケースがある。`no-cache` と `no-store` の違いは HTTP の仕様レベルの話で、間違えても警告は出ない。

## まとめ

- v14 → v15 で `fetch` のデフォルトが `force-cache` → `no-store` 相当に変わった
- 「キャッシュオプションを書いていない fetch」が全て影響を受ける
- まず `grep -r "await fetch"` で洗い出し、全箇所に意図を明示する
- `no-cache` と `no-store` は別物。「毎回最新を取る」は `no-store`
- 明示的に書いておけばバージョン依存の挙動から解放される
