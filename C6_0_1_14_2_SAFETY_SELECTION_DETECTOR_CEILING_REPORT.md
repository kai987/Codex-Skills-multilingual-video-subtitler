# C6.0.1.14.2 — Safety Selection and Detector Ceiling Acceptance

Date: 2026-09-01 (JST). Publication boundary: source, tests, schemas, documentation and aggregate-only acceptance. Raw outputs remain `LOCAL_ONLY`.

## 1. Executive conclusion and scope

**Engineering and evaluation-integrity acceptance passed. The full-queue coverage objective did not pass.**

The authoritative route is `HOLD_FOR_SAFETY_TARGET_SELECTION_REPAIR`, not `GO_C6_0_1_15_REGION_RANKER_RECALIBRATION`. Selection-only playback improved from 4/6 to 5/6 Missing components. The combined detector inventory covers 6/6, but final target selection loses the selection-only gain and final playable/audible coverage remains 4/6. Hallucination audible coverage remains 1/1.

The two final deficits have direct WebRTC support. Both belong to one eligible 46-member cluster with 11.896625 seconds of core speech, rejected as `BUDGET_OVERFLOW`. Final selection consumes 59.923458 seconds of its 60-second limit. Preservation protects the original 24 safety targets, but does not protect newly selected Phase A coverage when Phase B reconstructs selection. This is a selection/continuity problem, not evidence that all detectors still miss the speech. No post-Gold retuning, reselection, or inference was performed.

| Gate                                             | Result                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| Engineering checks                               | 64/64 passed                                                         |
| Strict schema artifact instances                 | 382/382 passed; 481 generated schemas                                |
| Evaluation integrity and Gold barrier            | Passed, including both evaluation attempts                           |
| New detector / source-ASR requests               | 8/8 and 12/12; no retries or backfill                                |
| Final A/B evidence and machine-byte parity       | Passed                                                               |
| Selected-target physical audio coverage          | 315/315; 81/81 WAVs playable                                         |
| Final Missing inventory coverage                 | 6/6                                                                  |
| Final Missing audible / full coverage            | 4/6 / 4/6 — coverage gate failed                                     |
| Final Hallucination audible coverage             | 1/1                                                                  |
| Safety and full-queue burden limits              | Passed: 23 targets, 59.923458 core seconds, 93.051333% episode queue |
| Canonical text / timing / presentation mutations | 0 / 0 / 0                                                            |
| Production state                                 | `needs-review`, `finalizationMethod: none`                           |
| Automatic release / C6.0.2 / human trial         | Not authorized / HOLD / not started                                  |

Branch: `codex/c6-0-1-14-2-safety-selection-detector-ceiling`.

Baseline commit: `57462c587d1cbffc02dc242e1f3e24c5b1d1616a`.

Implementation commit: `eead1b0f8a6955fb9e75607ffe3dd7cf8ba49102` (`feat: implement C6.0.1.14.2 detector ceiling and safety selection`). The permitted commit grouping was used: selection audit, clustering, views, detector runtime, inventory/ASR, delivery and evaluator code share this one atomic implementation commit. Final acceptance documentation is a separate commit.

Goals were to repair atomic slot starvation without inference, audit genuinely different audio views, introduce independent WebRTC speech presence, preserve detector posteriors, bound new ASR, and evaluate actual physical playback rather than item lineage. The initial two hypotheses were selection starvation and insufficient direct detector coverage. The new detector evidence addresses the inventory gap; the final selection problem remains.

Non-goals remain enforced: no canonical rewrite or timing repair, no whole-media ASR, no repeat of the previous 32 ASR probes, no ranker training, no OOF run, no human trial, no source-separation model, no C6.0.1.15 implementation, and no C6.0.2/C6.1 work. Skill 2 and Skill 3 were not modified.

## 2. Baseline, authorization and frozen policy

The C6.0.1.14.1 baseline was reconstructed from exact caches: 10/10 detector and 32/32 ASR hits, zero inference/model loads/provider starts. Existing metadata for 860 old files remained immutable. The machine subtitle package still contains 161 cues.

| Baseline measurement                    |                                 Value |
| --------------------------------------- | ------------------------------------: |
| Missing audible recall                  |                                   4/6 |
| Hallucination audible recall            |                                   1/1 |
| Speech observations / inventory islands |                         1,644 / 1,440 |
| Multi-detector islands                  |                                   317 |
| Evidence union                          |                    595.894625 seconds |
| Uncovered atomic candidates / eligible  |                              208 / 90 |
| Uncovered union                         |                     75.326104 seconds |
| Selected safety targets / union         |                24 / 28.022875 seconds |
| Slot / duration utilization             |                     100% / 46.704792% |
| Eligible overflow / audit-only          |                              66 / 118 |
| Eligible detector-exclusive overflow    | 6; all Pyannote-exclusive; selected 0 |
| Targets / items / regions / WAVs        |                   316 / 198 / 75 / 75 |
| Playback segments / REQUIRED items      |                              576 / 23 |
| Full-queue unique audio                 |                    824.353806 seconds |

Phase A consumes no new detector or ASR inference, model load, or provider start. Phase B is explicitly bounded to four WebRTC, two Silero and two Pyannote runs; ASR is four exact targets with two models plus two preselected context targets with two models. Each provider request is persisted and accounted for. No hidden retry, target backfill, device fallback or whole-source ASR is allowed.

Requested policy name: `c6.0.1.14.2-detector-exclusive-selection-masked-speech-ceiling-v1`.

Frozen execution name: `c6.0.1.14.2-safety-selection-detector-ceiling-v1`.

Policy hash: `d3c602c8962222124ba445712688cb997833167d062f9e81790065878ec0bdf7`.

The strict policy-binding artifact records this alias; no cache key, threshold or previously executed policy was renamed to conceal a difference. Cluster constraints are a maximum 0.3-second supported bridge, maximum 12-second envelope, and minimum 0.12-second core. Selection is at most 24 targets and 60 seconds of core union, four exclusive reserves, 60-second diversity bins, and at most three new target starts in any rolling 15-second window. The only density exception preserves structurally/silence-unmergeable old coverage and is explicitly logged.

