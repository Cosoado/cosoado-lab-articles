---
title: "GitHub Secret をシェル履歴に残さず登録する gh CLI の正しい使い方"
tags: ["GitHub", "GitHubActions", "ShellScript", "セキュリティ", "CLI"]
published: true
qiita_id:
qiita_url:
---

> Cosoado Lab Blog 同時掲載予定: https://cosoado-lab.com/blog/gh-secret-set-stdin-no-history/

## TL;DR

```bash
# ① 対話入力（最もシンプル・TTY 環境向け）
gh secret set MY_SECRET
# → "Paste your secret:" とマスク入力プロンプトが出る

# ② stdin から流す（スクリプト・一括登録向け）
read -rs SECRET_VAL && printf '%s' "$SECRET_VAL" | gh secret set MY_SECRET
```

`--body VALUE` でシークレット値を直接渡すのは、シェル履歴にそのまま記録されるのでやめる。それだけが言いたい。

---

## やらかした話

Qiita 自動投稿の GitHub Actions を組んだとき、`QIITA_TOKEN` を登録しようとして反射的にこう打った。

```bash
gh secret set QIITA_TOKEN --body "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

Enter を押してから 3 秒後に「あ、履歴に残ったか」と気づいた。すぐ確認した。

```bash
cat ~/.zsh_history | grep QIITA_TOKEN
```

丸見えだった。値ごと。トークンは即失効させて Qiita で再発行したが、もしこれがクラウドの admin キーだったら、もしこのマシンが共有環境だったら、と思うと後味が悪かった。この失敗以来、シークレット登録のコマンドの打ち方を変えた。

---

## なぜ `--body VALUE` はシェル履歴に残るのか

シェルは（デフォルトで）実行したコマンド文字列をそのまま `~/.bash_history` や `~/.zsh_history` に書き込む。`--body` で渡したシークレット値はコマンドライン引数の一部なので、プログラムがどれだけ安全に扱っていても、**コマンドを実行した時点でシェルが履歴に記録してしまう**。

```text
# ~/.bash_history の中身の例
git push origin main
gh secret set QIITA_TOKEN --body "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"   ← 記録される
npm run dev
```

「`HISTCONTROL=ignorespace` を設定してコマンドの先頭にスペースを付ければ履歴を残せない」という回避策はある。ただし、これは事前にシェル設定がされている前提で、zsh では追加で `setopt HIST_IGNORE_SPACE` が必要になる。設定を確認し忘れたまま打ち込んだら意味がない。それよりも gh CLI 側の仕組みを使うほうが確実だ。

---

## 安全な登録方法

### 方法①：対話入力（普段使いならこれ一択）

```bash
gh secret set QIITA_TOKEN
```

`--body` を渡さないと、gh CLI は TTY を検出して "Paste your secret:" というマスク入力プロンプトを出す。入力文字は画面に表示されず、コマンドライン引数にもシークレット値が含まれないため、履歴には `gh secret set QIITA_TOKEN` という形式のみ残る。

手動で数個を登録するだけなら、これが最速で最も安全。

### 方法②：stdin から流す（スクリプト向け）

```bash
read -rs SECRET_VAL && printf '%s' "$SECRET_VAL" | gh secret set QIITA_TOKEN
```

`read` の `-s` フラグが入力をエコーバックしない（画面に出ない）フラグ。`-r` はバックスラッシュをエスケープとして扱わない指定。`read` 自体はコマンドとして履歴に残るが、入力した値はコマンドライン上に現れないので history にも記録されない。

`printf '%s'` を使うのは末尾改行を付けないため。`echo "$SECRET_VAL"` は末尾に `\n` を付けるが、`printf '%s'` は付けない。gh CLI はトリムしてくれるが、明示的に余計なバイトを送らないほうが意図が明確だ。

stdin を渡す側の gh CLI の動作は、[実際のソースコード](https://github.com/cli/cli/blob/trunk/pkg/cmd/secret/set/set.go) を確認した。`--body` が未指定かつ TTY でない場合（パイプされた場合）は `io.ReadAll(opts.IO.In)` で stdin を読む実装になっている。trailing CR/LF は自動でトリムされる。

### 方法③：ファイルから読む（複数シークレットの一括登録向け）

一時ファイルを作ってパイプする方法もある。

```bash
gh secret set QIITA_TOKEN < ./qiita_token.txt
```

ただし、ファイル自体が漏れたら本末転倒なので運用上の注意が必要だ。`.gitignore` に含めることと、`chmod 600 ./qiita_token.txt` で権限を絞ること、登録後は `shred -u ./qiita_token.txt` で確実に削除することがセットで必要になる。手間を考えると、数個のシークレット登録なら方法①のほうが現実的だ。

---

## 落とし穴：`--body -` はシークレットに `-` を設定する

これが一番やってしまいがちな勘違いだと思う。多くの CLI ツールでは `--flag -` と書くと "stdin から読む" という意味になる。`gh secret set` でも同様に動くと思って次のように打つと、**シークレットの値がリテラルの `"-"` になる**。

```bash
# NG: ハイフンそのものがシークレット値として登録される
echo "mytoken" | gh secret set MY_SECRET --body -
```

gh CLI の `--body` フラグは stdin を特別扱いしていない。ソースコードを確認すると、`opts.Body` が空でない場合はそのまま返すだけで、`"-"` に対する特別な分岐は存在しない（[参照](https://github.com/cli/cli/blob/trunk/pkg/cmd/secret/set/set.go)）。

stdin から渡したい場合は `--body` を書かない。

```bash
# OK: --body を省略すると stdin fallback が効く
echo "mytoken" | gh secret set MY_SECRET
```

---

## リポジトリを明示する `-R` オプション

```bash
# 特定リポジトリへ明示的に登録
gh secret set QIITA_TOKEN -R Cosoado/cosoado-lab-articles

# Organization レベルへ登録
gh secret set QIITA_TOKEN --org Cosoado --visibility all
```

カレントディレクトリが目的のリポジトリ配下でないと、別のリポジトリに登録される。リポジトリを移動して作業するのが面倒なときは `-R` で明示するほうが確実だ。

---

## まとめ

- `--body VALUE` でシークレット値を渡すと、コマンドライン引数としてシェル履歴に記録される
- TTY 環境では `gh secret set SECRET_NAME`（引数なし）でマスク入力プロンプトが使える
- スクリプトや パイプしたい場合は `--body` を省略すると stdin fallback が効く
- `--body -` は stdin ではなくリテラルの `"-"` が値になる（罠）

この手の地味な習慣の違いが、ある日突然「履歴を全文検索されたとき」に効いてくる。

---

Cosoado Lab では個人開発のプロダクトを運営しながら、こういう小さな発見を記事にしています。

- **SparMate** — [https://sparmate.cosoado-lab.com](https://sparmate.cosoado-lab.com)
- **NetaPair** — [https://netapair.cosoado-lab.com](https://netapair.cosoado-lab.com)
- **BoardLink** — [https://boardlink.cosoado-lab.com](https://boardlink.cosoado-lab.com)
- **Cosoado Lab** — [https://cosoado-lab.com](https://cosoado-lab.com)
