---
title: "OGP 画像のコントラスト比を Pillow で出力前チェックし、WCAG 4.5:1 を割ったら生成を止める"
emoji: "🎨"
type: "tech"
topics: ["python", "pillow", "wcag", "ogp", "個人開発"]
published: false
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/wcag-contrast-gate-in-generated-images/

白背景に薄いグレーのタイトル文字を使った OGP 画像を生成したとき、Chrome の通常ビューでは問題なく見えていた。プレビューを確認してデプロイ。翌日、Twitter(X) で SNS カードのスクリーンショットが送られてきた。ダークモードで「タイトルが読めない」と。

`#FFFFFF` の白背景に本文カラーの `#AAAAAA` をそのままタイトル文字に流用していた。コントラスト比は 2.32:1。WCAG AA の最低ライン 4.5:1 の半分以下だった。これを防ぐには `save()` する前にコントラスト比を計算して弾くだけでいい。

## WCAG のコントラスト比を計算する

[WCAG 2.1 Success Criterion 1.4.3](https://www.w3.org/TR/WCAG21/#contrast-minimum) は前景色と背景色の輝度差をコントラスト比として定義している。計算は 2 ステップだ。

まず sRGB の各チャンネルを線形化して相対輝度を求める。

```python
def relative_luminance(r8: int, g8: int, b8: int) -> float:
    def linearize(c8: int) -> float:
        c = c8 / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * linearize(r8) + 0.7152 * linearize(g8) + 0.0722 * linearize(b8)
```

次に 2 色の輝度からコントラスト比を出す。

```python
def contrast_ratio(fg: tuple[int, int, int], bg: tuple[int, int, int]) -> float:
    l1 = relative_luminance(*fg[:3])
    l2 = relative_luminance(*bg[:3])
    lighter, darker = (l1, l2) if l1 >= l2 else (l2, l1)
    return (lighter + 0.05) / (darker + 0.05)
```

WCAG AA の合格ライン: 通常テキスト（18pt 未満）は **4.5:1**、大きいテキスト（18pt 以上）は **3:1**。OGP タイトルは 48〜96px なので「大きいテキスト」扱いだが、私は余裕を持たせて 4.5:1 を足切りにしている。

## Pillow で save() の前にゲートをかける

```python
from PIL import Image, ImageDraw, ImageFont

WCAG_AA_THRESHOLD = 4.5

def generate_og_image(title: str, output_path: str) -> None:
    BG_COLOR = (255, 255, 255)
    TEXT_COLOR = (30, 30, 30)

    ratio = contrast_ratio(TEXT_COLOR, BG_COLOR)
    if ratio < WCAG_AA_THRESHOLD:
        raise ValueError(f"コントラスト比 {ratio:.2f}:1 < {WCAG_AA_THRESHOLD}:1")

    img = Image.new("RGB", (1200, 630), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw.text((80, 200), title, fill=TEXT_COLOR, font=_load_font(size=64))
    img.save(output_path, "PNG")
```

`img.save()` の前に `raise` する設計が重要だ。後回しにすると、呼び出し元は「ファイルが保存された」と思ってループを続ける。壊れた OGP が量産される。先に弾く。

## フォント: macOS はヒラギノ 0 円、Linux は Noto CJK

```python
import os, sys

def _load_font(size: int) -> ImageFont.FreeTypeFont:
    if sys.platform == "darwin":
        # macOS: ヒラギノ角ゴシック W3 はシステム同梱。追加コスト 0 円
        candidates = [
            "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
            "/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
        ]
    else:
        # Ubuntu/GitHub Actions: sudo apt-get install -y fonts-noto-cjk
        # Vercel/Lambda: repo に bundle して __file__ 相対パスで参照
        candidates = [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            os.path.join(os.path.dirname(__file__), "fonts", "NotoSansJP-Regular.ttf"),
        ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size=size)
    raise FileNotFoundError(f"日本語フォントが見つかりません: {candidates}")
```

macOS ではヒラギノ角ゴシック W3 がシステム同梱なので追加コスト 0 円だ。GitHub Actions の Ubuntu runner は `sudo apt-get install -y fonts-noto-cjk` で入る。サーバーレス環境はフォントを repo に bundle する。Noto Sans JP は [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Sans+JP) から取得でき、SIL Open Font License なので再配布可能だ。

ここで 30 分溶かした。ローカルはヒラギノで動いているのに CI で `FileNotFoundError` が出た。候補リストを先に並べて `os.path.exists()` でフォールバックする書き方に直すまで原因がわからなかった。

## やらかした具体例

最初に作った OGP ジェネレーターはコントラストチェックなしで、カラーを環境変数から受け取っていた。`BG_COLOR=#E8F4FD`、`TEXT_COLOR=#7BB3CC` という設定が運用中に混入した。水色系で「おしゃれ」と思っていたが、コントラスト比は 2.1:1 だった。

気づいたのは Twitter(X) Analytics でインプレッションが落ちた週に画像を見直したとき。SNS カードのサムネにタイトル文字が溶けていた。2 週間気づかなかった。おしゃれという理由だけで色を決めてはいけない。

## まとめ

- WCAG の相対輝度式を Python に落とすだけで `contrast_ratio()` が作れる
- `img.save()` の前にチェックして `raise`。後回しは量産事故を招く
- macOS ではヒラギノが 0 円で使える。Linux は `fonts-noto-cjk`、サーバーレスはフォント bundle
- 足切りは AA 通常テキストの 4.5:1 にしておくと、リサイズ・圧縮後の余裕が生まれる

次回は「Pillow で長い日本語タイトルを OGP 画像に折り返す」を予定。

---

[SparMate](https://sparmate.cosoado-lab.com) — 格闘技の練習相手マッチング  
[NetaPair](https://netapair.cosoado-lab.com) — お笑いの相方探し  
[BoardLink](https://boardlink.cosoado-lab.com) — ボドゲ・TRPG 仲間募集  
[Cosoado Lab](https://cosoado-lab.com)
