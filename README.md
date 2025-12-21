# modbus_simple_logger

Bun + React + TypeScript + Tailwind 製の WebUSB Modbus RTU ロガー SPA です。AI16ch / AO8ch 対応、38400bps デフォルトのポーリング設定、キャリブレーション保存・ダウンロード、ローカルフォルダへのストリーミング保存、散布ラインチャート表示を備えています。

## セットアップ

```bash
bun install
bun run dev
```

WebUSB と File System Access API を利用するため、対応ブラウザ（Chrome 系最新）で `bun run dev` を実行後に表示されるローカル URL を開いてください。

## 主な機能
- WebUSB で Modbus RTU デバイスに接続（既存ライブラリ `modbus-serial` の CRC を利用）
- AI（16ch）の定期ポーリング（200ms〜5分）と二次式キャリブレーション `ax²+bx+c`
- AO（8ch）の即時反映と一次式キャリブレーション `ax+b`
- キャリブレーション値を 1 年間 Cookie に保存、JSON ダウンロードボタン付き
- File System Access API によるローカルフォルダ選択と CSV 追記保存
- 最新値 60 秒（非取得時）/ 最大 1024 点（取得中）でのチャート表示、X/Y 軸を任意チャンネルに切り替え可能
