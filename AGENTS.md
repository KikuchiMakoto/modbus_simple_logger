# AGENTS.md

このリポジトリで作業するエージェント向けの簡易ガイドです。

## プロジェクト概要

- **React 19 + TypeScript 7 + Vite 8 + Tailwind CSS 4** で構成された Modbus RTU ロガー SPA
- 通信は **Web Serial API**（非対応環境では `web-serial-polyfill` 経由で WebUSB フォールバック）
- AI 16ch（HX711 × 8 + ADS1115 × 8）/ AO 8ch（GP8403）のポーリングと制御
- 計測データは IndexedDB（セッション中 FIFO）と TSV（File System Access API ストリーミング）で扱う
- Plotly.js（`react-plotly.js`）によるリアルタイムチャート表示
- Pyodide（Web Worker + SharedArrayBuffer）による PyScriptRunner 機能
- PWA: Service Worker によるキャッシュとオフラインフォールバック
- Wake Lock API による計測中の画面スリープ抑止

## 主要コマンド

```bash
bun install
bun run dev
bun run build
```

## ディレクトリ構造

```
src/
├── App.tsx                          # UI・計測フロー・ポーリングの中枢（リファクタ済み・カスタムフック使用）
├── main.tsx                         # エントリポイント + SW 登録 + Error Boundary
├── index.css                        # Tailwind + カスタムクラス
├── types.ts                         # 型定義（AiChannel, AoChannel, DataPoint, SerialSettings 等）
├── types/
│   └── modules.d.ts                 # 型定義を持たない依存の宣言
├── constants.ts                     # 一元化された定数（AI_CHANNELS, MAX_POINTS_* 等）
├── modbus/
│   ├── webserialClient.ts           # Web Serial トランスポート + Modbus RTU フレーム送受信
│   └── frameScan.ts                 # 応答フレーミングの純粋関数（scanModbusFrame）＋ ModbusExceptionError。slaveId/fc/CRC 検証と例外フレーム判定
├── plotly.ts                        # Plotly カスタム最小バンドル（core + scattergl のみ）
├── pyodideWorker.ts                 # Pyodide PyScriptRunner 用 Web Worker
├── tsvWriterWorker.ts               # TSV 整形・バッファ・書込み用 Web Worker
├── timerWorker.ts                   # タイマー抑制回避用 Worker（setTimeout/setInterval をワーカースレッドで保持）
├── hooks/
│   ├── useTheme.ts                  # テーマ管理（localStorage 永続化）
│   ├── useChartAxes.ts              # チャート軸設定（localStorage 永続化）
│   ├── useScriptRunner.ts           # Pyodide Worker 管理 + SAB 先行確保
│   ├── useNotifications.ts          # 通知トグルと許可状態（UI 用ラッパー。実体は utils/notifications.ts）
│   └── useViewerFeed.ts             # リモート監視のページ側（exe 限定）。ホスト送信フックと閲覧側受信フックの2本
├── components/
│   ├── ChartPanel.tsx               # Plotly チャート（X/Y 軸切替、空状態表示）。App.tsx が4枚描画
│   ├── ScriptStatusBar.tsx          # 画面下端固定の PyScript 状態バー（md 以上のみ・常設なので h-8 スペーサを持つ）
│   ├── AppStatusBar.tsx             # 画面下端固定のエラーバー（**失敗のみ**。正常時は出ない）。PyScript バーの上に重なる。何も無ければ null（スペーサを持たない純オーバーレイ）・全ブレークポイントで表示
│   ├── PyScriptRunnerPanel.tsx      # PyScriptRunner のエディタ／実行・停止・Restore・Output ログ・API 一覧
│   ├── ManualPanel.tsx              # コネクタ配線マニュアル（UI 名: Connector Manual）
│   ├── AppInfoPanel.tsx             # バージョン・依存ライブラリ・描画バックエンド表示＋更新確認ボタン＋通知トグル（UI 名: Application Info）
│   ├── ThemeToggle.tsx              # ライト/ダーク切替スイッチ。置き場所は Menu パネルのヘッダー（ビューアのみアプリヘッダーにも出す）
│   ├── UiScaleControl.tsx           # UI 拡大率の [-] [100%] [+]。Menu パネルのヘッダー
│   ├── CalibrationPanel.tsx         # Input Calib Value ウィンドウ（a·x²+b·x+c 直接編集・Tare・Save/Load）
│   ├── InputCalibratorPanel.tsx     # Input Calibrator（実測最小二乗 / スペック計算）。CH00-15 を1ウィンドウで扱い、HX711/ADS1115 の別は ch 番号から決まる
│   ├── ModbusConfigPanel.tsx        # シリアル・精度・サンプリング設定ウィンドウ（UI 名: Connection Config）
│   ├── InputConfigPanel.tsx         # Input Config = AI レンジ／表示モード設定（チャネルタイプ別フィルタ）
│   ├── OutputTesterPanel.tsx        # Output Tester = AO(GP8403) の手動出力（プリセット即出力＋手入力 Apply）
│   ├── HamburgerMenu.tsx            # スライドインメニュー（Remote Monitoring 項目は exe 限定で表示）
│   ├── RemoteViewerPanel.tsx        # リモート監視の公開モード切替＋閲覧 URL / QR 表示（exe 限定）
│   ├── QrCode.tsx                   # QR をインライン SVG で描画（qrcode-generator・1 path に集約）
│   ├── SlideToConfirm.tsx            # スワイプ確定コントロール。誤クリックで起きては困る操作（Disconnect / Output Tester の全ch 0V / PyScriptRunner の Clear）専用。ジェスチャ完了が確認そのもので、ダイアログは出さない
│   ├── SlidePanel.tsx               # 共通スライドインパネル（HamburgerMenu 専用・backdrop アニメーション付き）
│   └── FloatingWindow.tsx           # 共通フローティングウィンドウ（react-rnd・ドラッグ/リサイズ/前面化）
└── utils/
    ├── calibration.ts               # キャリブレーション計算（HX711 mV/V・μɛ, ADS1115 V, スペック→a/b/c, 最小二乗フィット）
    ├── calibrationExport.ts         # キャリブレーションの JSON 入出力
    ├── appStatus.ts                 # エラーのモジュールレベルストア（**失敗のみ**・同一文言の畳み込み・source 別クリア・notify() へ転送）
    ├── dataStorage.ts               # IndexedDB ラッパー（Singleton・冪等 init）
    ├── tsvExport.ts                 # TSV ライターの主スレッド側（ファイルピッカー + Worker プロキシ）
    ├── opfsRecoveryShared.ts        # OPFS ミラーの命名規約（Worker と主スレッドで共有）
    ├── opfsRecovery.ts              # 起動時の残存ミラー検出・ダウンロード・削除（主スレッド側）
    ├── tsvFormat.ts                 # TSV ヘッダー／行整形の純粋関数（Worker が使用）
    ├── tsvWorkerProtocol.ts         # TSV Worker とのメッセージ型定義
    ├── renderBackend.ts             # Plotly 描画バックエンド検出（WebGL2/WebGL・GPU/CPU）と共有ストア。ChartPanel が報告し、各チャート右上のバッジと AppInfoPanel（全 renderer 文字列）が表示
    ├── backgroundTimer.ts           # timerWorker の主スレッド側（setBackgroundTimeout / Interval / clearBackgroundTimer）
    ├── notifications.ts             # Web Notification のゲート（トグル永続化＋許可判定）と notify()
    ├── appMode.ts                   # 実行形態の判定（web / launcher / viewer）。launcher が index.html へ差し込む meta マーカーが唯一の根拠
    ├── swUpdate.ts                   # SW 登録＋更新チェック（承諾ゲート付き）。main.tsx が起動時に、AppInfoPanel がボタンで呼ぶ
    ├── cookies.ts                   # 設定の永続化（localStorage 本体・Cookie は旧値の読込移行とフォールバックのみ）
    ├── uiScale.ts                   # UI 拡大率（#root の CSS zoom）。localStorage 永続・共有ストア。UiScaleControl が操作し FloatingWindow が座標補正に使う
    └── crc16.ts                     # 純粋 CRC16 実装（Modbus RTU 用）
public/
├── sw.js                            # Service Worker（COOP/COEP ヘッダー注入付き）
├── manifest.json                    # PWA マニフェスト
└── icon.svg                         # アプリアイコン
```

## アーキテクチャ上の重要点

### Modbus 通信（`webserialClient.ts`）
- `AsyncMutex` で転送の排他制御
- CRC16 検証（純粋関数 `utils/crc16.ts`、`buffer`/`modbus-serial` 依存なし）
- 最小メッセージ間隔 = `max(精度モードの基準値, 5文字時間)`（基準値は Normal: 10ms / Extended: 1ms。5文字時間はボーレート・データビット・パリティ・ストップビットから算出）
- 転送エラー後の受信バッファフラッシュ（`flushReceiveBuffer`）
- タイムアウト時の Reader リカバリ（cancel → releaseLock → reacquire）
- サポート Function Code: 1, 3, 4, 5, 6, 15, 16

### USB転送間隔制約（重要）

USB Serial変換IC（CH340, FT232等）経由で UART→ModbusRTU を受信するデバイスでは、
USBパケット遅延・詰まりによる通信エラーを防ぐため、**Modbus RTU フレーム送信間に
最低10msの間隔が必須**。

- `webserialClient.ts` の `transfer()` 内の `minMessageIntervalMs` がこれを担保（`calculateMinInterval()` = 基準値 Normal 10ms / Extended 1ms と 5文字時間の大きい方）
- **この制約をアプリケーション層で再実装してはならない**（`transfer()` が単一責任）
- `constants.ts` に追加の Wait 定数を定義しないこと（`transfer()` の待機と二重になる）
- AO書込みを非ブロック化する場合も、`transfer()` の `AsyncMutex` により AI/AO 送信間の最低間隔が自動保証される
- **「出力直後の InputRegisters 読みを少し遅らせる」も `transfer()` が既に担保している**。参照実装（`DigitShowModbusDoc.cpp`）の `sleep_time_after_cmd_ms`（非 usb_cdc_direct で 10ms / direct で 0）に対応するのが `minMessageIntervalMs`（Normal 10ms / Extended = 5文字時間 ≒ 1.3ms@38400)。**アプリ側に「書込み後ウェイト」を足さないこと** — 二重待機になるだけで、片方だけ直すと必ず食い違う

