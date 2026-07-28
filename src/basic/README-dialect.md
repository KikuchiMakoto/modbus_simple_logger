# BASIC 方言リファレンス

Modbus Simple Logger の ScriptRunner が実行する BASIC の仕様。**VB6 準拠**を基本に、
N88-BASIC / QBasic / VBA から来た人がそのまま書けるよう受理範囲を広げてある。

実装は 5 ファイル: [lexer.ts](lexer.ts) → [parser.ts](parser.ts)（フラット命令列へ）→
[interpreter.ts](interpreter.ts)（ステップ実行）、値の意味論は [values.ts](values.ts)、
関数表は [builtins.ts](builtins.ts)。ワーカ側は [../basicWorker.ts](../basicWorker.ts)。

---

## 1. 書き方の基本

| 事項 | 仕様 |
|---|---|
| 大文字小文字 | 区別しない。`Print` `PRINT` `print` は同じ |
| 型宣言文字 | `A$` `N%` `X!` `D#` `L&` `C@` は**受理して無視**（`A$` と `A` は同一変数） |
| コメント | `'` と `REM`。行末まで |
| 行継続 | 行末の `_` |
| 文の区切り | 改行、または `:` |
| 行番号 | 先頭の整数はラベルとして受理（`GOTO 100` が効く）。付けなくてよい |
| ラベル | `Retry:` の形式 |
| 文字列 | `"..."`。中の `"` は `""` と重ねる |
| 数値 | `1` `1.5` `.5` `1E-3` `1.5D6`（`D` は倍精度指数の旧綴り） |

変数宣言は不要（VB6 の `Option Explicit` なしの状態）。未代入の変数は **Empty** で、
数値文脈で `0`、文字列文脈で `""` になる。`Msg = Msg & "text"` が `"0text"` から
始まらないのはこのため。

---

## 2. 文

```
変数 = 式                      Let 変数 = 式
Const 名前 = 式 [, ...]        ' 再代入は構文エラー
Dim 名前[(上限[, 上限...])] [As 型]   ' As 句は受理して無視。下限は常に 0

If 条件 Then 文 [Else 文]      ' 単行形。Then の後の数値は GOTO 扱い
If 条件 Then                   ' ブロック形
  ...
ElseIf 条件 Then
  ...
Else
  ...
End If

For i = 開始 To 終了 [Step 増分]     ... Next [i]
While 条件 ... Wend
Do [While 条件 | Until 条件] ... Loop [While 条件 | Until 条件]   ' 4 形すべて
Exit For / Exit Do

Select Case 式
  Case 値[, 値...]
  Case Else
End Select

GoTo ラベル                    GoSub ラベル ... Return
Print [式][; | ,] ...
Sleep 秒                       ' 小数可。Sleep 0.1 は 100 ms
End / Stop
```

`For` の終了値と `Step` は**入口で一度だけ**評価される（VB6 と同じ）。
`For i = 1 To GetAiPhy(0)` が毎周計器を読み直したりはしない。

### Print

数値は VB6/QBasic と同じく**符号位置の空白 + 値 + 列区切りの空白**で出る。
文字列は素のまま。この違いは意図的で、3 種類の数値→文字列変換を作り分けている:

| 変換 | `Print 5` 相当の結果 |
|---|---|
| `&` / `CStr(5)` | `5` |
| `Str$(5)` | `_5`（先頭に空白） |
| `Print 5` | `_5_`（前後に空白） |

- `;` … 詰めて続ける。**行末に置くと改行しない**（次の `Print` が同じ行に続く）
- `,` … 次の 14 桁ゾーンへ送る

### 演算子（結合の緩い順）

```
Or  Xor
And
Not
=  <>  <  >  <=  >=
&                       ' 文字列連結
+  -
*  /  \  Mod
^                       ' 右結合。2^3^2 は 2^(3^2)
- +                     ' 単項
```

VB6 の意味論をそのまま持っている。ここは「簡略化した BASIC」との差が出るところ:

- **真は `-1`、偽は `0`。** `And` `Or` `Xor` `Not` は**ビット演算**。
  `Not -1` が `0` になるので論理演算としても正しく働き、`5 And 3` は `1`。
