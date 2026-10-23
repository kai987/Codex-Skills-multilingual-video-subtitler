# Historical reference comparison and review usability

This downstream, opt-in extension consumes an already verified `frozen-content-review-v1` listening bundle. It never runs `prepare`, ASR, VAD, audio slicing, a model, FFmpeg or subtitle finalization. Existing workflows/defaults are unchanged. The old v1 CSV remains readable under its original columns. Invalid annotation input now takes precedence over incompleteness: exit 1, versus valid unfinished 2 and valid completed 0.

```sh
npm run build:subtitle-tool
npm run experiment:subtitle-tool:bounded-content-review -- attach-reference \
  --bundle "/explicit/existing/bundle" \
  --reference "/explicit/reference/original.ass" \
  --reference-evidence "/explicit/reference/REFERENCE_INPUTS.json" \
  --output-root "/new/reference-handoffs"
npm run experiment:subtitle-tool:bounded-content-review -- verify --bundle "/new/reference-handoffs/bundle-ID"
npm run experiment:subtitle-tool:bounded-content-review -- summarize \
  --bundle "/new/reference-handoffs/bundle-ID" \
  --annotations "/new/reference-handoffs/bundle-ID/review/content-review.csv" \
  --output-root "/new/reference-summaries"
```

All input files must be explicit regular files. Symlinks, traversal, overlapping input/output trees and byte conflicts fail; no nearby filename fallback or historical absolute media/model path lookup occurs. The CLI takes an extracted index, not an arbitrary ZIP. If extracting a supplied ZIP, first reject absolute/traversal/backslash/symlink members and ambiguous duplicate targets. Never extract over existing data.

## Explicit input inventory

`REFERENCE_INPUTS.json` is an unsigned byte inventory, not new human certification. Its strict version is `reference-inputs-v1`, with `inventoryAuthority: BYTE_INVENTORY_ONLY_NOT_NEW_HUMAN_CERTIFICATION` and a `files` object containing exactly `reference`, `humanBaseline`, `finalization`, `reviewPackage`, and `experiment`. Each value contains relative `path`, byte `size`, and `sha256`. No file names or real-media hashes are hard-coded in runtime logic. Same bytes under a different name are accepted; equal-size different bytes are not.

The explicit ASS must match both index bytes and the old finalization's `humanReviewedBaseline` SHA/size/authority. The original human base package byte hash must equal both finalization and review-package base hashes. Every parsable ASS cue must match base text (using the old importer's pure cleaner only for this correspondence), timing and mapped style. The review source SHA must match the experiment baseline source SHA; experiment bytes, plan, PCM and offset must bind to the frozen parent. Saved identity proof is not a new read of the source media or acoustic validation.

The original ASS is copied byte-for-byte to `reference/source.ass`, with necessary original provenance JSON. Parent manifest and freeze are preserved under `parent/`. Review plans, items, candidates, raw files, audio maps and WAVs are ordinary byte copies, not links; the old mutable CSV is never copied or modified. All machine files are frozen. Only `review/` remains outside the machine freeze. Publication uses exclusive staging and per-identity locks, cancellation cleanup, immutable reuse checks and no repair-on-conflict.

## Parsing and comparison

The new ASS parser consumes each Events Format field in order, requiring a last Text field and uniquely parsed clock fields. A decimal comma is accepted only inside a uniquely identified clock, with original/parsed spelling and line/field audit. Unparseable records remain visible and make text comparison NOT_COMPUTABLE; uncertain override/drawing interpretation is explicitly retained. Known override removal and `\N`/`\n` to newline, `\h` to space follow existing control semantics, but the diagnostic deliberately does **not** apply the old canonical importer's whitespace trimming. Original raw spans are retained per visible character. Music is included. No reference file is rewritten.

Reference association uses source-time intersection only, without reapplying offsets. Evaluation and playback-context intersections are different labels. Whole long records remain intact; an absent association is not a silence decision. No per-item numerical CER is produced.

Full comparison concatenates each original raw record once, A in response order and B in frozen chunk/request order, with an empty separator. Invalid timings and overlapping request repetitions remain. Reference uses original Dialogue order. `exact-visible-v1` preserves code points, whitespace and punctuation; `whitespace-only-v1` removes only the enumerated Unicode White_Space set. No normalization of width, kana, case, punctuation, dialect, combining marks or repetitions occurs.

Standard Unicode-code-point Levenshtein runs R→machine, with deterministic reverse traceback priority match, substitution, deletion, insertion. M/S/D/I, N, machine length, distance, ratio and a provenance-linked edit sequence are saved. M+S+D=N, M+S+I=machine length and S+D+I=distance are checked. The preflight cap is 25,000,000 DP cells; empty reference, incomplete text or cap excess yields null NOT_COMPUTABLE, never truncated text or a zero error ratio. Ratios above 1 remain above 1. These are post-hoc FULL_RAW_TO_HISTORICAL_REFERENCE diagnostics, not assembled subtitle CER, acoustic classifications, significance tests or automatic winner decisions.

## Human review and delivery

The native-audio HTML keeps A/B/R in closed details. Listen and write observations before revealing A/B, then optionally R. The generated Japanese `REVIEW_GUIDE.md` is self-contained; allowed values come from the actual CSV schema. The new v2 CSV adds `referenceUse` with NOT_DECLARED / NOT_VIEWED / VIEWED / UNKNOWN. Both completed statuses require a non-NOT_DECLARED value. Names remain optional; actual timezone-bearing datetime, listening declaration, full source interval, paired criteria and notes remain required. NOT_VIEWED alone proves no blinding.

Summaries snapshot exact CSV bytes and include evaluator code, schema and exit-contract identity. Declared-listened sample union includes judged and unjudgeable listening; content-judgeable sample union requires REVIEWED and no unjudgeable overall/criterion. The older `reviewedEvaluationSampleUnion` remains a compatibility alias for declared listening. No synthetic observation is added to real CSVs.

`REFERENCE_ASSISTED_HANDOFF_READY`, `RAW_REFERENCE_COMPARISON_READY` and `AWAITING_HUMAN_REVIEW` coexist. Historical reference import grants neither validated Gold nor current review completion. Retain old package status separately from old finalization status/method and review count. Keep full timed export blocked, needs-review, CER NOT_MEASURED, humanValidated false, finalization none and release authorization false.

Materialization counters describe the construction derivation only; verifier rereads and recomputation are returned separately, not incorrectly inherited as new ASR. Private execution receipts record actual invocations. Browser/audio smoke scope must be stated separately from content listening. Only code, neutral tests and sanitized reports may be pushed; private ZIPs contain no full source video, full request-audio set, models, credentials, dependencies or public-release claim.

Neutral tests: `node --test tests/historical-reference-review.mjs tests/bounded-content-review.mjs tests/bounded-timestamp-diagnostics.mjs tests/bounded-longform-flow.mjs`. Use the focused offline Vitest suites named in BOUNDED_CONTENT_REVIEW.md, not the old FFmpeg E2E.
