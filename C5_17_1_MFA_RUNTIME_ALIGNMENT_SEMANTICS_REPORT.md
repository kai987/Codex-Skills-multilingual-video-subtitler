# C5.17.1 MFA Runtime Completion & Alignment Semantics Fix

Date: 2026-08-26 (JST)

Outcome: the C5.17.1 runtime and alignment-semantics engineering acceptance completed with a real pinned MFA Fresh run, cache-backed Observe comparison, full-hit Cache Replay, complete model-archive metadata identities, and three clean shareable audits. The subtitle remains `needs-review` with `finalizationMethod: none` because all seven overlap components still fail at least one conservative timing gate. No automatic text or timing mutation was applied.

## 1. Development branch and baseline

- Repository: `kai987/Codex-Skills-multilingual-video-subtitler`
- Baseline branch: `codex/c5-17-canonical-transcript-forced-alignment`
- Baseline commit: `3646e72d74ccf89d9438020f083aa5a8878e710f`
- Development branch: `codex/c5-17-1-mfa-runtime-alignment-semantics`
- Main implementation commit: `09aeb044ef66ea452c07209c97a1eff85503829c`
- Model metadata acceptance fix: `240397fa0ca9c42db7d46535e451819663651c61`
- The C5.17 branch and its Evidence-DP Observe output were not rewritten.

## 2. C5.17 incomplete items confirmed

C5.17 had no callable MFA runtime identity, zero MFA attempts/processes/cache hits, 17 unresolved regex-token OOV units, and no real Word/Phone tier observation. Its 16 absent MFA window pairs were also incorrectly reported as unstable. C5.17.1 completed the runtime and corrected these semantics without changing the canonical subtitle.

## 3. Five P0 root causes

1. The parser allowed a TextGrid file-wide interval to stand in for spoken lexical bounds.
2. Reading and phone coverage were aliases of word-level availability instead of independent measurements.
3. MFA G2P was declared as a source but was not executed as a structured, cached pronunciation stage.
4. Full boundary agreement used the better of the two sides, allowing one bad edge to be hidden.
5. MFA Words could inherit Canonical Unit IDs by position even when tokenization differed.

The same investigation also confirmed that Sudachi lifecycle, unresolved hypotheses, window states, and user-facing blocking counts needed independent semantics.

## 4. Long TextGrid lexical-boundary repair

The Long TextGrid path now uses the pinned MFA runtime's `praatio` parser and saves four separate intervals:

- `fileInterval`
- `lexicalUtteranceInterval`
- `phoneUtteranceInterval`
- `selectedUtteranceInterval`

The default timing source is the first-to-last non-silence Word interval. A non-silence Phone interval is allowed only as `phone-tier-fallback`. A file interval can no longer be selected for dialogue timing. No non-silence Word or Phone fails closed with `NO_NON_SILENCE_ALIGNMENT_INTERVAL`.

Real Fresh result: `fileIntervalUsedForTimingCount = 0`.

## 5. Reading and phone coverage repair

Every attempt now computes these independently:

| Metric                      | Fresh mean |
| --------------------------- | ---------: |
| Canonical Unit coverage     |      1.000 |
| Aligned Word coverage       |      1.000 |
| Pronunciation Unit coverage |      1.000 |
| Expected Phone coverage     |      1.000 |
| Word with any Phone         |      1.000 |
| Aligned Phone plausibility  |      1.000 |

`readingCoverageRatio` is a deprecated compatibility projection of pronunciation coverage; `phoneCoverageRatio` is a deprecated projection of expected-phone coverage. `readingCoverageCopiedFromWordCoverageCount = 0`.

## 6. MFA G2P preprocessing

`subtitle-canonical-pronunciation.json` is produced before alignment. It records the canonical and alignment strings, Sudachi morphemes, readings, dictionary status, G2P status, phone sequences, model identities, OOV state, and blockers. The probed command is `mfa g2p`; `g2p_one` is not assumed. G2P input/output is cached by content and model identity. Generated readings and phones stay in the alignment sidecar and never modify subtitle text.

## 7. Two-sided boundary agreement

Start and end differences/scores are computed independently. Full agreement uses the weaker side, and a mutation must cite only the evidence IDs supporting the boundary side it changes. A good start can no longer mask a bad end. Fresh result: `oneSidedBoundaryAcceptedAsFullAgreementCount = 0` and no mutation used unrelated component-wide evidence.

