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
| **Modbus RTU 通信** | Web Serial API（`navigator.serial`）で接続。非対応環境は `web-serial-polyfill` 経由の WebUSB フォールバック |
| **AI 16ch 計測** | HX711 ×8 + ADS1115 ×8 の定期ポーリング。**Polling Rate**（25ms / 50ms / 100ms、既定 100ms、接続中は固定）と **Save Rate**（200ms〜30分、既定 1s、いつでも変更可）は独立 — 保存を遅くしてもフィードバック制御は速いまま回る。チャートは常に 100ms 固定。Normal（i16）/ Extended（f32）の2精度モードと、接続時に一度だけデバイスへ問い合わせて選ぶ **Auto**（既定） |
| **AO 8ch 制御** | GP8403（Holding Register）への書き込み。ScriptRunner からの自動制御にも対応 |
| **キャリブレーション** | チャネルごとに `a·x² + b·x + c` を編集・保存（localStorage）・JSON 入出力。ワンタッチ Tare（0点補正）付き |
| **電圧表示モード** | HX711（mV/V, με）/ ADS1115（V, mV）を各チャネルで切り替え |
| **リアルタイムチャート** | Plotly.js による4画面表示。X/Y 軸を Time / Raw / Physical / Parameter（16ch）から選択。非保存時は直近 768 点（≒77秒）のプレビュー、保存中は保存開始〜現在の全区間を 2048 点へ間引いて表示。描画バックエンド（GPU/CPU）バッジ表示 |
| **データ保存** | File System Access API による TSV ストリーミング保存（Web Worker 書込み）。書き込み周期は Save Rate に従います。IndexedDB でセッション中データを FIFO 管理 |
| **クラッシュ復旧** | 保存中の全行を OPFS へ同期ミラーします（ピッカーで選んだファイルは Stop Save まで 0 バイトのため）。異常終了後の初回起動で復旧を提示し、`<元の名前>_recovered.tsv` としてダウンロードします。提示を Cancel すると復旧コピーは削除されます。**録画（動画）にこの保護はありません** — ミラーは全バイトを二重に書くため、GB 単位の動画では計測が必要とするディスク帯域を食い潰すからです。動画は Stop Recording を押すまで確定しません |
| **Script Log** | スクリプトの `print()` 出力・エラー・トレースバックを読むための独立ウィンドウ（メニュー → Script Log）。**logcat 風に1行1エントリ・固定列**（行番号／時刻(ms)／実行スクリプト名／内容）で、改行を含む長い内容は `⏎` に畳んで1行に省略、**クリックで全文展開**。末尾追従は「末尾を見ている間だけ」なので遡り読み中に引き戻されません。Copy は畳まずに全文をコピー |
| **ScriptRunner** | **Python / BASIC / Lua** をパネル上のセレクタで切り替えて実行（Web Worker + SharedArrayBuffer）。読み取りは `GetAiRaw()` / `GetAiPhy()` / `GetAo()` / `GetParam()`、書き込みは `SetAo()` / `SetParam()` / `SetAiTare()`、`SetNotify()` で通知。**API 名は3言語で共通**（全 API 一覧はパネル内にも表示）。**どの言語でも Stop はいつでも効きます**（出口の無いループの中でも）。スクリプトは**言語ごとに独立したタブ**で複数持てます（追加・改名・`✕` で閉じる）。**実行中のタブは読み取り専用** |
| **バックグラウンド耐性** | ポーリング・チャート反映・TSV フラッシュのタイマーを専用 Worker で駆動。ウィンドウを最小化してもブラウザのタイマー抑制（1Hz→1分に1回）で計測が止まりません。デスクトップ版はブラウザ起動フラグでも抑制を無効化 |
| **エラー表示** | 接続失敗・通信エラー・TSV 書込み失敗などを画面下端のステータスバーに表示します。同じ内容は回数にまとめられ、復旧すると自動で消えます。`+N` から履歴（Status Log）を開けます |
| **通知** | ScriptRunner の開始・停止・完了・エラーと `SetNotify(msg)` を OS 通知で表示（Application Info でオン/オフ）。アプリのエラーも同じ経路で通知します |
| **UI 拡大率** | 画面全体を 50〜200%（11 段）で拡大・縮小し、その端末に記憶します（Menu ヘッダーの `[-] [100%] [+]`。ダーク/ライト切替も同じ場所）。ブラウザのズームが使えない・保持されない環境（Android のインストール済み PWA など）向け |
| **録画（Recording Config）** | メニューから開くウィンドウでカメラとマイクをバインドし、映像プレビューとマイクレベルを確認して、**そのウィンドウの Start Recording で録画**します（TSV 保存とは独立。遠隔監視中に計測を走らせず録るのが主用途）。保存先フォルダは一度選べば記憶され、`YYYYMMDD_HHMMSS.mp4`（非対応環境では `.webm`）で書き出します。オプションでローカル時刻をミリ秒まで**白文字・黒縁で映像に焼き込み**ます（TSV の `timestamp` 列と同じ関数で生成するので突き合わせがずれません）。解像度と fps は自由入力（幅 640 以上、上限なし）で、**USB 帯域バジェット**と**ハードウェアエンコードの有無**の2つのゲートを通らないと開始できません |
| **リモート監視** | デスクトップ版限定。他 PC やスマホのブラウザから、チャートとチャネル値を**閲覧のみ**できます（LAN 直接 / インターネット経由・QR 表示・既定オフ）。カメラをバインドしていれば**映像と音声も配信**できます（fMP4 を既存の WebSocket に流し MediaSource で再生。遅延 1 秒前後。視聴者が 0 人のときはエンコードしません。既定オフで、有効化するたびに明示的に選ぶ必要があります） |
| **ランチャーのチャート枠** | デスクトップ版のみ、4 面あるチャートのうち **3 番目が Script Log、4 番目が Camera** になります（Web 版は 4 面ともチャートのまま）。ビューア側は 4 番目にホストのカメラ映像が出ます |
| **PWA** | Service Worker プリキャッシュで完全オフライン動作。COOP/COEP で SharedArrayBuffer を有効化。更新確認は起動直後と Application Info の「Check for Updates」ボタンのみで、デバイス接続中は停止（計測中に確認ウィンドウが割り込まない） |
| **その他** | Wake Lock による計測中のスリープ抑止（デスクトップ版は OS の電源管理へ直接要求するため最小化中も有効）、多重起動抑制（デスクトップ版）、ダークモード、Iosevka 同梱、アプリ内のコネクタ配線マニュアル（Connector Manual） |

