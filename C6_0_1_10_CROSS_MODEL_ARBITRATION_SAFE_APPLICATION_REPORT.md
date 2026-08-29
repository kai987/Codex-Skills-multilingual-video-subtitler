# C6.0.1.10 Cross-model Arbitration & Safe Application Report

## Acceptance outcome

C6.0.1.10 engineering acceptance passed, but automatic cross-model arbitration is not safe enough to enable. The frozen production profile is `DISABLED`, the policy result is `HOLD_ARBITRATION_NOT_SAFE`, and the release route is `HOLD_FOR_ARBITRATION_EVIDENCE_REDESIGN`.

The run made no Canonical text or timing mutation. Production remains `needs-review`, `finalizationMethod = none`, and machine-only release is not authorized. The strict C6.0.2 quality gate also remains closed.

This is an abstention-first result, not a failed implementation: the system expanded Reazon evidence to the episode holdout, prevented unsafe switches, produced deterministic Final A/B artifacts, and truthfully declined to realize an Oracle gain that it could not select safely.

## Immutable identities and runtime

- Branch: `codex/c6-0-1-10-cross-model-arbitration`
- Baseline commit: `af2ea2b45064694730dd86d2c8d9b40a9a3b2873`
- Policy version: `c6.0.1.10-cross-model-arbitration-v1`
- Arbitration policy hash: `cbdd0f42c58740d609329645e024b4706f6e4b38aad7e1d9ad7f21a204a1dc67`
- Source SHA-256: `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`
- Gold SHA-256: `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`
- Reazon model: `reazon-research/reazonspeech-k2-v2`
- Revision: `291488c8151be24d7da4bf7af26e533fad96e407`
- Model snapshot hash: `607e2d9a4e6af5deba39fde5dc0e5f8726c569fdc734552b32d95fc5c6052cf3`
- Runtime ID: `d0f332c33d2a3151ee3ee5c3a4602f3cec13df3828b787fd0dd634e58d9f0d64`
- Runtime: sherpa-onnx `1.13.6`, FP32, CPU, `arm64 / Apple M1 Pro`
- Encoder SHA-256: `ecdb0b771e16104aaf8e579cb3c1e32fbd589eb641c5946d82b615bd366c5f96`
- Decoder SHA-256: `58b18211ae06265466bfa17172dab574df94f76c8bcb61a3640c28ba860e4124`
- Joiner SHA-256: `d38a81d1191c9ed6de6a1719503692e07e3e973e2364adde0abae5eaaded1174`
- Tokens SHA-256: `2c3ac659818a48a0c04010e0593bbc4d7c8a24a054340b01131499c05fd52def`

## Development commits

1. Evidence architecture: `b7c887b` — `feat: add cross-model arbitration evidence and policy profiles`
2. DEV24 calibration: `85b88ff` — `feat: calibrate abstention-first arbitration on frozen DEV24`
3. Episode holdout: `e77abc4` — `feat: add episode holdout Reazon inference and arbitration`
4. Safe application / replay: `6eb8704` — `feat: add safe Reazon span-level canonical application`
5. Gold-isolated evaluation: `f6a7ec6` — `test: add Gold-isolated arbitration safety evaluation`
6. Acceptance documentation: this report's acceptance commit; the final delivery response records its immutable SHA and remote parity.

## DEV24 calibration

The DEV24 set is the exact frozen C6.0.1.9 set: 12 targets and 12 controls. Gold was read only after all three machine decision ledgers were frozen.

| Profile           | SELECT | KEEP | ABSTAIN | Blocked | Evaluable switches | Correct | Wrong | Local gain | Oracle capture |
| ----------------- | -----: | ---: | ------: | ------: | -----------------: | ------: | ----: | ---------: | -------------: |
| CONSERVATIVE      |      2 |    5 |       0 |      13 |                  1 |       0 |     1 |         -9 |  -0.4090909091 |
| BALANCED          |      2 |    5 |       0 |      13 |                  1 |       0 |     1 |         -9 |  -0.4090909091 |
| AGGRESSIVE_SHADOW |      4 |    3 |       0 |      13 |                  3 |       1 |     2 |         -2 |  -0.0909090909 |

