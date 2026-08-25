# C5.15.1 Timestamp Evidence Integrity & VAD Timeline Repair

Date: 2026-08-25 (Asia/Tokyo)

This report records the implementation and real acceptance run for **C5.15.1 — Token Timestamp Evidence Integrity & VAD Timeline Repair**. The acceptance criterion is evidence safety, not reducing the seven review components. The run kept the human-reviewed text and all canonical times unchanged.

## 1. Development branch and baseline

- Repository: `https://github.com/kai987/Codex-Skills-multilingual-video-subtitler`
- Baseline branch: `codex/c5-15-targeted-acoustic-overlap-resolution`
- Baseline commit: `9dd78a01b6fc366d36c6d4809ea66aced1a606c1`
- Development branch: `codex/c5-15-1-timestamp-evidence-integrity`
- Development did not use `main`, rewrite the C5.15 branch, or overwrite either C5.15 output.

## 2. C5.15 P0 reproduction

The legacy C5.15 artifact was audited independently before the repair. The old path treated each returned token as ordinary extraction-local time and materialized global time as:

```text
globalStart = extractionStart + token.start
globalEnd   = extractionStart + token.end
```

The legacy path did not first prove parent-segment containment, determine the coordinate system, validate chronology, quarantine large drift, quarantine zero-collapse, or quarantine extraction-boundary clamping. It also derived `speechIntervals` from decoded segments and could label such intervals as `vad`, then selected a representative interval using source order with token-first behavior and deterministic `attemptId` tie-breaking. These observations were confirmed from the baseline source and the independently generated audit artifact, rather than inferred from the previous development report.

## 3. Legacy 56-group audit

Command executed:

```bash
npm run audit:c5-15-token-timestamps -- \
  --input "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-targeted-acoustic-overlap-resolution-20260825/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無]/subtitle-overlap-acoustic-resolution.json" \
  --output "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-1-timestamp-integrity-20260825/c5-15-legacy-token-timestamp-audit.json"
```

Observed legacy totals:

| Metric                             |  Result |
| ---------------------------------- | ------: |
| Segment-token groups               |      56 |
| Failures at ±50 ms                 |      35 |
| Failures at ±200 ms                |      31 |
| Token starts more than 50 ms early |      25 |
| Token ends more than 50 ms late    |      14 |
| Zero-duration lexical tokens       |      34 |
| Extraction-boundary-clamped tokens |      38 |
| Maximum absolute drift             | 10.47 s |

Profile aggregation reproduced the supplied baseline: `current-sensitive-vad` 17 groups / 12 failures, `no-vad` 20 / 16, and `extra-sensitive-vad` 19 / 7 at ±50 ms.

## 4. Thirty-five containment failures

The independent audit reproduced exactly 35 of 56 legacy segment-token groups outside the ±50 ms audit tolerance. At the wider ±200 ms trust tolerance, 31 groups still failed. The result confirms that the issue was not a harmless rounding-only condition and that several-second tolerance widening would be unsafe.

## 5. The 10.47-second drift case

Component 2 reproduced the required anomaly:

```text
Parent decoded segment: 411.020–411.860
Attached token range:   400.550–401.390
Maximum early drift:    10.47 s
```

The short lexical content was retained for lexical comparison, but the interval is no longer mapped by adding the extraction offset and can no longer participate in timing.

## 6. Current whisper-server token timestamp source

The installed runtime is Homebrew whisper.cpp 1.9.1. Its observed `verbose_json` response exposes word/token times from the raw server token data (`whisper_token_data.t0/t1` behavior), while decoded segment times are produced on the original extraction timeline. A live behavior probe logged distinct original segment bounds and compressed VAD bounds, showing that VAD-profile token JSON and decoded segment JSON do not share a safely interchangeable coordinate system.

The official v1.9.2 header exposes mapped token and raw VAD getters, but the official v1.9.2 server serializer still writes word time from raw `token.t0/t1` and does not serialize raw VAD intervals. Sources inspected:

