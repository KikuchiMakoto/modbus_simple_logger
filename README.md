# ModbusSimpleLogger

ブラウザ上で動作する Modbus RTU ロガー（SPA / PWA）。Web Serial API でローカルの Modbus RTU デバイスに接続し、アナログ入力のリアルタイム計測・キャリブレーション・チャート表示・TSV 保存を行います。

🔌 **デモ**: https://kikuchimakoto.github.io/modbus_simple_logger/

## 動作環境

**Chromium 系ブラウザが必須**です。Web Serial API / File System Access API / Wake Lock API を使用するため、Safari と Firefox は動作対象外です。

| ブラウザ | 最低バージョン | 根拠 |
|----------|----------------|------|
| Google Chrome | **89+** | Web Serial API (`navigator.serial`) |
| Microsoft Edge | **89+** | 同上 |
| Android Chrome | **89+** | 同上 |

> ただし File System Access API は Chrome / Edge **86+**、Wake Lock API は **84+** が必要です。これらはいずれもずっと以前のリリースなので、現在インストールされている版を使っていれば問題になりません。古い環境を除き最新版の使用を推奨します。
> SharedArrayBuffer（ScriptRunner 用）は COOP/COEP ヘッダーでクロスオリジン分離された環境でのみ利用できます。デスクトップ版のサーバーはこれを直接付与します。Web 版（GitHub Pages）はレスポンスヘッダーを設定できないため Service Worker が付与しており、**初回訪問で SW がインストールされ制御を開始したあと**にクロスオリジン分離が有効になります（ScriptRunner が最初だけ使えない場合はリロードしてください）。

---

## 主な機能