No production-eligible profile met the required combination of zero wrong switches and positive realized gain. Production therefore froze as `DISABLED`. The disabled ledger has 0 `SELECT_REAZON`, 5 `KEEP_CURRENT_WHISPER`, 2 `ABSTAIN_REVIEW`, 4 agreement/no-change, and 13 blocked events.

## Episode holdout and model execution

- Candidate holdout events: 175
- Machine-localizable: 149
- Excluded before arbitration: 26 (12 non-single-utterance; 14 missing final-cue lineage)
- CORE_EXACT: planned 149, actual 149, Fresh inference 149, cache hit 0
- CORE_CONTEXT: planned 130, actual 130, Fresh inference 130, cache hit 0
- Total successful Reazon results: 279; failed 0; empty 0
- Persistent worker: model load 1; process start 1
- Gold runtime inputs: 0; network: false

Reazon stability across the 149 machine-localizable events:

- `REAZON_CORE_STABLE`: 14
- `REAZON_CONTEXT_EXTENSION_ONLY`: 22
- `REAZON_LEXICALLY_UNSTABLE`: 93
- `REAZON_HALLUCINATION_UNSTABLE`: 1
- Context not run: 19

Cross-model relations:

- Exact agreement: 4
- Normalized agreement: 15
- Orthography-only difference: 15
- Pronunciation agreement: 1
- Lexical disagreement: 112
- Whisper hallucination-risk relation: 2

Only 2 potential switches reached CTC. Both were `CTC_AMBIGUOUS`; none favored Whisper or Reazon. Final holdout decisions were 19 agreement/no-change, 15 keep Whisper, 2 abstain, 62 unsafe-span blocks, and 51 unstable-Reazon blocks. No Reazon candidate was selected.

## Gold-isolated arbitration evaluation

After machine freeze, 144/149 localizable holdout events were Gold-evaluable. Across those events Reazon was locally better in 41, worse in 69, and equal in 34. The disabled production policy made zero switches, avoided 69 potential regressions, realized 0 of 210 holdout Oracle error points, and introduced zero wrong automatic replacement.

The earlier DEV24 Union Oracle gain was 22. Combined DEV24 + holdout available Oracle gain was 232, while realized arbitration gain was 0 and Oracle capture rate was 0.

Signal calibration explains why the policy stayed disabled:

| Machine-side subset              | Evaluable | Reazon better | Reazon worse | Equal |
| -------------------------------- | --------: | ------------: | -----------: | ----: |
| All holdout events               |       144 |            41 |           69 |    34 |
| Reazon stable                    |        35 |            11 |           21 |     3 |
| Whisper negative                 |         9 |             3 |            4 |     2 |
| Cross-family corroboration       |         4 |             0 |            3 |     1 |
| Reazon stable + Whisper negative |         4 |             2 |            2 |     0 |

No existing machine signal or tested combination separated safe Reazon wins from regressions reliably. CTC supplied neither a useful support nor a harmful preference in this holdout: 2 ambiguous, 0 correct support, 0 wrong support, 0 useful contradiction, and 0 harmful contradiction.

## Mutation and Final A/B

- Mutation proposals: 0
- Accepted: 0
- Rejected: 0
- Applied: 0
- Text-changed final cues: 0
- Timing-changed final cues: 0

Final B replayed all 279 frozen Reazon results from exact cache. Cache hits were 279/279; inference, model load, process start, network, and runtime Gold input were all 0.

Final A/B parity is true for evidence bundles, decisions, mutation proposals, applied mutations, final text, final timing, ASS, SRT, VTT, production status, and route decision.

Production hashes:

