# C6.0.1.12 Multi-ASR Review Assistance Acceptance Report

This report records the C6.0.1.12 acceptance state from the frozen 2026-08-29 Carnation artifacts, with final hardening and regression verification on 2026-08-30. Policy version is `c6.0.1.12-multi-asr-review-assistance-v2`; policy hash is `33066e8e856198c04a153fbaf8d617543467adb03c0854b68e47b9b07b320c8e`. Paths are local evidence locations. Gold-derived measurements are post-freeze evaluation results only and are not runtime review inputs.

## 1. Executive Conclusion

C6.0.1.12 engineering, offline review workflow, Gold barrier, synthetic correction/apply workflow, artifact validation, and regression suites passed. The product-route result is `REVIEW_ASSISTANCE_ENGINEERING_READY_RANKING_WEAK`: an unseen-episode real human trial is authorized, but ranking effectiveness and workload reduction are not established. Production remains `needs-review`, `finalizationMethod = none`, `machineOnlyReleaseAuthorized = false`, and C6.0.2 remains `HOLD`.

The required Q1-Q20 answers are:

| Question | Evidence-backed answer                                                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1       | Episode 1 already has a complete human Gold and is only the development benchmark; re-review would not be blind or a valid human-efficiency trial.                                                                                        |
| Q2       | 161 machine cues produced 153 Review Items and 45 Review Regions.                                                                                                                                                                         |
| Q3       | REQUIRED burden is 63 items, 30 regions, and 704.9408125 seconds of audio.                                                                                                                                                                |
| Q4       | Text is the largest category (95 unique items), followed by Missing (59) and Timing (31); categories are multi-label.                                                                                                                     |
| Q5       | Bundles exist for 153/153 items; 109 have non-empty displayed candidates and the frozen bundle reports 95 candidate-actionable items.                                                                                                     |
| Q6       | 6/77 material errors have a complete one-click candidate fix under final-cue lineage evaluation.                                                                                                                                          |
| Q7       | Candidate Fix Rate is 0.07792207792207792 (7.79%).                                                                                                                                                                                        |
| Q8       | 13 material-error components are `MANUAL_EDIT_REQUIRED`; 9 unqueued components are explicitly `UNEVALUABLE`, not silently counted as manual-editable.                                                                                     |
| Q9       | At the fixed-item Top 20% budget, R3 residual error 0.7153284671532847 beats chronological R0 0.781021897810219; it also beats R0 in the audio-matched simulation.                                                                        |
| Q10      | At the fixed-item Top 20% budget, no: R3 loses to R2 (0.7153284671532847 versus 0.6861313868613139). At the audio-matched Top 20% cap, R3 wins (0.5693430656934306 versus 0.5985401459854015). Neither measures actual human review time. |
| Q11      | Top 20% captures 19/77 material errors (recall 0.24675324675324675).                                                                                                                                                                      |
| Q12      | Top 30% captures 26/77 (recall 0.33766233766233766).                                                                                                                                                                                      |
| Q13      | Top 50% captures 40/77 (recall 0.5194805194805194).                                                                                                                                                                                       |
| Q14      | Severe-timing recall at 20/30/50% is 0.32075471698113206 / 0.39622641509433965 / 0.5849056603773585.                                                                                                                                      |
| Q15      | Hallucination is captured at R3 rank 1; 5/6 missing-dialogue components are captured, while one is absent from the queue.                                                                                                                 |
| Q16      | Ideal Top 30% residual exact CER/material errors: 0.431758530183727 / 51; Top 50%: 0.3328958880139983 / 37.                                                                                                                               |
| Q17      | Yes: the offline workspace supports audio, candidate selection, manual text, timing, add cue, autosave, and resume.                                                                                                                       |
| Q18      | Yes: all nine decision actions were validated through an independent non-Gold synthetic fixture; strict ASS/SRT/VTT apply passed.                                                                                                         |
| Q19      | No real Carnation session was created and no reviewer timer ran, so time is `NOT_MEASURED_IN_C6_0_1_12`; the unseen trial must use an explicit local timer and measured decisions.                                                        |
| Q20      | No A-grade product-ready claim is made. The truthful state is engineering-ready/ranking-weak, while an unseen-episode real human trial is authorized without a workload-reduction claim.                                                  |

## 2. Branch

Branch: `codex/c6-0-1-12-multi-asr-review-assistance`. Base/starting remote HEAD: `6ebaaeaf6cccc14a796a4ec24aef12fcf0a76693`. The sixth commit records this acceptance report, the trial protocol, and the Skill 1 update. Its immutable SHA and the post-push remote comparison are recorded in the final delivery response rather than embedding a self-referential commit hash in this report.

## 3. Baseline

The replayed C6.0.1.11 machine draft has 161 cues and hash `b1026b81be622475398f961658975da3c014d1157fc41c9966095f2db1d8386e`. Post-freeze evaluation confirms exact CER `0.6601049868766404`, normalized CER `0.6015625`, coverage `0.96484375`, missing `6`, hallucination `1`, material errors `77`, severe timing errors `53`, start MAE `1.6091082275459374 s`, end MAE `1.6078355157481543 s`, p95 `5.384999999999991 s`, and median IoU `0.5824665676077242`. The upstream legacy overlap metric is `48`; C6.0.1.12's local overlap evaluator separately reports aggregate machine/gold counts `37/9` as `UNEVALUABLE_GLOBAL_ONLY` and does not invent interval-level errors.

## 4. C6.0.1.11 Replay

Replay passed with baseline semantic hash `2180553d58ef6304648a3879d48a18e31c827ca63afbb7fa9437793f9bd134d6`, upstream C6.0.1.11 baseline hash `a70f95998acc522101e46cbf61f630490988cbb931984daea2cc6ec3afacbe2e`, and upstream Final A hash `e04f032a33de8251d00898ee3619cc58bd88d3ee06adfd0c3002d3e85e72f874`. C6.0.1.12 Final A/B preserved the complete upstream trees byte-for-byte.

## 5. Route Change