---

## スクリプト言語

ScriptRunner のタイトルバーのセレクタで切り替えます。**スクリプトは言語ごとに独立**していて、
その下のタブがその言語のスクリプト一覧です（言語をまたいで 1 本のタブ列に混ざることは
ありません）。タブは `＋` で追加、`✕` で閉じ、名前はダブルクリックで変更できます（最大 24 文字）。
既定名は `main` `main2` … で**拡張子は付きません** — タブ列も言語セレクタも既にその言語のものなので、
`.py` は毎タブで同じことを繰り返すだけだからです。
言語の切り替えは実行中はできません（タブの移動は同じ言語の中でのみなので、実行中のスクリプトは
必ず画面上のタブ列に赤い点付きで見えている状態が保たれます）。

**実行中のスクリプトは編集できません。** そのタブのエディタは読み取り専用（琥珀色）になり、
Clear ボタン（長押しで発火）も止まります。Worker には Run した時点のコードが渡っているため、途中で書き換えても
実行中の内容は変わらず、エラー行だけがずれるためです。同じ言語の他のタブは実行中でも自由に
編集できます。

**計測 API は3言語すべてで同じ名前**です（`GetAiPhy` `SetAo` …）。Python の慣習である snake_case
ではなく PascalCase なのは、BASIC が大小文字とアンダースコアを無視するため PascalCase なら
3言語で綴りが一致するからで、スクリプトを言語間で移すときに覚え直さずに済みます。

**読み取りは同期**（共有メモリから直接）、**書き込みは非同期**（Modbus の転送ミューテックスが
メインスレッド側にあるため）。したがって `SetAo` の直後の `GetAo` はまだ前の値を返します。
BASIC のみ、手続きは括弧なしで呼びます（`SetAo 0, 1.5`）。

| | Python | BASIC | Lua |
|---|---|---|---|
| 実行系 | Pyodide (Python 3.14) | 自前実装（VB6 方言） | wasmoon (Lua 5.4) |
| 待ち方 | `await asyncio.sleep(s)` | `Sleep s` | `sleep(s)` |
| 待ちの単位 | 秒 | 秒 | 秒 |
| 起動時間 | 数秒（初回のみ） | 即時 | ほぼ即時 |