| 機能 | 説明 |
|------|------|
| **Modbus RTU 通信** | Web Serial API（`navigator.serial`）で接続。非対応環境（Android など）は自前の WebUSB CDC-ACM 実装（[`src/modbus/webusbSerial.ts`](src/modbus/webusbSerial.ts)）でフォールバック |
| **AI 16ch 計測** | HX711 ×8 + ADS1115 ×8 の定期ポーリング。**Polling Rate**（固定 100ms）と **Save Rate**（いつでも変更可、200ms〜30分）は独立 — 保存を遅くしてもフィードバック制御は速いまま回る。トランスポート非依存（Web Serial / WebUSB とも同じ 100ms、WebUSB が 200ms / 500ms に制限されていた時期があるが、原因だった polyfill のリークを修正して撤廃済み — 下記参照）。Save Rate の最小値は Polling Rate 以上なので、書き出す行は常にポーリングの格子に乗る。チャートも常に 100ms。リンク設定（slave id 1、38400bps 8N1、Normal(i16t) 精度、100ms ポーリング）は固定の1通りのみで、Connection Config はその確認用の読み取り専用表示 |
| **AO 8ch 制御** | GP8403（Holding Register）への書き込み。ScriptRunner からの自動制御にも対応 |
| **キャリブレーション** | チャネルごとに `a·x² + b·x + c` を編集・保存（localStorage）・JSON 入出力。ワンタッチ Tare（0点補正）付き |
| **電圧表示モード** | HX711（mV/V, με）/ ADS1115（V, mV）を各チャネルで切り替え |
| **リアルタイムチャート** | Plotly.js による4画面表示。X/Y 軸を Time / Raw / Physical / Parameter（16ch）から選択。非保存時は直近 768 点（≒77秒）のプレビュー、保存中は保存開始〜現在の全区間を 2048 点へ間引いて表示。描画バックエンド（GPU/CPU）バッジ表示 |
| **データ保存** | File System Access API による TSV ストリーミング保存（Web Worker 書込み）。書き込み周期は Save Rate に従います。IndexedDB でセッション中データを FIFO 管理 |
| **ヘッダーの計測表示** | `Total: 00:12:03 / # 720` と `File: run.tsv` の2つだけ。**保存していない間は `Total: --:--:-- / # -`**（`00:00:00 / # 0` は「保存が開いているのに1行も書けていない」という異常の読み値なので使いません）。ファイル名は幅が変わる唯一の項目なので**最後**に置いてあり、保存開始で左の数値がずれません |
| **クラッシュ復旧** | 保存中の全行を OPFS へ同期ミラーします（ピッカーで選んだファイルは Stop Save まで 0 バイトのため）。異常終了後の初回起動で復旧を提示し、`<元の名前>_recovered.tsv` としてダウンロードします。提示を Cancel すると復旧コピーは削除されます |
| **System Log** | アプリ全体のログを読むための独立ウィンドウ（メニュー → System Log）。スクリプトの `print()` 出力・エラー・トレースバックに加え、**接続 / 切断・保存の開始と終了・ストレージ障害**まで、同じ時計・同じ並びで1本に入ります。**logcat 風に1行1エントリ・固定列**（時刻(ms)／レベル1文字／発生元／内容）で、改行を含む長い内容は `⏎` に畳んで1行に省略、**クリックで全文展開**。同一内容の連投は `(×N)` にまとめます。末尾追従は「末尾を見ている間だけ」なので遡り読み中に引き戻されません。Copy はレベル絞り込みも畳みも無視して全文をコピー |
| **ログレベル** | log4j 準拠の `TRACE / DEBUG / INFO / WARN / ERROR / FATAL`。ヘッダーのプルダウンで**そのレベル以上だけを表示**します（既定 INFO、端末ごとに記憶）。スクリプトの出力とアプリの通常イベントが INFO、`stderr` とトレースバック・各種失敗が ERROR、データ喪失が FATAL。**Clear ボタンはありません** — 記録を捨てずに静かにする手段がレベルなので（保持は直近 2000 行・1行 2000 文字まで） |
| **ScriptRunner** | **Python**（Pyodide）を Web Worker + SharedArrayBuffer 上で実行。読み取りは `GetAiRaw()` / `GetAiPhy()` / `GetAo()` / `GetParam()`、書き込みは `SetAo()` / `SetParam()` / `SetAiTare()`（全 API 一覧はパネル内に表示）。**Stop はいつでも効きます**（出口の無いループの中でも）。スクリプトは**タブで複数持てます**（追加・改名・`✕` で閉じる）。**実行中のタブは読み取り専用** |
| **バックグラウンド耐性** | ポーリング・チャート反映・TSV フラッシュのタイマーを専用 Worker で駆動。ウィンドウを最小化してもブラウザのタイマー抑制（1Hz→1分に1回）で計測が止まりません。デスクトップ版はブラウザ起動フラグでも抑制を無効化 |
| **画面下端のフッター** | 常に1段の固定バー。左から ScriptRunner の状態（実行中スクリプト名・Idle / Running）／ **System Log の最新1行**（ローリング表示・レベルの色付き）／ 右端に**実測ポーリング周期**。**2段になることはありません** — どの項目もバーの高さを変えないので、計測中に画面が組み替わりません |
| **エラー表示** | 接続失敗・通信エラー・TSV 書込み失敗などは System Log に ERROR で入り、フッターの1行に流れます。同じ内容は `(×N)` にまとめられ、復旧すると `Recovered` の行が入ります。履歴はメニュー → System Log |
| **UI 拡大率** | 画面全体を 50〜200%（11 段）で拡大・縮小し、その端末に記憶します（Menu ヘッダーの `[-] [100%] [+]`。ダーク/ライト切替も同じ場所）。ブラウザのズームが使えない・保持されない環境（Android のインストール済み PWA など）向け |
| **PWA** | Service Worker プリキャッシュで完全オフライン動作。COOP/COEP で SharedArrayBuffer を有効化。更新確認は起動直後と Application Info の「Check for Updates」ボタンのみで、デバイス接続中は停止（計測中に確認ウィンドウが割り込まない） |
| **その他** | Wake Lock による計測中のスリープ抑止（デスクトップ版は OS の電源管理へ直接要求するため最小化中も有効）、多重起動抑制（デスクトップ版）、ダークモード、Iosevka 同梱、アプリ内のコネクタ配線マニュアル（Connector Manual） |

---

## スクリプト言語

ScriptRunner が実行するのは **Python（Pyodide）** だけです。言語セレクタはありません。

スクリプトは**タブ**で複数持てます。タブは `＋` で追加、`✕` で閉じ、名前はダブルクリックで
変更できます（最大 24 文字）。既定名は `main` `main2` … で**拡張子は付きません**。

**実行中のスクリプトは編集できません。** そのタブのエディタは読み取り専用（琥珀色）になり、
Clear ボタン（長押しで発火）も止まります。Worker には Run した時点のコードが渡っているため、途中で書き換えても
実行中の内容は変わらず、エラー行だけがずれるためです。他のタブは実行中でも自由に編集できます。

