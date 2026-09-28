---
title: "Next.js 16 の middleware → Proxy API 移行で codemod が直せない落とし穴"
emoji: "🔀"
type: "tech"
topics: ["nextjs", "typescript", "vercel", "個人開発", "設計"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/nextjs16-middleware-to-proxy-migration/

Next.js 16 に上げたら「middleware.ts は deprecated です」という警告が出た。「proxy.ts にリネームするだけでしょ」と思って週末に対応したら、4 時間後に CI がまだ赤のままだった。

## TL;DR

- `middleware.ts` → `proxy.ts`（Proxy API）への移行は codemod がほぼ自動化してくれる
- codemod は `export const runtime = 'edge'` を**黙って削除する**。意図的な変更だが `git diff` で驚く
- `middleware.ts` と `proxy.ts` は同一リポジトリに**共存できない**。「1 アプリだけ先に試す」はできない
- codemod が触れないのは `middleware.ts` 以外のファイルの型注釈。`grep` で探して手動修正が必要

---

## Next.js 16 で middleware が deprecated になった

SparMate・NetaPair・BoardLink を同一 Next.js リポジトリから Vercel に 3 プロジェクトとして動かしている（詳細は[ジャンル設計の記事](https://zenn.dev/cosoado/articles/nextjs-env-var-genre-config-pattern)）。middleware.ts は 3 アプリ共有で、auth チェックと未ログインユーザーのリダイレクトを担っていた。

Next.js 16 にアップグレードしたビルドログに次の警告が出た。

```text
⚠ Middleware has been deprecated in favor of the Proxy API.
Run `npx @next/codemod@latest middleware-to-proxy .` to automatically migrate.
```

Proxy API は [PR #84764](https://github.com/vercel/next.js/pull/84764) で導入された。型のエイリアスで middleware と内部実装は同じ。変わったのはファイル名（`proxy.ts`）と型名（`NextProxy`、`ProxyConfig`）と関数名（`proxy`）だけだ。

「codemod があるなら 10 分で終わる」と思った。甘かった。

## codemod が自動でやること

```bash
npx @next/codemod@latest middleware-to-proxy .
```

これ 1 本で：ファイル名のリネーム、型インポートの書き換え（`NextMiddleware` → `NextProxy` など）、`next.config.ts` の設定キーの書き換え、そして `export const runtime = 'edge'` の削除をやってくれる。

最後の「runtime の削除」で戸惑った。Proxy API はデフォルトで Edge Runtime で動くため、この宣言が不要になる。だから codemod が消す。合理的な変更だが、`git diff` でこの行が消えているのを初めて見たとき「これ消していいのか？」と 30 分ほど悩んだ。[PR #84764 のコメント](https://github.com/vercel/next.js/pull/84764)を見て意図的な変更だと確認した後、そのままにした。

## 一番やらかした失敗：middleware.ts と proxy.ts の共存禁止

「まず SparMate だけ先に動作確認してから他の 2 アプリに展開しよう」と思って、`middleware.ts` を残したまま `proxy.ts` を追加してみた。即座に 3 つの Vercel プロジェクトが全部 build error で落ちた。

Next.js 16 は `middleware.ts` と `proxy.ts` の共存を許可しない（[Next.js 16.0.0 release notes](https://github.com/vercel/next.js/releases/tag/v16.0.0)）。3 プロジェクトが同一リポジトリなので、`proxy.ts` を 1 本追加した瞬間に 3 つの CI が一斉に落ちた。

段階的に移行しようとした発想が逆効果だった。codemod を使えば `middleware.ts` の削除と `proxy.ts` の作成が同時に行われるので、両方が存在する瞬間がない。codemod を 1 回走らせてそのまま push するのが正しい手順だった。

## codemod が触れなかった型注釈

middleware の処理を分割していたため、専用のラッパー関数があった。

```typescript
// lib/auth-guard.ts
import type { NextMiddleware } from 'next/server'

export function withAuth(handler: NextMiddleware): NextMiddleware {
  return async (req, event) => {
    const session = await getSession(req)
    if (!session) {
      return NextResponse.redirect(new URL('/login', req.url))
    }
    return handler(req, event)
  }
}
```

codemod は `middleware.ts` と `proxy.ts` しか見ない。`lib/auth-guard.ts` の `NextMiddleware` 型は手動で直す必要がある。TypeScript がエラーを出してくれたので気づけたが、型は実行時には消えるので気づかないまま動き続ける可能性もある。

移行後は次のコマンドで漏れを確認することを勧める。

```bash
grep -r "NextMiddleware\|MiddlewareConfig" --include='*.ts' --include='*.tsx' .
```

## 移行手順まとめ

1. `npx @next/codemod@latest middleware-to-proxy .` を実行
2. `git diff` で `export const runtime = 'edge'` が消えているのを確認（これは正しい）
3. `grep -r "NextMiddleware\|MiddlewareConfig"` で codemod が触れていない参照を手動修正
4. ビルドと動作確認

共存禁止のエラーを踏んでから正しい手順に気づくまで 2 時間かかった。先に知っていれば 30 分で終わっていた作業だった。

---

関連記事：

- [Next.js で env var 1 つで 3 アプリの配色・機能を切り替えるジャンル設計](https://zenn.dev/cosoado/articles/nextjs-env-var-genre-config-pattern) — 同一リポジトリ 3 アプリ構成の全体像
- [Next.js 16 で OGP 画像が 4 時間キャッシュされた話と minimumCacheTTL 移行](https://zenn.dev/cosoado/articles/nextjs16-image-cache-ttl-4h-ogp-stale) — Next.js 16 移行シリーズ

---

[SparMate](https://sparmate.cosoado-lab.com) — 格闘技の練習相手マッチング  
[NetaPair](https://netapair.cosoado-lab.com) — お笑いの相方探し  
[BoardLink](https://boardlink.cosoado-lab.com) — ボドゲ・TRPG 仲間募集  
[Cosoado Lab](https://cosoado-lab.com)
