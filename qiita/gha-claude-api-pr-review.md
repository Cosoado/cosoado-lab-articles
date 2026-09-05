---
title: "GitHub Actions + Claude API でプルリクに自動レビューコメントを付ける"
tags: ["GitHubActions", "Claude", "AI", "個人開発", "Python"]
published: true
qiita_id:
qiita_url:
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/gha-claude-api-pr-review/

個人開発でソロでやってると、PR のセルフレビューが一番しんどい。自分が書いたコードを自分でレビューするのは、答えを知った状態でパズルを解くようなもので、重要なミスをスルーしがちだ。

Claude API + GitHub Actions でこれを部分的に解決した。PR を出すたびに差分が Claude に渡り、自動でコメントが PR についてくる。

## TL;DR

- `.github/workflows/pr-review.yml` でプルリク作成・更新時に Python スクリプトを起動
- `git diff` で差分テキストを取得 → Anthropic SDK の `messages.create()` に渡す
- 返ってきたレビュー文を GitHub API で PR にコメント投稿
- セットアップ: `ANTHROPIC_API_KEY` を GitHub Secrets に追加するだけ

---

## なぜ作ったか

SparMate のマッチングスコア計算を改修した PR があった。変更量が多く自分でレビューするのが億劫になり、「まあいいか」でマージした。翌日、スコアに符号の反転があるのを見つけた。本番で3時間出ていた。ユーザーから問い合わせが来るまで気づかなかった。

この手の「自分が書いたから見逃す」系のミスを減らしたかった。Claude Code を使い始めて「GHA から API を叩けば PR ごとにセルフレビューより客観的な目が入るのでは」と思いついた。やってみたら思ったより簡単だった。

---

## 全体の流れ

```text
PR 作成 / push
  ↓
GHA: pr-review.yml が起動
  ↓
Python: git diff を取得
  ↓
Anthropic Messages API に差分を渡す
  ↓
Claude がレビューを返す
  ↓
GitHub API でコメント投稿
```

---

## セットアップ手順

### 1. Secrets の追加

GitHub リポジトリの「Settings → Secrets and variables → Actions」で以下を追加する。

| シークレット名 | 値 |
|---|---|
| `ANTHROPIC_API_KEY` | [Anthropic Console](https://console.anthropic.com/) で発行した API キー |

`GITHUB_TOKEN` は GHA が自動で提供するため追加不要。

### 2. ワークフロー YAML

`.github/workflows/pr-review.yml` を作る。

```yaml
name: PR Auto Review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install Anthropic SDK
        run: pip install anthropic

      - name: Run AI review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GH_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
          HEAD_SHA: ${{ github.sha }}
          REPO: ${{ github.repository }}
        run: python scripts/review_pr.py
```

`fetch-depth: 0` がないと `git diff <base_sha>` で `fatal: bad object` が出る。最初これを抜かして30分詰まった。

### 3. Python スクリプト

`scripts/review_pr.py` を作る。

```python
import os
import subprocess
import anthropic
import urllib.request
import json

def get_diff() -> str:
    base = os.environ["BASE_SHA"]
    head = os.environ["HEAD_SHA"]
    result = subprocess.run(
        ["git", "diff", base, head, "--unified=3"],
        capture_output=True, text=True, check=True
    )
    # トークン節約。大きな PR は後述の通り別途対処
    return result.stdout[:12000]

def review_diff(diff: str) -> str:
    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY を自動で拾う
    message = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": f"""以下の git diff をコードレビューしてください。

チェック観点:
- バグの可能性（型の不一致、off-by-one、null/undefined 参照）
- セキュリティ上の懸念（インジェクション、認可漏れ、シークレット露出）
- 明らかなパフォーマンス上の問題

問題がなければ「特に問題なし」とだけ書いてください。
レビュー結果は日本語で、箇条書きで簡潔に。

```diff
{diff}
```"""
        }]
    )
    return message.content[0].text

def post_comment(body: str):
    repo = os.environ["REPO"]
    pr = os.environ["PR_NUMBER"]
    token = os.environ["GH_TOKEN"]
    url = f"https://api.github.com/repos/{repo}/issues/{pr}/comments"
    data = json.dumps({"body": f"## 🤖 AI レビュー\n\n{body}"}).encode()
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
    )
    with urllib.request.urlopen(req) as res:
        if res.status not in (200, 201):
            raise RuntimeError(f"GitHub API error: {res.status}")

if __name__ == "__main__":
    diff = get_diff()
    if not diff.strip():
        print("差分なし、スキップ")
        raise SystemExit(0)
    review = review_diff(diff)
    post_comment(review)
    print("投稿完了")
```

`urllib.request` を使っているのは依存を増やしたくないから。`httpx` でも `requests` でも同じように書ける。

---

## やらかした話

最初のプロンプトが「このコードをレビューしてください」だけだった。

返ってきたのが「コードは整理されており、読みやすい実装です。変数名も明確で、意図が伝わります」という感想文だった。何も指摘していない。これをそのまま PR にコメントとして飛ばし、しばらくそれが「レビュー完了」扱いになっていた。

今のプロンプトでは「バグ・セキュリティ・パフォーマンス」の3観点を明示し、「問題がなければ『特に問題なし』とだけ書け」という指示を追加した。これで問題のない変更には短い確認コメントが付き、問題があるときは箇条書きで出てくるようになった。

プロンプトに観点を書くのは「レビューの質を上げる」だけでなく「問題がないときに長文感想文を出力させない」ためでもある。

---

## 使ってみて気づいた点

**差分の文字切り上限は必須**: 自動生成ファイルや大規模なリファクタリングが入ると差分が数万行になる。`[:12000]` の切り方は粗いが、まず動かすには十分。正確にやるならファイル単位で分割して複数回 API を叩く。

**`synchronize` イベントも拾う**: PR にコミットを積むたびにレビューが走り、コメントが増える。コミット単位でなく PR 全体のレビューでよければ `opened` だけにするか、前のコメントを上書きする実装にする（GitHub API で既存コメントの id を取得して PATCH する）。

**費用感**: `claude-sonnet-5` で通常の PR（差分 200〜400 行）は 1回あたり数円以下。月 50 回 PR を出しても月数百円の範囲に収まる。

---

## まとめ

- `git diff` + Anthropic SDK + GitHub API の3つを GHA でつなぐだけで自動レビューが動く
- `ANTHROPIC_API_KEY` を Secrets に追加して YAML と Python を置けばセットアップ完了
- プロンプトに「チェック観点」を明示しないと感想文が返ってくる。これが一番大事

参照: [anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python)
