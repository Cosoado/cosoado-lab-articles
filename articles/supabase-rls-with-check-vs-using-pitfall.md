---
title: "Supabase RLS の UPDATE ポリシーで USING を省くと他人データを乗っ取れる"
emoji: "🔓"
type: "tech"
topics: ["supabase", "postgresql", "rls", "security", "個人開発"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/supabase-rls-with-check-vs-using-pitfall/

## TL;DR

| 句 | 役割 | 効くコマンド |
|---|---|---|
| `USING` | 既存行フィルタ（「触れる行」を決める） | SELECT / UPDATE / DELETE |
| `WITH CHECK` | 書き込み後の行バリデーション（「書いた結果」を検査する） | INSERT / UPDATE |

```sql
-- ❌ 危険: USING がないと全行が UPDATE の標的になる
create policy "update own profile"
on profiles for update
to authenticated
with check ( (select auth.uid()) = user_id );

-- ✅ 正解: UPDATE は USING + WITH CHECK を両方書く
create policy "update own profile"
on profiles for update
to authenticated
using  ( (select auth.uid()) = user_id )
with check ( (select auth.uid()) = user_id );
```

## USING と WITH CHECK、何が違うのか

Supabase の公式ドキュメント（[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)）には次の一文があります。

> If no `with check` expression is defined, then the `using` expression will be used both to determine which rows are visible and which new rows will be allowed to be added.

PostgreSQL の仕様（[CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html)）でも同様に、コマンドごとに適用される句が決まっています。

- **USING**: 「この行を操作させていいか」。SELECT では返す行を絞り、UPDATE では更新対象を絞り、DELETE では削除対象を絞る。
- **WITH CHECK**: 「この行を書き込んでいいか」。INSERT では挿入行を、UPDATE では更新後の行を検査する。

UPDATE は既存行と新規行の両方に関わる唯一のコマンドなので、**USING と WITH CHECK のどちらが欠けてもロジックが崩れる**。

## 危険パターン①: UPDATE ポリシーに USING がない

これが一番やった失敗です。「更新の中身さえチェックすればいい」と思って `WITH CHECK` だけ書きました。

```sql
-- ❌ これは穴がある
create policy "users can update own profile"
on profiles for update
to authenticated
with check ( (select auth.uid()) = user_id );
```

`USING` 句がないので、**このポリシーはどの行でも UPDATE の標的にできます**。攻撃者が踏む手順はこうです。

1. User A（uid = `'aaaa-...'`）が User B の行（`id = 42`, `user_id = 'bbbb-...'`）を標的にする
2. `UPDATE profiles SET user_id = 'aaaa-...', display_name = 'hijacked' WHERE id = 42` を実行
3. `USING` チェック: 定義なし → スルー
4. `WITH CHECK`: `(select auth.uid()) = user_id` → `'aaaa-...' = 'aaaa-...'` → 通過
5. 結果: User B の行が User A の所有に書き換わる

`WITH CHECK` が検査するのは「書いた後の状態」だけです。「誰が更新できるか」は `USING` が担います。USING なしでは誰でも任意の行を自分のものに転換できます。

## 危険パターン②: FOR ALL に WITH CHECK がない（暗黙フォールバック）

Supabase の Dashboard が自動生成するポリシーで見かけるパターンです。

```sql
-- ⚠️ 動くが意図が不明確
create policy "users own data"
on profiles for all
using ( (select auth.uid()) = user_id );
-- WITH CHECK 省略 → PostgreSQL が USING 式を WITH CHECK に流用
```

`WITH CHECK` を省略すると PostgreSQL は `USING` 式を `WITH CHECK` としても使います。INSERT で `user_id ≠ auth.uid()` な行も弾いてくれるので、動作上は意図通りになることが多い。

ただし暗黙のフォールバックに頼ると、後でポリシーを修正したとき「なぜ WITH CHECK が書いていないのか」で混乱します。私は意図を明示するため `FOR ALL` でも両方書くようにしました。

```sql
-- ✅ 意図を明示する
create policy "users own data"
on profiles for all
using  ( (select auth.uid()) = user_id )
with check ( (select auth.uid()) = user_id );
```

## コマンド別の正しい書き方

```sql
-- SELECT: USING のみ
create policy "read own profile"
on profiles for select
to authenticated
using ( (select auth.uid()) = user_id );

-- INSERT: WITH CHECK のみ
create policy "insert own profile"
on profiles for insert
to authenticated
with check ( (select auth.uid()) = user_id );

-- UPDATE: USING + WITH CHECK 両方
create policy "update own profile"
on profiles for update
to authenticated
using  ( (select auth.uid()) = user_id )
with check ( (select auth.uid()) = user_id );

-- DELETE: USING のみ
create policy "delete own profile"
on profiles for delete
to authenticated
using ( (select auth.uid()) = user_id );
```

Supabase 公式は「UPDATE 操作を行うには、対応する SELECT ポリシーが必要」とも注記しています。SELECT ポリシーがないと UPDATE が期待通り動かないことがあるので、UPDATE と SELECT はセットで定義します。

なお `(select auth.uid())` と `()` で包んでいるのは別記事で書いた 1 行最適化です（詳しくは [Supabase RLS で auth.uid() を毎行呼び出さないための 1 行の書き換え](https://zenn.dev/cosoado/articles/supabase-rls-auth-uid-perf)）。

## 現行ポリシーの棚卸し

`pg_policies` ビューで `USING` / `WITH CHECK` の状態を確認できます。

```sql
select
  tablename,
  policyname,
  cmd,
  qual       as using_expr,
  with_check as with_check_expr
from pg_policies
where schemaname = 'public'
order by tablename, cmd;
```

`cmd = 'UPDATE'` の行で `using_expr` が NULL なら危険パターン①に該当します。先に気づくべきでしたが、SparMate の profiles / matches テーブルを棚卸ししたとき、UPDATE ポリシーのうち `using_expr` が NULL のものが 2 つありました。気づかず本番に出ていたと思うと冷や汗でした。

修正は drop してから create が基本です（`CREATE OR REPLACE POLICY` は使えません）。

```sql
drop policy if exists "users can update own profile" on profiles;

create policy "users can update own profile"
on profiles for update
to authenticated
using  ( (select auth.uid()) = user_id )
with check ( (select auth.uid()) = user_id );
```

## まとめ

- **USING** = 既存行フィルタ。SELECT・UPDATE（対象選択）・DELETE に効く
- **WITH CHECK** = 書き込み検証。INSERT・UPDATE（結果チェック）に効く
- UPDATE ポリシーに USING がないと全行が UPDATE の標的になり、データ乗っ取りが通る
- `pg_policies` で `using_expr IS NULL` な UPDATE ポリシーを確認して修正する
- 暗黙のフォールバックに頼らず、`FOR ALL` でも USING + WITH CHECK を明示する

次回は「[Supabase の pooler URL を migration とアプリ実行時で使い分ける](https://zenn.dev/cosoado)」を書く予定です。

---

[SparMate](https://sparmate.cosoado-lab.com) — 格闘技の練習相手マッチング  
[NetaPair](https://netapair.cosoado-lab.com) — お笑いの相方探し  
[BoardLink](https://boardlink.cosoado-lab.com) — ボドゲ・TRPG 仲間募集  
[Cosoado Lab](https://cosoado-lab.com)
