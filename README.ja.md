# Multilingual Video Subtitler

[English](README.md) | 日本語

中国語・日本語・英語の動画や音声を扱う、ローカル処理を基本とした字幕ツールキット兼 Codex Skill です。ローカルの Whisper で編集可能な機械字幕の下書きを生成し、SRT／ASS／VTT へ出力します。タイミング検査や人手確認に使う認識結果・検証データも保存します。

> **開発状況：** 開発中の候補版であり、認識精度が保証された正式リリースではありません。出力された字幕には確認が必要です。ファイルの出力成功は、台詞や時刻が正しいことを意味しません。

## ソースコードの場所

既定の `main` ブランチには、プロジェクト概要、この日本語 README、ライセンスを置いています。**実行用のソースコードは現在、`main` ではなく開発ブランチで管理しています。**

単体 CLI を使う場合は、[`codex/subtitle-tool-bounded-asr-local-recovery-integration`](https://github.com/kai987/Codex-Skills-multilingual-video-subtitler/tree/codex/subtitle-tool-bounded-asr-local-recovery-integration) を参照してください。以下の手順は、このブランチを対象としています。他の実験ブランチにはそれぞれ固有の仕様と検証報告があり、相互に置き換えられるリリースではありません。

## 主な機能

- ローカルの動画・音声を、`whisper.cpp` と利用者が指定したモデルで文字起こし。
- 共通の認識証拠から、編集可能な SRT・ASS・WebVTT の下書きを出力。
- 生の認識結果、入力・モデルの識別情報、タスクのチェックポイント、出力索引を保存。
- 依存関係の確認、状態表示・再開、オフライン復旧、明示的に指定した修正版字幕の検査。
- 別の高度なワークフローとして、字幕の抽出・検索、参考字幕を使った評価、アラインメント証拠の収集、人手確認済み字幕の終稿処理を用意。使用前にソースブランチの説明を確認してください。

単体 CLI は、自動翻訳、モデルの自動ダウンロード、参考字幕の検索、クラウドへの自動フォールバックを行いません。実験用・参考資料併用の結果と、機械だけで独立生成した結果は区別します。

## 必要な環境

- Node.js `>=24 <25`。
- npm `>=11`。ソースブランチの指定バージョンは `npm@11.18.0` です。
- FFmpeg と ffprobe。
- ローカルの `whisper-cli` 実行ファイルと、whisper.cpp に対応する GGML モデル。

外部ツールとモデルは別途用意してください。このリポジトリには同梱していません。

## クイックスタート

**ソースブランチを明示して**クローンします。

```bash
git clone --single-branch \
  --branch codex/subtitle-tool-bounded-asr-local-recovery-integration \
  https://github.com/kai987/Codex-Skills-multilingual-video-subtitler.git \
  multilingual-video-subtitler
cd multilingual-video-subtitler
npm ci
npm run build:subtitle-tool
```

ローカルのパスを設定し、依存関係を確認します。

```bash
npm run subtitle-tool -- configure \
  --model "/path/to/ggml-model.bin" \
  --runtime "/path/to/whisper-cli" \
  --language ja

npm run subtitle-tool -- doctor --input "/path/to/video.mkv"
```

`configure` と `doctor` は、モデルの読み込みや音声認識を行いません。例のパスは実際のファイルに置き換えてください。言語には `ja`・`en`・`zh` を指定できます。

下書きを生成し、タスクの状態を確認します。

```bash
npm run subtitle-tool -- generate \
  --input "/path/to/video.mkv" \
  --output-root "/path/to/subtitles"

npm run subtitle-tool -- status --task "/path/to/subtitles/subtitle-XXXXXX"
```

`--task` には `generate` が表示した実際のタスクディレクトリを指定します。音声ファイルも同じコマンドで処理できます。複数の音声ストリームがある場合は、`doctor` の一覧を確認し、`--audio-track N` に**コンテナ全体でのストリーム番号**を指定してください。「何番目の音声か」という番号ではありません。

## 出力・確認・復旧

生成のたびに個別のタスクディレクトリを作成します。その中の `OUTPUT_INDEX.md` から機械字幕の下書きと保存済み証拠を確認できます。生のデータは変更せず、手動編集は別のコピーへ保存してください。

実行状態、成果物の整合性、字幕の品質は別々に扱います。実行が `completed`、整合性が `passed` でも、品質は `needs-review`、`humanValidated=false`、`finalizationMethod=none` のままです。

成功した認識結果が保存されていても時刻に異常がある場合は、新たな ASR を実行せずに全文を取り出せます。

```bash
npm run subtitle-tool -- recover --task "/path/to/task"

# 明示的に、時刻が有効な部分だけを不完全な字幕として出力します。
npm run subtitle-tool -- recover --task "/path/to/task" --export-partial

# 時刻を元のメディア基準で保存した修正版を検査します。
npm run subtitle-tool -- validate-edited \
  --task "/path/to/task" \
  --input "/path/to/edited.srt" \
  --timebase source
```

部分出力は、完全な字幕の納品ではありません。形式や本文の対応関係が検査を通っても、音声との一致を保証するものではありません。反復・幻覚、発話の欠落、方言の誤認識、不確かな境界は、元の音声で確認する必要があります。ローカルのログや manifest には個人環境の絶対パスが含まれることがあるため、共有前に確認してください。

## ドキュメントと開発

- [English README](README.md)
- [単体 CLI のインストール・使用・復旧ガイド](https://github.com/kai987/Codex-Skills-multilingual-video-subtitler/blob/codex/subtitle-tool-bounded-asr-local-recovery-integration/STANDALONE_SUBTITLE_TOOL_V1.md)
- [高度なワークフローと検証コマンド](https://github.com/kai987/Codex-Skills-multilingual-video-subtitler/blob/codex/subtitle-tool-bounded-asr-local-recovery-integration/README.md)
- [Codex Skill の手順](https://github.com/kai987/Codex-Skills-multilingual-video-subtitler/blob/codex/subtitle-tool-bounded-asr-local-recovery-integration/.agents/skills/multilingual-video-subtitler/SKILL.md)
- [開発ブランチ一覧](https://github.com/kai987/Codex-Skills-multilingual-video-subtitler/branches)

ソースブランチは TypeScript／Node.js のワークスペース構成です。`apps/` にアプリケーションの入口、`packages/` に実行用パッケージ、`schemas/` にスキーマ、`scripts/` にコマンド補助を置いています。メディア、モデル、キャッシュ、生成済みの `output/`、個人の確認用ファイルは、ソースの閲覧・ビルドには不要であり、ドキュメントの素材としてコミットしないでください。

## ライセンス

[MIT](LICENSE)。外部ツール、モデルの重み、参考字幕、メディアには、それぞれのライセンスと利用条件が適用されます。
