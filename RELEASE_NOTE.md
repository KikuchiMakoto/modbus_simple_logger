# Release Notes

リリース済みバージョンの詳細は [GitHub Releases](https://github.com/KikuchiMakoto/modbus_simple_logger/releases) を参照してください。

## 未リリース

- 非保存時の計測バッファを IndexedDB からメモリ上の TypedArray に変更。セッション中のプレビューを保持し、永続化は TSV 保存時に行います。

## v7.2.8

- チャートの欠測区間をまたぐ誤接続を修正し、WebGL コンテキストの解放を改善。
- Modbus の読取りバイト数・書込み応答の検証と WebUSB ストリームのエラー処理を強化。
- チャート描画、UI、TSV 整形など計測中の処理負荷を削減。
