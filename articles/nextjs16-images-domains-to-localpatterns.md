---
title: "Next.js 16 で images.domains 廃止 — 3 アプリを remotePatterns に書き直す"
emoji: "📸"
type: "tech"
topics: ["nextjs", "vercel", "typescript", "個人開発", "ogp"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/nextjs16-images-domains-to-localpatterns/

Next.js 16 に上げた月曜の朝、build ログに `DeprecationWarning: The "images.domains" configuration is deprecated` が並んだ。v14 のドキュメントには deprecated と書いてあったが、runtime warning が出ていなかったので 2 年近く放置し続けた報いだ。Next.js 14 のリリースは 2024 年だから、計算したらそうなる。なんで今まで気づかなかったかは聞かないでほしい。SparMate・NetaPair・BoardLink の `next.config.ts` を一気に直した。ついでに `images.localPatterns` という別の罠も踏んだので両方まとめておく。

## TL;DR

- `images.domains` → Next.js 16 で deprecation warning。移行先は `images.remotePatterns`（プロトコル・パスまで絞れる）
- query string 付きローカル URL `<Image src="/api/photo?id=1" />` は Next.js 16 からエラー。`images.localPatterns` で許可が必要
- 参照: [PR #84625](https://github.com/vercel/next.js/pull/84625) / [PR #84406](https://github.com/vercel/next.js/pull/84406)

## images.domains が deprecated になった理由

`images.domains` の問題は許可の粒度が粗すぎることだ。ホスト名だけを書くと全パス・HTTP と HTTPS の両方が許可される。「このパスの HTTPS だけ許可したい」という絞り方ができない。

`?url=https://lh3.googleusercontent.com/any-path` を渡せばそのホストからなら何でも画像最適化エンドポイントを通過してしまう。Next.js 12.3 で追加された `remotePatterns` はプロトコル・ホスト名・パスをそれぞれ絞れる。`domains` はその時点で役目を終えていた。

## remotePatterns への移行

```ts
// before
const config: NextConfig = {
  images: {
    domains: ['avatars.githubusercontent.com', 'lh3.googleusercontent.com'],
  },
}
```

```ts
// after
import type { NextConfig } from 'next'

const config: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        pathname: '/u/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/a/**',
      },
    ],
  },
}

export default config
```

`protocol: 'https'` で HTTP リクエストをはじき、`pathname` でパスを絞る。`/**` は任意のサブパスにマッチするワイルドカードだ。`import type { NextConfig }` を書いておくと `remotePatterns` のプロパティが TypeScript で補完される。

1 行書き換えでは済まないが、使っているドメインを書き出すだけなので 3 アプリ分でも 15 分かからない。

## localPatterns の新要件（Next.js 16 breaking change）

`images.domains` の警告に気を取られていたら、もう 1 つ踏んだ。

Next.js 16 から、`<Image>` に query string 付きのローカル URL を渡すには `images.localPatterns` での許可が必要（[PR #84406](https://github.com/vercel/next.js/pull/84406)）。

```tsx
// Next.js 16 から runtime error になる
<Image src={`/api/user-photo?userId=${userId}`} width={64} height={64} alt="avatar" />
// Error: ... is using a query string which is not configured in images.localPatterns.
```

デフォルトの `localPatterns` は `{ pathname: '/**', search: '' }` — search が空文字列、つまり「query なし」しか通さない。修正:

```ts
const config: NextConfig = {
  images: {
    localPatterns: [
      {
        pathname: '/api/user-photo',
        // search を省略すると任意の query を許可
      },
    ],
  },
}
```

`opengraph-image.tsx` + `ImageResponse` の OG 画像生成パターン（[前の記事](https://zenn.dev/cosoado/articles/nextjs-app-router-dynamic-og-image-by-genre)）は `<Image>` を経由しないので影響なし。admin 画面で `<Image src="/api/og?preview=true" />` のように query 付きローカル URL を渡している場合は対象になる。

## これは一番やった失敗です

`remotePatterns` に移行するとき、最初に書いたのがこれだった:

```ts
remotePatterns: [
  {
    protocol: 'https',
    hostname: '**',  // ← 全ホスト許可。domains と何も変わらない
  },
],
```

「warning が消えた、動いた、commit」と半自動的にやった。セルフレビューで気づいたのが commit の 10 分後で、push 前だったのは不幸中の幸いだ。`hostname: '**'` は全ドメインを許可するワイルドカードで、`images.domains: ['*']` でホワイトリスト全開放するのと同じことになる。`remotePatterns` の意味は「このホストのこのパスだけ通す」であって、wildcard 全開放は趣旨を外れている。

## まとめ

- `images.domains` → `images.remotePatterns` に移行。`protocol` + `pathname` まで絞ることでセキュリティが上がる
- query string 付きローカル `<Image>` は `images.localPatterns` での許可が必要（Next.js 16 breaking change）
- `hostname: '**'` で移行した気になるのが一番よくないパターン

1 アプリ 10 分の作業。warning を「後でやる」で積んでいくとバージョンアップのたびに地雷が増える。

---

この記事の設定を実際に使っているプロダクト:

- [SparMate](https://sparmate.cosoado-lab.com) — スポーツマッチングアプリ
- [NetaPair](https://netapair.cosoado-lab.com) — ネタ系交流マッチングアプリ
- [BoardLink](https://boardlink.cosoado-lab.com) — ボードゲームマッチングアプリ
- [Cosoado Lab](https://cosoado-lab.com) — 個人開発ラボ
