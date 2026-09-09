# Frozen-evidence content review

This opt-in command prepares a **private** listening handoff and validates human-declared annotations. It does not run recognition, VAD, FFmpeg, alignment, models, providers or network APIs. Product defaults, subtitle text and subtitle times are unchanged. It uses the existing frozen raw-evidence reader and read-only diagnostic-revision verifier; it never invokes a report writer against production evidence.

## Commands

Use Node 24 and npm 11, the unchanged lockfile, and `npm run build:subtitle-tool` first. All placeholders below are user-supplied paths, not paths inferred from historical metadata.

```sh
npm run experiment:subtitle-tool:bounded-content-review -- prepare \
  --manifest "<old-run>/experiment.json" \
  --diagnostics "<strict-diagnostic-revision>" \
  --audio-root "<authorized-old-run>" \
  --output-root "<new-handoff-parent>" \
  --export-listening-audio

npm run experiment:subtitle-tool:bounded-content-review -- verify \
  --bundle "<new-handoff-parent>/bundle-<identity>"

npm run experiment:subtitle-tool:bounded-content-review -- summarize \
  --bundle "<new-handoff-parent>/bundle-<identity>" \
  --annotations "<explicit-human-annotation.csv>" \
  --output-root "<separate-summary-parent>"
```

Without `--export-listening-audio`, prepare exports zero WAVs and reports `METADATA_ONLY_NOT_LISTENING_READY`. It still authenticates authorized saved WAVs. With explicit export, prepare produces derived listening WAVs, not new ASR windows. Missing saved WAVs block listening for the entire bundle because the common source PCM can no longer be authenticated end to end. There is no extraction fallback. Wrong hashes, symlinks, traversal, inconsistent revisions or corrupt identities fail closed.

Exit codes: **0** = technical prepare/verify completed, or a complete valid human-declared summary; **2** = requested listening audio blocked, or incomplete/invalid human annotation rows; **1** = input identity, binding, malformed file/UTF-8, filesystem or output conflict. A zero exit is never subtitle-quality acceptance. A malformed CSV syntax is recorded as validation failure in an immutable summary with exit 2; an unreadable annotation file exits 1.

## Listening contract

The original main review plan is copied byte for byte, including IDs, cohort, source intervals, stratified/seam kinds and original full-raw evidence identity. Targeted cases are separate: B raw-invalid records are grouped by request and use the full request interval; A invalid finite in-source starts use fixed-minimum clusters of at most one second plus two-second context. Invalid/unlocatable records remain in the full raw index. Long repetitions in an already selected request do not generate extra clips. Serialized-only failures and other stored risks are indexed, not expanded into additional audio targets.

Limits are 8 targeted clips, 32 seconds per targeted playback clip, 56 clips total and 600 seconds summed playback. Candidates exceeding a limit have explicit exclusion records. The target plan is written before audio export.

Each authorized request WAV must match its reserved ledger SHA-256, planned PCM SHA-256, integer frame count, PCM16 mono format and 16 kHz rate. Only disjoint core sample subranges contribute to reconstructed source PCM. Context is not concatenated twice. The full core partition must match the original saved PCM hash before any clip is exported. No full reconstructed audio file is written. Each derived file is reread and its samples compared independently against source chunk subranges. The portable verifier rechecks all frozen files, WAV headers, frame counts, PCM/file hashes, sample maps and referenced request pages without access to the original source.

Evaluation supports use exact decimal rational arithmetic: `[ceil((start-offset)*rate), ceil((end-offset)*rate))`. Playback uses one second on each side with enclosing floor/ceil rounding, clipped only at physical source limits. Original evaluation timestamps are never changed. The map records integer sample indices, original times, rounded times, deltas, clip-relative evaluation positions and source-chunk pieces. Sample deltas are descriptive, not subtitle corrections.

Open `listening-index.html` directly. Native audio controls and local relative links require no server, JavaScript, fetch, CDN, framework, fonts or tracking. Listen and write notes before expanding A/B. This is **not blind**. Full raw request SRT bytes and full JSON are retained. Candidate labels are `TIME_OVERLAP_HINT`, `POINT_HINT` and `REQUEST_CONTEXT_ONLY`; `UNLOCATED` records remain in the full/unlocalized request area. Full and adjacent request links allow comparison without hiding broken or long candidates. Empty candidates do not establish silence or missing dialogue. Old and strict partial dispositions are auxiliary metadata, not the evaluation target.

