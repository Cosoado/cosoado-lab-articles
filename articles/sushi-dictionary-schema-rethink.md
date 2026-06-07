---
title: "寿司用語辞典を作ったら、世の中の辞書アプリの schema が全部腐って見えてきた"
emoji: "🍣"
type: "tech"
topics: ["設計", "個人開発", "schema", "i18n", "辞書"]
published: true
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/sushi-dictionary-schema-rethink/

辞書アプリの schema を真面目に書いたことがあるだろうか。Google 翻訳の中身を覗いたことがある人は少ないと思う。私もなかった。寿司用語辞典を作ろうとした 2 週目に、「これは辞書じゃない、文化のスキーマだ」と気づいた話を残しておく。

## 出発点: ふつうの辞書 schema

外国人観光客向けのモバイルアプリ (OmakaseMaster) を作っていて、寿司のネタ事典を組み込もうとした。まず雑に書いたのがこれだった。

```ts
type SushiTerm = {
  romaji: string;       // "otoro"
  kana: string;         // "おとろ"
  kanji?: string;       // "大トロ"
  translation: {
    en: string;         // "fatty tuna belly (premium cut)"
    zh: string;
    ko: string;
  };
  example?: string;     // "Can I have otoro, please?"
};
```

これで `otoro`, `chutoro`, `akami`, `uni`, `ikura` あたりまで埋めた。一見成立して見える。けれど 30 語あたりで詰まった。`anago` を書こうとして、いきなり何個も決断を迫られた。

- アナゴは「煮アナゴ」と「ツメつき」では客の頼み方が違う。同じ単語?
- ツメ (詰め) は調味料の名前であり、調理ステップの名前でもある。 別エントリ?
- "uni" は北海道産か bafun か murasaki かで全く別物。 翻訳には書けない。
- 季節 (旬) を書きたいが、`example` に押し込むと汚い。

「単語 → 翻訳」の構造そのものが寿司に向いていなかった。

## 観察: 辞書アプリは「言語間 1 対 1 対応」を前提にしすぎている

世の中の辞書アプリの schema を 5 個くらい眺めて気づいたのは、ほぼ全部が「source word ↔ target translation」の 1 軸モデルだということ。例文がついていても、それは「単語の使い方の例」であって「単語の世界観」ではない。

寿司用語の不幸は、ほとんどの単語が **単語じゃなくて文化単位** であることだ。

- `gari` は「生姜の甘酢漬け」の翻訳だけでは足りない。「いつ食べるか」「どれくらい食べるか」「板前に頼むものか自分で取るものか」が一緒についてこないと、観光客が間違える
- `agari` は「お茶」のカウンター用語だが、`お茶ください` と `あがり下さい` を客が言うのはマナー違反 (店員側用語)
- `murasaki` は「醤油」だが、`shoyu` と書いてもいい。 店による

「翻訳」じゃなくて「**この単語を見たとき / 使うとき、観光客はどう振る舞うべきか**」を返さないと、辞書として機能しない。

## 結論: dictionary は文化スキーマの一部にすぎない

書き直した schema はこうなった。

```ts
type SushiTerm = {
  id: string;                       // canonical id (e.g. "otoro")
  forms: {
    romaji: string;
    kana: string;
    kanji?: string;
    chef_term?: string;             // 板前側で使う別呼び (例: "agari")
    customer_safe: boolean;         // 客が口にしてよい単語か
  };
  meaning: {
    short: Record<Locale, string>;  // 簡潔翻訳
    long: Record<Locale, string>;   // 文化的注記つきの説明
  };
  context: {
    when_to_use?: "ordering" | "during_meal" | "paying" | "never";
    season?: Array<"spring" | "summer" | "fall" | "winter">;
    typical_cuts?: string[];        // ネタの場合 (例: "akami", "chutoro", "otoro")
    common_misuse?: Record<Locale, string>;  // 観光客が陥る誤用
  };
  etiquette?: {
    warning?: Record<Locale, string>;
    do?: Record<Locale, string>;
    dont?: Record<Locale, string>;
  };
  related_terms?: string[];         // related ids
};
```

