---
title: "Vercel build cache はプロジェクト間で共有されない──Turborepo で解決する"
emoji: "⚡"
type: "tech"
topics: ["vercel", "turborepo", "nextjs", "monorepo", "個人開発"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/vercel-build-cache-not-shared-across-projects/

同じ GitHub リポジトリから複数の Vercel プロジェクトを作っていて「毎回フルビルドになる気がする」と感じたことがある人向けに書く。

## TL;DR

- Vercel の build cache は **プロジェクト単位で隔離**されている。同じ repo から複数プロジェクトを作っても、キャッシュは共有されない
- Turborepo の **Remote Cache を Vercel チームに紐付ける**とチーム内全プロジェクトでキャッシュを共有できる
- セットアップは `turbo.json` を 1 枚書いて `npx turbo link` するだけ。Vercel deploy 時は自動認証されるため `TURBO_TOKEN` の手動設定は不要

---

## 1 つの repo から 3 プロジェクトをデプロイしたら毎回フルビルドになった

SparMate・NetaPair・BoardLink の 3 アプリを 1 リポジトリから Vercel に別プロジェクトとして deploy している。先月、共通ボタンを修正してからビルドログを比べると、3 プロジェクト全部で `Creating an optimized production build` が最初から走っていた。次の deploy でも、その次でも同じ。

調べたら当たり前のことを見落としていただけだった。**Vercel の build cache はプロジェクトごとに独立したストレージに保存されている**。同じ repo を参照していても Vercel 上の「プロジェクト」が別ならキャッシュ領域も別だ。

## Vercel build cache のスコープ

Next.js の `next build` が終わると `.next/cache/` 以下にキャッシュが作られる（[Next.js CI Build Caching](https://nextjs.org/docs/app/building-your-application/deploying/ci-build-caching)）。

```text
.next/cache/
├── swc/           # SWC コンパイラキャッシュ
├── webpack/       # モジュールグラフ解決結果
└── fetch-cache/   # App Router の fetch() レスポンス
```

Vercel はこのディレクトリを**プロジェクト ID + ブランチ単位**で保存・復元する。同じ repo を参照する複数プロジェクトでもストレージは別々で、共有の仕組みは標準では存在しない。

## Turborepo Remote Cache で解決する

[Turborepo](https://turbo.build/repo) はタスクの実行結果をコンテンツハッシュで管理して再利用するビルドシステムだが、**Remote Cache** を使うと、そのキャッシュを Vercel のチームストレージに保存し、同じ Vercel チームに属する全プロジェクトで共有できるようになる（[Turborepo Remote Caching](https://turbo.build/repo/docs/core-concepts/remote-caching)）。

Vercel チームへの Remote Cache は追加費用なし。deploy 時は Vercel が自動でキャッシュ認証を行うため、`TURBO_TOKEN` 等の手動設定も不要だ。

### セットアップ

```bash
npm install turbo --save-dev
```

`turbo.json` をリポジトリルートに置く。

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "outputs": [".next/**", "!.next/cache/**"]
    }
  }
}
```

`"!.next/cache/**"` の除外が重要で、後述する落とし穴の原因になる。

ローカル開発環境から Remote Cache を使いたい場合は `turbo login`・`turbo link` を実行する。

```bash
npx turbo login  # Vercel アカウントで認証
npx turbo link   # このリポジトリを Vercel チームに紐付ける
```

`turbo link` を実行すると Vercel チームの選択肢が表示され、選択後に `.turbo/config.json` が生成される。中身はチーム ID と API エンドポイントのみでシークレットを含まないため、**commit する**（チームメンバーが同じ Remote Cache を使うためにも必要）。

### Vercel プロジェクトの Build Command を変更

各プロジェクトの Vercel ダッシュボード → Settings → Build & Development Settings → Build Command を変更する。

```bash
# 変更前
next build

# 変更後
npx turbo build
```

この設定だけで、Vercel 上での build 時に Remote Cache が有効になる。2 つ目以降のプロジェクトが deploy されるとき、1 つ目のプロジェクトが保存したキャッシュをそのまま使う。

### 効果

私の環境では SparMate の初回 deploy 後に NetaPair を deploy したとき **2 分強 → 45 秒前後**になった（体感値。依存モジュール数・変更内容で変わる）。3 つ目の BoardLink はさらに短くほぼウォームスタートだった。

## 落とし穴

### `turbo.json` の `outputs` に `!.next/cache/**` を書き忘れる

これが一番やった失敗だ。最初に `turbo.json` を書いたとき、outputs に `.next/**` だけを指定して `!.next/cache/**` の除外を書かなかった。

```json
// ❌ 間違い：.next/cache/ まで成果物として扱われる
{
  "tasks": {
    "build": {
      "outputs": [".next/**"]
    }
  }
}
```

こうすると `.next/cache/` 自体が Remote Cache に取り込まれ、リストア → build → 保存のサイクルでキャッシュサイズが際限なく膨らむ。restore が異常に遅くなって気づく。`!.next/cache/**` は必ず書く。

```json
// ✅ 正しい設定
{
  "tasks": {
    "build": {
      "outputs": [".next/**", "!.next/cache/**"]
    }
  }
}
```

## まとめ

Vercel の build cache はプロジェクト単位で隔離されており、同じ repo から複数プロジェクトをデプロイしても共有されない。Turborepo Remote Cache を Vercel チームに紐付ければ解決できる。セットアップは `turbo.json` 1 枚と `npx turbo link` だけ。次回は [Next.js で env var 1 つで配色・機能を切り替える設計](https://zenn.dev/cosoado) を書く予定。

---

参照:

- [Turborepo Remote Caching 公式ドキュメント](https://turbo.build/repo/docs/core-concepts/remote-caching)
- [Next.js CI Build Caching](https://nextjs.org/docs/app/building-your-application/deploying/ci-build-caching)
- [Vercel Build Caching](https://vercel.com/docs/deployments/build-caching)

---

[SparMate](https://sparmate.cosoado-lab.com) — 格闘技の練習相手マッチング  
[NetaPair](https://netapair.cosoado-lab.com) — お笑いの相方探し  
[BoardLink](https://boardlink.cosoado-lab.com) — ボドゲ・TRPG 仲間募集  
[Cosoado Lab](https://cosoado-lab.com)