> 待ちの単位は**3 言語とも秒**です。BASIC の `Sleep` が秒なのは、VB6 の言語ネイティブな待ち
> （`Timer` を使ったループ）と QBasic/N88 の `SLEEP` がどちらも秒だからで、ミリ秒になるのは
> VBA/VB.NET が Win32 API を取り込んだ経路だけです。その流儀で `Sleep 1000` と書いた場合は
> 1 回だけ注意書きが出ます（16.7 分待つことになるため）。

**Stop はどの言語でもいつでも効きます** — `while True:` / `Do ... Loop` / `while true do end` の
ような出口の無いループの中でも、スクリプト側に何の配慮も要りません。

BASIC の方言仕様（VB6 準拠の範囲、受理する N88/QBasic/VB.NET の綴り、組込関数の一覧）は
[`src/basic/README-dialect.md`](src/basic/README-dialect.md) にあります。

---

## 技術スタック

React 19 / TypeScript 7 / Vite 8 / Tailwind CSS 4 / Plotly.js 3 / Pyodide 314（Python 3.14, セルフホスト）/ wasmoon（Lua 5.4）/ Bun

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

## リモート監視（デスクトップ版限定）

計測中の画面を、別の PC やスマホのブラウザから見られます。立ち会いの人に画面を見せたい、装置の隣を離れて様子を見たい、といった用途を想定しています。

**使い方**

1. 計測している PC で、メニューの **Remote Monitoring** を開きます。
2. 公開方法を選んでオンにします。
   - **Local Network** — 直結。インターネット不要。この PC に経路が届くところ（研究室 LAN、大学のグローバルアドレス、Tailscale など）から見えます。
   - **SmartPhone Link** — HTTPS のリンクを発行。モバイル回線のスマホでも開けます（インターネット必要）。
3. 表示された **QR コードをスマホで撮る**か、URL を見る側の PC のブラウザで開きます。

見る側の画面には、AI / AO / Parameter の各チャネルとチャートがそのまま出ますが、**Connect / Start Save / メニューのボタンは存在しません**。ヘッダーには "Monitor (read-only)" と表示されます。

**制限と考え方**

- **閲覧専用は接続の性質です。** 見る側の PC にはシリアルポートが繋がっておらず、こちらへ送り返す通信路もありません（フィードは一方通行で、見る側が送ったデータは一切読まれません）。ボタンが無いのは説明であって、制限そのものはページの外側にあります。
- **リンクを知らなければページすら出ません。** 最初のアクセスで URL の `?k=` を確認し、以降は Cookie で通します。トークンが合わなければ、HTML もアセットも 403 です。
- **URL は毎回変わります。** アプリを再起動すると、古いリンクも古い QR コードも無効になります。
- QR / URL は **NIC ごとに 1 つ** 出ます（有線・無線・Tailscale など）。見る側と同じネットワークのものを渡してください。他のものは相手側で単に開けません。

**警告**

- **NAT 超えが許可されていないネットワークで SmartPhone Link を使わないこと。** 実体は Cloudflare Quick Tunnel で、NAT とファイアウォールを外向きに貫きます。大学・企業ネットではこれは技術ではなく規程の問題です。先に確認してください。
- **Local Network は平文 HTTP で、常にローカルとは限りません。** グローバル IP が振られたキャンパスネットでは「この PC のネットワーク」がインターネットを意味します。
- **アクセスは計測に影響します。** リクエストはこのプロセス自身が処理します。DoS でも、外部スキャナの流れ弾でも、大量アクセスは取得ループと競合し、計測タイミングを乱し得ます。
- **SmartPhone Link に稼働保証はありません**（アカウント不要・無料の Quick Tunnel）。誰かが頼りにしている計測なら Local Network を使ってください。
- **見る側のチャートは直近のサンプルだけ**です。長時間の Save 中でも、見えるのは最新部分に限られます。完全な記録は計測 PC が書いている TSV ファイルです。
- 見る側では設定（ラベル・キャリブレーション等）は保存されません。表示は計測 PC の設定をそのまま映しているだけです。

> トンネル用の `cloudflared` は exe に同梱されているため、実行する PC への事前インストールは不要です（その分 exe は約 54MB 大きくなっています）。

**カメラ映像の配信**

カメラをバインドしていれば、Remote Monitoring パネルの「Send the camera too」で映像と音声も配信できます。

