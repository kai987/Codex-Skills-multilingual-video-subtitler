# C6.0.1.5 Evidence-to-Canonical Application & Raw ASR Error Recovery

Date: 2026-08-28

Policy: `c6.0.1.5-evidence-to-canonical-raw-asr-recovery-v1`

Policy SHA-256: `6cc3300758c59eee768e4eb382814005f6f295ea72a24540cfc68058beb39a99`

This report records the real Carnation development-set run. It deliberately separates engineering acceptance from subtitle-quality acceptance. The engineering chain now reaches the canonical package and rendered subtitle files, but the final text quality did not improve. The correct release result is therefore `HOLD_FOR_MORE_RAW_ASR_RECOVERY`, not a C6.0.2 authorization.

## Executive conclusion

C6.0.1.5 engineering acceptance passed. Deterministic Event-to-Final lineage, variant-specific evidence, trusted-token timing proposals, canonical mutation/application/rollback, raw single-variant re-ASR, strict schemas, Gold isolation, independent Final A/B replay, and shareable audits all passed.

The feature produced 41 canonical proposals, safely applied 6 timing mutations, wrote those 6 changes through the canonical package and all three rendered formats, and preserved zero unsupported mutations. This closes the previously missing Evidence -> Proposal -> Safety Gate -> Canonical -> Final Package -> ASS/SRT/VTT engineering loop.

Subtitle-quality acceptance did not pass. Canonical text changed in 0 cues; exact and normalized CER remained `0.6601049868766404` and `0.6015625`; material errors changed from 76 to 77 under the C6.0.1.5 evaluator; raw-ASR-origin attribution changed from 36 to 37; association attribution remained 40; severe timing stayed 53; and overlap stayed 48. Timing MAE and P95 improved slightly, but not enough to pass the frozen timing gates. Production remains `needs-review`, `finalizationMethod = none`, and `machineOnlyReleaseAuthorized = false`.

## Branch, baseline, and development-set status

- Branch: `codex/c6-0-1-5-evidence-to-canonical-raw-asr-recovery`.
- Exact base: `8fa03325fb747804d5068c5200c7a456378fe094` from `codex/c6-0-1-4-vad-timebase-text-variant-reasr`.
- Source media: `/Users/paulasmith/Downloads/カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].mkv`.
- Source size: `847774958` bytes; SHA-256 before/after: `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`; read-only verification passed.
- Gold: the 192-cue human-reviewed ASS used only after freeze; SHA-256 before/after: `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`; read-only verification passed.
- This episode is a known development set. It can establish engineering behavior and diagnose gates, but cannot establish unseen-series generalization.
- Goal: make existing evidence reach a correct, reversible final-cue mutation and recover weak raw-ASR events without Gold or candidate-text prompts.
- Non-goals: global recall expansion, a new association system, a new VAD timebase, full-episode MFA/speaker/separation, decoder changes, threshold relaxation, overlap trimming, machine release, or Skill 2/3 changes.

## Baseline replay and evidence-application gap

V0 reproduced the C6.0.1.4 baseline exactly: 161 cues, exact CER `0.6601049868766404`, normalized CER `0.6015625`, coverage `0.96484375`, missing 6, hallucination 1, material errors 76, severe timing 53, start MAE `1.6315951789222625 s`, end MAE `1.6488576592810873 s`, P95 `6.439999999999998 s`, IoU `0.5800000000000054`, and overlap 48.

Raw ASR remained better on several aggregate measures: 169 cues, exact CER `0.5831146106736658`, normalized CER `0.5166015625`, coverage `0.97216796875`, missing 5, hallucination 2, material errors 63, severe timing 37, start MAE `1.3203134328358284 s`, end MAE `1.3926641791044845 s`, P95 `6.470000000000027 s`, and IoU `0.6761133603238165`. Raw overlap was not scored by the C6.0.1.5 evaluator and must not be interpreted as a measured zero.

C6.0.1.4 had 694 trusted global tokens and 59 upstream timing-eligible cues, but no canonical mutation applier consumed them. Its 25 targeted re-ASR candidates were not part of the same variant-specific evidence/selection/application contract. C6.0.1.5 adds the missing lineage, proposal, safety, apply, render, and rollback stages.

