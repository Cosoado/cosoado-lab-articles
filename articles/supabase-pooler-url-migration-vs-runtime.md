---
title: "Supabase pooler URL を migration/runtime で正しく使い分ける方法"
emoji: "🔌"
type: "tech"
topics: ["supabase", "prisma", "drizzle", "nextjs", "個人開発"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/supabase-pooler-url-migration-vs-runtime/

## TL;DR

- **migration 時**: `DIRECT_URL`（`db.[ref].supabase.co:5432`）を必ず使う
- **runtime（API ルート・サーバーレス）**: `DATABASE_URL`（`pooler.supabase.com:6543`, Transaction mode）を使う
- 2025 年 2 月 28 日以降、port 6543 は Transaction mode 専用になった
- Drizzle + Transaction mode では `prepare: false` を設定しないと本番で 500 エラーが出る

---

## なぜ接続先を分けないといけないのか

NetaPair のリリース直前、Vercel にデプロイした本番環境で `prisma migrate deploy` を走らせたところ、コマンドが無音で止まった。エラーメッセージゼロ。Ctrl+C するまで 20 分間フリーズしていた。

原因を探って判明したのは単純なことで、`.env` の `DATABASE_URL` に **pooler の URL（port 6543）を設定したまま migration を実行していた**だけだった。先に読んでいれば 1 分で防げた話なのに、リリース当日の夜に 1 時間溶かした。

Supabase の接続には大きく 2 種類あり、どちらを何に使うかを混同するとこういう目に遭う。

## Transaction mode と direct connection の違い

Supabase の接続プーラーは現在 **Supavisor**（Elixir 製）が担っている。旧来の PgBouncer からは 2023 年頃に移行済みで、ダッシュボードに表示される接続文字列もすでに Supavisor ベースになっている。

| | Transaction pooler | Direct connection |
|---|---|---|
| ホスト | `aws-0-[region].pooler.supabase.com` | `db.[project-ref].supabase.co` |
| ポート | **6543** | **5432** |
| 接続の持ち方 | トランザクション単位で共有 | セッション全体で専有 |
| prepared statements | **非対応** | 対応 |
| `SET session_replication_role` | **非対応** | 対応 |
| migration | **禁止** | 推奨 |
| Vercel などサーバーレス | 推奨 | 非推奨（接続数爆発） |

**Transaction mode** は、1 トランザクション分だけバックエンド接続を借りてすぐ返却する。Vercel の関数インスタンスが大量に立ち上がっても接続数が爆発しないのはこの仕組みがあるから。一方で、セッション状態を必要とする処理が一切できない。

`prisma migrate deploy` や Supabase CLI の `db push` は内部で `SET session_replication_role = 'replica'` を発行するため、Transaction mode のプーラー越しでは動かない。コマンドがハングする理由はここにある。

## 2025 年 2 月以降のポート整理

以前は port 6543 で Session mode を使うオプションもあったが、[Supabase の changelog](https://supabase.com/changelog/32755-supabase-connection-pooler-deprecating-session-mode-on-port-6543-on-february-28) によると 2025 年 2 月 28 日に廃止された（[GitHub ディスカッション #32755](https://github.com/orgs/supabase/discussions/32755) でも告知済み）。

現在のポートの役割は明確だ：

- **port 6543** → Transaction mode のみ（runtime 専用）
- **port 5432** → Session mode または direct connection（migration 向け）

古い設定が残っている場合（`port=6543` で migration を走らせているなど）は今すぐ修正したい。

## 環境変数の設定

Supabase ダッシュボードの **Project Settings → Database** に行くと「Connection string」セクションに接続文字列が複数種類表示されている。`Transaction`（port 6543）と `Direct connection`（port 5432）の 2 つを取得する。

```bash
# .env.local
# ↓ Supabase ダッシュボード → Project Settings → Database → "Transaction" タブからコピー
DATABASE_URL="<Transaction pooler URL (port 6543)>"

# ↓ Supabase ダッシュボード → Project Settings → Database → "Direct connection" タブからコピー
DIRECT_URL="<Direct connection URL (port 5432)>"
```

Transaction pooler の URL はホスト `aws-0-[region].pooler.supabase.com`、ポート `6543`。Direct connection は `db.[project-ref].supabase.co`、ポート `5432` という構成になっている。`[project-ref]` は Supabase のプロジェクト ID、`[region]` は `ap-northeast-1` などの AWS リージョン。

## Prisma での設定

### Prisma v6 以前

`schema.prisma` の `datasource` ブロックに `directUrl` を追加する。CLI はこちらを使い、`PrismaClient` は `url` を使う。[Prisma 公式の Supabase ガイド（v6）](https://www.prisma.io/docs/orm/v6/overview/databases/supabase) に詳細がある。

```prisma
// schema.prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // pooler (port 6543) — runtime
  directUrl = env("DIRECT_URL")     // direct (port 5432) — migration
}
```

`prisma migrate deploy` や `prisma db push` は自動的に `directUrl` を参照してくれる。

### Prisma v7 以降

Prisma v7.2.0 以降、`schema.prisma` から URL を直接指定する方法が廃止された（[Discussion #28700](https://github.com/prisma/prisma/discussions/28700)）。代わりに `prisma.config.ts` で migration 時の接続を定義し、runtime 用は `PrismaPg` コンストラクタで指定する。

```typescript
// prisma.config.ts — CLI が参照する (migration 用)
import { defineConfig } from 'prisma/config'

export default defineConfig({
  earlyAccess: true,
  schema: './prisma/schema.prisma',
  migrate: {
    async adapter() {
      const { PrismaPg } = await import('@prisma/adapter-pg')
      // DIRECT_URL を使う — direct connection (port 5432)
      return new PrismaPg({ connectionString: process.env.DIRECT_URL! })
    },
  },
})
```

```typescript
// src/lib/db.ts — アプリが参照する (runtime 用)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// DATABASE_URL を使う — pooler (port 6543)
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
export const prisma = new PrismaClient({ adapter })
```

## Drizzle ORM での設定

Drizzle は `drizzle.config.ts`（migration 用）と runtime のクライアント初期化で URL を分けるだけ。[Drizzle 公式の Supabase チュートリアル](https://orm.drizzle.team/docs/tutorials/drizzle-with-supabase) にも記載がある。

```typescript
// drizzle.config.ts — drizzle-kit push/migrate が参照 (migration 用)
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DIRECT_URL!,  // direct connection (port 5432)
  },
})
```

```typescript
// src/lib/db.ts — API ルートが参照 (runtime 用)
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@/db/schema'

// prepare: false は Transaction mode では必須
const client = postgres(process.env.DATABASE_URL!, { prepare: false })
export const db = drizzle(client, { schema })
```

## 落とし穴 2 点

### `prepare: false` を忘れると本番だけ落ちる

これも自分でやった失敗だ。Drizzle + Transaction mode の組み合わせで `prepare: false` を書かずに Vercel に上げたとき、同じ API ルートへの 2 回目のリクエストから `ERROR: prepared statement "xxx" already exists` が出て 500 エラーになった。

ローカル（通常の PostgreSQL 直接接続）では問題なく動くので、本番にデプロイするまで全く気づかない。Vercel のログを見てエラーの原因を調べるまで「コードのバグかな」と 30 分ほど無駄にした。Transaction mode は named prepared statement をセッション間で共有できないため、`prepare: false` でステートレスなクエリに落とす必要がある。

### migration コマンドがハングする

冒頭に書いた通り、`DATABASE_URL`（port 6543）を `directUrl` の代わりに使うと `prisma migrate deploy` が無音でフリーズする。タイムアウトエラーも出ない。CI/CD パイプラインに組み込んでいると、Vercel のビルドが延々と続いてタイムアウト扱いになるだけなので原因特定が余計に難しい。

`.env` に `DIRECT_URL` を追加して `schema.prisma`（または `prisma.config.ts`）に正しく設定すれば解消する。

## まとめ

| 用途 | 環境変数 | ホスト | ポート |
|---|---|---|---|
| migration (prisma/drizzle-kit) | `DIRECT_URL` | `db.[ref].supabase.co` | 5432 |
| runtime (API ルート) | `DATABASE_URL` | `...pooler.supabase.com` | 6543 |

2025 年 2 月以降、port 6543 は Transaction mode 専用になっているので、古い設定が残っていれば今すぐ確認したい。Drizzle は `prepare: false` を忘れずに。

次回は [`pg_policies` ビューで RLS を一括棚卸しする 1 行クエリ](https://zenn.dev/cosoado) を書く予定。

---

## 参照リンク

- [Supabase Changelog: Session Mode on Port 6543 廃止](https://supabase.com/changelog/32755-supabase-connection-pooler-deprecating-session-mode-on-port-6543-on-february-28)
- [GitHub Discussion #32755: Session Mode 廃止の告知](https://github.com/orgs/supabase/discussions/32755)
- [Prisma 公式 Supabase ガイド（v6）](https://www.prisma.io/docs/orm/v6/overview/databases/supabase)
- [Prisma Discussion #28700: directUrl deprecated in v7](https://github.com/prisma/prisma/discussions/28700)
- [Drizzle ORM: Drizzle with Supabase Database](https://orm.drizzle.team/docs/tutorials/drizzle-with-supabase)

---

## Cosoado Lab のプロダクト

- [SparMate](https://sparmate.cosoado-lab.com) — スパーリング相手を見つけるマッチングアプリ
- [NetaPair](https://netapair.cosoado-lab.com) — アイデアとエンジニアをマッチング
- [BoardLink](https://boardlink.cosoado-lab.com) — 個人開発チームのタスク管理
- [Cosoado Lab](https://cosoado-lab.com) — 個人開発ラボ

作者: Cosoado / cosoadooo@gmail.com
