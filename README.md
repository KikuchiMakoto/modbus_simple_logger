# ModbusSimpleLogger

Modbus RTU の計測・制御用 SPA / PWA。AI 16ch（HX711 × 8、ADS1115 × 8）を 100ms 周期で読み取り、AO 8ch（GP8403）を制御します。Plotly.js のチャート、AI キャリブレーション、TSV 保存、Python（Pyodide）による Script Runner を備えています。通信は Web Serial API、対応デバイスでは WebUSB CDC-ACM を使用します。

- [Web 版 / PWA](https://kikuchimakoto.github.io/modbus_simple_logger/)
- [Windows 向け単一 exe 版（Releases）](https://github.com/KikuchiMakoto/modbus_simple_logger/releases)：Edge または Chrome のインストールが必要です。ブラウザ本体は同梱しません。アプリのアセットは exe に同梱します。
- [リリースノート](RELEASE_NOTE.md)

## 動作環境

| 環境 | 最低バージョン | 接続・保存に必要な API |
| --- | --- | --- |
| デスクトップ Chrome / Edge | 89 以降 | [Web Serial](https://developer.mozilla.org/ja/docs/Web/API/Web_Serial_API)、[ファイルピッカー](https://developer.mozilla.org/ja/docs/Web/API/Window/showSaveFilePicker) |
| Android Chrome | 132 以降 | [WebUSB](https://developer.mozilla.org/ja/docs/Web/API/WebUSB_API)（CDC-ACM）、[ファイルピッカー](https://developer.mozilla.org/ja/docs/Web/API/Window/showSaveFilePicker) |

最新版を推奨します。Web 版は HTTPS 上で動作し、Script Runner は Service Worker による COOP/COEP 適用後のクロスオリジン分離と [SharedArrayBuffer](https://developer.mozilla.org/ja/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) が必要です。初回訪問時に使えない場合は Service Worker のインストール後に再読み込みしてください。Firefox / Safari は対象外です。Android は WebUSB 対応の CDC-ACM デバイスを使用します。

## 開発

Bun と上記ブラウザを使用します。

```bash
bun install
bun run dev             # 開発サーバー
bun run test            # 単体テスト
bun run build           # 型チェック + dist/ 生成
bun run launcher:build  # Windows では launcher/bin/modbus_simple_logger.exe を生成
```

React 19 / TypeScript 7 / Vite 8 / Tailwind CSS 4 / Plotly.js / Pyodide / Bun。Web 版は Service Worker でアセットをプリキャッシュし、オフラインでも動作します。計測中のデータはメモリ上のバッファで管理し、保存時は File System Access API 経由で TSV に書き出します。

## ライセンス

MIT License - [Makoto KUNO](https://github.com/KikuchiMakoto)