The pre-detector plan hash is `a0376ba7be44b7f5924a9bc25d2f7d758d0c53c5af72eebdf38791b3aaeba217`; its freeze hash is `9b96412ae8f49a3089648e3d2977f04569244d878b9232487be26b061651d5ba`. Seven source files and thirteen other plan/policy/view/runtime bindings were checked unchanged after execution. Machine runtime Gold inputs remain zero. Evaluator access occurred only after final machine/code/projection freezes; Section 9 records the earliest access, including the unsuccessful first evaluation invocation.

## 3. Phase A: clustering and zero-inference selection repair

The baseline counted short adjacent atoms as independent slots. Nine adjacent selected fragments were redundant slot occupants; the largest candidate group had 21 members and the maximum historical rolling density was five starts. The static ordering did not recompute marginal novelty and let six eligible Pyannote-exclusive candidates overflow while none was selected. Saturating 24 slots therefore did not imply saturation of the 60-second union.

The cluster-first algorithm sorts source-native half-open intervals. It joins only compatible verified atoms with compatible contradiction/support state and a shared independent family. A positive gap requires complete independent speech support over the bridge. Cue/target masks and scene/speaker boundaries are hard barriers. Core union remains the union of actual atoms; an envelope never becomes positive speech evidence. A cluster retains member IDs, native/source spans, observation/request provenance, family/view support and old-target lineage.

| Cluster audit                                       |    Value |
| --------------------------------------------------- | -------: |
| Atomic candidates, including audit-only atoms       |      208 |
| Atomic eligible candidates                          |       90 |
| Coherent clusters / eligible clusters               |  90 / 53 |
| Multi-member clusters / atoms in those clusters     | 41 / 159 |
| Atoms represented across all clusters               |      208 |
| Successful adjacent joins (`208 - 90`)              |      118 |
| Adjacent non-join boundaries (`90 - 1`)             |       89 |
| Actual old target slots recovered                   |        9 |
| Envelope-as-speech / structural crossing violations |    0 / 0 |

The 89 non-joins are a **derived count of chronological join rejections**, not 89 runtime errors or rejected final targets. The frozen contract does not persist a separate per-reason merge-rejection histogram. This observability limitation is disclosed rather than inventing a zero value; boundary behavior is covered by synthetic tests.

Selection first preserves old coverage, then grants exclusive strata reserved opportunities, then recomputes marginal utility after every choice. Utility combines verified evidence, incremental core seconds, novel independent families, evidence strata, timeline bins and scenes; it penalizes redundant coverage, local density, slot cost and union cost. Source order is only a deterministic tie-breaker. Same-family multi-view evidence is useful but is not counted as an independent detector vote.

Exclusive evidence cannot be permanently excluded solely because its absolute score is below multi-detector evidence: those scores represent different evidence classes and failure modes. Four reserved opportunities remain subject to real speech/timebase, contradiction, duration, structural and global-budget guards. This is not automatic promotion to REQUIRED or permission to insert subtitle text.

| Phase A Selection V2                           |                    Value |
| ---------------------------------------------- | -----------------------: |
| Selected clusters / represented atomic members |                 24 / 104 |
| Core union                                     |        55.020688 seconds |
| Slot / duration utilization                    |        100% / 91.701146% |
| Covered timeline bins                          |                       13 |
| Exclusive reserve selections                   |                        4 |
| All selections containing an exclusive stratum | 7 (6 Pyannote, 1 legacy) |
| Eligible overflow / audit-only clusters        |                  29 / 37 |
| Density rejection / preservation-only override |                    0 / 1 |
| Old target coverage preserved                  |                    24/24 |
| Old ledger retained / merged-superseded        |                   3 / 21 |
| New targets enabled by recovered slots         |                        9 |
| Detector / ASR / model load / provider starts  |            0 / 0 / 0 / 0 |

The supersession ledger retains old provenance instead of silently deleting it. Mandatory levels and old R3 ordering remain unchanged. Phase A physically materialized its comparison targets, WAVs and playback before Gold. Its audible coverage result is 5/6, not merely an item-lineage claim. The extra audible coverage can include context around a selected core; core target coverage itself is still 4/6 at the 0.8 threshold.

Of the six originally eligible detector-exclusive overflow atoms, three are represented by two selected A3 targets and their materialized WAV/playback coverage. The other three were not selected. This count differs from the seven selected clusters containing any exclusive stratum and the four reserved selections; none of these counters means that all six old overflow atoms were recovered.

## 4. Audio view audit and real DSP differences

The previous five logical views represent four unique PCM streams; native mono and center are an effective duplicate on this source. Duplicate PCM cannot inflate independent evidence. Two new logical views produced two new effective PCM streams, zero duplicate/no-op views, zero transform failures and verified source-time mapping.

| View                         | Transformation                                               | Correlation to native | Spectral difference | Voice-band ratio |
| ---------------------------- | ------------------------------------------------------------ | --------------------: | ------------------: | ---------------: |
| `DIALOGUE_COMPRESSED_MID_V2` | 150–4,200 Hz, compression threshold 0.06, ratio 2, peak 0.85 |              0.924431 |            0.300311 |         0.981483 |
| `PREEMPHASIS_VOICE_BAND_V1`  | 100–4,800 Hz, symmetric preemphasis 0.9, peak 0.85           |              0.720204 |            1.205934 |         0.757592 |

Both streams have 14,400,171 frames at 16 kHz. The linear-phase 257-tap FIR's 128-sample delay is compensated, and preemphasis is zero-phase. Three synthetic controls report zero net delay and unchanged sample count. Native-source endpoint rounding is clipped in interval mapping, rather than shifting source time. PCM identity, sample count and spectral changes demonstrate more than amplitude-only differences. No neural enhancement or source separation ran.

View-audit semantic hash: `fa00576ee576dfb12a1623d0d79ceb132a0eccc702a8d8f265b0e8240283c627`.

## 5. Independent detector runtime, score tracks and budget

WebRTC VAD was successfully installed and identified as a separate `WEBRTC` speech-presence family. It is not ASR, lexical verification, speaker identity or a calibrated probability model. Its frozen settings are 16 kHz mono PCM16, 20 ms frames, aggressiveness 0, 160 ms merge gap, 100 ms minimum speech, 40 ms padding and 12-second maximum interval. WebRTC results remain binary decisions; neural scores remain probabilities.