The prior C6.0.1.4 report used a Gold attribution of RAW_ASR_ORIGIN 50 and ASSOCIATION 19. C6.0.1.5 introduced a stricter event/final-lineage evaluator; its internally comparable replay numbers are RAW_ASR_ORIGIN 36 and ASSOCIATION 40. These two attribution systems have different denominators and must not be presented as a continuous 50 -> 37 or 19 -> 40 trend. Under the consistent C6.0.1.5 evaluator, raw-ASR-origin worsened 36 -> 37 and association stayed 40 -> 40.

## Event-to-Final architecture and coverage

`machine-event-to-final-cue-lineage.json` follows machine Event IDs through canonical cue IDs, segmentation, deduplication, fragment/final repair, and final cue IDs. Identity is ID-derived only; time-nearest matching count is zero. Only `EXACT_ONE_TO_ONE` lineage is modifiable. One-to-many, many-to-one, dropped, ambiguous, and unresolved cases remain non-mutating.

Lineage summary:

| Metric                 |                Count |
| ---------------------- | -------------------: |
| Event count            |                  199 |
| Final cue count        |                  161 |
| Exact one-to-one       |                   87 |
| One-to-many            |                   75 |
| Many-to-one            |                   21 |
| Superseded             |                    0 |
| Dropped                |                    8 |
| Ambiguous              |                    0 |
| Unresolved             |                    8 |
| Explicit event lineage |                  191 |
| Covered final cues     |                  161 |
| Coverage ratio         | `0.9777777777777777` |
| Time-nearest identity  |                    0 |

The lineage semantic hash is `db16baaa3c1c2437a0065876bb54cc27a9df2c7a51804dcc8fc3dec5fd6ef980`.

## Variant-specific evidence and candidate pool

Every real variant now has its own token, decoder, CTC, edge, speech-span, independent-support, and request-family evidence. A representative cue's tokens cannot stand in for a competing variant. Missing decoder evidence stays unavailable rather than becoming a fabricated zero.

| Metric                                   |  Count |
| ---------------------------------------- | -----: |
| Variant evidence bundles                 |    274 |
| Complete                                 |     48 |
| Partial                                  |    226 |
| Unavailable                              |      0 |
| Re-ASR variants                          |     51 |
| Variant-specific trusted tokens consumed |   1027 |
| Representative-token leaks               |      0 |
| Fabricated decoder-zero records          |      0 |
| Candidate pool total                     |    274 |
| Baseline candidates                      |    223 |
| C6.0.1.4 targeted re-ASR candidates      |     25 |
| C6.0.1.5 raw re-ASR candidates           |     26 |
| All re-ASR evidence COMPLETE             |     48 |
| All re-ASR evidence PARTIAL              |      3 |
| C6.0.1.4 re-ASR COMPLETE                 |     25 |
| C6.0.1.5 re-ASR COMPLETE / PARTIAL       | 23 / 3 |
| Selected C6.0.1.5 raw re-ASR candidates  |      2 |
| Free rewrites / candidate prompt leaks   |  0 / 0 |

The two new runtime winners were real candidates, but both text replacement proposals failed the stricter lineage/acoustic/non-degradation gates. They were therefore safe winners in the candidate pool, not safe canonical text mutations.

Variant bundle semantic hash: `55c96a01c2fa9d1046766b449ca43d65e7cd94d16a913b3f04024e867f40284c`. Candidate pool semantic hash: `e45aaf24c79ba794fcbcbd5ed1e23b9dea796490417b28ea6097f86f5e9e9c78`.

## CTC, trusted tokens, and mutation application

The evidence-coverage ledger records 274 CTC evidence records produced and 274 consumed. It records 1120 trusted tokens produced and 1027 consumed. Consumption is variant-specific and does not imply automatic acceptance.

The CTC runtime identity is `4826687aaae95dd1931833e578c9260b5fb2b952f45ccafe4b5a1d6ed9a6da60`; model snapshot hash is `47f29c9f9e4175e058ce87287a75e43cacd2d11e810e21098ab898d77a2a43dd`; device is CPU. The first single-variant audit executed 180 real CTC inferences with one model load/worker. Raw candidate scoring executed 26 more CTC inferences with one model load/worker. Final A/B each replayed 180/180 audit and 26/26 recovered-candidate CTC cache hits with zero inference, model loads, or worker starts.