### AO 出力（`App.tsx` の `doAoWriteAsync`）
- **AO の変更は即時送信**。`applyAoRawValues`（`set_ao` の唯一の着地点）が `requestAoWriteRef.current()` で書込みを起こす。ポーリング周期末尾まで待たせていた頃は、制御ループが1コマンドあたり最大1周期（既定 200ms、遅いサンプリングでは数分）の死に時間を払っていた — 実際の転送は数 ms なのに
- **待たない・間隔を計らない**。フレーム間隔も AI 読取りとの排他も `transfer()` の責任（`AsyncMutex` + `minMessageIntervalMs`）。ここで待つと二重待機になる
- **再入は落とさず畳む**。書込み中に来た変更は `aoWriteRequestedRef` を立て、転送完了後にもう1周だけ回す（参照実装の `evt_cmd_send` と同じレベルトリガ）。**`return` で捨ててはならない** — 捨てられるのは定義上いちばん新しい値であり、制御ループが自分の周期で出力を動かすと黙って取りこぼす
- ループを回す条件は「**直前の転送中に**新しい変更が来たこと」だけにすること。失敗した書込みは値が「変更済み」のまま残るため、これを条件にすると死んだデバイスへ延々と再送する
- `pollOnce` 末尾の `doAoWriteAsync()` は**取りこぼしの拾い直し**（リトライ制限に当たっていた変更）であって主経路ではない

### 精度モードの自動判定（`App.tsx` の `probeExtendedPrecision`）
- Precision の選択肢は **Auto（既定）/ Normal(i16t) / Extended(f32t)**。型を2つに分けてあり、`ModbusPrecisionSetting`（ユーザーの選択・`'auto'` を含む）と `ModbusPrecision`（実際に線上で使う地図・2値のみ）は**別物**。`'auto'` を下流（ポーリング・TSV 列整形・読み値表示）へ流してはならない
- 判定は **接続時に1回だけ**。`AI_FLOAT_START_REGISTER`(5000) の先頭2ch を `PRECISION_PROBE_TIMEOUT_MS`(100ms) で読み、返れば Extended、返らなければ Normal。**実行中に再判定しないこと** — 相手のファームウェアの性質であり、記録中にレジスタ地図が変わる余地を作るだけ
- **プローブは AO Holding Registers 同期の後に置く**。先に置くと「デバイスが全く喋っていない」と「float レジスタが無い」が同じ沈黙になり、断線を根拠にレジスタ地図を決めてしまう
- **`PRECISION_PROBE_ATTEMPTS`(3回) 失敗して初めて Normal に落とす**。**間違うなら Normal 側へ**倒すこと — Auto 以前の既定がまさに Normal であり、逆に誤って Extended にすると i16 レジスタを float の半分として解釈し、**もっともらしい嘘の値を記録する**
- **プローブの catch は広いまま保つこと**。float レジスタを持たないデバイスは Modbus 例外フレームを返す。v4.5 以降 `transfer()` はこれを認識し `ModbusExceptionError`（例外コード付き）として投げるので、以前のように「無応答」と区別できないわけではない（`frameScan.ts`）。それでもプローブ側は**投げられたものすべてを「float ブロック無し」として扱う**のが正しく、`probeExtendedPrecision` の catch を例外種別で分岐させてはならない — 例外・無応答・1フレーム落ちのどれであっても結論は同じ Normal であり、分岐を入れれば「Extended に倒れる経路」を新設することになる。副作用として、例外を返すデバイスでは 3×100ms の沈黙を待たず即座に Normal が決まる
- 応答値は**有限であることまで要求する**。未実装レジスタが 0xFFFF 詰めで応答すると NaN にデコードされるが、フレームとしては妥当なので構造チェックだけでは通ってしまう
- 決まったモードは**ヘッダーと接続ステータスに必ず出す**（`i16t` / `f32t`、Auto 時は `(auto)` 付き）。自動判定が外した場合に、ユーザーが気づける場所が無いという状態を作らないこと

### ポーリング（`App.tsx`）
- **通信レートと記録レートは独立した2つの設定**（v4.1〜）。**この2つを再び1つのレートに戻さないこと**
  - **Polling Rate**（Connection Config、`POLLING_OPTIONS` = 25ms / 50ms / 100ms、既定 100ms）＝ 線上のポーリング周期。`setBackgroundTimeout` 再帰スケジュール。**接続中は変更不可**（`disabled={connected}`）— ループのスケジュール・読取りタイムアウト・リトライ予算がすべてここから導かれ、記録締切が乗るサンプルグリッド自体も動くため
  - **Save Rate**（Start Save の横、`SAVE_RATE_OPTIONS` = **200ms〜30分**、既定 1s）＝ **TSV へ書く周期だけ**。「N回に1回書く」で実現する。**接続中・保存中も変更可**（締切を張り直すだけで済む）
  - **チャート・IndexedDB・ビューア配信は保存周期ではなくポーリング側**。ただし**入力レートは `CHART_INPUT_INTERVAL_MS`(100ms) 固定**で、ポーリング回数のストライド（100ms→毎回 / 50ms→2回に1回 / 25ms→4回に1回、`plotStrideRef`）で落とす
    - 保存周期に合わせない理由：30分周期のログで画面が30分に1点しか動かなければ計測を見ていられない
    - ポーリングに追従させない理由：**チャートの入力レートが固定なら、負荷も軸も間引き計算も1つの前提の上に乗る**。入力 10Hz に対し再描画は `CHART_REDRAW_INTERVAL_MS`(500ms) = **2fps** なので、1回の描画に5点ぶん入る計算で、それ以上の点は個別には見えない — バッファ churn と、速いポーリング時は Modbus 転送の合間に挟まる間引き作業が増えるだけ。入力レートを再描画レートまで落とさないのは、チャートが**間引き前の点列**を持っていることに意味があるため（軸を Raw/Phy/Parameter に切り替えても再取得が要らない）。ポーリングを制御ループのために上げても表示コストが付いてこない、という性質がここで効く
    - **ストライドは締切ではなく単純なカウンタ**。読取り失敗で1回飛んでも 10Hz のトレースの位相が 100ms ずれるだけで、TSV の1行欠落とは重みが違う
  - **20ms は実機で保たなかったので 25ms にした**（v4.1 の実測）。Normal 精度では 1 サイクルの下限が「フレーム時間 + `minMessageIntervalMs`(最低 10ms)」で、38400bps・AI 16ch の i16 読みなら 11.7ms + 10ms ≒ 22ms — 20ms は構造的に入らない。25ms も余裕は数 ms しかない**最も端の設定**であり、遅いボーレートや応答の遅いデバイスでは保たない。読取りタイムアウトの下限 100ms も守れていないが、これは両者共通で 20/25 の差の原因ではない
  - **理由は FB 制御**。AO を叩くスクリプトは polling が更新した AI 値を読む。ここを保存周期に縛ると、「ディスクには1分に1点で十分だが制御は速く回したい」という真っ当な要求が「1分に1回しか入力が更新されない制御ループ」になる。ファイルサイズと制御品質は別の関心事
  - **Save Rate の下限 200ms はポーリングレートと無関係の固定値**。これ以上速く書いても読み返す人はおらず、行あたりのコストだけが計測ループの真ん中に落ちる。**この下限が最も速いポーリング周期より遅いことが、2つのリストを互いに独立にしている** — 200ms より遅いポーリングを足すならクランプが要る。**置き場所を Connection Config に戻さないこと** — ポーリングはデバイスに対して一度決めるもの、保存周期は計測ごとに選ぶもの
  - **記録の判定はポーリング回数のカウンタではなく「次に記録すべき時刻」(`nextRecordAtRef`)**。読み取り失敗やファイルピッカー中はポーリング自体が飛ぶため、カウンタ方式だと以降の全行の位相がずれ、失敗した回がたまたま N 回目だと**その行が丸ごと落ちる**。時刻締切なら遅れは最大1ポーリング周期で、位相は自動的に復帰する。判定は締切の半ポーリング周期手前から（締切に一番近いポーリングを選ぶため。1周期未満なので連続2回が同時に due になることはない）
  - 締切を **0 へリセット**（＝「次のポーリングを即記録」）するのは **計測開始時・切断時・保存開始/停止時・Save Rate 変更時**の4系統だけ
    - **`scheduleImmediatePoll` でリセットしてはならない**。これは `visibilitychange` からも呼ばれるため、30分保存中にユーザーが10回タブを切り替えると10行の余計な行が中途半端な位置に入る。締切は絶対時刻なので**凍結明けは放っておけば「期限切れ」として catch-up 節が張り直す** — 手当ては要らない（v4.1 で混入し修正）
    - **保存開始のリセットは `tsvWriterRef.current = writer` の直前に置く**。他のリセット群と一緒に上へ動かしてはならない — 間に `await dataStorage.clearAllData()` があり、ポーリング周期より長く掛かりうる。その隙間に来たポーリングがリセットを消費して締切を1保存周期ぶん進めてしまい、しかも `enqueueSaveUpdate` はまだ writer が無いので書かない。結果として**このリセットが防ごうとしている遅延（30分周期なら1行目が30分後）がそのまま再発する**（v4.1 で混入し修正）
  - 保存周期がポーリング周期の整数倍でない組み合わせでは、連続行が目標の前後へ1ポーリングぶん交互にずれる。**タイムスタンプは実測値なので嘘は無い**。なお**現行の選択肢では起こらない** — ポーリングは 25/50/100ms、保存は下限 200ms でどれも全ポーリング周期の整数倍になっている。どちらかのリストに整数倍でない値を足すときに効いてくる話として残してある
  - 読取りタイムアウト・リトライ可否（`canRetry`）は**ポーリング周期**基準。25/50/100ms ではリトライは常に無効になるが、1フレーム落ちの代償は「1回のポーリング」であって「1行の記録」ではないので、締切方式と合わせて実害はない
  - ヘッダー表示は `Polling: 実測ms` = **線上のレート**（未計測は `-`）。公称値を併記しないのは、隣に出しても選択肢を読み上げるだけだから。保存側の進捗は同じ行の点数カウンタが示す
  - ViewerStatePayload は `pollingIntervalMs` と `saveIntervalMs` の両方を返す（ビューアは両方を自分の選択肢へ引き当てる）
