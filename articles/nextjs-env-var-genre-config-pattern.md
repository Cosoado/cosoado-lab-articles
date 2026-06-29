---
title: "Next.js で env var 1 つで 3 アプリの配色・機能を切り替えるジャンル設計"
emoji: "🎨"
type: "tech"
topics: ["nextjs", "typescript", "vercel", "個人開発", "環境変数"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/nextjs-env-var-genre-config-pattern/

SparMate・NetaPair・BoardLink という 3 つのマッチングアプリを同じ Next.js リポジトリから Vercel に別プロジェクトとしてデプロイしている。それぞれ配色・アプリ名・有効な機能が違うが、コアのマッチングロジックは共通だ。想定読者は「同一コードベースで複数ジャンルのアプリを動かしたいが、どこでジャンルを分岐させればいいか迷っている個人開発者」だ。

## TL;DR

- 各 Vercel プロジェクトに `NEXT_PUBLIC_GENRE=sparmate`（または `netapair` / `boardlink`）を 1 つ設定するだけで配色・テキスト・機能フラグを切り替える
- `satisfies Record<Genre, GenreConfig>` でジャンル定義の漏れをコンパイル時に検出できる
- `NEXT_PUBLIC_*` はビルド時にバンドルへ静的インライン展開されるため、`process.env[dynamicKey]` 形式の動的アクセスは機能しない

---

## if 文 30 件で気づいた設計のまずさ

BoardLink の追加開発を始めた夜、SparMate のジャンル名をリポジトリ全体で grep したら 30 件超のヒットが出た。「次のジャンルを足したらこの数が倍になる」と気づいた瞬間、作業する手が止まった。コンポーネントの中に `if (genre === 'sparmate') ... else if (genre === 'netapair') ...` が散在していて、変更するたびにどこを直せばいいか grep しなければわからない状態だった。

これが一番やった失敗だ。ジャンルの設定情報を 1 か所に集約せずに条件分岐として散らしてしまうと、ジャンルが増えるたびに全ファイルを検索するはめになる。「新ジャンルを足したら何を追加すればコンパイルエラーで教えてもらえるか」を設計の起点にするとうまくいった。

## ジャンル設定ファイルを 1 枚に集約する

`lib/genre.ts` にジャンルの定義をすべてまとめる。

```typescript
export type Genre = 'sparmate' | 'netapair' | 'boardlink'

export interface GenreConfig {
  appName: string
  primaryColor: string   // Tailwind クラス（完全なクラス名で記述）
  textColor: string
  features: {
    videoMatch: boolean  // ビデオ通話マッチング
  }
}

const genreConfig = {
  sparmate: {
    appName: 'SparMate',
    primaryColor: 'bg-red-500',
    textColor: 'text-red-600',
    features: { videoMatch: true },
  },
  netapair: {
    appName: 'NetaPair',
    primaryColor: 'bg-yellow-500',
    textColor: 'text-yellow-600',
    features: { videoMatch: false },
  },
  boardlink: {
    appName: 'BoardLink',
    primaryColor: 'bg-blue-500',
    textColor: 'text-blue-600',
    features: { videoMatch: false },
  },
} satisfies Record<Genre, GenreConfig>

const VALID_GENRES = Object.keys(genreConfig) as Genre[]
const raw = process.env.NEXT_PUBLIC_GENRE

export const genre: Genre = VALID_GENRES.includes(raw as Genre)
  ? (raw as Genre)
  : 'sparmate'

export const config = genreConfig[genre]
```

`satisfies Record<Genre, GenreConfig>` がポイントだ（[TypeScript 4.9 で追加された演算子](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html)）。`Genre` 型に新しいジャンルを追加したとき、`genreConfig` 側でも定義しないとコンパイルエラーになる。`as const` との違いは「型の完全性チェックをしつつ、各値の型推論も保持できる」点で、設定オブジェクトのパターンにはほぼこれ一択だと思っている。

## Vercel への設定

各 Vercel プロジェクトの **Settings → Environment Variables** で設定する。

| プロジェクト | 変数名 | 値 |
|---|---|---|
| sparmate | `NEXT_PUBLIC_GENRE` | `sparmate` |
| netapair | `NEXT_PUBLIC_GENRE` | `netapair` |
| boardlink | `NEXT_PUBLIC_GENRE` | `boardlink` |

Environment のスコープは **Production / Preview / Development** すべてにチェックを入れる。ローカル開発時は `.env.local` に `NEXT_PUBLIC_GENRE=sparmate` を書けば OK だ（`.env.local` は `.gitignore` に含まれているため commit されない）。

## コンポーネントでの使い方

```tsx
import { config } from '@/lib/genre'

export function PrimaryButton({ children }: { children: React.ReactNode }) {
  return (
    <button className={`${config.primaryColor} text-white px-4 py-2 rounded`}>
      {children}
    </button>
  )
}
```

機能フラグの出し分けも同じ `config` を参照する。

```tsx
import { config } from '@/lib/genre'

export function MatchCard() {
  return (
    <div>
      {/* ... */}
      {config.features.videoMatch && <VideoCallButton />}
    </div>
  )
}
```

### Tailwind での注意点

`bg-${color}-500` のように**文字列テンプレートで部分的にクラス名を組み立てると、Tailwind の静的スキャンで検出されず本番ビルドでクラスが消える**。設定ファイルに完全なクラス名（`'bg-red-500'`）を文字列として書くパターンなら問題ない（[Tailwind CSS: クラスの検出方法](https://tailwindcss.com/docs/detecting-classes-in-source-files)）。

## 落とし穴: NEXT_PUBLIC_* の動的アクセスは機能しない

`NEXT_PUBLIC_*` の変数はビルド時にバンドルへ静的にインライン展開される（[Next.js 環境変数ドキュメント](https://nextjs.org/docs/app/guides/environment-variables)）。webpack の DefinePlugin が `process.env.NEXT_PUBLIC_GENRE` という**リテラルの参照**を検出して値に置き換える仕組みだ。

そのため、変数名を動的に組み立てたアクセスは機能しない。

```typescript
// ❌ 動的アクセス → ビルド時に解決されず undefined になる
const key = 'NEXT_PUBLIC_GENRE'
const value = process.env[key]

// ✅ リテラルアクセス → ビルド時に文字列 'sparmate' などへ置き換えられる
const value = process.env.NEXT_PUBLIC_GENRE
```

私がこれにハマったのは「同じ prefix の変数を複数まとめて処理しようとして、変数名をループで組み立てた」ときだ。ローカルでは `.env.local` がそのままファイルとして読まれるので動いているように見えて、Vercel のビルド後だけ `undefined` になる。デプロイして確認して「あれ？」となり、ローカルで試して「動いてる…」となり、また Vercel でビルドして、を 3 往復したあとにようやく気づいた。先に気づくべきだった。

`NEXT_PUBLIC_*` はビルド時の定数として扱い、必ずリテラル形式でアクセスするのが原則だ。

## まとめ

env var 1 つでジャンルを切り替えるパターンは、コードの分岐を 1 ファイルに集約してくれる。`satisfies` による型チェックのおかげで、新ジャンル追加時の定義漏れをコンパイル時に検出でき、grep 30 件から解放された。

同一リポジトリから複数 Vercel プロジェクトをデプロイするときのビルドキャッシュの話は「[Vercel build cache はプロジェクト間で共有されない](https://zenn.dev/cosoado/articles/vercel-build-cache-not-shared-across-projects)」で書いたので合わせて読むと全体像が見えやすい。

---

参照:

- [Next.js 環境変数ドキュメント](https://nextjs.org/docs/app/guides/environment-variables)
- [TypeScript 4.9 `satisfies` 演算子](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html)
- [Tailwind CSS: クラスの静的検出](https://tailwindcss.com/docs/detecting-classes-in-source-files)

---

[SparMate](https://sparmate.cosoado-lab.com) — 格闘技の練習相手マッチング  
[NetaPair](https://netapair.cosoado-lab.com) — お笑いの相方探し  
[BoardLink](https://boardlink.cosoado-lab.com) — ボドゲ・TRPG 仲間募集  
[Cosoado Lab](https://cosoado-lab.com)
