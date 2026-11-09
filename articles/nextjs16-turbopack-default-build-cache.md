---
title: "Next.js 16 Turbopack デフォルト化: build cache 3 つの変更点"
emoji: "⚡"
type: "tech"
topics: ["nextjs", "vercel", "キャッシュ", "個人開発", "パフォーマンス"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/nextjs16-turbopack-default-build-cache/

[以前 Vercel の build cache についての記事](https://zenn.dev/cosoado/articles/vercel-build-cache-not-shared-across-projects)を書いた。その中で `.next/cache/webpack/` を含む構造を図解して、Turborepo の `outputs` 設定も載せた。Next.js 16 に上げたら、その記事の前提が静かに崩れていた。

## TL;DR

- Next.js 16.0.0 から `next build` でも Turbopack がデフォルト。`--turbopack` フラグは不要
- build cache の保存先が `.next/cache/webpack/` → `.next/cache/turbopack/` に変わった
- Next.js 16.3 から `turbopackFileSystemCacheForBuild` がデフォルト `true`、ビルド間でキャッシュが再利用される
- カスタム webpack 設定がある場合は `next build --webpack` が必要

---

## 背景 — 以前の記事が壊れていた

[前の記事](https://zenn.dev/cosoado/articles/vercel-build-cache-not-shared-across-projects)で書いた `.next/cache/` の構造はこうだった。

```text
.next/cache/
├── swc/           # SWC コンパイラキャッシュ
├── webpack/       # モジュールグラフ解決結果
└── fetch-cache/   # App Router の fetch() レスポンス
```

Next.js 16 に上げた後、SparMate の CI ログを見ると `.next/cache/webpack/` が存在しない。代わりに `.next/cache/turbopack/` が出てきた。

これは一番やった失敗で、GitHub Actions の restore が全部空振りし続けていたのに 2 週間気づかなかった。「なんか最近ビルド遅い気がするけど依存関係が増えたせいかな」で流していた。restore ログを読んでやっと「ヒットしていない」と分かり、cache ディレクトリが変わっていた、という順番。2 週間ドブった。

---

## 変更 1: Turbopack がデフォルトバンドラーになった

Next.js 16.0.0 のリリースノート（[GitHub](https://github.com/vercel/next.js/releases/tag/v16.0.0)）から抜粋。

- カスタムサーバーを含む全ての `next dev` / `next build` で Turbopack がデフォルト（#84281）
- `create-next-app` の生成コードから `--turbopack` フラグが削除（#85117）

```bash
# 以前
npx create-next-app@15 my-app --turbopack

# Next.js 16 以降
npx create-next-app@16 my-app  # --turbopack は不要
```

webpack に戻したい場合は `--webpack` フラグを使う。

```bash
next build --webpack
```

カスタム webpack 設定（`next.config.js` の `webpack` フィールド）を使っている場合、フラグなしで `next build` を実行するとビルドが失敗する。エラーメッセージで `--webpack` フラグの追加を促される。

---

## 変更 2: build cache のパスが変わった

| 設定 | webpack | Turbopack |
|---|---|---|
| キャッシュパス | `.next/cache/webpack/` | `.next/cache/turbopack/` |

GitHub Actions でキャッシュを設定している場合は `path` を `turbopack` に修正する。

```yaml
- uses: actions/cache@v4
  with:
    path: .next/cache/turbopack
    key: ${{ runner.os }}-nextjs-${{ hashFiles('**/package-lock.json') }}
```

Turborepo を使っている場合、`turbo.json` の `outputs` に `!.next/cache/**` の除外が書いてあれば変更不要だ。Turbopack のキャッシュも除外されるため Remote Cache に取り込まれることはない。

---

## 変更 3: `turbopackFileSystemCacheForBuild` がデフォルト `true` に

Next.js 16.0.0 では実験的 opt-in だった `turbopackFileSystemCacheForBuild` が、16.3 から **デフォルト `true`** になった。ビルド結果を `.next/cache/turbopack/` に永続化して次回以降のビルドをウォームスタートする。

```js
// next.config.js — 明示的に設定する場合
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    turbopackFileSystemCacheForBuild: true,  // 16.3 以降デフォルト
    turbopackFileSystemCacheForDev: true,    // dev 用も同様
  },
}

module.exports = nextConfig
```

**CI でキャッシュを保持しない環境では `false` にした方がいい。** 毎回書き込みだけ走ってヒットしないため、むしろ遅くなり得る。

```js
const nextConfig = {
  experimental: {
    turbopackFileSystemCacheForBuild: false,
  },
}
```

ローカル開発では `true` のまま置いておくと、変更のないモジュールのコンパイルが省かれて速くなる。SparMate のローカルビルドは webpack 時代より 40 秒ほど短くなった（2 分 20 秒 → 1 分 40 秒前後）。

---

## まとめ

Next.js 16 の Turbopack デフォルト化で変わった点をまとめると:

1. **バンドラー**: `--turbopack` フラグが不要に。カスタム webpack 設定がある場合は `--webpack` で戻す
2. **キャッシュパス**: `.next/cache/webpack/` → `.next/cache/turbopack/`。CI の restore 設定を更新する
3. **永続キャッシュ**: `turbopackFileSystemCacheForBuild` が 16.3 以降デフォルト `true`。CI でキャッシュを保持しない場合は `false` にする

Turborepo の `outputs` は `!.next/cache/**` のままで変更不要。次回は Supabase Pooler + Multigres で pooled connection 越しの LISTEN/NOTIFY が通るようになった話を書く予定。

---

参照:

- [Next.js 16.0.0 Release Notes](https://github.com/vercel/next.js/releases/tag/v16.0.0)
- [Vercel build cache はプロジェクト間で共有されない──Turborepo で解決する（前回記事）](https://zenn.dev/cosoado/articles/vercel-build-cache-not-shared-across-projects)

---

[SparMate](https://sparmate.cosoado-lab.com) — 格闘技の練習相手マッチング  
[NetaPair](https://netapair.cosoado-lab.com) — お笑いの相方探し  
[BoardLink](https://boardlink.cosoado-lab.com) — ボドゲ・TRPG 仲間募集  
[Cosoado Lab](https://cosoado-lab.com)