- **`pollOnce` は AI 読取りのみをブロック** — AO 書込みは `doAoWriteAsync` で非ブロック実行（起動は変更時の即時、上記参照）
- AI 読取り / AO 書込みそれぞれ独立のリトライレート制限（60s ウィンドウ）
  - **AI 側の上限はポーリング回数に比例させる**（`INPUT_READ_MAX_FAILURE_RATIO` = 10%、下限 `INPUT_READ_MAX_FAILURES_PER_WINDOW` = 10回）。固定10回はポーリング周期が保存周期に縛られていた時代の設計で、遅い設定なら10回貯まるのに数分かかった。10〜40Hz 固定になった今では**完全に死んだデバイスで1秒**で発火し、以後ウィンドウから失敗が抜けるまで全読取りをスキップする＝最大1分の空白、200ms 保存なら300行の欠落。**「応答しない」は回数ではなく割合**である。10% / 100ms なら 60回 ＝ 完全断で6秒後にバックオフ、数%のフレーム落ちでは発火しない（v4.1 で顕在化し修正）
- **IndexedDB 書き込みは fire-and-forget**（非保存時のみ。`flushPendingDataPoints` でバッチ書込み `addDataPoints`）
- **チャート表示は描画点数を抑制**（全データは TSV に全点記録、これは「画面表示」のみの話）:
  - 非保存時: 直近 `NON_SAVING_CHART_PREVIEW_POINTS`(768) 点のスライディングプレビュー（間引き無し・全点描画）。チャート入力レートが 100ms 固定なので **768 点 = 約77秒**であり、時間窓と同義。**点数で持つのは時刻窓より素直だから** — 切り捨てが splice 1回で済み、時計も走査も要らない。さらにフィードが止まったとき、時刻窓は勝手に空になって「最後にいくつだったか」すら消えるが、点数窓は次のデータが押し出すまで直近77秒を保持する
  - 保存時: 保存開始〜現在の全期間を `CHART_MAX_POINTS`(2048) へストライド間引き（`saveDecimationStrideRef`/`saveRawCounterRef`、バッファが `CHART_MAX_POINTS` 超で偶数 index 再間引き＆stride 倍化 → メモリ一定）
  - **再間引きのしきい値を `2 × CHART_MAX_POINTS` に戻さないこと**。2倍の余裕を持たせるとバッファは 2048〜4096 を往復し平均 3000 点になる（20Hz 非保存時の 1200 点の 2.5 倍）。これを4枚のチャートが毎秒数回 O(n) で再構築するため、**保存開始から数分で 20Hz が 17〜18Hz へ落ちて安定する**（v3.19 で観測・v3.20 で修正）。バッファが定常サイズに達した時点で劣化も頭打ちになるのが特徴的な症状
  - **再間引きで `chartEpoch`（purge + remount）を bump しないこと**。計測中に4枚を作り直すのは v3.1 で廃止した定期パージと同じ悪手で、しきい値を下げた分だけ発生頻度が上がる。purge が必要なのは WebGL コンテキスト蓄積の抑制だけなので、**接続時（チャートが空でタイミングが問題にならない唯一の瞬間）に1回だけ**行う
  - チャート再描画の最小間隔は保存中・非保存時とも `CHART_REDRAW_INTERVAL_MS`(500ms) の**1本**。以前は保存中だけ 500ms・非保存 200ms に分けていたが、768 点プレビューも1サンプルでは数ピクセルしか動かないので分ける根拠が無く、**2つの数字は考えることが2つ増えるだけ**だった
  - **再描画は「バッファに点が増えたフラッシュ」だけがタイマーを張る**（`bufferChanged`）。間引きストライドは保存が伸びるほど倍々になるので、新しい点は stride 1 なら 100ms 毎だが stride 64 では 6.4 秒毎になる — 一方フラッシュ自体は終始 10 回/秒で回る。無条件に張っていた頃は、計測後半で**1回の変化あたり十数回**、前回と同一のトレースを4枚描き直しており、その無駄は計測時間に比例して増え続けた。しかもそのコストは Modbus 転送の合間の主スレッドに落ちる。上の間隔は**周期ではなく下限**として残す（stride 1 の序盤は実際に 10 点/秒来るため）。結果として再描画レートは「点のレート」と「この下限」の**遅い方**になり、どちらの端でも空打ちが出ない
  - 共通上限 `CHART_MAX_POINTS`。`MAX_POINTS_IN_MEMORY`(256) は IndexedDB trim 専用
- ペンドデータポイントのバッチフラッシュ（5件 or 100ms ごと、表示バッファ更新と IndexedDB バッチ書込みを実施）
- **タイムスタンプは AI 読取り完了時刻（`lastAiReadCompletedAtRef`）を1つだけ使い、チャート・IndexedDB・TSV・レート表示すべてに同じ値を渡す**。`updateDataHistory` は Promise チェーンの継続として走るため、**その中で `Date.now()` を読んではならない** — 表示キューが捌けた時刻が記録され、レンダリング遅延が時間軸に混入する（v3.18 以前はチャート/IndexedDB と TSV で同じサンプルの時刻が食い違っていた）
- **表示系の state 更新には予算を設ける**（`READOUT_PUBLISH_INTERVAL_MS` = 実測レートと保存点数、`CHANNEL_CARD_MIN_INTERVAL_MS` = AI チャネルカード）。値そのものは ref で正確に持ち、React へ渡す頻度だけを絞る。1サンプルごとに setState すると **40枚のカードの再レンダリングが Modbus 転送の合間に挟まり、描画コストがそのままポーリングジッタになる**。カード側の絞りはポーリング周期が `CHANNEL_CARD_MIN_INTERVAL_MS`(100ms) より**速いときだけ**効くので、**Polling Rate = 25ms と 50ms の両方で**効き、既定の 100ms では効かない（100ms 自身は閾値と同じで絞られない）。**記録すると決めたサンプルのデータ経路（`updateDataHistory` 以降）は絞らないこと**
- `pageshow` / `visibilitychange` による復帰時即時ポーリング（`acquiring` 状態を ref で確認）
- USB 物理抜けの `disconnect` イベント自動検知
- **キャリブレーション変更時もポーリングは継続**（`aiCalibrationRef` で最新値を参照）
- **ステータス更新は ref 経由で直接 DOM を更新**（不要な React 再レンダリングを抑制）

### バックグラウンド時のタイマー抑制回避（`timerWorker.ts` + `utils/backgroundTimer.ts`）
- **計測経路のタイマーは必ず `setBackgroundTimeout` / `setBackgroundInterval` を使う**（ポーリングループ、`batchUpdateTimer`、TSV の `flushTimerRef`、`waitMs` のリトライ待ち、**`webserialClient.ts` のフレーム間隔待ちと受信タイムアウト**）。特に後者2つは `transfer()` のミューテックス内なので、抑制されると 10ms の最小間隔が最大1分の停止に化け、ポーリングだけ Worker 化しても意味がなくなる。Chromium は非表示ウィンドウのタイマーを 1Hz へ、さらに数分後には intensive throttling で **1分に1回**へ落とすため、`window.setTimeout` のままでは最小化した瞬間に 200ms 周期が「1分の欠測」に化ける
- 逆に**画面表示だけのタイマーは `window.setTimeout` のままにする**（保存経過時間、コピー完了表示、チャート再描画デバウンス、パネルの開閉アニメ）。見ていない画面の時計が止まっても誰も困らず、Worker 往復を足す意味がない
- **判定基準は「見ていない間に走りうるか」であって「計測ループの一部か」ではない**（v4.1 の棚卸しで2件漏れが見つかった）:
  - `webserialClient.ts` の `settleWithin()`（切断手順の各ステップ 1.5s ガード）。切断はユーザーがボタンを押すものだけではない — **ケーブルを抜けば `disconnect` イベントで走り**、それは最小化中にも起きる。`window` タイマーのままだと 1.5s が抑制後の1分に化ける
  - 残す判断をしたもの: `tsvExport.ts` の close タイムアウト（ハングした worker に対する最後の安全網であり、延びても壊れるものが無い）、ビューアの再接続バックオフ（そもそも指数バックオフで秒〜分のオーダー）
  - **例外として要検討で残っているもの**: `App.tsx` のリモートビューア向け全状態再送（1s、`window.setInterval`）。ホストウィンドウが見られていない間こそ動くべきもので、上の基準からすると Worker タイマーにすべき側。実害は「ホスト最小化中にビューアの全状態同期が 1s から最大 1分 に延びる」で、差分更新は別経路なので致命ではないが、**基準に合っていないことを承知で残してある**
- 仕組みはタイマーの**スケジュールだけ**を専用 Worker が持つ形（Worker のタイマーは抑制対象外）。コールバックは従来どおり主スレッドで走る。**ブラウザにページごと凍結された場合は救えない** — そこはスリープ抑制（下記）と Wake Lock の担当
- **バックエンドは可視状態で切り替える**（`pageVisible()`）。表示中は `window` タイマー（そもそも抑制されないので Worker 往復は純粋な損）、非表示になったら Worker。**この分岐を「常に Worker」に単純化しないこと** — `readChunk()` はフレーム1本につき USB チャンク数だけタイマーを取り直すため、20Hz では毎秒 60〜120 往復になり、実測で 20Hz が 16Hz まで落ちた（v3.17 の回帰）。非表示へ遷移した時点で生存中の `window` タイマーは Worker へ移し替える（delay は振り直しになるので、遷移1回につき最大1周期ぶん遅れる）
- Worker が落ちた場合は全 live タイマーを `window` タイマーへ張り直す（`fallBackToWindowTimers`）。残り時間は分からないので**元の delay で再スタート**する。1回遅れる方が、ループが二度と回らないより遥かにマシという判断
- id は自前カウンタで、ブラウザのタイマーハンドルとは別空間。**`window.clearTimeout` に渡さないこと**（必ず `clearBackgroundTimer`）
- exe 版はさらにブラウザ起動フラグ（`launcher/browser.ts`）で抑制自体を無効化している。**フラグと Worker は独立した対策で、片方だけでは全ケースを覆えない**ため両方残すこと

