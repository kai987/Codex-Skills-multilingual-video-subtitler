# C6.1.1 fixed-alignment selective existing-candidate MBR

Use only for an explicitly requested offline calibration investigation. Reuse verified C6.1 machine artifacts and the original C6.0.1.12 machine task. No new ASR, CTC, pyannote, network inference, human terminology memory or LLM judge is needed or permitted by this route.

## Freeze before evaluation

Run `baseline:c6-1-1` against the two official C6.1 machine freezes, baseline source identity and official quality/oracle/validation artifacts. Then use `investigate:c6-1-1-selective-mbr -- --task <original-machine-task> --previous <c6-1-final-a> --baseline <c6-1-1-baseline.json> --network off --mode preflight` to check structural eligibility and grouped folds without Gold. Formal `--mode freeze --output <existing-parent> --stamp <run-stamp>` writes two independently built machine directories and verifies byte parity before freezing source code and artifact hashes. Existing output directories are not overwritten.

Machine proposals select one complete existing H2 candidate per event. CURRENT is the no-switch control, not another provider vote. H0 and H1 are diagnostic proposals; all structurally eligible alternatives are preserved for a later evaluation-only grouped oracle. Correlated provider/model/core observations are not independent votes. Unknown identities and unavailable acoustic risks remain explicit nulls with missing flags; do not manufacture evidence from a request ID or average log probability.

## Fixed evaluation and nested OOF

`evaluate:c6-1-1-selective-mbr` takes `--a`, `--b`, `--previous`, `--task <original-machine-task>`, `--source`, `--gold`, `--output`, `--stamp` and `--network off`. Its separate Gold reader first verifies both full machine freezes and source-code hashes. It then constructs one time-only P0-to-Gold cue-group map. All counterfactual labels and S0–S7 profiles reuse that map. Ambiguous, incompatible or cross-fold fixed groups stay unevaluable; do not rematch a profile to improve its score.

Keep acoustic neighbors and shared event/cue/span samples together in deterministic contiguous folds. Fit imputation, scaling, model weights and thresholds on training folds only; use nested training-only threshold selection. OOF test labels are evaluation authority only. S1 must reproduce the original actually applied P6 selections, not the new H2 proposals.

The renderer rechecks the complete cue and may refuse an otherwise valid individual span. Report requested selections separately from actually applied selections. Keep original cue IDs, ordering and times; shadow output never replaces production ASS/SRT/VTT. Counterfactual gains within a shared fixed group are correlated and cannot be added as realized gain: recompute the joint assembled shadow on unique groups. Full-episode legacy matching metrics remain diagnostic and may change timing metrics even though timestamps are identical.

## Acceptance and handoff

Run strict schema generation/validation, typecheck, lint, format check, build, unit, E2E, relevant historical regressions and Skill validation. `validate:c6-1-1-selective-mbr` independently checks recorded artifacts, OOF recomputation and byte parity. Missing regression evidence is not a completed engineering acceptance.

Zero selections are a safe null baseline, not successful selective calibration. Strong/promising gates require adequate fixed mapping coverage and a minimum number of evaluable, actually applied selections, alongside precision/harm and joint-gain constraints. Only a passing research gate permits a separate future-only full-data calibration; otherwise the model and threshold stay null. Never use that future model to replace the already measured OOF predictions.

Production remains `needs-review`, `finalizationMethod: none`, machine release unauthorized and C6.0.2 on HOLD regardless of this known-development-benchmark result. Existing C6.0.1.12 Review UI, sessions and correction application remain unchanged. Only sanitized aggregate summaries belong in `shareable/`; raw Gold, candidate/research subtitle text, private paths, audio and model caches remain local-only and outside Git.
