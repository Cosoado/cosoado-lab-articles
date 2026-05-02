---
title: "Vercel で 1 リポジトリを 4 プロジェクトに紐付け、env var だけで別アプリ化する実例"
tags: ["Vercel", "Next.js", "個人開発", "マルチテナント", "デプロイ"]
published: true
qiita_id: "893d20329cf30c3f61be"
qiita_url: "https://qiita.com/Cosoado/items/893d20329cf30c3f61be"
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/vercel-one-repo-multiple-projects/

## はじめに

Cosoado Lab では **Next.js 1 リポジトリから 4 つのアプリを並列で動かしています**（格闘技・お笑い・ボードゲーム向けマッチングアプリ + staging）。仕組みは至ってシンプルで、**同じ GitHub リポジトリを Vercel の 4 プロジェクトに紐付け、`NEXT_PUBLIC_GENRE` という env var だけプロジェクトごとに変える**——それだけです。

この記事は次のような個人開発者向けに書きました。

- 同じスタックで「色違い・機能違い」のアプリを横展開したい
- でも DB やコードを 4 倍持ちたくない
- Vercel 公式ドキュメントには「1 repo → 1 project」の例しかなく、複数紐付けの運用例が少ない

最後まで読むと、**1 回の `git push` で 3 本番 + 1 staging が並列ビルドされる構成**を再現できます。

## 構成の全体像

| プロジェクト | 環境変数 | ドメイン | 役割 |
|---|---|---|---|
| martial-matching | `NEXT_PUBLIC_GENRE=martial` | sparmate.cosoado-lab.com | 格闘技 |
| comedy-matching | `NEXT_PUBLIC_GENRE=comedy` | netapair.cosoado-lab.com | お笑い |
| boardgame-matching | `NEXT_PUBLIC_GENRE=boardgame` | boardlink.cosoado-lab.com | ボドゲ |
| matching-app-template | (未設定) | (preview のみ) | staging |