### 通知（`utils/notifications.ts` + `useNotifications.ts`）
- 通知の可否は**モジュールレベルの1箇所**（`utils/notifications.ts` の `enabled` + 許可状態）で判定する。`notify()` は Worker のメッセージハンドラなど React の外から呼ばれるため、React state をゲートにしないこと
- 対象は PyScriptRunner の開始 / 停止 / 完了 / エラーと、Python の `set_notify(msg)`。**通知した内容は必ず `scriptLog` にも書く**（通知 OFF や許可なしでも情報が消えないように）
- **許可要求は起動時に1回**（`useNotifications` の effect、トグル ON かつ `permission === 'default'` のときだけ）。計測は「開始したら人が離れる」使い方なので、失敗した瞬間に許可ダイアログを出しても誰も答えられない。拒否された場合はトグルを自動で OFF にして、UI と実態を合わせる
- **通知は tag で潰す**（`NOTIFY_TAG`）。`while True:` の中の `set_notify()` でデスクトップが埋まらないようにするため。連投は「最新1件が残る」挙動になる
- 表示経路は SW 登録があれば `registration.showNotification`、無ければ `new Notification`（Android は前者必須、launcher は SW 非登録なので必ず後者）
- UI は **Application Info パネルのトグル1つだけ**。通知専用パネルやメニュー項目を作らないこと（設定が1個しかない）

### UI 拡大率（`utils/uiScale.ts`）
- **OS のスケーリング倍率はブラウザから取得できない**。唯一の候補である `devicePixelRatio` は「OS のスケーリング」「ブラウザ自身のズーム」「パネルの物理 DPI」の3つを掛けた値であり、1.25 が Windows 125% なのか Chrome 125% なのか 1.25x パネルなのか区別できない。**ここから自動で拡大率を決めてはならない** — ブラウザが既に OS スケーリングを反映している環境（＝ほぼ全て）で二重適用になる。倍率はユーザーが選ぶ（**Menu パネルのヘッダー**の `[-] [100%] [+]`、50〜200% の 11 段）
- **置き場所は Menu のヘッダー**（v4.1〜。以前は Application Info の中）。テーマトグルと並ぶ。理由は2つ — 「見ながら合わせる」設定なのに、開くとページが隠れるパネルの奥にあっては使えない。もう1つは Menu の行はすべて「パネルを開く」動作なので、その場で値を変える操作は行ではなくヘッダーに置くのが筋。ヘッダーには説明を置く余地が無いが、`[-] [%] [+]` は説明不要で、押せば結果がその場で見える
- 実装は **`#root` への CSS `zoom`**（`index.css`、値は `<html>` の `--ui-scale`）。`transform: scale()` ではない: `zoom` はレイアウトに参加するので拡大後のサイズで再フローしスクロール範囲も正しくなるが、transform は同じレイアウトを大きく描くだけで右端が画面外に出たまま届かなくなる。対応は Chrome/Edge/Safari 全て・Firefox 126+（Win/mac/Linux/Android で本アプリが動く全ブラウザ）
- **ページ背景と全画面ボックスは `<body>` に置く**（`index.css`）。`#root` の内側で `min-h-screen` を書くと 100vh が**ズーム後の座標系**で解決され、125% では画面より 1/4 高い箱になって空のページにスクロールバーが出る
- **ズーム内側の座標を扱うコードは補正が要る**。`window.innerWidth/Height` は非ズームの CSS px、`FloatingWindow` のジオメトリはズーム内側の px なので、クランプ側で `getUiScale()` で割る。ドラッグ量も同様にずれるため `Rnd` に `scale` を渡す（Plotly は `_invScaleX/Y` で自前に補正するので不要）
- 拡大率の変更後は **1フレーム置いて `resize` イベントを投げる**（`setUiScalePercent`）。Plotly はグラフ div の実測幅からキャンバス寸法を決め、再測定の契機は window の resize だけなので、これが無いと次に窓を動かすまで古い寸法のまま残る
- 拡大率は **`writeLocalPreference`** で保存し、`main.tsx` が **React の描画前**に `initUiScale()` で適用する（mount 後に戻すと 100% の1フレームが見えてページ全体が再フローする）

### PyScriptRunner（`pyodideWorker.ts`）
- Pyodide v314（Python 3.14）を**セルフホスト**でロード（Web Worker 内・CDN 非依存）
  - `vite.config.ts` の `pyodide-assets` プラグインが npm パッケージから必要ファイル（`PYODIDE_FILES`）を `dist/pyodide/` へコピー。`precache-manifest` より前（`writeBundle`）に走るためプリキャッシュへ自動的に含まれ、**完全オフライン動作**する。dev では同プラグインの middleware が `/pyodide/` を node_modules から直接配信
  - バージョンは **`package.json` の `pyodide` 依存（現在 `^314.0.3`）が一次情報源**。アセットは `node_modules` の実インストール版からコピーされるためバージョンずれは構造的に起きない。URL 直書き・他ファイルへのバージョン直書きは禁止。`AppInfoPanel.tsx` の表示は `VITE_PYODIDE_VERSION`（vite.config.ts の define で注入）経由で自動同期。更新時は README のみ手動同期
  - v314.0 以降は **module worker 必須**（classic worker 非対応）。本 Worker は `{ type: 'module' }` で生成済み
- `SharedArrayBuffer` 経由で AI データを Worker と共有（**Float32Array**）
- **SAB は Worker 生成と切り離して mount 時に先行確保する**（`useScriptRunner` の `ensureShares()`）。SAB は Worker 専用のデータ経路ではなく、ポーリングループが毎周期書き込み、Worker が同じメモリを読み書きするため。Worker（重い方）の遅延生成は維持
- `set_ao()` でメインスレッドへ AO 制御命令を postMessage
- `set_notify(msg)` は `{ type: 'notify' }` を送るだけで、通知するかどうかはメインスレッドが決める（上記「通知」）。Worker から `Notification` を触らないこと
- `SharedArrayBuffer` による割込み停止（`interruptBuffer[0] = 2`）
- **COOP/COEP ヘッダー必須**（`SharedArrayBuffer` 利用のため）
- Worker init 失敗時は `initPromise` をリセットし再試行可能。メインスレッドは `init` を Worker 生成時に1度しか送らないため、Worker 側は `initArgs` を保持して `run` 受信時に**自力で再 init する**
- **stdout/stderr は `pyodide.setStdout/setStderr`（batched）でメインスレッドへ転送する**（`{ type: 'output' }`）。Worker のコンソールはページの devtools に既定では出ないため。エラー時は `{ type: 'error', message, traceback }` で**要約1行と完全なトレースバックの両方**を送る（ステータス表示は要約、ログはトレースバック）
- **実行結果は `useScriptRunner` の `scriptRun`（`ScriptRunInfo`）と `scriptLog` に記録する**。ログは実行開始時にクリアし直近 300 行（`SCRIPT_LOG_MAX`）を保持。両者は **ref にもミラーする**（Worker のメッセージハンドラは React のレンダリング外で走るため、state だけでは直前の失敗を取り逃す）
- **`pyodide.setInterruptBuffer()` は init の最後に呼ぶこと**。Pyodide は `runPython()` のたびに割込みバッファを見るため、Pyodide ロード中に Stop された状態（`interruptBuffer[0] === 2`）で先に arm すると `RUNNER_SETUP` 実行時に KeyboardInterrupt が飛び、**init 自体が失敗して Worker が再起動まで使えなくなる**

### 多重起動抑制・スリープ抑制（`launcher/singleInstance.ts` + `launcher/keepAwake.ts`）
- **多重起動抑制はループバックポート（8764）の bind**。ロックファイルにしないのは、プロセスが死ねば OS が必ず解放するため（クラッシュや強制終了で「起動できない exe」が残らない）。2つ目のインスタンスはメッセージボックスを出して **exit(0)** で終わる（ユーザーが欲しかったアプリは動いているのだから失敗ではない）
- ポートが埋まっていても**それが自分たちのロックか確認してから諦める**（`LOCK_MARKER` を返すかどうか）。無関係なソフトが 8764 を握っているだけで起動不能になる方が、二重起動より重大な障害のため
- ロックは**他の一切より先に取る**（サーバー bind もブラウザ起動もしない状態で判定する）
- **スリープ抑制は launcher プロセスの `SetThreadExecutionState`（`bun:ffi` で kernel32 を直接呼ぶ）**。`ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED` を立て、解除は `ES_CONTINUOUS` 単体。実行状態はスレッド単位なので、**プロセスが生きている限り生きている launcher の主スレッドから呼ぶこと**
- **要求を出すのはページ**（`__feed` の `keepawake` フレーム。`acquiring || scriptRunning` で判定）。launcher 側の常時 ON にしないこと — アプリを開いているだけのノート PC を一晩中起こしておくことになる。ページが切れたら `hostFeed.detach` で必ず解除し、再接続時はページが状態を送り直す（`keepAwakeRef`）
- ページ側の Wake Lock（`requestWakeLock`）は**表示中しか効かない**（非表示になるとブラウザが解放し、戻しても自動復帰しない）ため、`visibilitychange` で取り直している。最小化状態を守れるのは exe 版の OS 要求だけ、という役割分担
- Windows 専用。Linux の抑制はセッションのインヒビタ（logind / GNOME / KDE）依存になるため実装しない（exe は Windows 成果物）