- `+` は**両辺とも文字列のときだけ**連結。曖昧さのない綴りは `&`。
- `\`（整数除算）と `Mod` は**整数演算**。`7.5 Mod 2` は `1`（`1.5` ではない）。
- `/` の 0 除算は実行時エラー。

---

## 3. 組込関数

`(EXT)` は VB6 に無い追加。追加した理由も併記する。

### 数学

| 関数 | 内容 |
|---|---|
| `Abs Sgn Sqr Exp Log` | `Log` は自然対数。`Sqr(-1)` と `Log(0)` はエラー（NaN を列に流さないため） |
| `Sin Cos Tan Atn` | 引数・戻りはラジアン |
| `Int Fix` | `Int` は床（`Int(-2.5)` = `-3`）、`Fix` は 0 方向切捨（`-2`） |
| `Round(x[, 桁])` | **偶数丸め**。VB6 の規則であり、JIS Z 8401 規則 A と同じ |
| `Rnd[(x)]` `Randomize [種]` | 種を与えれば再現する。`Rnd(0)` は直前値、`Rnd(負)` は再種 |
| `Log10(x)` (EXT) | 圧密の e-logP、粒径加積曲線がすべて常用対数のため |
| `Asin(x) Acos(x)` (EXT) | Mohr-Coulomb の `sinφ = (σ1-σ3)/(σ1+σ3)` を直接書けるように |
| `Deg(rad) Rad(deg)` (EXT) | 三角関数はラジアン、試験報告書は度 |
| `Min(a, b, ...) Max(a, b, ...)` (EXT) | 出力のクランプ用。`Min(10, Max(0, v))` |
| `Pi` (EXT) | 括弧なしで書ける |

### 変換・判定

`CInt CLng`（偶数丸め）`CDbl CSng CStr CBool` `IIf(条件, 真, 偽)`
`Val(s)`（先頭の数値部分。失敗しても 0）`IsNumeric(x)` (EXT)

### 文字列

`Len Left Right Mid InStr Trim LTrim RTrim UCase LCase Space String Str Chr Asc Hex Oct`
`Replace(s, 探す, 置く)` `StrReverse(s)`
`Format(値, "0.00")` — 数値パターンのみ（`0` `#` `.` `,`）。日付・名前付き書式は未実装で、
解釈できないパターンはエラーにせず `CStr` に落ちる。

位置はすべて **1 起点**（`Mid("abcdef", 3, 2)` = `"cd"`）。

### 時刻

| 関数 | 内容 |
|---|---|
| `Timer` | 現地深夜からの秒（小数付き）。**VB6 どおり深夜 0 時で巻き戻る** |
| `Elapsed` (EXT) | **スクリプト開始からの単調増加秒。**巻き戻らない |
| `Time$` | `HH:MM:SS` |
| `Date$` | `YYYY/MM/DD`（VB6 のロケール依存表記に対する意図的な変更。ソートできるため） |

> **経過時間は `Elapsed` を使うこと。** 圧密試験の 1 段階は 24 時間を超えるので、
> `Timer - t0` は途中で負に転じる。

---

## 4. 計測 API

Python 側（`get_ai_phy` など）と同じ機能を同じ名前で持つ。**アンダースコアは無視される**ので
`GET_AI_PHY` `GetAiPhy` `getaiphy` はすべて同じものを指す。

| 呼び方 | 内容 |
|---|---|
| `GetAiRaw(ch)` | AI の生カウント |
| `GetAiPhy(ch)` | AI の物理値（校正適用後） |
| `GetAo(ch)` | AO の現在値（V） |
| `GetParam(ch)` | Parameter の値 |
| `SetAo ch, v` | AO を書く（V） |
| `SetParam ch, v` | Parameter を書く |
| `SetAiTare ch` | その CH の現在値が 0 になるようオフセットを調整 |
| `SetNotify メッセージ` | 通知を出す（ログには必ず残る） |

読み出しは共有メモリからの同期読み取り。**書き込みは非同期**で、Modbus の転送ミューテックスと
フレーム間隔がメインスレッド側にあるため経由している。したがって `SetAo` の直後の `GetAo` は
まだ前の値を返す（Python の `set_ao` と同じ挙動）。

---

## 5. 停止と待ち

`Stop` はいつでも効く。インタプリタがフラットな命令配列上のプログラムカウンタなので、
**出口のない `Do ... Loop` でも数 ms ごとに制御が戻る**。スクリプト側の配慮は要らない。

`Sleep` の単位は**秒**（QBasic 準拠）。`Sleep 0.1` が 100 ms。

> VBA の `Sleep` は Win32 API でミリ秒を取るため、`Sleep 1000` と書くと
> **16.7 分**待つことになる。100 秒以上の `Sleep` には 1 回だけ注意書きを出すが、
> エラーにはしない（試験によっては 1 時間待つのが正しいため）。

---

## 6. 現時点で無いもの

- **`Sub` / `Function` によるユーザー定義手続き。** 分岐は `GoSub` / `Return` で書く。
- `Option Explicit`、ユーザー定義型、オブジェクト、`On Error`、ファイル入出力、`Input`。
- `Split` / `Join`（配列が値として扱えないため）。
- `Format` の日付・名前付き書式。