## 8. Canonical Unit to MFA Word sequence mapping

The mapper is deterministic, monotonic, and supports:

- `MATCH_1_TO_1`
- `MATCH_1_TO_MANY`
- `MATCH_MANY_TO_1`
- `SKIP_CANONICAL_UNIT`
- `SKIP_MFA_WORD`
- `UNRESOLVED_MAPPING`

It scores surface, normalized surface, reading, phones, punctuation, OOV state, and order. Low margin and incomplete mappings block automatic timing. Fresh result: `indexBasedWordUnitMappingCount = 0`, `wordUnitMappingAmbiguousCount = 0`.

## 9. Sudachi runtime decoupling

Sudachi is an independent Python venv, not a package inside the MFA environment:

- Python: `3.12.14`
- SudachiPy: `0.6.11`
- `sudachidict_core`: `20260428`
- Dictionary: `core`, split mode `C`
- Requirements SHA-256: `4a725e48c0dd3fc6cf9ff87060ccf7eb3477459731bf220c860185f042aa7005`
- Helper SHA-256: `eae96b07c72c81f7ab87f994306d9441dd078faa1283ec63c60404624d6a1cc2`
- Runtime identity: `375e2fa8f4faabf9ecf599b2ed9226c0c1154753ca648b7433126240683061c5`
- Offline verification: passed
- MFA dependency: false
- System Python modified: false

Regex fallback cannot claim `sudachi-dictionary` provenance.

## 10. Unresolved hypothesis semantics

Components now use `resolutionStatus: resolved | unresolved | blocked`. `bestActionableHypothesis` and runner-up fields contain only actionable hypotheses. When none passes, the best hypothesis is `null`; unresolved is not assigned a synthetic confidence score. Legacy fields remain parse-compatible only.

## 11. Window unavailable versus unstable

Fresh window metrics are now semantically distinct:

- Available pairs: 16
- Unavailable pairs: 0
- Stable pairs: 6
- Unstable pairs: 10
- Single-window-only: 0

The old C5.17 `unstable = 16` result reflected unavailable MFA, not observed instability, and is no longer reused.

## 12. Unique blocking components

- Unique blocking components: 7
- Unique blocking cues: 16
- Diagnostic blocking findings: 60
- Review items: 7

The finalization report still carries both `FORCED_ALIGNMENT_COMPONENT_UNRESOLVED` and `ILLEGAL_SUBTITLE_OVERLAP` diagnostic findings, but the user-level issue count is not doubled.

## 13. Micromamba identity

- Version: `2.8.1-0`
- Platform asset: `micromamba-osx-arm64`
- Size: `14,446,512` bytes
- SHA-256: `de71a646b73af92dd663e6ddc78993a6a4d47ea28b5d8908c3cc2b9c3077e528`
- Checksum matched the pinned expected SHA-256.
- Source: versioned `mamba-org/micromamba-releases` asset and checksum
- Install scope: user cache only
- `sudo`: not used
- Shell profile: not modified

## 14. MFA 3.4.2 runtime identity

- MFA: `3.4.2`
- Python: `3.11.16`
- Kalpy: `0.10.5`
- Kaldi: `5.5.1172`
- Pynini: `2.1.7`
- praatio: `6.2.2`
- Sudachi in MFA environment: unavailable by design
- Platform: `darwin-arm64`
- Runtime identity: `bffcf0f5e1204f4e7337ba96e780ce515d3b4bb74a6c43ab2bb6ba908d10750e`
- Network used during preparation: yes
- Network used during alignment: no

## 15. Conda explicit spec

The complete Micromamba environment explicit specification is saved locally as `~/.cache/mvl/mfa-runtime/3.4.2/darwin-arm64-python-3.11-mfa-3.4.2/conda-explicit-spec.txt`.

SHA-256: `2846daf1b0c07f4be119243f959e521e894bfaff2b90ff09ff49709d235d650d`.

The environment and specification are intentionally not committed.

## 16. Acoustic model identity