| Detector           | Planned / actual runs | Fresh model loads |          Raw interval records | Frame tracks                  |
| ------------------ | --------------------: | ----------------: | ----------------------------: | ----------------------------- |
| WebRTC             |                 4 / 4 |                 0 |  1,183 (346 + 363 + 94 + 380) | 4 × 45,001 binary frames      |
| Silero new views   |                 2 / 2 |                 2 |               485 (278 + 207) | 2 × 28,126 probability frames |
| Pyannote new views |                 2 / 2 |                 2 |               425 (230 + 195) | 2 × 90,002 probability frames |
| Total              |                 8 / 8 |                 4 | 2,093 direct interval records | 8 score tracks                |

These interval counts are detector/view-specific records, not independent votes, unique new dialogues, or recovered Missing components. The detector family correlation guard collapses repeated views within a family. WebRTC bootstrap package acquisition used a separately authorized setup step; detector acceptance itself was offline. All detector execution used CPU, with no fallback retry.

| Runtime binding                       | Identity                                                           |
| ------------------------------------- | ------------------------------------------------------------------ |
| WebRTC package / interpreter          | `webrtcvad-wheels 2.0.14`, Python 3.13.14                          |
| WebRTC implementation hash            | `d5e3f72e92887f8937d8fa61db650756c59ea827bbb1dcae1beb7f52c87d0b90` |
| WebRTC runtime identity               | `638a5058a8712e80154a047af2440e0968c657916334a7e4b10dd5375c6fde08` |
| WebRTC runtime manifest semantic hash | `b9f5afd1378aba4c2e5f42da33a68f2d03110d51a38b392743231a1ebab91b59` |
| Detector worker hash                  | `ca15569606de881b18172e88bbb451ccd643d81bfb70dd9f8e2b0734a2ab6eb4` |
| Silero model snapshot hash            | `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` |
| Silero runtime identity               | `e12b026eabedfbac6a8faa67d5bd715c725973e6ddc9dfb2f33d03016798c704` |
| Pyannote community-1 snapshot hash    | `05e910b0a8e5ae578fab80258d5705c3886243306a54c39daa70785bd0842c03` |
| Pyannote runtime identity             | `ba03441bd5a4fb5a98821fdab1493e665b7f19aa687428c2db589ae342f5c397` |
| Pyannote dependencies / device        | pyannote 4.0.7, torch 2.11.0, numpy 2.5.2; CPU, four threads       |

Fresh detector accounting: cache hits 0, cache misses 8, inference 8, provider starts 8, neural model loads 4, persisted results 8, failed 0, hidden retries 0, backfill 0. Replay accounting: expected 8, cache hits 8, misses 0, inference 0, model loads 0, provider starts 0. Fresh and replay evidence hash: `45588b0d6f042cd2ddec1906c96c900ed83e0a2c47964f308df9b7099e506b43`.

Eight compact F32 score tracks are retained locally. Pyannote's original anonymous chunk scores are preserved without speaker IDs or embeddings. Silero's raw interval receipt uses centiseconds; its normalizer converts to source seconds. The strict raw-unit schema was corrected before the final freeze to describe the actual receipt, not by changing timing values.

Frozen main/audit thresholds are Silero 0.2/0.1 and Pyannote 0.5/0.25, with a 0.12-second minimum subthreshold peak. Silero records 131 + 142 peaks; Pyannote records 249 + 195: **717 subthreshold peak intervals**. No threshold was adjusted after looking at Gold.

## 6. Masked-speech ontology and Inventory V5

The masked-speech analysis keeps speech presence, lexical correctness, acoustic plausibility and contradiction separate. Energy or music-like features alone cannot produce a supported speech target. Same-family views do not create independent votes. Acoustic proxies do not prove music masking, speaker identity or a source-separation requirement.

| Masked proposal class                 | Count |
| ------------------------------------- | ----: |
| Verified independent detector speech  |   842 |
| Cross-detector subthreshold candidate |   409 |
| WebRTC-exclusive speech candidate     |   192 |
| Masked-speech safety candidate        |     3 |
| Energy-only unsupported               |    35 |
| No speech support                     |     2 |
| Total                                 | 1,483 |

Eligible proposals: 1,446. Main-supported proposals: 1,444; subthreshold-only safety proposals: 3; independently cross-detector supported: 1,251. Standalone `MULTIVIEW_SUBTHRESHOLD_ONLY` classifications: 0. Music-dominated unresolved: 0; energy-only promotions and correlation inflation: 0. Classes and support flags are different dimensions, so their totals must not be naively added. In particular, the 409 cross-detector subthreshold rows may mix main and subthreshold support; they are not 409 purely weak positives.

| Inventory V5 metric                               |                                             Value |
| ------------------------------------------------- | ------------------------------------------------: |
| Observations / atomic islands                     |                                     4,660 / 5,543 |
| New detector/masked observations                  | 3,016 = 2,093 direct records + 923 masked records |
| `MULTI_DETECTOR_CONFIRMED` class                  |                                             4,408 |
| Main speech / masked-only union                   |                     883.680771 / 0.380000 seconds |
| Total evidence union                              |                                884.060771 seconds |
| Speech-truth unresolved islands                   |                                             5,338 |
| Parent-envelope-as-speech / correlation inflation |                                             0 / 0 |
| Uncovered candidates / union                      |                          972 / 191.215854 seconds |

`unresolved` here means speech truth has not been human-verified; it does not mean an invalid or missing source-time transform. The intervals are atomic cells split at relevant source boundaries, so 5,543 is not a count of distinct utterances.

For the requested family counters, explicit definitions matter:

- Pyannote-only independent-family islands: 5; of these, the exclusive stratum has 3 and the `PYANNOTE_ONLY_SPEECH_POSITIVE` class has 1.
- Silero-only independent-family islands with multiple distinct PCM views: 5.
- WebRTC-only independent-family islands: 602, all classified `WEBRTC_EXCLUSIVE_SPEECH_CANDIDATE`; 173 use the single-view exclusive stratum and the rest can use a multi-view stratum.
- Inventory `MASKED_SPEECH_SAFETY_CANDIDATE` class: 2 cells; this differs from the 3 proposal records above.
- Strata across all islands: multi-detector 4,745; same-detector multi-view 565; WebRTC-exclusive 173; legacy-exclusive 30; existing-verified 23; Pyannote-exclusive 3; Silero-exclusive 2; masked-subthreshold 2. Stratum count is not the confirmed-speech class count.

## 7. Final safety selection and bounded local ASR

Final selection preserves all 24 original safety cores through their frozen old clusters and considers newly uncovered clusters separately. It does not preserve every newly selected Phase A core. This distinction explains the post-freeze regression; it is not obscured by the old-coverage preservation check.