- 方式は **fMP4 のフラグメントを既存の WebSocket に流し、見る側の MediaSource に append** するものです。HLS / DASH ではありません — あれはセグメンタとマニフェストが要る上に遅延が 2〜6 秒あり、MediaRecorder が吐くものはそのまま append できるからです。遅延は 1 秒前後になります。
- WebRTC でもありません。**LAN モードの見る側は平文 HTTP なので secure context ではなく、`RTCPeerConnection` がそもそも使えません。** さらにシグナリングには見る側→ホストの通信路が必要で、それは「見る側が送ったものは一切読まない」という閲覧専用の担保そのものを壊します。MediaSource はどちらにも該当しません。
- **既定はオフで、共有を有効にするたびに選び直す必要があります**（記憶しません）。装置に向いたカメラは数字のチャートとは共有の重みが違い、SmartPhone Link では建物の外に出ていくためです。
- **視聴者が 0 人のときはエンコードしません。** 配信は録画とは別の 2 本目のエンコーダなので、誰も見ていないのに回すことはしません。録画ファイルの画質が配信の都合で下がることもありません。
- 回線が細い視聴者にはフラグメントを**捨てます**（貯めません）。映像は飛びますが、計測が他人の Wi-Fi の代金を払うことはありません。

---

## 録画が始まらないとき（2つのゲート）

Recording Config の Start Recording は、次の2つを通らないと押せません。どちらも**警告ではなく拒否**で、理由はパネルに実測値のまま表示されます。

**1. USB 帯域バジェット**

UVC カメラは**アイソクロナス転送**で毎マイクロフレームの帯域を先に予約します。一方 Modbus 側の USB シリアルは**バルク転送**で、予約の残りを分け合う側です。つまりカメラの設定を上げすぎると、シリアルが「遅くなる」のではなく**先に取られて痩せます**。

既定の上限は実効 400 Mbps の 75% にあたる **300 Mbps** です。`400 − 12`（Modbus の分だけ引く）にしていないのは、必要なのは「12 Mbps が通ること」であって「12 Mbps だけ空いていること」ではないからです。

見積もりは形式によって桁が違います。**ブラウザは実際にどの形式でネゴったか教えてくれない**ので、想定形式は申告制で、YUY2 での最悪値を常に併記します。

| 形式 | 1280×720@30 | 1920×1080@30 |
|---|---|---|
| YUY2（無圧縮 16bpp） | 442 Mbps | 995 Mbps |
| MJPEG（≈10:1） | 44 Mbps | 100 Mbps |
| H.264（カメラ内蔵エンコーダ） | 約 20 Mbps | 約 20 Mbps |

カメラが物理的に別バス（USB3 ポートや別ホストコントローラ）にあるなら競合しないので、チェックボックスでこの判定を外せます。**逃げ道はここだけです** — 競合していない構成をソフトが止めるのは単に間違いだからです。

**2. ハードウェアエンコード**

ソフトウェアの H.264 / VP9 エンコードは 720p でもコアを 1 本持っていきます。このアプリでその 1 本は空いていません（取得ループが回っています）。ポーリング周期を犠牲にした録画は、計測とその映像を取り違えた結果でしかないので、**ハードウェアエンコーダを確認できない環境では録画しません**。強制的に有効化する手段は用意していません。

判定は `VideoEncoder.isConfigSupported()` に `hardwareAcceleration: 'prefer-hardware'` を渡した結果と、WebGL がソフトウェアラスタライザ（SwiftShader / llvmpipe）に落ちていないことの2つです。

> **この判定は正確ではなく厳しめです。** `MediaRecorder` は `VideoEncoder` を経由しないため両者は食い違うことがあり、実測では `isConfigSupported` が「H.264 のハードウェアエンコーダ無し」と答える機械で `MediaRecorder` が正常に H.264 MP4 を書けています。つまり**本当は録れる機械を拒否することがあります**。承知の上でのトレードで（計測の方が動画より重い）、パネルには測定値をそのまま出すので `chrome://gpu` の `Video Encode` と突き合わせて確認できます。
>
> なお `MediaCapabilities.encodingInfo({type: 'record'})` は仕様にはありますが Chromium には実装されておらず呼ぶと例外になります。`{type: 'webrtc'}` の `powerEfficient` はハードウェアエンコーダを持つ機械でも H.264 / VP8 / VP9 / AV1 すべてに false を返すため、判定には使えません。

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
