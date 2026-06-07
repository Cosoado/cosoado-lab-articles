---
title: "LLM が間違ってもユーザーが気づけない領域に、汎用モデルを使ってはいけない — 寿司チャットボットの設計判断"
tags: ["OpenAI", "LLM", "プロンプトエンジニアリング", "個人開発", "ChatGPT"]
published: true
qiita_id: "389a51f6db6053d2b1ac"
qiita_url: "https://qiita.com/Cosoado/items/389a51f6db6053d2b1ac"
---

## TL;DR

- ChatGPT に「omakase を食べる時のマナー」を聞くと、もっともらしい嘘が混じった答えが返ってくる
- 危険なのは「間違いだとユーザーが検証できない領域」で汎用 LLM を出力レイヤーに置くこと
- 設計の三択は (A) RAG with curated KB、(B) domain-tuned system prompt + 出典明示、(C) rule-based fallback for high-confidence Q
- 私は (B) + offline cache を選んだ。理由はインバウンド観光客がオフラインで使う前提だったから
- 「LLM が間違っても誰も気づかない」と判定したら、その瞬間に汎用モデルから降りる

---

寿司屋の暖簾をくぐった瞬間、外国人観光客は知らない椅子の座り方、知らない湯呑みの持ち方、知らないネタ名、知らない金額の聞き方に同時に直面する。困ったら手元のスマホを開く。多くの人は ChatGPT を開く。そこで返ってくる答えが間違っていても、彼らはそれを検証する手段を持たない。

私は東京の寿司屋でおまかせを案内するモバイルアプリ (OmakaseMaster) を作っている。最初は「OpenAI API を裏で叩くチャットボットを置けばいい」と思っていた。実装を進めるうちに、その判断は浅かったと気づいた。本稿は、その気づきを抽象化した設計判断の話。

## 観察: ChatGPT が言う寿司マナー、板前さんに聞かせると何が起きるか

製作中に、近所の寿司屋 (江戸前) で軽く板前さんに話を聞かせてもらった。当時の GPT-4o に "Tell me the etiquette of eating omakase sushi at a high-end counter in Tokyo" と聞いた答えをそのまま朗読した。返ってきた指摘は次のようなものだった。

- **「ガリは口直し」** → ChatGPT は "palate cleanser between pieces" と書いてくる。板前さんいわく「ガリは個人の好みでいいが、口の中をリセットしたい時のためのもの。"between every piece" と書くと客が義務感で噛みまくる」
- **「ネタは指でつまむ」** → "Use your fingers, never chopsticks for nigiri." 板前さんいわく「店による。最近は箸の方が多い客もいる。"always" "never" の断定は危険」
- **「醤油はシャリにつけない」** → "Dip the fish side, never the rice side." これは概ね正しいが、ChatGPT は理由として「シャリが崩れるから」と説明する。板前さんいわく「半分は正解だが、半分は『シャリに味が入って素材が霞むから』。理由の順序が逆」

どれも「半分正しくて、半分微妙にズレている」。問題はここで、観光客がこれを **検証できる手段を持たない** という点にある。Yelp レビューを 10 件読んでも、ChatGPT が誤った理由を当てているか分からない。間違いがそのまま行動として現れ、本人は何も問題が起きていないと感じたまま店を出る。これが情報事故の最も静かな形だ。

## 仮説: high-stakes domain の定義

ここから抽象化する。LLM の出力を信じてユーザーが行動する領域のうち、次の 3 条件を満たすものを **high-stakes domain** と呼ぶことにする。

1. ユーザーがその領域の素人 (検証する knowledge base を持たない)
2. ドメインに正解 / 不正解の区別が存在する (純粋な意見ではない)
3. 間違った行動の cost が、正しい行動の reward より大きい

寿司マナーは 3 つすべてを満たす。料理レシピもそう。法律相談もそう。一方、「Netflix で今夜何を見るか」は (2) を満たさない (正解なし) し、「Spotify でどのプレイリストを再生するか」は (3) を満たさない (間違っても 30 秒で別の曲に切り替えられる)。

汎用 LLM を最終出力に置いて良いのは **non-high-stakes domain だけ**。これが私の中で線を引いた基準になった。

## 設計の三択

high-stakes と判定した時、選択肢は次の 3 つ。

### (A) RAG with curated KB

