# Representation-safe Timestamp Recovery & Missing-dialogue Localization

## Outcome

The bounded machine-only experiment is complete. All 17 independently identified
serialization-only exclusions were safely projected onto legal centisecond ticks.
The recovered B machine candidate contains 155 records, compared with the
unchanged strict candidate's 138. All three raw-invalid records remain unresolved.
This is not full timed delivery or acoustic/content acceptance.

No count was hard-coded into selection. Reference-guided, post-hoc localization
identified 9 P0 cues, 2 P1 cues and 6 diagnostic-only P2 cues. P0/P1 form 10 regions;
the future-only plan schedules 10 windows totaling 47.11 seconds, with no deferred
windows on this input. It does not execute or authorize local ASR.

## Git and evidence identity

- Base: `7e46ee000a7e111b28bf83f20460a8f9e9d70320`.
- Base branch: `codex/subtitle-tool-bounded-asr-historical-reference-review`.
- Prior implementation: `2b707c847b398935470fe779faac1305e071f87e`.
- New branch: `codex/subtitle-tool-bounded-asr-representation-recovery-localization`.
- Implementation: `d034e91233197648c456f9ed7a6a0930155e3eaa`.
- Accepted recovery identity: `77a1cc067d042276bd8c91b591484630e12e179871e49beacf538bad3e8a1b7b`.

Before creating the independent worktree, base local HEAD, clean status and exact
remote branch ref were verified. No existing worktree was switched, pulled,
stashed, reset or cleaned. Only generic code, neutral tests and redacted documents
are included in these commits. The documentation commit containing this report
is reported separately in the delivery response after remote equality is checked.
No tag, release, npm publication or default-branch merge is part of this task.

## Recomputed accounting

| Population                                  |                                A strict |           B old partial |                   B strict |                B representation-recovered |
| ------------------------------------------- | --------------------------------------: | ----------------------: | -------------------------: | ----------------------------------------: |
| All raw records                             |                                     102 |                     158 |                        158 |                                       158 |
| Raw-invalid records                         |                                      16 |                       3 |                          3 |                                         3 |
| Legacy serialization-only invalid           |                                       0 |                      17 |                         17 |                                        17 |
| Safe projection candidates identified       |                                       0 |                      17 |                         17 |                                        17 |
| Representation recovery applied             |                                       0 |                       0 |                          0 |                                        17 |
| Candidates not recovered                    |                                       0 |                      17 |                         17 |                                         0 |
| Retained timed records                      |                                      86 |                     155 |                        138 |                                       155 |
| Aliases                                     |                                       0 |                       0 |                          0 |                                         0 |
| Unresolved under applicable contract        |                                      16 |    3 legacy / 20 strict |                         20 |                                         3 |
| Text mutations this round                   |                                       0 |                       0 |                          0 |                                         0 |
| Raw / mapped timing mutations               |                                   0 / 0 |                   0 / 0 |                      0 / 0 |                                     0 / 0 |
| Records with new representation adjustments |                                       0 |                       0 |                          0 |                                        17 |
| Request/source-safe three-format status     | Inherited strict, diagnostics rederived | Not safe: 17 violations | Bytes preserved and reread | Written, reread and independently checked |

The 17 legacy violations are 13 starts before request and 4 ends after request.
They are not raw ASR errors. Two of the three raw-invalid records overrun their
request by 4 ms, and the third by 3.144 seconds. These are not eligible for
representation recovery. The long repeated-text raw record remains excluded;
the timing audit does not establish an acoustic hallucination verdict.

Maximum recovered-to-mapped edge difference is **8 ms**, strictly below 10 ms.
Maximum recovered-to-legacy-serialized difference is **10 ms** (one display tick).
These are different denominators: the safety bound applies to the legal mapped
time, not to the previously out-of-bounds rounded representation. Total retained
duration changes by **-0.17 seconds** relative to legacy serialization of those
same restored records. The other edge is unchanged whenever already legal.

All 158 records have a disjoint retained / alias / unresolved disposition.
The 138 strict records keep their text, ordering and display times, and the
original strict ASS/SRT/VTT bytes are checked against the new strict copies.
The recovered formats use identical centisecond values and preserve exact
original record text. There is no new content deduplication or neighbor timing.

## Reference diagnostics, not recognition accuracy

The same saved historical reference contains 192 Dialogue records: 182 Default
and 10 Music. The source ASS hash is
`a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`.
Its historical authority remains `user-confirmed-human-review`, historical
finalization remains `needs-review / none`, and its 33 historical review items
are not silently resolved. Completeness and acoustic correctness remain
`NOT_REVERIFIED`; it is not validated Gold.

All four previous full-raw comparisons, stream hashes and edit-path provenance
were recomputed and matched. These original-order full-raw streams still include
invalid-timing text and overlapping request context.

| Full raw against historical reference | Exact-visible distance (N=2287) | Whitespace-only distance (N=2153) |
| ------------------------------------- | ------------------------------: | --------------------------------: |
| A                                     |                            1858 |                              1736 |
| B                                     |                            1419 |                              1291 |

New `DELIVERABLE_TO_HISTORICAL_REFERENCE` comparisons are kept separate:

| Deliverable                | Exact-visible machine codepoints | Exact-visible distance | Whitespace-only machine codepoints | Whitespace-only distance |
| -------------------------- | -------------------------------: | ---------------------: | ---------------------------------: | -----------------------: |
| B strict                   |                             1755 |                   1159 |                               1697 |                     1028 |
| B representation-recovered |                             2009 |                   1049 |                               1948 |                      919 |