- `https://github.com/ggml-org/whisper.cpp/blob/v1.9.2/include/whisper.h`
- `https://github.com/ggml-org/whisper.cpp/blob/v1.9.2/examples/server/server.cpp`

Therefore an API existing upstream is not treated as proof that the installed server uses it.

## 7. Runtime timestamp capability probe

The real artifact records only the binary basename and non-secret capabilities:

| Capability              | Observed value                                                     |
| ----------------------- | ------------------------------------------------------------------ |
| whisper.cpp version     | 1.9.1                                                              |
| Binary basename         | `whisper-server`                                                   |
| Binary SHA-256          | `77a238b5c7e4d4c15c96c2709847fed9e78257c7ceed0802b1c538eadb94424a` |
| Source commit           | unavailable for installed bottle                                   |
| Server format           | `verbose_json`                                                     |
| Token timestamp control | available                                                          |
| Probe method            | `local-binary-help-version-and-observed-server-json-v1`            |
| Capability status       | `legacy-vad-unmapped`                                              |
| Capability hash         | `3dde68f386dedfc72013ea0d5f7272723db12a2a7a9fa806e89c01756c5eb601` |

The local version remained 1.9.1; no system binary was upgraded or replaced. Homebrew advertised 1.9.2 as current stable during the investigation, but that was not used to claim runtime capability.

## 8. Mapped token getter support

The installed server did not expose or prove actual use of `whisper_full_get_token_t0()` / `whisper_full_get_token_t1()` in its JSON response. Artifact values are therefore:

```text
mappedTokenGetterAvailable = false
mappedTokenGetterActuallyUsed = false
mappedVadTokenCount = 0
```

## 9. Raw VAD getter support

The installed server did not expose `whisper_full_n_vad_segments()` or the raw VAD segment getters in its response. Artifact values are:

```text
rawVadGetterAvailable = false
rawVadGetterActuallyUsed = false
rawVadIntervalsAvailable = false
rawVadIntervalCount = 0
```

Decoded segments are not substituted for missing raw VAD islands.

## 10. Time-coordinate model

The shared schemas now distinguish:

| Coordinate              | Meaning                                         | Timing eligibility                               |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `original-audio-local`  | Time in an extracted WAV with silence preserved | May map by verified extraction offset            |
| `original-media-global` | Time in the source-media timeline               | Required for final timing evidence               |
| `vad-processed-local`   | Time in the VAD-compressed timeline             | Ineligible until an explicit verified map exists |
| `segment-relative`      | Time relative to a declared parent segment      | Ineligible unless declared and fully verified    |
| `unknown`               | Semantics cannot be proved                      | Always ineligible                                |

No coordinate is guessed from numerical proximity.

## 11. Raw and mapped token data model

Each token can retain `rawStart`, `rawEnd`, and `rawCoordinateSystem` independently of nullable `mappedStart`, `mappedEnd`, and `mappedCoordinateSystem`. It also records `mappingMethod`, `mappingVersion`, and `mappingConfidence`. Mapping methods cover identity original-local, official mapped getter, verified segment-relative offset, verified VAD map, unmapped, and quarantined paths. Raw values are never overwritten. Failed mappings remain `null`; large errors are not hidden by clamping.

The deprecated `tokenTimestampsUsed` now mirrors `trustedTokenTimestampsUsed`, not merely “tokens were returned.” Requested, returned, available, and actually used counts are separately recorded.

## 12. Health-check algorithm

`packages/transcription-core/src/timestamp-evidence-integrity.ts` centralizes the checks. It separates special/control tokens from the lexical denominator, validates finite ordered endpoints, positive duration, invalid replacement characters, token chronology, parent/extraction containment, early/late drift, and boundary clamping. It calculates segment and attempt metrics, emits explicit `tokenTimelineStatus` values and all `quarantineReasons[]`, and maps only after the raw coordinate meaning is proved.