The Whisper runtime identity is `e2b62f6d45dc3badc49e0b2a8a468a9914f5e018c3692c1fbe6190c443b0b2c2` (`whisper.cpp-mvl 1.9.3+9ae596938178`, Metal). The large-v3 model SHA-256 recorded by the baseline runtime audit is `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`.

Of the 59 upstream C6.0.1.4 timing-eligible cues, strict event/final lineage and candidate evidence left 39 safe proposal targets. There were 43 eligibility observations and 39 persisted timing proposals: 6 accepted/applied and 37 proposal-level rejection occurrences. The canonical proposal ledger has 39 timing proposals, 2 text proposals, 6 accepted, and 35 rejected proposals. The difference between 37 and 35 is intentional: the timing artifact counts proposal-level rejection paths/eligibility blockers, while the canonical ledger counts final proposal objects.

The applier validates lineage, lexical coverage, duration ratio, adjacent overlap, independent support, canonical integrity, strict package parsing, and all three renderers after each mutation. It writes before/after hashes and can rollback. Result: 6 timing mutations applied, 0 text mutations, 0 rollbacks, 0 unsupported mutations, 6 changed final cue timings, and 6 final-artifact mutations.

Proposal semantic hash: `1450b2ae5b961180223e5ad38ca082ef89dbfee21302682645d29435bf442dee`. Application ledger semantic hash: `936ddbad0aab060ec086e95340b4831c64c0340dfea82d090b24e5c632506a62`.

## Single-variant acoustic audit and raw ASR recovery

All 180 single-variant events were audited; 180 were suspicious and eligible for bounded re-ASR. The status distribution was 178 `EDGE_TRUNCATED` and 2 `INCOMPLETE_SPEECH_SPAN`; verified-strong, acceptable, token-conflict, low-CTC-status, decoder-low-confidence, acoustically-weak-status, and unknown counts were all zero. Separately, 107 events had a raw CTC score below 0.55, but edge/span status has higher precedence, so they are not counted as `ACOUSTICALLY_WEAK` or `LOW_CTC_SUPPORT`. Decoder evidence was unavailable for all 180 and was not fabricated.

The frozen budget selected 12 suspicious single-variant events, at most 3 requests per event and 36 requests per episode. The existing C6.0.1.4 multi-variant trigger count was also 12. The successful first-generation sequence observed 29 previously materialized request cache hits and 7 new Whisper inferences in the final retry; across the initial failed-safe attempt plus retry, all 36 C6.0.1.5 requests had executed real inference once. Final A/B each replayed 36/36 cache hits, zero inference/model load/worker start. The 36 requests produced 26 candidates, 23 COMPLETE and 3 PARTIAL; 2 were selected; 2 replacement proposals were generated; 0 replacements were applied; 10 triggered events remained unresolved.

The first raw-recovery attempt failed closed when a no-VAD lexical token had both raw and mapped timestamps absent. Investigation proved that this is a legitimate untimed token, while one-sided or mismatched timestamps remain invalid. The parser was narrowed accordingly, 29 already valid responses were retained in cache, the failed partial output was moved to `/private/tmp/carnation-c6-0-1-5-raw-asr-recovery-failed-pre-4c9df26`, and the successful retry completed without weakening temporal trust.

The audit semantic hash is `0c98d56f05d55cd3495354da0cac61e2a14bbbbe4781d85d828c1b326c88ac39`; recovery semantic hash is `5a3bf33e0d28c58b70ac94ae7e0241dea94a16eebda4e6624eb32d5fe92218ca`.

## Local association and evidence funnel

Local association was observe-only. It inspected 199 events, proposed 0 repairs, and applied 0. It neither copied nor replaced the established association architecture. Semantic hash: `6ab9af3d72a74d5737247848f759c0d84f50b4b9d8e24d914d8fb9c393349bdf`.

The full evidence funnel is:

| Stage              | Count |
| ------------------ | ----: |
| Produced           |  1420 |
| Eligible           |   313 |
| Consumed           |  1327 |
| Proposal-generated |    41 |
| Applied            |     6 |
| Final-affecting    |     6 |

The engineering gate passed with no evidence-application blocker. Funnel semantic hash: `88c8a5c0035a6c9252e934ae52217e277afa0f0c38080896631d526ceaca71d5`.