- Canonical text: `bdb9e93c39d799f2a136cb023a3de1a4d7bde904c2f0f5f13a2f3e3fbeb8c48e`
- Canonical timing: `b4c5eaae50284455e502aa2bdcae38a3dd4df9c4622397af86e3790463d00e86`
- Presentation: `a70f459da8f8513565da4a3b483646a709dafcf9ff9d96ef9065de9f6ebb5dd7`
- ASS: `f46039ec15cf1306da86babcd23d8dc769e1cdb9167cc2f0b51af930bce45981`
- SRT: `ec2fe7c76ac235151965d728466d8592650f86b38b16e48500b4b6bf83723083`
- VTT: `00a5936b752ba155b3e410b42c9b7a5e9d4969b441d5179494144a631983933f`

## Global Gold quality and evaluator provenance

The legacy single-run Gold command correctly rejected the augmented C6.0.1.10 directory because its old blind-freeze file set predates the new artifacts. The acceptance did not bypass or weaken that freeze contract.

Instead, global evaluation used a hash-anchored deterministic replay. The previously Gold-evaluated C6.0.1.7 Final A `subtitle-package.json`, C6.0.1.10 Baseline, Final A, and Final B are byte-identical (`b1026b81be622475398f961658975da3c014d1157fc41c9966095f2db1d8386e`). Therefore the frozen Gold evaluation is exactly reusable for the present rendered output; no model inference or Gold-driven runtime selection was performed.

| Metric                 |       Baseline |          Final | Delta |
| ---------------------- | -------------: | -------------: | ----: |
| Final cues             |            161 |            161 |     0 |
| Exact CER              |   0.6601049869 |   0.6601049869 |     0 |
| Normalized CER         |      0.6015625 |      0.6015625 |     0 |
| Coverage               |     0.96484375 |     0.96484375 |     0 |
| Missing                |              6 |              6 |     0 |
| Hallucination          |              1 |              1 |     0 |
| Material errors        |             77 |             77 |     0 |
| Severe timing          |             53 |             53 |     0 |
| Start MAE              | 1.6091082275 s | 1.6091082275 s |     0 |
| End MAE                | 1.6078355157 s | 1.6078355157 s |     0 |
| P95 boundary error     |        5.385 s |        5.385 s |     0 |
| Median IoU             |   0.5824665676 |   0.5824665676 |     0 |
| All-pair overlap count |             48 |             48 |     0 |

Strict C6.0.2 failures are Material 77 > 45, Normalized CER 0.6015625 > 0.55, Severe Timing 53 > 30, Start MAE 1.609 > 1.2, End MAE 1.608 > 1.2, P95 5.385 > 3.5, and Overlap 48 > 20. Coverage, Missing, Hallucination, runtime Gold isolation, hardcoding, and unsafe-finalization constraints pass.

## Engineering verification

- Schema generation: 285 JSON Schemas
- Typecheck: passed
- ESLint: passed
- Prettier check: passed
- Build: passed
- Full unit/integration suite: 96 files passed; 717 passed, 2 skipped
- E2E suite: 23 files passed; 42 passed, 1 skipped
- C5.19 through C6.0.1.10 targeted regression: 31 files; 165/165 passed
- C6.0.1.10 targeted unit + E2E: 12/12 passed
- Multilingual Video Subtitler Skill quick validation: passed
- Shareable audit: 15/15 outputs passed; absolute path leak 0; prohibited secret 0; broken relative reference 0
- Skill 2 / Skill 3 changes: 0
- Runtime dataset-specific dialogue literal findings: 0
- Source and Gold read-only identity: verified

## Required 1–140 delivery ledger