The runtime product route is now `HUMAN_ON_EXCEPTION`; automatic provider switching remains disabled. Route artifact hash: `842f1541468426591b7796e4384e0ed0b464d78da71a433737fb693dc0006c80`.

## 6. Why Episode 1 Is Not Re-reviewed

Carnation episode 1 already has a complete reviewed Gold and the reviewer is familiar with it. It is therefore a development benchmark, not a blind human trial. C6.0.1.12 creates no Carnation `review-session.json`, correction log, audit log, or human-reviewed production output.

## 7. Gold-simulated Evaluation Design

Machine policy, items, priorities, regions, candidates, audio manifest, and workspace were built with Gold input count `0` and frozen first. Only the separate evaluator read one Gold input after freeze. The evaluator materialized `137` unique Gold error components (`77` material text, `53` severe timing, `1` hallucination, `6` missing dialogue) and associated them through complete machine-alignment/final-cue lineage, never arbitrary interval overlap. `121/137` components have at least one lineage-backed Review Item; the `16` uncovered components are `9` material, `6` severe timing, and `1` missing dialogue. The resulting queue contains `68` error-labeled and `85` `CLEAN_OR_MINOR` items with `136` item-component links. These are post-freeze metrics; no full Gold text enters the runtime package or shareable summary.

## 8. Real Human Trial Deferred

The real efficiency trial is deferred to an unseen episode that the reviewer has not reviewed and for which no reference transcript has been exposed. No result in this report substitutes Gold simulation for a real session.

## 9. Human-on-exception Goal

The intended workflow is machine draft -> evidence-ranked exceptions -> local audio and candidates -> explicit human decisions -> strict reviewed package. The goal is assistance, not a claim that human review is eliminated.

## 10. Goals

Delivered goals are a Gold-free review queue, explainable priorities, merged review regions, playable local audio, candidate bundles, offline review workspace, append-only correction/audit design, strict apply/export, frozen pre-Gold package, post-freeze evaluation, and a protocol for the first real trial.

## 11. Non-goals

This version does not automatically select a provider, retrain a winner classifier, modify canonical text/timing, perform ASR inference, create a Carnation human session, estimate human time, authorize machine-only release, or authorize C6.0.2.

## 12. Review Item Taxonomy

The frozen taxonomy contains 15 possible types. Observed multi-label counts are: `GENERAL_UNCERTAINTY=124`, `TEXT_REAZON_INSTABILITY=81`, `MISSING_SPEECH_RISK=59`, `TIMING_BOUNDARY_RISK=31`, `TEXT_CROSS_MODEL_DISAGREEMENT=20`, `TEXT_WHISPER_INSTABILITY=12`, `TEXT_HALLUCINATION_RISK=7`, `OVERLAP_RISK=7`, `TEXT_LOW_ACOUSTIC_SUPPORT=4`, `SPAN_LINEAGE_BLOCKED=4`, and `LOCALIZATION_RISK=3`; the remaining declared types have zero observed items.

## 13. Item Count

`153` review signals were consolidated into `153` Review Items for `161` machine-final cues. Review-item artifact semantic hash: `07b27f9a0b4aa62f1ca1159efd3d75a4544861ffba45a225080c7d622b6eb165`.

## 14. Multi-label Reasons

`128/153` items carry multiple labels, and `44` are orphan review items without a safe final-cue association. Counts deliberately overlap; they must not be summed as unique errors.

## 15. Priority Design

The score is an explainable risk rank, not an error probability. Frozen thresholds are CRITICAL `>=90`, HIGH `>=68`, MEDIUM `>=40`, otherwise LOW; type weights and bounded multi-label/evidence boosts are recorded in policy hash `33066e8e856198c04a153fbaf8d617543467adb03c0854b68e47b9b07b320c8e`.

## 16. Priority Tiers

Observed priority tiers total 153: CRITICAL `61`, HIGH `77`, MEDIUM `6`, LOW `9`. Priority artifact semantic hash: `e8868511d3f353c42b674d4c71663be4fcb606c47490c26fba47e351fc4b86f0`.

## 17. Critical Count

CRITICAL: `61`.

## 18. High Count

HIGH: `77`.

## 19. Medium Count

MEDIUM: `6`.

## 20. Low Count

LOW: `9`.

## 21. Required Count

REQUIRED: `63` items. All CRITICAL items are required; high-risk required types remain explicit policy rules.

## 22. Recommended Count

RECOMMENDED: `81` items.

## 23. Informational Count

INFORMATIONAL: `9` items.

## 24. Review Region Design

Regions use source-global time, merge gaps up to `1.5 s`, cap core duration at `30 s`, and preserve scene and multi-speaker boundaries. `108` item memberships were merged; the region artifact hash is `9ba551a0d05cb863dec041dc43911c42d083eab96a0db58caf10d01961c6bf86`.

## 25. Region Count

Total Review Regions: `45`.

## 26. Required Region Count

REQUIRED Review Regions: `30`.

## 27. Audio Package

Audio extraction produced `45/45` playable, `0` failed clips as 16 kHz mono 16-bit PCM WAV with two seconds of pre/post context. FFmpeg identity: `ffmpeg version 8.1.2`; ASR inference count `0`, network used `false`. Audio manifest hash: `78c5f1bb3e80038f5a12f6132dcd40326ba52df13d85684e9726d15363fd57f1`.

## 28. Audio Seconds

Total extracted Review Audio: `939.3075000000001 s` (`939.3050377488332 s` planned context duration).

## 29. Required Audio Seconds

REQUIRED Review Audio: `704.9408125 s`.

## 30. Episode Duration

Source episode duration: `900.01 s`; source media SHA-256: `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`.

## 31. Audio/Episode Ratio

All-region audio/episode ratio is `1.0436634037399586` because context-bearing regions can overlap. REQUIRED audio is approximately `0.78326` of episode duration. These are audio budgets, not measured human time.

## 32. Candidate Bundle Coverage

Candidate bundles exist for `153/153` items, `109` are non-empty, `749` display candidates remain after collapsing `195` normalized duplicates, and missing candidate references are `0`. The frozen builder reports `95` candidate-actionable items; the post-hoc evaluator counts `101` Review Items under its broader any-non-CURRENT-provenance candidate definition. Both are item counts with different eligibility definitions, not error-component counts, and are not silently merged.

