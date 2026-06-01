---
title: "App Router の opengraph-image.tsx でジャンル別 OG 画像を動的生成する"
emoji: "🖼"
type: "tech"
topics: ["nextjs", "satori", "opengraph", "vercel", "個人開発"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/nextjs-app-router-dynamic-og-image-by-genre/

## TL;DR

- Next.js 13.3 で追加された `opengraph-image.tsx` ファイル規約に `ImageResponse`（`next/og`）を組み合わせると、API Route 不要でルートごとに異なる OG 画像を生成できる
- 動的ルートの `params` を受け取るだけでジャンル別に配色・テキスト・レイアウトを切り替えられる
- 日本語を描画するにはフォントを明示的に渡す必要があり、**WOFF2 は非対応**（TTF/OTF/WOFF を使う）
- Edge Runtime は必須ではないが、cold start を抑えるため推奨

---

対象読者: Next.js App Router を使っていて、複数ジャンルのページに異なるデザインの OG 画像を設定したい個人開発者。

---

## 同じ OG 画像が 3 ジャンルを汚染していた

SparMate（スポーツマッチング）、NetaPair（ネタ系交流）、BoardLink（ボードゲーム）の 3 つのアプリを 1 つの Next.js リポジトリから環境変数で派生させて運用している。リリース当初、面倒だったので `/public/og-default.png` を全アプリで共通使用していた。

X（旧 Twitter）に BoardLink のリンクを貼ったとき、返ってきたのが「これスポーツアプリ？」というリプ。見れば、スポーツテーマの青いアイコン入り OG 画像が BoardLink に堂々と表示されていた。完全に嘘の情報を流していた。

慌てて直そうとして最初にやったのが `sharp` を使った `/api/og` エンドポイントだった。**これが一番やった失敗**で、Edge Runtime では `sharp` が動かない（Node.js の native addon 依存）。じゃあ Serverless Function にしようとしたら今度は cold start が 3〜4 秒になって、SNS クローラーが OG 画像を拾わない問題が再発した。

`next/og`（内部は [Satori](https://github.com/vercel/satori)）に書き直してすべて解決した。以下がそのパターン。

---

## opengraph-image.tsx の基礎

Next.js 13.3 から、`app/` ディレクトリに `opengraph-image.tsx` を置くと、そのルートの `<meta property="og:image">` に自動で紐付けられる。参照: [Next.js 公式ドキュメント](https://nextjs.org/docs/app/api-reference/file-conventions/opengraph-image)

最小構成:

```tsx
// app/opengraph-image.tsx
import { ImageResponse } from "next/og";

export const alt = "Cosoado Lab";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        background: "#0f172a",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 64,
        color: "#fff",
      }}
    >
      Cosoado Lab
    </div>,
    size
  );
}
```

`ImageResponse` の第 1 引数は JSX（Satori が SVG → PNG に変換）、第 2 引数はオプション（`width` / `height` / `fonts` など）。`next/og` は Next.js 13.3 から同梱されており、`@vercel/og` を別途インストールする必要はない。

---

## ジャンル別に動的生成する

動的ルート `[genre]` に `opengraph-image.tsx` を配置し、`params` を受け取ればジャンルごとに異なる画像を返せる。

```text
app/
  [genre]/
    page.tsx
    opengraph-image.tsx   ← ここに置く
```

```tsx
// app/[genre]/opengraph-image.tsx
import { ImageResponse } from "next/og";

export const runtime = "edge"; // 推奨（cold start を抑える）
export const alt = "Cosoado Lab アプリ";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GENRE_CONFIG = {
  sports: {
    bg: "#1e3a5f",
    accent: "#3b82f6",
    label: "スポーツマッチング",
    emoji: "⚽",
  },
  neta: {
    bg: "#2d1b4e",
    accent: "#a855f7",
    label: "ネタ系交流",
    emoji: "😂",
  },
  boardgame: {
    bg: "#1a2e1a",
    accent: "#22c55e",
    label: "ボードゲーム",
    emoji: "🎲",
  },
} as const;

type Genre = keyof typeof GENRE_CONFIG;

// Next.js 15 以降、params は Promise になった
interface Props {
  params: Promise<{ genre: string }>;
}

export default async function Image({ params }: Props) {
  const { genre } = await params;

  // 未知のジャンルには fallback を用意しておく
  const config = GENRE_CONFIG[genre as Genre] ?? {
    bg: "#0f172a",
    accent: "#64748b",
    label: genre,
    emoji: "🔗",
  };

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: config.bg,
        width: "100%",
        height: "100%",
        padding: "80px",
        justifyContent: "space-between",
      }}
    >
      {/* ジャンルラベル */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "24px",
          fontSize: 56,
        }}
      >
        <span>{config.emoji}</span>
        <span style={{ color: config.accent, fontWeight: 700 }}>
          {config.label}
        </span>
      </div>

      {/* フッター */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <span style={{ color: "#fff", fontSize: 28, opacity: 0.6 }}>
          Cosoado Lab
        </span>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: config.accent,
          }}
        />
      </div>
    </div>,
    size
  );
}
```

**Next.js 14 以前**を使っている場合は `params` が Promise でなく直接オブジェクトになるため、`interface Props { params: { genre: string } }` に変更し、`await` を外す。

`GENRE_CONFIG` の fallback を省略すると、存在しないジャンルで `undefined` アクセスが静かに起きる。発見しにくいバグなので必ず入れておく。

---

## 日本語テキストを描画するフォント設定

Satori のデフォルトは欧文フォントのみ。日本語を含めるにはフォントデータを `fonts` オプションに渡す必要がある。

**注意: Satori は WOFF2 非対応**。TTF / OTF / WOFF のみ受け付ける（[Satori fonts ドキュメント](https://github.com/vercel/satori#fonts)）。最初に Google Fonts の WOFF2 URL を渡してエラーになったとき、ドキュメントをよく読まなかった自分への戒めとして書いておく。

```tsx
// フォントをプロジェクト内に配置する場合
// public/fonts/NotoSansJP-Regular.ttf を配置

export default async function Image({ params }: Props) {
  const { genre } = await params;
  const config = GENRE_CONFIG[genre as Genre] ?? {
    bg: "#0f172a",
    accent: "#64748b",
    label: genre,
    emoji: "🔗",
  };

  // Edge Runtime では fs が使えないため fetch で取得
  const fontData = await fetch(
    new URL("/fonts/NotoSansJP-Regular.ttf", "https://sparmate.cosoado-lab.com")
  ).then((res) => res.arrayBuffer());

  return new ImageResponse(
    /* 省略: 前述と同じ JSX */,
    {
      ...size,
      fonts: [
        {
          name: "NotoSansJP",
          data: fontData,
          style: "normal",
          weight: 400,
        },
      ],
    }
  );
}
```

フォントファイルを毎回 fetch するのはリクエストごとにコストがかかるため、本番では Route Handler の外でキャッシュするか、フォントサブセット化ツール（`pyftsubset` など）で使用文字だけに削減しておくと高速化できる。

---

## よくはまる落とし穴

| 症状 | 原因 | 対処 |
|---|---|---|
| `sharp` がビルド/実行エラー | Edge Runtime は native addon 非対応 | `next/og` に切り替える |
| 日本語が□になる | デフォルトフォントに日本語なし | TTF/OTF フォントを `fonts` に渡す |
| フォント渡して `Error: unkn...` | WOFF2 を渡している | TTF / OTF / WOFF 形式を使う |
| `calc()` が無視される | Satori 非対応 | 固定値か Flexbox で代替 |
| `grid` レイアウトが崩れる | Satori 非対応（Flexbox のみ） | `flexDirection` で再設計 |
| OG 画像がいつまでも古い | SNS 側のキャッシュ | Card Validator などで強制更新 |
| `params` が `Promise` でエラー | Next.js 15 の破壊的変更 | `await params` に変更する |

Satori の CSS サポート範囲は [公式リスト](https://github.com/vercel/satori#css) で確認するのが早い。CSS Grid / `calc()` / `position: absolute`（部分対応）など、ブラウザと同じ感覚で書くと予想外に動かないプロパティがある。

---

## まとめ

`app/[genre]/opengraph-image.tsx` に `ImageResponse` を置くだけで、動的ルートの `params` から OG 画像をジャンル別に生成できる。`GENRE_CONFIG` で型安全にマッピングしておくと、ジャンルを追加するときに修正点が 1 箇所で済む。

日本語対応は「フォント形式が TTF/OTF/WOFF であること」を最初に確認する。WOFF2 で時間を溶かさないために。

次回は、この OG 画像生成と合わせて `metadata.ts` で `twitter:card` / `robots` / `alternates` を一括管理するパターンを書く予定。

---

この記事で紹介したパターンを実際に使用しているプロダクト:

- [SparMate](https://sparmate.cosoado-lab.com) — スポーツマッチングアプリ
- [NetaPair](https://netapair.cosoado-lab.com) — ネタ系交流マッチングアプリ
- [BoardLink](https://boardlink.cosoado-lab.com) — ボードゲームマッチングアプリ
- [Cosoado Lab](https://cosoado-lab.com) — 個人開発ラボ
