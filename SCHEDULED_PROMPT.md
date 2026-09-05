# スケジュールプロンプト（索引）

Claude Code の「Scheduled Tasks」に設定するプロンプトの正規ソース。
媒体ごとに分かれている。変更はこれらのファイルで行い、UI 側にコピーする。

| 媒体 | ファイル | 公開先 |
|---|---|---|
| Zenn | [SCHEDULED_PROMPT_ZENN.md](./SCHEDULED_PROMPT_ZENN.md) | `articles/` → push で即時公開 |
| Qiita | [SCHEDULED_PROMPT_QIITA.md](./SCHEDULED_PROMPT_QIITA.md) | `qiita/` → GHA が API POST |

## 2 つのエージェントが並行稼働することの扱い

Zenn と Qiita は別スケジュールで動き、**互いの実行を知らない**。
2026-09-05 に実際に両方が同時刻帯に走り、同じ仕様ファイルを別々に書き換えて
矛盾（文字数が 3 通りに分裂）を生み、push が 2 度衝突した。

対策は 2 つ:

**1. 投稿の衝突 → 機械ゲート**

両プロンプトの Step 2 で必ず実行する。

```bash
node scripts/check-publish-window.mjs --platform <zenn|qiita>
```

exit 1 なら公開しない。同一媒体は中 7 日、媒体をまたぐ場合は中 3 日を強制する。
これが媒体をまたいだ連投（スパム判定リスク）を防ぐ唯一の仕組み。

**2. 仕様の衝突 → 正典の一本化**

プロンプトファイルに数値を直書きしない。必ず正典を参照する。

| 決めること | 正典 |
|---|---|
| 投稿頻度・トピック選定・情報源 | [PUBLISHING_POLICY.md](./PUBLISHING_POLICY.md) |
| 文字数・採点配分 | [REVIEW_CHECKLIST.md](./REVIEW_CHECKLIST.md) |
| 文体・frontmatter | [CONTENT_TEMPLATE.md](./CONTENT_TEMPLATE.md) |
| トピック候補 | [TOPIC_BACKLOG.md](./TOPIC_BACKLOG.md) |

正典を書き換えたら、両プロンプトに矛盾が出ていないか確認する。

## push が衝突したら

もう一方のエージェントが先に push している。rebase してから push し直す。

```bash
git fetch origin main && git rebase origin/main && git push origin main
```

**force push は禁止**（相手の成果を消す）。
