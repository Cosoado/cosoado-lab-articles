---
title: "Supabase RLS で auth.uid() を毎行呼び出さないための 1 行の書き換え"
emoji: "⚡"
type: "tech"
topics: ["supabase", "postgresql", "rls", "個人開発", "パフォーマンス"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/supabase-rls-auth-uid-perf/

## TL;DR

```sql
-- ❌ 遅い: auth.uid() が行ごとに呼ばれる
using ( auth.uid() = user_id )

-- ✅ 速い: 1 ステートメントに 1 回だけ評価される
using ( (select auth.uid()) = user_id )
```

これだけで、Supabase 公式ベンチで [**179ms → 9ms（94.97% 改善）**](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select)。RLS を有効にしてクエリが遅くなった、という個人開発者向けの 1 トピックです。

## はじめに

Supabase の Row Level Security (RLS) は強力ですが、書き方を間違えると **行数に比例して遅くなる**罠があります。

私はマッチングアプリ（[SparMate](https://sparmate.cosoado-lab.com) ほか 2 本）を Supabase で運用していて、`profiles` テーブルが数千件を超えたあたりから検索系のクエリが目に見えて重くなりました。原因は RLS の `auth.uid()` を毎行呼び出していたこと。

修正は **1 行**です。この記事では、なぜ遅いのか・なぜ修正で速くなるのか・もう一段階速くする `to authenticated` の追加までを書きます。

## なぜ遅いのか

典型的な「自分のデータだけ見える」ポリシーはこう書きます。

```sql
create policy "users can read own profile"
on profiles for select
using ( auth.uid() = user_id );
```

`auth.uid()` は **`LANGUAGE sql` の `STABLE` 関数**で、内部では `current_setting('request.jwt.claim.sub')` を読んで JWT の `sub` を返しています。STABLE なのでトランザクション内では同じ値を返すはずですが、書き方によってはプランナがこの式を **行ごとに再評価**してしまいます。1,000 行のテーブルなら 1,000 回の関数呼び出しです。

- 1 万件の `profiles` で `select * from profiles` を投げると、auth.uid() を 1 万回呼ぶ
- 100 件取りたいだけでも、ポリシーは全行に対して評価される（フィルタ前）

これが「RLS にしてから遅くなった」の正体です。

## 修正 1: auth.uid() を SELECT で包む

修正版はこう。

```sql
create policy "users can read own profile"
on profiles for select
using ( (select auth.uid()) = user_id );
```

`(select auth.uid())` と書くと、Postgres プランナが **`initPlan`** として認識し、**1 ステートメントにつき 1 回だけ評価して結果をキャッシュ**します。

公式 docs ([Supabase — RLS performance](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select)) のベンチマークでは：

| 書き方 | 実行時間 |
|---|---|
| `auth.uid() = user_id` | 179 ms |
| `(select auth.uid()) = user_id` | 9 ms |

**約 95% 改善**。`security definer` な関数を呼ぶケースだと **99.993%（178 秒 → 12ms）** という極端な事例も載っています。

公式の説明はあっさりしています:

> "Wrapping the function causes an `initPlan` to be run by the Postgres optimizer, which allows it to 'cache' the results per-statement, rather than calling the function on each row."

## 修正 2: TO authenticated でロールを絞る

ログインユーザー専用のポリシーなら、`to authenticated` を追加すると更に速くなります。

```sql
create policy "users can read own profile"
on profiles for select
to authenticated                       -- ← これを追加
using ( (select auth.uid()) = user_id );
```

`to authenticated` を書くと、**匿名ユーザー (anon ロール) のリクエストではポリシー本体の評価をスキップ**します。Supabase のベンチでは **170ms → 0.1ms 以下（99.78% 改善）**。

逆に書き忘れると、ログインしていないユーザーがエンドポイントを叩いても `(select auth.uid()) = user_id` が評価され続けます。空の uid との比較なので結果は false ですが、無駄な計算が走り続ける状態です。

## 既存ポリシーを書き換えるときの注意

私が運用中のアプリで適用したときの手順です。

### 1. マイグレーションは drop + create

Postgres の `create policy ... if not exists` は使えません。修正は drop してから create します。

```sql
drop policy if exists "users can read own profile" on profiles;
create policy "users can read own profile"
on profiles for select
to authenticated
using ( (select auth.uid()) = user_id );
```

### 2. 全テーブル分のポリシーを棚卸す

`pg_policies` ビューでポリシーをまとめて確認できます。

```sql
select schemaname, tablename, policyname, qual
from pg_policies
where qual like '%auth.uid()%'
  and qual not like '%(select auth.uid())%';
```

`auth.uid()` を裸で使っているポリシーがリストアップされます。私のアプリでは 11 ポリシー中 8 つが該当していました。

### 3. user_id カラムに index を貼る

これは別トピックですが、RLS の比較対象カラム（多くの場合 `user_id`）には B-tree index が必須です。RLS は WHERE 句に展開されて評価されるため、index がないと毎回 seq scan になります。

```sql
create index if not exists profiles_user_id_idx on profiles (user_id);
```

## まとめ

- RLS で `auth.uid() = user_id` と書いていたら、**`(select auth.uid()) = user_id` に書き換えるだけで 1 桁速くなる**
- ログイン必須なら **`to authenticated`** も付ける（更に 1 桁）
- 既存ポリシーは `pg_policies` で棚卸して一気に直す
- 比較カラムには index を必ず貼る

[公式の RLS パフォーマンスガイド](https://supabase.com/docs/guides/database/postgres/row-level-security#rls-performance-recommendations) は短いですが、個人開発で見落とされがちな要点です。私のアプリも全ポリシーを書き換えてから p95 が 200ms 台から 30ms 台に落ち着きました（条件次第ですが、効果は再現性高いです）。

次回は **「Supabase の pooler URL を migration とアプリ実行時で使い分ける」** を書く予定です。

3 つのアプリの実物はこちら:

- [SparMate](https://sparmate.cosoado-lab.com) — 格闘技の練習相手マッチング
- [NetaPair](https://netapair.cosoado-lab.com) — お笑いの相方探し
- [BoardLink](https://boardlink.cosoado-lab.com) — ボドゲ・TRPG 仲間募集

ご質問・指摘は [Cosoado Lab](https://cosoado-lab.com) までお気軽にどうぞ。
