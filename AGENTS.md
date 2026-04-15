# AGENTS.md

このリポジトリで作業するエージェント向けの簡易ガイドです。

## プロジェクト概要

- React + TypeScript + Vite で構成された Modbus RTU ロガー SPA
- 通信は Web Serial API（必要時に web-serial-polyfill）
- 計測データは IndexedDB と TSV（File System Access API）で扱う

## 主要コマンド

```bash
bun install
bun run dev
bun run build
```

## 実装上の前提

- シリアル通信ロジック: `src/modbus/webserialClient.ts`
- UI と計測フローの中核: `src/App.tsx`
- データ保存: `src/utils/dataStorage.ts`（IndexedDB）
- ファイル出力: `src/utils/tsvExport.ts`（TSV）
- PWA 関連: `src/main.tsx`, `public/sw.js`

## 変更時の注意

- 通信方式は「Web Serial API」を基準に記述する（WebUSB は polyfill 経由のフォールバック）
- ドキュメント更新時は README の技術スタック・ブラウザ要件と整合させる
- 不要な大規模リファクタリングは避け、目的に対して最小差分で変更する