|   # | Item                                   | Result                                                                                   |
| --: | -------------------------------------- | ---------------------------------------------------------------------------------------- |
|   1 | Branch                                 | `codex/c6-0-1-10-cross-model-arbitration`                                                |
|   2 | Baseline                               | `af2ea2b45064694730dd86d2c8d9b40a9a3b2873`                                               |
|   3 | Evidence Commit                        | `b7c887b`                                                                                |
|   4 | DEV24 Arbitration Commit               | `85b88ff`                                                                                |
|   5 | Holdout Commit                         | `e77abc4`                                                                                |
|   6 | Mutation Commit                        | `6eb8704`                                                                                |
|   7 | Evaluation Commit                      | `f6a7ec6`                                                                                |
|   8 | Acceptance Commit                      | This report's commit; immutable SHA in final delivery response                           |
|   9 | Remote HEAD                            | Must equal Acceptance Commit; verified in final delivery response                        |
|  10 | Policy Version                         | `c6.0.1.10-cross-model-arbitration-v1`                                                   |
|  11 | Policy Hash                            | `cbdd0f42c58740d609329645e024b4706f6e4b38aad7e1d9ad7f21a204a1dc67`                       |
|  12 | Baseline Replay Passed                 | Yes, 17/17 checks                                                                        |
|  13 | Available Oracle Gain                  | 22 DEV24 points                                                                          |
|  14 | DEV24 Event Count                      | 24                                                                                       |
|  15 | DEV24 Target Count                     | 12                                                                                       |
|  16 | DEV24 Control Count                    | 12                                                                                       |
|  17 | Conservative SELECT_REAZON             | 2                                                                                        |
|  18 | Conservative KEEP                      | 5                                                                                        |
|  19 | Conservative ABSTAIN                   | 0                                                                                        |
|  20 | Conservative Correct Switches          | 0                                                                                        |
|  21 | Conservative Wrong Switches            | 1                                                                                        |
|  22 | Conservative Local Gain                | -9                                                                                       |
|  23 | Conservative Oracle Capture            | -0.4090909091                                                                            |
|  24 | Balanced SELECT_REAZON                 | 2                                                                                        |
|  25 | Balanced KEEP                          | 5                                                                                        |
|  26 | Balanced ABSTAIN                       | 0                                                                                        |
|  27 | Balanced Correct Switches              | 0                                                                                        |
|  28 | Balanced Wrong Switches                | 1                                                                                        |
|  29 | Balanced Local Gain                    | -9                                                                                       |
|  30 | Balanced Oracle Capture                | -0.4090909091                                                                            |
|  31 | Aggressive Shadow SELECT_REAZON        | 4                                                                                        |
|  32 | Aggressive Shadow Correct              | 1                                                                                        |
|  33 | Aggressive Shadow Wrong                | 2                                                                                        |
|  34 | Selected Production Profile            | `DISABLED`                                                                               |
|  35 | Production Profile Wrong Switch DEV24  | 0 executed; both eligible profiles would have 1                                          |
|  36 | Production Profile Net Gain DEV24      | 0 executed; eligible profiles scored -9                                                  |
|  37 | Policy Frozen Before Holdout Gold      | Yes                                                                                      |
|  38 | Holdout Canonical Event Count          | 175                                                                                      |
|  39 | Holdout Machine-localizable Count      | 149                                                                                      |
|  40 | Holdout Reazon Core Exact Planned      | 149                                                                                      |
|  41 | Holdout Reazon Core Exact Actual       | 149                                                                                      |
|  42 | Holdout Core Exact Cache Hits          | 0                                                                                        |
|  43 | Holdout Core Exact Fresh Inferences    | 149                                                                                      |
|  44 | Holdout Context Escalation Planned     | 130                                                                                      |
|  45 | Holdout Context Actual                 | 130                                                                                      |
|  46 | Holdout Context Fresh Inference        | 130                                                                                      |
|  47 | Reazon Stable Holdout                  | 14                                                                                       |
|  48 | Reazon Context-extension Holdout       | 22                                                                                       |
|  49 | Reazon Lexical-unstable Holdout        | 93                                                                                       |
|  50 | Reazon Hallucination-risk Holdout      | 1                                                                                        |
|  51 | Cross-model Agreement Holdout          | 19 exact/normalized; plus 1 pronunciation agreement                                      |
|  52 | Orthography-only Holdout               | 15                                                                                       |
|  53 | Lexical Disagreement Holdout           | 112                                                                                      |
|  54 | CTC Eligible Holdout                   | 2                                                                                        |
|  55 | CTC Supports Whisper Holdout           | 0                                                                                        |
|  56 | CTC Supports Reazon Holdout            | 0                                                                                        |
|  57 | CTC Ambiguous Holdout                  | 2                                                                                        |
|  58 | CTC Unscorable Holdout                 | 0                                                                                        |
|  59 | Holdout SELECT_REAZON                  | 0                                                                                        |
|  60 | Holdout KEEP                           | 15                                                                                       |
|  61 | Holdout ABSTAIN                        | 2                                                                                        |
|  62 | Holdout Blocked Localization           | 26 pre-arbitration exclusions; ledger-local count 0                                      |
|  63 | Holdout Blocked Span                   | 62                                                                                       |
|  64 | Holdout Correct Switches               | 0                                                                                        |
|  65 | Holdout Wrong Switches                 | 0                                                                                        |
|  66 | Holdout Neutral Switches               | 0                                                                                        |
|  67 | Holdout Evaluable Switches             | 0                                                                                        |
|  68 | DEV24 Avoided Blind Reazon Regressions | 4/4                                                                                      |
|  69 | Holdout Avoided Regression Count       | 69                                                                                       |
|  70 | Total Arbitration Decisions            | 173 ledger decisions (24 DEV + 149 holdout)                                              |
|  71 | Total SELECT_REAZON                    | 0 production                                                                             |
|  72 | Total KEEP                             | 20; agreement/no-change is a separate 23                                                 |
|  73 | Total ABSTAIN                          | 4                                                                                        |
|  74 | Total Blocked                          | 126 ledger blocks; plus 26 pre-arbitration exclusions                                    |
|  75 | Mutation Proposals                     | 0                                                                                        |
|  76 | Mutation Accepted                      | 0                                                                                        |
|  77 | Mutation Rejected                      | 0                                                                                        |
|  78 | Mutation Applied                       | 0                                                                                        |
|  79 | Text Changed Final Cue Count           | 0                                                                                        |
|  80 | Timing Changed Final Cue Count         | 0                                                                                        |
|  81 | Gold-improving Applied Replacements    | 0                                                                                        |
|  82 | Gold-neutral Applied Replacements      | 0                                                                                        |
|  83 | Gold-worsening Applied Replacements    | 0                                                                                        |
|  84 | Arbitration Precision                  | N/A; no switch executed                                                                  |
|  85 | Arbitration Harm Rate                  | N/A; no switch executed, observed automatic harm 0                                       |
|  86 | Available Oracle Gain                  | 232 total (22 DEV + 210 holdout)                                                         |
|  87 | Realized Arbitration Gain              | 0                                                                                        |
|  88 | Oracle Capture Rate                    | 0                                                                                        |
|  89 | DEV24 Oracle Capture Rate              | 0 production; candidate profiles were negative                                           |
|  90 | Holdout Oracle Capture Rate            | 0                                                                                        |
|  91 | CTC Correct Support Count              | 0                                                                                        |
|  92 | CTC Wrong Support Count                | 0                                                                                        |
|  93 | CTC Useful Contradiction Count         | 0                                                                                        |
|  94 | CTC Harmful Contradiction Count        | 0                                                                                        |
|  95 | CTC Net Utility                        | 0                                                                                        |
|  96 | Baseline Final Cue Count               | 161                                                                                      |
|  97 | Final Cue Count                        | 161                                                                                      |
|  98 | Baseline Exact CER                     | 0.6601049869                                                                             |
|  99 | Final Exact CER                        | 0.6601049869                                                                             |
| 100 | Baseline Normalized CER                | 0.6015625                                                                                |
| 101 | Final Normalized CER                   | 0.6015625                                                                                |
| 102 | Exact CER Delta                        | 0                                                                                        |
| 103 | Normalized CER Delta                   | 0                                                                                        |
| 104 | Baseline Coverage                      | 0.96484375                                                                               |
| 105 | Final Coverage                         | 0.96484375                                                                               |
| 106 | Baseline Missing                       | 6                                                                                        |
| 107 | Final Missing                          | 6                                                                                        |
| 108 | Baseline Hallucination                 | 1                                                                                        |
| 109 | Final Hallucination                    | 1                                                                                        |
| 110 | Baseline Material Errors               | 77                                                                                       |
| 111 | Final Material Errors                  | 77                                                                                       |
| 112 | Material Error Delta                   | 0                                                                                        |
| 113 | Baseline Severe Timing                 | 53                                                                                       |
| 114 | Final Severe Timing                    | 53                                                                                       |
| 115 | Baseline Start MAE                     | 1.6091082275 s                                                                           |
| 116 | Final Start MAE                        | 1.6091082275 s                                                                           |
| 117 | Baseline End MAE                       | 1.6078355157 s                                                                           |
| 118 | Final End MAE                          | 1.6078355157 s                                                                           |
| 119 | Baseline P95                           | 5.385 s                                                                                  |
| 120 | Final P95                              | 5.385 s                                                                                  |
| 121 | Baseline IoU                           | 0.5824665676                                                                             |
| 122 | Final IoU                              | 0.5824665676                                                                             |
| 123 | Baseline Overlap                       | 48 all-pair overlaps                                                                     |
| 124 | Final Overlap                          | 48 all-pair overlaps                                                                     |
| 125 | Canonical Text Mutation Count          | 0                                                                                        |
| 126 | Canonical Timing Mutation Count        | 0                                                                                        |
| 127 | ASS Hash Changed                       | No                                                                                       |
| 128 | SRT Hash Changed                       | No                                                                                       |
| 129 | VTT Hash Changed                       | No                                                                                       |
| 130 | Timing Hash Parity                     | True                                                                                     |
| 131 | Engineering Gate Passed                | True                                                                                     |
| 132 | Arbitration Safety Gate Passed         | False                                                                                    |
| 133 | Cross-model Safe Gain Confirmed        | False                                                                                    |
| 134 | Strict C6.0.2 Gate                     | False                                                                                    |
| 135 | Production Status                      | `needs-review`; `finalizationMethod = none`                                              |
| 136 | Machine Release Authorized             | False                                                                                    |
| 137 | Runtime Gold / Hardcoding / Network    | 0 / 0 / false                                                                            |
| 138 | Tests / Schemas / Regressions          | 717 pass + 2 skip; E2E 42 + 1 skip; 285 schemas; targeted 165/165                        |
| 139 | Report / Output Paths                  | This report and the 15 paths listed below                                                |
| 140 | Worktree Status                        | Clean before report creation; final clean/remote parity recorded after acceptance commit |

