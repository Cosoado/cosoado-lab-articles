---
title: "GitHub Actions cron は平気で遅れる。「1 スロット 3 発」で冪等に 1 回だけ実行する方法"
emoji: "⏰"
type: "tech"
topics: ["githubactions", "cron", "ci", "個人開発", "idempotent"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/gha-cron-jitter-idempotent-slots/

毎日 01:00 UTC に Qiita へ自動投稿するワークフローを動かしていた。火曜の夜に「同じ記事が 2 本届いてるで」という DM が来て気づいた。90 分遅延した後にもう 1 トリガーが走っていて、二重投稿していた。GHA cron を信用しすぎていた話と、その後どう直したかを書く。

## GHA の schedule event は「希望の予約」に過ぎない

GitHub の公式ドキュメントには、こう書いてある。

> The schedule event can be delayed during periods of high loads of GitHub Actions workflow runs. High load times include the start of every hour. If the load is high enough, some queued jobs may be dropped.
>
> — [Events that trigger workflows – GitHub Docs](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#schedule)

「ドロップすることがある」まで書いてある。遅延じゃなくてドロップ。毎時 :00 分は特に高負荷タイムで、コミュニティには「8〜14 時間遅れた」「その日丸ごと飛んだ」という報告が実際に出ている。

設計で考慮すべき挙動は 2 つ:

- **遅延**: 30 分〜数時間、定刻より遅く動く
- **ドロップ**: その日一切動かない（無音で消える）

自分の話に戻ると、遅延した後に次の cron スロットもトリガーされ、どちらも同じ処理を走らせた。Qiita の投稿 API は同一記事の idempotency key を持たないので、普通に 2 件作成された。これは本番に 2 日間出てたやつです。ユーザーからの DM で気づきました。

## 「3 発撃つ」で冪等に解決する

解決のアイデアはシンプル。「1 日 1 回実行したい」ジョブなら、1 時間の幅に 3 本のトリガーを並べる。

```yaml
on:
  schedule:
    - cron: '0 1 * * *'   # 1st shot: 01:00 UTC
    - cron: '30 1 * * *'  # 2nd shot: 01:30 UTC
    - cron: '0 2 * * *'   # 3rd shot: 02:00 UTC
```

GitHub のスケジューラーが 1 本を消しても、残り 2 本でカバーできる。ただし 1 発が通れば残り 2 発は何もしないよう、**冪等チェックが必須**になる。冪等 = 何回実行しても結果が同じ。「今日の分はもう終わった」なら即終了する。

## パターン 1：GitHub Actions cache で「今日済みフラグ」を立てる

外部 DB を持ちたくない軽量ジョブ向け。

```yaml
jobs:
  daily-report:
    runs-on: ubuntu-latest
    steps:
      - name: Get today (UTC)
        id: date
        run: echo "today=$(date -u +%Y-%m-%d)" >> "$GITHUB_OUTPUT"

      - name: Check daily lock
        id: lock
        uses: actions/cache@v4
        with:
          path: /tmp/.daily-ran
          key: daily-report-${{ steps.date.outputs.today }}

      - name: Run report
        if: steps.lock.outputs.cache-hit != 'true'
        run: node scripts/send-daily-report.mjs

      - name: Mark done
        if: steps.lock.outputs.cache-hit != 'true'
        run: touch /tmp/.daily-ran
```

cache key に今日の日付を含めることで、「今日このワークフローが成功したか」をキャッシュとして保持する。2 発目以降は `cache-hit: true` になり、`Run report` と `Mark done` がスキップされる。`Mark done` を分離しているのは、`Run report` が失敗したときに `/tmp/.daily-ran` を作らないため。失敗した発は次でリトライされる。

## パターン 2：Supabase で監査ログを兼ねる

メール送信や外部 API 投稿など「いつ動いたか後で確認したい」ジョブには DB のほうが楽。

```sql
CREATE TABLE daily_cron_log (
  run_date  date NOT NULL,
  job_name  text NOT NULL,
  PRIMARY KEY (run_date, job_name)
);
```

```ts
// scripts/send-daily-report.mjs の冒頭
const today = new Date().toISOString().slice(0, 10); // "2026-08-24"

const { error: insertErr } = await supabase
  .from('daily_cron_log')
  .insert({ run_date: today, job_name: 'daily-report' });

if (insertErr?.code === '23505') {
  // unique_violation: 今日はもう走った
  console.log('Already ran today. Skipping.');
  process.exit(0);
}
if (insertErr) throw insertErr;

// ここから実際の処理
await sendMetricsEmail();
```

PostgreSQL エラーコード `23505` は unique violation。`PRIMARY KEY (run_date, job_name)` の一意制約で弾かれたら即終了する。テーブルが監査ログを兼ねるので、「あの日ちゃんと動いたっけ」が SELECT 一発で確認できる。

## 落とし穴：UTC/JST の日付ズレ

GHA cron は UTC 基準。`new Date().toISOString()` も UTC を返すので基本はズレない。JST で考えたくなる気持ちはわかるが、混ぜると日付をまたいだときにバグる。

```ts
// JST を使いたい場合（GHA の cron 設定も JST に合わせること）
const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);
```

ただし GHA の遅延で UTC の日付がまたぐと、JST との計算がさらにずれる可能性がある。UTC に統一するのがいちばんシンプル。

## まとめ

- GHA schedule event は遅延・ドロップが前提。「定刻に 1 回だけ動く」は保証されない
- 1 日 1 回ジョブは 1 時間の幅に 3 本のトリガーを並べる
- 冪等チェックを必ず入れる。cache（軽量）か DB（監査ログ込み）を選ぶ
- 日付処理は UTC に統一すると GHA の cron トリガーとズレない

このリポジトリの Qiita 自動投稿も今は同じパターンで守っている。過去に同じ失敗を 2 回したくなかったので。

---

**Cosoado Lab のプロダクト**

- [SparMate](https://sparmate.cosoado-lab.com) — スパーリング相手をマッチングするアプリ
- [NetaPair](https://netapair.cosoado-lab.com) — ネタ出しのペアプログラミングツール
- [BoardLink](https://boardlink.cosoado-lab.com) — ボードゲームのプレイヤーマッチング
- [Cosoado Lab](https://cosoado-lab.com) — 個人開発のラボ
