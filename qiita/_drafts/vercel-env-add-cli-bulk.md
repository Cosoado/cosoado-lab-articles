---
title: "Vercel CLI で .env から環境変数を一括 push する方法と、ハマりやすい3つのポイント"
tags: ["Vercel", "ShellScript", "CLI", "個人開発", "DevOps"]
published: false
qiita_id:
qiita_url:
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/vercel-env-add-cli-bulk/

Vercel には `vercel env pull`（Vercel の変数 → ローカル `.env`）があるのに、逆方向の `push` はない。新しいプロジェクトを立てるたびに、ダッシュボードで 20 個の変数をひとつずつ手入力する羽目になる。

先週、スタートアップのステージング環境を午前 3 時に急いで立ち上げた。`DATABASE_URL` を Vercel のダッシュボードに貼り付けるとき、PostgreSQL の接続文字列に含まれる `%` がブラウザで URL エンコードされて `%25` になっているのに気づかず登録してしまった。接続エラーが出るまで原因に気づかず、直すまでに 40 分溶かした。「これで最後にする」と決めて、その日のうちにシェルスクリプトを整備した。

## `vercel env` の全サブコマンドを把握する

[Vercel CLI の公式ソース（GitHub）](https://github.com/vercel/vercel/tree/main/packages/cli/src/commands/env) を見ると、サブコマンドは 6 つある：

| サブコマンド | 動作 |
|---|---|
| `add` | 変数を 1 件追加 |
| `update` | 既存変数の値を更新 |
| `rm` | 1 件削除 |
| `ls` | 登録済みの変数一覧を表示 |
| `pull` | Vercel の変数 → ローカルファイルに書き出す |
| `run` | Vercel の変数を注入してコマンドを実行 |

`update` は `add --force` の代替として使える比較的新しいサブコマンド。`push` が存在しない点がポイントで、`.env` ファイルからまとめて登録するには `add` をループで回す必要がある。

### 単体追加の基本形

```bash
# 非対話モードで 1 件追加（CI/CD での利用想定）
vercel env add DATABASE_URL production --value "$DB_URL" --yes
```

`--value` に値を渡すと、パスワード入力プロンプトが出ない。`--yes` で確認プロンプトもスキップできる。

```bash
# 暗号化保存（ダッシュボード上でも値を非表示にする）
vercel env add API_SECRET production --value "$SECRET" --sensitive --yes
```

`--sensitive` は後述の制約があるので要注意。

## `.env` ファイルから一括登録するスクリプト

### ナイーブな実装と問題点

最初に書きがちなコード：

```bash
# ❌ .env の書き方によって壊れる
while IFS='=' read -r key value; do
  vercel env add "$key" production --value "$value" --yes
done < .env.production
```

以下のような `.env` で詰まる：

```bash
export DATABASE_URL=<YOUR_DB_URL>    # キー名が "export DATABASE_URL" になる
API_KEY="abc123"                     # 値に " が含まれたまま登録される
NEXT_PUBLIC_URL=https://example.com  # これは問題なし
```

### 改善版：export とクォートに対応した実装

```bash
#!/usr/bin/env bash
# 使い方: ./push-env.sh production  (production / preview / development)
TARGET="${1:-production}"
ENV_FILE=".env.${TARGET}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found" >&2
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  # 空行・コメント行をスキップ
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue

  # export プレフィックスを除去
  line="${line#export }"

  # 最初の = の前後で分割（値に = が含まれても正しく動く）
  key="${line%%=*}"
  value="${line#*=}"

  # ダブルクォート / シングルクォートを除去
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"

  [[ -z "$key" ]] && continue

  echo "Adding: $key"
  vercel env add "$key" "$TARGET" --value "$value" --yes
done < "$ENV_FILE"
```

`${line%%=*}` は「最初の `=` より前」を取り、`${line#*=}` は「最初の `=` 以降の全部」を取る。値の中に `ssl=true` や `?encoding=utf8` のように `=` が含まれていても正しく分割できる。

3 環境まとめて流し込む場合：

```bash
for env in production preview development; do
  [[ -f ".env.$env" ]] || continue
  bash push-env.sh "$env"
done
```

## ハマりやすい3つのポイント

### 1. `--sensitive` は Development 環境に単独設定できない

```bash
# ❌ 以下はエラーになる
vercel env add API_SECRET development --sensitive --yes
# Error: Sensitive Environment Variables cannot target Development only
```

`--sensitive` 変数は Development 環境のみを対象にする場合はエラーになる。Production と Preview には設定できる。

Development 用の秘密鍵は `--no-sensitive`（暗号化はされるが値は UI で確認可能）を付けるか、`vercel env pull .env.local` でローカルに落として `.gitignore` で管理する運用にした方がシンプル。

### 2. 既存変数を上書きするには `--force` が必要

```bash
# ❌ 既に存在するとエラー
vercel env add DATABASE_URL production --value "$DB_URL" --yes
# Error: Environment Variable "DATABASE_URL" already exists in Production for this project

# ✅ --force で上書き
vercel env add DATABASE_URL production --value "$DB_URL" --force --yes
```

スクリプトに `--force` を入れるとべき等（何度実行しても同じ結果）になる。CI での再実行を想定するなら入れておいた方が良い。ただし意図しない上書きを防ぎたい場面では外しておく。

### 3. 流す前に `vercel env ls` で確認する

```bash
vercel env ls production
```

スクリプトを流す前にこれを一度実行する癖をつけると、「`development` のつもりが `production` に流し込んでいた」という事故を防げる。実際、自分は `push-env.sh development` を実行するつもりで `push-env.sh production` を打ってしまい、本番の `LOG_LEVEL` を `debug` に上書きしたことがある。これが一番やった失敗で、気づいたのは翌朝のログを見てから。

## まとめ

| 操作 | コマンド |
|---|---|
| 1 件追加 | `vercel env add KEY production --value "$VAL" --yes` |
| 1 件更新 | `vercel env update KEY production --value "$VAL" --yes` |
| 一括追加 | `push-env.sh production`（本記事のスクリプト） |
| 一覧確認 | `vercel env ls production` |
| ローカルに落とす | `vercel env pull .env.local` |

`push` コマンドが実装されていない点は割り切るしかないが、10 行程度のシェルスクリプトで補える。Vercel CLI の詳細な仕様は [GitHub のソース](https://github.com/vercel/vercel/tree/main/packages/cli/src/commands/env) を直接参照するのが確実。