## Required Q1–Q18 answers

### Q1. How much of the 22-point C6.0.1.9 Union Oracle gain was safely realized?

0 points. Automatic enforcement was disabled because every production-eligible profile produced a wrong DEV24 switch and negative local gain.

### Q2. What is the Oracle Capture Rate?

0 for production. Total available gain was 232 points after adding holdout evidence, but realized gain remained 0.

### Q3. Which is safer, CONSERVATIVE or BALANCED?

They tie on this frozen DEV24: both selected 2, had 1 evaluable switch, 0 correct, 1 wrong, and -9 gain. Neither is safe enough for production.

### Q4. Why was the current Production Profile selected?

`DISABLED` is the only safe choice under the frozen rule. CONSERVATIVE and BALANCED both violated the zero-wrong-switch and positive-gain requirements; AGGRESSIVE_SHADOW was never production-eligible and was worse.

### Q5. How many DEV24 SELECT_REAZON decisions were made, and how many helped or hurt?

CONSERVATIVE and BALANCED each proposed 2. Only 1 was Gold-evaluable: 0 improved and 1 worsened. AGGRESSIVE_SHADOW proposed 4, with 1 correct and 2 wrong among 3 evaluable. Production executed 0.

### Q6. How many of the previous four blind-Reazon control regressions were avoided?

