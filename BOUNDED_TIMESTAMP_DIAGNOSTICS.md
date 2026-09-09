# Bounded ASR: offline timestamp diagnostics

This revises the bounded experiment report, not the product strategy or a release.
Build with the existing Node 24 / npm 11 lockfile (`npm ci --offline --ignore-scripts`,
`npm run build:subtitle-tool`). No models, media tools or network are required for report.

```sh
npm run experiment:subtitle-tool:bounded-asr-ab -- report \
  --manifest "/path/to/original-run/experiment.json" \
  --output-root "/path/to/new-diagnostics"

npm run experiment:subtitle-tool:bounded-asr-ab -- report \
  --manifest "/path/to/original-run/experiment.json" \
  --output-root "/path/to/new-diagnostics" --export-partial
```

The input must include the existing original `results-freeze.json`, its exact
machine-file allowlist, local raw responses bound to the hash-chained journal,
`vad.json`, original partial files when the old export map says they exist, and
the original manual CSV. Missing or modified evidence fails closed: no new
inference repairs it. Historical absolute model/media paths are never followed.
The manifest's saved sourceEnd is checked against its original PCM-duration
construction; strict comparisons retain its saved JSON precision separately
from rational request sample bounds. This validates stored evidence, not the
availability or identity of the old runtime/media environment.

`--output-root` is mandatory, even for the former report syntax. Omission fails
before creating a lock or writing the old run. Trees must be disjoint; symlinks
and traversal are rejected. Existing product generate/resume/recover/validate-edited
behavior and shared formatters are unchanged. This report is for an already
frozen prior experiment, not the first report of a new model experiment.

Raw milliseconds, integer request geometry, mapped source time, and actual
serialized times are separate evidence. Existing `Math.round(t * 100) / 100`
rounding and shared centisecond serialization remain. Half-open intervals allow
end equality. Rational comparisons use the actual timestamp digits, with no
epsilon, clamp, new source limit, inward rounding, timing recovery or text edits.
The ideal nearest-grid error bound (5 ms) grants no boundary exemption.

All raw records (including invalid times and aliases) and full raw text survive.
New raw/mapped/serialized issues select the partial subset; text warnings do not.
Diagnostics-only creates no timed files. Explicit partial exports are staged,
read back, validated for request/source geometry, order, text and three-format
parity, then published as one directory. Unexpected failures preserve staging
and a failure sidecar, never publish an incomplete triple or silently retry by
deleting more records. No-legal-records is not an empty subtitle success.

The versioned raw-text policy is post-hoc and descriptive: same-codepoint run

> =12; primitive 2–8-codepoint tandem unit repeated >=3 times covering >=12;
> text >=200 codepoints; legal local duration >=10 seconds with <=4 non-whitespace
> codepoints. Continuous measurements and ranges remain available below thresholds.
> Unicode codepoints include internal whitespace/newlines without normalization.
> Invalid local durations have null rates. Repetition is not proof of hallucination.

Each revision identity binds the manifest, plan, old freeze, journal bytes/tail,
raw collection, other consumed evidence, validator code, timing/risk policies and
export flag. Same identity verifies and reuses; any corrupt machine content is
a conflict, not repair permission. Different identities create different folders.
The original full-raw review cohort and intervals receive stable IDs; they are
not replaced by the smaller partial population. New risks remain separate.

`results-freeze.v2.json` covers all machine files except itself and `review/`.
`review/review-results.csv` is exclusively initialized once; any later bytes,
including extra columns, partial edits or invalid states, are preserved. Missing
human files are reported, not recreated on rerun. The frozen initial template
and original manual CSV copy are distinct from current user results. No CSV
status grants human validation or release authorization.

Exit 2 means diagnostics/partial delivered but full timed export is blocked;
exit 1 means a technical evidence/identity/write/conflict error; exit 0 means
the requested operation completed, not acoustic approval. All reports retain
needs-review, NOT_MEASURED/NOT_VERIFIED, finalizationMethod=none, and false
human/release/default-change flags. Historical costs and model-load UNKNOWN
remain distinct from the new offline operation counters.

Validation (synthetic/mock only; no real model/FFmpeg):

```sh
TMPDIR=/private/tmp node --test tests/bounded-longform-flow.mjs tests/bounded-timestamp-diagnostics.mjs
TMPDIR=/private/tmp npx --no-install vitest run tests/bounded-longform.test.ts tests/subtitle-tool.test.ts tests/subtitle-recovery.test.ts tests/e2e/subtitle-recovery.test.ts --maxWorkers=2
```

The legacy report writer exists only in a synthetic-fixture helper guarded by
the fixture directory name, to model pre-revision evidence. It is not exposed
by the experimental CLI. Real subtitle/raw diagnostics remain private local
artifacts, never public Git content or proof of subtitle-quality approval.