### リモート監視（`launcher/viewerServer.ts` + `viewerHub.ts` + `hostFeed.ts` + `useViewerFeed.ts`）
- **デスクトップ版（exe）限定・既定 OFF**。ホストページの Remote Monitoring パネルのトグルで起動し、他 PC のブラウザから**閲覧のみ**できる
- **サーバーは2本に分ける**。アプリサーバー（`127.0.0.1`・ランダムポート）はハードウェアを持つホストページ用で `__feed`（監視アップリンク＋公開トグル）を持つ。ビューアサーバー（`:8766`）は静的アセットと push 専用の `__viewer` しか持たない。**アプリサーバーは 127.0.0.1 のままにすること**
- **公開方法は2モード**（`ViewerMode`）。`lan` は `0.0.0.0` を bind して LAN から直接（インターネット不要）、`tunnel` は `127.0.0.1` のみ bind し Cloudflare Quick Tunnel（`tunnel.ts`）が HTTPS で公開する。**tunnel モードでは LAN に何も listen していない**（cloudflared がローカルに繋ぐだけ）。モード切替は必ずサーバーを作り直すこと（bind 先が違うため使い回せない）
- **read-only はトランスポートの性質であって UI の性質ではない**。ビューアが受け取るバンドルはホストと同一の JavaScript なので、ボタンを隠すことは根拠にならない。`viewerServer.ts` の `websocket.message` は**意図的に空**で、ビューアが送るフレームは一切パースされない。ここを実装で埋めないこと
- **アクセス範囲は CIDR で先に切る**（`viewerServer.ts` の `ALLOWED_CIDRS`・モード別）。`tunnel` はループバックのみで、範囲外はパスに関係なく 403（ポートの背後に何があるか漏らさないため）。**`lan` は IPv4 を全許可（`0.0.0.0/0`）**：大学・研究室ネットは各台がグローバル IP を持ち `157.82.159.64/26` のような小さいサブネットに切られていることがあり、Tailscale の仮想 NIC は CGNAT の /32 として見えるため、**自ホストの NIC からサブネットを導出しても全ピアを弾いてしまう**。実利用ネットで誤判定するレンジチェックは、無いより悪い（守っていないのに守っているように読める上、機能が黙って壊れる）。この モードの境界はトークンであって IP ではない。したがって `lanViewerUrls()` もフィルタせず、全 NIC の IPv4 を並べる（APIPA `169.254.0.0/16` のみ除外＝そもそも到達不能）
- **`?k=` トークンは全パスを守る**（HTML も含む）。tunnel モードでは URL が公開インターネット上にあるため、無権限の訪問者に「これが Modbus ロガーである」ことすら見せない。ただしトークンが URL に要るのは**最初の1リクエストだけ**で、以降は `HttpOnly` Cookie（`msl_viewer`）が代理する — 全アセットに `?k=` を付けるにはバンドル内の URL を書き換える必要があり、ページ内にトークンを埋めれば DOM から読めるものになってしまう。Cookie は tunnel モードでのみ `Secure`（LAN は平文 HTTP なので付けると落とされる）。トークンはプロセス起動ごとに再生成され、古いリンクと古い QR は自然に失効する
- **`serveStatic` の `/` リダイレクトに `Response.redirect()` を使わないこと**。返るレスポンスはヘッダーが immutable で `Set-Cookie` を追加できず、かつクエリを落とすためトークンが消える
- **ホストは pull されない**。送信はチャート flush（`flushPendingDataPoints`）の副作用で、送るのは**実際にプロットした点だけ**（Save 中は間引き後）。したがって帯域はサンプリングレートではなくチャート予算で決まり、100Hz 計測が 100Hz のソケットにならない。ビューアが増えても取得ループの負荷は変わらない
- **トンネルは Cloudflare Quick Tunnel**（`tunnel.ts`）。cloudflared のバイナリは `bun build --compile` で exe に埋め込むため、実行 PC に何もインストールされていなくても動く。**Tailscale は採用不可** — `tailscale.exe` は単体では動作せず `tailscaled` デーモン＋TUN ドライバ＋アカウントログインが必要で、同梱＝インストーラ同梱になる。cloudflared の Quick Tunnel はアカウント不要なので「QR を撮れば開く」が成立する
- **cloudflared はビルド時に取得しハッシュ検証する**（`fetch-cloudflared.ts`）。バージョンと SHA256 を固定すること: 「latest」を引くと同一コミットのビルドが再現しなくなり、**埋め込んで実行するバイナリ**をネットワーク任せにすることになる。取得は `build.ts` の先頭で行う（`tunnel.ts` の静的 import がビルド時にファイルの存在を要求するため）
- **埋め込みバイナリは temp へ実体化してから spawn する**。コンパイル済み exe の中では仮想パスであり、そのままでは exec できない。ファイル名にバージョンを含めて、古いビルドの残骸を拾わないようにすること
- **コンソールアプリを spawn するときは必ず `windowsHide: true`**（`tunnel.ts`・`main.ts` の `fatal()`）。ランチャーは GUI サブシステム（`build.ts` が PE を patch）なので、コンソールサブシステムの子プロセスを起こすと Windows が**空のターミナルウィンドウを表示する**。見た目の問題では済まず、**そのウィンドウを閉じると cloudflared が死んでリンクが黙って切れる** — 利用者にはアプリの一部だと分からないため説明もできない。検証は「GUI サブシステムの親から、コンソールを継承しない形で（Explorer 経由で）起動し、可視トップレベルウィンドウの増減を見る」こと。親をターミナルから起動すると**子が親のコンソールを継承してしまい再現しない**
- **cloudflared が自分で死んだら公開状態を畳んで page に伝える**（`onUnexpectedExit` → `main.ts` の `onTunnelLost`）。URL も QR も死んでいるのに「running」を表示し続けるのは、止まったと言うより悪い。意図的な `stop()` と外部要因の死は区別すること（`stopping` フラグ）
- Quick Tunnel は**アカウント無し・稼働保証無し・毎回ランダムなホスト名**。最後の性質はここでは利点で、トークンと同じく古いリンクを自動失効させる。UI にはこの制約を明示すること
- ラベル・キャリブレーション・電圧モード・ヘッダー状態は**1秒周期でまるごと再送**（差分を取らない）。この頻度で差分計算をするより安く、途中参加のビューアが1フレームで完全な状態を得られる
- 途中参加用に `viewerHub` が直近 2048 点（`CHART_MAX_POINTS` と同値）のバックログを保持する。**ビューアのチャートは「直近 N 点」でホストの「全区間を間引いた図」とは一致しない** — 完全な記録はホストが書く TSV であり、この差は仕様
- ビューア側の受信は**ホストと同じ `pendingDataPoints` → `flushPendingDataPoints` を通す**（描画経路を二重に持たない）。`flushPendingDataPoints` の viewer 分岐は IndexedDB 書込みを行わない（監視は記録ではない）
- **ビューアでは設定を永続化しない**（`utils/cookies.ts` の `writeJsonStorage` が `isViewerMode` で no-op）。ホストのラベル・キャリブレーションが毎秒流れてくるため、閲覧している PC 自身のロガー設定を上書きしてしまう。ゲートは各呼び出し側ではなくこの1箇所に置くこと
  - **例外は「その画面の見え方」だけ**（テーマ・UI 拡大率）。これらは `writeLocalPreference` を使いビューアでも保存する — ホストのフィードが一切書かない値であり、監視用の空きモニタこそ拡大率やテーマを直したい場所だから。**計測に関わる値をこちらへ移してはならない**
- **ホストから来た `voltageConfig` は `sanitizeVoltageConfig()` を通す**（`as VoltageMode[]` のキャストで受けない）。ホストが別バージョンの本アプリであることは普通にあり、この build に無いモードが届くと `rawToDisplayValue()` が `undefined` を返して次のフレームでチャンネルグリッドごと落ちる

### データ保存
- **IndexedDB**: セッション中の全データポイントを蓄積（`keepLatestPoints` で自動トリム）
  - `init()` は冪等（複数回呼び出し安全）
  - `StoredDataPoint` に `seq` 連番を付与（重複検出・TSV 整合性）
- **TSV**: File System Access API（`showSaveFilePicker`）でストリーミング書き出し。**整形・バッファ・`join()`・`write()` は `tsvWriterWorker.ts`（Web Worker）が担当**し、主スレッドには `showSaveFilePicker()` のユーザージェスチャだけを残す（高サンプリング時のフラッシュヒッチ回避）
  - 列順は `timestamp` / `ai_raw_*` / `ai_phy_*` / `ai_vlt_*` / `ao_raw_*` / `par_*`（AI 系3ブロックが隣接）。**`seq` 列は無い**（`seq` は IndexedDB の `StoredDataPoint` 専用）
  - フラッシュは `TSV_FLUSH_MAX_ROWS`(500行) と `TSV_FLUSH_INTERVAL_MS`(60s) の**早い方**
  - 浮動小数列は `parseFloat(v.toFixed(physicalPrecision))` で丸め＋末尾ゼロ除去（ファイルサイズ削減）。`ai_raw_*` は Normal（i16）では `toString()` の整数、Extended（f32）では init の `aiRawAsFloat` により浮動小数フォーマッタを通す
  - `Float32Array` / `number[]` の両方を受け付ける
- **OPFS クラッシュリカバリ**（`utils/opfsRecoveryShared.ts` + `opfsRecovery.ts` + `tsvWriterWorker.ts`）: ピッカーで選んだファイルは `FileSystemWritableFileStream` がスワップファイルへ溜め、`close()` で初めて実体へ swing する。つまり **Stop Save まで対象ファイルは 0 バイト**で、途中でクラッシュすると全損する。そこで全行を OPFS へも同期追記する（`createSyncAccessHandle()` は OPFS 限定・Worker 限定・スワップ無し・追記可能）
  - **ダーティビットは「ミラーファイルが存在すること」そのもの**。別フラグは持たない — クラッシュとは2つの書込みが食い違いうる瞬間そのものであり、この機能が絶対に許容できないのは「別の run の名前や時刻を持つ復旧ファイル」だから。メタデータ（元ファイル名・開始時刻）も**ミラー自身のファイル名にエンコードする**（サイドカーや localStorage にしない）。正常な Stop Save が消すので、起動時に残っているものは定義上「終わらなかった run」
  - ミラーは**ストリームとは別のバッファ・別のタイマー**（`TSV_MIRROR_FLUSH_INTERVAL_MS` = 1s / `TSV_MIRROR_FLUSH_MAX_ROWS` = 100行）。ストリーム側の 60s に相乗りすると**毎 run の最初の1分間ミラーが空**になり、クラッシュリカバリが最も評価される窓がまさに穴になる
  - ヘッダーは最初の1行が来るまで保留する（`mirrorPendingHeader`）。0行の run は 0 バイトのまま残り、起動時に無言で掃除される
  - **ミラーの失敗は絶対に致命傷にしてはならない**。worker → main の `'error'` は init ハンドシェイクを reject して worker を terminate するため、ミラー関連は必ず **`'warning'`** で送ること。`'error'` で送っていた頃は、OPFS が使えない環境で**保存そのものが開始できなかった**（守るはずのデータを守るために失わせていた）
  - **復旧は起動時の `confirm()` → ダウンロード**。`showSaveFilePicker()` は使えない（起動時に transient user activation が無く、confirm の解除でも付与されない）
  - **1回の起動で提示するのは1件だけ**。activation の無い `<a download>.click()` は2件目から Chromium の「複数ファイルの自動ダウンロード」ブロックに掛かるため、ループで回すと2件目以降が黙って落ちたまま「ダウンロードしました」と表示して削除を促すことになる。残りは次回起動で提示する
  - **ダウンロード完了は観測できない**（`<a download>` は完了イベントを持たない）。したがって削除確認は「送信しました」と断定せず、**ユーザーがファイルを確認してから OK** を押す文言にすること。click() 直後はまだ OPFS から読み出し中であり、そこで `removeEntry()` すると救出中のファイル自身を切り落とす