| Final safety selection                         |                              Value |
| ---------------------------------------------- | ---------------------------------: |
| Active targets / atomic members                |                           23 / 193 |
| Core union                                     |                  59.923458 seconds |
| Slot / duration utilization                    |            95.833333% / 99.872431% |
| Selected timeline bins                         |             15, covering bins 0–14 |
| Reserved exclusive selections                  |                                  4 |
| All selections containing an exclusive stratum | 8 (4 Pyannote, 3 WebRTC, 1 legacy) |
| Overflow / audit-only clusters                 |                            71 / 21 |
| Density rejection / old-preservation override  |                              0 / 1 |
| Old safety coverage preserved                  |                              24/24 |
| Catch-all / REQUIRED promotion                 |                              0 / 0 |

Selected strata include multi-detector, same-family multi-view, Pyannote-exclusive, WebRTC-exclusive and legacy-fingerprint-exclusive. The unused 24th slot cannot fit another minimum-duration core: only 0.076542 seconds remains. Core union, not context envelope or total overlapping WAV duration, is the 60-second budget quantity.

The preselected ASR plan has four exact targets and two context escalations, chosen by machine evidence before Gold; plan hash `f9a569b45deca57f6b8450b489d418906a14e2f8156024ee10eda4227ba21171`. Prompt is empty, VAD is disabled for these exact probes, and context padding is 0.75 seconds. Context supplies evidence but cannot authorize replacement outside the localized core.

| ASR source request | Planned | Executed |
| ------------------ | ------: | -------: |
| Whisper exact      |       4 |        4 |
| Reazon exact       |       4 |        4 |
| Whisper context    |       2 |        2 |
| Reazon context     |       2 |        2 |
| Total              |      12 |       12 |

Fresh ASR: 12 persisted, 0 failed/persistence failures, 0 empty Whisper, 0 empty Reazon, 0 hidden retries, 0 old-probe repeats, 0 backfill and 0 whole-media ASR. There were two provider starts and two model loads. Fresh accounting has zero cache hits (its `cacheMisses` field is also zero under the fresh-execution contract; it is not misreported as 12 replay misses). Replay: 12/12 hits, 0 misses, 0 inference, 0 model loads/provider starts. Evidence hash is `cc0e4952bd9d93f30d418ac979b8f6caa5a6e91dafea64321e75125c682e474d` for both.

Whisper used Metal on Apple M1 Pro; Reazon used CPU. A 100 ms synthetic non-source Whisper warmup took the too-short early return (nine mel frames), with no source encoder/decoder inference. It is separately disclosed, not hidden as a thirteenth source-ASR request.

| ASR binding                     | Hash                                                               |
| ------------------------------- | ------------------------------------------------------------------ |
| Whisper runtime identity        | `189e04ec9249745050c40d8a2aa4609c8cf380397a27b213a8682434bcc0d33e` |
| Whisper model snapshot identity | `ff4a287dc5a887b797f29d5ba2858cc555f5abbb263c5fccdfe6f394917e1e40` |
| Whisper large-v3 model file     | `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` |
| Reazon runtime identity         | `012c097ee66dd3a4576b7c1b9a059ea1a70f72511d3e9ea5fd812a440be87244` |
| Reazon model snapshot identity  | `fef5476b9b75596716c32351bc31aa378fdfd5b98edb54a7daf621e04f73df1a` |

Lexical V5 has 23 target rows, seven newly localized Whisper candidate entries and four Reazon entries. These are candidate/localization entries, not additional model requests. There are zero exact cross-model text agreements, one pronunciation agreement, fifteen disagreement rows, one whole-cluster reliable-localized row and twelve rows with previous localized candidates. Some flags overlap. Both-empty count is zero. Missing Evidence V5 retains all 23 safety rows, eight speech-only, all 23 nonmandatory; canonical insertions remain zero. An empty or incorrect ASR output must not delete independently supported speech presence.

## 8. Physical review delivery and playback

Review Targets V4 preserves 292 nonsafety targets and adds 23 active clustered safety targets: 315 total, versus 316 before. The old 24 safety targets are accounted for through supersession, not silently discarded. Review Items V6 preserves 174 nonsafety items and creates 23: 197 total versus 198. All 23 REQUIRED items and existing R3 priority/order remain unchanged. Eighty-eight orphan items are retained; no REQUIRED level is added solely to improve recall.

| Delivery measurement                                   |               Result |
| ------------------------------------------------------ | -------------------: |
| Review regions before / after                          |              75 / 81 |
| Disjoint items / region splits                         |              14 / 17 |
| REQUIRED regions                                       |                   13 |
| Physical WAVs planned / actual                         |              81 / 81 |
| Extraction failures                                    |                    0 |
| Playable / hash-verified WAVs                          |              81 / 81 |
| Audio-required targets covered                         |       315/315 (100%) |
| Playback segments / mapped audio segments              |            568 / 568 |
| Mapped review targets                                  |              315/315 |
| Sum of WAV clip durations                              | 1,071.202562 seconds |
| Official queue unique playable seconds                 |   837.471306 seconds |
| Hallucination target / physical / audible preservation |    1/1 at each layer |

The clip-duration sum includes overlapping context and is not the unique listening burden. The 315 audio-required targets must not be confused with 23 REQUIRED review items: all selected targets require real audio, regardless of review priority. A complete audio mapping for selected targets also does not imply full coverage of Gold Missing speech absent from selection.

The new logical artifacts are Targets V4, Items V6, Regions V5, Audio Manifest V5 and Playback V4. Existing transaction and extraction subsystems are reused through explicit compatibility artifacts; their legacy version labels do not replace C6.0.1.14.2 evidence identity or authorize a data-contract rewrite. The UI labels C6.0.1.14.2 evidence separately from reused C6.0.1.12 transactions.

Four comparison workspaces were actually materialized before Gold, not fabricated as interval-only counterfactuals: A1 has 307 targets/73 WAVs, A2 316/82, A3 316/82, and detector-only 316/75. The official detector-only comparison keeps the old 24 atomic safety slots; it cannot borrow cluster-first gains. Its input projection is recorded in `machine-comparison-input-projections.json`. The earlier clustered detector-only intermediate remains local provenance but is not the authoritative comparison.

