# C6.0.1.16 evaluation audit

This is a separate, opt-in development experiment, not a replacement of the
legacy evaluator or a release policy change.

The legacy `blind-acceptance/gold-evaluation.ts` edits machine text into reference
text. Consequently its insertion/deletion labels are reversed relative to the
usual reference-to-hypothesis convention; its total edit distance remains valid.
It also mixes time proximity and text in cue matching, and counts only adjacent
overlaps. Do not compare its timing numbers directly with the new numbers.

The new evaluator reuses subtitle parsers and the versioned legacy ASS timestamp
syntax normalizer. It measures actual exported files, removes display line breaks
for exact NFC CER, and uses the same NFKC/punctuation/separator/whitespace/lowercase
normalization on both sides for normalized CER. No lexical words are removed.
S/D/I/N use reference-to-hypothesis operations; empty reference CER is null.
The tie break is diagonal, deletion, insertion. The full reference, including
lyrics, is the primary denominator. No intervals are excluded after scoring.

A text-only global character alignment supplies equal-character connections
between cues. Connected cue groups support 1:M and M:1 mappings. Timing requires
at least 50% equal-character coverage on both sides of the group. No timestamp
is used to choose these matches. Start/end MAE, P95, IoU and >2 second boundary
errors disclose matched groups, matched reference cues and unmatched counts.
Text-repetitive material can have ambiguous lexical alignment; this is not
independent acoustic ground truth. Same-support timing changes are reported
separately from changes in matching. Empty matches have null, not perfect, timing.

Deletion and insertion runs are character-aligned spans, not cue-count differences.
Reference-unsupported insertions are not automatically hallucinations. Every
overlap pair, including nonadjacent nested pairs, is enumerated; exact-text
overlap is only a duplicate diagnostic, not proof of incorrect duplication.
Confirmed acoustic hallucinations and illegal overlaps remain unknown without
independent evidence. Style strata reuse the global matching; cross-stratum
groups are flagged. Default style cannot distinguish narration from dialogue.

The primary metric is normalized CER. Quality requires strict improvement over
B1 and checks omissions, insertions and severe timing errors separately. Any
increase in these error dimensions holds the overall quality gate. Raw text and
time non-degradation are distinct. Held-out validation cannot be synthesized.
No decision here authorizes machine-only release.

The importer independently verifies the primary request's frozen file digest,
portable cache key, result digest, chunk result equality, physical WAV digest,
extraction interval, stream/sample rate, and primary local-to-global mapping.
It rejects VAD-local requests because this importer has no proof of their remap.
The generic mapping tests cover a nonzero media start without double offset.
Legacy primary prompts must exactly reconstruct from fixed generic instructions
and names literally present in the media filename. Thus this is a historical
machine-evidence experiment, not certification of a new title-free ASR baseline.

The stable canonical package must match its recorded text/timing hashes and all
three serialized files. B1 is explicitly a historical canonical comparison, not
a claimed fresh full-pipeline matched-evidence replay. Causal attribution is
limited to the isolated B2 scaffold with the repair enabled versus disabled.

Generation runs in a separate Node permission process with access only to code,
dependencies, one strict machine-evidence JSON, and a new output directory. The
reference is opened only by the evaluator after verifying the output freeze.
This prevents accidental reference reads; it is not a provenance authority for
an adversarially fabricated input JSON. Only the verified importer is supported.