- Model: `japanese_mfa` acoustic `3.0.0`
- File: `japanese_mfa.zip`
- Size: `92,191,596` bytes
- SHA-256: `85928ffb1024486872a677a92e1fa94d2f997462d0b84c73a58aa9bb0e35179a`
- Embedded `meta.json` SHA-256: `16fca6e105dc27d1ed1f0bac73f78a6d5f97aeb21ce3de94baac02eed1a1c8ac`
- Phoneset: 83 phones
- Silence/OOV phones: `sil`, `spn`
- Tokenizer/model requirements: external Sudachi; compatible/default dictionary `japanese_mfa`; position-dependent phones false; model-internal G2P false
- Official release asset ID: `153269158`
- Inspect: passed

## 17. Dictionary model identity

- Model: `japanese_mfa` dictionary `3.0.0`
- File: `japanese_mfa.dict`
- Size: `21,264,022` bytes
- SHA-256: `4a0c66760576e4b7f3748f3169e7d5217c0135f857f0b5d34637c93a85fd1c91`
- Canonical dictionary-metadata SHA-256: `88f8e9f4c962a3f739f96b27f540988e6177365e2947c78cb6e13b1cadb3ce35`
- Phoneset: 84 pronunciation phones
- Silence/OOV phone: `spn`
- Tokenizer requirements: external Sudachi, MFA tab-separated lexicon, surface-or-reading lookup, pronunciation in the final tab field
- Official release asset ID: `153269633`
- `mfa model inspect dictionary` was actually executed but hit an MFA 3.4.2 upstream `PosixPath.load_dictionary_paths` pretty-print failure. This is recorded as `known-upstream-cli-failure`, not a pass. Official registry/list identity, pinned hash, and 32 successful real `align_one` processes independently verified runtime compatibility.

## 18. G2P model identity

- Model: `japanese_katakana_mfa` G2P `3.0.0`
- File: `japanese_katakana_mfa.zip`
- Size: `12,197,128` bytes
- SHA-256: `55a1211d12fb1bb425b60c85da971c9a8426d3b858d9b331e96a9ea68ca542dc`
- Embedded `meta.json` SHA-256: `eee4aefde41e310887622c3bc14833c4a3fa802d9a0938e3da421d57aa2e659b`
- Phoneset: 80 phones
- Silence phones: none declared by the G2P archive
- Tokenizer requirements: external Sudachi reading input, Phonetisaurus, 169-grapheme inventory, sequence separator `|`
- Official release asset ID: `153268230`
- Inspect: passed

## 19. Model license and citation

All three models are pinned MontrealCorpusTools releases and record `CC BY 4.0` plus model-specific citation strings in the runtime capability artifact. The dictionary and G2P phonesets are startup-checked against the acoustic phoneset plus declared silence/OOV phones; the accepted set has zero unsupported phones. No floating `latest` or third-party model was used.

## 20. MFA CLI capability probe

Observed behavior:

- `mfa version`: `3.4.2`
- Single-file command: `align_one`
- `align_one_legacy`: absent
- G2P command: `g2p`
- `g2p_one`: absent
- Selected output: Long TextGrid
- JSON full Word tier: unavailable
- JSON full Phone tier: unavailable
- Word and Phone tiers from Long TextGrid: available
- Original-text output switch: unavailable
- Speaker adaptation: skipped
- Tokenization mode: external Sudachi preparation

Unknown or incompatible required behavior fails closed.

## 21. Real MFA sample probe

- Component: `overlap-acoustic-de9815d25ae4c3a8e718`
- Cue: `human-reviewed-0097-9457e119f3a1`
- Command/output: `align_one` / Long TextGrid
- File interval: `435.54–439.50`
- Lexical interval: `436.18–437.37`
- Phone interval: `436.18–437.37`
- Selected source: `lexical-word-tier`
- Words: 4
- Phones: 10
- OOV: 0
- Alignment: succeeded

This proves that the file range is not being returned as the spoken range.

## 22. Word and Phone tier observation

`wordTierObserved = true` and `phoneTierObserved = true` in the real probe. All 32 Fresh attempts parsed real lexical and phone intervals; no attempt failed.

## 23. Canonical pronunciation pipeline

The executed order was canonical text → alignment-only cleanup → independent Sudachi segmentation/readings → MFA dictionary lookup → official MFA G2P for remaining readings → expected phone manifest → MFA alignment. Global result over 16 cues:

