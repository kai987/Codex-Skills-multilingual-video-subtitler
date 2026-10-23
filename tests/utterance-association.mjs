import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  associateUtterance,
  planAssociation,
  summarizeUtteranceTiming,
} from "../scripts/lib/utterance-association.mjs";
import {
  reserveAlignment,
  runAssociation,
} from "../scripts/subtitle-tool-utterance-association.mjs";
const probe = {
  id: "clip-1",
  start: 2,
  end: 7,
  targetStart: 4,
  targetEnd: 5,
  hostIds: [],
};
const baseline = [
  { id: "before", start: 0, end: 2.5, text: "前の台詞" },
  { id: "after", start: 7, end: 9, text: "次の台詞" },
];
const views = (a = [{ start: 2, end: 5, text: "ああ" }], b = a) =>
  ["whisper", "kotoba"].map((backend, i) => ({
    targetId: probe.id,
    backend,
    records: i ? b : a,
  }));
test("crop-edge consensus selects timing-only, not ASR or insertion", () => {
  const r = associateUtterance(probe, baseline, views());
  assert.equal(r.route, "timing-only-alignment");
  assert.equal(r.targetText, "ああ");
  assert.equal(r.asrRerun, false);
  assert.equal(r.subtitleMutationAuthorized, false);
});
test("existing spaced text links before target without treating gap as omission", () => {
  const base = [
    ...baseline,
    { id: "tail", start: 2, end: 4, text: "それ は ポイント カード" },
  ];
  const r = associateUtterance(
    probe,
    base,
    views([{ start: 2, end: 3.9, text: "それはポイントカード" }]),
  );
  assert.equal(r.route, "existing-cue-association-review");
  assert.deepEqual(
    r.hypotheses[0].matches.map((m) => m.cueId),
    ["tail"],
  );
  assert.equal(r.hypotheses[0].targetOverlap, false);
});
test("one backend extra short reply is not consensus", () => {
  const r = associateUtterance(
    probe,
    baseline,
    views(
      [
        { start: 2, end: 4, text: "前の台詞" },
        { start: 4, end: 6, text: "ああ" },
      ],
      [{ start: 2, end: 4, text: "前の台詞" }],
    ),
  );
  assert.equal(r.route, "mixed-context-existing-cue-review");
  assert.equal(r.targetText, null);
});
test("multi-utterance common text cannot select a whole-window alignment", () => {
  const a = [
    { start: 2, end: 4, text: "ありがとう" },
    { start: 4, end: 7, text: "カード" },
  ];
  assert.notEqual(
    associateUtterance(probe, baseline, views(a)).route,
    "timing-only-alignment",
  );
});
test("hosted target remains review even with novel exact consensus", () => {
  assert.notEqual(
    associateUtterance({ ...probe, hostIds: ["host"] }, baseline, views())
      .route,
    "timing-only-alignment",
  );
});
test("spelling disagreement is not normalized into consensus", () => {
  const r = associateUtterance(
    probe,
    baseline,
    views(
      [{ start: 2, end: 6, text: "カード" }],
      [{ start: 2, end: 6, text: "カート" }],
    ),
  );
  assert.equal(r.route, "text-conflict-review");
});
test("short substring cannot associate a particle with a full sentence", () => {
  const base = [
    ...baseline,
    { id: "long", start: 3, end: 4, text: "ああそれは知っています" },
  ];
  assert.equal(
    associateUtterance(probe, base, views()).hypotheses[0].matches.length,
    0,
  );
});
test("identical distant wording does not link another occurrence", () => {
  assert.equal(
    associateUtterance(
      probe,
      [...baseline, { id: "far", start: 20, end: 21, text: "ああ" }],
      views(),
    ).route,
    "timing-only-alignment",
  );
});
test("ambiguous nearby exact matches are retained, never choose first silently", () => {
  const base = [
    { id: "a", start: 2, end: 3, text: "ああ" },
    { id: "b", start: 5, end: 6, text: "ああ" },
  ];
  const r = associateUtterance(probe, base, views());
  assert.equal(r.hypotheses[0].matches.length, 2);
  assert.equal(r.targetText, null);
});
test("reject repeated backend, foreign target and invalid timestamps", () => {
  const v = views();
  assert.throws(
    () => associateUtterance(probe, baseline, [v[0], v[0]]),
    /INVALID_VIEWS/,
  );
  assert.throws(
    () =>
      associateUtterance(
        probe,
        baseline,
        v.map((x) => ({ ...x, targetId: "other" })),
      ),
    /INVALID_VIEWS/,
  );
  assert.throws(
    () =>
      associateUtterance(
        probe,
        baseline,
        views([{ start: 1, end: 8, text: "ああ" }]),
      ),
    /INVALID_VIEWS/,
  );
});
test("narrow/wide plan is source-bound and capped at one target", () => {
  const p2 = {
    ...probe,
    id: "clip-2",
    start: 10,
    end: 15,
    targetStart: 12,
    targetEnd: 13,
  };
  const v2 = views().map((v) => ({
    ...v,
    targetId: p2.id,
    records: v.records.map((r) => ({ ...r, start: 10, end: 13 })),
  }));
  const r = planAssociation([p2, probe], baseline, [...v2, ...views()]);
  assert.equal(r.requests.length, 2);
  assert.equal(r.seconds, 7.5);
  assert.deepEqual(r.deferred, ["clip-2"]);
  assert.equal(r.requests[0].start, 3.25);
  assert.equal(r.referenceUsed, false);
});
test("same target cannot reserve duplicate requests", () => {
  assert.throws(
    () => planAssociation([probe, probe], baseline, views()),
    /DUPLICATE_TARGET/,
  );
});
test("CTC or VAD support alone cannot turn into display boundaries", () => {
  const r = summarizeUtteranceTiming([], [{ start: 4, end: 5 }]);
  assert.equal(r.displayBoundary, null);
  assert.equal(r.subtitleMutationAuthorized, false);
  assert.ok(r.blockers.includes("INDEPENDENT_UTTERANCE_BOUNDARIES_MISSING"));
});
test("stable 25ms CTC peaks remain emissions, not full utterance boundaries", () => {
  const requests = planAssociation([probe], baseline, views()).requests;
  const rows = requests.map((request, i) => {
    const start = 4.1 + i * 0.01,
      end = start + 0.025;
    return {
      request,
      requestId: request.id,
      pathStatus: "success",
      frameCountVerified: true,
      workerRequestVerified: true,
      predictedFrameCount: 100,
      expectedFrameCount: 100,
      target: {
        targetText: request.targetText,
        targetTextSha256: createHash("sha256")
          .update(request.targetText)
          .digest("hex"),
        targetEncodable: true,
        unknownTokenCount: 0,
        specialTokenCount: 0,
        blockers: [],
        tokenIds: [10],
        tokenPieces: [request.targetText],
      },
      tokenSpans: [
        {
          targetIndex: 0,
          tokenId: 10,
          startFrame: 10,
          endFrameExclusive: 11,
          startMediaGlobal: start,
          endMediaGlobal: end,
        },
      ],
      selectedBoundary: { start, end },
      startPinnedToWindowEdge: false,
      endPinnedToWindowEdge: false,
      blockers: [],
    };
  });
  const result = summarizeUtteranceTiming(rows, [{ start: 4, end: 5.4 }]);
  assert.equal(result.pair.stableWithin120ms, true);
  assert.equal(result.displayBoundary, null);
  assert.equal(result.subtitleMutationAuthorized, false);
  assert.ok(
    result.blockers.includes("INDEPENDENT_UTTERANCE_BOUNDARIES_MISSING"),
  );
});
test("authorization checked before reading or running anything", async () => {
  let calls = 0;
  await assert.rejects(
    runAssociation("/nonexistent", false, {
      run: () => {
        calls++;
      },
    }),
    /AUTHORIZATION/,
  );
  assert.equal(calls, 0);
});
test("exclusive reservation prevents retries and records zero ASR", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "utterance-test-"));
  try {
    await fs.writeFile(path.join(root, "plan.json"), "{}");
    const plan = { association: { requests: [{}, {}], seconds: 7.5 } };
    await assert.rejects(reserveAlignment(root, plan, false), /AUTHORIZATION/);
    await reserveAlignment(root, plan, true);
    await assert.rejects(reserveAlignment(root, plan, true), /EEXIST/);
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(root, "execution-reservation.json")),
      ).asrRequests,
      0,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