ソースは [Next.js App Router + Supabase + Vercel](https://vercel.com/docs/frameworks/nextjs) という退屈なスタック。ジャンルごとの差分は、たった 1 つの設定ファイルに集約しています。

## 手順

### 1. Vercel で同じ repo を複数プロジェクトに紐付ける

Vercel ダッシュボードで `New Project` → GitHub から同じリポジトリを選ぶ、を **4 回繰り返す**だけです。同じ repo を選び直すと「Already imported」の警告が出ますが、**プロジェクト名を変えれば普通に 2 つ目以降を作れます**。

公式ドキュメントには明記されていませんが、Vercel は **1 GitHub repo に対して N 個のプロジェクトを許容**します。これがこの構成の根幹です。

参考: [Vercel docs — Connecting projects to a Git repository](https://vercel.com/docs/git)

### 2. プロジェクトごとに env var を切り替える

Vercel CLI で一気に設定する例です。

```bash
# 各プロジェクトごとに個別に走らせる
npx vercel link --project martial-matching --yes
echo "martial" | npx vercel env add NEXT_PUBLIC_GENRE production

npx vercel link --project comedy-matching --yes
echo "comedy" | npx vercel env add NEXT_PUBLIC_GENRE production

npx vercel link --project boardgame-matching --yes
echo "boardgame" | npx vercel env add NEXT_PUBLIC_GENRE production
```

### 3. アプリ側で env var を読む

```ts
// src/config/genre.ts
type Genre = 'martial' | 'comedy' | 'boardgame';

export const GENRE_CONFIGS: Record<Genre, GenreConfig> = {
  martial: {
    name: 'SparMate',
    primaryColor: '#dc2626',
    defaultLanguage: 'en',
    featureFlags: { locationRequired: true, superLikeEnabled: false },
  },
  comedy: {
    name: 'NetaPair',
    primaryColor: '#f97316',
    defaultLanguage: 'ja',
    featureFlags: { locationRequired: false, superLikeEnabled: true },
  },
  boardgame: {
    name: 'BoardLink',
    primaryColor: '#7c3aed',
    defaultLanguage: 'ja',
    featureFlags: { locationRequired: true, superLikeEnabled: false },
  },
};

export function getGenreConfig(): GenreConfig {
  const g = (process.env.NEXT_PUBLIC_GENRE ?? 'martial') as Genre;
  return GENRE_CONFIGS[g];
}
```

`NEXT_PUBLIC_` プレフィックスを付けているのは、クライアント側の UI もこの値を読むためです（[Next.js — Environment Variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)）。

### 4. ドメインを各プロジェクトに割り当てる

各プロジェクトの `Settings → Domains` で、対応するサブドメインを登録します。DNS は親ドメイン側で `CNAME` を `cname.vercel-dns.com` に向けるだけ。

## やってみて初めて気づいた落とし穴 4 つ

### 落とし穴 1: Hobby プランの concurrent build は **1**（=N 倍待つ）

これが個人開発で多プロジェクト構成を取るときの最大の現実です。
[Vercel Limits](https://vercel.com/docs/limits) 表によると、Hobby の Concurrent Builds は **1**。Pro は 12。

つまり 4 プロジェクトを同じ commit で push すると、**4 つのビルドが直列に流れます**。1 ビルドが 2 分なら、最後のプロジェクトが緑になるまで 8 分。**3 倍 4 倍待つことを最初から覚悟しておく**ほうが精神衛生上良いです。

頻繁に push する開発フェーズでは Pro 移行（$20/mo）が現実的な選択肢になります。私の場合は本番が安定運用フェーズに入っているので Hobby 据え置き。緊急の hotfix が必要なときだけ「直列で 8 分待つ」のは許容しています。

### 落とし穴 2: env var を設定し忘れて全部 same UI になる

これが一番やった失敗です。**新しい Vercel プロジェクトを作った瞬間、env var は空**。デフォルト値が `'martial'` で起動するので、全ジャンル SparMate の UI で出てきます。

対策はシンプルで、`getGenreConfig` の中で「env var が未設定なら build を fail させる」検証を入れる方が安全でした。

```ts
export function getGenreConfig(): GenreConfig {
  const g = process.env.NEXT_PUBLIC_GENRE;
  if (!g || !(g in GENRE_CONFIGS)) {
    throw new Error(`NEXT_PUBLIC_GENRE is missing or invalid: "${g}"`);
  }
  return GENRE_CONFIGS[g as Genre];
}
```

これで env var 設定漏れがあれば即ビルドが落ちます。

### 落とし穴 3: Build Cache はプロジェクト間で共有されない

同じソース・同じ `node_modules` でも、**プロジェクトごとに `.next/cache` は別物**です。初回ビルドは 4 プロジェクト分まるまる走ります。

回避策は今のところ無し（[Vercel docs — Build Cache](https://vercel.com/docs/deployments/configure-a-build#build-cache) 参照）。許容するか、もし複数プロジェクトの初回ビルド時間が痛いならモノレポ + `next start` 系の自前構成への移行を検討します。

### 落とし穴 4: ブランチを切ると 4 プロジェクトすべてが preview をビルドする

落とし穴 1 と合わせるとここが効きます。`git push origin feature/foo` で **4 プロジェクト全部が preview deploy のキューに積まれ、Hobby なら直列に 4 本ビルドする**。1 PR の体感ビルド時間が一気に伸びます。

対策は `vercel.json` の `git.deploymentEnabled` で、本番 3 プロジェクトだけ「特定ブランチでビルドしない」設定を入れることです。docs 例（[Git Configuration](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled)）に従い、minimatch シンタックスで指定できます。

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": {
      "internal-*": false
    }
  }
}
```

上の例は `internal-*` で始まるブランチを当該プロジェクトでデプロイしません。**これをプロジェクトごとに使い分け**、staging だけ全ブランチを許可、本番 3 つは内部開発ブランチを除外する、といった構成にすると preview ビルド枠を無駄に消費しません。

## まとめ

- 同じ repo を Vercel の N プロジェクトに紐付けると、env var の差だけで N 個のアプリを **同時運用**できる
- ただし Hobby プランの concurrent build は 1 なので、ビルドは **直列**になる。push から最後の本番が緑になるまで N 倍待つ覚悟が要る
- **build cache 非共有・env var 設定漏れ・preview deploy の連鎖**の 3 つは事前に押さえる
- Hobby の 1 repo あたりプロジェクト上限は 10 なので、設定上の天井までは余裕がある

この構成で「あと 1 人」を見つけるマッチングアプリを 3 ジャンル運用しています。次回は **`NEXT_PUBLIC_GENRE` 1 つで配色・言語・機能フラグを切り替えるアプリ側の設計** を書く予定です。

3 アプリの実物はこちら:

- [SparMate](https://sparmate.cosoado-lab.com) — 格闘技の練習相手
- [NetaPair](https://netapair.cosoado-lab.com) — お笑いの相方
- [BoardLink](https://boardlink.cosoado-lab.com) — ボドゲ・TRPG 仲間

ご意見・質問はコメント欄か [Cosoado Lab](https://cosoado-lab.com) からお気軽にどうぞ。
