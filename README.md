# ModbusSimpleLogger

ブラウザ上で動作する Modbus RTU ロガー（SPA / PWA）。Web Serial API でローカルの Modbus RTU デバイスに接続し、アナログ入力のリアルタイム計測・キャリブレーション・チャート表示・TSV 保存を行います。

🔌 **デモ**: https://kikuchimakoto.github.io/modbus_simple_logger/

---

## 主な機能

| 機能 | 説明 |
|------|------|
| **Modbus RTU 通信** | Web Serial API（`navigator.serial`）で接続。非対応環境は `web-serial-polyfill` 経由の WebUSB フォールバック |
| **AI 16ch 計測** | HX711 ×8 + ADS1115 ×8 の定期ポーリング（50ms〜5分間隔、既定 200ms）。Normal（i16）/ Extended（f32）の2精度モード |
| **AO 8ch 制御** | GP8403（Holding Register）への書き込み。ScriptRunner からの自動制御にも対応 |
| **キャリブレーション** | チャネルごとに `a·x² + b·x + c` を編集・保存（localStorage）・JSON 入出力。ワンタッチ Tare（0点補正）付き |
| **電圧表示モード** | HX711（mV/V, με）/ ADS1115（V, mV）を各チャネルで切り替え |
| **リアルタイムチャート** | Plotly.js による4画面表示。X/Y 軸を Time / Raw / Physical / Parameter（16ch）から選択。描画バックエンド（GPU/CPU）バッジ表示 |
| **データ保存** | File System Access API による TSV ストリーミング保存（Web Worker 書込み・全点記録）。IndexedDB でセッション中データを FIFO 管理 |
| **ScriptRunner** | Pyodide（Web Worker + SharedArrayBuffer）で Python 実行。`set_ao()` / `set_param()` / Tare を制御 |
| **MCP サーバー** | デスクトップ版限定。生成 AI クライアントから計測値の読み取り・AO 制御・Python 投入が可能（書込みは既定オフ） |
| **PWA** | Service Worker プリキャッシュで完全オフライン動作。COOP/COEP で SharedArrayBuffer を有効化。更新確認は起動直後と App Info の「Check for Updates」ボタンのみ（計測中に確認ウィンドウが割り込まない） |
| **その他** | Wake Lock による計測中のスリープ抑止、ダークモード、JetBrains Mono 同梱、アプリ内マニュアル |

---

## 技術スタック

React 19 / TypeScript 7 / Vite 8 / Tailwind CSS 4 / Plotly.js 3 / Pyodide 314（Python 3.14, セルフホスト）/ Bun

---

## クイックスタート

```bash
bun install
bun run dev      # 開発サーバー（http://localhost:5173）
bun run build    # dist/ へ出力
bun run preview  # ビルド成果物をプレビュー
```

