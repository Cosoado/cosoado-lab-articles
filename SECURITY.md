# Security Policy

このリポジトリ `cosoado-lab-articles` は **Cosoado Lab の技術ブログ記事ソースのみ**を管理する公開リポジトリです。
本体プロダクト（マッチングアプリ等）のソースコードは含まれません。

## 対象範囲

- `articles/` 配下の Markdown（Zenn 公開対象）
- `qiita/` 配下の Markdown（Qiita 公開対象）
- `scripts/` 配下の自動投稿スクリプト
- `.github/workflows/` 配下の GitHub Actions

## 報告窓口

セキュリティ上の懸念（記事中の意図せぬ秘密情報漏洩、スクリプトの脆弱性、GHA ワークフローの権限濫用など）を発見された場合は、以下までご連絡ください。

- **メール**: cosoadooo@gmail.com
- **件名プレフィックス**: `[security] cosoado-lab-articles:`

公開 Issue で報告される前に、上記メールでの連絡をお願いします。72 時間以内に一次返答することを目標としています。

## このリポジトリのセキュリティ対策

- **GitHub Actions の SHA ピン留め**: 全ての external action は commit SHA で固定し、supply chain 攻撃に備えます
- **最小権限**: ワークフローのデフォルトパーミッションは `contents: read`、書き込みが必要な job のみ明示的に昇格
- **Secret スキャン**: 投稿前に `scripts/validate-articles.mjs` が AWS / GitHub / Slack / Stripe / DB URL 等のパターンを検出。検出された場合は publish が自動で abort
- **記事の公開フロー**: 全記事は `_drafts/` でレビューされ、独立評価機関（reviews 部門）で **100/100 + Critical/Major/Minor 全 0** の判定を得てから公開対象ディレクトリに昇格
- **PII 排除**: cosoadooo@gmail.com 以外のメールアドレス・電話番号らしきパターンは validator が CRITICAL として検出
- **本体プロダクトの隔離**: matching-app-template 等の private 本体リポジトリと完全分離。誤って本体ソースが混入する経路を構造的に存在させない

## サポート対象外

- 過去の commit に含まれていた可能性のある内容（記事自体は public 公開を前提にレビュー済み）
- 第三者サービス（Zenn / Qiita）側のセキュリティ事案

報告いただいた内容は、本リポジトリのスコープ内であれば誠意をもって対応します。