- Lexical units: 69
- Sudachi reading resolved: 67
- MFA dictionary pronunciation resolved: 67
- Kana-literal readings: 2
- MFA G2P pronunciation resolved: 2
- Final unresolved lexical units: 0
- Critical OOV after preparation: 0
- G2P processes in Fresh: 1
- Canonical text mutations: 0

## 24. C5.17's former 17 OOV units

The 17 old regex/Han OOV spans occurred across 11 cues. Real Sudachi resegmented several coarse spans (for example, compound verb fragments) into dictionary units, so unit IDs are not all one-to-one comparable. All 17 affected spans are now fully reading/phone covered through Sudachi plus the pinned MFA dictionary; none remains critical OOV. The two actual G2P resolutions are the separate `ソーリャ` occurrences, not fabricated replacements for those 17 spans.

## 25. Evidence-DP before and after

- C5.17 candidate boundaries: 10 / 16 cues
- C5.17.1 Sudachi/G2P Evidence-DP candidate boundaries: 11 / 16 cues
- Cues whose Evidence-DP boundary or coverage changed: 9
- Old unresolved OOV count: 17
- New unresolved OOV count: 0

Evidence-DP remains context evidence only and did not directly mutate timing.

## 26. Narrow and expanded windows

Only the seven unresolved components and 16 cues were processed. Each cue received narrow `±0.50 s` and expanded `±1.00 s` attempts, with concurrency 1:

- Acceptance attempts: 32 / 32 maximum
- Successful attempts: 32
- Failed attempts: 0
- Stable cue pairs: 6
- Unstable cue pairs: 10
- Unavailable: 0
- Single-window-only: 0
- Selected bounds pinned to a search edge: 11 cues

The file interval was not used to calculate edge pinning.

## 27. Anti-forcing result

All six coverage metrics reached 1.0 and critical OOV/mapping ambiguity reached zero. Automatic timing still failed closed because window instability, lexical edge pinning, side-specific external boundary support, MFA/Evidence-DP disagreement, silence/neighbor intrusion, decision margin, or component atomicity remained. `untrustedForcedAlignmentTimingUseCount = 0`.

## 28. Duplicate occurrence result

One component produced a same-occurrence conflict. It was retained as `DUPLICATE_ACOUSTIC_OCCURRENCE_ASSIGNMENT`; no acoustic occurrence was assigned to multiple output cues and no timing mutation was applied. Component 1's repeated greeting likewise did not receive an unsafe duplicate assignment.

## 29. Seven component results

| Component                               | Cues | Stable / unstable | Result  | Principal reason                                           |
| --------------------------------------- | ---: | ----------------: | ------- | ---------------------------------------------------------- |
| `overlap-acoustic-def4f9e5f20a6a24af59` |    2 |             1 / 1 | blocked | side evidence, DP conflict, instability/edge/neighbor gate |
| `overlap-acoustic-5e6df4ca8c77b3a51802` |    2 |             0 / 2 | blocked | unstable, edge, silence/neighbor, DP conflict              |
| `overlap-acoustic-de9815d25ae4c3a8e718` |    2 |             2 / 0 | blocked | DP conflict, one edge/silence case, side evidence          |
| `overlap-acoustic-8ff7342e69430b941161` |    3 |             2 / 1 | blocked | duplicate occurrence plus instability/edge/neighbor        |
| `overlap-acoustic-5475b241d7d856b45194` |    2 |             1 / 1 | blocked | edge/instability, side evidence, DP conflict               |
| `overlap-acoustic-eef08480bdcbc8f48776` |    2 |             0 / 2 | blocked | unstable, edge, silence/neighbor, DP conflict              |
| `overlap-acoustic-69e8f46141f7d9276a87` |    3 |             0 / 3 | blocked | unstable, side evidence, DP conflict, neighbor/silence     |

Every component was rolled back atomically; none was weakened merely to reduce review count.

## 30. Timing mutations

