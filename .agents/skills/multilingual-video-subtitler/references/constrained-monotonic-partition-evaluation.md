# C6.1.2.1.1 constrained monotonic partition evaluation

Use only for an explicit terminal C6.1.2.1.1 investigation. This is offline, known-development-benchmark research, not a default subtitle workflow or prospective production validation. Preserve the accepted C6.1.2.1 source, artifacts, original C6.1.2 machine/OOF freezes and all production subtitles. Do not run ASR, Reazon, Whisper, CTC, pyannote, MFA, VAD, model downloads, public subtitle search or an LLM judge. Skill 2/3 and SubtitleCue/SubtitlePackage v1 are unchanged.

## Frozen geometry and evidence barriers

1. Verify the accepted C6.1.2.1 A/B artifacts, exact E0/E1/E2 replay, old numeric OOF results and source identities. Snapshot all original inputs and this run's executable source/schema/test/skill bytes and metadata. Preserve candidate sets, features, correlation, completeness, atomic machine groups, folds, L0–L8 definitions, threshold grid and original model-training code.
2. Read only strict Gold `{id,start,end}` timing DTOs with the prefix-only ASS reader. Fingerprinting full file bytes is not dialogue-text decoding. No Gold text, characters, pronunciation, errors or labels enter partition construction.
3. Enumerate consecutive atomic-machine-group and Gold-cue ranges in each immutable E2 component. Keep already-bounded components intact. Solve the complete monotone interval DAG exactly, retaining full union intervals, residual node identities and deterministic terminal path hashes. This is not a greedy split or an additive overlap-sum approximation.
4. D1 primary: every cut edge has `min(machineIntersectionRatio,goldIntersectionRatio) <= 0.15`; component cut-union/original-edge-union <= 0.10; every node, including residual nodes, retains >= 0.80 of its original incident overlap union. Never cut an edge with both intersection ratios >= 0.50. Keep the original 0.50 mutual coverage, 8/8-cue, 24-second and 2-second-gap rules. Cross-fold parents remain unevaluable; never rebuild folds or split an atomic machine group/Gold cue.
5. The eight lexicographic objectives maximize evaluable retained union seconds, candidate-reachable machine groups, production cues and reachable Gold cues, then minimize cut union seconds, residual bilateral nodes, evaluated blocks and the deterministic full-path hash. Residual overlap is conserved but not credited as evaluable overlap. Every edge belongs to one block or the explicit cut ledger. Every node belongs to one evaluation/residual/isolated container.
6. D0 permits no cuts; D2 permits 0.25/0.20/0.65 limits only for diagnostics. Persist policy, inventory, candidate blocks, D0/D1/D2 maps, cuts, residuals, conservation, reachability and training contract before decoding any Gold text. The scoring stage rechecks the persisted freeze and live file identities.
7. Score candidate counterfactuals and jointly assembled profile shadows using the fixed D1 map. A cross-block candidate application is ineligible, never duplicated. Keep the original machine-group ID for training weights. Pass only machine data, the frozen map and numeric train labels to the separate original-algorithm OOF trainer. Outer test labels cannot affect fitting, imputation, thresholds or predictions.

## Coverage, bias and terminal gates

Keep all Gold cues, including Gold-only cues, in global quality. Intervention-reachable Gold has at least one strict E2 edge to a frozen machine group. Candidate-reachable machine scope has a frozen CURRENT plus a structurally legal existing alternative. Freeze these scopes before text scoring; no nearest-time binding or score-dependent denominators.

Evaluator Coverage Gate V2 requires >= 0.80 for all-machine groups, production cues, reachable Gold, candidate-reachable machine groups, candidate events and Top-K labels. Global Gold coverage and union duration coverage remain explicit diagnostics. The gate does not accept profile selections as inputs. Zero-selection profiles have null precision, harm and changed-scope ratios and cannot be safe winners.

Separately, a safe retrained profile needs >0 selections, >=5 evaluable changes, >=3 active folds, no negative or unknown-gain folds, >=0.80 changed-block and changed-machine coverage, precision >=0.85, harm <=0.10, positive joint normalized gain, nonpositive material delta, no catastrophic deletion, verified A/B parity and zero production mutation. A descriptive best profile does not satisfy these rules automatically.

E4 scores whole bilateral E2 components without the block bounds, solely as a bias diagnostic. Partial partitions have null partition/whole comparisons; do not treat residuals as zero. Report agreement over changed fully-evaluated component/profile pairs and unique disagreement component IDs separately. E4 scores never supply training labels, safe-profile metrics or route gains. The bias gate tests only zero unsafe/strong cuts, nonmonotonic allocation, duplicate Gold evaluation and profile-specific rematching.

Completeness is a main-blocker candidate only when non-gated profiles have positive potential joint gain, nonpositive material delta and catastrophic risk, together with insufficient known completeness or many safe false blocks. It is not proved by all-negative profiles or zero gated selections. Route authorization additionally requires adequate D1 evaluation coverage.

Terminal priority: engineering invalid; D1 coverage unrecoverable; safe prospective shadow; completeness calibration; otherwise stop automatic existing-candidate reranking. `EVALUATION_PARTITION_UNRECOVERABLE_WITHOUT_UNSAFE_CUTS` must not trigger a C6.1.2.1.2 evaluator-loosening iteration. Preserve Top-K retrieval, diagnostics and human review suggestions. Any C6.1.3 GO remains research shadow only. Production stays `needs-review`, `finalizationMethod: none`, with zero text/timing/cue/ASS/SRT/VTT mutation.

## Execution and verification

Use Node 24/npm 11. First run all QA with `npm run regressions:c6-1-2-1-1 -- --output <new-qa-directory> --skill-validator <quick_validate.py> --ctc-python <existing-local-python> --network off`. The Python CTC tests use synthetic tensors, not an encoder. QA runs schema generation, typecheck, lint, format, build, full unit/E2E, C6.1/C6.1.1/C6.1.2/C6.1.2.1/C6.1.2.1.1 targeted suites, historical checks and skill validation. Run schema generation before final A/B because it rewrites generated-file metadata. Do not change executable sources after their snapshot.

Run `npm run evaluate:c6-1-2-1-1-partitions --` (alias `replay:c6-1-2-1-1`) twice, into separate new directories. Required options:

- `--baseline`, `--baseline-peer`: accepted C6.1.2.1 A/B roots.
- `--baseline-validation`, `--baseline-repository`: accepted C6.1.2.1 receipts and source checkout.
- `--frozen-repository`: exact original C6.1.2 generation checkout.
- `--training-baseline-repository`: accepted unchanged C6.1.2 training source checkout.
- `--output`: new external run directory.
- `--primary-partition conservative-monotonic --network off --model-inference off --production-mutation off`.

Then `npm run validate:c6-1-2-1-1 --` with `--a`, `--b`, `--qa <regression-evidence.json>`, `--output <new-acceptance-directory>` and the same five baseline/source path options plus `--network off`. The validator independently reconstructs geometry, cuts, scopes, labels, 45 numeric OOF models, threshold choices, rankings, joint metrics and all research subtitle bytes. It reopens Gold only after verifying the persisted partition freeze. It checks the original test files unchanged, QA log identities, schemas, input metadata, source/Gold read-only status and A/B semantic/byte parity before writing the terminal route.

Full run roots contain local paths and local research subtitle text. They are local research backups, not public-shareable. Only validated `shareable/` aggregate/hash summaries are public-shareable. Do not turn engineering/package acceptance into production quality acceptance.
