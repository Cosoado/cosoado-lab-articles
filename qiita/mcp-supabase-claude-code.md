---
title: "Claude Code × Supabase MCP：30分の設定でスキーマ説明が不要になった"
tags: ["ClaudeCode", "Supabase", "AI", "個人開発", "LLM"]
published: true
qiita_id:
qiita_url:
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/mcp-supabase-claude-code/

「この users テーブルのスキーマはこうで…」と毎回貼っていた。SparMate、NetaPair、BoardLink と 3 つの Supabase プロジェクトを持っていて、Claude Code に migration を書かせるたびにテーブル定義をコピーしていた。先週、さすがに面倒くさくなって Supabase の MCP サーバーをつないだ。

## MCP とは何か（2 行で済ます）

MCP（Model Context Protocol）は、Claude などの LLM が外部ツールやデータに接続するためのプロトコル。Supabase は [supabase-community/supabase-mcp](https://github.com/supabase-community/supabase-mcp) として公式の MCP サーバーを提供していて、接続すると Claude がプロジェクトの DB スキーマを直接参照できる。

「自分で連携サーバーを作る」わけではない。Supabase 側がホストしているサーバーに Claude Code を向けるだけ。

## 設定手順（.mcp.json を 1 ファイル置くだけ）

プロジェクトルートに `.mcp.json` を作る。Claude Code はここを読んで MCP サーバーに接続する。

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp"
    }
  }
}
```

保存して Claude Code を再起動すると、初回だけ「Supabase にログインしますか？」のプロンプトが出る。ブラウザが開いて OAuth 認証して完了。

CLI からやる場合はこちら：

```bash
claude mcp add --transport http supabase https://mcp.supabase.com/mcp
```

`claude mcp list` で接続状態を確認できる。

## やらかし：全プロジェクトが見えてた

設定直後、SparMate の migration を頼んだら Claude の出力に「NetaPair の matches テーブルは…」という話が混じってきた。

URL にパラメータを足していなかった。`https://mcp.supabase.com/mcp` のままだと、アカウント内の**全プロジェクト**にアクセスできる状態になる。

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF&read_only=true"
    }
  }
}
```

`project_ref` はダッシュボードの URL から取れる（`https://supabase.com/dashboard/project/<これ>`）。`read_only=true` も必ずつける。migration 生成の用途なら書き込みは不要だし、万が一 Claude が誤動作しても DB は変更されない。

プロジェクトごとに `.mcp.json` を別に管理するのが正解だった。「30 分で終わる」と思っていたのが、原因調査で 1 時間になった。

## つないだら何が変わるか

```text
[以前]
自分: 「この posts テーブルのスキーマです: (150 行のテーブル定義を貼る)」
Claude: 「わかりました。migration はこうです」

[設定後]
自分: 「posts テーブルに is_pinned bool カラムを追加する migration を書いて」
Claude: （スキーマを直接確認して）「こうなります: ...」
```

Claude がスキーマ取得ツールを呼んで確認してから migration を書く。テーブル数が増えるほど差がデカい。SparMate は 14 テーブル、全部貼るのが地味につらかった。

外部キーの関係が絡む変更や、複数テーブルをまたぐ RLS ポリシーを書くときも、スキーマ全体を把握した上で提案してくれるようになった。

## まとめ

- `.mcp.json` に 3 行書いて再起動するだけで Supabase MCP につながる
- **`project_ref` を絞らないと全プロジェクトが見える**（必ずスコープを限定する）
- `read_only=true` もセットで設定する
- プロジェクトごとに `.mcp.json` を分けてリポジトリ管理するのが自分的ベストプラクティス
- テーブル数が多いほど、スキーマ説明の省略効果が大きい