All 4/4 were avoided by the abstention-first production policy.

### Q7. How many Episode Holdout Reazon selections were automatic?

0.

### Q8. How many holdout Reazon switches improved or worsened after Gold?

No switches were executed, so 0 improved and 0 worsened. Post-hoc candidate comparison found Reazon better on 41 events and worse on 69, demonstrating why broad switching was unsafe.

### Q9. How many Gold-improving Reazon replacements entered the final episode?

0.

### Q10. Is Gold-worsening automatic replacement zero?

Yes. It is zero because the safety gate disabled enforcement; it was not achieved by hiding or reclassifying a wrong switch.

### Q11. Which machine evidence best predicts Reazon being better?

None of the tested signals is reliable alone or in the tested combination. Reazon stability yielded 11 better versus 21 worse; Whisper-negative evidence 3 versus 4; cross-family corroboration 0 versus 3; stable + Whisper-negative 2 versus 2. A newly calibrated, truly independent localized discriminator is required.

### Q12. Was CTC helpful, useless, or harmful?

On this holdout it was effectively non-informative: both eligible events were ambiguous, with zero correct support, wrong support, useful contradiction, or harmful contradiction. It caused no harm because it was never allowed to select a winner.

### Q13. How should CTC be retained next?

Retain a clear Whisper-favoring result as a hard veto, but treat positive Reazon support as audit-only until a larger Gold-isolated calibration proves utility. It must remain correlated with Reazon and never count as an independent vote.

