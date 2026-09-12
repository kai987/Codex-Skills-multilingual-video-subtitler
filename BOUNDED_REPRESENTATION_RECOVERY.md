# Offline representation recovery and missing-dialogue localization

This experimental entry is separate from the product CLI. It changes no default,
does not execute recognition, and does not require completion of a listening CSV.
Use Node 24 and the lockfile's npm 11 dependencies, then `npm run build:subtitle-tool`.

```sh
npm run experiment:subtitle-tool:bounded-recovery -- build \
  --diagnostics "/path/to/timestamp-diagnostics-revision" \
  --reference-bundle "/path/to/historical-reference-bundle" \
  --output-root "/path/to/new-independent-output" \
  --export-recovered-subtitles

npm run experiment:subtitle-tool:bounded-recovery -- verify \
  --bundle "/path/to/new-independent-output/recovery-IDENTITY"

npm run experiment:subtitle-tool:bounded-recovery -- report \
  --bundle "/path/to/new-independent-output/recovery-IDENTITY"
```

Exit 0 means this bounded offline experiment is ready and integrity passed, not
subtitle quality approval. Invalid inputs, cancellation, integrity failures and
missing explicit export authorization exit 1. `report` verifies before returning
the recomputed summary on stdout; it does not modify the bundle.

## Representation contract

Raw request-local clocks, integer sample geometry, rational mapped source-global
times, legacy serialized times and recovered serialized times remain separate.
Only legal raw/mapped records whose serialization fails solely at request/source
boundaries can enter recovery. The offending start uses an exact rational
ceil-to-centisecond; the offending end uses floor-to-centisecond. Legal edges
keep the legacy nearest value. Each resulting edge must be strictly less than
one centisecond from its mapped time and the pair must have positive duration
inside both request and source. No epsilon, raw-overrun tolerance, adjacent-cue
timing, text rewrite, deduplication or minimum-duration invention is applied.
The legacy nearest-rounding rule itself is unchanged.

The projection objects are new presentation records, not modifications to the
stored raw/mapped records. ASS/SRT/VTT use the same centisecond values, and all
three files are reread for exact text, order, record-map and rational bounds.
The strict candidate is regenerated and checked against its original bytes.
Existing aliases remain aliases; there is no new content-based alias selection.

## Localization contract

`reference-guided-missing-localization-v1` uses the unchanged full-raw R-to-B
`exact-visible-v1` edit path, with reference codepoint provenance, and the union
of recovered B intervals. Every reference cue retains its continuous diagnostics.
P0 requires at least two non-whitespace characters, zero coverage and deletion
share at least 0.50. P1 requires at least four characters, coverage below 0.25 and
deletion share at least 0.60. P2 requires at least six characters, coverage at
least 0.25 and deletion share at least 0.75; it is content-mismatch diagnostic only.
Additional mismatch diagnostics use changed share at least 0.50 with coverage
at least 0.25. Unlocatable reference times have null temporal coverage.

Only P0/P1 enter transitive overlap/gap-at-most-0.5-second regions. Future requests
add one second of physical-source-bounded context. Requests longer than 30 seconds
split at the latest legal reference cue boundary, otherwise a saved cue boundary.
If no such boundary exists, the remainder is explicitly deferred, never equally
divided. Region ranking is descending P0 reference count, descending deletion
codepoints, ascending coverage, start and stable ID. At most 12 requests and 180
summed request seconds are scheduled; every other candidate remains deferred.
No reference text is included in the planned provider prompt (`prompt: null`).

The historical reference is NOT reverified for completeness or acoustic accuracy
and is NOT validated Gold. Edit paths are not time alignments, and repeated text
may have ambiguous alignment locations. Potential missing regions are post-hoc
diagnostics, not confirmed missing speech or calibrated precision/recall. Both
full-raw and deliverable/reference distances are diagnostics, never CER.

## Preservation and publication

Inputs are explicit, read-only, hash-bound and checked against the existing
diagnostic/reference verifiers. A minimal portable evidence snapshot supports
offline rederivation without opening any historical model/media paths.
Publication uses a lock, a private staging directory, reread verification and
atomic rename. Failed/aborted staging is removed; prior output is never replaced.
The freeze covers all machine files except itself, without cyclic self-hashes.
Reusing an identical input/code identity verifies the existing result first.

Outputs are **PRIVATE / NOT FOR PUBLIC DISTRIBUTION**: they contain raw text,
reference evidence and potentially private original metadata. Only generic code,
neutral tests, documentation and a redacted acceptance report belong in Git.

Always retain `qualityStatus=needs-review`, `humanValidated=false`,
`CER=NOT_MEASURED`, `referenceIsValidatedGold=false`, `finalizationMethod=none`,
`machineOnlyReleaseAuthorized=false`, `productDefaultChanged=false`,
`LOCAL_ASR_EXECUTED=false` and `FULL_TIMED_EXPORT=blocked`.
No full acoustic/content acceptance has been established. Planning never
authorizes the next local ASR experiment.
