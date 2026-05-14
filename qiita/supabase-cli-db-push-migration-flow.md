---
title: "Supabase CLI の db push でマイグレーションを本番に安全に流す運用パターン"
tags: ["Supabase", "PostgreSQL", "個人開発", "CLI", "データベース"]
published: true
qiita_id:
qiita_url:
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/supabase-cli-db-push-migration-flow/

## TL;DR

- `supabase db push` の前に必ず `--dry-run` を挟む
- Dashboard で直接変えたスキーマは `supabase db pull` でマイグレーションファイル化してから管理する
- `supabase_migrations.schema_migrations` テーブルを把握していないと「push したのに何も変わらない」に詰まる
- `--include-all` は最終手段。普段使いすると二重適用で壊れる

---

Supabase を使い始めたとき、最初の数ヶ月は Dashboard のテーブルエディタだけでスキーマ管理していた。「列を追加→コードを書く→動く」のサイクルが気持ちよくて、CLI を触る気にならなかった。

転機は、開発メンバーが一人増えたタイミングだった。「同じ環境を再現できない」が問題になり、ちゃんと CLI でマイグレーション管理しようと切り替えを試みた。`supabase link` して `supabase db push` を実行——ターミナルに何かが出力されて終了。問題ない、と思ったら **ローカルの `supabase/migrations/` フォルダが空だったので実際には何も起きていなかった**。

リモートの `supabase_migrations.schema_migrations` テーブルを確認したらレコードが 0 件。Dashboard で積み上げた変更は一切マイグレーションとして記録されていなかった。この瞬間、「最初からちゃんとやらないといけなかった」と後悔した。

## Supabase CLI のマイグレーション追跡の仕組み

Supabase CLI（安定版: [v2.98.2](https://github.com/supabase/cli/releases/tag/v2.98.2)）のマイグレーション管理は次の二層構造になっている。

1. `supabase/migrations/` 配下にタイムスタンプ付きの SQL ファイルを積み上げる
2. `supabase db push` は `supabase_migrations.schema_migrations` テーブルを参照し、未適用のファイルだけを実行する

つまり、マイグレーションファイルが存在しないか、すでにテーブルに記録済みであれば `db push` は何もしない。「push したのに変わらない」の原因の 9 割はここにある。

参照: [Supabase — Managing database migrations](https://supabase.com/docs/guides/deployment/database-migrations)

## 実際の運用フロー

### 既存プロジェクトを CLI 管理に移行する（初回のみ）

Dashboard で作り込んだスキーマがすでにある場合は、まず `db pull` でリモートの現状をマイグレーションファイルとして取り込む。

```bash
supabase link --project-ref <PROJECT_REF>
supabase db pull --schema public,auth
```

`supabase/migrations/<timestamp>_remote_schema.sql` が自動生成される。このファイルは「このタイムスタンプより前の状態はすでにリモートに存在する」という起点になる。ここから先だけ差分管理に入れば OK。

### 新しいスキーマ変更を作る

変更は必ずマイグレーションファイルから。Dashboard での直接変更はここからは禁止（チームで動くなら特に）。

```bash
supabase migration new add_profiles_bio
```

`supabase/migrations/20260514120000_add_profiles_bio.sql` が空ファイルで生成されるので SQL を書く。

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text;
```

### ローカルで確認してから push する

```bash
supabase db reset   # ローカル DB にマイグレーションを全部当ててシードまで実行
```

ローカルで問題なければ、本番 push の前に `--dry-run` を必ず入れる。

```bash
supabase db push --dry-run
```

実際の変更は行わず、「何が適用されるか」だけをターミナルに表示してくれる。自分はこれを確認してから本番に流す。

```bash
supabase db push
```

`--linked`（デフォルト）でリンクされたリモートプロジェクトに流れる。特定の DB URL に流したい場合は `--db-url` で指定できる。

## はまりどころ：--include-all の落とし穴

`supabase db push` には `--include-all` というフラグがある。

```bash
supabase db push --include-all
```

`supabase_migrations.schema_migrations` に記録されていないマイグレーションを**全て強制適用**するオプションだ。

一見、「記録が壊れたとき便利」に見える。実際、自分は一度 staging 環境でこれを使って、すでに適用済みのカラム追加 SQL を再実行してしまった。`IF NOT EXISTS` を書いていたので壊れはしなかったが、`IF NOT EXISTS` を書いていない SQL だったら本番データが壊れていた。

**`--include-all` は「`supabase_migrations` テーブル自体が明らかに壊れていると確認済みのとき」だけに限定する**。普段使いするフラグではない。これが一番やった失敗だったし、先に知っておきたかった。

## db diff でスキーマ変更を自動検出する

「Dashboard で変えてしまったが SQL を書きたくない」ときの救済策として `db diff` がある。

```bash
supabase db diff -f add_profiles_bio
```

ローカル DB とリモートのスキーマ差分を検出してマイグレーションファイルを自動生成する。ただし生成物は必ず手動確認すること。RLS ポリシーや関数の差分など、意図しないものが混入することがある。

## まとめ

| 操作 | コマンド |
|---|---|
| 既存スキーマを取り込む（初回） | `supabase db pull` |
| 新しいマイグレーションを作る | `supabase migration new <name>` |
| ローカル確認 | `supabase db reset` |
| 本番 push 前の確認 | `supabase db push --dry-run` |
| 本番 push | `supabase db push` |

Supabase CLI のマイグレーション管理は、`supabase_migrations.schema_migrations` テーブルが中心にある、という前提を理解するだけで詰まる箇所がぐっと減る。Dashboard 直接編集との共存は早めに断ち切るほど楽になる。

---

Cosoado Lab が開発中のサービス:

- [SparMate](https://sparmate.cosoado-lab.com) — スパーリングパートナーマッチング
- [NetaPair](https://netapair.cosoado-lab.com) — アイデア壁打ちマッチング
- [BoardLink](https://boardlink.cosoado-lab.com) — 企業×個人のボードメンバーマッチング
- [Cosoado Lab](https://cosoado-lab.com) — 個人開発スタジオ
