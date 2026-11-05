---
title: "Vercel Speed Insights で LCP ボトルネックを特定し 3 秒→1 秒に改善した4つの対処"
tags: ["Vercel", "Next.js", "TypeScript", "個人開発", "SEO"]
published: true
qiita_id:
qiita_url:
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/vercel-speed-insights-lcp-fix/

マッチングアプリの LCP が 3.2 秒あった。Vercel Speed Insights のダッシュボードを開くまで気づかなかった。4 つの修正で 1.1 秒まで落とせたので、やったことを残しておく。

## TL;DR

| 修正 | 効果（概算） |
|---|---|
| `next/image` に `priority` を付けた | 一番効いた。-0.8 秒 |
| `next/font` でフォントをセルフホスト | -0.4 秒 |
| ヒーロー画像の出力を Server Component に移した | -0.3 秒 |

## LCP 3.2 秒に気づいたのは偶然だった

Speed Insights を入れたのはパフォーマンス改善のためではなかった。直帰率が高くてその原因を探していたときに「フィールドデータを取れないと判断できない」と気づいて追加した。

セットアップは 2 行で終わる。

```bash
npm install @vercel/speed-insights
```

```tsx
// app/layout.tsx
import { SpeedInsights } from '@vercel/speed-insights/next'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {children}
        <SpeedInsights />
      </body>
    </html>
  )
}
```

デプロイして 1 週間後にダッシュボードを開いたら、LCP の p75 が 3.2 秒だった。PageSpeed Insights のラボスコアは 78 点で気にしていなかった。ラボスコアはキャッシュ済みの近い環境で測るから楽観的になる。3 秒台は実ユーザーの話だった。

## やらかし: 最初は Vercel が遅いと思っていた

ダッシュボードで 3 秒台を見た直後、「Edge Network の問題か？」と思った。Vercel の PoP 設定を確認し、CDN のキャッシュ設定を疑い始めた。

5 分後に Speed Insights の「LCP 要素」列を見たら `<img>` タグだった。自分のコードだった。サポートに問い合わせる寸前まで行っていた。

## 修正 1: next/image に priority を付ける

LCP になる画像に `priority` が付いていなかった。これが一番効いた。

```tsx
// Before
<Image src={heroImage} alt="ヒーロー画像" width={1200} height={630} />

// After
<Image src={heroImage} alt="ヒーロー画像" width={1200} height={630} priority />
```

`priority` を付けると `<link rel="preload">` と `fetchpriority="high"` が自動で出力される。付けないと、ブラウザはビューポート内かどうかをレイアウト後まで判断しない。ヒーロー画像なのに後回しになっていた。

参照: [vercel/next.js（GitHub）](https://github.com/vercel/next.js)

## 修正 2: next/font でフォントをセルフホスト

Google Fonts に `<link>` を張っていた。外部ドメインへの接続は DNS 解決 + TLS ハンドシェイクが毎回発生する。モバイルのネットワークだと積み上がる。

```tsx
import { Noto_Sans_JP } from 'next/font/google'

const noto = Noto_Sans_JP({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '700'],
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={noto.className}>
      <body>{children}</body>
    </html>
  )
}
```

`next/font` はビルド時にフォントファイルをダウンロードして自分のドメインから配信する。外部への接続が 1 本なくなる。レイアウトシフトも消える。

## 修正 3: ヒーロー画像を Server Component に移す

ヒーロー画像を表示している `HeroSection` が `'use client'` だった。クライアントコンポーネントは JS バンドルが届いてハイドレーションが走るまで何も表示できない。ヒーロー画像もその後まで待っていた。

```tsx
// Before
'use client'

export function HeroSection() {
  return <Image src={heroImage} alt="..." width={1200} height={630} priority />
}
```

```tsx
// After — 'use client' を外すだけ
export function HeroSection() {
  return <Image src={heroImage} alt="..." width={1200} height={630} priority />
}
```

ユーザー操作（クリック、フォーム、state）が無ければ `'use client'` は不要。反射的に付けていた。

## まとめ

- Speed Insights のフィールドデータは、ローカルの Lighthouse より正直
- LCP 画像に `priority` がないのが最大の原因だった。1 プロパティで 0.8 秒
- フォントの外部依存と `'use client'` の乱用が次点
- 測ってから直す。推測で直すと無関係な CDN 設定を 30 分いじって終わる