**計測 API は PascalCase**（`GetAiPhy` `SetAo` …）です。Python の慣習である snake_case では
ありません — これらは計器の呼び出しであって Python ライブラリの呼び出しではない、という判断です。

**読み取りは同期**（共有メモリから直接）、**書き込みは非同期**（Modbus の転送ミューテックスが
メインスレッド側にあるため）。したがって `SetAo` の直後の `GetAo` はまだ前の値を返します。

待ち方は `await asyncio.sleep(s)`、単位は**秒**です。起動（Pyodide のロード）は初回のみ数秒
かかります。

**Stop はいつでも効きます** — `while True:` のような出口の無いループの中でも、スクリプト側に
何の配慮も要りません。

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
- **クロスオリジン分離** — 配信サーバーが全レスポンスに COOP/COEP を付与するため、SharedArrayBuffer（スクリプト Worker）と ScriptRunner がそのまま動作します。
- **専用プロファイル** — ブラウザは専用の `--user-data-dir` で起動するため、通常のブラウザ設定・ディスクキャッシュと混ざりません。
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

<details>
<summary>Android/WebUSB で数十秒ごとに通信が落ちていた問題（修正済み）</summary>

Android の Chrome には Web Serial がないため、**WebUSB** で CDC-ACM アダプタを直接叩きます。以前はここに `web-serial-polyfill` を使っていて、数十秒〜数分ごとに必ずこの障害が出ていました。

```
ERROR Link: NetworkError: Failed to execute 'transferIn' on 'USBDevice': A transfer error has occurred.
```

原因は polyfill の `UsbEndpointUnderlyingSource.pull()` です。`transferIn` を async IIFE の中で開始しておきながら `undefined` を返すため、**ReadableStream が転送の完了を待ちません**。ストリームは「pull は即座に完了した」と解釈して `desiredSize > 0` の限り pull を続け、結果として**受信 1 バイトにつき `transferIn` を 2 回発行し、1 回だけ回収する**——差の 1 回は永久に宙に浮きます。実装をそのまま回した検証では、2,760 バイトの受信に対し 5,520 転送を発行し 2,760 転送が未完了のまま残りました。

宙に浮いた転送はカーネルに提出されたままなので、Android の usbfs が保持できる pending URB のメモリ上限に達した時点で落ちます。「約 16,200 転送で落ちる」という実測値は転送回数の上限ではなく、**リークが上限を埋めるまでの本数**でした。`16200 / (frameバイト数 × frame毎秒)` で障害間隔を計算すると実測と一致します。

| Polling Rate | Extended (f32, 69B) 予測/実測 | Normal (i16, 37B) 予測/実測 |
|---|---|---|
| 100 ms | 23 秒 / 24 秒 | 44 秒 / 44 秒 |
| 200 ms | 47 秒 / 47 秒 | 88 秒 / 88 秒 |
| 500 ms | 117 秒 / 117 秒 | 219 秒 / 219 秒 |

**Polling Rate を下げても直らなかったのはこのため**です。リークは時間ではなくバイト数に比例するので、周期を倍にしても同じ障害までの時間が倍になるだけでした。Web Serial（ネイティブ）は正しく backpressure がかかるので、この問題は Android でだけ起きていました。

現在は polyfill をやめ、[`src/modbus/webusbSerial.ts`](src/modbus/webusbSerial.ts) の自前実装に置き換えてあります。`pull()` が開始した転送を必ず await するため、未完了の転送数は構造上 8 本（`BULK_IN_PIPELINE_DEPTH`）を超えません。深さ 8 なのは、1 本ずつ直列に待つと 1 バイト 1 転送のアダプタでは float32 1 フレームに約 104ms かかり 100ms 周期に収まらないためで、8 本並べるとホスト往復遅延が隠れて回線速度律速（約 18ms）になります。

この結果、Polling Rate が固定 100ms になった現在も **WebUSB は Web Serial と同じ条件で安定して動きます**（トランスポート間の速度制限は無い）。障害を追うときは System Log のしきい値を **DEBUG** にすると `link ok: … USB transfers` 行に転送回数が出ます。ここが五桁に伸び続ける場合は同種のリークを疑ってください。
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
