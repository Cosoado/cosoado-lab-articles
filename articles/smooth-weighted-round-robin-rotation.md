---
title: "nginx の smooth weighted round-robin を SNS 投稿ローテに転用したら連投が消えた"
emoji: "🔁"
type: "tech"
topics: ["algorithm", "nginx", "python", "githubactions", "個人開発"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/smooth-weighted-round-robin-rotation/

SNS アカウントを 1 つ止められたことがあります。原因は投稿数の出しすぎでした。頻度を落として再開したのに、今度は「同じ話題の連投」で同じ轍を踏みかけた。重み付きで投稿対象を選ぶ実装が、重い要素をきれいに固めていたからです。

直したのは nginx が 2012 年に入れたアルゴリズムでした。

## TL;DR

- 重みのぶんだけ要素を並べる素朴な実装は、重い要素が**かたまる**
- nginx が 2012 年に入れた smooth weighted round-robin を使うと、比率を保ったまま出現位置がばらける
- 実装は 10 行程度。しかも**決定的な純関数**なので、cron の多重発火に対して冪等性を保てる

## 5 つのアプリを重み付きで回したかった

個人開発でスマホアプリを複数運用していて、SNS の定期投稿 bot が 1 日 2 回（JST 07:00 と 20:00）、そのうちどれか 1 本を紹介します。

全部を均等に扱いたくはありませんでした。直近リリースした 2 本を押したい。そこで重みを決めました。

| アプリ | 重み |
| --- | --- |
| A（新作） | 5 |
| B（新作） | 5 |
| C | 3 |
| D | 2 |
| E | 1 |

合計 16。16 スロットで 1 周させれば、この比率になります。

## 素朴に並べると「かたまり」になる

最初に書いたのはこれでした。

```python
W = {"A": 5, "B": 5, "C": 3, "D": 2, "E": 1}
ring = [b for b, w in W.items() for _ in range(w)]
```

出力を見て手が止まりました。

```text
A A A A A B B B B B C C C D D E
```

比率は合っています。合っているのに使えない。1 日 2 回なので、**2 日半ずっと A の話だけ**をすることになります。

これが致命的だったのは、冒頭のアカウント停止があったからです。頻度は落としたのに、今度は話題の偏りで同じところへ戻りかけていた。比率だけ合っていても運用は守れない。

`random.shuffle` も考えましたが、これは捨てました。ランダムだと運悪く 3 連続することがあるうえ、後述する冪等性が壊れます。

## nginx が 2012 年に同じ問題を解いていた

ロードバランサでも同じ形の問題が起きます。重み {5, 1, 1} のサーバ群に素朴な重み付きラウンドロビンをかけると、リクエストが 1 台に集中する区間ができる。

nginx の [Upstream: smooth weighted round-robin balancing.](https://github.com/nginx/nginx/commit/52327e0) がこれを直しています。コミットメッセージにアルゴリズムがそのまま書いてあります。

> on each peer selection we increase current_weight of each eligible peer by its weight, select peer with greatest current_weight and reduce its current_weight by total number of weight points distributed among peers.

3 行です。

1. 全要素の `current_weight` に、それぞれの重みを足す
2. `current_weight` が最大の要素を選ぶ
3. 選ばれた要素の `current_weight` から、重みの合計を引く

同じコミットに {5, 1, 1} の結果が載っています。旧実装が `c, b, a, a, a, a, a` だったのに対し、新実装は `a, a, b, a, c, a, a`。比率は同じまま、`a` が全体に散っています。

## Python にすると 10 行

```python
def build_ring(weights: dict[str, int]) -> tuple[str, ...]:
    total = sum(weights.values())
    credit = {k: 0 for k in weights}
    ring: list[str] = []
    for _ in range(total):
        for k, w in weights.items():
            credit[k] += w
        # 同点は dict の宣言順で決まる（max は最初の最大値を返す）
        pick = max(credit, key=lambda k: credit[k])
        credit[pick] -= total
        ring.append(pick)
    return tuple(ring)
```

自分の重みで回した結果です。

```text
A B C D A B E A B C A B D C A B
```

最長連続は 1。かたまりが消えました。出現数は A:5 B:5 C:3 D:2 E:1 で、重みどおりです。

移植が正しいかは、nginx のコミットに載っている例で確かめました。

```python
>>> build_ring({"a": 5, "b": 1, "c": 1})
('a', 'a', 'b', 'a', 'c', 'a', 'a')
```

コミットメッセージの記載と一致します。自分の理解ではなく一次ソースの出力と突き合わせられるのは、移植ものでは貴重でした。

## 決定的であることが、cron の多重発火を助ける

このアルゴリズムを選んだ理由のうち、実運用でいちばん効いたのは分布ではなく**決定性**でした。

GitHub Actions の `schedule` は発火が保証されません。30〜90 分遅れることがあるので、1 つのスロットに対して cron を 3 発仕掛けて保険にしています。当然、3 発とも走ることがあります。

`build_ring` は入力が同じなら常に同じ列を返す純関数です。スロット番号さえ決まれば選ばれる要素も決まる。

```python
_RING = build_ring(W)

def pick_for_slot(global_slot: int) -> str:
    return _RING[global_slot % len(_RING)]
```

同じスロットに属する 3 発は同じ要素を返すので、あとは「直近に投稿済みか」を state file で見るだけで重複が消えます。`random` を使っていたら、3 発が 3 種類の要素を返して、重複判定そのものが成立しませんでした。

不変条件は起動時に潰しておきます。

```python
_RING = build_ring(W)
assert len(_RING) == sum(W.values())
assert all(_RING.count(k) == w for k, w in W.items()), "重みと出現回数が一致しない"
```

重みを書き換えたときに気づけます。実際、比率を調整したときに片方だけ直して合計が変わり、この assert に助けられました。

## 「何周目か」は登板回数で数える

各アプリには原稿が複数あり、登板するたびに次の原稿へ進めたい。ここで `global_slot // len(ring)` を使うと、重みの軽い要素ほど原稿が進まなくなります。1 周に 1 回しか出ない E も、5 回出る A も、同じ「周回数」で数えてしまうからです。

正しくは「その要素が過去に何回選ばれたか」です。

```python
def rotation_index(global_slot: int, target: str) -> int:
    n = len(_RING)
    pos = global_slot % n
    # 完了した周回ぶん + 今周の先頭から現在位置まで
    return (global_slot // n) * _RING.count(target) + _RING[:pos].count(target)
```

こうすると、登板頻度が高い要素ほど原稿も速く一巡します。押したいアプリほど同じ文面の再出現が早まるので、そこは原稿を増やして吸収する、という運用の判断に落ちました。アルゴリズムが「原稿を何本用意すべきか」を教えてくれる形になったのは、書いてみるまで予想していませんでした。

## まとめ

- 重みぶん並べる実装は比率だけ合っていて、並び順が使い物にならない
- nginx の smooth weighted round-robin は 3 行の説明で、実装は 10 行
- 移植の正しさは、コミットに載っている {5, 1, 1} の期待列で検証できる
- 決定的な純関数なので、多重発火する cron でも同じスロットは同じ結果になる
- 要素内のローテは周回数ではなく「その要素の登板回数」で数える

ロードバランサ用のアルゴリズムだと思っていましたが、「重み付きで、かつ偏らせたくない」場面はプレイリストでも A/B テストの割り当てでも同じ形をしています。10 行なので、素朴な実装で困ったら差し替えてしまうのが早いです。
