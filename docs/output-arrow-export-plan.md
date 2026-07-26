# Apache Arrow Export 計画

**対象**: ModbusSimpleLogger の保存機能（現行 TSV 出力の代替オプション追加）
**目的**: TSV 比でファイルサイズを **約 2× 縮小** する `.arrows` 出力を TSV と並列に実装。バイナリカラムナフォーマットにより、可読性は下がるが、ディスク I/O・読取側ツール（pandas / DuckDB / pyarrow）の効率を同時に改善する
**ステータス**: Plan（実装未着手）

---

## 0. 要約

| 項目 | 決定 |
|---|---|
| 採用フォーマット | **Apache Arrow IPC Streaming Format**（拡張子 `.arrows`、MIME `application/vnd.apache.arrow.stream`） |
| 圧縮 | **未圧縮**（zstd は将来の別タスクで再評価） |
| 既存 TSV | 維持（共存）。OS のセーブダイアログで両形式から選択 |
| デフォルト | **TSV**（既存ユーザのワークフローを温存） |
| スキーマ | 73列: `timestamp_ms: Int64` + `Float32 × 72`。custom_metadata なし |
| 想定サイズ削減 | 1行あたり **TSV ~610B → Arrow ~296B**（**約 2.0× 縮小**） |
| 1行バイト内訳 | 1×8 (Int64 ts) + 16×4 (raw) + 16×4 (phy) + 8×4 (ao) + 16×4 (vlt) + 16×4 (param) = 296 B |
| バッチ境界 | 500行（TSV と同一の値を `ARROW_FLUSH_MAX_ROWS` として共有） |
| 依存追加 | `apache-arrow` のみ（zstd 用 fzstd は不採用） |
| Worker 構成 | `src/arrowWriterWorker.ts` を新設。`tsvWriterWorker.ts` と並列 |
| Float32 化 | `ai_raw_*` を含む全データ列を Float32 で統一。22bit ADC < Float32 仮数24bit なので精度ロスなし |
| スキーマメタデータ | なし（application / capture_start 等は入れない。`column_name` から全て判別可能とする） |

---

## 1. 背景・動機

- 現行 TSV は数値を ASCII テキストとして記録するため、73列×平均7-8文字 + タブ/改行で **1行あたり約610バイト**
- 長時間・高速サンプリングの記録ではファイルサイズが SSD 寿命・コピー時間に効いてくる
- Apache Arrow IPC Streaming Format はバイナリカラムナフォーマットで、数値を 4バイト Float32 そのまま保存する
- カラムナレイアウトの利点（列毎の選択的読取、Parquet への容易な変換、pandas/DuckDB/pyarrow の高速読込み）も無償で得られる

## 2. 採用技術の選定

### 2.1 なぜ Arrow IPC **Streaming** Format か

| 候補 | 拡張子 | 採用判断 |
|------|--------|----------|
| Arrow IPC File Format | `.arrow` | 不採用。schema がファイル末尾に配置され、追記書込みでは schema 確定後に戻れない |
| **Arrow IPC Streaming Format** | `.arrows` | **採用**。schema を先頭に1度、各 RecordBatch を連続メッセージとして追記可能。File System Access API の append-only モデルに整合 |
| Parquet | `.parquet` | 不採用（v3.4）。`parquet-wasm` 等の WASM 依存が必要。Arrow → Parquet 変換は読取側ツールで `df.to_parquet()` 1行で可能なので、必要になった時点で読取側責務 |

### 2.2 なぜ zstd 圧縮を **v3.4 に含めない** か