There are no C5.17.1 timing mutations. The mutation array is empty and its deterministic hash is `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.

Safety counters are all zero: midpoint repair, character-ratio repair, reading-ratio repair, phone-count-ratio repair, untrusted forced-alignment timing use, and duplicate occurrence assignment.

## 31. Review items before and after

- C5.17 review items: 7
- C5.17.1 review items: 7
- Closed blockers: 0

This unchanged count is an accepted evidence-quality result, not a failed runtime run.

## 32. Final status

- Status: `needs-review`
- `finalizationMethod`: `none`
- Canonical text mutation count: 0
- Canonical timing mutation count: 0
- Automatic timing mutation count: 0
- Final strict cue set: 192 cues

The output is not labeled auto-validated or human-validated.

## 33. Canonical, timing, presentation, and run hashes

- Canonical/output cue hash: `8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83`
- Canonical timing hash: `510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02`
- Presentation cue hash: `9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de`
- Canonical alignment input hash: `07ce83df9e531aae914905d3606a17a3dc6f4c359f435a7c965b395b4567c9fa`
- Fresh alignment hash: `511dfb222a9ca77e8c9b0ea85fd81a9c867141d1d97d540741bd7df7d16460f3`
- Component decision hash: `730f85ff47b5dfc98eeb1b404d868b2f65c7ef4d5f23b0f45a4b13abf6bb8ad3`
- Mutation hash: `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`

## 34. Real Fresh MFA metrics

- Mode/backend: `enforce` / `hybrid`
- Components/cues: 7 / 16
- Attempts/success/failure: 32 / 32 / 0
- MFA process executions: 32
- Cache hits: 0
- Wall clock: `151.288 s`
- Runtime/model identity verified: true
- Word/Phone tiers observed: true / true
- Timing mutations: 0
- Review items: 7
- Whole-media ASR / Whisper / OpenAI / online subtitle lookup: 0 / 0 / 0 / 0

## 35. Observe comparison

Observe read the exact accepted Fresh alignment cache, as explicitly permitted by the task, and applied the same bounded evidence in `observe` mode:

- Attempts/success/failure: 32 / 32 / 0
- Cache hits: 32 / 32
- MFA processes: 0
- Wall clock: `4.969 s`
- Timing mutations: 0
- Review items: 7
- Blockers remained active
- Final status/method: `needs-review` / `none`

The mode-dependent artifact hashes are intentionally distinct from Enforce; the canonical output cue and empty mutation hashes remain unchanged.

## 36. Cache Replay and cache identity

Cache Replay used the same Enforce configuration:

- Attempt cache hits: 32 / 32
- MFA process executions: 0
- Wall clock: `4.923 s`
- Fresh/Cache alignment hash match: true
- Fresh/Cache component-decision hash match: true
- Fresh/Cache mutation hash match: true
- Fresh/Cache output-cue hash match: true

The C5.17.1 cache key adds these identities:

- `c5.17.1-lexical-utterance-boundary-v1`
- `c5.17.1-word-unit-sequence-mapping-v1`
- `c5.17.1-pronunciation-phone-coverage-v1`
- `c5.17.1-two-sided-boundary-agreement-v1`
- `c5.17.1-mfa-g2p-preparation-v1`
- Sudachi runtime identity hash

Task/output/temp paths and timestamps remain excluded.

## 37. Shareable audits

Fresh, Observe, and Cache Replay each contain a strict 17-artifact shareable set. All three audits passed:

- Schema validations: 17 / 17 per run
- Absolute path leaks: 0
- Prohibited secrets: 0
- Secret redactions required: 0
- Path policy: `shareable-relative-only`

## 38. New artifacts and modified-file scope

New runtime/output contracts:

- `subtitle-canonical-pronunciation.json`
- `mfa-sample-probe.json`
- `c5-17-1-runtime-preparation-summary.json`
- `c5-17-1-fresh-cache-observe-validation.json`
- `sudachi-runtime-capability.json`

Implementation commit `09aeb04` changes 45 tracked files: shared strict schemas and generated JSON Schemas; MFA/Micromamba/Sudachi runtime code; TextGrid parser, pronunciation, sequence mapping, boundary agreement, cache, finalization and shareable logic; CLI/replay/validation scripts; the skill instructions; and unit/E2E tests. Follow-up `240397f` adds archive-level phoneset/silence/tokenizer metadata verification, cross-model phone compatibility checks, stable dictionary-inspect failure recognition, and two-pass shareable emission. No `output/`, environment, model, audio, video, TextGrid temporary directory, cache, or binary was committed.

## 39. SRT/VTT/ASS parity

The best-effort outputs each contain 192 cues/Dialogue events. Finalization reported:

- Serialization round trip: passed
- Format semantic parity: passed
- Canonical parity: passed
- Presentation parity: passed

The quality gate remains blocked only by the seven unresolved overlap components, not by serialization or format divergence.

## 40. Skill 2 and Skill 3 compatibility

Read-only compatibility repositories stayed on `codex/publish-core-runtime` and remained clean:

- Skill 2 commit: `1af10bd8a7057c573959f39a745436fa837127ea`
- Skill 3 commit: `fea8ae8d67baa14ca98f6c4239d7fb0a7083e1b8`
- Strict Skill 2 v1 schema: passed; 192 source cue IDs, 106 sentences, 106 grammar points
- Canonical text: unchanged
- Skill 3 typecheck: passed
- Skill 3 tests: 1 passed
- Fresh static-site build from the Skill 2 report: passed
- Input/built report byte parity: passed, SHA-256 `51328261c7c3817c050c4ee985dc16d3a3ee9a54bac1e0432dcbfd3f19e8c02f`

This is the deterministic offline compatibility report carried by the prior accepted task, not a newly claimed Host-model grammar analysis.

## 41. Source-video read-only verification

- Size before/after: `847,774,958` / `847,774,958` bytes
- SHA-256 before/after: `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`
- mtime before/after: `1784692412273.1868 ms`
- Verified unchanged: true

## 42. Human ASS read-only verification

- Size before/after: `17,094` / `17,094` bytes
- SHA-256 before/after: `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`
- mtime before/after: `1787591357580.2017 ms`
- Verified unchanged: true

## 43. Unit and static validation

Executed with Node `24.19.0` and npm `11.18.0`:

- Full Vitest: 20 files passed
- Tests: 340 passed, 1 optional MFA integration test skipped, 0 failed
- TypeScript typecheck: passed
- ESLint: passed
- Prettier check: passed
- Production build: passed
- `npm@11.18.0 install`: up to date; lockfile unchanged

The environment-gated test is enabled by `MVL_MFA_INTEGRATION_TEST=1`; real MFA was instead verified by the separate sample and 32-process Fresh run.

## 44. E2E validation

- E2E files: 6 passed
- E2E tests: 23 passed, 1 optional MFA integration test skipped, 0 failed

Coverage includes lexical TextGrid boundaries, G2P/cache behavior, sequence mapping, two-sided agreement, stable/unavailable windows, duplicate occurrence, atomic rollback, Observe no-mutation, Cache Replay, and shareable behavior.

## 45. JSON Schema total

`npm run generate:schemas` generated 88 strict JSON Schemas, up from the C5.17 baseline of 83. Five new schema files cover C5.17.1 validation, runtime summary, sample probe, canonical pronunciation, and Sudachi runtime capability.

## 46. Skill validation

The repository skill passed:

```text
python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .agents/skills/multilingual-video-subtitler
Skill is valid!
```

## 47. Dependency advisories

`npm audit --json` reports five indirect dependency findings: 4 high and 1 moderate, 0 critical. The affected dependency chains are:

- `eslint → minimatch → brace-expansion` (high)
- `ajv → fast-uri` (high)
- `vite → postcss → nanoid` (high)
- `vite → postcss` (moderate)
- `subtitle-search → cheerio → undici` (high)

Fixes are available upstream. No `npm audit fix --force` was run because an unrelated dependency rewrite is outside this evidence-focused patch and could alter tested behavior. These advisories should be handled in a dedicated dependency-upgrade change with regression tests.

## 48. Remaining unresolved issues and skipped/failing checks

The subtitle still has seven blocked overlap components, ten unstable window pairs, eleven edge-pinned selected intervals, one duplicate-occurrence conflict, and insufficient side-specific cross-source boundary support on multiple cues. These are review requirements, not missing runtime capability.

Known non-pass/skip items are explicit:

- MFA 3.4.2 dictionary `model inspect` has the upstream `PosixPath.load_dictionary_paths` CLI failure described in section 17.
- One unit and one E2E MFA integration test are skipped unless the environment opt-in is set; real runtime integration was executed separately.
- Three development preflight diagnostics caught an HTTPS path false positive, MFA executable PATH propagation, and mapping-margin fixture issue; all were fixed before the accepted sample/Fresh runs and are not acceptance outputs.
- Final real MFA attempt failures: 0.

## 49. C5.18 readiness

The runtime, pronunciation, TextGrid, mapping, coverage, cache, and audit foundations are ready for a C5.18 development iteration. The current subtitle is not ready to be called final: C5.18 must preserve the 192-cue human baseline and address the remaining component-level evidence/review questions without weakening the anti-forcing gate. Speaker diarization, foreground/background classification, and source separation were not introduced in this round.

## 50. Actual commands and output paths

Representative exact command structure used for preparation and validation (all normal replay runs were offline):

```bash
npx --yes npm@11.18.0 install
npm run prepare:sudachi-runtime -- --create-runtime
npm run verify:sudachi-runtime -- --runtime-manifest "$SUDACHI_MANIFEST"