ポイントを 4 つ書き残しておく。

### 1. `customer_safe` boolean

`agari` `murasaki` のような板前内用語を、客が口にすると「通ぶってる」「板前気取り」に見える。これを単語ごとに boolean で持たせる。翻訳側 UI では `customer_safe: false` の語を出すとき、必ず「客の言葉は ◯◯ です」を併記する。

### 2. `when_to_use` discriminator

`gochisousama deshita` を入店時に言うとボタンの掛け違いが起きる。`when_to_use: "paying" | "during_meal"` を持たせて、UI 側で時間帯フィルタを切れるようにした。1 つの単語が複数の context を持つ場合は配列にする。

### 3. `common_misuse` を別 field に出す

これが i18n の話と直結する。`omakase` の英語訳は "chef's choice" だが、海外フォーラム (Reddit / Quora 等) では `omakase = all-you-can-eat` と勘違いされている事例が頻発する。辞書アプリにとって「**翻訳の正しさ**」だけ書くのは不十分で、「**誤訳の流通実態**」を持っておかないと観光客は失敗する。

```ts
common_misuse: {
  en: "Often mistaken as 'all-you-can-eat' on travel forums. omakase = chef's selection, not a buffet."
}
```

ふつうの辞書 schema にはない field だが、これがアプリの差別化要因になった。

### 4. `etiquette` を翻訳の中に埋め込まない

最初は etiquette の文章を `meaning.long` に押し込んでいた。これは保守の悪夢になる。etiquette は「単語の意味」とは独立した dimension で変化する (店が変われば作法が変わる、 季節が変われば warning が変わる)。 独立した field にすると、後から「shop tier 別の etiquette」「人数別の etiquette」のような切り口で並列展開できる。

## i18n を辞書 schema にぶつけてみる

Zenn 読者ならピンと来るかもしれないが、[`Record<K, V>`](https://www.typescriptlang.org/docs/handbook/utility-types.html#recordkeys-type) のような i18n 表現を辞書 schema に直接ぶら下げると、文字列の所有権がぐちゃつく。

具体的には、`meaning.short.en` と `etiquette.warning.en` は 「英語」という同じカテゴリに属するが、片方は **辞書編集者の翻訳**、片方は **文化監修者の警告**、ライターが別人だ。schema に独立 field を切ってあるおかげで、後から「警告だけ別の人が監修できる」状態が保てている。

i18n を持ち込むときは「言語を分離する」だけでなく「**著者を分離する**」観点も持っておくと、レビューフローが綺麗になる。

## おまけ: 辞書アプリで「翻訳」の語を使わない

副産物だが、UI 側で「Translate」「翻訳」というラベルを排した。代わりに使ったのが「Decode (解読)」と「Speak (発話)」。

- Decode mode: 客が聞いた単語を「何を意味するか / どう振る舞えばいいか」で返す
- Speak mode: 客が言いたいことを「何と言えばいいか / 失礼にならないか」で返す

「翻訳」だと方向が見えなくて、ユーザーがどっちボタンを押せばいいか迷う。Decode/Speak は方向が動詞に込もるので迷わない。schema は同じデータでも、UI が違うことで使い方が変わる例として記録しておく。

## まとめ

- 「単語 → 翻訳」schema は、単語が文化単位の領域では破綻する
- 寿司のような high-context な domain の辞書には「context」「misuse」「etiquette」を独立 field で持たせる
- i18n は「言語の分離」と「著者の分離」の 2 軸で考えると保守が楽になる
- 辞書アプリの「翻訳」ラベルは方向を曖昧にする。動詞 (Decode / Speak) に書き換えると UX が安定する

辞書を作る予定がない人にも、`Record<Locale, string>` をネストする schema を組む時の参考になれば嬉しい。世界は単語より複雑だ、というだけの話なんだけど、実装している間にそれを忘れる。