Special tokens such as `_BEG_` are counted separately. OOV or missing reading information affects lexical alignment only and cannot make a timestamp healthy or unhealthy.

## 13. Central thresholds

The exact configuration is written to `subtitle-timestamp-evidence-integrity.json`:

| Setting                                |                          Value |
| -------------------------------------- | -----------------------------: |
| Audit containment tolerance            |                         0.05 s |
| Trust containment tolerance            |                         0.20 s |
| Hard maximum drift                     |                         0.50 s |
| Maximum zero-duration lexical ratio    |                           0.20 |
| Maximum boundary-clamped lexical ratio |                           0.20 |
| Minimum usable lexical ratio           |                           0.70 |
| Minimum decision margin                |                           0.10 |
| Mapping version                        | `c5.15.1-original-timeline-v1` |
| Health-policy version                  |      `c5.15.1-token-health-v1` |

These are general policies; no component, cue, or dialogue text is hard-coded.

## 14. Quarantine rules

A token sequence is quarantined when its coordinate is unknown or VAD-processed without a verified map, it lacks a valid parent, crosses the parent/extraction boundary beyond tolerance, has drift above 0.50 s, is non-monotonic, collapses excessively to zero duration, is excessively boundary-clamped, or fails the usable-ratio gate. Quarantined tokens preserve lexical text but have no usable mapped interval.

Eight hard final-integrity codes are implemented and tested: `UNTRUSTED_TOKEN_USED_FOR_TIMING`, `UNKNOWN_COORDINATE_TOKEN_USED_FOR_TIMING`, `TOKEN_OUTSIDE_PARENT_SEGMENT_USED`, `NON_MONOTONIC_TOKEN_SEQUENCE_USED`, `ZERO_COLLAPSED_TOKEN_SEQUENCE_USED`, `LEGACY_UNVERSIONED_TOKEN_USED_FOR_TIMING`, `DECODED_SEGMENT_MISLABELED_AS_RAW_VAD`, and `TIMESTAMP_CAPABILITY_CLAIM_UNVERIFIED`.

## 15. Trusted-token admission

A token can affect matched intervals, boundary consensus, pair assessment, counterfactual timing, or timing-only repair only when it maps to `original-media-global`, has a `trusted*` status, is monotonic and contained by a valid parent, has no hard drift/clamp condition, and passes the centralized policy. Token text and token timing are separate capabilities. An untrusted token can improve lexical surface/reading comparison, but cannot improve temporal coverage or boundary confidence, reduce neighbor intrusion, or authorize mutation.

The three CLI modes have distinct, tested behavior. `off` uses the C5.15 legacy artifact/classification view and legacy cache identity. `observe` writes the audited view and integrity artifact while classifying through the legacy compatibility view, reports unsafe timing use, and prohibits timing mutation. `enforce` uses only the audited view for both artifact and classification. The normal CLI default is `observe`; the C5.15.1 replay default is `enforce`.

## 16. Legacy VAD fallback

For the actual whisper.cpp 1.9.1 runtime, all VAD-profile token timing is classified as `vad-processed-local` and quarantined unless a mapped getter is explicitly proven and actually used. Its text remains lexical evidence. Decoded segment time remains `decoded-segment` evidence. Health-validated no-VAD tokens may use `identity-original-local` followed by the verified extraction offset. This makes the existing runtime safe without replacing it.

## 17. Raw VAD and decoded-segment separation

Every attempt now has four separate evidence collections: `decodedSegmentIntervals`, `mappedTrustedTokenIntervals`, `rawVadIntervals`, and `sourceCueIntervals`. The legacy `speechIntervals` remains parse-compatible only. New output does not count `segments.map(...)` as independent VAD evidence, and VAD-enabled decoded segments are labeled `decoded-segment`, not `raw-vad`.