## 33. Current Candidate

CURRENT appears in `109` bundles (`109` displayed CURRENT labels).

## 34. Whisper Candidate

WHISPER appears in `101` bundles (`171` displayed WHISPER labels after provenance-preserving consolidation).

## 35. Whisper Alternate

WHISPER_ALT appears in `88` bundles (`284` displayed WHISPER_ALT labels).

## 36. Reazon Candidate

REAZON appears in `101` bundles (`300` displayed REAZON labels).

## 37. Independent Acoustic Evidence

Independent semantic-hash intersection covers `86` unique Review Items. Of these, `85` carry an explicit independent-acoustic reason: `82` have disagreement and `7` have low-margin evidence, with overlap between those sets; the remaining item is non-scorable and retained as `MACHINE_EVIDENCE_INCOMPLETE`. This is evidence for review, not provider-selection authority.

## 38. Candidate Dedup

Normalized text duplicates are collapsed for display while all provenance records, evidence IDs, labels, and source intervals are retained. `195` display duplicates were collapsed; candidate artifact hash: `5baeb636a474258f6fe2724a2302e52ed9b4163e5c79bc9c5b7774515c7ec5a7`.

## 39. Evidence Badges

Observed displayed badge counts are `LEXICALLY_UNSTABLE=386`, `ACOUSTIC_FAVORED=118`, `CONTEXT_EXTENSION_ONLY=108`, `STABLE=37`, `HALLUCINATION_RISK=12`, and `NEAR_TIE=7`. No calibrated confidence percentage is displayed.

## 40. Review Workspace

The local workspace is at `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-review-workspace-20260829`. It binds machine draft hash `b1026b81be622475398f961658975da3c014d1157fc41c9966095f2db1d8386e`, policy hash `33066e8e856198c04a153fbaf8d617543467adb03c0854b68e47b9b07b320c8e`, and review-package hash `3c2476f2990db72fa40df15b5b1cd684bd7e521d40f4e20fdc550a638ef8cf0a`.

## 41. Offline Operation

Workspace offline/local-only validation passed. The server is designed for `127.0.0.1`; no CDN, analytics, cloud API, network ASR, or external runtime dependency is used.

## 42. Filters

The UI implements priority filters for ALL/CRITICAL/HIGH/MEDIUM/LOW and type filters for ALL/Text/Timing/Missing/Hallucination/Overlap/Localization/Unresolved.

## 43. Audio Controls

Each item exposes the local region audio, replay-region, jump-to-core, and `0.75x/1x/1.25x` speed controls. Every referenced clip passed playability validation.

## 44. Keyboard Shortcuts

Validated shortcuts are Space play/pause, `J/K` next/previous, `1` keep current, `2` use Reazon, `3` use Whisper alternate, `E` focus manual text, `T` focus timing, and `U` unresolved.

## 45. Manual Text Edit

`MANUAL_EDIT` is a first-class explicit human decision. It stores reviewed text only after user action and is covered by unit/E2E plus the synthetic workflow.

## 46. Timing Edit

`TIMING_EDIT` validates finite ordered source-global start/end values and applies only an explicit human decision. It does not alter the frozen Carnation machine final in this run.

## 47. Missing Cue

`ADD_NEW_CUE` is available only for an item without a final cue and requires text plus valid timestamps. `MARK_FALSE_POSITIVE` and `UNRESOLVED` remain explicit alternatives.

## 48. Session Persistence

