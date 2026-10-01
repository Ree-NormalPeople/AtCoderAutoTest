# AtCoder Online Test Runner (Chrome / Firefox)

AtCoderの問題ページで入力例をまとめて実行する拡張機能です。
書いたコードは自動で保存されるので、ページをリロードしても復元できます。

## できること

- AtCoder問題ページ（`https://atcoder.jp/contests/*/tasks/*`）で動作
- 入力例を取得して全て実行
- 実行エンジン（結果カードに `Engine: local / paiza` と表示）
  - JavaScript / Python 3は本体で高速に実行します。どちらもページ由来のBlob Web Worker内で動き、Pythonは同梱のPyodideを使います
  - C++ / Cはpaiza.IO Runner APIでオンライン実行します（フォールバック先も同じです）
  - 本体実行に失敗した場合は自動でpaiza.IOに切り替えます
- 判定は `AC / WA / TLE / RE / CE` と表示します
- 実行時間は小数点2桁で表示します
- 使用メモリを表示します
- 対応言語は次の4つです
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

その他のChrome、Firefoxベースのブラウザでも動くはずです。Floorpでは動作を確認しています。

---

## 使い方

1. AtCoderの問題ページを開く
2. 下部に表示される `AtCoder Online Test Runner` パネルにコードを貼る
3. 言語を選ぶ（初期値はcontent.jsのPREFERRED_LANGUAGEで変わります）
4. 必要なら「標準入力（自分で試す用）」に値を入れて「標準入力で実行」を押す
5. または「全テスト実行」を押す
6. ケースごとの結果を確認します（判定、実行エンジン、実行時間、使用メモリ、実際の出力、想定出力）

---

## 初期言語（普段使う言語）の設定

`content.js` の次の定数を変更してください。

```js
const PREFERRED_LANGUAGE = "python3";
```

設定できる値は次の4つです。

- `python3`（標準）
- `cpp`
- `c`
- `javascript`

保存済みの言語がない問題ページではこの値が初期選択されます。
保存済みの言語がある場合は、保存済みの言語が優先されます。

---

## 自動保存について

エディタへの入力、言語の変更、標準入力への入力のたびに、ブラウザの `localStorage` へ自動保存します。
保存キーは問題URL（`/contests/.../tasks/...`）単位で、問題ごとにキーが分かれています。

---

## 注意点

- インタラクティブ形式の問題には**対応していません**。そのような問題でテストを実行すると、`入力例が見つかりませんでした。` と表示されます。その他の特殊な問題にも対応していない場合があります。
- JavaScriptの本体実行では `fs.readFileSync(0, ...)` / `readline()` / `console.log` をシムで再現しています。`process.exit()` は入力終了として扱います。
- Pythonの本体実行は拡張機能に同梱のPyodide（`vendor/pyodide`）を使います。初回は読み込みに数秒かかります。TLE時はWorkerを作り直すため、直後のPython実行も再読み込みで数秒かかります。
- C++/Cと本体実行の失敗時はpaiza.IOの `guest` APIキーを使うため、混雑時は遅くなる場合があります。paiza.IOは2秒あたりの計算量がPythonでだいたい10^7回程度です。実行環境の差により、AtCoderでACのコードでもpaiza.IOではTLEになる場合があります。
- Firefoxの「一時的なアドオン」はブラウザ再起動で消えるので、再読み込みが必要です。
- C++/C（および本体実行のフォールバック時）はpaiza.IO APIで実行します。AtCoderの実行環境とは異なり、`gcc x86_64 (C++23)` と同じ環境は選べません。
- AtCoderとpaiza.IOではコンパイラやCPU環境が異なるため、AtCoderで通るコードでもpaiza.IO側で `CE` になる場合があります（`build stderr` に表示されます）。
- AtCoderの問題ページのHTML構造が変わると動作しなくなる場合があります。動かなくなった場合はissueを立てていただけると助かります。

---

## paiza言語仕様と免責事項

公開向けの詳細は以下を参照してください。

- `PAIZA_SPEC_AND_DISCLAIMER.md`

ライセンスについては以下を参照してください。

- `LICENSE`

issueやPRは歓迎です。
作成者は初心者なので、手加減していただけると大変助かります。