## Ablation V0-V7, Full, and Final A/B

| Run     | Change                           |            Exact CER | Normalized CER | Material | Start / End MAE       |     P95 |        IoU | Overlap |
| ------- | -------------------------------- | -------------------: | -------------: | -------: | --------------------- | ------: | ---------: | ------: |
| V0      | frozen C6.0.1.4 replay           | `0.6601049868766404` |    `0.6015625` |       76 | `1.631595 / 1.648858` |  `6.44` |     `0.58` |      48 |
| V1      | lineage only                     |                 same |           same |       76 | same                  |    same |       same |      48 |
| V2      | variant evidence only            |                 same |           same |       76 | same                  |    same |       same |      48 |
| V3      | text application                 |                 same |           same |       76 | same                  |    same |       same |      48 |
| V4      | timing application               |                 same |           same |       77 | `1.609108 / 1.607836` | `5.385` | `0.582467` |      48 |
| V5      | single-variant audit             |                 same |           same |       77 | same as V4            |    same |       same |      48 |
| V6      | raw ASR recovery                 |                 same |           same |       77 | same as V4            |    same |       same |      48 |
| V7      | association observe              |                 same |           same |       77 | same as V4            |    same |       same |      48 |
| Full    | all enforce; association observe |                 same |           same |       77 | same as V4            |    same |       same |      48 |
| Final A | independent cache replay         |                 same |           same |       77 | same as V4            |    same |       same |      48 |
| Final B | independent cache replay         |                 same |           same |       77 | same as V4            |    same |       same |      48 |

Coverage remained `0.96484375`; missing remained 6; hallucination remained 1; severe timing remained 53. Final timing improved start MAE by about `0.02249 s`, end MAE by `0.04102 s`, P95 by `1.055 s`, and median IoU by `0.00247`, but failed the frozen gates. Text application caused no change. The raw-to-final normalized-CER gap remained `0.0849609375`, so it did not materially narrow.

Final A/B parity passed for text, timing, presentation, lineage, variant bundles, single-variant audit, re-ASR triggers, proposals, application, and shadow outcome. Final A freeze is `c7ada2b5f30c851f0036757fbdbf933e83a348f7961192eacfdb8b5d61a5b73d`; Final B freeze is `e4bae7701f6fc3e29a0afd42ea7624ce352da1b931d57a612390a5e0acfea48f`; dual-barrier semantic hash is `4006e383a74a02256b7852340631beb1db5eac001743ddbd37f390e686926630`.

## Final hashes and rendered changes

The canonical text hash stayed `2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9`. The canonical timing hash changed from `fdcac6c8f48825dfa39ebaa6878963253f834dfbf8b324c05487ef2d2498d9ea` to `e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936`. Presentation changed from `e77a969ca322d1717e209c52b80f4b1b57b5aa31f5e8ccccf329df165717c359` to `313ed1944faedf2d60896f0275f83512886ca18b350ae982a89e38bf7c5d902c` because timing is part of the presentation projection.

| Format | Baseline SHA-256                                                   | Final A/B SHA-256                                                  | Changed          |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------- |
| ASS    | `a33e2ad12d48b11287829ea80d08f686ca0271bbc4a69ed52a5c77838fdfbf03` | `594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7` | yes, timing only |
| SRT    | `4d13429d4c2f6a25b28d553aafe2471f5b3bc8dafde26d2c67c33226fa15de01` | `faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd` | yes, timing only |
| VTT    | `249d907a3b3db721471c6a80ea5d782cdabea22503eaae3a0a44453acc0173e7` | `107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a` | yes, timing only |

## Gold isolation, safety, reproducibility, and delivery