## 18. Representative-interval ordering

Representative selection is now trust-aware and deterministic. It orders by timing usability/status, timing trust, alignment, parent containment, cross-profile consensus, boundary confidence, neighbor intrusion, source quality, and only then deterministic ID. Source priority is trusted mapped token, trusted healthy no-VAD token, trusted raw VAD, validated decoded segment, then source cue. Untrusted token timing is excluded rather than ranked. `attemptId` is no longer the deciding quality signal.

## 19. Boundary consensus

Consensus accepts only `timingUsable=true` intervals. Duplicate token sequences within one attempt are deduplicated; profile support, source-type support, and model support are separate counts. Three profiles from one `large-v3` model remain one model. A decoded segment and a legacy speech alias derived from it are not double-counted. Raw VAD, if available, would be an independent source type but not a new model.

## 20. Classification-score semantics

Artifacts now persist `bestHypothesis`, `bestHypothesisScore`, `runnerUpHypothesis`, `runnerUpHypothesisScore`, `decisionMargin`, and `scoreCalibrationStatus`. This run records `uncalibrated-heuristic`; values such as 0.60 are rule scores, not correctness probabilities. Deprecated `classificationConfidence` equals the best score. Automatic closure also requires the centralized 0.10 margin, in addition to every existing safety gate.

## 21. Cache identity upgrade

Portable overlap cache identity now includes `timestampMappingVersion`, `timestampCoordinateSystem`, `tokenHealthPolicyVersion`, and `runtimeTimestampCapabilityHash`. Output directories remain outside the key. A runtime-capability or mapping-policy change causes a miss. The fresh run wrote 21 new entries under the C5.15.1 identity.

## 22. Legacy-cache handling

The default `--legacy-overlap-cache-policy reject` prevents unversioned C5.15 overlap tokens from being a cache hit. `text-only` can reuse legacy raw text but marks token timing `legacy-unversioned` and untrusted. There is deliberately no option to allow untrusted legacy timing and no silent upgrade to trusted.

## 23. Schemas

Added:

- `schemas/subtitle-timestamp-evidence-integrity.schema.json`
- `packages/shared/src/timestamp-evidence-integrity-schemas.ts`

Extended while retaining legacy parsing:

- `schemas/subtitle-overlap-acoustic-resolution.schema.json` (`C5.15` and `C5.15.1`)
- `schemas/portable-asr-cache-entry-v2.schema.json`
- `schemas/subtitle-presentation-resolution.schema.json`
- corresponding strict Zod schemas in `packages/shared/src/`

New shareable JSON uses only relative/basename paths; its strict schema rejects absolute paths and incompatible trusted/quarantined references.

## 24. Modified-file inventory

Added implementation/test/report files:

- `C5_15_1_TIMESTAMP_EVIDENCE_INTEGRITY_REPORT.md`
- `packages/shared/src/timestamp-evidence-integrity-schemas.ts`
- `packages/transcription-core/src/timestamp-evidence-integrity.ts`
- `schemas/subtitle-timestamp-evidence-integrity.schema.json`
- `scripts/audit-c5-15-token-timestamps.ts`
- `scripts/validate-c5-15-1-runs.ts`
- `tests/c5-15-1-timestamp-evidence-integrity.test.ts`
- `tests/fixtures/c5-15-token-timestamp-audit.json`

Modified runtime/docs/schema files:

