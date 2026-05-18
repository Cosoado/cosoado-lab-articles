---
title: "Supabase Auth の magic link を Resend に差し替えて本番メールを安定させる"
emoji: "📨"
type: "tech"
topics: ["supabase", "resend", "nextjs", "auth", "個人開発"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/supabase-auth-magic-link-with-resend/

## TL;DR

Supabase Auth のデフォルト SMTP は**本番環境で使えない**。プロジェクトメンバー以外には送れず、レート制限も非公開でいつ変わるかわからない。Resend のカスタム SMTP に差し替えることで、magic link が安定して届くようになる。設定は 30 分もあれば終わる。

---

SparMate の認証フローを組んでいた頃、ベータテスター 10 人ほどに magic link を送ったら半分が届かなかった。「email not authorized」のエラーを見たのがはじめてで、しばらく自分のコードを疑い続けた。原因はコードではなく、Supabase のデフォルト SMTP が**プロジェクトの Org メンバー以外のメールアドレスへの送信を拒否する**仕様だった。

ドキュメントをちゃんと読めば分かることだが、初めて本番を意識するタイミングまで気づかないのがあるある体験だと思う。

## Supabase のデフォルト SMTP の限界

Supabase Auth は最初から簡易 SMTP を内蔵している。ローカル開発や機能確認には十分だが、本番運用には向いていない。公式ドキュメント（[Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)）には次の 3 点が明記されている。

1. **組織メンバー以外には送信不可** — Org 設定にないメールアドレスには「Email address not authorized」を返す
2. **レート制限が非公開かつ変動** — 現時点の制限値はドキュメントに記載があるが、「notice なく変更する」とも書いてある
3. **SLA なし** — ベストエフォートの提供

つまり、テスト段階では問題なく動いていても、ユーザーが外部の人になった瞬間に壊れる設計になっている。

## Resend を使う理由

メール送信サービスは SendGrid や AWS SES など色々あるが、個人開発のスタック（Next.js + Supabase）では [Resend](https://resend.com) が一番しっくりくる。

- 無料枠が月 3,000 通（1 日 100 通）で個人開発には十分
- API key さえあれば SMTP としてもそのまま使える
- React Email との組み合わせでテンプレートをコードで管理できる

今回は **SMTP 経由で Supabase Auth に組み込む**方法を取る。より高度なテンプレートが必要になったら、後から Auth Hook + Resend API に移行できる。

## 設定手順

### 1. Resend でドメイン認証と API key 取得

まず [Resend のダッシュボード](https://resend.com/domains) でドメイン（例: `yourdomain.com`）を追加し、DNS レコードを設定する。

```text
Type: TXT
Name: resend._domainkey
Value: (Resendが生成するDKIM値)
```

ドメイン認証が通ったら、API key を作成する。

```text
Resend Dashboard → API Keys → Create API Key
```

API key は `re_` から始まる文字列で、スコープは `Sending access` だけで十分。

### 2. Supabase でカスタム SMTP を有効化

Supabase ダッシュボードで以下の順に開く。

```text
Project → Authentication → Settings → SMTP Settings
```

「Enable Custom SMTP」をオンにして、下記の値を入力する。

| 項目 | 設定値 |
|---|---|
| Host | `smtp.resend.com` |
| Port number | `465` |
| Username | `resend` |
| Password | `re_xxxxxxxxxxxx`（Resend の API key） |
| Sender email | `no-reply@<YOUR_DOMAIN>` |
| Sender name | アプリ名など |

Management API で設定する場合はこうなる。

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "smtp_host": "smtp.resend.com",
    "smtp_port": 465,
    "smtp_user": "resend",
    "smtp_pass": "'"$RESEND_API_KEY"'",
    "smtp_admin_email": "no-reply@<YOUR_DOMAIN>",
    "smtp_sender_name": "Your App Name"
  }'
```

`SUPABASE_ACCESS_TOKEN` は [アカウント設定](https://supabase.com/dashboard/account/tokens) から発行する Management API トークン、`PROJECT_REF` はプロジェクト URL の `https://supabase.com/dashboard/project/<PROJECT_REF>` の部分。

### 3. レート制限を引き上げる

**ここが自分が一番やらかした失敗ポイント。**

カスタム SMTP に切り替えた直後は、Supabase 側で 1 時間 30 通の保護レート制限が自動でかかる。この制限に気づかず「Resend の設定がおかしいのか」と 2 時間溶かした。

設定は `Authentication → Rate Limits` から変更できる。SparMate では 1 時間 200 通に設定している（同時アクセスが集中するイベント前は一時的にさらに引き上げる）。

### 4. magic link のコード

クライアントからは `signInWithOtp` を呼ぶだけ。特に Resend を意識したコードの変更はいらない。

```ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function sendMagicLink(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  })

  if (error) throw error
}
```

PKCE フローを使っている場合（App Router + SSR 構成）は、メールテンプレートも変更が必要になる。`Authentication → Email Templates → Magic Link` を開いて、デフォルトのリンクを token_hash 形式に書き換える。

```html
<h2>ログインリンク</h2>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">
    ログインする
  </a>
</p>
```

`/auth/confirm` エンドポイントでトークンをセッションに変換する処理（`verifyOtp`）はフレームワークの SSR ガイドに沿って実装する。

## 本番で気をつけること

**SPF/DKIM/DMARC を必ず設定する。** Resend のダッシュボードはドメイン追加時に SPF・DKIM の DNS レコードを自動生成してくれる。これを設定しないと Gmail や iCloud Mail に弾かれる。DMARC は最低でも `p=none` で様子見から始めることを勧める。

**from アドレスを auth 専用ドメインに分ける。** マーケティングメールと同じドメインを使うと、どちらかの評判が悪くなったときにすべてのメールが巻き添えになる。`auth.<YOUR_DOMAIN>` のサブドメインを認証専用にしておくと安全。実際 Supabase の公式ドキュメントでもこの分離を推奨している。

**メールテンプレートにユーザー入力を入れない。** Supabase のデフォルトテンプレートに名前の差し込みを追加したくなるが、スパムフィルターへの引っかかりやすさが上がる。Supabase ドキュメントには「ユーザー提供のデータ（名前、ユーザー名、メールアドレス）を認証メールに含める場合はサニタイズする」と書かれている。

## まとめ

Supabase Auth の magic link を Resend の SMTP に差し替えるには、主に 3 ステップで完結する。

1. Resend でドメイン認証 + API key 取得
2. Supabase の Custom SMTP 設定に `smtp.resend.com:465` + API key を登録
3. Supabase の Rate Limits でレート上限を調整（デフォルト 30/h のまま放置しない）

自分のアプリが外部ユーザーを迎える段階になったら、最初の日に設定しておくべき作業だと思う。ドキュメントを読めば分かることなのに、ローカルで動いているうちは後回しにしがちなので。

次回は Resend の Auth Hook と React Email を組み合わせて、ブランド感のあるテンプレートをコードで管理する方法を書く予定。

---

Cosoado Lab が開発しているプロダクト:

- **SparMate** — スパーリング相手を探すマッチングアプリ: https://sparmate.cosoado-lab.com
- **NetaPair** — 技術ネタを一緒に掘り下げる相手を探すサービス: https://netapair.cosoado-lab.com
- **BoardLink** — ボードゲームの対戦相手マッチング: https://boardlink.cosoado-lab.com
- **Cosoado Lab** — 個人開発の知見をまとめたブログ: https://cosoado-lab.com
