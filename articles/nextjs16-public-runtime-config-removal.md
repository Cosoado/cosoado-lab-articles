---
title: "Next.js 16 が publicRuntimeConfig を廃止予告 — 3 アプリへの影響確認と移行パターン"
emoji: "🧹"
type: "tech"
topics: ["nextjs", "環境変数", "vercel", "個人開発", "typescript"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/nextjs16-public-runtime-config-removal/

以前「[Next.js で env var 1 つで 3 アプリの配色・機能を切り替えるジャンル設計](https://zenn.dev/cosoado/articles/nextjs-env-var-genre-config-pattern)」を書いた。Next.js 16 canary のリリースノートを眺めていたら `Remove deprecated publicRuntimeConfig and serverRuntimeConfig` というタイトルのコミットが目に入って、一瞬血の気が引いた。「あの記事の前提、詰んだ?」と思ったので、3 アプリ分のコードを確認しながら移行パターンを整理した。

## TL;DR

- Next.js 16.0.0 では削除は **revert** されており、deprecation 警告の追加に留まっている
- canary ブランチのアップグレードガイドには「removed. Use environment variables instead」と明記されており、削除は時間の問題
- 移行パターン 2 種: ① ビルド時定数 → `NEXT_PUBLIC_*` ② 実行時読み取り → `process.env` + `connection()`
- `getConfig()` を呼んでいるコードがあれば今すぐ grep して棚卸しした方がいい

---

## publicRuntimeConfig が何のために存在したか

存在意義は「**ビルド後に値を変えられる**」こと。`NEXT_PUBLIC_*` はビルド時に bundle に静的インライン展開されるので、値を変えるには再ビルドが必要だ。`getConfig()` を使う runtime config は、サーバー起動時の `process.env` を変えるだけで差し替えられた。App Router 以降は Server Components が増えてこのニーズが別の方法で満たせるようになり、廃止に向かっている。

## v16.0.0 の実際の状況

canary では [PR #83944](https://github.com/vercel/next.js/pull/83944) で削除が一度 merge されたが、リリース直前の [PR #84167](https://github.com/vercel/next.js/pull/84167) で revert された。v16.0.0 には削除ではなく [PR #84168](https://github.com/vercel/next.js/pull/84168) で追加された deprecation 警告だけが入っている。

ただし canary ブランチの[アップグレードガイド](https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/upgrading/version-16.mdx)には:

> `serverRuntimeConfig` and `publicRuntimeConfig` have been removed. Use environment variables instead.

と書いてある。v16.0.0 に間に合わなかっただけで削除の意志は変わっていない。次のマイナー更新か 16.x のどこかで壊れる。

## 私の 3 アプリは影響ゼロだった

SparMate・NetaPair・BoardLink は全部 `NEXT_PUBLIC_GENRE=sparmate` のような NEXT_PUBLIC_* パターンを使っていた。`getConfig()` はどこにも呼んでいなかった。

確認するまでの 10 分は冷や汗をかいたが、前回の記事を書いたときに「runtime config は使わない」と決めていたのが功を奏した。ちゃんと理由を持って設計しておくとこういうとき助かる。

## 移行パターン 2 種

### パターン 1: ビルド時定数 → NEXT_PUBLIC_*

値はビルド時に bundle に埋め込まれる。

```typescript
// Vercel の Environment Variables に NEXT_PUBLIC_API_BASE_URL を追加して置き換えるだけ
const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL
```

値を変えると再ビルドが必要。「デプロイ後に差し替えたい」ニーズがあればパターン 2 を使う。

### パターン 2: 実行時読み取り → process.env + connection()

Server Components 専用。`connection()` を先に呼ぶことで「プリレンダリング時ではなく、リクエスト時に読む」ことが保証される。

```typescript
import { connection } from 'next/server'

export default async function Page() {
  await connection()  // これ以降はリクエスト時に実行される
  const apiUrl = process.env.API_BASE_URL
  // ...
}
```

`connection()` なしだと、Next.js が静的プリレンダリング時に `process.env` を評価してしまう場合がある。`serverRuntimeConfig` の「起動後に差し替えたい」ユースケースはこれで代替できる。

## やらかした話: connection() を Client Component で呼ぼうとした

移行パターンを確認しながら「`connection()` を useEffect の中で呼べばいいのでは?」と試した。コンパイルは通ったが、ブラウザのコンソールに「connection is not defined in client context」みたいなエラーが出た。

`connection()` は Server Components 専用だ。`'use client'` の中では呼べない。実行時読み取りが必要な値は Server Component で取得して props で渡すか、Server Action 経由にする必要がある。「async/await が書けるなら Server Component でも Client Component でも同じか」という油断がある。これは一番やった間違いで、自信満々に修正して PR を出したあとにレビューで気づいた。

## まとめ

- `getConfig()` を使っているコードは今すぐ `grep -r "next/config"` して棚卸しを
- v16.0.0 は deprecation 警告だけだが、canary docs には「removed」とある
- ビルド時定数でよければ → `NEXT_PUBLIC_*`
- デプロイ後に変えたい実行時値は → Server Component + `connection()` + `process.env`

`getConfig()` を使った例は古いドキュメントやチュートリアルにまだ多い。次のアップグレードで詰まる前に確認しておく価値がある。

参照:

- [vercel/next.js #83944 — Remove deprecated publicRuntimeConfig and serverRuntimeConfig](https://github.com/vercel/next.js/pull/83944)
- [vercel/next.js #84167 — Revert removal for v16.0.0](https://github.com/vercel/next.js/pull/84167)
- [vercel/next.js #84168 — Add deprecation warning to Runtime config](https://github.com/vercel/next.js/pull/84168)
- [Next.js v16 アップグレードガイド (canary)](https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/upgrading/version-16.mdx)

---

[SparMate](https://sparmate.cosoado-lab.com) — 格闘技の練習相手マッチング  
[NetaPair](https://netapair.cosoado-lab.com) — お笑いの相方探し  
[BoardLink](https://boardlink.cosoado-lab.com) — ボドゲ・TRPG 仲間募集  
[Cosoado Lab](https://cosoado-lab.com)
