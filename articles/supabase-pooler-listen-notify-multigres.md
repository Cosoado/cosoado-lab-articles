---
title: "Supabase の LISTEN/NOTIFY が pooler 越しで動かない問題、Multigres で解決"
emoji: "🔔"
type: "tech"
topics: ["supabase", "postgresql", "個人開発", "database", "typescript"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/supabase-pooler-listen-notify-multigres/

LISTEN を発行しても通知が届かない。エラーもなし。コードは正しい。なのに NOTIFY を撃っても完全に無音だった。

## TL;DR

- Supavisor **Transaction mode**（port 6543）では `LISTEN`/`NOTIFY` はセッション状態のため機能しない
- 2026 年 7 月 Multigres が pooler 越し LISTEN/NOTIFY に対応（Alpha / Kubernetes 向け）
- Supavisor v2.10.0 の `txn_mode_leak_action` でサイレント失敗を即エラーにできる
- 対処: `DIRECT_URL`（port 5432）専用 LISTEN クライアントか Realtime SDK

---

## Transaction pooler で LISTEN が死ぬ

NetaPair のマッチング確定通知をリリース前夜に実装していた。`pg_notify` → サーバー側 `LISTEN` という構成で、バックエンドから購読を立てた。

```typescript
// ❌ DATABASE_URL は Transaction pooler (port 6543) — LISTEN は機能しない
const sql = postgres(process.env.DATABASE_URL!)
await sql.listen('match_notify', payload => console.log(payload))
```

LISTEN 自体はエラーにならない。でも `pg_notify` を撃っても通知が一切届かない。30 分ほど別の原因を調べて、ようやく気づいた。**`DATABASE_URL` が Transaction pooler（port 6543）だった。**

これ、本番に 2 日間出てたやつです。ユーザーの問い合わせで気づいた。

## なぜ Transaction mode で LISTEN が機能しないか

PostgreSQL の LISTEN は **セッションスコープ**（[PostgreSQL: LISTEN](https://github.com/postgres/postgres/blob/master/doc/src/sgml/ref/listen.sgml)）。Supavisor の Transaction mode は「1 トランザクション = 1 接続の貸し出し」なので、`LISTEN` 発行直後にトランザクションが終わると接続がプールに返却されて購読が消える。NOTIFY を撃っても誰も受け取れない。

コマンド自体は成功するので、エラーにも警告にもならず静かに壊れる。なんで成功するんだ。[前の記事](https://zenn.dev/cosoado/articles/supabase-pooler-url-migration-vs-runtime)で migration と runtime の接続先を使い分ける話を書いたが、LISTEN/NOTIFY にはさらにもう一段ある。

## 対処: DIRECT_URL（port 5432）専用クライアント

`DIRECT_URL`（`db.[ref].supabase.co:5432`）は Transaction pooler を通らない direct connection でセッション状態を維持できる。

```typescript
const listenClient = postgres(process.env.DIRECT_URL!, {
  max: 1,          // LISTEN 用は 1 接続で足りる
  idle_timeout: 0,
})
await listenClient.listen('match_notify', payload => console.log(payload))
```

`max: 1` がポイント。Free プランは接続数が少ないため専用クライアント 1 本で使い回す。ブラウザ配信なら Realtime SDK が楽。

## Multigres で pooler 越しの LISTEN が動くようになった

[Supabase Developer Update v1.26.07（2026-07-09）](https://github.com/supabase/supabase/releases/tag/v1.26.07)で「Multigres supports LISTEN/NOTIFY across pooled connections」とアナウンスされた。

Multigres は Supabase 製の分散・シャーディング対応 PostgreSQL システム。内部の `multipooler` が LISTEN を発行したクライアントとの接続を「通知が届くまで保持する」実装になり、Transaction mode の制約をアーキテクチャレベルで解決した。現時点は **v0.1.0 Alpha**（[Multigres Kubernetes Operator](https://github.com/multigres/multigres-operator) 経由）で、マネージド Supabase クラウドにはまだ降りてきていない。

## Supavisor v2.10.0: `txn_mode_leak_action` でサイレント失敗を防ぐ

[Supavisor v2.10.0](https://github.com/supabase/supavisor/releases/tag/v2.10.0)（[PR #1113](https://github.com/supabase/supavisor/pull/1113)）に `txn_mode_leak_action` が追加された。Transaction mode でセッション状態を汚染するステートメント（`LISTEN`/`UNLISTEN`、セッション `SET`、WITH HOLD カーソルなど）を検知して 3 通りの動作をとれる。

| 値 | 動作 |
|---|---|
| `ignore`（デフォルト） | 従来通り素通り（通知は届かないまま） |
| `log` | 警告ログを出す |
| `error` | クライアントにエラーを返す |

`error` にすれば接続初期化の段階でクラッシュするので、自分がやったような「2 日間通知が届いていない」事態を早期発見できる。

## まとめ

| 状況 | 対処 |
|---|---|
| LISTEN が Transaction pooler（6543）に流れている | `DIRECT_URL`（5432）専用クライアントに切り替える |
| ブラウザへのリアルタイム配信 | Supabase Realtime SDK |
| サイレント失敗を検知したい | `txn_mode_leak_action: error`（Supavisor v2.10.0） |
| Kubernetes 自己ホスト環境 | Multigres v0.1.0 Alpha で pooler 越し LISTEN が動く |

「LISTEN はプーラー越しでは動かない」という長年の常識に Multigres が切り込んできた。マネージド環境に降りてきたとき、また書く。

---

参照:

- [Supabase v1.26.07 — Multigres LISTEN/NOTIFY](https://github.com/supabase/supabase/releases/tag/v1.26.07)
- [Supavisor v2.10.0 — txn_mode_leak_action](https://github.com/supabase/supavisor/releases/tag/v2.10.0)
- [Multigres Kubernetes Operator](https://github.com/multigres/multigres-operator)
- [前回: Supabase pooler URL を migration/runtime で使い分ける](https://zenn.dev/cosoado/articles/supabase-pooler-url-migration-vs-runtime)

---

[SparMate](https://sparmate.cosoado-lab.com) — 格闘技の練習相手マッチング  
[NetaPair](https://netapair.cosoado-lab.com) — お笑いの相方探し  
[BoardLink](https://boardlink.cosoado-lab.com) — ボドゲ・TRPG 仲間募集  
[Cosoado Lab](https://cosoado-lab.com)

作者: Cosoado / cosoadooo@gmail.com
