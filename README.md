# ModbusSimpleLogger

ブラウザ上で動作する Modbus RTU ロガー（SPA / PWA）。Web Serial API でローカルの Modbus RTU デバイスに接続し、アナログ入力のリアルタイム計測・キャリブレーション・チャート表示・TSV 保存を行います。

🔌 **デモ**: https://kikuchimakoto.github.io/modbus_simple_logger/

---

## 主な機能

| 機能 | 説明 |
|------|------|
| **Modbus RTU 通信** | Web Serial API（`navigator.serial`）で接続。非対応環境は `web-serial-polyfill` 経由の WebUSB フォールバック |
| **AI 16ch 計測** | HX711 ×8 + ADS1115 ×8 の定期ポーリング。**Polling Rate**（25ms / 50ms / 100ms、既定 100ms、接続中は固定）と **Save Rate**（200ms〜30分、既定 1s、いつでも変更可）は独立 — 保存を遅くしてもフィードバック制御は速いまま回る。チャートは常に 100ms 固定。Normal（i16）/ Extended（f32）の2精度モードと、接続時に一度だけデバイスへ問い合わせて選ぶ **Auto**（既定） |
| **AO 8ch 制御** | GP8403（Holding Register）への書き込み。PyScriptRunner からの自動制御にも対応 |
| **キャリブレーション** | チャネルごとに `a·x² + b·x + c` を編集・保存（localStorage）・JSON 入出力。ワンタッチ Tare（0点補正）付き |
| **電圧表示モード** | HX711（mV/V, με）/ ADS1115（V, mV）を各チャネルで切り替え |
| **リアルタイムチャート** | Plotly.js による4画面表示。X/Y 軸を Time / Raw / Physical / Parameter（16ch）から選択。非保存時は直近 768 点（≒77秒）のプレビュー、保存中は保存開始〜現在の全区間を 2048 点へ間引いて表示。描画バックエンド（GPU/CPU）バッジ表示 |
| **データ保存** | File System Access API による TSV ストリーミング保存（Web Worker 書込み）。書き込み周期は Save Rate に従います。IndexedDB でセッション中データを FIFO 管理 |
| **クラッシュ復旧** | 保存中の全行を OPFS へ同期ミラーします（ピッカーで選んだファイルは Stop Save まで 0 バイトのため）。異常終了後の初回起動で復旧を提示し、`<元の名前>_recovered.tsv` としてダウンロードします。提示を Cancel すると復旧コピーは削除されます |
| **PyScriptRunner** | Pyodide（Web Worker + SharedArrayBuffer）で Python 実行。`set_ao()` / `set_param()` / Tare を制御、`set_notify()` で通知 |
| **バックグラウンド耐性** | ポーリング・チャート反映・TSV フラッシュのタイマーを専用 Worker で駆動。ウィンドウを最小化してもブラウザのタイマー抑制（1Hz→1分に1回）で計測が止まりません。デスクトップ版はブラウザ起動フラグでも抑制を無効化 |
| **通知** | PyScriptRunner の開始・停止・完了・エラーと `set_notify(msg)` を OS 通知で表示（Application Info でオン/オフ） |
| **UI 拡大率** | 画面全体を 50〜200%（11 段）で拡大・縮小し、その端末に記憶します（Menu ヘッダーの `[-] [100%] [+]`。ダーク/ライト切替も同じ場所）。ブラウザのズームが使えない・保持されない環境（Android のインストール済み PWA など）向け |
| **MCP サーバー** | デスクトップ版限定。生成 AI クライアントから計測値の読み取り・AO 制御・Python 投入が可能（書込みは既定オフ） |
| **リモート監視** | デスクトップ版限定。他 PC やスマホのブラウザから、チャートとチャネル値を**閲覧のみ**できます（LAN 直接 / インターネット経由・QR 表示・既定オフ） |
| **PWA** | Service Worker プリキャッシュで完全オフライン動作。COOP/COEP で SharedArrayBuffer を有効化。更新確認は起動直後と Application Info の「Check for Updates」ボタンのみで、デバイス接続中は停止（計測中に確認ウィンドウが割り込まない） |
| **その他** | Wake Lock による計測中のスリープ抑止（デスクトップ版は OS の電源管理へ直接要求するため最小化中も有効）、多重起動抑制（デスクトップ版）、ダークモード、Iosevka 同梱、アプリ内のコネクタ配線マニュアル（Connector Manual） |

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
- **クロスオリジン分離** — 配信サーバーが全レスポンスに COOP/COEP を付与するため、SharedArrayBuffer（Pyodide Worker）と PyScriptRunner がそのまま動作します。
- **専用プロファイル** — ブラウザは専用の `--user-data-dir` で起動するため、通常のブラウザ設定・ディスクキャッシュと混ざりません。
- **MCP サーバー内蔵**（デスクトップ版限定） — 生成 AI クライアントから計測値の読み取りと制御が行えます（下記）。
- **リモート監視**（デスクトップ版限定） — 他 PC のブラウザから計測画面を閲覧できます（下記）。
- **多重起動抑制** — 2つ目の exe は「既に起動しています」と表示して終了します（1本のシリアルポートに対してウィンドウが2枚開く事故を防ぐため）。ロックはループバックポートの bind なので、クラッシュや強制終了でロックが残ることはありません。
- **スリープ抑制** — 計測中・スクリプト実行中は OS の電源管理へ直接要求（`SetThreadExecutionState`）してスリープとディスプレイ off を止めます。ページ側の Wake Lock は「表示中」しか効かないため、**最小化した状態の長時間計測はデスクトップ版が確実**です。要求はページが出すので、アプリを開いているだけの状態では抑制しません。
- **タイマー抑制の無効化** — ブラウザをバックグラウンドタイマー抑制オフのフラグ付きで起動します。Web 版は専用 Worker でタイマーを駆動して同じ問題に対処しています。

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
| 読取り（常時可） | `get_status` / `get_labels()` / `get_ai_raw(ch)` / `get_ai_phy(ch)` / `get_ao(ch)` / `get_param(ch)` / `read_recent(n)` / `get_script()` / `get_script_log(n)` |
| 書込み（要許可） | `set_ao(ch, volt)` / `set_param(ch, value)` / `set_ai_tare(ch)` / `run_script(code, wait_ms)` / `stop_script()` |