- **復旧ファイル名は `<stem>_recovered<ext>`**（`recoveredDownloadName()`、v4.1〜）。元の名前のまま返してはならない — 復旧ファイルは「その run が本来出すはずだったファイル」ではなく**クラッシュが残した残骸**であり、ページが死んだ時点でバッファに載っていた行を欠いている可能性がある。元の名前でダウンロードフォルダに置くと正常な保存と見分けが付かず、**そもそも run が失敗したこと自体に気付けない**。OPFS 側のエントリ名は `buildRecoveryName()` のまま（あちらはパースされる名前、こちらは人間だけが読む名前）
- **2つの `confirm()` で Cancel の意味は逆**（v4.1〜）。1つ目（提示）の Cancel は**ミラーを削除する** — 名前・開始時刻・サイズを見た上で「要らない」と答えたのだから、起動の度に同じ死んだ run を出し続けるのはデータ保護ではなく催促である。2つ目（削除確認）の Cancel は**保持する** — こちらの Cancel は「ダウンロードが届いていない」の意であり、消せば救出対象そのものを壊す。**この非対称を「一貫性」を理由に揃えてはならない**。どちらもダイアログ本文に Cancel の挙動を明記すること
- **設定永続化**: **localStorage** に JSON 保存。`utils/cookies.ts` の `readJsonStorage` / `writeJsonStorage` / `writeLocalPreference` が唯一の出入口。キー一覧は `theme_preference_v1`・`ui_scale_v1`・`chart_axes_v1`・キャリブレーション・`voltage_config_v1`・`ai_free_labels_v1` / `ao_free_labels_v1` / `param_free_labels_v1`・`notificationsEnabled`・`scriptRunnerCode` / `scriptRunnerCodeBackup`・`ai_collapsed` / `ao_collapsed` / `param_collapsed`
  - **Cookie は書き込みのフォールバック兼旧値の移行元**。`localStorage.setItem` が投げる環境（オリジンのサイトデータをブロックした Chrome、Safari プライベートのクォータ超過）では**素のキー**の Cookie へ退避する。したがって**読み側も必ず Cookie を見ること** — `readJsonStorage` が localStorage しか読んでいなかった頃は、この退避が書き込み専用になり、フォールバックが存在する理由そのものの状況で UI 拡大率・PyScript のコード・折りたたみ状態が毎回消えていた（v4.5 で修正）
  - Cookie からの自動移行機能付き（読込時に localStorage へ移行し Cookie を削除）。**削除は移行が成功したときだけ**行うこと — ビューアでは書込みが no-op、localStorage 不通時は Cookie 自身がフォールバック先なので、無条件に消すと設定が消える
  - Cookie は**書込み不能時のフォールバック**でもある（localStorage が throw した場合のみ・3.5KB 未満のみ）。常時ミラーはしない: launcher の HTTP サーバーへ毎リクエスト送出されることになるため

### PWA / Service Worker
- `sw.js` は全レスポンスに COOP/COEP ヘッダーを注入
- **プリキャッシュ（オフライン対応の要）**: install 時に**全ビルドアセット**（ハッシュ付き JS/CSS バンドル・Pyodide ワーカーチャンク・**Pyodide ランタイム一式（`pyodide/` 配下 約13MB）**・`index.html`・`manifest.json`・`icon.svg`）をキャッシュ。これによりオンライン初回訪問（＝SW install 完了）以降は PyScriptRunner 含め完全オフライン動作。
  - プリキャッシュ一覧は **`vite.config.ts` の `precache-manifest` プラグイン**がビルド時に `dist/sw.js` へ注入（`const PRECACHE_MANIFEST = [];` を実ファイル一覧へ置換）。手書き禁止
  - `CACHE_VERSION` も同プラグインがマニフェスト内容のハッシュへ置換（`'dev'` → 8桁ハッシュ）。デプロイ毎に新キャッシュへ切替わり旧キャッシュは activate で削除
  - 未ビルドの `vite dev` ではプレースホルダのまま（空配列／`'dev'`）。dev は base が `/` で BASE_PATH 不一致のため SW は実質無効、問題なし
- ナビゲーション: Network-first + キャッシュフォールバック
  - キャッシュ保存時に `request` と `BASE_PATH + 'index.html'` の両方に保存（キー不一致防止）
- 静的アセット: Stale-While-Revalidate（プリキャッシュ済みアセットの裏での更新用。オフライン時はプリキャッシュから配信）
- `vite.config.ts` の `server.headers` / `preview.headers` でも COOP/COEP を設定
- **SW 更新はユーザー承諾ゲート**（計測中断防止・バージョン固定）: `sw.js` の install は `skipWaiting()` を呼ばず、新 SW は **waiting に留まる**（旧バージョンが旧キャッシュのまま配信継続）。`utils/swUpdate.ts` は `window.confirm()` 承諾時のみ `SKIP_WAITING` を送信（無確認の自動適用経路は存在しない）→ activate（旧キャッシュ削除）→ `controllerchange` で無条件リロード。辞退時は waiting のまま保持され、次の明示チェックで再確認される。プロンプトのバージョン表示（`vX → vY`）は waiting ワーカーへの `GET_VERSION` メッセージで取得（500ms タイムアウト。旧ビルドの SW は非応答のためバージョン無し表示へフォールバック）。**activate 後の controllerchange で confirm してはならない**（その時点で旧キャッシュは削除済みのため、拒否すると未読込アセットの取得が壊れる）
- **確認ウィンドウは明示チェック限定**（計測中の割り込み禁止）: `confirm()` を出せるのは **起動直後のチェック**と **Application Info の「Check for Updates」ボタン**だけ。両者は同じ `checkForAppUpdate()` を呼ぶ（挙動は完全に同一）。判定は `explicitCheckRunning` フラグ（明示チェックの `registration.update()` 実行中のみ true）で行い、`updatefound` はこのフラグが立っているときだけ prompt 対象として adopt する。**セッション中に勝手に確認ウィンドウを出す経路を追加してはならない**
- **Connect 中は更新チェック自体を停止**: `App.tsx` が `connected` を `setUpdateChecksSuspended()` へ流し、定期チェック・明示チェックの**両方**が no-op になる（`checkForAppUpdate()` は `'suspended'` を返し、Application Info のボタンは disabled）。更新適用＝リロード＝ポート切断・計測停止のため、接続中は確認する意味がない
- 定期 update チェック（60秒 `setInterval`）は**サイレント**: 見つかった新 SW はプロンプト無しで install → waiting に留まる（次の明示チェックがダウンロード待ちなしで提示できる）。`setInterval` は `pagehide` でクリーンアップ
- 明示チェックの結果（`UpdateCheckResult`）は Application Info 内にテキスト表示のみ（別ウィンドウは出さない）。`registration.installing` が既に走っている場合はそれを adopt し、完了時にプロンプトする

### Float32 内部表現
- `DataPoint.aiRaw` / `aiPhysical` / `aiVoltage` は `Float32Array`
- Modbus ADC 最高精度 ≈ 22bit < Float32 仮数部 24bit → 精度ロスなし
- メモリ使用量: 65,536点時に約 **8MB 節約**（128B → 64B / チャネルセット）
- Plotly.js は `Float32Array` をそのまま描画可能
- TSV 書き出しは `Float32Array` のまま Worker へ structured clone で渡す（**転送リストを使わない** — 呼び出し側の配列はチャート表示と共有されており neuter してはならない）。`Array.from()` 変換は行わない

## 主要定数（`src/constants.ts`）

| 定数 | 値 | 説明 |
|------|------|------|
| `AI_CHANNELS` | 16 | AI チャネル数 |
| `AO_CHANNELS` | 8 | AO チャネル数（GP8403） |
| `PARAM_CHANNELS` | 16 | Parameter（スクラッチ値）チャネル数 |
| `AI_START_REGISTER` | 0 | AI Input Register 開始アドレス（Normal） |
| `AI_FLOAT_START_REGISTER` | 5000 | AI Input Register 開始アドレス（Extended） |
| `AO_START_REGISTER` | 0 | AO Holding Register 開始アドレス |
| `RETRY_DELAY_MS` | 10 | Modbus 通信リトライ前の待機時間 |
| `INPUT_READ_RETRY_WINDOW_MS` | 60000 | AI 読取りリトライ制限の評価ウィンドウ |
| `INPUT_READ_MAX_FAILURES_PER_WINDOW` | 10 | ウィンドウ内 AI 読取り最大失敗回数 |
| `OUTPUT_HOLDING_RETRY_WINDOW_MS` | 60000 | AO 書込みリトライ制限の評価ウィンドウ |
| `OUTPUT_HOLDING_MAX_FAILURES_PER_WINDOW` | 10 | ウィンドウ内 AO 書込み最大失敗回数 |
| `MAX_POINTS_IN_MEMORY` | 256 | 非保存時の IndexedDB 保持点数（trim 専用） |
| `CHART_MAX_POINTS` | 2048 | チャート描画点数の上限（保存時ダウンサンプル目標）。v3.1 で 1024→2048 |
| `NON_SAVING_CHART_PREVIEW_POINTS` | 768 | 非保存時チャートのプレビュー点数（×100ms ≒ 77秒） |
| `BATCH_FLUSH_THRESHOLD` | 5 | バッチフラッシュのペンド件数閾値 |
| `BATCH_FLUSH_INTERVAL_MS` | 100 | バッチフラッシュの最大遅延 |
| `CHART_REDRAW_INTERVAL_MS` | 500 | チャート再描画の最小間隔（保存中・非保存共通。周期ではなく下限） |
| `TSV_FLUSH_MAX_ROWS` | 500 | TSV フラッシュを起こすバッファ行数 |
| `TSV_FLUSH_INTERVAL_MS` | 60000 | TSV 定期フラッシュ間隔（低レート時の耐久性フォールバック） |
| `KEEP_LATEST_TRIM_INTERVAL` | 10 | IndexedDB trim を実行する書込み回数間隔 |
| `PROMISE_CHAIN_RESET_INTERVAL` | 100 | Promise チェーンをリセットする回数間隔 |
| `TSV_MAX_BUFFERED_ROWS` | 20000 | writer バッファの上限行数。書込みが成功するまで行を捨てないので、失敗し続けるストリームに対する歯止め。超過分は最古から破棄しデータ損失として報告する |
| `TSV_MIRROR_FLUSH_INTERVAL_MS` | 1000 | OPFS ミラーの追記間隔（ストリームとは独立。起動直後の空ミラーを避けるため） |
| `TSV_MIRROR_FLUSH_MAX_ROWS` | 100 | 同・行数キャップ |
| `CHART_INPUT_INTERVAL_MS` | 100 | チャートへの入力レート（固定。ポーリング回数のストライドで実現） |
| `CHANNEL_CARD_MIN_INTERVAL_MS` | 100 | AI チャネルカードの state 更新下限。ポーリングがこれより速いときだけ絞りが効く |
| `READOUT_PUBLISH_INTERVAL_MS` | 250 | 実測レート・保存点数を React へ渡す間隔 |
| `INPUT_READ_MAX_FAILURE_RATIO` | 0.1 | AI 読取り失敗予算をポーリング頻度に比例させる係数（下限は `INPUT_READ_MAX_FAILURES_PER_WINDOW`） |
| `PRECISION_PROBE_TIMEOUT_MS` | 100 | 精度プローブ1回の読取りタイムアウト |
| `PRECISION_PROBE_ATTEMPTS` | 3 | 精度プローブの試行回数（全滅で初めて Normal） |
| `PRECISION_PROBE_CHANNELS` | 2 | 精度プローブで読む先頭チャネル数 |