UI plans include 10%, 20%, 30%, 40%, 50%, `ALL_MANDATORY`, `FULL_QUEUE` and `C601142_FINAL_FULL_QUEUE`. The last is the default official plan. Candidate copy fills only the manual editing base; it does not save a decision, mutate timing, start a session, or finalize subtitles.

## 9. Final A/B freeze, Gold barrier and attempt history

Both final reconstructions used exact cache replay: old detector 10/10 and old ASR 32/32, new detector 8/8 and new ASR 12/12, with zero inference, model loads, provider starts or cache misses. Each final freeze binds 1,284 artifact files. The 547 reconstructed machine files are byte-identical between A/B, as are all seven protected canonical/delivery files. Workspace, projection and evidence semantic hashes match.

| Binding                           | Hash                                                               |
| --------------------------------- | ------------------------------------------------------------------ |
| Machine code snapshot             | `bc816140cc5c70c79ed49780f53d55d53e4dc0a43b9fa07f1747299015362c30` |
| Final A freeze                    | `e437b86b22a47e4ae58b70e578710e34d65fff0e8dc0ed1b4312c52c50ad9dee` |
| Final B freeze                    | `4dab9fe5da780369989444b9e9fcb7207b7b57d03bc564be1f7b9fe536ce47ec` |
| Coverage projection               | `3ca6c734203b2b65329d0336bfc1ac20844b990a2c9a6bd35ca9456b358fb538` |
| Final evidence                    | `779a1c9c531a09ee9b853dfcef0412c9745dc128d01583c94a374b44f7dcd355` |
| Code-validation artifact bytes    | `a9dfd39bd5508145ba9731e275319be0c9f6ac6f0d396ecf589f7943c8a9e0b8` |
| Browser acceptance artifact bytes | `f1e6e39fd03df2984d53d52b4582cb89662b6ebc148e2c8ddc34ee6d03ed0548` |

Final A freeze completion is `2026-08-31T18:07:03.266Z`; Final B is `2026-08-31T18:07:03.094Z`. The earliest Gold-read intent in this round is **`2026-08-31T18:11:00.986Z`** (2026-09-01 03:11:00.986 JST). It must not be replaced with the later successful invocation's timestamp.

Attempt history is preserved, not overwritten:

1. Initial Phase A/audio-view staging attempts were replaced by allocator-created `-2` directories before new inference. Time-preserving DSP and family-reserve/density corrections were completed before detector execution. No failed model requests were retried.
2. Initial Final A/B reconstructed matching machine files, but the freeze rejected the browser server's `session/workspace-mutation.sqlite` path. Read-only browser GETs had created this exact **zero-byte OS mutex**, not a human session database. Before Gold, the guard was narrowed to permit only that exact zero-byte inert file under a nongold parent; nonempty files, journals, other session artifacts and Gold paths remain rejected. Tests and the full matrix were rerun. New `-2` Final A/B and validation directories were allocated; old attempts remain intact. The browser server was stopped before the successful final freezes.
3. Evaluation attempt 1 durably saved its first-read intent, then read the evaluation inputs. It failed with `C601142_UPSTREAM_EVALUATION_NOT_FOUND_BY_HASH`: default discovery did not find the already-bound upstream evaluation inside a nested `final-a` directory. This attempt counts as a Gold read.
4. Read-only discovery found the exact hash-matching upstream file. The existing exclusive allocator created evaluation `-2`. The **unchanged evaluator** succeeded with an explicit `--gold-evaluation` location. Its per-invocation first-read timestamp is `2026-08-31T18:16:17.334Z`, not the global earliest read. Both invocations bind the same machine/code/freeze/browser/validation identities.

The local `EVALUATION_ATTEMPTS.md` records both attempts and their durable intent hashes. There were no post-first-Gold source, test, schema, threshold, policy, target, projection, matching-rule or model-output changes. Machine runtime Gold input count is 0. The successful evaluator artifact records one evaluator Gold input **per invocation**; there were two invocations, so it is not evidence of only one access in the whole round. Source and Gold hashes, sizes, mtimes and inodes were unchanged. Raw identities and Gold-linked files remain local, not in this report.

Only this report and aggregate acceptance copies are added after evaluation. They are outside the machine-code snapshot allowlist. Git bookkeeping and documentation do not reopen the machine freeze.

## 10. Frozen ablations and comparison plans

All Missing denominators are 6 and Hallucination denominators are 1. Inventory/target/physical/lexical columns below count coverage at 0.8; audible coverage is the intersection of physically playable audio and actual scheduled playback at 0.8; full coverage requires 0.95. Any-overlap is not audible recall. Item lineage, detector presence, review membership and core/context envelopes are not substitutes for the official metric.

| Stage                            | Inventory | Target | Physical | Any playback | Audible | Full | Lexical | Hallucination audible | Unique queue seconds |
| -------------------------------- | --------: | -----: | -------: | -----------: | ------: | ---: | ------: | --------------------: | -------------------: |
| A0 baseline                      |       4/6 |    4/6 |      4/6 |          4/6 |     4/6 |  4/6 |     2/6 |                   1/1 |           824.353806 |
| A1 cluster-only                  |       4/6 |    4/6 |      4/6 |          4/6 |     4/6 |  4/6 |     2/6 |                   1/1 |           824.790681 |
| A2 stratum diversity             |       4/6 |    4/6 |      5/6 |          6/6 |     5/6 |  5/6 |     2/6 |                   1/1 |           838.490368 |
| A3 Selection V2, old inventory   |       4/6 |    4/6 |      5/6 |          6/6 |     5/6 |  5/6 |     2/6 |                   1/1 |           836.430681 |
| B1 new-view projection           |       4/6 |    4/6 |      4/6 |          4/6 |     4/6 |  4/6 |     2/6 |                   1/1 |           824.353806 |
| B2 existing detectors, new views |       4/6 |    4/6 |      4/6 |          4/6 |     4/6 |  4/6 |     2/6 |                   1/1 |           824.353806 |
| B3 WebRTC evidence               |       6/6 |    4/6 |      4/6 |          4/6 |     4/6 |  4/6 |     2/6 |                   1/1 |           824.353806 |
| B4 subthreshold evidence         |       4/6 |    4/6 |      4/6 |          4/6 |     4/6 |  4/6 |     2/6 |                   1/1 |           824.353806 |
| B5 combined inventory            |       6/6 |    4/6 |      4/6 |          4/6 |     4/6 |  4/6 |     2/6 |                   1/1 |           824.353806 |
| B6 final safety selection        |       6/6 |    4/6 |      4/6 |          4/6 |     4/6 |  4/6 |     2/6 |                   1/1 |           837.471306 |
| B7 localized ASR evidence        |       6/6 |    4/6 |      4/6 |          4/6 |     4/6 |  4/6 |     2/6 |                   1/1 |           837.471306 |
| B8 final delivery                |       6/6 |    4/6 |      4/6 |          4/6 |     4/6 |  4/6 |     2/6 |                   1/1 |           837.471306 |