- Runtime Gold input count 0; candidate-text prompt leaks 0; human-memory leaks 0; dataset hardcoding findings 0; network/cloud use false.
- Independent A/B output directories, media caches, and empty machine-memory stores were frozen before Gold. The per-run proofs record Final A frozen at `2026-08-28T12:35:30Z`; first Gold read was `2026-08-28T12:41:41Z`; output hashes were unchanged after Gold.
- The dual-barrier summary was materialized after the evaluator had already produced its per-run proof; the barrier's chronology claim is supported by those earlier per-run freeze/proof timestamps rather than by the summary creation time alone.
- A first shareable scan incorrectly matched the numeric key `candidateTextPromptLeakCount` as if it contained candidate text. The regex was narrowed to exact JSON keys only. The failed validation output was moved to `/private/tmp/carnation-c6-0-1-5-validation-false-positive-candidateTextPromptLeakCount`.
- Final shareable audit: 1 allowlisted artifact, absolute-path leaks 0, secrets 0, Gold-text leaks 0, raw private audio 0, broken relative references 0, passed.
- Unsafe finalization escapes 0. Strict package and ASS/SRT/VTT parse/render checks passed after every accepted mutation.
- Production stayed `needs-review`; `finalizationMethod = none`; machine-only release stayed false; no `.final.*` machine release was authorized.

## Tests, schemas, regressions, and Skill compatibility

- Schema generation produced 216 schemas, including all 13 requested C6.0.1.5 strict schemas plus the candidate-pool schema.
- Format check, TypeScript typecheck, ESLint, and build passed under Node 24/npm 11.
- Unit suite: 81 files, 655 passed, 2 skipped.
- E2E suite: 18 files, 37 passed, 1 skipped.
- Targeted C6.0.1.5 suites and the C5.16 mapped-token regression passed.
- C5.19, C6 investigation, C6 protected finalization, C6.0.1, C6.0.1.1, C6.0.1.2, C6.0.1.3, and C6.0.1.4 regression files are covered by the full unit/E2E run.
- The C6.0.1.5 validator parsed real V0-V7/Full/Final A/B artifacts and returned engineering gate true, safety true, reproducibility true, quality false, outcome `HOLD_FOR_MORE_RAW_ASR_RECOVERY`.
- The `multilingual-video-subtitler` skill entrypoint and CLI wrapper remain valid. Skill 2 (`multilingual-grammar-report-generator`) and Skill 3 (`multilingual-grammar-learning-site-builder`) were not modified.

## Requirement index 1-114

The following index makes the requested report coverage explicit.