- `.agents/skills/multilingual-video-subtitler/SKILL.md`
- `.agents/skills/multilingual-video-subtitler/references/adaptive-transcription.md`
- `README.md`
- `apps/cli/src/index.ts`
- `package.json`
- `packages/shared/src/index.ts`
- `packages/shared/src/overlap-acoustic-resolution-schemas.ts`
- `packages/shared/src/presentation-resolution-schemas.ts`
- `packages/shared/src/transcription-schemas.ts`
- `packages/transcription-core/src/asr-cache.ts`
- `packages/transcription-core/src/index.ts`
- `packages/transcription-core/src/overlap-acoustic-resolution.ts`
- `packages/video-subtitler/src/finalization.ts`
- `packages/video-subtitler/src/overlap-acoustic.ts`
- `schemas/portable-asr-cache-entry-v2.schema.json`
- `schemas/subtitle-overlap-acoustic-resolution.schema.json`
- `schemas/subtitle-presentation-resolution.schema.json`
- `scripts/generate-schemas.ts`
- `scripts/replay-c5-15-overlap.ts`

No output, cache, model, video, audio, or binary is part of the Git change.

## 25. Seven-component reclassification

The old and new top scores below are uncalibrated rules. `T/Q` counts are unique token intervals actually matched to the component's cues; global attempt totals are reported later. “Representative” lists the selected timing source and interval for each cue; `none` means no safe representative.

|   # | Old best / runner          | Old token evidence                                  | New T/Q | New decoded / raw VAD | New representative intervals                   | New best / runner / margin           | Result                                     |
| --: | -------------------------- | --------------------------------------------------- | ------: | --------------------: | ---------------------------------------------- | ------------------------------------ | ------------------------------------------ |
|   1 | rapid 0.45 / ordered 0.30  | 6 matched tokens; legacy `speech/token/vad` aliases |     0/0 |                   6/0 | decoded 58.58–60.87; decoded 60.23–60.89       | rapid 0.45 / ordered 0.30 / 0.15     | unresolved, blocking, no mutation          |
|   2 | nested 0.35 / ordered 0.25 | no matched interval; 10.47 s attempt drift present  |     0/0 |                   0/0 | none; none                                     | nested 0.35 / ordered 0.25 / 0.10    | unresolved, blocking, no mutation          |
|   3 | rapid 0.45 / ordered 0.30  | 20 matched tokens; `speech/token` aliases           |     0/5 |                   3/0 | decoded 437.11–442.02; decoded 437.19–442.02   | rapid 0.45 / ordered 0.30 / 0.15     | unresolved, blocking, no mutation          |
|   4 | ordered 0.25 / rapid 0.15  | 70 matched tokens, token-first                      |    6/25 |                   2/0 | trusted no-VAD token 688.21–689.34; none; none | ordered 0.25 / rapid 0.15 / 0.10     | unresolved, blocking, no mutation          |
|   5 | rapid 0.45 / ordered 0.30  | 13 matched tokens; `token/vad` aliases              |     0/2 |                   4/0 | decoded 701.29–702.28; decoded 702.28–705.06   | rapid 0.60 / ordered 0.55 / **0.05** | unresolved; margin below 0.10; no mutation |
|   6 | rapid 0.60 / ordered 0.55  | 41 matched tokens, token-first                      |     0/0 |                   3/0 | decoded 773.95–777.92; none                    | rapid 0.35 / ordered 0.25 / 0.10     | unresolved, blocking, no mutation          |
|   7 | nested 0.35 / ordered 0.25 | no matched interval                                 |     0/0 |                   0/0 | none; none; none                               | nested 0.35 / ordered 0.25 / 0.10    | unresolved, blocking, no mutation          |

All seven components were recomputed; no old decision was copied forward. All retained `finalRelationship=unresolved`, `recommendedAction=review`, `safeAutomaticAction=none`, and `blocking=true` because the evidence remained insufficient. The empty `timestampIntegrityGateFailures` arrays mean no forbidden timestamp entered a decision; they do not mean there was enough evidence to resolve the review blocker.

## 26. Timing mutations

There were no timing proposals or applied timing mutations for any component. Before and after canonical cue times are identical. Totals:

```text
timingMutationCount = 0
midpointRepairCount = 0
characterRatioRepairCount = 0
canonicalTextMutationCount = 0
```

## 27. Fresh uncached real run

