---
title: "Supabase 新規テーブルが Data API で 42501 — opt-in 必須化と既存プロジェクト移行の罠"
emoji: "🔐"
type: "tech"
topics: ["supabase", "postgresql", "個人開発", "security"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/supabase-data-api-opt-in-new-tables/

RLS ポリシーを書いた。migrate した。フロントが `42501` で死んだ。

2026-05-30 以降に作った新規プロジェクトでは、`public` スキーマにテーブルを追加しても Data API（REST / GraphQL）に自動公開されなくなっている。RLS を有効にするだけでは足りない。**そして 2026-10-30、全既存プロジェクトにも適用される。** 今から 22 日後だ。

## 何が変わったか

従来の Supabase は `public` スキーマにテーブルを作ると、`default privileges` が `anon` / `authenticated` / `service_role` に自動で `SELECT`, `INSERT`, `UPDATE`, `DELETE` を付与していた。PostgREST がそれを読んで REST エンドポイントを自動生成する、という仕組みだった。

それが切られた。

ロールアウト:

| 日付 | 内容 |
|---|---|
| 2026-04-28 | 新規プロジェクト作成時に opt-out を選択可能に |
| 2026-05-30 | 新規プロジェクトはデフォルトで auto-expose 無効 |
| **2026-10-30** | **全既存プロジェクトに適用** |

出典: [Supabase Discussion #45329](https://github.com/supabase/supabase/discussions/45329)

変更の背景は「RLS を書いていないテーブルが意図せず全公開されていた」という事故を構造的に防ぐためだ。RLS を書いていても、うっかり作ったテーブルが PostgREST に露出するのはセキュリティリスクだった。方向性としては正しいと思う。ただ既存プロジェクトを持っているとそれなりに影響がある。

## 変更後に必要な SQL

テーブルを作るマイグレーションに `GRANT` と `ENABLE ROW LEVEL SECURITY` をセットで書く。

```sql
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  body text not null,
  created_at timestamptz default now()
);

-- Data API に公開するためのグラント（これが新たに必要）
grant select on public.messages to anon;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.messages to service_role;

-- RLS は以前と変わらず必要
alter table public.messages enable row level security;

create policy "自分のメッセージのみ読める"
  on public.messages for select to authenticated
  using (auth.uid() = user_id);
```

**ポイント**: `GRANT` を忘れると PostgREST が `42501 permission denied for table messages` を返す。エラーメッセージに必要な `GRANT` の例が含まれるので、出たらすぐ気づける。逆に言うと、フロントに `42501` が届いた時点でまず `GRANT` を疑え、ということだ。

## やらかした話

これ、6 月頭に新しいマッチングアプリのプロジェクトを立ち上げたときに踏んだ。

既存プロジェクトからテーブル定義の migration をコピーして使っていた。コピー元は 2026-05-30 より前に作ったプロジェクトだったので auto-expose が効いていた。コピー先の新プロジェクトはちょうどデフォルトが変わった後。RLS ポリシーはコピーできたが、自動グラント由来の権限は migration に書かれていないので当然コピーできない。

ステージングにデプロイして確認したら全テーブルで `42501` が出た。「RLS 書いてるのになんで」と 20 分くらい悩んだ。最終的にエラーメッセージをよく読んだら `GRANT` という文字が見えて、そこで気づいた。自分でも笑えるくらいのミスだったが、migration のコピペをやる人には確実に刺さるパターンだと思う。

## 既存プロジェクトの移行（2026-10-30 が締め切り）

**既存テーブルへの影響はない。** 今ある公開済みテーブルのグラントは維持される。問題になるのは「2026-10-30 以降に既存プロジェクトで新規テーブルを追加するとき」だ。

今のうちに同じ状態にしておきたい場合は SQL エディタで `default privileges` を変更する。

```sql
-- 今後作られるテーブルの自動グラントを無効化（新規プロジェクトと同じ状態にする）
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
```

これで以降の migration では必ず `GRANT` を手書きする習慣が強制される。個人的にはむしろ管理しやすくなると思っている。「このテーブルは Data API に出す／出さない」を明示的に宣言できるのは、RLS 記事で扱ってきたポリシー管理と同じ考え方だ。

なお Supabase Dashboard の **Table Editor → Data API アクセス** トグルでも制御できる。ただし git で追えないので、マイグレーションで管理したほうが運用上は楽だ。

## まとめ

- 2026-05-30 以降の新規プロジェクトは `GRANT` がなければ Data API からアクセスできない
- **2026-10-30 に全既存プロジェクトへ適用（22 日後）**
- RLS ポリシーと `GRANT` はセット。どちらか片方では動かない
- エラー `42501` が出たらまず `GRANT` を確認
- 既存テーブルへの影響はない。以降の新規テーブル migration を変えればいい

---

関連記事:

- [Supabase RLS の UPDATE ポリシーで USING を省くと他人データを乗っ取れる](https://zenn.dev/cosoado/articles/supabase-rls-with-check-vs-using-pitfall)
- [pg_policies で Supabase の RLS ポリシーを一括棚卸する SQL 3 本](https://zenn.dev/cosoado/articles/pg-policies-rls-audit-query)
- [Supabase RLS で auth.uid() を毎行呼び出さないための 1 行の書き換え](https://zenn.dev/cosoado/articles/supabase-rls-auth-uid-perf)

---

[SparMate](https://sparmate.cosoado-lab.com) — 格闘技の練習相手マッチング  
[NetaPair](https://netapair.cosoado-lab.com) — お笑いの相方探し  
[BoardLink](https://boardlink.cosoado-lab.com) — ボドゲ・TRPG 仲間募集  
[Cosoado Lab](https://cosoado-lab.com)
