---
title: "pg_policies で Supabase の RLS ポリシーを一括棚卸する SQL 3 本"
emoji: "🔍"
type: "tech"
topics: ["supabase", "postgresql", "rls", "security", "個人開発"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/pg-policies-rls-audit-query/

## TL;DR

3 本のクエリで Supabase プロジェクトの RLS 状態を全部把握できます。

| クエリ | 目的 | 危険度 |
|---|---|---|
| A | 全ポリシー一覧（USING / WITH CHECK 付き） | — |
| B | **RLS 有効なのにポリシーが 0 件のテーブル** | 🔴 高（データが全員に不可視） |
| C | RLS が無効なテーブル | 🟡 中（全行が認証なしに露出） |

---

## なぜ棚卸しが必要か

BoardLink を作っていた頃、`boards` テーブルに「ユーザーは自分のボードだけ見える」SELECT ポリシーを追加した翌日、別のアカウントでログインしてみると一覧が 0 件を返すようになりました。Supabase Dashboard の Table Editor でデータがある行を確認できる。でもアプリ側では空。

原因を 40 分かけて追って、RLS ポリシーの `to authenticated` を誤って `to anon` と書いていたのがわかりました。でもそのとき同時に気づいたのが、**テーブル一覧と全ポリシーを横断して見る手段を持っていない**という事実でした。テーブルが増えるにつれてどのテーブルにどのポリシーがついているかが頭から抜け落ちていく。Dashboard のポリシー画面はテーブル単位でしか見せてくれないので、プロジェクト全体の俯瞰には向きません。

`pg_policies` ビューを使えば SQL エディタ 1 本で全体像が取れます。

## pg_policies ビューの構造

[PostgreSQL 公式ドキュメント（53.15. pg_policies）](https://www.postgresql.org/docs/current/view-pg-policies.html) によると、`pg_policies` は次のカラムを持ちます。

| カラム | 型 | 内容 |
|---|---|---|
| `schemaname` | name | スキーマ名 |
| `tablename` | name | テーブル名 |
| `policyname` | name | ポリシー名 |
| `permissive` | text | `PERMISSIVE` または `RESTRICTIVE` |
| `roles` | name[] | 適用ロール（空配列 = PUBLIC） |
| `cmd` | text | `SELECT` / `INSERT` / `UPDATE` / `DELETE` / `ALL` |
| `qual` | text | `USING` 式（NULL の場合あり） |
| `with_check` | text | `WITH CHECK` 式（NULL の場合あり） |

`qual` と `with_check` が片方 NULL のポリシーは意図しない穴になりやすい。別記事の [WITH CHECK と USING の罠](https://zenn.dev/cosoado/articles/supabase-rls-with-check-vs-using-pitfall) で詳しく書いています。

## クエリ A: 全ポリシーを USING / WITH CHECK 付きで一覧する

```sql
select
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual       as using_expr,
  with_check as with_check_expr
from pg_policies
where schemaname = 'public'
order by tablename, cmd;
```

私はこれを Supabase SQL エディタのお気に入りに登録しています。ポリシーを追加したらこれを流して `cmd = 'UPDATE'` の行に `using_expr` が入っているか確認する、というルーティンです。`roles` が `{}` の場合は `PUBLIC`（認証の有無を問わず全員）に適用されていることを意味するので注意します。

## クエリ B: RLS 有効なのにポリシーが 0 件のテーブルを探す

これが一番やった失敗です。`ALTER TABLE xxx ENABLE ROW LEVEL SECURITY` で RLS を有効にしたまま、対応するポリシーを書き忘れた状態です。PostgreSQL の仕様では、**RLS が有効でポリシーが 0 件のテーブルは、superuser と BYPASSRLS ロールを除く全ユーザーに 0 行を返します**。エラーは出ないので見つけにくい。

```sql
select t.tablename
from pg_tables t
left join pg_policies p
  on p.schemaname = t.schemaname
  and p.tablename = t.tablename
where t.schemaname = 'public'
  and t.rowsecurity = true
  and p.policyname is null;
```

`pg_tables.rowsecurity` は PostgreSQL 9.5 以降で使えます。Supabase の managed インスタンスは 2024 年時点で 15.x を使用しているので問題ありません（[Supabase — Row Level Security ドキュメント](https://supabase.com/docs/guides/database/postgres/row-level-security)）。

私の場合は `connections` テーブルがこの状態で、「マッチングしたはずなのにリストが空」という問い合わせが来るまで本番で 2 日間気づいていませんでした。先に気づくべきでした。

## クエリ C: RLS が無効なテーブルを探す

```sql
select tablename, tableowner
from pg_tables
where schemaname = 'public'
  and rowsecurity = false;
```

Supabase の `anon` キーから全行にアクセスできるテーブルの一覧です。開発中は意図的に RLS を切っているテーブルがあっても問題ないですが、本番前に必ず確認します。マイグレーション管理用の内部テーブルが引っかかることがあるので、意図的な除外はコメントで残しておくと後で迷わずに済みます。

## 3 つをまとめてひとつのクエリで把握する

```sql
select
  t.tablename,
  t.rowsecurity                        as rls_on,
  count(p.policyname)                  as policy_count,
  array_agg(distinct p.cmd order by p.cmd)
    filter (where p.cmd is not null)   as commands
from pg_tables t
left join pg_policies p
  on p.schemaname = t.schemaname
  and p.tablename = t.tablename
where t.schemaname = 'public'
group by t.tablename, t.rowsecurity
order by t.tablename;
```

結果の読み方はこうです。

| rls_on | policy_count | 意味 |
|---|---|---|
| `true` | `0` | 🔴 危険：全員に 0 行が返る |
| `true` | 1 以上 | ✅ 正常 |
| `false` | — | 🟡 要確認：RLS なしで全行露出 |

## はまりどころ: SQL エディタは RLS をバイパスする

Supabase の SQL エディタは `postgres` ロールで実行されます。`postgres` ロールは `BYPASSRLS` 属性を持っているため、**SQL エディタで全行見えていてもアプリ側で 0 件になる**、という逆の落とし穴もあります。

ポリシーの動作確認は実際のクライアント SDK（`supabase-js` など）から行うか、次のように一時的にロールを切り替えてテストします。

```sql
set local role authenticated;
set local "request.jwt.claim.sub" = '<user-uuid>';
select * from boards;
reset role;
```

`<user-uuid>` は確認したいユーザーの UUID（`auth.users` で調べられます）に置き換えてください。

## まとめ

- `pg_policies` でプロジェクト全体のポリシーを一覧できる
- `pg_tables.rowsecurity = true` かつ `pg_policies` に行なし → **全員に 0 行が返る**、エラーなしの罠
- `rowsecurity = false` のテーブルは RLS なしで全行が露出
- SQL エディタは `BYPASSRLS` なので SDK 経由または `set local role` で動作確認する

RLS の `USING` / `WITH CHECK` の使い分けは [Supabase RLS の UPDATE ポリシーで USING を省くと他人データを乗っ取れる](https://zenn.dev/cosoado/articles/supabase-rls-with-check-vs-using-pitfall)、`auth.uid()` のパフォーマンス最適化は [Supabase RLS で auth.uid() を毎行呼び出さないための 1 行の書き換え](https://zenn.dev/cosoado/articles/supabase-rls-auth-uid-perf) で書いています。3 本あわせて読むと RLS 周りの主要な落とし穴は揃います。

---

[SparMate](https://sparmate.cosoado-lab.com) — 格闘技の練習相手マッチング  
[NetaPair](https://netapair.cosoado-lab.com) — お笑いの相方探し  
[BoardLink](https://boardlink.cosoado-lab.com) — ボドゲ・TRPG 仲間募集  
[Cosoado Lab](https://cosoado-lab.com)