|   # | Required topic                      | Result / section                                                                                 |
| --: | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
|   1 | Executive Conclusion                | Engineering PASS; quality HOLD; see Executive conclusion.                                        |
|   2 | Branch                              | C6.0.1.5 branch above.                                                                           |
|   3 | Baseline                            | Exact base `8fa03325...`; V0 replay above.                                                       |
|   4 | Development-set Status              | Known Carnation development set; not unseen proof.                                               |
|   5 | Goals                               | Evidence-to-render application and raw recovery.                                                 |
|   6 | Non-goals                           | No new global architecture, model, threshold relaxation, or release.                             |
|   7 | C6.0.1.4 Replay                     | V0 exact replay passed.                                                                          |
|   8 | Raw ASR Baseline                    | 169 cues and full metrics above.                                                                 |
|   9 | Final Baseline                      | 161 cues and full metrics above.                                                                 |
|  10 | Error Attribution Baseline          | Legacy 50/19 distinguished from comparable 36/40.                                                |
|  11 | Evidence Baseline                   | 694 trusted tokens; 59 upstream timing eligible.                                                 |
|  12 | Evidence Application Gap            | No prior canonical applier/renderer path.                                                        |
|  13 | Event->Final Architecture           | ID-only deterministic lineage.                                                                   |
|  14 | Lineage Coverage                    | `0.9777777777777777`.                                                                            |
|  15 | One-to-one Events                   | 87 exact one-to-one, only modifiable class.                                                      |
|  16 | One-to-many                         | 75, non-modifying.                                                                               |
|  17 | Many-to-one                         | 21, non-modifying.                                                                               |
|  18 | Ambiguous Lineage                   | 0 ambiguous; 8 unresolved/dropped.                                                               |
|  19 | Variant-specific Evidence           | 274 bundles; no representative leak.                                                             |
|  20 | Token Evidence by Variant           | 1027 trusted tokens consumed variant-specifically.                                               |
|  21 | Re-ASR Evidence Parity              | C6.0.1.4/C6.0.1.5 candidates use same evidence contract.                                         |
|  22 | Decoder Evidence Semantics          | Unavailable remains unavailable; fabricated zero 0.                                              |
|  23 | CTC Evidence Consumption            | 274 produced / 274 consumed.                                                                     |
|  24 | Trusted Token Consumption           | 1120 produced / 1027 consumed.                                                                   |
|  25 | Mutation Proposal Architecture      | Proposal, gate, apply, render, rollback.                                                         |
|  26 | Text Proposals                      | 2.                                                                                               |
|  27 | Timing Proposals                    | 39.                                                                                              |
|  28 | Proposal Rejections                 | 35 canonical proposals rejected.                                                                 |
|  29 | Applied Text Mutations              | 0.                                                                                               |
|  30 | Applied Timing Mutations            | 6.                                                                                               |
|  31 | Rendered Output Changes             | ASS/SRT/VTT all changed by timing only.                                                          |
|  32 | Single-Variant Audit                | 180/180 audited.                                                                                 |
|  33 | Strong Single Variants              | 0 verified strong.                                                                               |
|  34 | Weak Single Variants                | Status count 0; 107 had CTC < 0.55 but higher-priority edge/span status.                         |
|  35 | Edge-truncated Variants             | 178.                                                                                             |
|  36 | Token-conflict Variants             | 0.                                                                                               |
|  37 | Incomplete Speech Variants          | 2.                                                                                               |
|  38 | Decoder-low-confidence Variants     | 0; decoder unavailable, not invented.                                                            |
|  39 | Raw ASR Recovery Triggers           | Suspicious single-variant events under bounded budget.                                           |
|  40 | Single-variant Re-ASR               | 12 triggered.                                                                                    |
|  41 | Multi-variant Re-ASR                | 12 inherited C6.0.1.4 triggered events.                                                          |
|  42 | Re-ASR Requests                     | 36 new requests.                                                                                 |
|  43 | New Candidates                      | 26.                                                                                              |
|  44 | New Candidate Evidence Completeness | 23 COMPLETE / 3 PARTIAL.                                                                         |
|  45 | Re-ASR Replacements                 | 2 pool winners; 2 proposals; 0 applied text replacements.                                        |
|  46 | Unresolved Events                   | 10 after new recovery.                                                                           |
|  47 | Local Association Repair            | Observe-only; 0 proposals / 0 applied.                                                           |
|  48 | Evidence Application Coverage       | Engineering gate passed.                                                                         |
|  49 | Produced Evidence                   | 1420.                                                                                            |
|  50 | Consumed Evidence                   | 1327.                                                                                            |
|  51 | Proposal-generated Evidence         | 41.                                                                                              |
|  52 | Applied Evidence                    | 6.                                                                                               |
|  53 | Final-affecting Evidence            | 6.                                                                                               |
|  54 | Ablation V0                         | Baseline replay, unchanged.                                                                      |
|  55 | Ablation V1                         | Lineage only, unchanged.                                                                         |
|  56 | Ablation V2                         | Variant evidence only, unchanged.                                                                |
|  57 | Ablation V3                         | Text application, no safe mutation.                                                              |
|  58 | Ablation V4                         | 6 timing applications; timing metrics slightly improved.                                         |
|  59 | Ablation V5                         | 180-event audit; final metrics same as V4.                                                       |
|  60 | Ablation V6                         | 26 raw candidates; final metrics same as V4.                                                     |
|  61 | Ablation V7                         | Association observe; 0 repairs.                                                                  |
|  62 | Full Candidate                      | Same metrics as V4-V7.                                                                           |
|  63 | Final A                             | Independent replay; frozen.                                                                      |
|  64 | Final B                             | Independent replay; frozen.                                                                      |
|  65 | A/B Parity                          | All requested semantic/output parity true.                                                       |
|  66 | Exact CER                           | Raw `0.5831146`; baseline/final `0.660105`.                                                      |
|  67 | Normalized CER                      | Raw `0.5166016`; baseline/final `0.6015625`.                                                     |
|  68 | Coverage                            | Baseline/final `0.96484375`.                                                                     |
|  69 | Missing                             | Baseline/final 6.                                                                                |
|  70 | Hallucination                       | Baseline/final 1.                                                                                |
|  71 | Material Errors                     | Raw 63; baseline 76; final 77.                                                                   |
|  72 | Raw ASR Origin Errors               | Comparable baseline 36; final 37.                                                                |
|  73 | Association Errors                  | Comparable baseline/final 40.                                                                    |
|  74 | Selector Errors                     | Comparable baseline 0; final 3.                                                                  |
|  75 | Pool Insufficient                   | Comparable baseline/final 47.                                                                    |
|  76 | Severe Timing                       | Raw 37; baseline/final 53.                                                                       |
|  77 | Start MAE                           | Baseline `1.631595`; final `1.609108`.                                                           |
|  78 | End MAE                             | Baseline `1.648858`; final `1.607836`.                                                           |
|  79 | P95                                 | Baseline `6.44`; final `5.385`.                                                                  |
|  80 | IoU                                 | Baseline `0.58`; final `0.582467`.                                                               |
|  81 | Overlap                             | Baseline/final 48.                                                                               |
|  82 | Raw->Final Gap                      | Normalized-CER gap unchanged at `0.0849609375`.                                                  |
|  83 | Text Mutation Count                 | 0.                                                                                               |
|  84 | Timing Mutation Count               | 6.                                                                                               |
|  85 | Final Hash Changes                  | Text same; timing/presentation/ASS/SRT/VTT changed.                                              |
|  86 | Unsafe Escape                       | 0.                                                                                               |
|  87 | Production Status                   | `needs-review`, `finalizationMethod = none`.                                                     |
|  88 | Gold Isolation                      | Runtime input 0; post-freeze read-only evaluation.                                               |
|  89 | Dataset Hardcoding                  | 0 findings.                                                                                      |
|  90 | Network                             | Disabled / unused.                                                                               |
|  91 | Source Read-only                    | Passed, same size/hash.                                                                          |
|  92 | Gold Read-only                      | Passed, same hash.                                                                               |
|  93 | Shareable                           | Audit passed with all leak/broken counts 0.                                                      |
|  94 | C5.19 Regression                    | Passed in full unit/E2E suite.                                                                   |
|  95 | C6 Investigation Regression         | Passed.                                                                                          |
|  96 | C6 Protected Regression             | Passed.                                                                                          |
|  97 | C6.0.1 Regression                   | Passed.                                                                                          |
|  98 | C6.0.1.1 Regression                 | Passed.                                                                                          |
|  99 | C6.0.1.2 Regression                 | Passed.                                                                                          |
| 100 | C6.0.1.3 Regression                 | Passed.                                                                                          |
| 101 | C6.0.1.4 Regression                 | Passed.                                                                                          |
| 102 | Unit Tests                          | 655 passed, 2 skipped across 81 files.                                                           |
| 103 | E2E                                 | 37 passed, 1 skipped across 18 files.                                                            |
| 104 | Targeted Tests                      | C6.0.1.5 and mapped-token suites passed.                                                         |
| 105 | Schemas                             | 216 generated; real artifacts strictly parsed.                                                   |
| 106 | Skill Validation                    | Skill entrypoint/CLI, build, schemas, and artifact contract passed.                              |
| 107 | Skill 2/3                           | Unchanged.                                                                                       |
| 108 | Quality Milestone                   | Failed.                                                                                          |
| 109 | Evidence Application Milestone      | Passed.                                                                                          |
| 110 | C6.0.2 Readiness                    | HOLD.                                                                                            |
| 111 | Remaining Risks                     | Raw text precision, association, selector, pool, timing, overlap, unseen generalization.         |
| 112 | Commits                             | `a82dd35`, `3b56501`, `200a190`, `5c40907`, `f27d470`, `4c9df26`, plus acceptance report commit. |
| 113 | Remote HEAD                         | Verified equal to local after acceptance push; exact SHA is reported in final handoff.           |
| 114 | Output Paths                        | Listed below.                                                                                    |

