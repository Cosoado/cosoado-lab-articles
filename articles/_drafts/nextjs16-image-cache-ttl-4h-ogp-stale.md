---
title: "Next.js 16 で OGP 画像が 4 時間キャッシュされた話と minimumCacheTTL 移行"
emoji: "⏳"
type: "tech"
topics: ["nextjs", "ogp", "vercel", "キャッシュ", "個人開発"]
published: false
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/nextjs16-image-cache-ttl-4h-ogp-stale/

Next.js 16 にアップグレードして OGP 画像を差し替えてデプロイしたのに、Twitter/X のカードが 4 時間変わらなかった。`next.config.ts` は何も触っていないのに。原因は `images.minimumCacheTTL` のデフォルト値変更だった。

## TL;DR

- Next.js 16.0.0（2025 年 10 月リリース）で `images.minimumCacheTTL` のデフォルトが **60s → 14,400s（4 時間）** に変わった
- `/_next/image` 経由で OGP 画像を配信している場合、差し替えが 4 時間反映されない
- `next.config.ts` で `minimumCacheTTL: 60` を明示するだけで v15 以前の挙動に戻せる

参照: [Next.js v16.0.0 Release Notes](https://github.com/vercel/next.js/releases/tag/v16.0.0)

## ローンチ 2 時間前に踏んだ話

SparMate のローンチ当日、SNS 告知ツイートを出す 2 時間前に OGP タイトルのタイポを見つけた。`practice` を `practise` にしていた。どちらも正しい綴りだが、米英混在はプロらしくない。

直してデプロイ。Vercel のダッシュボードに 2 分でデプロイ完了と出た。

……が、Twitter/X のカードプレビューをリフレッシュしても古い画像のまま。1 時間後も変わらない。「Vercel CDN が遅い？」「Twitter 側のキャッシュ？」と検索してようやく気づいた。前週に Next.js を v16 にアップグレードしていて、`minimumCacheTTL` のデフォルトが変わっていた。

これが一番やらかした失敗だった。ローンチ時刻に間に合わせるため、急きょ告知ツイートから OGP カード表示を一時的に外す羽目になった。

## minimumCacheTTL とは

`/_next/image` は Next.js の画像最適化エンドポイント。外部 URL やローカル画像をリサイズ・WebP 変換してレスポンスする。

`minimumCacheTTL` はその変換済み画像をサーバー側でキャッシュする最小秒数。`s-maxage` として Vercel Edge Cache に伝わる。

```ts
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    minimumCacheTTL: 60, // v15 まではこれがデフォルト
  },
}
export default nextConfig
```

v16.0.0 では「アップストリームに Cache-Control を返さない画像が多く、60s では無駄な再バリデーションが多すぎる」という理由でデフォルトが 14,400s に変更された（[PR #84105](https://github.com/vercel/next.js/pull/84105)）。

## どこで問題になるか

`/_next/image` を経由した場合だけ影響を受ける。

問題になるケース：

```ts
// ❌ /_next/image 経由: minimumCacheTTL の影響を受ける
openGraph: {
  images: [`/_next/image?url=${encodeURIComponent('/og.png')}&w=1200&q=100`],
}
```

影響を受けないケース：

```ts
// ✅ /api/og を直接配信: minimumCacheTTL 無関係
openGraph: {
  images: [`/api/og?title=${encodeURIComponent(title)}`],
}
```

`<Image>` コンポーネントで描画した画像の URL をそのまま `og:image` に設定しているケースが一番気づきにくい。

## 対策

`next.config.ts` に明示的に書く。

```ts
// next.config.ts
const nextConfig: NextConfig = {
  images: {
    minimumCacheTTL: 60, // v15 以前と同じ挙動に戻す
  },
}
export default nextConfig
```

`minimumCacheTTL` は「最小値」なのでオリジンが長い `Cache-Control: max-age` を返す場合はそちらが優先される。頻繁に変わる OGP 画像なら 60s、ほぼ変わらないアセットなら 300s くらいが現実的な落としどころ。

v16 アップグレード時は `images` セクション全体を見直す価値がある。同バージョンで `images.domains` も非推奨になっているため（後日別記事で書く予定）。

## まとめ

- Next.js 16.0.0 で `minimumCacheTTL` のデフォルトが 60s → 14,400s（4 時間）に変わった
- `/_next/image` 経由の OGP 画像は差し替えが 4 時間反映されない
- `next.config.ts` に `minimumCacheTTL: 60` を明示するだけで解決する
- `/api/og` を直接配信していれば影響なし

次は `images.domains` 廃止と `images.localPatterns` への移行について書く。

---

[SparMate](https://sparmate.cosoado-lab.com) / [NetaPair](https://netapair.cosoado-lab.com) / [BoardLink](https://boardlink.cosoado-lab.com) / [Cosoado Lab](https://cosoado-lab.com)
