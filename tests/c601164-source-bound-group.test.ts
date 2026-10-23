import { it, expect } from "vitest";
import { groupFixture } from "./helpers/c601164-group-fixture.js";
import { requireValue } from "./helpers/c601163-stored-fixture.js";
import { consumeStoredWhisper } from "../packages/video-subtitler/src/machine-quality/stored-token-span.js";
import {
  buildGroupPatch,
  applySourceGroups,
  prepareSourceGroup,
  consumeGroupAlignment,
  sourceGroupSchema,
  groupPatchSchema,
} from "../packages/video-subtitler/src/machine-quality/source-bound-group.js";
import { objectHash } from "../packages/video-subtitler/src/machine-quality/experimental-profile.js";
const f = () => groupFixture();
it("allows complete native source units outside the old core but inside physical envelope", () => {
  const x = f(),
    p = buildGroupPatch(x.group, x.observation, "native");
  expect(p.action).toBe("REPLACE_SOURCE_BOUND_UTTERANCE_GROUP");
  expect(p.newCues).toHaveLength(2);
  expect(requireValue(p.newCues[0]).start).toBeLessThan(x.c.core.start);
  expect(p.risks).toContain("CROSS_WINDOW_TEXT_DISAGREEMENT_DIAGNOSTIC");
});
it("conditionally aligned symbols reach the same candidate without lexical votes", () => {
  const x = f(),
    p = buildGroupPatch(x.group, x.observation, "aligned", x.alignment);
  expect(p.action).toBe("REPLACE_SOURCE_BOUND_UTTERANCE_GROUP");
  expect(p.lexicalTruthValidated).toBe(false);
  expect(p.newCues.map((c) => c.text).join("")).toBe(x.alignment.sourceText);
  expect(p.evidenceKind).toBe("ALIGNER_ESTIMATED_INTERVAL");
});
it("atomically applies N-to-M and is idempotent", () => {
  const x = f(),
    p = buildGroupPatch(x.group, x.observation, "native");
  const once = applySourceGroups(x.stage, [p], true);
  expect(once.applied).toHaveLength(1);
  expect(once.cues).toHaveLength(2);
  expect(applySourceGroups(once.cues, [p], true).cues).toEqual(once.cues);
});
it("disabled application preserves exact input even with actionable proposals", () => {
  const x = f(),
    p = buildGroupPatch(x.group, x.observation, "native");
  expect(applySourceGroups(x.stage, [p], false).cues).toEqual(x.stage);
});
it("stale whole-stage, member and protected hashes cannot half-delete a group", () => {
  const x = f(),
    p = buildGroupPatch(x.group, x.observation, "native");
  const old = objectHash(x.stage);
  expect(() =>
    applySourceGroups(
      x.stage.map((c) => ({ ...c, text: c.text + "変更" })),
      [p],
      true,
    ),
  ).toThrow();
  requireValue(p.oldCues[0]).hash = "a".repeat(64);
  expect(() => applySourceGroups(x.stage, [p], true)).toThrow();
  expect(objectHash(x.stage)).toBe(old);
});
it("does not silently select W1 when W2 is invalid", () => {
  const x = f();
  x.observation.windowId = "w1";
  expect(buildGroupPatch(x.group, x.observation, "native").action).toBe(
    "ABSTAIN_KEEP_STAGE_INPUT",
  );
  expect(() => prepareSourceGroup(x.c, x.stage, [x.observation])).toThrow();
});
it("retains edge-zero lexical text and requires aligned mapping to recover it", () => {
  const x = f(),
    t = requireValue(requireValue(x.full.transcription[1]).tokens[1]);
  t.offsets.from = t.offsets.to;
  const o = consumeStoredWhisper(x.full, x.input),
    g = prepareSourceGroup(x.c, x.stage, [o]);
  expect(buildGroupPatch(g, o, "native").reasons).toContain(
    "NATIVE_UNANCHORED_LEXICAL_EDGE",
  );
  expect(
    buildGroupPatch(g, o, "aligned", consumeGroupAlignment(o, x.raw)).action,
  ).toBe("REPLACE_SOURCE_BOUND_UTTERANCE_GROUP");
});
it("rejects missing full aligned symbols rather than retaining a partial phrase", () => {
  const x = f();
  x.raw.pieces.pop();
  const a = consumeGroupAlignment(x.observation, x.raw);
  expect(a.mappingComplete).toBe(false);
  expect(buildGroupPatch(x.group, x.observation, "aligned", a).action).toBe(
    "ABSTAIN_KEEP_STAGE_INPUT",
  );
});
it("rejects physical escape and wrong-source alignment", () => {
  const x = f();
  requireValue(x.raw.pieces[0]).start = x.observation.window.start - 1;
  expect(consumeGroupAlignment(x.observation, x.raw).mappingComplete).toBe(
    false,
  );
  x.alignment.sourceObservationHash = "f".repeat(64);
  expect(
    buildGroupPatch(x.group, x.observation, "aligned", x.alignment).action,
  ).toBe("ABSTAIN_KEEP_STAGE_INPUT");
});
it("protects unrelated neighbors even when they are physically inside the WAV", () => {
  const x = f(),
    neighbor = {
      ...requireValue(x.stage[0]),
      id: "unrelated",
      start: x.c.core.start + 4,
      end: x.c.core.start + 5,
      text: "別の声。",
      speaker: "different-speaker",
      textAudit: undefined,
    };
  const stage = [...x.stage, neighbor],
    g = prepareSourceGroup(x.c, stage, [x.observation]);
  expect(g.protectedNeighborCueIds).toContain(neighbor.id);
  expect(buildGroupPatch(g, x.observation, "native").reasons).toContain(
    "PROTECTED_NEIGHBOR_CONFLICT",
  );
});
it("overlapping transactions both abstain, without implicit merging", () => {
  const x = f(),
    p = buildGroupPatch(x.group, x.observation, "native"),
    q = { ...p, id: "other" };
  const r = applySourceGroups(x.stage, [p, q], true);
  expect(r.applied).toHaveLength(0);
  expect(r.cues).toEqual(x.stage);
  expect(r.blocked).toHaveLength(2);
});
it("strict new schemas reject unknown control fields", () => {
  const x = f();
  expect(
    sourceGroupSchema.safeParse({ ...x.group, unsafe: true }).success,
  ).toBe(false);
  expect(
    groupPatchSchema.safeParse({
      ...buildGroupPatch(x.group, x.observation, "native"),
      goldText: "bad",
    }).success,
  ).toBe(false);
});