The run used the user-supplied video, audio track 1, seven bounded WAVs, local `ggml-large-v3.bin`, three profiles, the local Silero VAD model, no network, no OpenAI API, and no whole-media ASR.

| Metric                                 |              Result |
| -------------------------------------- | ------------------: |
| Components / cues / WAVs               |          7 / 16 / 7 |
| Fully covered review WAVs              |               7 / 7 |
| Profile attempts                       |                  21 |
| Actual local ASR requests              |                  21 |
| Cache hits                             |                   0 |
| Worker starts / model loads / warm-ups |           1 / 1 / 1 |
| Fallback processes                     |                   0 |
| Whole-media ASR requests               |                   0 |
| Initialization / model-load time       |   2.6523 / 2.6312 s |
| Transcription / worker time            | 30.7844 / 33.4366 s |
| Observed analysis wall clock           |           37.6093 s |

The execution metrics report backend `cpu`; whisper.cpp logs showed its Metal path available. Core ML was not compiled/used and is not claimed.

## 28. New-cache replay

The same inputs and configuration were replayed with `--asr-cache-mode read` into a new collision-safe output:

| Metric                        |   Result |
| ----------------------------- | -------: |
| Portable cache hits           |  21 / 21 |
| Actual ASR requests           |        0 |
| Worker starts / model loads   |    0 / 0 |
| Worker requests avoided       |       21 |
| Worker starts / loads avoided |    1 / 1 |
| Worker time                   |      0 s |
| Observed wall clock           | 3.4929 s |

Fresh and replay runs have identical canonical, presentation, component-decision, runtime-capability, and timestamp-integrity hashes.

## 29. Trusted and quarantined-token totals

The fresh run audited 56 current segment-token groups and 364 lexical tokens:

| Metric                                  | Current C5.15.1 result |
| --------------------------------------- | ---------------------: |
| ±50 ms failing groups                   |                     37 |
| ±200 ms failing groups                  |                     32 |
| Non-monotonic groups                    |                      0 |
| Zero-collapsed groups                   |                      9 |
| Boundary-clamped groups                 |                     11 |
| Large-drift groups                      |                     28 |
| Maximum drift                           |                10.47 s |
| Trusted tokens                          |                     55 |
| Quarantined tokens                      |                    309 |
| Trusted tokens actually used for timing |                      6 |
| Legacy VAD tokens quarantined           |                    232 |
| Mapped VAD tokens                       |                      0 |
| Decoded segments                        |                     56 |
| Raw VAD intervals                       |                      0 |

The fresh current-run 37/32 group counts are intentionally reported separately from the legacy artifact's independently reproduced 35/31 counts.

## 30. Untrusted timing use

```text
untrustedTokenUsedForTimingCount = 0
unknownCoordinateTokenUsedForTimingCount = 0
legacyUnversionedTokenUsedForTimingCount = 0
decodedSegmentMislabelledAsRawVadCount = 0
```

No hard timestamp-integrity gate fired because unsafe evidence was quarantined before selection. The eight gate paths are covered by unit tests to fail closed if such evidence is ever referenced.

## 31. Canonical and presentation hashes

| Artifact            | SHA-256 semantic hash                                              |
| ------------------- | ------------------------------------------------------------------ |
| Canonical cues      | `8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83` |
| Canonical timing    | `510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02` |
| Presentation cues   | `9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de` |
| Timestamp integrity | `0d624aa3425ca8930af194dd935c544107d15b18a64d555e574c0192feefc602` |

Cue count remained 192. Final status is `needs-review`; `finalizationMethod=none`; review items remained 7 → 7.

## 32. SRT/VTT/ASS parity

The final validator parsed 192 cues from each SRT, VTT, and ASS. Lexical parity is true. Maximum SRT↔VTT and SRT↔ASS timing deltas are both 0 seconds. This is a real parser round trip, not only a file-count check.

## 33. Skill 2 and Skill 3 compatibility