**UI の選択肢配列はこの表とファイルの対象外**: `POLLING_OPTIONS` / `DEFAULT_POLLING_RATE_MS` / `SAVE_RATE_OPTIONS` / `DEFAULT_SAVE_RATE_MS` / `BAUD_OPTIONS` / `AO_FULL_SCALE_MV` は `App.tsx` にある。`constants.ts` は「挙動を決めるチューニング値」を持つ場所で、ドロップダウンの中身は UI の一部として使う側に置いてある。下の「定数の一元化」ルールはこの区別を前提にしている。

## 変更時の注意

- 通信方式は「Web Serial API」を基準に記述する（WebUSB は polyfill 経由のフォールバック）
- PyScriptRunner は COOP/COEP が必須。`sw.js` と `vite.config.ts` のヘッダー設定と整合させること
- **Plotly はカスタム最小バンドル**（`src/plotly.ts`）。`plotly.js/lib/core` + `scattergl` トレースのみを登録し `react-plotly.js/factory` でコンポーネント化する。フル `plotly.js`（3D・地図・全トレース）を import すると本番バンドルが数 MB 肥大化するため禁止。チャートが `scattergl` 以外のトレースを使う場合のみ `src/plotly.ts` に登録を追加する
- **`scattergl` は性能上の選択ではなくデータモデル上の必然**。X 軸は `time` 以外に任意チャネル（`raw_*`/`phy_*`/`par_*`、計49種・`App.tsx` の `axisOptions`）を選べ、ひずみ-応力の繰り返しヒステリシスループのような **x が非単調・非一意のパラメトリック曲線 (x(t), y(t))** を描く。scatter トレースは点列を**配列順に結線**するためこれを表現できるが、一般的な line チャートは y = f(x) を前提に **x 昇順ソートを要求**する。チャートライブラリを差し替える場合、**scatter 相当のパラメトリック描画モデルを持つことが絶対条件**であり、これを満たさない uPlot（x は数値・一意・昇順が必須）・dygraphs・TradingView Lightweight Charts・TimeChart は**どれだけ軽量でも採用不可**。詳細と比較は `docs/chart-library-comparison.md`
- **`hoverinfo: 'skip'` + `hovermode: false` を外さないこと**（`ChartPanel.tsx`）。scattergl はホバー判定用の空間インデックスを毎更新で構築し、そのコストは `CHART_MAX_POINTS` に比例する。本アプリは `hovertemplate` も `onHover`/`onClick` も使っていないため純粋な無駄であり、これを止めた前提で `CHART_MAX_POINTS` を 2048 に上げている。**ホバーでの値読みを復活させる場合は `CHART_MAX_POINTS` を 1024 に戻すこと**
- **WebGL コンテキストは明示的に解放する**（`ChartPanel.tsx` の `releaseWebglContext`）。`Plotly.purge()`（react-plotly.js がアンマウント時に呼ぶ）は scattergl の WebGL コンテキストを破棄しない（plotly.js #2852 / #6365、後者は未解決）。解放しないとチャート差し替えのたびにコンテキストが増え、ブラウザ上限（概ね 8〜16）に達した時点で**古いチャートが黙って描画を停止する**。v3.1 以前にあった定期パージ（15分ごとの remount）はこの問題を悪化させるだけだったため廃止した。**「GPU 状態が溜まるから定期的に作り直す」という対策を再導入しないこと**
- **チャート間引きは描画モードで手法を変えること。** 時系列モード（X=time）は 1px ごとの **min/max 間引き**が使え、描画コストを O(点数)→O(ピクセル幅) に落としつつ尖頭値を保存できる。**XY パラメトリックモードでは min/max は使用不可** — 同一 x に往路と復路の異なる y が乗るため、列ごとの集約はループ形状（囲む面積＝散逸エネルギー）を破壊する。XY では連続ピクセルセル重複除去や RDP を用い、**周回ごとのドリフト情報を消さないこと**（グローバル重複除去は不可）。なお現行の stride 間引き（`App.tsx`）は 2 点に 1 点を無条件に捨てるため**単サンプル幅のスパイクを取りこぼす**。トレードオフ分析は `docs/chart-library-comparison.md` §4-4
- **間引き・描画の計算を主スレッドで重くしないこと。** 本アプリはデータロガーであり Modbus ポーリングも主スレッドで回るため、**描画側の負荷はポーリング周期のジッタ＝計測品質の劣化に直結する**。取り込み時の間引きは O(1)/点 を維持し、再描画時の走査が数 ms を超えるなら Worker へ移すこと（`tsvWriterWorker` / `pyodideWorker` に前例あり）
- **`detectRenderBackend()`（`ChartPanel.tsx`）の GPU/CPU バッジは概算**。Canvas2D は Chromium で GPU アクセラレーション対象だが、Skia は**アンチエイリアス付きの凹パス**（長い折れ線）を GPU でラスタライズできず CPU 経路に落ちるため、「Canvas2D=CPU」「WebGL=GPU」の二分法は**どちらの方向にも不正確**。描画方式の性能判断は必ず実機計測で行い、この表示を根拠にしないこと
- **ビルドチャンク分割**（`vite.config.ts`）: Plotly 等の vendor を `vendor` / React を `react-vendor` チャンクへ分離（PWA キャッシュ効率のため）。`build.target` は `es2022`（モダンブラウザ限定のため down-level 不要）
- **プリキャッシュ注入**（`vite.config.ts` の `precache-manifest` プラグイン）: ビルド時に `dist` の全アセットを走査し `dist/sw.js` の `PRECACHE_MANIFEST` / `CACHE_VERSION` / `APP_VERSION` を置換。`sw.js` 側のプレースホルダ（`const PRECACHE_MANIFEST = [];` / `const CACHE_VERSION = 'dev';` / `const APP_VERSION = '';`）の文字列を変更するとマッチしなくなり**オフライン動作や更新プロンプトのバージョン表示が壊れる**ため注意。アセット追加時は手書き不要（自動で含まれる）
- **`base` はコマンド分岐**（`vite.config.ts`）: `build` / `preview` は `/modbus_simple_logger/`（GitHub Pages）、`dev` は `/`（sub-path HMR/manifest の不具合回避）。`index.html` の `manifest.json` / `icon.svg` と `manifest.json` 内の `start_url`/`scope`/`icons` は **base 相対**で記述すること（subdir 直書き禁止）。SW 登録は `import.meta.env.BASE_URL` 経由で base 追従
- **`global` シム**（`vite.config.ts` の `define: { global: 'globalThis' }`）: カスタム Plotly バンドルが `plotly.js/lib` ソースの Node `global` 参照を含むため必須。削除しないこと
- **CJS interop**: `src/plotly.ts` の `interopDefault()` は `plotly.js/lib/*`・`react-plotly.js/factory` の CJS default を dev(esbuild)/prod(rolldown) 両対応で正規化する。これらの import を直接呼ばないこと
- ドキュメント更新時は README の技術スタック・ブラウザ要件と整合させる
- **パネルの UI 表示名とコンポーネント名は一致しない**（v3.10 で表示名のみ変更）: `ModbusConfigPanel` = Connection Config、`ManualPanel` = Connector Manual、`AppInfoPanel` = Application Info、`PyScriptRunnerPanel` = PyScript Runner（**メニュー表記は2語**。ドキュメント側で "PyScriptRunner" と1語で書いているのは機能全体を指すときで、メニュー項目を指すときは2語）。ファイル名・`HamburgerMenu` の `key`・state 変数名は旧名のままで、**揃えるためのリネームは行わないこと** — 利得が無いのに import と、`HamburgerMenu` の `key` を読んでいる分岐すべてに波及する。（なお `FloatingWindow` のジオメトリはウィンドウ**タイトル**をキーにしたメモリ内 `Map` で storage には残らず、localStorage のキーも `theme_preference_v1` 等の意味的な名前なので、どちらもリネームの障害ではない。以前ここに挙げていたが誤り。）ドキュメントで UI を指すときは表示名、コードを指すときはコンポーネント名を使う
- **`.card` / `.button-*` を上書きする派生クラスは `index.css` の末尾に置く**（`.card-tight` / `.button-compact` / `.button-touch`）。これらは**未レイヤーの素の CSS** で、Tailwind のユーティリティは `@layer utilities` にあるため、`class` 属性に `p-1` や `py-0.5` を並べても**書いた順序に関係なく必ず負ける**。派生クラスが効くのは定義順のみが根拠なので、`.button-stop-save-pulse` などより後ろから動かさないこと
- **`launcher/` は `.gitignore` 対象**。新規ファイルを追加したら `git add -f launcher/<file>` が必要（既存ファイルの更新は不要）。`launcher/bin/` は対象外のまま — exe と cloudflared バイナリ（54MB）は**コミットしない**
- **実行形態の判定に `location.hostname` を使わないこと**。判定は `utils/appMode.ts` の `isLauncherMode` / `isViewerMode` / `isLauncherServed` のみを根拠とし、その実体は launcher が `index.html` の `<head>` へ差し込む `<meta name="msl-runtime">` である。hostname 判定（v3.12 以前）は「launcher だけがループバックを bind する」ことに依存していたため、**別 PC から LAN アドレスで開いた瞬間に web 版と誤認して Service Worker を登録し**、no-store ヘッダーで排除したはずのキャッシュ層を復活させる。マーカーを差し込むのは `launcher/server.ts` の `stampRuntimeMarker` の1箇所で、`dist/` 自体は書き換えない（Pages 配信物とバイト同一を維持するため）
- 不要な大規模リファクタリングは避け、目的に対して最小差分で変更する
- `index.css` は `@import "tailwindcss"` + `@custom-variant dark` 構成（Tailwind CSS 4 記法）
- **挙動を決めるチューニング値**は `src/constants.ts` に一元化し、`App.tsx` や `dataStorage.ts` で重複定義しないこと。**UI のドロップダウンの中身**（`POLLING_OPTIONS`・`SAVE_RATE_OPTIONS`・`BAUD_OPTIONS` 等）は例外で `App.tsx` にある — 上の定数表末尾の注記を参照
- `DataPoint` の `aiRaw`/`aiPhysical`/`aiVoltage` は `Float32Array` — 新規追加時も同様にすること
- **UI レイアウト**: AI Input カードの縦レベルメーターは `w-4`、AO カードにはレベルメーターを設けない。数値色は `getLevelColor()` で Raw/Phy はレベル連動、Voltage は固定青 (`text-sky-600`) を維持する
- **AI Raw の表示桁は精度モードで変える**: Extended(f32t) は `toFixed(3)`、Normal(i16t) は整数そのまま。f32 レジスタを読みながら `Math.trunc()` していた頃は、そのモードの存在理由である小数部を表示だけ捨てていた（TSV には常に入っている）
- **配色ルール（重要）**: 基調は **緑（emerald）とグレー（slate）**。状態を伝える必要が無い新規 UI 要素は、この2色だけで組む。
  - 緑はライト/ダークで濃淡を変える: 塗り = `bg-emerald-500 text-emerald-950 hover:bg-emerald-400`（`.button-primary` と同一）、文字/枠 = `text-emerald-600 dark:text-emerald-400` / `hover:border-emerald-400`、選択タブなどの塗り = `bg-emerald-500 text-emerald-950`
  - UI 表示文言は英語で統一する（アプリ既存 UI に合わせる）
  - **状態色は許可されている**（v4.5 で明文化）。禁止されているのは「装飾として色を増やすこと」であって、状態を色で伝えること自体ではない:
    - **警告 = 黄／橙**（`amber` / `yellow`）。「このままだと困ったことになる」「取り戻せないデータがある」の類。文字/枠 = `text-amber-600 dark:text-amber-400`、塗り = `bg-amber-500`
    - **警戒・危険・エラー = 赤**（`red`）。実際に失敗した、または操作すると壊れるもの。ドット = `bg-red-500`、文字 = `text-red-600 dark:text-red-400`（`ScriptStatusBar` / `AppStatusBar` のエラー表示が基準トークン）
    - **成功・正常 = 緑**、**中立・ロック・無効 = グレー**
  - **色は意味に対して一意に保つこと**。同じ「エラー」を場所によって赤とグレーで出し分けない。逆に、中立的な説明文（ただのヘルプ、機能の解説）に警告色を使わない — **警告かどうかの区別はユーザーが付ける**（v3.18 の Save ボタン注記が amber の初出）
  - 上記4色の外（青/sky・紫・ピンク等）を**装飾目的で新規に持ち込まない**。既存の確立済みセマンティック色（レベルメーターの red/yellow、電圧表示の sky 等）は現状維持でよいが、これらを別の意味へ流用しない