npm run prepare:mfa-runtime -- \
  --install-micromamba \
  --micromamba-version 2.8.1-0 \
  --mfa-version 3.4.2 \
  --create-mfa-runtime \
  --fetch-mfa-models \
  --acoustic-model japanese_mfa \
  --acoustic-model-version 3.0.0 \
  --dictionary-model japanese_mfa \
  --dictionary-model-version 3.0.0 \
  --g2p-model japanese_katakana_mfa \
  --g2p-model-version 3.0.0

npm run verify:c5-17-1-mfa-runtime -- --runtime-manifest "$MFA_MANIFEST"

npm run replay:c5-17-1-forced-alignment -- \
  --task "$OUTPUT_ROOT/carnation-reference-guided-c5-16-1-runtime-stabilized-standard-20260826" \
  --human-reviewed-subtitle "$HUMAN_ASS" \
  --source-video "$VIDEO" \
  --forced-alignment enforce \
  --forced-alignment-backend hybrid \
  --mfa-runtime-manifest "$MFA_MANIFEST" \
  --sudachi-runtime-manifest "$SUDACHI_MANIFEST" \
  --mfa-acoustic-model "$ACOUSTIC_MODEL" \
  --mfa-dictionary-model "$DICTIONARY_MODEL" \
  --mfa-g2p-model "$G2P_MODEL" \
  --forced-alignment-narrow-context 0.50 \
  --forced-alignment-expanded-context 1.00 \
  --max-forced-alignment-attempts 32 \
  --forced-alignment-concurrency 1 \
  --asr-cache-mode read-write \
  --offline \
  --output "$FRESH_OUTPUT"

