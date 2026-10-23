import {
  criteria,
  issueValues,
  statuses,
  overallValues,
  referenceUses,
  schemaColumns,
  referenceSchema,
} from "./content-review-input.mjs";

export function reviewGuide() {
  return `# 過去の人手原稿を添えた A/B 試聴ガイド

PRIVATE / NOT FOR PUBLIC DISTRIBUTION。音声・字幕・人手メモを含む私的資料です。外部共有・公開サイトへのアップロードをしないでください。

## 始め方

ZIPを一つのフォルダーへ展開し、[試聴ページ](listening-index.html)をローカルで開きます。サーバー・ネットワーク・モデルは不要です。[記入用CSV](review/content-review.csv)以外は編集しません。[固定テンプレート](content-review-template.csv)は空の初期状態の証拠です。原本CSVの削除や誤記を verify が勝手に初期化することはありません。

1. まず音声を聴き、自分の観察メモを取ります。
2. A/B の折り畳みを開き、両方の元raw全文と比較します。
3. 必要な場合だけ R（過去の人手原稿）を開きます。開いたかどうかを referenceUse に申告します。
4. 自分が実際に聴いた範囲と観察だけを CSV に記入します。

参照付き・非盲検の作業です。R は過去に人手確認された資料ですが、今回は全体の完全性や音声上の正しさを再検証していません。validated Gold ではなく、今回の試聴済み証明でもありません。R を見て A/B の回答を自動で埋めないでください。NOT_VIEWED という自己申告だけでも盲検が証明されるわけではありません。過去の追加レビュー件数は今回の進捗ではありません。

## 評価する区間

評価は source [start, end) 秒です。再生には前後コンテキストがあります。プレーヤー内の 0 秒は元動画の 0 秒ではありません。ページの「source 秒」と「音声内評価秒」を見分けてください。CSV listenedStart/listenedEnd は **source 秒**で、評価区間全体を含み、再生区間からはみ出さない値を使います。評価秒を R の時刻へ動かしたり、長い参照文を文字数比で切り分けたりしません。

A/B の TIME_OVERLAP_HINT・POINT_HINT は時刻上の手がかりで、音声の正解証明ではありません。REQUEST_CONTEXT_ONLY は要求全体の文脈、UNLOCATED は位置不明です。R の EVALUATION_OVERLAP は評価区間との交差、PLAYBACK_CONTEXT_ONLY は前後文脈だけとの交差です。複数区間をまたぐ文は全文を表示しますが、全文が評価区間内に発話されたとは限りません。参照や候補の空欄は無音・発話欠落を意味しません。本文の不確実な解析や不正時刻は警告として残ります。

## CSV の列と値（このファイルだけで記入できます）

必須列: ${schemaColumns(referenceSchema)
    .map((c) => "`" + c + "`")
    .join(", ")}。

- reviewId / bundleIdentity: テンプレートの値を変更しないでください。
- status: ${statuses.join(" / ")}。NOT_PERFORMED=未実施、IN_PROGRESS=途中、REVIEWED=観察を記入済み、UNJUDGEABLE=聴取したが判断不能。
- reviewer: 列は必要ですが名前の記入は任意です。
- reviewedAt: 実際の日時をタイムゾーン付き ISO 8601 で記入します（例: 2030-01-02T13:45:00+09:00）。例は中性の書式例であり実際のレビュー日時ではありません。
- actuallyListened: TRUE / FALSE（未実施では空欄可）。ソフトは実聴取を保証せず、自己申告として集計します。
- listenedStart / listenedEnd: 実際に聴いた source 秒。音声内の相対秒ではありません。
- A_ / B_ の各観点: ${criteria.join(" / ")}。
  missingSpeech=聴こえる発話の欠落、unsupportedOutput=音声で支持できない出力、unnecessaryRepetition=不要な反復、seamCorrespondence=分割接続点の対応。A/B の両方で同じ観点を記入します。
- 各観点の値: ${issueValues.join(" / ")}。未確認／問題を観察せず／問題を観察／判断不能、の順です。問題なしは無誤りの保証ではありません。
- overall: ${overallValues.join(" / ")}（未完了は空欄可）。A/B はその区間の比較、EQUAL=同等、UNJUDGEABLE=比較不能。自動の総合勝者には変換しません。
- notes: 自分の観察と根拠。否定的な評価でも有効です。生成例を実際の人手評価としてコピーしないでください。
- referenceUse: ${referenceUses.join(" / ")}。未申告／参照を見なかった／見た／不明。REVIEWED または UNJUDGEABLE では NOT_DECLARED は使用できません。

REVIEWED と UNJUDGEABLE の両方に、実聴取 TRUE、実日時、全評価区間の聴取申告、A/B 全8観点の確認、overall、空でない notes が必要です。UNJUDGEABLE の overall は UNJUDGEABLE にします。判断不能を無理に問題なしへ変更しないでください。

CSV のカンマ・改行・引用符を含むセルは二重引用符で囲み、内部の引用符を二重にします。中性の書式例: "SYNTHETIC example, quoted ""word"""。表計算の数式を有効にせず、= や + 等で始まるメモは文字データとして扱います。不明な追加列は警告になり元バイトが残ります。行の重複、他bundleのID、不正な値や不足列はエラーです。

## 検証と集計

コード側の CLI を使用する場合:

\
    npm run experiment:subtitle-tool:bounded-content-review -- verify --bundle "/path/to/bundle"
    npm run experiment:subtitle-tool:bounded-content-review -- summarize --bundle "/path/to/bundle" --annotations "/path/to/bundle/review/content-review.csv" --output-root "/path/to/new-summaries"

入力と重ならない新しい出力先を指定します。集計は読み取ったCSVの原バイトを別ディレクトリへ固定します。

- 終了0: 入力が有効で記入処理が完了（全件判断不能でもあり得ます）。字幕の品質承認ではありません。
- 終了1: 入力・検証・技術エラー。可能な場合は input-validation.json と annotation-snapshot.csv を確認して、自分のCSVを修正します。
- 終了2: 入力は有効だが記入未完了、または明示された準備上の未解決事項。

層化12・接続点36・追加5の群は別々に集計されます。declaredListenedEvaluationSampleUnion は判断不能も含む聴取申告の和集合、contentJudgeableEvaluationSampleUnion は REVIEWED かつ全観点と overall が判断可能な項目の和集合です。重複区間は独立した発話数ではなく、聴取時間や件数を誤り率と解釈しません。

## 文字列診断と承認の境界

[全文比較](comparison/reference-comparison.json)は全raw A/R・B/R の事後的な Unicode 文字編集診断です。R→機械の置換S・削除D・挿入Iを数え、(S+D+I)/N を表示します。exact-visible-v1 は可視空白・改行・句読点を保持し、whitespace-only-v1 は明示された Unicode White_Space だけを除きます。語形・仮名・句読点・反復は正規化しません。B の分割コンテキスト重複も含まれるため、組立字幕の CER や音声誤り分類ではありません。反復部分の編集位置は曖昧になり得ます。区間別の数値 CER はありません。

全件記入後も fullTimedExport=blocked、qualityStatus=needs-review、CER=NOT_MEASURED、humanValidated=false、finalizationMethod=none、machineOnlyReleaseAuthorized=false を保持します。参照の取り込み、ZIP検証、ブラウザー再生確認は人手内容評価を代行しません。
`;
}