B1–B5 are frozen factor projections, not an instruction to cumulatively rerun models. All variants have zero evaluation-integrity failures. The four official comparisons are:

| Comparison                | Missing inventory | Missing audible | Hallucination audible | Interpretation                                    |
| ------------------------- | ----------------: | --------------: | --------------------: | ------------------------------------------------- |
| C6.0.1.14.1 baseline      |               4/6 |             4/6 |                   1/1 | Replayed unchanged                                |
| Selection repair only     |               4/6 |             5/6 |                   1/1 | One real playback gain without new inference      |
| Detector ceiling only     |               6/6 |             4/6 |                   1/1 | New evidence does not itself select/review speech |
| Final combined full queue |               6/6 |             4/6 |                   1/1 | Phase A gain not retained; route HOLD             |

## 11. Final coverage diagnosis and attribution limits

Two Missing components remain below the final target, physical-audio and audible thresholds. Both have 100% direct WebRTC coverage and combined-inventory coverage. One was not audible in A3; the other was audible/full in A3 but loses coverage in B6. Both now fall in the same eligible 46-member, 11.896625-second cluster, which is entirely unselected after the budget is exhausted. No missing WAV or playback mapping for a selected target caused these deficits.

This is two final selection deficits, including one selection-continuity regression. The frozen route artifact's blocker list names only the first because the second's `primaryDiagnosis` is `RECOVERED_BY_SELECTION_REPAIR`. That enum is **historical Phase A attribution**: the same row explicitly has `selectionOnlyAudible: true` and `finalAudible: false`. It must not be counted as a final resolution. The report uses final flags and physical playback coverage, preserves the immutable artifact and discloses the diagnosis-enum limitation.

| Contribution or residual                                | Post-freeze result                  |
| ------------------------------------------------------- | ----------------------------------- |
| Selection-only newly audible Missing                    | 1; final retained gain 0            |
| WebRTC newly inventory-covered Missing                  | 2; final newly audible gain 0       |
| New Silero/Pyannote view fully recovered Missing at 0.8 | 0; partial support exists           |
| Subthreshold-only fully recovered Missing at 0.8        | 0; partial support exists           |
| Local ASR final localized lexical coverage              | 2/6, unchanged from baseline        |
| Still lacking direct detector coverage                  | 0                                   |
| Final safety selection deficits                         | 2                                   |
| Selected-target extraction/playback omission            | 0                                   |
| Music-dominated unresolved classification               | 0; not a proof that music is absent |

For the two final deficits, new Pyannote views supply only partial direct coverage and Silero supplies none; subthreshold evidence also supplies only partial coverage. WebRTC supplies complete direct coverage. Thus the evidence does not satisfy the condition for a dialogue-enhancement/source-separation route: ordinary detectors have not all failed. A future masking investigation would require independently auditable speech-like structure, verifiable interference/low dialogue SNR, and failure across the ordinary detector/view/posterior evidence, not merely one missing label.

No manual semantic listening judgment is claimed by the automated evaluator. Actual browser playback establishes that audio is loadable and progresses; it does not establish transcript correctness. No raw Gold interval, component ID or dialogue is published here.

## 12. Burden, proxy precision and ALL_MANDATORY

| Measurement                     |       Baseline |          Final |
| ------------------------------- | -------------: | -------------: |
| Active safety targets           |             24 |             23 |
| Safety core union seconds       |      28.022875 |      59.923458 |
| Full-queue unique audio seconds |     824.353806 |     837.471306 |
| Episode duration                | 900.01 seconds | 900.01 seconds |
| Full-queue episode ratio        |     91.593850% |     93.051333% |

Incremental unique audio is **13.117500 seconds**. Final additional audible Missing recovered versus baseline is **0**, so audio seconds per recovered Missing is **null / not applicable**, not zero and not a favorable efficiency score. The final queue is below the 95% burden ceiling and has no whole-episode catch-all. Passing this cap does not mean the queue is efficient; it still requires listening to over 93% of the episode.

Twenty-two selected safety targets, totaling 54.203458 core seconds, do not overlap the known Gold Missing components. This is a **nonoverlap proxy**, not a count of confirmed false positives: the labels do not exhaustively adjudicate every speech target. It cannot justify pruning without additional evidence.

`ALL_MANDATORY` contains 235.195354 unique audible seconds, 154 target mappings and 240 playback segments. Its Missing inventory is 6/6, target and physical coverage 2/6, audible/full coverage 1/6, localized lexical coverage 2/6 and Hallucination audible coverage 0/1. It is a diagnostic subset, not the full-queue gate. Its recall limitation does not independently trigger rejection of an otherwise passing full queue, but the full queue already fails here. No REQUIRED promotions, priority manipulation, ranker retraining or new OOF runs were used to improve those numbers. Region-ranker recalibration is not authorized until the full-queue selection/coverage problem is closed.

## 13. Canonical parity and unchanged subtitle quality

| Protected identity     | Hash                                                               |
| ---------------------- | ------------------------------------------------------------------ |
| Canonical text         | `e117fd080a71b244bc39086c82a4972c9335f7c64cef07cc2df1bfbbcd992e05` |
| Canonical timing       | `e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936` |
| Presentation           | `ddb9c9f5f97acb7bc5c87925983da6d64d12e1a825025f736744f32aeec13d98` |
| Subtitle package bytes | `b1026b81be622475398f961658975da3c014d1157fc41c9966095f2db1d8386e` |

Text, timing and presentation mutation counts are zero. ASS/SRT/VTT are byte-identical to the baseline, including Final A/B. This work expands evidence and review delivery; it does not claim subtitle text recovery.