Both distances decrease on this input, but that was not a success condition.
These are string-edit diagnostics, **not CER**, acoustic correctness or proof of
reference completeness. The full-stream traceback is not a temporal alignment,
and repeated phrases can have ambiguous correspondence.

## Localized next-step plan

Coverage is computed for every reference record using the union of legal
recovered B intervals, without double-counting overlapping machine cues.
Reference match/substitution/deletion counts come from the unchanged exact-visible
full-raw R-to-B edit path, assigned by reference codepoint provenance.

| Diagnostic / plan item                 | Measured |
| -------------------------------------- | -------: |
| Reference cues analyzed                |      192 |
| P0 potential missing cues              |        9 |
| P1 potential missing cues              |        2 |
| P2 content-mismatch-only cues          |        6 |
| Merged P0/P1 regions                   |       10 |
| Scheduled future ASR windows           |       10 |
| Scheduled request seconds              |    47.11 |
| Deferred windows                       |        0 |
| Actual ASR requests in this experiment |        0 |

Only P0/P1 are eligible for automatic planning; P2 is not a missing-dialogue
window. All continuous coverage and edit-share values and reasons are retained.
Reference text is diagnostic display only, never a candidate text replacement or
ASR prompt. A is not used in P0/P1 selection. The plan is bounded by 12 windows,
180 summed seconds and 30 seconds per request, with physical source clipping and
one second of context on each side. Neutral tests cover reference-boundary splits,
saved-boundary fallback, unsplittable deferral and both budget ceilings.

These are **potential** missing-dialogue locations from a post-hoc rule, not
confirmed missing speech, validated precision/recall or guaranteed future gains.

## Verification executed this round

Final validation used Node `24.19.0` and npm `11.18.0`.

| Check                                                   | Current-run result                                             |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| `npm run typecheck`                                     | Passed                                                         |
| `npm run lint`                                          | Passed                                                         |
| `npm run format:check`                                  | Passed before this report; report separately formatted/checked |
| `npm run build:subtitle-tool`                           | Passed                                                         |
| Five Node test files                                    | 81 passed, 0 failed, 0 skipped                                 |
| Five scoped Vitest files                                | 79 passed, 0 failed, 0 skipped                                 |
| New neutral recovery tests included above               | 23 passed; not added again to the total                        |
| Strict manifest/freeze schema and semantic rederivation | Passed                                                         |
| Real build / verify / report / same-identity reuse      | All passed                                                     |
| Relocated bundle verification                           | Passed without original artifact path reads                    |
| Independent real-data BigInt/sample/clock oracle        | 17 candidate IDs matched; all recovered times passed           |
| Independently parsed on-disk times                      | All 155 records in all 3 formats passed                        |
| Protected before/after inventory                        | 2,098 entries unchanged                                        |

The 160 final regression tests were run this round, not inherited from the prior
report. Relevant existing coverage includes generate/resume, recovery,
validate-edited, diagnostics, content review, reference attach and CSV summarize.
Full unrelated research/Skill 2/Skill 3 unit suites were not run. The broader
frontend production build was not run; the standalone subtitle build was run.
No new human listening evaluation, human CSV completion or CER measurement was
performed or required.

During development, one neutral assertion initially expected a count-error label
instead of the parser's earlier no-dialogue rejection; the assertion was corrected
without weakening rejection. The first expanded Vitest run had 4 environment
failures because child CLIs resolved a non-npm-11 executable. After fixing only
the validation PATH, the final 79-test run passed. Failed attempts remain in the
private logs and are not added to the final unique passing-test count.

The production-like real path used process/HTTP/fetch-denial guards. Build,
verify, report, reuse and portable verify each recorded zero process/network
attempts. Existing WAVs were only read by the inherited reference verifier.
Synthetic E2E media plumbing uses generated test media and a stub provider; its
test-only process activity is separate from real-data operation counts.

## Preservation, private delivery and stop condition

Protected inputs include the old A/B experiment, original B 155 subtitle, strict
B 138 formats, timestamp revision, historical bundle/ASS, 53 listening WAVs,
existing review CSV, previous summaries and prior ZIPs. Old artifacts were not
rewritten. The recovery bundle has 26 frozen files plus the non-self-hashed freeze.
Input identity, maps, formats, comparisons, localization and the plan are frozen.
The portable evidence snapshot never grants authority to open historical model
or media paths. Private run receipts hold exact local delivery paths and hashes;
none of those private paths or subtitle bodies is published in this report.

Artifacts remain **PRIVATE / NOT FOR PUBLIC DISTRIBUTION**.

```text
REPRESENTATION_RECOVERY_READY
MISSING_DIALOGUE_LOCALIZATION_READY
LOCAL_ASR_PLAN_READY

newASRRequests = 0
newASRInference = 0
newVADDispatches = 0
newVADInference = 0
newModelLoads = 0
newProviderStarts = 0
newSourceMediaExtractions = 0
newASRAudioWindows = 0
newListeningClipGenerations = 0
subtitleTextMutations = 0
rawTimingMutations = 0
mappedTimingMutations = 0
externalReferenceSearches = 0

LOCAL_ASR_EXECUTED = false
FULL_TIMED_EXPORT_STILL_BLOCKED
qualityStatus = needs-review
humanValidated = false
CER = NOT_MEASURED
referenceIsValidatedGold = false
machineOnlyReleaseAuthorized = false
productDefaultChanged = false
finalizationMethod = none
```

No human-input wait blocks this completed machine-only experiment. Conversely,
completion does not authorize acoustic/content acceptance or the next ASR run.
Stop after this bounded recovery/localization delivery and branch push.