The strict v1 subtitle package is byte-identical to the C5.15 baseline and has full-file SHA-256 `31654d2c96ad97ed05a8d8066c2cb99f6444424c46b121694e4ead15ade26c7d`. It passes the current Skill 2 strict Zod parser with 192 cues. A deterministic offline compatibility analysis produced 106 sentences and 106 grammar points; this is a compatibility check, not a newly commissioned user-facing language analysis. Its report input/copy hash is `51328261c7c3817c050c4ee985dc16d3a3ee9a54bac1e0432dcbfd3f19e8c02f`.

The current Skill 3 static builder also completed successfully from that report into `skill3-compatibility/`. Neither Skill 2 nor Skill 3 source was changed by this task. The parent `/Users/paulasmith/Documents/Codex-Skills` checkout already contains those skill directories as pre-existing untracked content, so this report does not misstate that entire parent checkout as globally clean; the C5.15.1 target repository contains no Skill 2/3 source diff.

## 34. Source-video read-only verification

Before and after both runs:

```text
size:   847,774,958 bytes
mtime:  2026-07-22T12:53:32+0900
SHA-256: 294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43
verified unchanged: true
```

## 35. Human-reviewed ASS read-only verification

Before and after both runs:

```text
size:   17,094 bytes
mtime:  2026-08-24T20:20:51+0900
SHA-256: a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e
verified unchanged: true
```

## 36. Unit and regression tests

Runtime used: Node.js 24.18.0 and npm 11.18.0. Commands executed:

```bash
npx --yes npm@11.18.0 install
npm run generate:schemas
npm run typecheck
npm run lint
npm run build
npm run format:check
npm test
```

Final result: 13 test files passed, 169 tests passed. The new suite includes the sanitized 56-group legacy audit fixture, 20 token-health cases, raw-VAD raw/mapped preservation, mode compatibility, evidence selection, cache identity/migration, strict schema/integrity gates, classification margin semantics, and uncached/replay hash parity. Existing C5.14 and C5.15 tests remain green.

## 37. E2E tests

Command:

```bash
npm run test:e2e
```

Final result: 3 E2E files passed, 10 tests passed. The flow covers VAD reset/compressed timing quarantine, healthy no-VAD and mapped-token paths, legacy runtime/cache behavior, three-cue components, unresolved fail-closed handling, and a safe timing-only mock case.

## 38. Schema count

`npm run generate:schemas` generated and validated 72 JSON Schemas (baseline was 71). Generated schemas are committed; real C5.15.1 integrity, overlap, presentation, cache, review, finalization, and package artifacts parsed successfully.

## 39. Skill validation

Command:

```bash
python3 /Users/paulasmith/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .agents/skills/multilingual-video-subtitler
```

Result: `Skill is valid!`. The skill contract now explicitly requires raw/mapped separation, lexical-only fallback, trusted timing gates, evidence-class separation, and legacy VAD/cache handling.

## 40. Dependency advisory

`npm install` audited 198 packages. It reported 5 transitive vulnerabilities: 1 moderate and 4 high, 0 critical. The advisory paths were through `brace-expansion`/ESLint-minimatch, `fast-uri`/Ajv, `nanoid`/Vite-PostCSS, `postcss`/Vite, and `undici`/Cheerio. The C5.15.1 code does not add these dependencies. No `npm audit fix --force` was run; forced lockfile/toolchain upgrades are outside this focused timestamp repair.

## 41. Unresolved issues

- All seven overlap components remain honest manual-review blockers because trusted local evidence is still insufficient; review items remain 7.
- The installed server cannot expose mapped VAD tokens or raw VAD intervals, so 232 legacy VAD lexical tokens have quarantined timing.
- Only six healthy no-VAD tokens aligned strongly enough to be used as timing evidence.
- Core ML is unavailable in this installed whisper.cpp build; the real local run still completed through the available backend.
- The dependency advisories require a separately scoped dependency update and regression cycle.