必要環境: [Bun](https://bun.sh/) と Chromium 系最新ブラウザ（Chrome / Edge）。

---

## デスクトップ版（ランチャー exe）

Web 版（GitHub Pages / PWA）に加えて、**単一の実行ファイルで起動するデスクトップ版**を併存構成として用意しています。両者は同じアプリのビルド成果物（`dist/`）を共有しており、Web 版・PWA の挙動は一切変わりません。

ランチャー exe は Electron を使いません。インストール済みの **Microsoft Edge または Google Chrome** をアプリモード（`--app`）で起動し、exe 内部に埋め込んだアプリ一式（Pyodide を含む）を `127.0.0.1` のローカルサーバーから配信します。

**特徴**

- **完全オフライン動作** — Pyodide を含む全アセットを exe に同梱。外部ネットワークへは一切アクセスしません。
- **キャッシュ不使用** — ランチャーモードでは Service Worker を登録せず（過去に登録済みの SW があれば解除）、全レスポンスに `Cache-Control: no-store` を付与。ETag / Last-Modified も返しません。exe を再ビルドすれば、再起動時に必ず最新の内容が表示されます（陳腐化キャッシュ事故が原理的に起きません）。
- **クロスオリジン分離** — 配信サーバーが全レスポンスに COOP/COEP を付与するため、SharedArrayBuffer（Pyodide Worker）と ScriptRunner がそのまま動作します。
- **専用プロファイル** — ブラウザは専用の `--user-data-dir` で起動するため、通常のブラウザ設定・ディスクキャッシュと混ざりません。
- **MCP サーバー内蔵**（デスクトップ版限定） — 生成 AI クライアントから計測値の読み取りと制御が行えます（下記）。

> **注意（既知の制約）**: 表示に使う Chromium のバージョンは、インストール済みブラウザ（Edge / Chrome）側の更新に依存します。ランチャー exe 自体はブラウザを同梱しません。

**ビルド**

```bash
bun run launcher:dev     # コンパイルせず bun で直接起動（動作確認用）
bun run launcher:build   # 単一実行ファイルを launcher/bin/ に生成
```

Windows は `modbus_simple_logger.exe`（アイコン付き・コンソール非表示）、Linux は同名バイナリを生成します。VS Code では `Ctrl+Shift+B`（Launcher: build exe）でもビルド可。生成した exe は手動で Release に配布してください。

---

## MCP サーバー（デスクトップ版限定）

デスクトップ版は **MCP（Model Context Protocol）サーバー**を内蔵しており、Claude Code などの生成 AI クライアントから稼働中のロガーを観測・制御できます。Web 版（GitHub Pages / PWA）にはこの機能はありません（ブラウザサンドボックス内で完結するため外部プロセスからの接続口を持てません）。

**エンドポイント**: `http://127.0.0.1:8765/mcp`（Streamable HTTP、127.0.0.1 のみ待受）

```bash
claude mcp add --transport http modbus-logger http://127.0.0.1:8765/mcp
```

**ツール**

| 種別 | ツール |
|------|--------|
| 読取り（常時可） | `get_status` / `get_labels()` / `get_ai_raw(ch)` / `get_ai_phy(ch)` / `get_ao(ch)` / `get_param(ch)` / `read_recent(n)` / `get_script()` |
| 書込み（要許可） | `set_ao(ch, volt)` / `set_param(ch, value)` / `set_ai_tare(ch)` / `run_script(code)` / `stop_script()` |

`get_labels()` は各チャネルカードに入力した自由記述ラベルを `{ ai, ao, param }`（index = ch）で返します。チャネル番号だけでは分からない「何を測っているか」を AI 側が把握するためのもので、ScriptRunner の Python API には含みません（制御ループ内では不要なため）。

その他の API は ScriptRunner の Python API と同一面です。実装も共通で、MCP ツールは ScriptRunner と同じ共有メモリ・同じコールバックを経由します（`set_ao` は必ずアプリ側の送信経路を通るため、Modbus フレーム間隔などの制約はそのまま維持されます）。

**動作ルール**

- **書込みは既定で無効**。アプリのメニュー「MCP Access」で明示的に許可した場合のみ通ります。読取りは常時可能です。
- **ScriptRunner は1つだけ**。MCP から実行したスクリプトと画面から実行したスクリプトは同一の実行系・同一のエディタ内容を共有するため、二重実行は起こりません。実行中は反対側からの起動を拒否し、`get_script()` でいつでも内容と状態を確認できます。MCP から投入したコードは実行前に退避され、ScriptRunner パネルの「Restore」で復元できます。
- **直接書込みはスクリプト実行中は拒否**されます（制御ループと外部書込みの競合を防ぐため）。停止は `stop_script` で行えます。
- **多重起動は先勝ち**。2つ目以降のインスタンスはポートを取得できないため MCP 無効で通常起動します（アプリ自体は問題なく動作します）。
- 高速な制御ループは MCP の往復では回せません。`run_script` で Python をハードウェア側に投入してください。

---

> **メンテナンス上の注意**: `launcher/` は Tailwind v4 のコンテンツスキャン対象から除外するため `.gitignore` に登録しています（除外しないと launcher 内の文字列がアプリの CSS バンドルに混入し、Pages のビルド出力が変わってしまうため）。既存の `launcher/*.ts` はバージョン管理下にありますが、**新しいソースファイルを追加する際は `git add -f launcher/<file>` が必要**です。

---

## ブラウザ要件

Web Serial API / File System Access API / SharedArrayBuffer（COOP/COEP）/ Wake Lock を利用するため、**Chromium 系ブラウザが必須**です。Safari / Firefox は Web Serial 未対応のため動作しません。モバイルは Android + Chrome を推奨。

<details>
<summary>Linux でシリアルポート権限エラーが出る場合</summary>

`brltty` や `serial-getty` がポートを占有していることが原因です。以下を一括実行してください（再ログインで反映）。

```bash
sudo systemctl stop brltty-usb.service brltty.service serial-getty@ttyACM0.service serial-getty@ttyUSB0.service 2>/dev/null || true
sudo systemctl disable brltty-usb.service serial-getty@ttyACM0.service serial-getty@ttyUSB0.service 2>/dev/null || true
sudo usermod -aG dialout $USER
echo 'KERNEL=="ttyACM[0-9]*", GROUP="dialout", MODE="0660"
KERNEL=="ttyUSB[0-9]*", GROUP="dialout", MODE="0660"' | sudo tee /etc/udev/rules.d/99-usb-serial.rules >/dev/null
sudo udevadm control --reload-rules && sudo udevadm trigger
```

`ModemManager` を使っている場合は `sudo systemctl stop ModemManager.service` も実行してください。
</details>

---

## ハードウェア配線

**注意**: 色の割り当てはメーカーにより異なります。実際の配線はロードセル / 変位計のデータシートを必ず参照してください。

**HX711 ケーブル（一般的な慣例）**

| 色 | 機能 | NDIS |
|----|------|------|
| Red / 紅 | Excitation+ / E+ | A |
| Black / 黒 | Excitation− / E− | C |
| Green / 緑 | Signal+ / S+ | B |
| White / 白 | Signal− / S− | D |
| Yellow / 黄 | Shield | E |

参考: [昭和測器 — コネクタ種類と接続方法](https://www.showa-sokki.co.jp/technology/%E3%82%B3%E3%83%8D%E3%82%AF%E3%82%BF%E7%A8%AE%E9%A1%9E%E3%81%A8%E6%8E%A5%E7%B6%9A%E6%96%B9%E6%B3%95/)

**スクリューコネクタ（ADS1115 / GP8403）**: シルクの `G` がグランド。`A`〜`F` はチャンネル番号の16進表記（ADS1115 は 8〜15 = `8`〜`F`）。

---

## ライセンス

MIT License — [Makoto KUNO](https://github.com/KikuchiMakoto)
</content>
</invoke>
