---
name: release
description: このリポジトリのリリース操作を一括実行する。ユーザーが「リリース」「Release」「push」「minor version update with tag and push」と言った場合に使用。バージョン更新 → ビルド検証 → コミット → 注釈付きタグ → push（必要ならmainへマージ）→ exe生成 → GitHub Release作成 → exe添付、までを行う。
---

# リリース手順

`package.json` の `version` 更新だけ、あるいはタグだけ、で終わらせない。**下記を最後まで完了させて初めてリリース**。
途中で失敗した場合は、どこまで完了してどこが未了かを明示して報告する。

前提: `gh` が認証済み（`repo` スコープ）。リポジトリは `KikuchiMakoto/modbus_simple_logger`。

## 1. バージョン採番

`AGENTS.md`「変更stage前やcommit前のpackage.json更新のための絶対的なルール」に従う:

- 小規模変更 → マイナーをインクリメント
- マイナーが **20 になる場合はメジャーを更新してマイナーを 0 に**（`2.20` の次は `3.0`）
- 大規模変更 → メジャーをインクリメント（マイナーは 0）

形式は 2 桁の `"3.16"`（semver 3 桁ではない）。既存タグは `git tag --sort=-v:refname | head` で確認する。

書き換えるのは **`package.json` の `version` だけ**。`VITE_APP_VERSION` / `sw.js` の `APP_VERSION` /
MCP サーバのバージョンはビルド時に注入されるため、他ファイルへの直書きは禁止。

## 2. ビルド検証 + exe 生成

```
bun run launcher:build
```

これが `bun run build`（vite）→ `generate-embed` → `generate-icon` → `bun build --compile` を通し、
`launcher/bin/modbus_simple_logger.exe` を生成する。**壊れたリリースにタグを打たないため、必ずタグより先に通す。**
バージョン更新後にビルドするので、生成された exe はそのまま Release 添付に使える。

出力で次の 2 行を確認する。どちらも欠けていたら添付してはいけない:

- `[generate-icon] Wrote …\launcher\icon.ico` — 欠けるとカスタムアイコンなしの exe になる。
  `generate-icon.ts` はブラウザ探索に `reg` を使うため、**PATH に System32 が必要**（Bash ツール経由だと
  外れていることがある。その場合は PowerShell で実行するか `PATH` に `/c/WINDOWS/system32` を足す）
- `[launcher:build] Patched PE subsystem Console(3) -> GUI(2)` — 起動時のコンソール窓を消す処理

ビルドは直前の 100MB 超 exe への AV スキャンで一時的なファイルロックに当たり失敗することがある。
その場合は数秒待って**もう一度実行すれば通る**（恒久的な失敗と区別すること）。

## 3. コミット

変更内容とバージョン更新を**同一コミット**に含める。

`launcher/` は `.gitignore` されているため、**新規の launcher ソースは `git add -f launcher/…` が必要**
（`launcher/bin/`、`embedded.generated.ts`、`icon.ico` はビルド成果物なので追加しない）。

## 4. 注釈付きタグ

```
git tag -a v3.17 -m "v3.17"
```

既存タグの体裁に合わせ、メッセージは `vX.Y`（または `vX.Y: <一行要約>`）。**軽量タグは使わない。**

## 5. push

```
git push origin <branch>
git push origin v3.17
```

フィーチャーブランチ上での作業なら、この流れの中で `main` へ**マージコミット付きでマージ**してから push する。

## 6. GitHub Release 作成 + exe 添付

```
gh release create v3.17 launcher/bin/modbus_simple_logger.exe \
  --repo KikuchiMakoto/modbus_simple_logger \
  --title v3.17 --generate-notes --notes-start-tag v3.16 --latest
```

- **添付ファイル名は `modbus_simple_logger.exe` でなければならない。** 全リリースで統一されており、
  ダウンロード名は「ローカルのファイル名」で決まる。`gh` の `path#label` 記法はラベルだけを変えるので、
  別名のファイルを渡すと `v3.17.exe` のような不統一な名前で公開されてしまう。
  やってしまった場合は削除ではなく API でリネームできる:
  `gh api -X PATCH repos/<owner>/<repo>/releases/assets/<id> -f name=modbus_simple_logger.exe`
- `--notes-start-tag` に**直前のバージョンタグを明示**する（自動判定に任せず範囲を固定する）
- 最新版なので `--latest`。過去バージョンを後から埋める場合のみ `--latest=false`
- exe は 170MB 超あり、アップロードに数十秒かかる

## 7. 検証

```
gh release view v3.17 --repo KikuchiMakoto/modbus_simple_logger \
  --json tagName,isDraft,assets -q '"\(.tagName) draft=\(.isDraft) \([.assets[]|"\(.name) \(.size)"]|join(","))"'
```

`draft=false` と `modbus_simple_logger.exe` の存在・サイズを確認して初めて完了報告する。
