# v7.3.1 依存更新・回帰検証

## 更新方針

npm レジストリの `dist-tags.latest` と全直接依存の実インストール版を照合した。
安定版を対象とし、`next` / `dev` 等のプレリリースは採用していない。
更新可能な安定版を互換性不安だけで見送ったパッケージはない。

| 更新した直接依存 | 変更前 → 変更後 |
| --- | --- |
| React / React DOM | 19.3.0 → 19.3.1 |
| Plotly.js | 3.7.0 → 4.2.0 |
| Vite | 8.3.1 → 8.3.5 |
| @vitejs/plugin-react | 6.1.1 → 6.1.2 |
| PostCSS | 8.5.28 → 8.5.32 |
| Autoprefixer | 10.6.1 → 10.6.2 |
| @types/bun | 1.4.2 → 1.4.4 |
| @types/plotly.js | 3.0.14 → 3.0.15 |
| @types/w3c-web-serial | 1.0.8 → 1.0.9 |

推移依存は親の要求範囲を尊重した。`bun audit` で検出された
source-map-js の high 脆弱性は、残っていた 1.2.1 を 1.2.2 に更新して解消した。
最終確認で `bun outdated` は更新候補なし、`bun audit` は脆弱性なし（347 packages）。

### 更新しなかった直接依存と理由

以下は**すべて既に最新安定版だったため**。意図的な旧版固定ではない。
型定義の番号は本体と独立しており、本体の番号に揃える操作はしない。

| パッケージ | 実インストール版＝latest |
| --- | --- |
| pyodide | 314.0.7 |
| @fontsource/iosevka | 5.3.0 |
| buffer | 6.0.3 |
| prismjs | 1.30.0 |
| react-plotly.js | 4.1.0 |
| react-rnd | 10.5.3 |
| react-simple-code-editor | 0.14.1 |
| tailwindcss / @tailwindcss/postcss | 4.3.3 |
| typescript | 7.0.2 |
| @types/react / @types/react-dom | 19.3.0 |
| @types/prismjs | 1.26.6 |
| @types/w3c-web-usb | 1.0.14 |
| @types/wicg-file-system-access | 2023.10.7 |

Pyodide は変更しなくても、Vite の Worker 出力変更の影響を受ける。
そのため同梱アセット比較だけでなく、更新後の本番 Worker で実行・停止を検証した。

## 互換性と小規模な効率化

- Plotly 4 の破壊的変更（旧地図トレース・MathJax 等）は本アプリでは使用していない。
  `core + scattergl` の静的最小バンドル、hover 無効、非単調 XY、NaN 欠測、明示 WebGL 解放を維持した。
- Plotly 4.1.2 以降は `responsive: true` が graph div を ResizeObserver で監視する。
  UI 拡大率変更時の人工 `window.resize` を削除し、入力停止中にもサイズ追従を確認した。
- ChartPanel の M4 全点走査とトレースの表示設定を別々に memo 化した。
  色だけの変更では入力全点を再走査しない。間引き方式や点数上限は変更していない。
- vendor JS は 1,472.52 → 1,513.40 kB、gzip は 494.25 → 513.23 kB。
  vendor CSS は 65.33 → 82.96 kB。バンドル縮小とは主張しない。
- 既存の bit-twiddle の `"use restrict"` 警告は更新前後とも出る。ビルドは成功する。

## 実施した検証

- 更新前後: `bun run test`、25 pass / 0 fail / 4,535 assertions（4 files）。
- アプリ型チェックと本番ビルド成功。
- `bun run launcher:build` 成功。launcher 型チェック、アセット埋込み、アイコン生成、exe 生成を含む。
  PE subsystem は Bun の `--windows-hide-console` で既に GUI(2) のため、追加パッチは不要だった。
- Chrome / browser-harness で本番バンドルを検証。物理デバイスではなく、CRC 付き応答を返す偽 SerialPort を使用。
  4 チャートの時系列、非単調 XY、NaN、UI 拡大率、ウィンドウ幅変更を確認。
- チャートを12回非表示／再表示し、各回の WebGL コンテキスト解放と残る4枚のコンテキストが有効なことを確認。
- Python 3.14 の新規初期化、GetAiRaw/GetAiPhy/GetAo、SetParam/GetParam の float32 SAB、
  SetAo/SetAiTare/SetParamLabel メッセージ、Elapsed、日本語・記号 stdout、stderr、例外の行番号、
  sys.exit/exit/quit、同期無限ループ Stop、asyncio.sleep 中 Stop、各停止後再実行、初期化中 Stop → 再実行を確認。
- Pyodide の5アセットは更新前ビルドと SHA-256 がすべて一致。
- 新規オリジンのプリキャッシュ（22 entries、wasm を含む）完了後、ネットワークを offline にして再読込み。
  クロスオリジン分離、画面起動、未起動の Pyodide Worker の新規初期化と上記 Python 検証を確認。
- 別の新規オリジンで旧 v7.2.9 をインストールし、配信物を v7.3.1 へ交換。
  サイレントチェックでは新 SW が waiting のまま旧キャッシュを保持。
  Application Info からの明示チェックで `v7.2.9 → v7.3.1` を表示し、辞退時は waiting を保持。
  承諾後にリロードされ、新キャッシュだけになることを確認。
  更新後にも offline 再起動と新規 Pyodide Worker の全検証を再実施した。

物理 USB デバイス、Android、長時間連続計測の実機試験は未実施。
偽ポートのブラウザ試験は、実機の USB 転送タイミングやドライバ検証を代替しない。

## 参照

- [npm registry API](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md): 各パッケージの `/latest` を照合。
- [Plotly.js changelog](https://github.com/plotly/plotly.js/blob/master/CHANGELOG.md)
- [Plotly ResizeObserver 変更 #8017](https://github.com/plotly/plotly.js/pull/8017)
- [Vite changelog](https://github.com/vitejs/vite/blob/main/packages/vite/CHANGELOG.md)
- [source-map-js advisory GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)

アプリコードへ外部コードの転載は行っていない。Pyodide の MPL-2.0 を含め既存のライセンス表記を維持した。
