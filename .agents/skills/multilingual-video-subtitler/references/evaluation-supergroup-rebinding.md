# C6.1.2.1 frozen evaluator supergroup recovery

Use only when explicitly requested. This is a known-development-benchmark, offline, evaluator-only research route. It does not change the default subtitle workflow. The user-pinned C6.1.2 baseline, generated machine inputs, original OOF artifacts, original shadows and production files remain read-only. No Whisper, Reazon, CTC, speaker, MFA or VAD execution is authorized.

## Stages and isolation

1. Verify both original machine and reranking freezes, generation-source identity, production bytes, source-video identity and baseline acceptance. Freeze the unchanged profile definitions, threshold grid and same-code training contract.
2. Stream only ASCII ASS timing prefixes through the end timestamp. Dialogue bytes are discarded without decoding. A whole-file byte fingerprint is explicitly distinguished from reading Gold text. The graph builder accepts strict `{id,start,end}` Gold DTOs only.
3. Keep E0 as exact C6.1.2 numeric replay and E1 as the unchanged C6.1.1 historical time-connected policy. The predeclared primary E2 graph connects frozen machine groups to Gold cues using strict positive overlap of actual production cue intervals, not a group interval hull. Freeze the edge ledger, one shared map and policy before any Gold text scoring.
4. Reject cross-fold components from shadow scoring, labels, training and gates without rebuilding folds. Apply the unchanged C6.1.1 0.5 mutual-coverage, 8/8-cue, 24-second and 2-second-gap policy. Preserve unmapped machine groups and isolated Gold vertices. Shadow eligibility, candidate-label eligibility and OOF-training eligibility remain separate.
5. Decode Gold text only after verifying the persisted evaluator freeze. Score each supergroup once using fixed production cue order and deterministic Gold order. Candidate labels are single-whole-candidate counterfactuals; profile gain is jointly assembled shadow gain, never a sum of candidate diagnostics. Preserve `null` for unknown outcomes.
6. The numeric-only child process receives no Gold path or scoring callback. Reuse `runC612Oof`, the original features, candidate sets, folds, L0–L8 definitions and threshold grid unchanged. Retain the original machine-group ID for existing training weights; the evaluator supergroup ID is separate provenance. Write text-only shadows under `research-shadow/c6-1-2-1-retrained/` without changing cue IDs, times or counts.

## Commands

`npm run evaluate:c6-1-2-1-supergroups --` (alias `replay:c6-1-2-1-evaluation`) requires these explicit path flags:

- `--task-a`, `--task-b`: frozen C6.1.2 Final A/B directories.
- `--frozen-repository`: the exact generation-source checkout verified by the old freeze.
- `--baseline-repository`, `--baseline-validation`: pinned accepted C6.1.2 source and receipt.
- `--historical-run`: frozen C6.1.1 input containing its historical alignment map.
- `--production-a`, `--production-b`, `--source`, `--gold`: original read-only inputs.
- `--output`: a new, independent directory.
- `--primary-evaluator frozen-machine-group-gold-supergroup --network off --production-mutation off`.

Run twice into independent A/B directories. Run `npm run regressions:c6-1-2-1 -- --output <new-qa-directory> --skill-validator <quick_validate.py> --ctc-python <existing-local-python> --network off`. The Python CTC tests use synthetic tensors only; no real encoder opt-ins are enabled.

Then run `npm run validate:c6-1-2-1 -- --a <new-a> --b <new-b> --qa <regression-evidence.json> --output <new-acceptance-directory> --frozen-repository <generation-source> --baseline-repository <accepted-source> --network off`. This recomputes graph structure, models, thresholds, decisions, metric arithmetic and shadow bytes without reopening Gold text. It checks live source/Gold fingerprints, all original artifact snapshots, schemas, QA logs and Skill 2/3 isolation. Only this verified A/B step writes final route decisions and aggregate-only shareable summaries.

## Gates and interpretation

Report numerator/denominator for machine groups, production cues, Gold cues, union durations, labeled events, all ranked candidate labels, Top-K labels, and each profile's changed groups. A zero denominator is `null`; a zero-selection profile has `null` precision/harm and zero selection utility coverage. The unchanged primary profile is L6; zero changes cannot be used to pass its changed-group coverage requirement.

The predeclared safe-profile rule requires no catastrophic deletions, precision at least 0.85, harm at most 0.10, positive joint normalized gain, nonpositive material delta, at least three active folds, no negative folds, at least five evaluable changes and at least 0.80 changed coverage. Strong support additionally requires no unknown-gain folds and verified A/B/production parity. Ranking a profile descriptively by gain does not make it safe.

Route priority is engineering invalid, coverage insufficient, safe prospective shadow, completeness calibration, then stop automatic reranking. Even a prospective-shadow GO is not production application. Preserve `needs-review`, `finalizationMethod: none` and zero production text/timing/cue mutations.

Full outputs contain local paths and research subtitle text and are not public-shareable. Only `shareable/` aggregates and hashes are public-shareable after the privacy audit. Reports must distinguish engineering acceptance from coverage and reranker safety gates.