## 42. C5.16 recommendation

A future C5.16 may optionally support a user-supplied, repo-local whisper-server that serializes both raw `whisper_token_data.t0/t1` and official mapped `whisper_full_get_token_t0/t1`, plus true raw VAD intervals from `whisper_full_n_vad_segments` / `whisper_full_get_vad_segment_t0/t1`. It should capability-probe the exact binary/source commit, keep all present health gates, compare raw versus mapped coordinates, and never replace `/opt/homebrew/bin` automatically. It should not lower thresholds or infer a mapping when fields are absent.

## 43. Commands and output paths

Fresh real command:

```bash
npm run replay:c5-15-1-timestamp-integrity -- \
  --task "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-targeted-acoustic-overlap-resolution-20260825" \
  --human-reviewed-subtitle "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-13r-2-1-contradiction-audit-20260823/C-draft/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無]/machine-review-draft-contradiction-audited/machine-review-draft-contradiction-audited.ass" \
  --source-video "/Users/paulasmith/Downloads/カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].mkv" \
  --output "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-1-timestamp-integrity-20260825" \
  --audio-track 1 \
  --overlap-acoustic-resolution enforce \
  --timestamp-evidence-integrity enforce \
  --token-timestamp-policy auto \
  --legacy-overlap-cache-policy reject \
  --presentation-resolution enforce \
  --overlap-resolution conservative \
  --overlap-context-seconds 1.5 \
  --overlap-max-window-seconds 20 \
  --max-overlap-asr-requests 21 \
  --whisper-cpp-path "/opt/homebrew/bin/whisper-cli" \
  --local-transcription-model "/Users/paulasmith/.cache/whisper.cpp/ggml-large-v3.bin" \
  --whisper-vad-model "/Users/paulasmith/.cache/whisper.cpp/ggml-silero-v6.2.0.bin" \
  --coreml auto \
  --whisper-execution-mode persistent \
  --asr-cache-dir "/Users/paulasmith/.cache/mvl/c5-15-1-timestamp-integrity-20260825" \
  --asr-cache-mode read-write
```

Cache replay repeated the same command with:

```text
--output /Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-1-timestamp-integrity-cache-replay-20260825
--asr-cache-mode read
```

Parity validator:

```bash
npm run validate:c5-15-1-runs -- \
  --fresh "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-1-timestamp-integrity-20260825" \
  --replay "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-1-timestamp-integrity-cache-replay-20260825" \
  --output "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-1-timestamp-integrity-20260825/c5-15-1-uncached-cache-replay-validation-final.json"
```

Primary output paths:

- Fresh task: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-1-timestamp-integrity-20260825`
- Cache replay: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-1-timestamp-integrity-cache-replay-20260825`
- New portable cache: `/Users/paulasmith/.cache/mvl/c5-15-1-timestamp-integrity-20260825`
- Legacy audit: fresh task root `c5-15-legacy-token-timestamp-audit.json`
- Integrity artifact: fresh/replay subtitle directory `subtitle-timestamp-evidence-integrity.json`
- Overlap artifact: fresh/replay subtitle directory `subtitle-overlap-acoustic-resolution.json`
- Final parity proof: fresh task root `c5-15-1-uncached-cache-replay-validation-final.json`
- Skill 2 compatibility: fresh task root `skill2-compatibility/`
- Skill 3 compatibility: fresh task root `skill3-compatibility/`

## Final acceptance

The run met the intended safety contract: 192 canonical cues, zero automatic text or timing changes, zero whole-media ASR, zero use of untrusted/unknown/legacy token timing, no decoded-segment/raw-VAD mislabel, valid strict artifacts, format parity, 21 real fresh requests, and 21/21 cache replay. Because the repaired evidence still cannot safely resolve any component, the final result remains `needs-review` with `finalizationMethod=none`.
