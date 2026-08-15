# AtCoder Online Test Runner (Chrome / Firefox)

AtCoderの問題ページで、入力例をまとめて実行できる拡張機能です。  
コードは自動保存されるので、ページをリロードしても復元できます。

## できること

- AtCoder問題ページ（`https://atcoder.jp/contests/*/tasks/*`）で動作
- 入力例を取得して全て実行
- paiza.IO Runner APIでオンライン実行
- 判定表示: `AC / WA / TLE / RE / CE`
- 実行時間表示（小数点2桁）
- 使用メモリ表示
- 対応言語:
  - Python 3
  - C++
  - C
  - JavaScript
- エディタ左に行番号表示
- 自分で試せる標準入力欄（単体実行ボタン付き）
- 自動保存（localStorage）
  - 問題URLごとに、コード・言語・標準入力を保存
- `content.js` で普段使う言語（初期言語）を設定可能

---

## インストール方法


### Chrome

1. `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」
4. このフォルダを選択

### Firefox

1. `about:debugging#/runtime/this-firefox` を開く
2. 「一時的なアドオンを読み込む」
3. このフォルダの `manifest.json` を選択

---

## 使い方

1. AtCoderの問題ページを開く
2. 下部に表示される `AtCoder Online Test Runner` パネルにコードを貼る
3. 言語を選ぶ(content.jsのPREFERRED_LANGUAGEによって初期値が変化します)
4. 必要なら「標準入力（自分で試す用）」に値を入れて「標準入力で実行」を押す
5. または「全テスト実行」を押す
6. ケースごとの結果（判定、実行時間、使用メモリ、実際の出力、想定出力）を確認

---

## 初期言語（普段使う言語）の設定

`content.js` の次の定数を変更してください。

```js
const PREFERRED_LANGUAGE = "python3";
```

設定可能な値:

- `python3`（標準）
- `cpp`
- `c`
- `javascript`

この値は、**その問題ページで保存済みの言語がないとき**に初期選択されます。  
（保存済み言語がある場合は、保存済みが優先されます）

---

## 自動保存について

- エディタ入力時・言語変更時・標準入力入力時に自動保存されます
- 保存先はブラウザの `localStorage` です
- 保存キーは「問題URL（`/contests/.../tasks/...`）」単位なので、問題ごとに別管理されます

---

## 注意点

- paiza.IOの `guest` APIキーを使っているため、混雑時は遅くなることがあります
- Firefoxの「一時的なアドオン」はブラウザ再起動で消えるので、再読み込みが必要です
- この拡張は paiza.IO API を使って実行します。AtCoder の実行環境とは異なり、`gcc x86_64 (C++23)` と同等環境は選べません
- AtCoderとpaiza.IOではコンパイラ/CPU環境が異なるため、AtCoderで通るコードでもpaiza.IO側で `CE` になることがあります（`build stderr` に表示されます）

---

## paiza言語仕様と免責事項

公開向けの詳細は以下を参照してください。

- `PAIZA_SPEC_AND_DISCLAIMER.md`

ライセンスについては以下を参照してください
-`LISENCE`


issueやPRは歓迎です。
作成者は初心者なので、手加減していただけると大変助かります。
