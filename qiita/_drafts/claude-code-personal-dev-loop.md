---
title: "Claude Code で個人開発の「コード→レビュー→push」を自走させた話"
tags: ["ClaudeCode", "個人開発", "AI", "自動化", "CLI"]
published: false
qiita_id:
qiita_url:
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/claude-code-personal-dev-loop/

個人開発でソロでやっていると、深夜に書いたコードが翌朝見ると恥ずかしい、という体験を繰り返す。Claude Code を使い始めて 2 ヶ月、「疲れたときの自分」の暴走をかなり抑えられるようになった。

## TL;DR

- `CLAUDE.md` にプロジェクトの掟を書くと、Claude がそれを前提に動く
- `settings.json` の `hooks` でファイル編集のたびに型チェックを強制できる
- Scheduled Tasks でレビュー・記事執筆などの定期仕事を委任している
- 自分は「方針を決めるだけ」でよくなった

---

## きっかけは土曜の夜中 2 時の Supabase RLS

発端は、土曜の夜中 2 時に書いた RLS ポリシーだ。

```sql
CREATE POLICY "users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);
```

「よし完璧」と思って push した。翌日昼、友人のテストアカウントから「他人のプロフィールが見える」と連絡が来た。`INSERT` と `UPDATE` のポリシーを書き忘れていて、本番に 14 時間出ていた。最悪だった。

「疲れているときの自分を信用しない」ことにして、Claude Code に「変更前に必ず確認する」役割を渡すことにした。

---

## 3 つの仕組み

### 1. CLAUDE.md でプロジェクトの掟を書く

プロジェクトルートに置くと Claude Code が毎回読む。

```markdown
## RLS ルール
Supabase のポリシーは SELECT / INSERT / UPDATE / DELETE の 4 オペレーションを揃えること。
片方だけ書いて完成にしない。

## push 前チェック
`node scripts/validate.mjs` を必ず通す。
```

これだけで「あれ、USING しか書いてないけど WITH CHECK は?」と Claude が聞いてくれるようになった。

### 2. hooks でチェックを機械的に強制する

`settings.json` の `hooks` に「特定ツール実行の前後に走るコマンド」を書ける。

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit",
        "hooks": [{ "type": "command", "command": "npx tsc --noEmit 2>&1 | head -20" }]
      }
    ]
  }
}
```

ファイル編集のたびに型チェックが走る。最初の 1 週間は「うるさい」と感じたが、今は無いと不安。

### 3. Scheduled Tasks でルーチン仕事を委任する

[Claude Code の Scheduled Tasks](https://github.com/anthropics/claude-code) を使うと、プロンプトをスケジュール実行できる。

このブログの記事執筆も Claude Code に任せている。バックログからトピックを選んで記事を書いて push するところまで自走する。自分はたまに出てきた記事を読んで「これは出すな」と差し止めるだけ。

---

## やらかした: `Bash(*)` を allow したら dev サーバーが止まらなくなった

```json
{
  "permissions": {
    "allow": ["Bash(*)"]
  }
}
```

全 Bash コマンドを許可したら、Claude が `npm run dev` を起動して dev サーバーが走り続けた。次のタスクはタイムアウト待ちになった。当たり前なんだが盲点だった。

今は `"Bash(npm run build)"` のように具体的なコマンドだけを許可している。permissions はケチでいい。

---

## まとめ

- CLAUDE.md = 「このプロジェクトの常識」を書く場所。一度書けば毎回読まれる
- hooks = 疲れた自分を機械的に守る仕組み。「うるさい」で止めると意味がない
- Scheduled Tasks = ルーチン仕事の委任先。差し止め権は手放さない

夜中の自分より Claude Code の方が RLS の漏れを確実に見つけてくれる、というのが 2 ヶ月の正直な感想。
