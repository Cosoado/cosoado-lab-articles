---
title: "Supabase pgvector で類似検索を 3 ステップで実装する（embedding 生成→保存→検索）"
tags: ["Supabase", "PostgreSQL", "LLM", "AI", "個人開発"]
published: false
qiita_id:
qiita_url:
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/supabase-pgvector-similarity-search/

embedding を DB に突っ込んで「似たものを探す」機能を Supabase で作ると、想定の 3 倍詰まる。最大の罠は pgvector の有効化タイミングではなく「次元数を後から変えられない」という事実で、自分はそれを migration 適用後に気づいた。やらかした。

## 背景：SparMate に「練習スタイルが近い人」を推薦する機能を追加した

火曜の朝 9 時から実装を始めて、ハマりポイントで溶かしながら夕方にようやく動いた。

SparMate はスポーツパートナーを探すアプリで、「練習スタイルが近い人を表示する」機能を後から追加した。最初は WHERE に条件を詰め込んでいたが、フィールドが 5 個を超えたあたりで「これはもう WHERE じゃ対応できない」と悟り、pgvector に切り替えた。Supabase は標準搭載しているので追加費用なしで使える。

## ステップ 1：エクステンション有効化

```sql
create extension if not exists vector
  with schema extensions;
```

`schema extensions` を明示する。省略すると `public` スキーマに入り、後の migration 管理が面倒になる。自分は最初省略して、後から移動しようとしたら依存テーブルがあって `DROP EXTENSION` できず、migration をリセットする羽目になった。

## ステップ 2：テーブル作成と embedding の保存

```sql
create table user_embeddings (
  user_id uuid references auth.users not null,
  embedding extensions.vector(1536) not null,
  updated_at timestamptz default now(),
  primary key (user_id)
);
```

**次元数 `1536` は後から変えられない。** text-embedding-3-small は 1536 次元、text-embedding-3-large は 3072 次元。モデルを決めてから schema を書くこと。

embedding の生成と保存は Edge Function から行う：

```ts
// supabase/functions/update-embedding/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4'

Deno.serve(async (req) => {
  const { userId, profileText } = await req.json()
  const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
  const { data } = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: profileText,
  })
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  await supabase.from('user_embeddings').upsert({ user_id: userId, embedding: data[0].embedding })
  return new Response('ok')
})
```

## ステップ 3：類似検索 + インデックス

```sql
select
  ue.user_id,
  ue.embedding <=> (
    select embedding from user_embeddings where user_id = auth.uid()
  ) as distance
from user_embeddings ue
where ue.user_id <> auth.uid()
order by distance
limit 10;
```

`<=>` は cosine distance（0 が最も近い）。対象ユーザーの embedding と自分の embedding のコサイン距離で並べている。

ユーザーが 1,000 人を超えてきたら `ivfflat` インデックスを張る：

```sql
create index on user_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
```

`lists` の推奨値は「行数 ÷ 1000」（100 万行まで）。[pgvector の README](https://github.com/pgvector/pgvector) にそう書いてある。ivfflat はデータが入ってから作成すること。空テーブルに作ると学習ステップが走らない。

## やらかした話：次元数 1536 を本番で 3072 に変えようとした

`text-embedding-3-small` で動かしていたが、マッチング精度が足りなくて `text-embedding-3-large` に乗り換えたくなった。`alter table user_embeddings alter column embedding type extensions.vector(3072)` を試したら当然エラー。型変換の USING 句に何を書けばいいかわからず 2 時間溶けた。

正解は: 新カラムを追加 → 全件を新モデルで再生成して INSERT → 旧カラムを DROP する、の 3 ステップ。ユーザーが 300 人だったので 10 分で終わったが、1 万人いたら翌朝まで待つことになっていた。

## まとめ

- pgvector は Supabase 標準搭載、追加費用ゼロ。有効化は `schema extensions` 指定で
- **次元数は schema 設計時に固定する**。後からの変更は全件再生成が必要
- 1,000 件超えたら `ivfflat` インデックス。`lists` は行数 ÷ 1000 が出発点
