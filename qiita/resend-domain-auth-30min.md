---
title: "Resend のドメイン認証を 30 分で完了させる：SPF・DKIM・DMARC 設定の最短ルート"
tags: ["Resend", "メール", "DNS", "個人開発", "Next.js"]
published: true
qiita_id: "2b2568797ffa0e12931c"
qiita_url: "https://qiita.com/Cosoado/items/2b2568797ffa0e12931c"
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/resend-domain-auth-30min/

## TL;DR

Resend でカスタムドメインからメールを送るには、DNS に 3 種類のレコードを追加するだけ。平均 15〜30 分で「Verified」になる。詰まるポイントはほぼ「apex ドメインではなくサブドメインを使う」この 1 点のみ。

---

最初にこれをやったのは NetaPair のメール通知を独自ドメインから送れるようにしたとき。水曜の夜 23 時過ぎ、明日のリリースに間に合わせたくて「30 分で終わるだろ」と決めてかかって始めた。実際に 27 分で Verified が出た。その手順をそのまま残す。

## なぜドメイン認証が必要か

Resend は無料プランでもアカウント作成直後からデフォルトアドレスでメール送信できる。ただしこれは Resend 自身のドメインなので、プロダクトから届く `from` アドレスとして使い物にならない。

それだけでなく、Google は 2024 年 2 月以降バルクメール送信者に SPF・DKIM・DMARC の設定を必須要件とした（参照: [Gmail 送信者ガイドライン - Google](https://support.google.com/mail/answer/81126)）。個人開発のサービスであっても、ユーザーにメールを送るなら認証は避けられない。

## DNS に追加する 3 レコード

Resend のドメイン追加画面（[resend.com/domains](https://resend.com/domains)）にアクセスして「Add Domain」を押すと、追加すべき DNS レコードが自動生成される。生成値はドメインごとに異なるが、レコードの種類は次の 3 つで固定。

| 役割 | Type | Name（`send.yourdomain.com` の場合） | Value |
|------|------|--------------------------------------|-------|
| SPF（送信元認証） | TXT | `send` | `v=spf1 include:spf.resend.com ~all` |
| DKIM（署名検証） | CNAME | `resend._domainkey.send` | `resend._domainkey.resend.com` |
| バウンス処理 | MX | `send` | `feedback-smtp.us-east-1.amazonses.com` Priority: 10 |

> **ポイント**: Name 列の文字列は DNS プロバイダーによって扱いが違う。Cloudflare や Namecheap はドメイン名を自動補完するため、末尾に `.yourdomain.com` を付けると二重になる。詳細はハマりどころ 2 を参照。

### サブドメインを使う理由

`yourdomain.com`（apex）に MX レコードを追加すると、Google Workspace など既存の受信用 MX と衝突してメール受信が壊れる。送信専用のサブドメイン（`send.yourdomain.com` や `mail.yourdomain.com`）を切り出すのが鉄則。

## 設定手順（4 ステップ）

### Step 1. Resend でドメインを追加する

[Resend ダッシュボード](https://resend.com/domains) を開き、「Add Domain」をクリック。入力欄には `send.yourdomain.com` のようなサブドメインを入力する。apex の `yourdomain.com` は避ける。

### Step 2. DNS プロバイダーでレコードを追加する

Resend の画面に表示された値をそのまま各レコードに貼り付ける。Cloudflare での具体的な入力例：

```text
# SPF（TXT）
Type:    TXT
Name:    send
Content: v=spf1 include:spf.resend.com ~all
TTL:     Auto

# DKIM（CNAME）
Type:    CNAME
Name:    resend._domainkey.send
Target:  resend._domainkey.resend.com
TTL:     Auto
Proxy:   DNS only（グレーのクラウド ← プロキシを外すこと）

# バウンス処理（MX）
Type:     MX
Name:     send
Value:    feedback-smtp.us-east-1.amazonses.com
Priority: 10
TTL:      Auto
```

### Step 3. Resend で Verify する

全レコード追加後、Resend のドメイン詳細ページで「**Verify DNS Records**」ボタンを押す。数分〜30 分で SPF・DKIM それぞれに ✅ が付き、Status が `Verified` に変わる。

```text
Pending → Verified
```

DNS 伝播の最大待ち時間は 72 時間。それを超えると `Failure` ステータスになる。

### Step 4. API キーを発行してテスト送信

認証完了後、API キーを発行して実際に送信確認する。

```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer <YOUR_RESEND_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "noreply@<YOUR_SEND_SUBDOMAIN>",
    "to": ["<YOUR_TEST_EMAIL>"],
    "subject": "Resend 認証テスト",
    "html": "<p>ドメイン認証完了</p>"
  }'
```

レスポンスに `id` が返ってきたら成功。ダッシュボードの Logs タブにも記録が残る。

## ハマりどころ 3 選

### 1. apex ドメインを使ってしまう（これが一番やった失敗）

`send.yourdomain.com` のつもりで `yourdomain.com` を入力してしまい、既存の MX レコードと衝突してメール受信が壊れた。気づかずに 1 時間、他の原因を探し回った。これが一番やった失敗で、先にこの記事を読んでいれば 5 分で回避できていた。

### 2. CNAME の Name にドメイン名を二重入力する

Resend の画面には `resend._domainkey.send.yourdomain.com` と表示されていた。それをそのまま Cloudflare の Name フィールドに貼ったところ、自動補完で `.yourdomain.com` が末尾に付加され、レコードが壊れた。Name には `resend._domainkey.send` だけを入力する。ドメイン名は含めない。

### 3. Cloudflare でプロキシを有効にする

CNAME レコードにオレンジのクラウド（HTTP プロキシ）を付けると、DKIM 検証の参照先が Cloudflare の IP になり `DKIM: fail` になる。グレーのクラウド（DNS only）に切り替えれば即座に解決する。

## まとめ

Resend のドメイン認証は 3 レコード追加だけで終わる。本質的な難しさは何もないが、「apex vs サブドメイン」「CNAME の Name の二重入力」「Cloudflare プロキシ」の 3 点は実際によく詰まる。この手順どおりに設定すれば 30 分以内に Verified に到達できる。

DMARC については Resend の公式ドキュメント「[Implementing DMARC - Resend](https://resend.com/docs/dashboard/domains/dmarc)」に詳しい。まず `p=none` で監視を始め、問題がなければ `p=quarantine` → `p=reject` と段階的に強化するのが定石。

---

Cosoado Lab のプロダクト:

- **SparMate** — AI 壁打ちサービス: https://sparmate.cosoado-lab.com
- **NetaPair** — アイデアマッチングサービス: https://netapair.cosoado-lab.com
- **BoardLink** — タスク × SNS 統合ツール: https://boardlink.cosoado-lab.com
- **Cosoado Lab**: https://cosoado-lab.com