| 観点 | 評価 |
|------|------|
| ファイルサイズ | 未圧縮 Arrow で TSV 比 2× 縮小。zstd を加えれば更にもう 2-3× 効く（合計 5-8×） |
| FS API 上の挙動 | 圧縮は JS 側（Worker）で完結。FS API は単なるバイトパススルーなので圧縮済みバイト列は **正味 I/O 量が減る**。FS API 固有の恩恵減衰はなし |
| Append コスト | 単一 zstd stream では前後依存で O(累積) コストになるが、**バッチ毎の独立 zstd frame** を採用すれば各書込みは O(batch_size) で一定。FS API では後者しか採用できない |
| コスト（依存） | `fzstd` WASM ~300-400 KB の追加バンドル |
| コスト（実装） | Arrow body compression 仕様（schema に codec メタデータ、各 batch body が独立 codec 出力）の実装 |
| コスト（読取側） | pyarrow >= 14 / DuckDB >= 0.10 が zstd body 対応。読取環境に最低バージョンを要求する |
| 結論 | 2× 縮小で「圧倒的に小さい」目的は達成済み。**依存最小化を優先**し v3.4 は未圧縮に限定。zstd が必要になった時点で Arrow body compression として独立追加可能（既存 `.arrows` ファイルとの互換性は壊さない） |

## 3. スキーマ

### 3.1 カラム定義（73列）

| インデックス | 名前 | Arrow 型 | 由来（TSV） |
|---|---|---|---|
| 0 | `timestamp_ms` | `Int64` | `timestamp`（`YYYY/MM/DD HH:mm:ss.fff` を捨て、エポック ms に変換） |
| 1-16 | `ai_raw_00` 〜 `ai_raw_15` | `Float32` | HX711/ADS1115 ADC 生値（22bit max < Float32 仮数24bit） |
| 17-32 | `ai_phy_00` 〜 `ai_phy_15` | `Float32` | キャリブレーション後の物理量（TSV の 3桁丸めを捨てる） |
| 33-40 | `ao_raw_00` 〜 `ao_raw_07` | `Float32` | AO 出力生値（mV） |
| 41-56 | `ai_vlt_00` 〜 `ai_vlt_15` | `Float32` | AI 電圧表示値（mV/V または V、`VoltageMode` 設定に基づく） |
| 57-72 | `par_00` 〜 `par_15` | `Float32` | Parameter 値（スクリプト実行中の派生値等） |

すべて `nullable=false`。

### 3.2 TSV との差分

- **`timestamp` の表現損失**: 文字列フォーマット `YYYY/MM/DD HH:mm:ss.fff` は失われ、エポック ms のみ。読取側で `pd.to_datetime(df['timestamp_ms'], unit='ms')` で復元可能。情報量で見れば TSV の方が構造ヒントを多く持っていた
- **3桁丸めの消滅**: TSV の `parseFloat(v.toFixed(3))` による丸めが Arrow には存在しない。`ai_phy_xx` 等が full precision になる
- **`ai_raw_*` の int 表現消失**: TSV では整数として記録されていたが、Arrow では Float32 化される。22bit 値なら精度ロスなく再現可能だが、ツール側で明示的に `.astype('int32')` が必要

## 4. ファイル構成

### 4.1 新規ファイル

```
src/utils/arrowFormat.ts           # Schema 定義・RecordBatch 構築ヘルパ（pure, no DOM）
src/utils/arrowExport.ts           # main thread: picker + ArrowSink proxy
src/utils/arrowWorkerProtocol.ts   # arrowWriterWorker との message 型
src/arrowWriterWorker.ts           # 500行毎に IPC バイト生成 → 追記書込み
```

### 4.2 既存変更

- `src/constants.ts`: `ARROW_FLUSH_MAX_ROWS = 500` 追加
- `src/App.tsx`: `handleStartSave` を `fileHandle.name` 拡張子で TSV/Arrow ディスパッチ。`tsvWriterRef` を共通 interface 化（または並列 `arrowWriterRef`）
- `package.json`: `apache-arrow` 依存追加。version bump `3.3` → `3.4`

### 4.3 変更しないもの