ドメイン専門家がレビュー済みの knowledge base を作って、LLM にはその上での要約と再生成だけさせる。寿司の場合だと、板前経験者の監修テキスト + 信頼できる料理研究家のテキストを embedding しておいて、retrieve した結果に対して LLM が回答する。

長所: 出力の精度が最も高い。出典トレースが可能。
短所: KB のメンテコストが高い。KB に書かれていない質問に弱い。

### (B) Domain-tuned system prompt + 出典明示

System prompt にドメイン固有の制約と「分からないことは『分かりません』と答えろ」を書き込み、出力には常に出典 / 根拠の明示を強制する。

長所: KB なしで動く。プロンプトの修正だけで挙動を変えられる。
短所: 結局 LLM の中の知識に頼るので、知識自体が間違っていたら救えない。

### (C) Rule-based fallback for high-confidence Q

頻出質問 (Top 50) は LLM ではなく決定論的な answer table で返す。残りだけ LLM に送る。

長所: 一番ヒットする質問の正解率が 100% に固定される。
短所: 想定外の質問への対応が雑になる。table のメンテが必要。

## 我々の選択: (B) + offline 前提

私の選択は (B) を主軸にしつつ、頻出 5 トピック (manners, neta names, ordering phrases, price expectations, etiquette warnings) は事前に rule-based answer として埋め込み、それらを 4 言語ぶん辞典化した。観光客はインバウンドで日本に来る前提なので、Wi-Fi が安定しない / 通信費を気にする / 機内で読み込みたい というケースを優先した。**ChatGPT が "あらゆる質問に答えてくれる" よりも、限定的でいいから "信頼できる answer の塊" がオフラインで読める方が、初心者には親切**だった。

アプリで採用した system prompt の guardrail は、概念的にはこういう構造になっている (実機の最新版はもう少し冗長で、リリースで微調整が入っている)。 OpenAI 公式の [prompt engineering guide](https://platform.openai.com/docs/guides/prompt-engineering) が推奨する「制約を明示」「逃げ道を与える」を素直に踏襲しただけのものだ。

```text
You are a sushi assistant for first-time omakase customers in Tokyo.
- Source-cite every claim. If you cannot cite, say "I'm not sure" instead of guessing.
- Avoid absolute words like "always" / "never" / "must" — sushi etiquette varies by shop.
- If the user asks about price, give a range, not a single number.
- If the question is outside sushi etiquette / vocabulary / ordering, say so.
```

ポイントは 4 行目の「価格はレンジで返せ」。これは ChatGPT が "average omakase price in Tokyo is 15,000 yen" のような単一値を返してしまい、観光客が予算をミス読むのを防ぐため。ドメイン固有の「失敗パターン」を guardrail に直接書き込むのが (B) パターンを採用するときのコツだった。

## 副産物: 出典明示 UI

LLM の出力に出典を強制すると、UI 側にも「出典をどう見せるか」の選択が要る。私の場合は次の優先順で書いた。

1. プライマリ: 「この情報は: 一般的な江戸前寿司の作法 / 監修: ...」のクレジット行を出力直下に固定
2. セカンダリ: ChatGPT 由来の生成テキストには「This is a general guideline; ask your chef directly when unsure.」を必ず末尾につける
3. 出典を出せない時: 「分かりません」と答え、別の質問に誘導する

3 つ目が重要。汎用 LLM は「分かりません」と答えるのが苦手で、ハルシネーションのリスクが最も高いのもこの瞬間だ。**system prompt で "I don't know" を許可するだけでは弱く、UI 側でも『分かりませんカード』を別 component として用意した**。これで観光客は「アプリが沈黙する瞬間」を視覚的に認識できる。

## まとめ

- LLM を high-stakes domain に置く時は、出力レイヤーを汎用モデルに任せない
- domain knowledge を持たない素人ユーザーは間違いを検証できない、という前提から逆算する
- 設計の三択 (RAG / domain-tuned prompt / rule-based fallback) はどれを選んでも良いが、選ばないまま GPT 直叩きで本番に出すのは事故が見えない
- 「分かりません」を答えとして許可する prompt と、それを表示する UI component を必ず用意する

寿司屋のカウンターは、知らない人にとっては緊張する場所だ。緊張している人が手元のスマホに頼った時、嘘を返さないアプリでありたい。それが OmakaseMaster の設計判断の中心にある。