## Q1-Q14

**Q1. Why did the 694 C6.0.1.4 trusted tokens not change Final Timing?**

They stopped in evidence sidecars. There was no strict Event-to-Final target, proposal, non-degradation gate, canonical writeback, and three-format render loop.

**Q2. How many trusted tokens did C6.0.1.5 Timing Application consume?**

1027 of 1120 produced trusted tokens were consumed by variant-specific evidence/application logic.

**Q3. Of the 59 timing-eligible cues, how many proposed/applied/changed ASS?**

The 59 were the upstream C6.0.1.4 eligibility count. Strict lineage/evidence reduced this to 39 persisted timing proposals; 6 were applied and 6 cue timings changed in ASS/SRT/VTT.

**Q4. Why were none of C6.0.1.4's 25 new candidates selected?**

They were generated after the old candidate decision path and lacked a unified variant-specific evidence-to-canonical contract; diagnostic availability was not equivalent to runtime eligibility.

**Q5. Did a re-ASR candidate become a safe winner after variant-specific evidence?**

Yes at candidate-pool level: 2 C6.0.1.5 raw candidates were selected. No at canonical-text level: both replacement proposals failed strict safety, so applied text replacements remained 0.

**Q6. How many of 180 single-variant events were suspicious?**

180.

**Q7. How much did targeted re-ASR improve the pool?**

