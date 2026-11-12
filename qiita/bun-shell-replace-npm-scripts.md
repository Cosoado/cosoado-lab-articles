---
title: "npm scripts を Bun Shell に置き換えたら CI が 40 秒速くなった話"
tags: ["Shell", "ShellScript", "CI", "TypeScript", "個人開発"]
published: true
qiita_id: "047c743a1f4a85b931cd"
qiita_url: "https://qiita.com/Cosoado/items/047c743a1f4a85b931cd"
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/bun-shell-replace-npm-scripts/

CI が `npm install` を `bun install` に切り替えただけで 40 秒短縮された。でも副産物で手に入れた「Bun Shell」がむしろ本命だった。

## TL;DR

- `bun install` はロックファイルがあれば npm の 4〜5 倍速い。うちで 52 秒 → 12 秒
- Bun Shell（`$` tagged template）で npm scripts を TypeScript に書き直すと OS 差異を気にしなくていい
- やらかしポイント：`source .env` は Bun Shell では動かない

## 背景：npm scripts の OS 差異問題

ある木曜の夜 11 時、翌朝 10 時のリリースまで 11 時間というところで CI が全部 red になった。

```json
{
  "scripts": {
    "build": "rm -rf dist && tsc"
  }
}
```

`rm` は Windows の cmd.exe にない。開発は Mac だったから 1 ヶ月間まったく気づかなかった。PR を出したらレビュアーが「CI 落ちてるよ」と指摘。その晩はじめて Windows runner を見た。典型的な「俺のマシンでは動く」。急ぎで `rimraf` と `cross-env` を足してなんとかリリースに間に合わせたが、こういう「OS 差異を吸収するだけのパッケージ」が地味に積み上がっていくのが嫌だった。

## Bun Shell とは

Bun v1.0.24（2024年1月）で追加されたクロスプラットフォームのシェル実装。`$` tagged template literal で書ける。

```ts
import { $ } from "bun";

await $`rm -rf dist`;          // rm -rf が Windows でも動く
await $`mkdir -p dist/assets`;

const output = await $`ls -la`.text();  // stdout を文字列で取得
const pkg = await $`cat package.json`.json(); // JSON を直接パース
```

[Bun v1.0.24 リリースノート](https://github.com/oven-sh/bun/releases/tag/bun-v1.0.24) によると、`bash`/`sh` の存在を前提にしないので Windows でも追加設定なしに動く。

## npm scripts を置き換える

### before

```json
{
  "scripts": {
    "clean": "rimraf dist",
    "build": "npm run clean && tsc && node scripts/copy.cjs",
    "dev": "cross-env NODE_ENV=development tsx watch src/index.ts"
  }
}
```

### after（scripts/build.ts）

```ts
import { $ } from "bun";

const env = process.env.NODE_ENV ?? "production";
await $`rm -rf dist`;
await $`tsc`;
await $`cp -r src/assets dist/`;
if (env === "production") await $`bun run scripts/minify.ts`;
```

```json
{ "scripts": { "build": "bun run scripts/build.ts" } }
```

TypeScript で書けるので条件分岐が普通に `if` で書ける。`rimraf`/`cross-env` の依存がまるごと消えた。

## やらかし：`source .env` が動かない

`.env` を `source` で読む習慣があって、ビルドスクリプトにそのまま書いた。

```ts
// NG: Bun Shell に source コマンドはない
await $`source .env && tsc`; // → "source: not found"
```

Bun Shell は bash の全組み込みコマンドを実装しているわけではない。代わりに、プロジェクトルートの `.env` は `bun run` 実行時に自動でロードされる。

```ts
// OK: bun run scripts/build.ts だけで .env が展開済み
const dbUrl = process.env.DATABASE_URL;
```

ドキュメントを読めば 5 分で気づく話を 1 時間消耗した。

## CI の実測値

GitHub Actions（`ubuntu-latest`、依存 180 件）:

| ステップ | npm | bun |
|---|---|---|
| install | 52 秒 | 12 秒 |
| build | 8 秒 | 6 秒 |

GitHub Actions の最小設定:

```yaml
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: latest
- run: bun install --frozen-lockfile
- run: bun run build
```

## まとめ

- `cross-env`/`rimraf` を消して TypeScript でビルドスクリプトを書くと OS 差異を気にしなくていい
- `bun install` の速さは CI に効く。40 秒の短縮は体感でかなり違う
- `source` は Bun Shell にない。`.env` は Bun の自動ロードに任せる