Session state is local and binds policy version, review package semantic hash, machine draft hash, source identity, and item state. Carnation has no created session; persistence was tested with isolated fixtures. A durable pending-transaction record closes correction-log, audit-log, and session-rename crash windows; restart recovery is deterministic, and replaying the same decision or undo identifier is idempotent. A workspace-level exclusive SQLite transaction (`session/workspace-mutation.sqlite`, using Node 24's built-in `node:sqlite`) covers the complete read/recover/write cycle across server processes, preventing two local servers from silently losing an accepted decision. This database stores no review data; its OS-managed lock releases when the owner exits, including SIGKILL, without stale-PID deletion races.

## 49. Autosave

Every accepted explicit decision is committed through the recoverable local transaction, then reflected in correction, audit, and session state; the UI reports the saved action. Tests cover interruption before any log commit, after correction append, after audit append, during undo recovery, recovery-time media-boundary validation, and orphan-blocked undo. The cross-process regression starts two real CLI server processes against one workspace; both requests return `200`, and the durable result contains `2` corrections, `2` audits, and `2` item states with no lost update. A separate process acquires the SQLite mutation lock and is killed; a subsequent decision and session read both succeed. This is validated fixture behavior, not a claim that any Carnation decision occurred.

## 50. Resume

On load, the workspace fetches local review data and current local session; if present it resumes saved item states, otherwise it reports that the first explicit decision will create the session.

## 51. Base Mismatch

Production serve, validate, apply, correction export, and stats paths require a Review Package Freeze and recompute the complete `review-data.json` semantic hash against `Freeze.workspaceDataHash`; changing review data while leaving embedded hashes unchanged is rejected. The public package entrypoint does not expose the lower-level unfrozen server. The HTTP review-data response serves the same validated in-memory snapshot used by the decision API, so later disk edits cannot silently change the UI's evidence. Stale base/package identity, invalid action, unsafe audio paths, non-loopback binding, and post-freeze workspace tampering are rejected in tests. Final validation also renders a temporary workspace from the same frozen data and verifies that the delivered HTML/CSS/JavaScript exactly match the current runtime templates.

The 2026-08-30 browser check exposed a stale UI script and score-ordering/initial-selection defects. Only `assets/review.js` was refreshed in the real workspace, from SHA-256 `ccef4bf79538080e46b681d2928cc16e855938528ddf6f179ad465c2c38003bc` to `86b5e8e535504caca9cafb9678651855598559353a25fd754918e7c6fc044cf7`. HTML and CSS bytes did not change. Frozen review-data file SHA-256 remains `dd57f1d3aeee9c8bd40e363b6e24862d99eaa2c7a815ee528baea7914917af6a`, and Freeze file SHA-256 remains `e721efee2f3a417155ef0076b5c7de07c5fb9a74ae33b45ca8c9712071141220`. No score, item, region, candidate, audio, policy, or subtitle evidence was changed or re-frozen after Gold evaluation.

## 52. Human Decision Taxonomy

The nine decisions are `KEEP_CURRENT`, `USE_REAZON`, `USE_WHISPER_ALTERNATE`, `MANUAL_EDIT`, `TIMING_EDIT`, `ADD_NEW_CUE`, `MARK_FALSE_POSITIVE`, `UNRESOLVED`, and `WAIVE_REVIEW`. Selection authority is `HUMAN_ONLY`; unresolved does not complete REQUIRED, and waiver requires a note.

## 53. Correction Log

The correction log is append-only JSONL with exact decision, item, candidate-set/base hashes, before/after values, and reviewer note.

## 54. Audit Trail

The audit trail is append-only and includes decisions and undo events; undo restores active state without deleting history. Recovery completes or rejects interrupted transactions without duplicating decisions or undoing twice. Synthetic audit record count: `9`.

## 55. Correction Dataset Export

The synthetic correction dataset joins frozen review data, session, correction log, and audit log and exports only `ACTIVE` records. It has `9` source/active/exported records, `0` undone, `0` superseded, `0` orphan, `1` session, `9` unique items, and one record for each action. Summary semantic hash is `a410435cb01143714ee9b035e1115f9bfe1c2f7b1fecd6e984f5514a3b0a9e3d`, summary file SHA-256 is `228fb932556c7959df2da9ab69a1137d3e5b238a63010fd52d2413e09d1cea12`, dataset JSONL SHA-256 is `1a1ccca670ffc989fbff9a5e9c7e20a78d6fb436b202161d34426dd6c46629ce`, lifecycle semantic hash is `d5274c1661cc972ea7309fbeed848c1f5b2a7bbd2acfa09abba1cc2d1a15883a`, and lifecycle file SHA-256 is `e0bf4d17c8a0e821bf7dd86abce2e3b48f60dee5d7670f96695cd645c817bb40`. The artifact is `LOCAL_ONLY`, not shareable, contains full dialogue text, and records `trainingPerformed=false`; tests prove undone and crash-orphan records are classified auditably and excluded from exported training rows.

## 56. Apply Pipeline

`review:apply` consumes only explicit active human decisions after joining session/correction/audit state and verifying the base package plus frozen workspace identity. The CLI independently recomputes REQUIRED-item counts, per-region completion, and `reviewComplete`; an empty or forged complete summary cannot authorize apply. Stats and correction export may inspect a genuinely incomplete session, but apply requires every REQUIRED item to be resolved or explicitly waived. Every correction, including inactive history, is checked against frozen `suggestedActions`, target-cue cardinality, and waiver-note requirements. `KEEP_CURRENT` requires an existing cue; missing-only actions cannot target an existing cue; candidate/text/timing replacements require exactly one cue. It applies text/timing/add-cue operations and validates the strict reviewed package. Gold evaluation is a separate command and cannot feed apply.

## 57. Strict Reviewed Package

The independent synthetic apply generated and validated a strict SubtitlePackage plus ASS/SRT/VTT. No human-reviewed Carnation production package was created.

## 58. Skill2 Compatibility

The strict reviewed package preserves the SubtitlePackage contract used by downstream Skill 2. No Skill 2 or Skill 3 code was changed.

## 59. Synthetic Workflow Fixture

The fixture is explicitly non-Carnation and contains no Carnation Gold. It exercised the real frozen server, session endpoints, CLI apply, and CLI correction export. Validation passed with semantic hash `756cc1637b2eb5d3cbefefe97b221a033bddfff362553cc03f768d5b303aafa9` and file SHA-256 `f9d301e56f86cdd31cbabbdc5f65578d0fbc40e1b66dbd76bd047d0c8d23991b`.

## 60. Synthetic Decisions

The fixture executed exactly one of every decision type: keep, Reazon, Whisper alternate, manual text, timing, add cue, false positive, unresolved, and waiver. Rejected decision count: `0`.

## 61. Synthetic Apply

Synthetic apply, append-only audit/correction logs, strict package validation, and ASS/SRT/VTT serialization all passed. The validator independently recomputed manifest session identity, unresolved count, text/timing/new-cue mutation counts, decision counts, input/output file hashes, and manifest semantic hash. Applied package/ASS/SRT/VTT SHA-256 values are `61802098629fc453eb5d5aff85ee3524874395f52863412aac861e06ee2b0e7f`, `67bd8ad867fa4c98446b475f0d73ac07284fd765f84a61917fb00413cbe3a2a5`, `1cb3e97daaab6e8a1e4bd9c064a80291c8eaa52126a323bc30dcce61c122f2a7`, and `99dda8433c4cbf14c365051a254db7a822dd2237238f52251e2b9f578c364539`. This is engineering verification only.

## 62. No Fake Carnation Human Session

`realCarnationHumanSessionCreated=false`; shareable decision counts are all zero. Gold was not converted into clicks, decisions, logs, or reviewed production output.

## 63. Review Package Freeze

Freeze semantic hash: `873a5eaacbd25fa503850ba657fc3f0d18a694608f5e97c9fbd7a971d9273af8`; file SHA-256: `e721efee2f3a417155ef0076b5c7de07c5fb9a74ae33b45ca8c9712071141220`; aggregate hash: `dd9809eaaec0d08cfb6fcf978f4e4263bed6031c86ff55e5a5464a74d0dd3ef7`. Component content hashes are policy `33066e8e856198c04a153fbaf8d617543467adb03c0854b68e47b9b07b320c8e`, items `75de2fc1fcadeb6c4f5b5ce47d0429d449cbb138b4a717b11d6f328dfe041b44`, priority `c1f0c5cf542a52851ccfc5b6a3608eab81b64b8315c7c39b541e7ce0ac288190`, regions `b71ee923d78586666e874333fcc3ceb3ba9474a90ab6ff8b1a5b9af340b5c7d3`, candidates `fa88122cce6947f6a991fd29555bb5d27fb20ae36554502623115aee5f4a3cdc`, audio `7920e50c5749ba4aaab167b0efab00eb32c25d6cce21a43881215878d693f4e7`, and workspace `57aca03a5852d0b8ebbd6a2a3c201c18d90a82031a8db84052accc251797ee24`. Production entrypoints consume this workspace hash and recompute the entire review-data object instead of trusting self-reported fields.

## 64. Gold Barrier

The freeze was recomputed and verified before Gold: runtime/build/workspace/synthetic Gold input counts are `0`; evaluator Gold input count is `1` after freeze. The complete-lineage quality artifact has semantic hash `01c1a49dfbc26445e6d679238cfc16145d71e96c1442bfe39e2d0a4c21c4652f` and file SHA-256 `1817cb1347cf263d84e02085c58306234d3c46252bfee92f9cf2700be717ec8e`. Gold cannot tune this policy version, order runtime candidates, create decisions, or modify the workspace.

## 65. Material Recall@10

`17/77 = 0.22077922077922077`.

## 66. @20

Material Recall@20: `19/77 = 0.24675324675324675`.

## 67. @30

Material Recall@30: `26/77 = 0.33766233766233766`.

## 68. @40

Material Recall@40: `28/77 = 0.36363636363636365`.

## 69. @50

Material Recall@50: `40/77 = 0.5194805194805194`.

## 70. Timing Recall@10

Severe Timing Recall@10: `14/53 = 0.2641509433962264`.

## 71. @20

Severe Timing Recall@20: `17/53 = 0.32075471698113206`.

## 72. @30

Severe Timing Recall@30: `21/53 = 0.39622641509433965`.

## 73. @40

Severe Timing Recall@40: `24/53 = 0.4528301886792453`.

## 74. @50

Severe Timing Recall@50: `31/53 = 0.5849056603773585`.

## 75. Hallucination Recall

The single hallucination error is captured at R3 rank `1`; recall is `1.0` at Top 10/20/30/40/50 and ALL_REQUIRED.

## 76. Missing Dialogue Recall

R3 captures `5/6` missing-dialogue components overall; one is absent from the queue. Recall at Top 10/20/30/40/50 is `0 / 0.3333333333333333 / 0.6666666666666666 / 0.8333333333333334 / 0.8333333333333334`.

## 77. Review Precision@10

`0.375` (`16` selected items).

## 78. @20

Review Precision@20: `0.3870967741935484` (`31` items).

## 79. @30

Review Precision@30: `0.45652173913043476` (`46` items).

## 80. @40

Review Precision@40: `0.41935483870967744` (`62` items).

## 81. @50

Review Precision@50: `0.4935064935064935` (`77` items).

## 82. Residual Error@10

Unreviewed residual error rate: `0.7664233576642335`.

## 83. @20

Residual Error@20: `0.7153284671532847`.

## 84. @30

Residual Error@30: `0.6204379562043796`.

## 85. @40

Residual Error@40: `0.5766423357664233`.

## 86. @50

Residual Error@50: `0.43795620437956206`.

## 87. Region-level Recall

Region-error recall at Top 10/20/30/40/50 is `0.3284671532846715 / 0.4306569343065693 / 0.6496350364963503 / 0.7372262773722628 / 0.8613138686131386`.

## 88. Review Audio Budget@10

`269.417375 s`, `16` items, `9` regions.

## 89. @20

Review Audio Budget@20: `364.67756249999996 s`, `31` items, `13` regions.

## 90. @30

Review Audio Budget@30: `614.5963749999999 s`, `46` items, `23` regions.

## 91. @40

Review Audio Budget@40: `714.9411249999999 s`, `62` items, `31` regions.

## 92. @50

Review Audio Budget@50: `858.4279374999999 s`, `77` items, `38` regions.

## 93. Candidate Fixability

Of `77` material-error components, `6` are fully candidate-fixable, `49` have partial candidate assistance, `13` require manual editing, and `9` are `UNEVALUABLE` because complete final-cue lineage found no Review Item for those components. This is post-freeze evaluation, not runtime provider authority; the unevaluable components are not reassigned by time overlap.

## 94. Whisper-alt Fixable

WHISPER_ALT fully fixes `2` material errors.

## 95. Reazon Fixable

REAZON alone fully fixes `2` material errors.

## 96. Both Fixable

Both candidate families fully fix `2` material errors.

## 97. Partial Fix

Candidate partial-fix count: `49`.

## 98. Manual Edit Required

`MANUAL_EDIT_REQUIRED=13` material-error components; `UNEVALUABLE=9` remains a separate fail-closed class.

## 99. Candidate Fix Rate

`6/77 = 0.07792207792207792`.

## 100. Manual Edit Rate

`13/77 = 0.16883116883116883`.

## 101. Ranking Baseline Comparison

Four frozen, Gold-free input orderings were evaluated post-freeze: R0 chronological, R1 old single-ASR risk, R2 disagreement-only, and R3 full evidence. With complete final-cue lineage, item-budget utility scores are R0 `0.3182481751824818`, R1 `0.5357664233576642`, R2 `0.39124087591240875`, and R3 `0.37664233576642336`.

The frozen evaluator also compares each ordering under the same audio-seconds cap, using R3's item-budget audio as that cap and counting all review items in selected regions. Actual audio consumed may be slightly below the cap because complete regions are indivisible. Audio-matched residual-error rates (lower is better) are:

| Cap derived from R3 item budget | Audio cap (s) |       R0 |       R1 |       R2 |       R3 |
| ------------------------------- | ------------: | -------: | -------: | -------: | -------: |
| Top 10%                         |    269.417375 | 0.751825 | 0.766423 | 0.693431 | 0.671533 |
| Top 20%                         |   364.6775625 | 0.642336 | 0.635036 | 0.598540 | 0.569343 |
| Top 30%                         |    614.596375 | 0.408759 | 0.394161 | 0.386861 | 0.350365 |
| Top 40%                         |    714.941125 | 0.284672 | 0.277372 | 0.313869 | 0.262774 |
| Top 50%                         |   858.4279375 | 0.204380 | 0.153285 | 0.167883 | 0.138686 |

For the Top-20-derived cap, R0/R1/R2/R3 actually consume `363.318875 / 360.4955 / 363.1244375 / 364.6775625` seconds and select `44 / 52 / 58 / 56` items. R3 covers `31` material and `25` severe-timing components there. R3 therefore leads this audio-matched simulation, unlike the fixed-item-budget comparison below. Audio-only budgeting does not measure listening replays, candidate inspection, editing time, or human accuracy; it does not reverse the frozen `ranking-weak` route or prove real workload reduction.

## 102. Chronological

R0 Top-20% residual error is `0.781021897810219`, material recall `0.23376623376623376`, severe-timing recall `0.20754716981132076`, precision `0.3548387096774194`.

## 103. Single-ASR Risk

R1 fixed-item Top-20% residual error is `0.5401459854014599`, material recall `0.4675324675324675`, severe-timing recall `0.49056603773584906`, precision `0.6451612903225806`; it outperforms R3 under this item-count budget.

## 104. Disagreement-only

R2 fixed-item Top-20% residual error is `0.6861313868613139`, material recall `0.2987012987012987`, severe-timing recall `0.3584905660377358`, precision `0.5161290322580645`; it also outperforms R3 residual error under this item-count budget.

## 105. Full Evidence Ranking

R3 fixed-item Top-20% residual error is `0.7153284671532847`, material recall `0.24675324675324675`, severe-timing recall `0.32075471698113206`, precision `0.3870967741935484`. It beats chronological but not R1 or R2 under this item-count budget; section 101 separately reports the stronger audio-matched result.

## 106. Ranking Result

`REVIEW_PRIORITY_WEAK`; `rankingEffective=false`. The output is engineering-ready for an unseen trial but cannot claim that the ranking has materially reduced workload.

## 107. Ideal Reviewer Simulation

Simulation type is `IDEAL_REVIEWER_SIMULATION`, method `GLOBAL_TEXT_RECOMPUTATION_WITH_SELECTED_GOLD_ALIGNMENTS`, evaluation Gold count `1`, semantic hash `b5843ce51c7243a39c0272dff07128b65f86adc1171e050aa1f140c89023f51b`, and file SHA-256 `a8d8183a530b1545e3ee5a8ae4627db73f8b511cd4b5cc606b9ee96c5cf27499`. It binds quality hash `01c1a49dfbc26445e6d679238cfc16145d71e96c1442bfe39e2d0a4c21c4652f`, created no human session/log/output, and did not mutate the machine final.

## 108. Top10 Residual CER

Exact/normalized: `0.5236220472440944 / 0.47314453125`.

## 109. Top20 Residual CER

Exact/normalized: `0.49431321084864394 / 0.44482421875`.

## 110. Top30 Residual CER

Exact/normalized: `0.431758530183727 / 0.384765625`.

## 111. Top40 Residual CER

Exact/normalized: `0.4011373578302712 / 0.3544921875`.

## 112. Top50 Residual CER

Exact/normalized: `0.3328958880139983 / 0.2919921875`.

## 113. Top10 Residual Material

Residual material errors: `60`.

## 114. Top20

Top-20% residual material errors: `58`.

## 115. Top30

Top-30% residual material errors: `51`.

## 116. Top40

Top-40% residual material errors: `49`.

## 117. Top50

Top-50% residual material errors: `37`.

## 118. Human Review Time

No real human review timer or session ran, so no minutes, speed, corrections/minute, rereview rate, or workload reduction is reported. Audio duration and file timestamps are not human time.

## 119. Human Review Time Status = NOT_MEASURED

Artifact value: `NOT_MEASURED_IN_C6_0_1_12`.

## 120. Real Human Trial Protocol

Protocol: `/Users/paulasmith/Documents/Codex-Skills-multilingual-video-subtitler-c5-13r-3/REAL_HUMAN_TRIAL_PROTOCOL.md`. It requires source identity, Gold-free build, pre-review freeze, local-only workspace/audio, empty initial session/log state, explicit decisions, strict apply, measured local timer if time is reported, and fail-closed abort conditions.

## 121. Next Episode Trial Requirements

Use an unseen and previously unreviewed episode; freeze before exposure; keep Gold/reference out of build/workspace/session; verify all REQUIRED audio and hashes; measure actual elapsed time only with an explicit local timer; record actions/errors; optionally evaluate Gold only afterward. Authorization to run this trial is not authorization to claim workload reduction.

## 122. Machine Final Parity

Canonical text, canonical timing, ASS, SRT, VTT, strict package bytes, and complete Final A/B tree parity all passed. Final A hash `20aeddaa924fb544a71a8d17bd03abe67eece57118549d59cc1967f4dbc37cd9`; Final B hash `6e81d2753b2c4a9325bf757add54d8a2b41250fa9deb58b8e1a6802652cb1cb0`.

## 123. Machine Text Mutation

Text mutation count: `0`. Canonical text hash: `2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9`.

## 124. Machine Timing Mutation

Timing mutation count: `0`. Canonical timing hash: `e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936`; presentation hash: `a70f459da8f8513565da4a3b483646a709dafcf9ff9d96ef9065de9f6ebb5dd7`.

## 125. Production Status

`needs-review`; `finalizationMethod = none`.

## 126. Machine Release Authorized

`machineOnlyReleaseAuthorized = false`.

## 127. C6.0.2 Status

`HOLD`.

## 128. Product Route Decision

Route `HUMAN_ON_EXCEPTION`, next stage `REAL_HUMAN_TRIAL_ON_UNSEEN_EPISODE`, result `REVIEW_ASSISTANCE_ENGINEERING_READY_RANKING_WEAK`. Automatic provider switching remains `false`.

## 129. Ready for Real Human Trial?

Engineering is ready and `realHumanTrialAuthorized=true` for an unseen episode. The stronger result `REVIEW_ASSISTANCE_PRODUCT_READY_FOR_REAL_HUMAN_TRIAL` is not claimed because `rankingEffective=false`; `workloadReductionClaimAllowed=false`.

## 130. C6.1 Research Note

Future ranking work should use correction data from properly isolated unseen trials, compare R3 against strong R1/R2 baselines, improve missing-dialogue queue recall, and reduce duplicated/overlapping audio burden. Any changed policy requires a new version and a new unseen evaluation; it does not reopen C6.0.2 here.

## 131. Runtime Gold Input

Machine Review build `0`, workspace `0`, synthetic workflow `0`, evaluator `1` after freeze. Freeze Gold access before freeze: `0`.

## 132. Hardcoding

No Carnation-specific Gold text or Gold-derived labels are embedded in runtime builders, workspace, synthetic fixture, or shareable summary. Validation independently extracted normalized Gold cue text and checked synthetic current/candidate texts, correction before/after texts, and base/applied package cues for dialogue-content leakage; it separately scanned all synthetic text artifacts for the Gold identity hash. Policy rules are generic and frozen before evaluation.

## 133. Network

`networkUsed=false`; workspace/audio are local-only and offline. Audio extraction performed `0` ASR inferences.

## 134. Source Read-only

Source SHA-256 before/after evaluation is identical: `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`. Validation `sourceReadOnlyVerified=true`.

## 135. Gold Read-only

Gold identity SHA-256 before/after is identical: `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`; evaluator artifact SHA-256 is `3cedfab22687d976952f3505c0119cb10754468837d29a26eb760845b754a7d7`. Validation `goldReadOnlyVerified=true`.

## 136. Shareable

Shareable summary semantic hash `d5168279f33f92504f67013f288f11faa418fb4cd2cbfa9f9fe94afeae463d7b`; file SHA-256 `ab4935ea46108f73fa6f3b4ed570e9b15fb866db19251430cf0e7859d85c1c46`; audit: `1` file, `0` absolute paths, `0` secrets, `0` Gold leaks, `0` broken relative references. It excludes audio, workspace, correction dataset, full dialogue text, and full Gold text.

## 137. C5.19 Regression

PASSED in the targeted regression suite (`tests/c5-19-series-memory.test.ts` and its E2E flow).

## 138. C6 Investigation Regression

PASSED across C6 investigation/root-cause/risk/freshness tests and E2E investigation flow.

## 139. C6 Protected Regression

PASSED across protected finalization, protected schema, review disposition, human authority, and protected E2E tests.

## 140. C6.0.1 Regression

PASSED for blind acceptance and Gold-isolated evaluation flow.

## 141. C6.0.1.1 Regression

PASSED for machine-quality recovery unit and E2E tests.

## 142. C6.0.1.2 Regression

PASSED for candidate-timeline E2E and retained full-suite coverage.

## 143. C6.0.1.3 Regression

PASSED for candidate association/canonical assembly unit and E2E tests.

## 144. C6.0.1.4 Regression

PASSED for VAD timebase, variant re-ASR, and E2E tests.

## 145. C6.0.1.5 Regression

PASSED for lineage evidence, mutation timing, recovery coverage, and E2E tests.

## 146. C6.0.1.6 Regression

PASSED for boundary refinement, ceiling policy, edge decoder, risk priority, span-lineage repair, and E2E tests.

## 147. C6.0.1.7 Regression

PASSED for fresh re-ASR ceiling unit and E2E tests.

## 148. C6.0.1.8 Regression

PASSED for core stability unit and E2E tests.

## 149. C6.0.1.9 Regression

PASSED for independent provider, machine analysis, and E2E complementarity tests.

## 150. C6.0.1.10 Regression

PASSED for cross-model arbitration unit and E2E tests.

## 151. C6.0.1.11 Regression

PASSED for ablation route, calibration data, independent CTC, paired evidence, selective CV, and paired-discriminator E2E tests.

## 152. Unit

Full run: `110` test files passed; `823` tests passed and `2` skipped (`825` total). Targeted regression run: `61` files and `317` tests passed. Unit, E2E, and targeted runs use `--maxWorkers=4` to avoid artifact-I/O contention; no test assertion or release threshold was relaxed. Two existing artifact-heavy E2E tests have explicit 15-second timeouts. A final lint pass corrected an unused initializer, test non-null assertions, and promise mocks; all six regression groups then passed together.

## 153. E2E

Dedicated E2E run: `25` files passed; `44` tests passed and `1` skipped (`45` total). C6.0.1.12 includes `tests/e2e/c6-0-1-12-review-assistance-flow.test.ts`.

## 154. UI Tests

Workspace unit/E2E tests cover offline asset generation, generated JavaScript execution for score/time/ID sorting, initial queue selection, priority filtering, reviewer-note capture, audio paths/controls, frozen-server startup, decision endpoints, autosave/resume, stale-base and post-freeze-tamper rejection, decision/undo idempotency, recoverable transaction crash windows, killed-lock-owner recovery, cross-process serialization, lifecycle-safe dataset export, and local-only serving.

An actual browser smoke test used two isolated nine-item non-Gold synthetic workspaces and 1.5-second generated sine-wave WAVs, never the real Carnation workspace. All nine actions, queue/type/priority filtering, j/k navigation, audio replay/core jump, 0.75x/1.25x playback, candidate selection, manual text, timing, missing-cue insertion, autosave, reload/resume, undo, and waiver-note rejection passed. Audio reported `readyState=4`, `error=null`, and active playback. After the UI fix, the varied-score fixture displayed `96,95,89,80,79,71,50,10,9`; initial detail selected score `96`, and HIGH filtering displayed `89,80,79,71`. Ordinary edit notes survived reload and reverted correctly on undo. Browser warning/error logs were empty. Test tabs and servers were closed. This is synthetic UI verification, not real speech listening or a human-efficiency trial; no real Carnation UI decision was synthesized.

## 155. Schemas

`npm run generate:schemas` generated `316` JSON Schemas. Strict C6.0.1.12 schemas cover items, priority, regions, candidates, audio, session, decision, correction/audit records, freeze, quality, ideal, validation, route, shareable summary, correction dataset summary, and auditable correction lifecycle; schema validation passed. Final validation reports `32/32` checks (31 artifact checks plus the Shareable Audit) and `6/6` regression groups passed; validation semantic hash is `a3bdb24f0dc8b9e3972218f2cde946a85c5221d37b53007e497f65acfe58c442` and file SHA-256 is `d9162ffac9c649bfc0a36190ba80139d2b6454e576823055b53bdddf38e0afcd`.

## 156. Skill Validation

`quick_validate.py .agents/skills/multilingual-video-subtitler` passed: `Skill is valid!`.

## 157. Skill2/3

No Skill 2 or Skill 3 source was modified. This change set's skill update is limited to `.agents/skills/multilingual-video-subtitler/SKILL.md` (Skill 1).

## 158. Remaining Risks

Ranking is weak under fixed-item budgets: R3 beats chronological but loses R1 and R2 at Top 20%, despite its stronger audio-matched simulation; candidate full-fix rate is only `7.79%`; `9` material components are correctly unevaluable without final-cue lineage; one of six missing-dialogue errors is absent; 44 items lack a safe final-cue association; total context audio exceeds episode duration; overlap is not interval-evaluable from aggregate-only Gold; and no unseen human time or workload reduction has been measured.

## 159. Next Product Step

Run the frozen workflow on a new, unseen, previously unreviewed episode under `REAL_HUMAN_TRIAL_PROTOCOL.md`. Collect actual local decisions, errors, and explicitly timed review effort. Do not re-review Episode 1, do not tune this frozen policy with Episode 1 Gold, and do not claim workload reduction before real evidence.

## 160. Commits

The six-commit delivery from the requested base is:

1. `c544275` — review items, priority, and regions.
2. `f12c05f` — review candidates and local audio extraction.
3. `8935137` — offline workspace and persistent review workflow.
4. `ee4861a` — correction capture and reviewed subtitle application.
5. `9f158dc` — Gold-simulated ranking/fixability/ideal evaluation, freeze hardening, recoverable cross-process transactions, independent CLI validation, lifecycle-safe dataset export, verified UI fixes, and final regression validation. This amends the never-pushed `228940e` feature commit; no published history is rewritten.
6. `docs: record C6.0.1.12 review-assistance acceptance` — this report, `REAL_HUMAN_TRIAL_PROTOCOL.md`, and Skill 1 documentation. Resolve its immutable SHA from the final delivery response or this report's commit history.

## 161. Remote HEAD

Delivery verification compares `git rev-parse HEAD` with `git ls-remote --heads origin codex/c6-0-1-12-multi-asr-review-assistance` after the sixth commit is pushed, and requires an empty `git status --porcelain`. The final delivery response records the actual matching SHA and clean-worktree result. No predicted or self-referential SHA is embedded here.

## 162. Output Paths

All 15 required output directories are present under `/Users/paulasmith/Documents/Codex-Skills/output/`:

1. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-baseline-20260829`
2. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-review-items-20260829`
3. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-review-priority-20260829`
4. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-review-regions-20260829`
5. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-review-candidates-20260829`
6. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-review-audio-20260829`
7. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-review-workspace-20260829`
8. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-review-package-freeze-20260829`
9. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-review-quality-evaluation-20260829`
10. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-ideal-review-upper-bound-20260829`
11. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-synthetic-workflow-20260829`
12. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-correction-dataset-fixture-20260829`
13. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-final-a-20260829`
14. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-final-b-20260829`
15. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-12-validation-20260829`

Primary acceptance artifact hashes are:

| Artifact                   | Semantic SHA-256                                                   | File SHA-256                                                       |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Review Package Freeze      | `873a5eaacbd25fa503850ba657fc3f0d18a694608f5e97c9fbd7a971d9273af8` | `e721efee2f3a417155ef0076b5c7de07c5fb9a74ae33b45ca8c9712071141220` |
| Quality evaluation         | `01c1a49dfbc26445e6d679238cfc16145d71e96c1442bfe39e2d0a4c21c4652f` | `1817cb1347cf263d84e02085c58306234d3c46252bfee92f9cf2700be717ec8e` |
| Ideal review               | `b5843ce51c7243a39c0272dff07128b65f86adc1171e050aa1f140c89023f51b` | `a8d8183a530b1545e3ee5a8ae4627db73f8b511cd4b5cc606b9ee96c5cf27499` |
| Synthetic workflow         | `756cc1637b2eb5d3cbefefe97b221a033bddfff362553cc03f768d5b303aafa9` | `f9d301e56f86cdd31cbabbdc5f65578d0fbc40e1b66dbd76bd047d0c8d23991b` |
| Correction dataset summary | `a410435cb01143714ee9b035e1115f9bfe1c2f7b1fecd6e984f5514a3b0a9e3d` | `228fb932556c7959df2da9ab69a1137d3e5b238a63010fd52d2413e09d1cea12` |
| Route decision             | `842f1541468426591b7796e4384e0ed0b464d78da71a433737fb693dc0006c80` | `3f66c59d312d046a483bb775b195b1ee6fc8dfc6a4c3c46a58846e115ad2dfca` |
| Shareable summary          | `d5168279f33f92504f67013f288f11faa418fb4cd2cbfa9f9fe94afeae463d7b` | `ab4935ea46108f73fa6f3b4ed570e9b15fb866db19251430cf0e7859d85c1c46` |
| Final validation           | `a3bdb24f0dc8b9e3972218f2cde946a85c5221d37b53007e497f65acfe58c442` | `d9162ffac9c649bfc0a36190ba80139d2b6454e576823055b53bdddf38e0afcd` |
| Regression evidence        | `bc7f2e691284fdd25e51a791899210eb396bb646eed5f867de05f6adeeec8e5c` | `7590e535f36a5aafdacc66a5608142ca0bd25722e5fd17c66828e45d646eada3` |
| Output manifest            | Not applicable                                                     | `68a412252f31c9e7fae8d96ee3903e7854aed0c7a248c28b13e30a901414e4ad` |