### Q14. How much did final Normalized CER and Material Errors improve?

Neither improved: Normalized CER delta 0; Material Error delta 0.

### Q15. Did second-ASR complementary information enter final ASS/SRT/VTT?

No. It entered evidence, arbitration, Oracle, and audit artifacts, but no candidate passed the frozen safety policy. ASS/SRT/VTT stayed byte-equivalent to baseline.

### Q16. Has cross-model arbitration proved that two ASRs improve the final result over Whisper alone?

No. Complementarity exists in the Oracle, but safe final application was not demonstrated.

### Q17. What is the next bottleneck?

The immediate C6.0.1.10 bottleneck is arbitration evidence calibration: the current signals cannot separate Reazon wins from regressions. Release quality is additionally blocked by a mixed text/timing problem—77 material errors, 53 severe timing errors, MAE around 1.61 s, P95 5.385 s, and 48 overlaps. The next iteration should build event-local independent evidence and calibrated abstention labels first, then address timing/overlap without adding a third ASR, Gold-driven runtime selection, or ad-hoc timing rules.

### Q18. Did the Strict C6.0.2 Gate pass, and what exactly should happen next?

No. The next stage should: (1) create a larger Gold-isolated calibration set stratified by stable/better, stable/worse, Whisper-negative, and cross-family cases; (2) develop a localized independent discriminator that does not reuse Reazon/CTC-correlated evidence; (3) keep the default Whisper and require prospective zero-harm validation before re-enabling any switch; (4) separately recover material text errors and timing/overlap using existing event/cue lineage; and (5) rerun the unchanged strict thresholds. Do not proceed to C6.0.2 while these gates remain false.

## Output paths

1. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-baseline-20260829`
2. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-dev24-evidence-20260829`
3. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-dev24-conservative-20260829`
4. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-dev24-balanced-20260829`
5. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-dev24-aggressive-shadow-20260829`
6. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-policy-freeze-20260829`
7. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-holdout-selection-20260829`
8. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-holdout-reazon-20260829`
9. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-holdout-arbitration-20260829`
10. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-mutation-proposals-20260829`
11. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-full-candidate-20260829`
12. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-final-a-20260829`
13. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-final-b-20260829`
14. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-oracle-capture-20260829`
15. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-10-validation-20260829`
