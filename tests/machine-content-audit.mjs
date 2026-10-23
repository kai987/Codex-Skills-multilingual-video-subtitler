import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditContent,
  contentAuditPolicy,
} from "../scripts/lib/machine-content-audit.mjs";

const cue = (text, start = 0, end = start + 2, index = 0) => ({
  id: `cue-${index}`,
  index,
  text,
  start,
  end,
});
const codes = (result) => result.issues.map((issue) => issue.code);

test("empty and clean drafts never claim verified quality", () => {
  assert.equal(auditContent([]).status, "needs-review");
  const result = auditContent([cue("こんにちは")]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.summary.recordCount, 1);
  assert.equal(result.status, "needs-review");
});

test("invalid finite and nonfinite times remain JSON-safe unresolved diagnostics", () => {
  const result = auditContent(
    [
      cue("一", 1, 1),
      cue("二", 4, 3),
      cue("三", -1, 1),
      cue("四", NaN, 4),
      cue("五", 4, Infinity),
      cue("六", "1", 2),
      cue("七", 8, 12),
    ],
    { sourceEnd: 10 },
  );
  assert.equal(result.summary.invalidTimingCueCount, 7);
  assert.equal(result.summary.byCode.INVALID_TIME, 7);
  assert.ok(result.issues.every((item) => item.code === "INVALID_TIME"));
  assert.equal(result.issues[3].cues[0].start, null);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("strict threshold boundaries and language-aware speed", () => {
  const result = auditContent(
    [
      cue("あ", 0, 0.2),
      cue("あ", 1, 1.199),
      cue("あいうえお", 2, 2.2),
      cue("あいうえおか", 3, 3.2),
      cue("区間", 4, 14),
      cue("区間", 15, 24.999),
    ],
    { language: "ja" },
  );
  assert.deepEqual(
    result.issues
      .filter((x) => x.code === "SHORT_POSITIVE_DURATION")
      .flatMap((x) => x.cueIndexes),
    [1],
  );
  assert.deepEqual(
    result.issues
      .filter((x) => x.code === "EXCESSIVE_READING_SPEED")
      .flatMap((x) => x.cueIndexes),
    [3],
  );
  assert.deepEqual(
    result.issues
      .filter((x) => x.code === "LONG_SPAN_WEAK_BOUNDARY")
      .flatMap((x) => x.cueIndexes),
    [4],
  );
  assert.ok(
    !codes(
      auditContent([cue("abcdefghijk", 0, 0.25)], { language: "en" }),
    ).includes("EXCESSIVE_READING_SPEED"),
  );
  assert.ok(
    codes(auditContent([cue("あabcdefghijk", 0, 0.25)])).includes(
      "EXCESSIVE_READING_SPEED",
    ),
  );
});

test("decimal thresholds are not crossed by binary subtraction noise", () => {
  const result = auditContent(
    [cue("あいうえお", 1, 1.2), cue("あいうえお", 19.8, 20)],
    { language: "ja" },
  );
  assert.ok(!codes(result).includes("SHORT_POSITIVE_DURATION"));
  assert.ok(!codes(result).includes("EXCESSIVE_READING_SPEED"));
  assert.ok(
    codes(auditContent([cue("あいうえお", 1, 1.1999999999999997)])).includes(
      "EXCESSIVE_READING_SPEED",
    ),
  );
});

test("subnormal valid durations retain JSON-safe evidence", () => {
  const result = auditContent([cue("あ", 0, Number.MIN_VALUE)]);
  const issue = result.issues.find(
    (item) => item.code === "EXCESSIVE_READING_SPEED",
  );
  assert.equal(issue.evidence.charactersPerSecond, null);
  assert.equal(issue.evidence.rateExceedsFiniteNumberRange, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("three short legitimate repeats are warnings only and text remains unchanged", () => {
  const input = [
    cue("はい", 0, 1, 81),
    cue("はい！", 1, 2, 82),
    cue("はい", 2, 3, 83),
  ];
  const original = input.map((record) => ({ ...record }));
  const result = auditContent(input);
  const issue = result.issues.find(
    (item) => item.code === "NEIGHBORING_EXACT_REPETITION",
  );
  assert.deepEqual(issue.cueIndexes, [0, 1, 2]);
  assert.deepEqual(
    issue.cues.map((c) => c.recordIndex),
    [81, 82, 83],
  );
  assert.equal(issue.severity, "warning");
  assert.equal(issue.evidence.repeatCount, 3);
  assert.match(issue.reason, /not proof of hallucination/u);
  assert.deepEqual(input, original);
  assert.ok(!("repairedRecords" in result));
});

test("non-neighboring, invalid, backwards and distant repetitions do not form runs", () => {
  for (const records of [
    [cue("同一", 0), cue("別の句", 2), cue("同一", 4), cue("同一", 6)],
    [cue("同一", 0), cue("同一", 1, 1), cue("同一", 2)],
    [cue("同一", 8), cue("同一", 4), cue("同一", 0)],
    [cue("同一", 0), cue("同一", 8), cue("同一", 16)],
  ])
    assert.ok(
      !codes(auditContent(records)).includes("NEIGHBORING_EXACT_REPETITION"),
    );
});

test("overlapping ordered repeats are retained and flagged", () => {
  assert.ok(
    codes(
      auditContent([cue("反復", 0, 2), cue("反復", 1, 3), cue("反復", 2, 4)]),
    ).includes("NEIGHBORING_EXACT_REPETITION"),
  );
});

test("changing prefixes do not hide a 17-cue shared phrase loop", () => {
  const records = Array.from({ length: 17 }, (_, i) =>
    cue(`${i}番の発言こちらの見本を確認してください末尾${i}`, i, i + 1, i),
  );
  const result = auditContent(records);
  const shared = result.issues.filter(
    (item) => item.code === "NEIGHBORING_SHARED_SUBSTRING",
  );
  assert.equal(shared.length, 1);
  assert.equal(shared[0].cueIndexes.length, 17);
  assert.equal(shared[0].evidence.matchingCueCount, 17);
  assert.ok(Array.from(shared[0].evidence.normalizedPattern).length >= 8);
  assert.ok(!codes(result).includes("NEIGHBORING_EXACT_REPETITION"));
});

test("two common phrases and common phrases separated by large gaps do not form loops", () => {
  const phrase = "こちらの見本を確認してください";
  assert.ok(
    !codes(
      auditContent([cue(`一${phrase}`, 0), cue(`二${phrase}`, 2)]),
    ).includes("NEIGHBORING_SHARED_SUBSTRING"),
  );
  assert.ok(
    !codes(
      auditContent([
        cue(`一${phrase}`, 0),
        cue(`二${phrase}`, 8),
        cue(`三${phrase}`, 16),
      ]),
    ).includes("NEIGHBORING_SHARED_SUBSTRING"),
  );
});

test("exact long repeats do not duplicate shared-substring findings", () => {
  const result = auditContent(
    [0, 1, 2].map((i) => cue("こちらの見本を確認してください", i, i + 1)),
  );
  assert.ok(codes(result).includes("NEIGHBORING_EXACT_REPETITION"));
  assert.ok(!codes(result).includes("NEIGHBORING_SHARED_SUBSTRING"));
});

test("three phrase occurrences across two cues close the per-cue repetition blind spot", () => {
  const phrase = "こちらの資料を確認",
    records = [
      cue(`開始${phrase}終了`, 0, 3),
      cue(`${phrase}別${phrase}`, 3, 7),
    ];
  const original = globalThis.structuredClone(records),
    result = auditContent(records),
    findings = result.issues.filter(
      (item) => item.code === "CROSS_CUE_PHRASE_REPETITION",
    );
  assert.equal(findings.length, 1);
  const issue = findings[0];
  assert.equal(result.policy.version, "machine-content-risk-v2");
  assert.equal(issue.evidence.normalizedPattern, phrase);
  assert.equal(issue.evidence.totalOccurrences, 3);
  assert.equal(issue.severity, "warning");
  assert.deepEqual(issue.cueIndexes, [0, 1]);
  assert.match(issue.reason, /does not authorize deletion/u);
  assert.match(
    issue.evidence.offsetBasis,
    /not original-text offsets or acoustic times/u,
  );
  assert.deepEqual(
    issue.evidence.occurrences.map((row) => row.ranges),
    [
      [{ startCharacter: 2, endCharacter: 11 }],
      [
        { startCharacter: 0, endCharacter: 9 },
        { startCharacter: 10, endCharacter: 19 },
      ],
    ],
  );
  assert.deepEqual(records, original);
  assert.ok(!codes(result).includes("INTRA_CUE_REPETITION"));
  assert.ok(!codes(result).includes("NEIGHBORING_SHARED_SUBSTRING"));
  assert.ok(!("repairedRecords" in result));
});

test("two normal repetitions and distinct short replies are not cross-cue loops", () => {
  for (const records of [
    [cue("こちらの資料を確認", 0), cue("こちらの資料を確認", 2)],
    [cue("はい、はい", 0), cue("ああ、ああ", 2)],
    [cue("あいうえおかき", 0), cue("あいうえおかきあいうえおかき", 2)],
    [
      cue("こちらの資料を確認", 0),
      cue("別の発言です", 2),
      cue("こちらの資料を確認こちらの資料を確認", 4),
    ],
  ])
    assert.ok(
      !codes(auditContent(records)).includes("CROSS_CUE_PHRASE_REPETITION"),
    );
});

test("cross-cue repetition rejects invalid, reversed, distant, or overlong pairs", () => {
  const phrase = "こちらの資料を確認";
  for (const [leftStart, leftEnd, rightStart, rightEnd] of [
    [0, 0, 0, 3],
    [0, 3, 3, 3],
    [NaN, 3, 3, 6],
    [0, 3, 3, Infinity],
    [0, 3, 5.001, 8],
    [3, 6, 2, 8],
    [0, 8, 3, 7],
    [0, 8, 7, 6],
    [0, 3, 3, 20.001],
  ]) {
    const records = [
      cue(phrase, leftStart, leftEnd),
      cue(phrase.repeat(2), rightStart, rightEnd),
    ];
    assert.ok(
      !codes(auditContent(records)).includes("CROSS_CUE_PHRASE_REPETITION"),
    );
  }
  assert.ok(
    codes(
      auditContent([cue(phrase, 0, 4), cue(phrase.repeat(2), 6, 20)]),
    ).includes("CROSS_CUE_PHRASE_REPETITION"),
  );
  assert.ok(
    codes(
      auditContent([cue(phrase, 0, 4), cue(phrase.repeat(2), 3, 7)]),
    ).includes("CROSS_CUE_PHRASE_REPETITION"),
  );
});

test("cross-cue occurrence offsets count normalized Unicode points, not UTF-16 units", () => {
  const phrase = "𠮷資料を確認します",
    width = Array.from(phrase).length,
    records = [cue(`前！${phrase}`, 0, 3), cue(`${phrase}、 ${phrase}`, 3, 7)];
  const result = auditContent(records),
    issue = result.issues.find(
      (item) => item.code === "CROSS_CUE_PHRASE_REPETITION",
    );
  assert.ok(issue);
  assert.equal(issue.evidence.patternCharacters, width);
  assert.deepEqual(
    issue.evidence.occurrences.map((row) => row.ranges),
    [
      [{ startCharacter: 1, endCharacter: 1 + width }],
      [
        { startCharacter: 0, endCharacter: width },
        { startCharacter: width, endCharacter: width * 2 },
      ],
    ],
  );
  for (const row of issue.evidence.occurrences) {
    const normalized = Array.from(
      records[row.cueIndex].text
        .normalize("NFKC")
        .replace(/[\s\p{P}\p{S}]/gu, ""),
    );
    for (const range of row.ranges)
      assert.equal(
        normalized.slice(range.startCharacter, range.endCharacter).join(""),
        phrase,
      );
  }
});

test("cross-cue matching counts only nonoverlapping occurrences and longest supported pattern", () => {
  assert.ok(
    !codes(auditContent([cue("abcdefghij", 0), cue("abcdefghij", 2)])).includes(
      "CROSS_CUE_PHRASE_REPETITION",
    ),
  );
  const phrase = "abcdefghijklmno",
    issue = auditContent([
      cue(phrase, 0),
      cue(`${phrase}X${phrase}`, 2),
    ]).issues.find((item) => item.code === "CROSS_CUE_PHRASE_REPETITION");
  assert.equal(issue.evidence.normalizedPattern, phrase);
  assert.equal(issue.evidence.totalOccurrences, 3);
  const overlapOnly = auditContent([
    cue("あ".repeat(10), 0),
    cue("あ".repeat(10), 2),
  ]);
  assert.ok(!codes(overlapOnly).includes("CROSS_CUE_PHRASE_REPETITION"));
});

test("existing three-cue repetition runs do not add redundant pair findings", () => {
  const phrase = "こちらの資料を確認";
  const result = auditContent(
    [0, 1, 2].map((index) => cue(phrase.repeat(2), index * 2)),
  );
  assert.ok(codes(result).includes("NEIGHBORING_EXACT_REPETITION"));
  assert.ok(!codes(result).includes("CROSS_CUE_PHRASE_REPETITION"));
});

test("cross-cue analysis is deterministic, immutable and bounded to the text prefix", () => {
  const phrase = "abcdefgh",
    records = Object.freeze([
      Object.freeze(cue(phrase.repeat(1100), 0, 5)),
      Object.freeze(cue(phrase.repeat(1100), 5, 10)),
    ]),
    before = globalThis.structuredClone(records),
    result = auditContent(records);
  assert.deepEqual(result, auditContent(records));
  assert.deepEqual(records, before);
  const findings = result.issues.filter(
    (item) => item.code === "CROSS_CUE_PHRASE_REPETITION",
  );
  assert.equal(findings.length, 1);
  assert.ok(findings[0].evidence.patternCharacters <= 64);
  for (const row of findings[0].evidence.occurrences)
    assert.ok(row.ranges.every((range) => range.endCharacter <= 8192));
  assert.ok(
    !codes(
      auditContent([
        cue("x".repeat(8192) + phrase, 0, 5),
        cue(phrase.repeat(2), 5, 10),
      ]),
    ).includes("CROSS_CUE_PHRASE_REPETITION"),
  );
});

test("intra-cue repetition requires coverage and preserves intentional speech", () => {
  const result = auditContent([
    cue("前置き見てください見てください見てください後書き"),
  ]);
  const issue = result.issues.find(
    (item) => item.code === "INTRA_CUE_REPETITION",
  );
  assert.ok(issue);
  assert.equal(issue.evidence.pattern, "見てください");
  assert.equal(issue.evidence.repeats, 3);
  assert.ok(
    !codes(auditContent([cue("そうそうそう")])).includes(
      "INTRA_CUE_REPETITION",
    ),
  );
  assert.ok(
    !codes(auditContent([cue("もう一回もう一回")])).includes(
      "INTRA_CUE_REPETITION",
    ),
  );
});

test("Unicode code points and width normalization do not mutate raw punctuation", () => {
  const records = [cue("ＡＢＣＤ", 0), cue("ABCD！", 2), cue("ABCD", 4)];
  const result = auditContent(records);
  assert.ok(codes(result).includes("NEIGHBORING_EXACT_REPETITION"));
  assert.equal(records[0].text, "ＡＢＣＤ");
  const unicode = auditContent([cue("𠮷𠮷𠮷𠮷𠮷", 0, 0.25)]);
  assert.ok(!codes(unicode).includes("EXCESSIVE_READING_SPEED"));
});

test("frozen input, stable output, independent result objects and bounded analysis", () => {
  const input = Object.freeze([
    Object.freeze(cue("あいうえおかきくけこ".repeat(1000), 0, 20)),
  ]);
  const a = auditContent(input),
    b = auditContent(input);
  assert.deepEqual(a, b);
  assert.ok(codes(a).includes("TEXT_ANALYSIS_TRUNCATED"));
  assert.equal(input[0].text.length, 10000);
  a.policy.longSpanSeconds = 100;
  assert.equal(contentAuditPolicy.longSpanSeconds, 10);
  assert.equal(b.policy.longSpanSeconds, 10);
});

test("malformed shape, identity, options and thresholds reject explicitly", () => {
  for (const input of [
    null,
    {},
    "text",
    [null],
    [{ text: 12 }],
    [cue("x", 0, 1, -1)],
    [{ ...cue("x"), id: {} }],
  ])
    assert.throws(() => auditContent(input), /CONTENT_AUDIT/u);
  for (const options of [
    null,
    [],
    { references: [] },
    { language: null },
    { language: "invalid language" },
    { sourceEnd: NaN },
    { sourceEnd: -1 },
    { thresholds: [] },
    { thresholds: null },
    { thresholds: { other: 4 } },
    { thresholds: { longSpanSeconds: 0 } },
    { thresholds: { neighboringRepeatCount: 2 } },
    { thresholds: { neighboringRepeatCount: 3.5 } },
    { thresholds: { commonSubstringCharacters: 2 } },
    { thresholds: { intraCueMaximumPatternCharacters: 1000 } },
    { thresholds: { crossCueMinimumPatternCharacters: 7 } },
    { thresholds: { crossCueMinimumPatternCharacters: 8.5 } },
    { thresholds: { crossCueMaximumPatternCharacters: 65 } },
    {
      thresholds: {
        crossCueMinimumPatternCharacters: 10,
        crossCueMaximumPatternCharacters: 9,
      },
    },
    { thresholds: { crossCueMinimumOccurrences: 2 } },
    { thresholds: { crossCueMinimumOccurrences: 3.5 } },
    { thresholds: { crossCueMaximumWindowSeconds: 20.001 } },
  ])
    assert.throws(() => auditContent([], options), /CONTENT_AUDIT/u);
});

test("cross-cue threshold overrides narrow the rule without mutating defaults", () => {
  const phrase = "abcdefgh",
    records = [cue(phrase, 0, 2), cue(phrase.repeat(2), 2, 4)];
  for (const thresholds of [
    { crossCueMinimumPatternCharacters: 9 },
    { crossCueMinimumOccurrences: 4 },
    { crossCueMaximumWindowSeconds: 3 },
  ])
    assert.ok(
      !codes(auditContent(records, { thresholds })).includes(
        "CROSS_CUE_PHRASE_REPETITION",
      ),
    );
  assert.ok(
    codes(auditContent(records)).includes("CROSS_CUE_PHRASE_REPETITION"),
  );
  assert.equal(contentAuditPolicy.crossCueMaximumWindowSeconds, 20);
});

test("selected thresholds are explicit provenance and do not mutate defaults", () => {
  const result = auditContent([cue("境界", 0, 12)], {
    thresholds: { longSpanSeconds: 15 },
    language: "ja-JP",
  });
  assert.equal(result.policy.longSpanSeconds, 15);
  assert.ok(!codes(result).includes("LONG_SPAN_WEAK_BOUNDARY"));
  assert.equal(auditContent([cue("境界", 0, 12)]).policy.longSpanSeconds, 10);
});
