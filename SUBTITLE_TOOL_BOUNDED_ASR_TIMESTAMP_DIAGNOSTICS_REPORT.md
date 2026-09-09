# Timestamp Quantization Contract & Read-only Quality Diagnostics

## Outcome and scope

Implementation and offline evidence acceptance passed. **Full timed export remains
blocked; subtitle content quality remains needs-review.** The new strict partial
is a more conservative delivery, not recognition recovery or an improvement in
CER/usability. No new model, audio, reference, release or default-strategy work
was performed. No changes to Skill 1's preservation/release gates or Skill 2/3.

- Exact base: `d77f15339cd732020d2bc1b1a9a10d15692ed26b`.
- Historical inference source: `fcba52996989753b8b000e89e6a31d132523e584`.
- Tested implementation commit: `93782e0e56baec74a93df69c7df033c693586842`.
- Independent branch: `codex/subtitle-tool-bounded-asr-timestamp-diagnostics`.
- This report is a subsequent documentation-only commit. Final local/upstream/
  remote SHA verification is recorded externally in `git-sync.json`, avoiding a
  self-referential commit loop.

The former report writer was removed from the experiment's executable path.
`report --output-root` now reads frozen evidence and writes an immutable revision
in a disjoint tree. The historical writer survives only in a guarded synthetic
test helper. Product generate/resume/recover/validate-edited, shared formatting,
boundary deduplication, models and existing experiment files are unchanged.

## Recomputed evidence

| Measure                                   |      A |       B |
| ----------------------------------------- | -----: | ------: |
| All original raw records                  |    102 |     158 |
| Raw zero-duration records                 |     16 |       0 |
| Raw out-of-request records                |      0 |       3 |
| Mapped-stage invalid records              |      0 |       0 |
| New serialized-stage invalid records      |      0 |      17 |
| Serialized start-before / end-after       |  0 / 0 |  13 / 4 |
| Invalid-record union / unresolved         |     16 |      20 |
| Old partial records                       |     86 |     155 |
| New strict partial records                |     86 |     138 |
| Boundary aliases, old / new               |  0 / 0 |   0 / 0 |
| Boundary candidate pairs, old / new       |  0 / 0 | 23 / 11 |
| Later exact-full-text duplicate records   |     75 |      14 |
| Raw Unicode codepoints                    |  1,152 |   2,472 |
| Mutually exclusive full-record accounting | passed |  passed |
| Actual disk ASS/SRT/VTT validation        | passed |  passed |

The original ZIP SHA-256 is
`2f4c0485b9865f0cb05695d688dad3cd8c7dfd104132b77c8df1b9227ec523de`.
The frozen PCM geometry is 14,400,171 samples at 16,000 Hz, audioOffset 0,
duration/sourceEnd 900.0106875 seconds; its saved PCM SHA-256 is
`6bd772cda01d11929bdb153a412330d88c6c7761fe8dd1bd9f35e52da7a47644`.
The original plan hash is
`7d41fe15439ab133c78355ebe647cdd6c98638f023c48dcd39220dac482bf912`.

The three raw overruns remain raw failures: two 4 ms overruns and one 3.144 s
overrun. They are disjoint from the 17 formerly exported records now rejected at
serialization. Those 17 lie within the whole source range but outside their own
request, by 2–4 ms; the fractional 3.3125 ms case is retained exactly as a rational
delta rather than reduced to integer milliseconds. No raw count was relabeled
from 3 to 20. Every original record, text, ordering, timestamp and stable ID is
preserved; export-map traces every retained/alias/unresolved record to geometry.

The private `legacy-validation.json` records all 17 IDs, old ordinals, raw local
and mapped times, actual serialized digits and signed rational differences for
each format. It agrees with a separate pre-implementation integer oracle's ID
set. The requested user-provided independent review Markdown, audit JSON and
`audit_bounded_asr_ab.py` were **not supplied at the explicit attachment/repository/
current-output locations**. No substitute files were fabricated; matching the
external auditor's ID set remains unavailable, not passed.

## Contract and diagnostic interpretation

Raw SRT millisecond strings, integer request samples, mapped source times and
actual serialized times are separate fields. Request bounds use exact rational
sample comparisons. Saved JSON audioOffset is applied once; sourceEnd remains
the separately recorded source authority and is not expanded. Actual disk time
digits are checked against request/source bounds independently of the shared
formatter, in addition to text, order, identifiers, count and format parity.

The existing `Math.round(t * 100) / 100` remains unchanged. No epsilon, clamp,
inward rounding, minimum-duration replacement, candidate text recovery, new
upstream tolerance or semantic deduplication was introduced. Candidates with
new serialization violations are quarantined before export. Unexpected disk
failure preserves diagnostics/staging and does not publish half a triple.

The fixed `raw-text-risk-v1` policy is explicitly **post-hoc**, not a pre-registered
evaluation. It uses codepoints without normalization: same-character runs,
primitive 2–8-codepoint tandem repeats with non-overlapping accounting, text
length and sparse text over legal raw durations. Full continuous measurements
are available even below warning thresholds. Invalid/unknown time has a null
rate with a reason, not an assumed valid speed.

