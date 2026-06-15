---
title: "Vercel Hobby の Cron Jobs で複数アプリの日次メトリクスを 1 通にまとめてメール送信する"
emoji: "⏰"
type: "tech"
topics: ["vercel", "nextjs", "resend", "cron", "個人開発"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/vercel-cron-jobs-aggregate-daily-metrics-email/

## TL;DR

Vercel Hobby で複数アプリを運用していると、毎日の登録数や利用状況を確認するためにダッシュボードを何個も開く羽目になる。各プロジェクトにバラバラで cron を置いてもメールが複数通届くだけ。解決策は「集計専用の Vercel プロジェクトを 1 本立て、そこから各アプリの Supabase に接続して Resend で 1 通に集約する」こと。

---

SparMate のユーザー数が 100 人を超えてきた頃、NetaPair と BoardLink の数字を確認しに行くのを忘れるようになっていた。毎日 Vercel のダッシュボードを 3 つ開いて、Supabase を 3 プロジェクト分ひっくり返す。それだけでもう「数字を見る」という行為が億劫になっていた。「今週 NetaPair で 8 人入ってた」と気づいたのが 3 日後、という週もあった。

各プロジェクトに個別で cron を置いてメールを送ることも試みたが、アプリごとに 1 通ずつ届く形では「全体観」がない。Vercel Hobby プランではプロジェクトあたり **2 本まで** cron が作れるが（[Vercel Cron Jobs ドキュメント](https://vercel.com/docs/cron-jobs)）、SparMate の cron 枠は既に SNS 自動投稿で使っていた。

「集計専用プロジェクトを 1 本立てる」という方向にしてから、朝 10 時に 1 通届くだけになって運用が圧倒的に楽になった。

## vercel.json でスケジュールを定義する

`metrics-hub` という新しい Next.js プロジェクトを Vercel に作り、ルートに `vercel.json` を置く。

```json
{
  "crons": [
    {
      "path": "/api/cron/daily-report",
      "schedule": "0 1 * * *"
    }
  ]
}
```

`schedule` の書式は標準的な cron 式で、**タイムゾーンはすべて UTC** で解釈される（[Vercel ドキュメント: Cron Jobs](https://vercel.com/docs/cron-jobs)）。`0 1 * * *` は「毎日 01:00 UTC」= 「毎日 10:00 JST」。

最初に `0 9 * * *`（09:00 UTC = 18:00 JST）で設定してしまい、夜 6 時にメールが来るようになって気づいた。UTC と JST の 9 時間差は体感より間違えやすい。朝に受け取りたいなら UTC で引き算して設定する。

## CRON_SECRET で認証する（最初に実装すること）

エンドポイントを置くだけだと、URL を知っていれば誰でも叩ける。Vercel は `CRON_SECRET` 環境変数を設定しておくと、cron 実行時に `Authorization: Bearer <CRON_SECRET>` ヘッダーを付与してルートを呼んでくれる。ルート側でこれを検証するのが公式推奨のパターンだ（[Vercel: Securing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)）。

```bash
# Vercel ダッシュボード Settings → Environment Variables
# 以下の値を設定する
# CRON_SECRET=<openssl rand -hex 32 で生成した値>
```

```ts
// app/api/cron/daily-report/route.ts
import { NextResponse } from 'next/server'
import { buildReport } from '@/lib/metrics'
import { sendReport } from '@/lib/send-report'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const report = await buildReport()
  await sendReport(report)

  return NextResponse.json({ ok: true })
}
```

これが一番やった失敗だ。最初の実装で「後でちゃんとやろう」と CRON_SECRET の確認を省いてデプロイした。2 時間後、Vercel のファンクションログに見知らぬ IP からのリクエストが複数行入ってきているのを見て血の気が引いた。内部で Supabase の service_role キーを使うルートを無防備に晒すのは洒落にならない。cron エンドポイントを作ったら CRON_SECRET チェックは**必ず冒頭に**入れること。

## 複数 Supabase からメトリクスを集める

`metrics-hub` の環境変数に各アプリの Supabase 接続情報を登録する。

```text
SPARMATE_SUPABASE_URL=https://<sparmate-project-ref>.supabase.co
SPARMATE_SUPABASE_SERVICE_KEY=<your-service-role-key>
NETAPAIR_SUPABASE_URL=https://<netapair-project-ref>.supabase.co
NETAPAIR_SUPABASE_SERVICE_KEY=<your-service-role-key>
BOARDLINK_SUPABASE_URL=https://<boardlink-project-ref>.supabase.co
BOARDLINK_SUPABASE_SERVICE_KEY=<your-service-role-key>
```

service_role キーを使うのは、集計クエリには RLS を超えて全データを読む必要があるため。本来は analytics 専用の Postgres ロールを作って権限を絞るのが理想だが、個人開発の初期段階では service_role で十分動く。

```ts
// lib/metrics.ts
import { createClient } from '@supabase/supabase-js'

type AppKey = 'SPARMATE' | 'NETAPAIR' | 'BOARDLINK'

async function fetchMetrics(app: AppKey) {
  const supabase = createClient(
    process.env[`${app}_SUPABASE_URL`]!,
    process.env[`${app}_SUPABASE_SERVICE_KEY`]!,
  )

  const todayUTC = new Date()
  todayUTC.setUTCHours(0, 0, 0, 0)

  const [totalResult, todayResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true }),
    supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayUTC.toISOString()),
  ])

  return {
    total: totalResult.count ?? 0,
    today: todayResult.count ?? 0,
  }
}

export async function buildReport() {
  const [sparmate, netapair, boardlink] = await Promise.all([
    fetchMetrics('SPARMATE'),
    fetchMetrics('NETAPAIR'),
    fetchMetrics('BOARDLINK'),
  ])
  return { sparmate, netapair, boardlink, generatedAt: new Date().toISOString() }
}
```

`select('*', { count: 'exact', head: true })` は本文を返さず件数だけ取る（[supabase-js リファレンス](https://supabase.com/docs/reference/javascript/select)）。ユーザー数が増えてきたときに全行をフェッチすると無駄なデータ転送が発生する。`head: true` を忘れずに付ける。

## Resend でメールを組み立てて送る

```ts
// lib/send-report.ts
import { Resend } from 'resend'
import type { buildReport } from './metrics'

const resend = new Resend(process.env.RESEND_API_KEY)

function row(label: string, total: number, today: number) {
  return `<tr><td>${label}</td><td>${total.toLocaleString()}</td><td style="color:${today > 0 ? '#16a34a' : '#6b7280'}">+${today}</td></tr>`
}

export async function sendReport(report: Awaited<ReturnType<typeof buildReport>>) {
  const { sparmate, netapair, boardlink, generatedAt } = report
  const date = new Date(generatedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })

  const html = `
    <h2 style="font-family:sans-serif">📊 日次レポート ${date}</h2>
    <table style="border-collapse:collapse;font-family:sans-serif">
      <thead>
        <tr style="background:#f3f4f6">
          <th style="padding:8px 16px;text-align:left">アプリ</th>
          <th style="padding:8px 16px;text-align:right">累計</th>
          <th style="padding:8px 16px;text-align:right">本日</th>
        </tr>
      </thead>
      <tbody>
        ${row('SparMate', sparmate.total, sparmate.today)}
        ${row('NetaPair', netapair.total, netapair.today)}
        ${row('BoardLink', boardlink.total, boardlink.today)}
      </tbody>
    </table>
  `

  const { error } = await resend.emails.send({
    from: 'metrics@<YOUR_DOMAIN>',
    to: 'cosoadooo@gmail.com',
    subject: `📊 日次レポート ${date}`,
    html,
  })

  if (error) throw new Error(`Resend error: ${error.message}`)
}
```

`resend.emails.send()` の必須フィールドは `from`・`to`・`subject`・`html` (または `text` か `react` のいずれか)（[Resend API リファレンス](https://resend.com/docs/api-reference/emails/send-email)）。`from` は Resend のダッシュボードで認証済みのドメインでないと送信エラーになる。

## ローカルでテストする

cron は Vercel 上でしか自動実行されないが、ルート自体は通常の HTTP エンドポイントなので手元から叩ける。

```bash
# .env.local に CRON_SECRET と各種 Supabase キーを記載した上で実行
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily-report
```

`{"ok":true}` が返ればメール送信まで動いている。Resend のダッシュボード（[resend.com/emails](https://resend.com/emails)）で送信ログが確認できる。

## まとめ

Vercel Hobby の複数アプリ横断で日次メトリクスを 1 通にまとめるには、集計専用の `metrics-hub` プロジェクトを 1 本立てるのが一番シンプルだった。3 つのポイント:

1. `vercel.json` の `schedule` は **UTC 基準** — 受け取りたい JST 時刻から 9 時間引いた値を設定する
2. `CRON_SECRET` は**最初に**実装する — service_role キーを扱うエンドポイントを無防備に晒すのは危険
3. Supabase の count クエリは `{ count: 'exact', head: true }` — 全行フェッチを避ける

次は本日との比較 (前日差) と週次トレンドを加えて、メールをもう少しダッシュボードらしくする話を書く予定。

---

Cosoado Lab が開発しているプロダクト:

- **SparMate** — スパーリング相手を探すマッチングアプリ: https://sparmate.cosoado-lab.com
- **NetaPair** — 技術ネタを一緒に掘り下げる相手を探すサービス: https://netapair.cosoado-lab.com
- **BoardLink** — ボードゲームの対戦相手マッチング: https://boardlink.cosoado-lab.com
- **Cosoado Lab** — 個人開発の知見をまとめたブログ: https://cosoado-lab.com
