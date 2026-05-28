---
title: "GitHub Actions cron で X bot を 12h ごとに自動投稿する（Mac launchd からの移行）"
tags: ["GitHubActions", "Python", "Twitter", "launchd", "個人開発"]
published: true
qiita_id:
qiita_url:
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/github-actions-cron-replace-mac-launchd/

個人開発で X（旧 Twitter）の定期投稿 bot を MacBook のローカルスクリプトで動かしている人向け。Mac のスリープや不在でタイミングがズレる問題を GitHub Actions の `schedule` トリガーに移行して解決する。YAML と Python を合わせて 50 行程度で完結し、Mac 依存がゼロになる。

## TL;DR

- Mac の launchd で X bot を動かしていたが、スリープ中はタイマーが止まるため実際の間隔が 12h を大幅に超え投稿がズレ続けた
- GitHub Actions の `schedule` トリガーに移行したら、12h 間隔投稿が完全に安定した
- YAML 30 行 + Python 20 行で設定完了、Mac 依存ゼロ、secrets も GitHub に集約できる

## Mac の launchd で動かしていたころ

SparMate のリリース後、X で定期的に告知を出したくて、MacBook に launchd の plist を仕込んで bot を動かしていた。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cosoado.xbot</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>/Users/cosoado/scripts/xbot.py</string>
  </array>
  <key>StartInterval</key>
  <integer>43200</integer>
</dict>
</plist>
```

`43200` 秒 = 12 時間。数週間は動いていたが、ある夜、寝る前に MacBook を閉じたままにしていたら翌朝の投稿がなかった。ログを見ると前日の 23 時が最後だった。

`StartInterval` はスリープ中にカウントが一時停止し、起動後に残り時間から再開する。22 時に実行後すぐ寝て翌 7 時に起こしても、残り 11 時間は翌 18 時まで待つことになる（実質 20h 間隔になる）。`StartCalendarInterval` に変えると復帰後に即実行されるが、オフライン時でも X API 呼び出しが走ってエラーになるだけだった。MacBook が手元にないと bot が止まる構造は、根本的に間違っていた。

| 問題点 | 詳細 |
|---|---|
| スリープでズレる | スリープ中はカウント停止、起動後に残り時間から再開するため実質間隔が伸びる |
| Mac がないと止まる | 外出中・充電切れで動かない |
| secrets 管理が面倒 | .env を平文で置くか Keychain 連携が必要 |
| ログが散らばる | syslog か自前ファイルに書かないと確認しにくい |

## GitHub Actions に移行する

### ワークフロー YAML

`.github/workflows/xbot.yml` を作る。

```yaml
name: X Bot Auto Post

on:
  schedule:
    - cron: '0 0,12 * * *'    # UTC 0:00 / 12:00 = JST 9:00 / 21:00
  workflow_dispatch:            # 手動でも叩けるようにしておく

jobs:
  post:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install deps
        run: pip install tweepy

      - name: Post to X
        env:
          X_API_KEY:             ${{ secrets.X_API_KEY }}
          X_API_SECRET:          ${{ secrets.X_API_SECRET }}
          X_ACCESS_TOKEN:        ${{ secrets.X_ACCESS_TOKEN }}
          X_ACCESS_TOKEN_SECRET: ${{ secrets.X_ACCESS_TOKEN_SECRET }}
        run: python scripts/xbot.py
```

`schedule` の `cron` フィールドは POSIX 形式で **5 フィールド（分 時 日 月 曜）、タイムゾーンは UTC 固定**。`0 0,12 * * *` は「UTC の 0 時と 12 時ちょうど」を意味する。JST 朝 9 時・夜 9 時に投稿したい場合は UTC 0:00 / 12:00 でちょうど合う（+9h）。

参考: [GitHub Docs — Events that trigger workflows (schedule)](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#schedule)

### 投稿スクリプト（tweepy v4+ / X API v2）

```python
import os
import tweepy

client = tweepy.Client(
    consumer_key=os.environ["X_API_KEY"],
    consumer_secret=os.environ["X_API_SECRET"],
    access_token=os.environ["X_ACCESS_TOKEN"],
    access_token_secret=os.environ["X_ACCESS_TOKEN_SECRET"],
)

text = "今日のスパーリング相手を探すなら SparMate → https://sparmate.cosoado-lab.com"
response = client.create_tweet(text=text)
print(f"posted: {response.data['id']}")
```

tweepy は v4.0.0 以降で X API v2 の `Client` クラスに対応した。X 開発者ポータルでアプリを作る際、**Read and Write 権限** を設定しておかないと投稿時に `403 Forbidden` が出る。これで 30 分詰まった。最初に App permissions を確認するのが先決。

### GitHub Secrets への登録

```bash
gh secret set X_API_KEY             -R <owner>/<repo>
gh secret set X_API_SECRET          -R <owner>/<repo>
gh secret set X_ACCESS_TOKEN        -R <owner>/<repo>
gh secret set X_ACCESS_TOKEN_SECRET -R <owner>/<repo>
```

`gh secret set` はトークンの入力をプロンプトで受け付けるので、コマンドラインに直接値を渡す必要はない。シェル履歴にトークンを残さない方法の詳細は [GitHub Secret をシェル履歴に残さず登録する gh CLI の正しい使い方](https://qiita.com/Cosoado/items/a6f3b4f556aecb9827c8) を参照。

## 落とし穴

### 1. UTC 固定を忘れて 9 時間ズレる

これが一番やった失敗。`0 9 * * *` と書いて「JST 9 時に投稿されるはず」が、実際は JST 18 時に投稿されていた。GitHub Actions の `schedule` は UTC 固定で、JST には変換されない。「UTC + 9 = JST」と計算してから書く習慣を持つだけで回避できる。

### 2. 60 日以上リポジトリがアクティブでないとスケジュールが止まる

パブリックリポジトリで 60 日間コミットや PR などのアクティビティがないと、GitHub がスケジュールワークフローを自動で無効化する（公式仕様）。bot 専用の小さなリポジトリは特に注意が必要で、2 ヶ月後に Actions タブを見て「なぜか Disabled になっている」と気づく可能性がある。先に知っておくべきだった。`workflow_dispatch` をトリガーに残しておき、月 1 回手動実行するのが現実的な対策になる。

### 3. schedule の実行タイミングは保証されない

GitHub Docs でも明記されているが、高負荷期間には `schedule` の実行が数分〜数十分遅延することがある。秒単位の精密なタイミングが必要なユースケースには向かない。ゆるい定期投稿なら問題になることはほぼない。

## まとめ

launchd + ローカルスクリプトは「とりあえず動く」が、Mac がスリープすればズレ、手元になければ止まる。GitHub Actions `schedule` に移行してから、このリポジトリの bot は 3 ヶ月以上ほぼ無人で動き続けている。secrets も GitHub に集約でき、実行ログも Actions UI で追える。定期スクリプトをローカルで動かしているなら、移行コストは YAML 数十行だけで済む。

---

- SparMate（スパーリング相手マッチング）: https://sparmate.cosoado-lab.com
- NetaPair（アイデアマッチング）: https://netapair.cosoado-lab.com
- BoardLink（タスクボード連携）: https://boardlink.cosoado-lab.com
- Cosoado Lab: https://cosoado-lab.com