# Observe used --forced-alignment observe plus --asr-cache-mode read.
# Cache Replay used enforce plus --asr-cache-mode read. Both read the Fresh cache.

npm run validate:c5-17-1-runs -- \
  --fresh "$FRESH_OUTPUT" \
  --observe "$OBSERVE_OUTPUT" \
  --cache "$CACHE_OUTPUT" \
  --output "$FRESH_OUTPUT/c5-17-1-fresh-cache-observe-validation.json"

npm run audit:shareable-artifacts -- --input "$FRESH_OUTPUT/shareable"
npm run audit:shareable-artifacts -- --input "$OBSERVE_OUTPUT/shareable"
npm run audit:shareable-artifacts -- --input "$CACHE_OUTPUT/shareable"

npm run generate:schemas
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run build
```

Local output paths, relative to `$HOME/Documents/Codex-Skills`:

- Sample/runtime: `output/carnation-reference-guided-c5-17-1-mfa-sample-probe-metadata-verified-20260826`
- Fresh: `output/carnation-reference-guided-c5-17-1-mfa-runtime-alignment-semantics-metadata-verified-fresh-20260826`
- Observe: `output/carnation-reference-guided-c5-17-1-mfa-runtime-alignment-semantics-metadata-verified-observe-20260826`
- Cache Replay: `output/carnation-reference-guided-c5-17-1-mfa-runtime-alignment-semantics-metadata-verified-cache-replay-20260826`
- Forced-alignment cache: `output/.cache/c5-17-1-mfa-runtime-alignment-semantics-metadata-verified`
- MFA runtime: `~/.cache/mvl/mfa-runtime/3.4.2/darwin-arm64-python-3.11-mfa-3.4.2`
- Sudachi runtime: `~/.cache/mvl/sudachi-runtime/c5-17-1-python-3.12-sudachi-0.6.11-core-20260428`
- Development report: `C5_17_1_MFA_RUNTIME_ALIGNMENT_SEMANTICS_REPORT.md`

Diagnostic preflight and hash-normalization directories are intentionally excluded from the accepted output set and from any future package request.