Post-freeze, hash-bound upstream quality metrics were reused only after package parity was verified. This is not a fresh subtitle-generation quality improvement: exact CER 0.6601049868766404, normalized CER 0.6015625, 77 material text errors, 53 severe timing errors, 48 overlaps, 161 machine cues versus 192 Gold cues, and 130 matched groups. Start/end MAE are approximately 1.609108/1.607836 seconds; boundary P95 is 5.385 seconds, boundary median 0.665263 seconds, and median IoU 0.582467.

Even hypothetical 6/6 review-audio coverage would not remove these text/timing errors, certify lexical correctness, validate human-trial utility or authorize C6.0.2. Final state remains `needs-review`; `finalizationMethod` is `none`; `machineOnlyReleaseAuthorized` is false.

## 14. Validation, regressions and real browser acceptance

The final machine snapshot passed the complete validation matrix under Node 24.19.0 and pinned npm 11.18.0. Dependency installation used `npm ci --offline`; no real detector/ASR, Gold evaluation, ranker training or OOF execution is performed by the code-validation suite.

| Check                                                                    | Result                             |
| ------------------------------------------------------------------------ | ---------------------------------- |
| Offline install, schema generation, typecheck, lint, format check, build | Passed                             |
| Full unit/test invocation                                                | 139 files; 1,200 passed, 2 skipped |
| Non-E2E unit subset                                                      | 111 files; 1,135 passed, 1 skipped |
| E2E                                                                      | 28 files; 65 passed, 1 skipped     |
| C6.0.1.14.2 targeted                                                     | 8 files; 77/77 passed              |
| Cross-C6 and C5.19 regressions                                           | 90 files; 693/693 passed           |
| Review UI tests                                                          | 5 files; 54/54 passed              |
| Real browser acceptance                                                  | 11/11 passed                       |
| Skill 1 quick validation                                                 | `Skill is valid!`                  |
| Generated JSON schemas                                                   | 481                                |
| Final strict-schema instances                                            | 382/382 passed                     |
| Combined engineering/integrity checks                                    | 64/64 passed                       |

The test subsets overlap with the full invocation and must not be summed as independent tests. Skipped tests are disclosed; the result is not described as 1,202 executed tests. The validation artifact's schema-check detail counts 380 before adding its two shareable artifacts; the authoritative final checked-artifact count is 382.

A post-documentation read-only check confirmed the same 1,242-file machine-code snapshot and all 1,831 unique Final A/B frozen artifact bindings (1,099,604,981 bytes hashed). The two public aggregate copies retained the audited bytes and passed the existing strict export validator. This check performed no model inference or model load and did not regenerate frozen outputs.

Synthetic/regression coverage includes structural/silence merge barriers, family correlation and duplicate PCM, exclusive selection and density insertion, budget failures, view delay, posterior mapping/serialization, cache replay and persistence, bounded ASR, evidence localization, empty-result safety, physical audio/playback mapping, strict JSON validation, Gold barriers, final freeze and byte parity. Dataset-specific source text, private absolute paths or Gold component intervals are not encoded as selection rules.

The real in-app browser opened the actual local review server and checked initial official queue, evidence version labels, jump/filter behavior, visual layout, candidate-copy-only behavior, start/end preservation, no automatic save, and distinct `ALL_MANDATORY`/full queues. A real WAV reached readyState 4 with advancing currentTime; stop and subsequent playback worked. Console errors were zero. Session API remained `not-started`/null; saved human decisions and human trials were zero. The inspected data/script byte hashes are bound into acceptance. The server was stopped before the final freeze; it was not reopened for post-Gold tuning.

Skill 1 documentation now routes C6.0.1.14.2 through exact replay, fixed budgets, policy-alias binding, exclusive output allocation, source-time evidence, the Gold barrier, and the candidate-copy/no-autosave UI. It also documents the narrowly constrained zero-byte browser mutex. Skill 2/3 remain unchanged.

## 15. Privacy, local-only evidence and shareable acceptance

The public acceptance files are `acceptance/c6-0-1-14-2/c6-0-1-14-2-shareable-acceptance-summary.json` and `acceptance/c6-0-1-14-2/c6-0-1-14-2-shareable-audit.json`. They are byte-preserving copies of the validated aggregate export, not repackaged raw evidence.

Shareable summary byte SHA-256: `a5fc779745f09a821c14a84c84b7fbdc821be24472b4990f489545b29e6799b7`.

Strict schema passed; absolute path leaks 0, secret patterns 0, raw dialogue/audio fields 0, source/Gold interval fields 0, broken relative references 0. The aggregate schema contains no file-reference fields, so the latter is not a claim that all local raw outputs are independently public-shareable. The aggregate summary records the actual coverage HOLD, not a rewritten pass.

The source repository excludes all output directories, view PCM/WAVs, detector score arrays, raw Pyannote chunks, complete ASR text, Gold/evaluation labels, model snapshots, runtime installations, caches, local session files and credentials. This report contains aggregate results and nonsecret implementation/evidence identity hashes only. Raw acceptance artifacts and the evaluation chronology remain local research evidence. No output ZIP is created or uploaded by this development task.

Source video and Gold were read-only; existing output metadata remained intact. Model execution/evaluation was offline after the separately authorized runtime bootstrap. The subsequent Git push publishes only the reviewed source/documentation/aggregate allowlist, not model input data.

## 16. Remaining risks and next-stage decision

The next permitted route is selection repair, not C6.0.1.15 and not source separation. A future separately authorized, pre-Gold iteration should investigate:

1. Cross-phase preservation of machine-selected coverage, not only original baseline safety cores. The invariants should distinguish core coverage from physical context coverage.
2. Budget-aware structural subdivision or selection of large coherent clusters, using source evidence and generic constraints rather than Gold timestamps, so a late 11.9-second cluster does not become indivisible budget overflow.
3. Explicit final-state attribution: a historical selection-only gain must not hide a final regression in the blocker list.
4. Durable per-reason merge rejection counters, alongside the existing member/cluster and decision traces.
5. Burden/precision evaluation after full coverage is closed; do not treat known-label nonoverlap as verified false-positive evidence or promote all safety items to REQUIRED.

These are recommendations, not changes executed after Gold. A future evaluation requires a newly frozen generic implementation and an appropriately isolated evaluation design; this round's known Gold findings must not become episode-specific selection constants.

Final route: `HOLD_FOR_SAFETY_TARGET_SELECTION_REPAIR`. Engineering passed; evaluation integrity passed; target budget passed; full-queue burden passed; full-queue Missing coverage failed. C6.0.1.15 GO is false, C6.0.2 remains HOLD, human trial is not started, and automatic subtitle finalization is not authorized.