## Human-declared CSV

The immutable `content-review-template.csv` initializes **only once** the mutable `review/content-review.csv`. Existing notes, malformed edits and a missing CSV are never reset by prepare or verify. Edit only the mutable file, and pass its path explicitly to summarize. Nothing reads or edits the old review CSV.

Required columns:

- `reviewId`, `bundleIdentity`, `status`
- Optional identifying `reviewer` (column required, value may be empty)
- `reviewedAt` (ISO date/time with timezone), `actuallyListened` (`TRUE`/`FALSE`), `listenedStart`, `listenedEnd` (source seconds)
- Each of `A_` and `B_` followed by `missingSpeech`, `unsupportedOutput`, `unnecessaryRepetition`, `seamCorrespondence`
- `overall`, `notes`

Status: `NOT_PERFORMED`, `IN_PROGRESS`, `REVIEWED`, `UNJUDGEABLE`. Issue values: `NOT_CHECKED`, `NO_ISSUE_OBSERVED`, `ISSUE_OBSERVED`, `UNJUDGEABLE`. Overall: `A`, `B`, `EQUAL`, `UNJUDGEABLE` (empty while unfinished).

Both completed statuses require `actuallyListened=TRUE`, a valid timestamp, a declared interval covering the entire evaluation interval inside the playback bounds, every A/B criterion checked, an overall response and nonempty notes. UNJUDGEABLE requires overall UNJUDGEABLE. The software records declarations, not proof of listening. It never invents a reviewer or fills verdicts.

CSV parsing supports quoted commas, quotes, CRLF/newlines and Unicode. Unknown columns generate warnings and their original bytes survive the snapshot. Duplicate IDs count once as invalid; foreign IDs do not enlarge the planned denominator. Foreign bundle identity, malformed values and missing rows are invalid. HTML displays are escaped. Formula-like CSV text is flagged but not executed or rewritten; use a text/CSV editor and never enable spreadsheet formulas on these files.

Summaries snapshot exact annotation bytes and hash them with bundle/schema/code identity into a separate immutable output directory. Stratified, seam and targeted groups each have disjoint planned/not-performed/in-progress/reviewed/unjudgeable/invalid-or-missing counts. A/B criterion denominators are paired on the same items; either-side UNJUDGEABLE is excluded from both sides of that criterion and reported separately. Negative comparisons are valid observations. Reviewed time is the union of declared fully listened evaluation sample intervals, not playback padding, and includes fully listened but unjudgeable intervals. Overlapping items are not independent utterances and issue counts are not hallucination rates. No CER is calculated and no automatic winner is declared.

## Integrity and authority

Identity includes evidence/freeze/raw collection, diagnostic revision, main/targeted plans, sample policy, source PCM, source authentication, presentation/annotation versions, code fingerprints and export flag. It excludes wall time and private absolute paths. Atomic staged publication and an exclusive per-identity lock prevent partial publication and concurrent overwrites. Existing identity/content conflicts fail rather than repair. Human CSV files are excluded from the machine freeze; annotations are immutable only in a separately published summary.

`LISTENING_HANDOFF_READY` and `AWAITING_HUMAN_REVIEW` may both be true. Even a complete valid CSV leaves `fullTimedExport=blocked`, `qualityStatus=needs-review`, `CER=NOT_MEASURED`, `humanValidated=false`, `finalizationMethod=none`, `machineOnlyReleaseAuthorized=false` and `productDefaultChanged=false`. A media-player smoke test is not content review.

Audio, raw subtitles and annotations are **PRIVATE / NOT FOR PUBLIC DISTRIBUTION**. Publish only source, synthetic tests and sanitized documentation. A portable handoff ZIP should contain the bundle and optional summary, not original full video, all 37 request WAVs, models, credentials, fonts, dependency trees or research caches.

## Focused verification

```sh
node --test tests/bounded-content-review.mjs tests/bounded-timestamp-diagnostics.mjs tests/bounded-longform-flow.mjs
npx --no-install vitest run tests/bounded-longform.test.ts tests/subtitle-tool.test.ts tests/subtitle-recovery.test.ts tests/e2e/subtitle-recovery.test.ts --maxWorkers=2
```

The content-review tests use neutral synthetic PCM and mock historical inference only. Do not run `tests/e2e/subtitle-tool.test.ts` in this task: that older suite launches FFmpeg. Production generation invokes no new recognition or media process.