- Modbus 通信層（`src/modbus/webserialClient.ts`）
- ポーリングループ・スロットリング・データ取得系
- 既存の TSV 経路（worker・export・App.tsx 内の分岐以外）
- IndexedDB スキーマ（Float32Array のまま）
- キャリブレーション・スクリプトランナー・MCP

## 5. 書込みフロー

```
[App.tsx]                   [arrowWriterWorker]            [File System Access API]
  pollOnce()  ─row msg──▶   buffer.push(row)
                            ...
                            rowCount == 500
                            build RecordBatch(73 cols, 500 rows)
                            bytes = makeStreamIpc([batch, ...])
                                              ─write()──▶   append to file
                            buffer.clear()

  handleStopSave() ─close─▶ flush partial batch (1..499 rows)
                            build RecordBatch(73 cols, N rows)
                            append bytes
                            terminate()
```

### 5.1 コスト特性

- 各書込みは **常に O(batch_bytes) = O(500 × 296B) ≈ 148 KB**
- ファイル合計サイズに比例するコストは **発生しない**（追記は sequential write のみ、zstd stream のような前後参照を持たない）
- バッチ内変換: Float32Array → Vector → RecordBatch → IPC バイト列。500行なら < 1 ms

### 5.2 エラーハンドリング

- `tsvWriterWorker.ts` の `CLOSE_TIMEOUT_MS = 10_000` セーフティネットパターンを踏襲
- Worker 内エラーは main thread の `onError` コールバックへ伝播
- `createWritable({ keepExistingData: true })` を `arrowWriterWorker.ts` 内で使用（追記の宣言）

## 6. UI・フォーマット判別

### 6.1 Picker types 配列

```ts
types: [{
  description: 'Data Files',
  accept: {
    'text/tab-separated-values': ['.tsv'],                              // 1st = default
    'application/vnd.apache.arrow.stream': ['.arrows'],
  },
}]
```

### 6.2 フォーマット判別

```ts
const ext = fileHandle.name.toLowerCase().split('.').pop();
if (ext === 'arrows') {
  // Arrow writer
} else {
  // TSV writer（.tsv / .txt / 拡張子なし すべてこちら）
}
```

### 6.3 suggestedName

- 拡張子抜き（例: `20260125_143000`）。OS ダイアログの type ドロップダウン選択に応じて拡張子が補完される
- アプリ内 dropdown・localStorage「前回選択記憶」は v3.4 では実装しない（最小差分）

## 7. 検証計画

| # | 項目 | 手順 | 合格基準 |
|---|---|---|---|
| 1 | バンドルサイズ | `bun run build` 後、`apache-arrow` 関連チャンクの gzip 後サイズを確認 | +600 KB 未満。超過時は entry point を `apache-arrow/Arrow.browser.cjs` 等に切替 |
| 2 | Python 読込 | `pyarrow.ipc.open_stream('data.arrows').read_all().to_pandas()` | 73列存在、dtypes が `[int64] + [float32] × 72` |
| 3 | DuckDB 読込 | `duckdb -c "SELECT count(*) FROM 'data.arrows'"` | 正常終了、行数が保存件数と一致 |
| 4 | TSV との数値一致 | 同データセットの TSV と `.arrows` を pandas で比較 | `ai_phy_xx` 等の差が Float32 丸め最下位 bit 以内 |
| 5 | 長時間・append 安定性 | 10 Hz × 1時間保存 → Stop → ファイル読込 | 末尾まで読める・最終バッチ欠損なし |
| 6 | 既存 TSV 非リグレッション | TSV 形式保存の挙動確認 | 既存テスト・手動確認とも通過 |
| 7 | 切替 UI | Start Save → OS ダイアログで TSV/Arrow それぞれ選択 | 両方とも正常動作、Writer が正しくディスパッチされる |
| 8 | PWA プリキャッシュ | `dist/sw.js` の `PRECACHE_MANIFEST` 確認 | `apache-arrow` チャンクが自動追加されている |

## 8. 実装ステップ（順序厳守）