`get_labels()` は各チャネルカードに入力した自由記述ラベルを `{ ai, ao, param }`（index = ch）で返します。チャネル番号だけでは分からない「何を測っているか」を AI 側が把握するためのもので、PyScriptRunner の Python API には含みません（制御ループ内では不要なため）。

その他の API は PyScriptRunner の Python API と同一面です。実装も共通で、MCP ツールは PyScriptRunner と同じ共有メモリ・同じコールバックを経由します（`set_ao` は必ずアプリ側の送信経路を通るため、Modbus フレーム間隔などの制約はそのまま維持されます）。

**動作ルール**

- **書込みは既定で無効**。アプリのメニュー「MCP Access」で明示的に許可した場合のみ通ります。読取りは常時可能です。
- **PyScriptRunner は1つだけ**。MCP から実行したスクリプトと画面から実行したスクリプトは同一の実行系・同一のエディタ内容を共有するため、二重実行は起こりません。実行中は反対側からの起動を拒否し、`get_script()` でいつでも内容と状態を確認できます。MCP から投入したコードは実行前に退避され、PyScriptRunner パネルの「Restore」で復元できます。
- **直接書込みはスクリプト実行中は拒否**されます（制御ループと外部書込みの競合を防ぐため）。停止は `stop_script` で行えます。
- **多重起動は先勝ち**。2つ目以降のインスタンスはポートを取得できないため MCP 無効で通常起動します（アプリ自体は問題なく動作します）。
- 高速な制御ループは MCP の往復では回せません。`run_script` で Python をハードウェア側に投入してください。
- **スクリプトのエラーは結果として返ります**。投入した Python は別ワーカーで走るため、失敗しても MCP のツール呼び出し自体は成功します。そこで `run_script` は既定で最大 3 秒（`wait_ms` で変更、0 で即時復帰）だけ完了を待ち、`{ outcome, error, traceback, log }` を返します。起動直後に落ちるスクリプト（構文エラー・NameError・import 失敗など）はこの時点でトレースバックごと返り、制御ループのように走り続けるものは `outcome: "running"` で返ります。実行中・実行後の `print()` 出力とトレースバックは `get_script_log(n)` で取得でき、最後の実行の結果は `get_script()` の `lastRun` にも入ります。ログは実行ごとにクリアされ、直近 300 行を保持します。同じ内容は PyScriptRunner パネルの **Output** 欄にも表示されます。

---

## リモート監視（デスクトップ版限定）

計測中の画面を、別の PC やスマホのブラウザから見られます。立ち会いの人に画面を見せたい、装置の隣を離れて様子を見たい、といった用途を想定しています。

**使い方**

1. 計測している PC で、メニューの **Remote Monitoring** を開きます。
2. 公開方法を選んでオンにします。
   - **This network** — LAN 直接。インターネット不要。`192.168.*.*` の PC だけが到達できます。
   - **Internet link** — HTTPS のリンクを発行します。モバイル回線のスマホでも開けます（インターネット必要）。
3. 表示された **QR コードをスマホで撮る**か、URL を見る側の PC のブラウザで開きます。

見る側の画面には、AI / AO / Parameter の各チャネルとチャートがそのまま出ますが、**Connect / Start Save / メニューのボタンは存在しません**。ヘッダーには "Monitor (read-only)" と表示されます。

**制限と考え方**

- **閲覧専用は接続の性質です。** 見る側の PC にはシリアルポートが繋がっておらず、こちらへ送り返す通信路もありません（フィードは一方通行で、見る側が送ったデータは一切読まれません）。ボタンが無いのは説明であって、制限そのものはページの外側にあります。
- **リンクを知らなければページすら出ません。** 最初のアクセスで URL の `?k=` を確認し、以降は Cookie で通します。トークンが合わなければ、HTML もアセットも 403 です。
- **URL は毎回変わります。** アプリを再起動すると、古いリンクも古い QR コードも無効になります。
- **This network は平文の HTTP** で、LAN の外には出ません。**Internet link は HTTPS** ですが、アドレス自体は公開インターネット上にあります。**リンクそのものが鍵**だと考えてください。
- Internet link は Cloudflare の Quick Tunnel（アカウント不要・無料）です。**稼働保証はありません**。誰かが頼りにしている計測なら This network を使ってください。
- **見る側のチャートは直近のサンプルだけ**です。長時間の Save 中でも、見えるのは最新部分に限られます。完全な記録は計測 PC が書いている TSV ファイルです。
- 見る側では設定（ラベル・キャリブレーション等）は保存されません。表示は計測 PC の設定をそのまま映しているだけです。

> トンネル用の `cloudflared` は exe に同梱されているため、実行する PC への事前インストールは不要です（その分 exe は約 54MB 大きくなっています）。

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