- **ヘッダーリンク**: アプリタイトル `ModbusSimpleLogger` は `<a>` タグで GitHub リポジトリへリンクし、`target="_blank" rel="noopener noreferrer"` を付与する
- **キャリブレーションのロック**: PyScriptRunner 実行中（`scriptRunner.scriptRunning`）は、スケール係数の書き換えを凍結する。`CalibrationPanel` は a・b セルと Load を無効化し、**オフセット c の直接編集と Tare は許可**（c調整は Tare と等価な原点調整のため）。`InputCalibratorPanel` は「適用」（a/b/c 一括上書き）のみ無効化し、プレビューまでは可能。スクリプトからのキャリブレーション書込み口は `set_ai_tare`（c のみ）だけなので、Tare 系のみ通せば実行中の制御ループの Phy スケールが動く事故を防げる。Save 中はロックしない（TSV に raw も常時記録されるため phy は復元可能）
- **Input Calibrator の2方式**（`InputCalibratorPanel` + `utils/calibration.ts`）: HX711(CH00-07)・ADS1115(CH08-15) を**1ウィンドウ**で扱う。チャネル選択は CH00-15 の単一ドロップダウンで、どちらのフロントエンドかは ch 番号（AI マップの前半/後半）から決まる。チップ種別を先に選ばせるタブは置かない（ch の属性であって、ユーザーが選ぶモードではないため）。**既定タブは実測フィット**（仕様書が手元に無い前提。Measured を先頭・初期表示に）。
  - ①実測フィット = `fitCalibration()`（2点→直線 a=0 / 3点以上・3種以上のRaw→2次最小二乗 / Raw2種→直線最小二乗 / それ未満→null）。各行の Grab は タップ=瞬間Raw / 長押し=離すまでの平均Raw。UI は3ゾーン（上部固定=ch/タブ/XYプロット(自前SVG・X:Raw Y:Phy＋フィット曲線)/点数コントロール/列見出し「# Physical Raw」、中央=測定点行のみスクロール、下部固定=プレビュー/適用）で、点数が増えてもプロットと見出しが見え続ける。
  - ②スペック計算 = `specToCalibration(感度, slopePerRaw)` で `b = 感度 × slopePerRaw`, a=0, c=0。`slopePerRaw` は基準（分母）単位ごとに `getChannelInfo(ch).options` が供給する（チップ名・基準単位の見出し・既定単位も同じ1関数が ch から返す）: HX711 は μV/V・mV/V・με の固定傾き（`hx711SlopePerRaw`）、ADS1115 は V/mV のみ（`rawToDisplayValue(1, voltageConfig[ch])` から算出）。以前の Raw オプション（傾き1）は `b = 感度` の単なる上書きで意味がないため削除済み。
  - 物理量(Phy)側の単位ラベルは持たない（従来どおり単位なしの Phy 表記）。適用は当該chの a/b/c を丸ごと上書き。TSV エクスポートはウィンドウ名がチップを示さなくなったため、`Sensor` キーで HX711/ADS1115 を別途記録する。
- **Output Tester**（`OutputTesterPanel`）: AO(GP8403) の手動出力窓。ch 選択 → 0/0.5/1V 刻みのプリセットは**押下即出力**、手入力欄のみ Apply（打ちかけの数値をハードウェアに送らないため）。物理量スケールは持たない（AI 側のキャリブレーションに相当するものが出力側には無く、扱うのは DAC 実寸の 0-10 V だけ）。未接続時と PyScriptRunner 実行中（AO の所有者が二重になる）は出力を無効化する。

## package.json のバージョン更新の絶対的なルール

**バージョンを上げるのはリリース時だけ**。通常のコミットでは `package.json` を触らないこと。

- **修正・機能追加のたびにバージョンを上げない**。1つの作業が3コミットに分かれても、上げるのは
  push/リリースの直前に1回だけ。バージョンは「配布物の識別子」であって作業ログではない
  （PWA の Application Info と GitHub Release のタグが指すのは配布された成果物であり、
  中間コミットには対応する配布物が存在しない）
- したがって**バージョンを上げるのは「push」「リリース」と言われたとき**（下記）。
  それ以外のタイミングで上げるのは、ユーザーが明示的に指示した場合のみ
- 採番はリリース分をまとめて1回で判断する:
  - 小規模変更(主観でいいです)ではマイナーバージョンをインクリメント
  - マイナーバージョンが20になる場合は、メジャーバージョンを更新(Linux,Linus Torvaldsの思想)
  - 大規模変更(主観でいいです)ではメジャーバージョンをインクリメント
  - メジャーバージョンのインクリメント時は、マイナーをゼロに

## 「push」「リリース」と言われたときの絶対的なルール

ユーザーが「push」「リリース」「Release」「minor version update with tag and push」と言った場合、
単なる `git push` ではなく**リリース操作**として以下を一括で実行する。

**手順の詳細・コマンド・落とし穴は `.claude/skills/release/SKILL.md` が一次情報源**（Claude Code なら
`/release` で読み込まれる）。exe 生成と GitHub Release 作成まで含めた完全な手順はそちらにある。
以下はその要約:

1. 上記ルールに従って `package.json` の `version` を更新（小規模変更ならマイナーをインクリメント）。
   バージョンはビルド時に `vite.config.ts` から `VITE_APP_VERSION` / `sw.js` の `APP_VERSION` へ
   注入されるため、**他のファイルを書き換える必要はない**
2. `npm run build` を通してから進める（壊れたリリースにタグを打たないため）
3. 変更とバージョン更新を同一コミットに含めてコミット
4. 注釈付きタグを作成: `git tag -a v3.4 -m "v3.4: <一行要約>"`（既存タグは
   `git tag --sort=-v:refname | head` で確認し、番号を採番する）
5. ブランチとタグの両方を push（`git push origin <branch>` + `git push origin v3.4`）
6. 作業がフィーチャーブランチ上なら、この流れの中で `main` へ**マージコミット付きでマージ**する
7. `bun run launcher:build` で exe を生成する（成果物は `launcher/bin/modbus_simple_logger.exe`）
8. GitHub Release を作成し、その exe を **`modbus_simple_logger.exe` という名前で**添付する
   （`gh release create <tag> launcher/bin/modbus_simple_logger.exe --title <tag> --generate-notes
   --notes-start-tag <前バージョンタグ> --latest`）

バージョン更新とタグを伴わない push は、デプロイ済み PWA の Application Info が古いバージョンを表示し続ける
ため不可。また、タグだけ打って GitHub Release と exe が欠けた状態も未完了とみなす（v2.14 以降は
全バージョンに exe 付き Release が揃っている状態を維持する）。