## 17. Commits, remote reference and output locator

The implementation commit is `eead1b0f8a6955fb9e75607ffe3dd7cf8ba49102`. The acceptance commit is the independent `docs: record C6.0.1.14.2 final acceptance` commit introducing this report and the two aggregate JSON files. All requested implementation commit categories resolve to the implementation commit; they are not falsely presented as seven separate commits.

Remote: `https://github.com/kai987/Codex-Skills-multilingual-video-subtitler.git`.

Remote reference: `refs/heads/codex/c6-0-1-14-2-safety-selection-detector-ceiling`.

The acceptance commit's own SHA cannot be embedded in its contents without changing the SHA. The delivery procedure records the exact acceptance SHA, `git ls-remote` HEAD, local/tracking parity and clean-worktree result in the local `FINAL_GIT_DELIVERY.local-only.json` receipt after commit/push, and returns those exact identities in the final handoff. The report-introducing commit is also discoverable with `git log -1 --format=%H -- C6_0_1_14_2_SAFETY_SELECTION_DETECTOR_CEILING_REPORT.md`.

Authoritative state locator: `carnation-c6-0-1-14-2-evaluation-20260901-2/c6-0-1-14-2-run-paths.local-only.json`, relative to the user's local output root. Absolute user paths are intentionally not published.

| Role              | Local output directory                               |
| ----------------- | ---------------------------------------------------- |
| Baseline          | `carnation-c6-0-1-14-2-baseline-20260901`            |
| Selection audit   | `carnation-c6-0-1-14-2-selection-audit-20260901-2`   |
| Target clusters   | `carnation-c6-0-1-14-2-target-clusters-20260901-2`   |
| Phase A selection | `carnation-c6-0-1-14-2-selection-v2-20260901-2`      |
| Audio view audit  | `carnation-c6-0-1-14-2-audio-view-audit-20260901-2`  |
| Dialogue views    | `carnation-c6-0-1-14-2-dialogue-views-20260901-2`    |
| Detector fresh    | `carnation-c6-0-1-14-2-detectors-fresh-20260901`     |
| Detector replay   | `carnation-c6-0-1-14-2-detectors-replay-20260901`    |
| Masked speech     | `carnation-c6-0-1-14-2-masked-speech-20260901`       |
| Inventory V5      | `carnation-c6-0-1-14-2-inventory-v5-20260901`        |
| ASR fresh         | `carnation-c6-0-1-14-2-local-asr-fresh-20260901`     |
| ASR replay        | `carnation-c6-0-1-14-2-local-asr-replay-20260901`    |
| Missing evidence  | `carnation-c6-0-1-14-2-missing-evidence-v5-20260901` |
| Review package    | `carnation-c6-0-1-14-2-review-package-v5-20260901`   |
| Evaluation        | `carnation-c6-0-1-14-2-evaluation-20260901-2`        |
| Final A           | `carnation-c6-0-1-14-2-final-a-20260901-2`           |
| Final B           | `carnation-c6-0-1-14-2-final-b-20260901-2`           |
| Validation        | `carnation-c6-0-1-14-2-validation-20260901-2`        |

The earlier unsuffixed Phase A/view/Final A/Final B/validation/evaluation attempts remain local history. The first browser acceptance and skill-validation log live in the original validation directory and are hash-bound by final acceptance. They must not be confused with the authoritative `-2` Final A/B/evaluation state.

Key local acceptance filenames are `acceptance/c6-0-1-14-2-validation.json`, `code-checks/c6-0-1-14-2-code-validation.json`, `EVALUATION_ATTEMPTS.md`, `gold-c6-0-1-14-2-selection-detector-ceiling-evaluation.json`, `c6-0-1-14-2-post-freeze-evaluation-audit.local-only.json`, `c6-0-1-14-2-machine-subtitle-parity-quality.json`, `c6-0-1-14-2-route-decision.json`, and the two final `c6-0-1-14-2-machine-selection-detector-freeze.json` files. These contain the detailed evidence; the public report deliberately omits raw component identities and source spans.

## 18. Requested report-topic coverage index

| Requested topics                                                                                                                                          | Report sections                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1–11: conclusion, branch, baseline, replay, goals, exclusions, blocked next stage, root causes, phases, authorization, Gold barrier                       | 1, 2, 9, 16                                                                |
| 12–26: pathology, utilization, starvation, overflow, clusters, merge policy, slots, strata, reserves, density, utility, selection, ledger, zero inference | 2, 3                                                                       |
| 27–31: existing/duplicate/new views, time mapping, spectral effect                                                                                        | 4                                                                          |
| 32–47: posterior/subthreshold, WebRTC/runtime/hash/runs, Silero/Pyannote, accounting, replay, correlation, masked classes and music                       | 5, 6                                                                       |
| 48–58: inventory, independent support, uncovered candidates, final selection/count/union/timeline/exclusives/overflow/burden                              | 6, 7, 12                                                                   |
| 59–68: ASR target/budget/models/context/retry/persistence/replay/lexical/missing evidence                                                                 | 7                                                                          |
| 69–76: targets/items/regions/audio/playback, coverage/mapping and Hallucination preservation                                                              | 8                                                                          |
| 77–78: machine freeze and first Gold read                                                                                                                 | 9                                                                          |
| 79–90: A0–A3 and B1–B8                                                                                                                                    | 10                                                                         |
| 91–107: comparison recalls, final coverage layers, Hallucination, exclusive/WebRTC/view/subthreshold/ASR attribution, residual/masking/proxy diagnoses    | 10, 11, 12                                                                 |
| 108–119: baseline/final count/union/slots/queue, incremental cost, ALL_MANDATORY, no ranker/OOF                                                           | 3, 7, 12                                                                   |
| 120–130: text/timing/subtitle/A-B parity, no full ASR, Gold/hardcoding/network/read-only/shareability                                                     | 7, 9, 13, 14, 15                                                           |
| 131–138: unit/E2E/UI/browser/targeted/cross-version/schema/Skill                                                                                          | 14                                                                         |
| 139–149: engineering/integrity/selection/detector/coverage/route/readiness/release/trial/risks/recommendation                                             | 1, 11, 13, 16                                                              |
| 150–152: commits, remote HEAD procedure, output paths                                                                                                     | 17; exact post-push identities in local delivery receipt and final handoff |