The longest repeated-character run is 438 codepoints in a raw-invalid record.
Its 438/2472 = approximately 17.72% share is descriptive text volume, **not a
hallucination rate**. Warnings do not delete, rewrite, retime, re-recognize or
exclude otherwise legal text, and do not assert speech absence. Legitimate
repetition, song, cries and hesitations can also trigger these heuristics.

## Snapshot and review protection

- Diagnostic identity:
  `928acbf59a1fbb56e198eb48e51c3bc642faef095ae7199f7a22ab030c50992f`.
- Explicit-partial identity:
  `071061a25c3ec6763ac4175146f19c9911d9c3a47d6b8ca3a36e2553be9fa88b`.
- Identity binds manifest/plan/old freeze/journal tail and bytes/raw collection,
  consumed evidence, executable validator code, timing/risk policy and export flag.
- Same-command replays verified and reused each revision. A relocated minimum
  evidence copy produced the same explicit-partial identity without WAV, source
  video, model or runtime files.
- Original 12 stratified intervals and 36 seams remain exactly 48 items, all
  NOT_PERFORMED, with stable IDs bound to the original full-raw cohort. New risks
  do not change this population or silently substitute the smaller partial.
- Machine freeze is one-time, covers the actual three formats plus all machine
  files, and excludes only itself and the mutable `review/` namespace. The
  frozen initial template and original manual CSV copy are distinct from current
  human results. Strict manifest/freeze schemas reject authority escalation.
- Mock manual notes, unknown status, extra columns and unfinished CSV bytes
  survived rerun unchanged. Corrupt same-identity machine content failed closed;
  concurrent writers, traversal, symlinks, cancellation and single-format failure
  did not overwrite prior results or publish incomplete subtitles.
- Pre/post checks confirmed all 396 protected old file/link entries, including
  failed VAD preparation, original outputs, manual CSV, freezes and ZIP,
  unchanged (hashes and, where captured, size/mtime/inode; symlink targets were
  compared without following model links). No old lock was created by report.

## Validation actually rerun

| Check                                                          | Current result                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Typecheck (`tsc -b`)                                           | passed                                                                            |
| Repository ESLint                                              | passed                                                                            |
| Repository Prettier check                                      | passed                                                                            |
| Full existing build                                            | passed                                                                            |
| Node offline regression                                        | 24/24 passed: 9 adapted historical-flow tests + 15 new diagnostics/revision tests |
| Related Vitest                                                 | 72/72 passed across bounded, product mock, recovery, offline recovery CLI suites  |
| Strict manifest/freeze and approval regression                 | included in the above suites; not counted again                                   |
| Real frozen evidence, diagnostic + partial + repeated commands | passed; CLI exit 2 as expected                                                    |
| Missing-output-root migration                                  | exit 1 before old write/lock, as designed                                         |
| Independent actual-SRT integer/sample oracle                   | passed for A 86 and B 138                                                         |
| Relocated evidence / forbidden process APIs                    | passed; attempted forbidden starts 0                                              |
| FFmpeg-based product E2E / full repository Vitest              | not run; no new media operations or unrelated research suite execution            |

Historical test totals were not carried forward. Test-only synthetic media and
mock process activity are not counted as real model/audio evidence. The real
offline path was also executed with all child-process launch APIs made to throw;
no launch was attempted. Only explicitly allowed local evidence/code reads were
used, with no implicit access to historical absolute model/media/reference paths.

Historical B requests remain 37, successful historical VAD passes remain 1,
and historical model loads remain UNKNOWN. Old time and checkpoint statistics
are copied as historical evidence, not reclassified as fresh execution. New
offline elapsed time is separate. Current ASR requests/inference, VAD dispatch/
inference, model loads, provider starts, audio extraction/windows/playback and
reference reads are **all 0**.

## Local delivery and stopping point

Private output parent: `subtitle-tool-timestamp-diagnostics-20260910-JNYQAG`.
The local handoff contains `acceptance.json`, `preaudit.json`, protection hashes,
CLI/test logs, minimum original evidence, both immutable revisions and a private
verification ZIP. Each revision has `OUTPUT_INDEX.md`, full raw text/records,
stage diagnostics, risks, export-map, review plan and freeze. Explicit-partial
subtitles are under `A/subtitles/` and `B/subtitles/`, named
`primary-minimal.partial.{ass,srt,vtt}`. No actual dialogue, private absolute path,
WAV, model or detailed real-run log is committed to public Git.

See [replay instructions](BOUNDED_TIMESTAMP_DIAGNOSTICS.md) for the implemented
commands. The local `REPLAY.md` supplies concrete paths, and `git-sync.json`
records the documentation commit and exact final remote synchronization.

`STRICT_PARTIAL_EXPORT_VALIDATED` and `FULL_TIMED_EXPORT_STILL_BLOCKED` coexist.
Content quality/CER remain NOT_MEASURED, acoustic correctness NOT_VERIFIED,
manual review NOT_PERFORMED, finalizationMethod none, humanValidated false,
machineOnlyReleaseAuthorized false and productDefaultChanged false. No release,
tag, default-branch merge, npm publication or next ASR experiment is authorized
or undertaken by this completion.
