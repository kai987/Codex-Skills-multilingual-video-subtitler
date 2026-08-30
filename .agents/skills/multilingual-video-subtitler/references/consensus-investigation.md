# C6.1 research-shadow consensus

Use this route only for an explicit token/span system-combination investigation. It does not change the normal subtitle or review workflow.

## Inputs and authority

Start from an existing frozen C6.0.1.12 machine task and its official baseline replay artifact. The adapter reads an explicit machine-file allowlist and verifies event lineage, source-global intervals, model/request identity, current final text spans, and independent CTC model/audio/candidate identity. A missing critical artifact fails closed. Existing machine-only pronunciation is alignment evidence; human memory, Gold, and inferred kanji readings are not candidate authority.

Keep the input ledger distinct from the included hypothesis set. Normalized copies are accounted for, not silently lost. R0 may count distinct real source-window votes, while provider-balanced and correlation-aware methods cap correlated support. CURRENT is a preservation control and never an extra independent ASR vote. Missing CTC evidence is UNKNOWN.

## Machine preparation

```bash
npm run investigate:c6-1-consensus -- \
  --task /path/to/c6-0-1-12-final-a \
  --baseline-file /path/to/c6-0-1-12-baseline-replay.json \
  --source /path/to/video.mkv \
  --output /path/to/existing-output-parent \
  --prefix experiment-c6-1 --date 20260830 \
  --mode full --network off
```

The command reserves collision-safe stage directories, runs the real algorithms twice (the second with permuted candidate input order), writes strict machine artifacts and research-only subtitle packages, compares bytes, and creates a shared freeze barrier. It does not accept a Gold parameter. Failed partial output is not an accepted freeze.

C6.1 uses a conservative lattice: a candidate chain may switch only at an all-candidate shared, non-epsilon, unambiguous anchor with identical real display surfaces. Every ambiguous span retains contiguous candidate support. This restricts the oracle's search space; do not describe its result as an unrestricted linguistic upper bound. The legal oracle is an exact edit-distance search over this fixed continuity automaton, whereas the machine lattice MBR may use a bounded, explicitly labelled approximate search.

Final-cue assembly is separate from decoding. It verifies the current exact event-to-cue substring, revalidates path/surface provenance, rejects conflicting replacement spans, and uses existing display layout. It never splits/merges cues, changes timing, inserts orphan events, deletes an empty cue, or overwrites production. Unsafe, unmappable, or over-capacity proposals preserve Current and remain visible in the assembly ledger.

## Evaluation and acceptance

```bash
npm run evaluate:c6-1-consensus -- \
  --machine-a /path/to/experiment-c6-1-final-a-20260830 \
  --machine-b /path/to/experiment-c6-1-final-b-20260830 \
  --source-proof /path/to/experiment-c6-1-baseline-20260830/c6-1-read-only-proof.json \
  --source /path/to/video.mkv --gold /path/to/reviewed.ass \
  --output /path/to/existing-output-parent \
  --prefix experiment-c6-1 --date 20260830
```

The evaluator must verify both complete machine freezes, strict schemas, source identity, all shadow files, and recomputed path safety before the first Gold access. Evaluate the same frozen outputs twice. Never feed oracle paths or labels back into decoding. Preserve source and Gold size, modification time, and SHA-256.

The existing global subtitle evaluator is reused without changing its matching rules. Distinguish fixed-timing identity from matching-induced changes in timing metrics. Event-local oracle mapping is text-independent and conservative; ambiguous/shared Gold associations are excluded and their denominator reported. Report rendered improvement and harm counts, not unmaterialized decoder proposals. A lower total CER does not erase local regressions.

Freeze the complete global evaluation configuration and event-local mapping rules with the decoder profiles, before Gold access. Alignment ablations must actually decode and render their own frozen lattice, identified by its hash; merely storing another alignment is not a quality comparison. The legal-path oracle uses only the designated main lattice, not a post-hoc union of ablation graphs. Whole-candidate pronunciation does not prove character-level kanji readings: without a trusted local projection, retain UNKNOWN at that unit rather than inventing an alignment.

Run `npm run validate:c6-1-consensus -- --machine-a <a> --machine-b <b> --evaluation-root <quality-directory> --task <original-c6-0-1-12-task> --source <video> --gold <reviewed.ass> --output <new-validation-directory> --run-regressions`, followed by Skill validation. The acceptance report must separate engineering validity, research signal, and release authority. No result from this known development benchmark authorizes machine release or C6.0.2.

Only sanitized aggregate metrics belong in `shareable/`. Original/derived audio, complete Gold text, research subtitle text, private absolute paths, credentials, and model caches remain local-only and outside Git.