1. **Spike（30分）**: `apache-arrow` を `package.json` に追加 → `bun install` → 最小構成で Schema + 1 RecordBatch → `tableToIPC(table, 'stream')` で Uint8Array 取得 → ファイル書出し → Python で読込み確認。途中で Float32Array→Vector 変換 API の正解を確定する
2. **Schema 定義**: `src/utils/arrowFormat.ts` に Schema ビルダと RecordBatch 構築ヘルパ（pure 関数）
3. **Worker**: `src/arrowWriterWorker.ts`。`tsvWriterWorker.ts` を雛形に、`formatTsvRow` 呼び出しを RecordBatch 構築 + IPC バイト生成に置換
4. **Main thread 側**: `src/utils/arrowExport.ts` で `ArrowSink` 実装。`createArrowWriter` は `createTsvWriter` の鏡像
5. **App.tsx 配線**: 拡張子判別ディスパッチ。`tsvWriterRef` 周辺の型を `TsvSink | ArrowSink` に
6. **package.json**: `apache-arrow` を正式追加 + version `3.3` → `3.4` インクリメント
7. **ビルド検証**: バンドルサイズ、precache manifest 自動取り込み
8. **E2E 検証**: §7 全項目
9. **AGENTS.md 更新**: 必要に応じて `src/utils/arrowExport.ts` 等をディレクトリ構造セクションへ追記

## 9. リスクと対策

| リスク | 対策 |
|---|---|
| `apache-arrow` バンドル肥大 (>1 MB) | entry point を `apache-arrow/Arrow.browser.cjs` + IPC 限定 import に絞る。最終手段で dynamic import（保存開始時のみロード） |
| 既存 `tsvWriterRef` 周辺の union 型化が大改造になる | 5行程度の差分（`TsvSink | ArrowSink` への型変更 + `createXxxWriter` ディスパッチ関数）。`tsvWriterRef` を `dataWriterRef` に rename しない |
| 最終部分バッチの flush 漏れ | Stop Save 時に `flush()` で残 rows を強制的に 1 個の RecordBatch に詰めて書き出し（既存 TSV と同じ close シーケンス） |
| Float32 化で `ai_raw_*` の int 表現が失われる | 22bit ADC < Float32 仮数24bit なので**精度ロスなし**。読取側で `.astype('int32')` 復元可能。決定済トレードオフ |
| PWA 初回プリキャッシュ増加 | `precache-manifest` プラグインが `dist/` を自動列挙するため手動追加不要。既存チャンクは新ハッシュで再キャッシュ |
| `apache-arrow` の CJS interop | `apache-arrow` は ESM/CJS 両対応。`interopDefault()` 等のシムは不要（Plotly バンドルと事情が異なる） |
| Worker 内 IPC バイト列のメモリコピー | Worker 内で `Uint8Array` を `writable.write(bytes.buffer)` で transfer し、コピー回避 |

## 10. 将来の拡張余地（v3.4 スコープ外）

- **zstd body compression**: `fzstd` 依存追加 + Arrow body compression 仕様でさらに 2-3× 縮小
- **Parquet エクスポート**: `parquet-wasm` 経由、または Arrow → Parquet を pyarrow で読取側責務化
- **IndexedDB の Arrow 化**: 現行の JSON シリアライズを Arrow IPC に置換。`Float32Array` のまま構造化ストア化
- **保存形式の永続化**: localStorage に「前回選択形式」を記憶。アプリ内 dropdown 設置
- **Arrow Schema の custom_metadata**: 機器キャリブレーション値・精度モード・Modbus 設定を保存
- **ScriptRunner での Arrow 読込み**: pyodide への pyarrow ロード（コスト大のため別タスク）

---

**本計画の読み方**: §0 の要約表 → §2 のフォーマット選定理由 → §5 の書込みコスト特性 → §8 の実装順序。§3 / §4 / §6 は参照用。
