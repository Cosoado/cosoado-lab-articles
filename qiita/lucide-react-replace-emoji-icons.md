---
title: "lucide-react で絵文字アイコンを一掃する—App Router 統一アイコン設計 3 ステップ"
tags: ["React", "Next.js", "lucide-react", "TypeScript", "個人開発"]
published: true
qiita_id: "c494f7a2061e56ccc0c0"
qiita_url: "https://qiita.com/Cosoado/items/c494f7a2061e56ccc0c0"
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/lucide-react-replace-emoji-icons/

## TL;DR

- 絵文字アイコンは OS・端末フォント依存で文字化けする
- [lucide-react](https://www.npmjs.com/package/lucide-react) v1.20.0 に統一すれば崩れない。サイズ・色・太さを props で一元管理できる
- インストール → 薄型ラッパー作成 → 全置換の 3 ステップ、1 日以内で完了
- App Router の Server Component でもそのまま動く。`next/dynamic` を噛ませると逆にハイドレーションエラーになる

---

先月、知人から「ボタンが豆腐になってるんだけど」とスクリーンショットが届いた。自分の Mac と iPhone でしか動作確認していなかったツケで、Android 10 の端末では 📋 と 🔗 が □ に化けていた。絵文字は OS バージョンとインストールフォントに依存するため、古い Android や一部の Windows 環境では描画できないコードポイントが存在する。

その晩、全アイコンを lucide-react に置き換えた。

## 絵文字がアイコンに向かない 3 つの理由

1. **OS・フォント依存**：同じ Unicode コードポイントでも Android 10 以前、Windows 10、macOS では見た目が異なる。描画できない環境では □（豆腐）になる
2. **CSS スタイルが効かない**：`color` プロパティで色を変えても反映が不安定。`font-size` の微調整も効きにくい
3. **ダークモード非対応**：白地前提の絵文字が暗い背景に浮く。システムのカラースキームに自動追従する手段がない

SVG アイコンライブラリに移行すれば、これら 3 つがまとめて解消する。

## Step 1. lucide-react をインストールする

```bash
npm install lucide-react
# または
pnpm add lucide-react
```

[npm の lucide-react ページ](https://www.npmjs.com/package/lucide-react) で最新バージョンを確認できる。本記事執筆時点の最新は v1.20.0。

lucide-react は Feather icons から派生した MIT ライセンスの SVG アイコンセットで、1,500 以上のアイコンを収録している。各アイコンは独立した named export になっているため、使ったアイコン以外はビルド時にツリーシェイキングで除外される。バンドルサイズへの影響は最小限。

## Step 2. 薄型ラッパーコンポーネントを作る

アイコンをコードベース全体に直接散らばらせると、`size` や `strokeWidth` の指定がバラバラになる。まずプロジェクト共通のデフォルト値を 1 箇所に集約するラッパーを作る。

```tsx
// components/icon.tsx
import { type LucideIcon } from "lucide-react";

type IconProps = {
  Icon: LucideIcon;
  size?: number;
  className?: string;
  strokeWidth?: number;
};

export function Icon({
  Icon,
  size = 16,
  strokeWidth = 1.5,
  className,
}: IconProps) {
  return (
    <Icon size={size} strokeWidth={strokeWidth} className={className} />
  );
}
```

lucide-react が受け取る主なプロパティ：

| prop | 型 | デフォルト | 説明 |
|---|---|---|---|
| `size` | `number \| string` | 24 | 幅・高さ（px） |
| `strokeWidth` | `number` | 2 | 線の太さ |
| `color` | `string` | `currentColor` | CSS color を継承 |
| `absoluteStrokeWidth` | `boolean` | false | サイズ変更時に線幅を拡縮しない |
| `className` | `string` | — | Tailwind 等のクラスを渡せる |

`color` のデフォルトが `currentColor` なので、親要素の `text-gray-500` や `dark:text-gray-400` でそのまま色が変わる。ダークモードにも自動追従する。

## Step 3. 絵文字を lucide アイコンに置き換える

よく使う絵文字と対応するコンポーネント名の対照表：

| 絵文字 | lucide コンポーネント | 用途例 |
|---|---|---|
| 📋 | `ClipboardList` | フォーム、コピー操作 |
| 🔗 | `Link` | URL 共有 |
| ✅ | `CircleCheck` | 完了ステータス |
| ❌ | `CircleX` | エラー、削除確認 |
| 🔍 | `Search` | 検索入力フィールド |
| ⚙️ | `Settings` | 設定画面 |
| 🔔 | `Bell` | 通知バッジ |
| 👤 | `User` | プロフィール |
| ⭐ | `Star` | お気に入り登録 |
| 🏠 | `House` | ホームへ戻る |

実際の置換コード：

```tsx
// Before
<button>📋 コピー</button>

// After
import { ClipboardList } from "lucide-react";
import { Icon } from "@/components/icon";

<button className="flex items-center gap-1">
  <Icon Icon={ClipboardList} size={14} />
  コピー
</button>
```

アイコン名は **PascalCase**。lucide の命名規則は `kebab-case` をそのまま PascalCase に変換したものになっている（例: `circle-check` → `CircleCheck`、`clipboard-list` → `ClipboardList`）。どのアイコンが何という名前かは [lucide.dev/icons](https://lucide.dev/icons/) の検索が早い。

## ハマったこと

### ① `next/dynamic` を噛ませたらハイドレーションエラーが大量発生した

「アイコンが多いから遅延読み込みにしよう」と思って `next/dynamic` を使った。

```tsx
// ❌ これはやってはいけない
import dynamic from "next/dynamic";

const ClipboardList = dynamic(() =>
  import("lucide-react").then((m) => ({ default: m.ClipboardList }))
);
```

結果、`Warning: Expected server HTML to contain a matching...` のハイドレーション不一致が大量発生した。サーバーでは null レンダリング、クライアントでアイコンが遅れて登場するタイミングが合わず、SSR と CSR の出力が一致しないのが原因。

これが一番やった失敗で、先に気づくべきだった。lucide-react の各アイコンはただの SVG コンポーネントで、サーバー・クライアント両方でそのまま同期レンダリングできる。dynamic import は不要で、むしろ有害。

```tsx
// ✅ そのまま named import で足りる
import { ClipboardList } from "lucide-react";
```

### ② マイナーバージョンアップでアイコン名が変わっていた

lucide はアイコン名を定期的に整理する。`Clipboard` が `ClipboardList` に変わった例のように、パッケージ更新後にビルドが通らなくなることがある。更新時は [lucide の GitHub releases](https://github.com/lucide-icons/lucide/releases) の Breaking Changes セクションを確認する習慣をつけておくと安心。

### ③ `size` に Tailwind クラス名を渡してレイアウトが崩れた

`size="text-sm"` のように文字列を渡すと、`width="text-sm"` という不正な SVG 属性になりレイアウトが崩れる。`size` prop は数値（px）専用。Tailwind でサイズを制御したい場合は `className="h-4 w-4"` を使う。

## まとめ

絵文字アイコンから lucide-react への移行は、作業量としては 1 日以内で終わった。OS・フォント依存から解放されて、ダークモード対応が自動になる。個人開発でもプロダクション環境でも、早めにやっておいて損のない一手だと思う。

App Router でのキャッシュ挙動も以前ハマったのでまとめている。同じ Next.js スタックで開発している人は [fetch に no-store を設定しないと静かに古いデータが出る理由](https://qiita.com/Cosoado/items/4a5c61d2ae5de57659df) もどうぞ。