It produced 26 candidates, changed the selected candidate in 2 events, and the machine runtime proxy counted 48 complete/evidence-improved variants across the combined re-ASR pool. It applied 0 text replacements and did not improve final CER.

**Q8. RAW_ASR_ORIGIN 50 fell to what?**

It did not demonstrate a reduction. The legacy 50 and new 37 are not directly comparable. Under the same C6.0.1.5 evaluator, baseline 36 became final 37.

**Q9. Association Error 19 fell to what?**

It did not demonstrate a reduction. Legacy 19 is not directly comparable to the new event-lineage evaluator; under the same evaluator, baseline 40 remained final 40.

**Q10. Evidence produced/consumed/proposal/applied/final-affecting?**

1420 / 1327 / 41 / 6 / 6.

**Q11. Did Final ASS/SRT/VTT really change?**

Yes, each file hash changed because 6 cue timings changed. Text did not change.

**Q12. Which evidence was most effective for raw-ASR recovery?**

No single signal was sufficient. CTC plus speech/edge completeness was most effective for detecting suspicious events; prompt-isolated re-ASR stability produced alternatives; trusted tokens were most effective for the 6 safe timing applications. Decoder evidence was unavailable, and no evidence combination proved a safe text replacement.

**Q13. Did the Raw-to-Final CER gap materially shrink?**

No. The normalized gap stayed `0.0849609375`.

**Q14. Is high recall plus acceptable text/timing precision sufficient for C6.0.2 unseen validation?**

No. Coverage/recall guards passed, but text precision, raw-ASR-origin, association, selector, pool, severe timing, MAE, P95, and overlap gates failed. C6.0.2 remains on hold.

## Commits

- `a82dd35` — `feat: add C6.0.1.5 lineage and evidence contracts`
- `3b56501` — `feat: add canonical mutation and raw ASR recovery`
- `200a190` — `feat: integrate C6.0.1.5 quality harness`
- `5c40907` — `feat: separate C6.0.1.5 text and timing ablations`
- `f27d470` — `feat: isolate C6.0.1.5 association observe ablation`
- `4c9df26` — `fix: preserve untimed no-VAD whisper tokens`
- Acceptance documentation commit: `docs: record C6.0.1.5 quality acceptance`; exact SHA is supplied by the final handoff because a commit cannot contain its own SHA.

## Real output paths

- V0: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-5-baseline-20260828`
- V1: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-5-lineage-20260828`
- V2: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-5-variant-evidence-20260828`
- V3: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-5-text-application-20260828`
- V4: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-5-timing-application-20260828`
- V5: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-5-single-variant-audit-20260828`
- V6: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-5-raw-asr-recovery-20260828`
- V7: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-5-local-association-observe-20260828`
- Full: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-5-full-candidate-20260828`
- Final A: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-5-final-a-20260828`
- Final B: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-5-final-b-20260828`
- Validation: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-5-validation-20260828`
- Dual freeze barrier: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-5-dual-freeze-barrier-20260828.json`
- Each generation run has a sibling `-evaluation-20260828` directory containing the Gold-isolated evaluation.

## Final decision

- Engineering gate: **PASS**.
- Evidence-application milestone: **PASS**.
- Safety/reproducibility/shareable gates: **PASS**.
- Subtitle-quality milestone: **FAIL**.
- C6.0.2 readiness: **`HOLD_FOR_MORE_RAW_ASR_RECOVERY`**.
- Production: **`needs-review` / `finalizationMethod = none` / `machineOnlyReleaseAuthorized = false`**.
