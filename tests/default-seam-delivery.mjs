/* global AbortController */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { refineDefaultDelivery } from "../scripts/lib/default-seam-delivery.mjs";

async function fixture(t) {
  const task = await fs.mkdtemp(path.join(os.tmpdir(), "default-seam-test-"));
  t.after(() => fs.rm(task, { recursive: true, force: true }));
  return {
    task,
    executionStatus: "completed",
    coverageScope: "full-audio",
    unresolvedCount: 0,
    aliasCount: 0,
    outputs: ["original.ass"],
  };
}
function mock(changedTargets = 1) {
  const calls = [];
  return {
    calls,
    deps: {
      safety: async () => ({ status: "NO_DETECTED_HIGH_RISK" }),
      prepare: async () => {
        calls.push("prepare");
        return { root: "/evidence", requests: 8, seconds: 70 };
      },
      execute: async (_root, options) => {
        assert.equal(options.authorize, true);
        calls.push("execute");
        return { newInference: 0 };
      },
      assemble: async () => {
        calls.push("assemble");
        return { root: "/candidate", changedTargets };
      },
      context: async () => {
        calls.push("context");
        return {
          root: "/shadow",
          additionalChangedTargets: 1,
          outputs: ["/shadow/machine-candidate.srt"],
          integrity: "passed",
        };
      },
    },
  };
}
test("fresh default runs bounded repair, prefers candidate and keeps original", async (t) => {
  const base = await fixture(t),
    m = mock();
  const result = await refineDefaultDelivery(base, { language: "ja" }, m.deps);
  assert.deepEqual(m.calls, ["prepare", "execute", "assemble", "context"]);
  assert.equal(result.defaultDelivery.inferenceRequests, 8);
  assert.equal(result.defaultDelivery.status, "refined");
  assert.equal(result.preferredOutputs.length, 3);
  assert.equal(result.defaultDelivery.acousticTimingVerified, false);
  assert.equal(result.defaultDelivery.humanValidated, false);
  assert.deepEqual(base.outputs, ["original.ass"]);
  const saved = JSON.parse(
    await fs.readFile(result.defaultDeliveryManifest, "utf8"),
  );
  assert.deepEqual(saved, result.defaultDelivery);
  await assert.rejects(
    refineDefaultDelivery(base, { language: "ja" }, m.deps),
    /EEXIST/u,
  );
  assert.equal(m.calls.length, 4);
  assert.equal(result.defaultDelivery.contextCandidate.mode, "shadow");
  assert.equal(
    result.defaultDelivery.contextCandidate.automaticPromotionAllowed,
    false,
  );
  assert(!result.preferredOutputs.some((p) => p.startsWith("/shadow/")));
  assert.match(
    await fs.readFile(result.outputIndex, "utf8"),
    /Context candidate machine-candidate.srt/u,
  );
});
test("newly introduced candidate content risk cannot escape the post-refinement gate", async (t) => {
  const base = await fixture(t),
    m = mock();
  let checks = 0;
  m.deps.safety = async () => ({
    status: ++checks === 1 ? "NO_DETECTED_HIGH_RISK" : "HOLD",
  });
  const result = await refineDefaultDelivery(base, { language: "ja" }, m.deps);
  assert.equal(checks, 2);
  assert.deepEqual(result.preferredOutputs, []);
  assert.equal(result.defaultDelivery.inspectableOutputs.length, 3);
  assert.equal(result.defaultDelivery.contentSafety.status, "HOLD");
});
test("unavailable safety blocks optional inference and preferred delivery", async (t) => {
  const base = await fixture(t),
    m = mock();
  m.deps.safety = async () => {
    throw Error("unreadable");
  };
  const result = await refineDefaultDelivery(base, { language: "ja" }, m.deps);
  assert.deepEqual(m.calls, []);
  assert.deepEqual(result.preferredOutputs, []);
  assert.match(result.defaultDelivery.contentSafety.reason, /unreadable/);
});
for (const [reason, overrides, options] of [
  ["disabled", {}, { enabled: false }],
  ["baseline-incomplete", { executionStatus: "partial" }, {}],
  ["partial-range", { coverageScope: "selected-source-range" }, {}],
  ["unresolved-baseline", { aliasCount: 1 }, {}],
  ["unresolved-baseline", { unresolvedCount: 1 }, {}],
  ["unvalidated-language", {}, { language: "en" }],
])
  test(`skip ${reason} never calls ASR`, async (t) => {
    const base = { ...(await fixture(t)), ...overrides },
      m = mock();
    const result = await refineDefaultDelivery(
      base,
      { language: "ja", ...options },
      m.deps,
    );
    assert.equal(result.defaultDelivery.reason, reason);
    assert.equal(result.defaultDelivery.inferenceRequests, 0);
    assert.deepEqual(result.preferredOutputs, [
      path.join(base.task, "original.ass"),
    ]);
    assert.deepEqual(m.calls, []);
  });
test("no target is zero inference", async (t) => {
  const base = await fixture(t),
    m = mock();
  m.deps.prepare = async () => ({ root: "/evidence", requests: 0, seconds: 0 });
  const result = await refineDefaultDelivery(base, { language: "ja" }, m.deps);
  assert.equal(result.defaultDelivery.reason, "no-eligible-seams");
  assert.deepEqual(m.calls, []);
});
test("abstention keeps baseline", async (t) => {
  const base = await fixture(t),
    m = mock(0);
  const result = await refineDefaultDelivery(base, { language: "ja" }, m.deps);
  assert.equal(result.defaultDelivery.status, "unchanged");
  assert.deepEqual(
    result.preferredOutputs,
    result.defaultDelivery.originalOutputs,
  );
});
test("failure preserves baseline and cannot silently retry", async (t) => {
  const base = await fixture(t),
    m = mock();
  m.deps.execute = async () => {
    m.calls.push("failed");
    throw Error("runtime failure");
  };
  const result = await refineDefaultDelivery(base, { language: "ja" }, m.deps);
  assert.equal(result.defaultDelivery.status, "failed");
  assert.equal(result.defaultDelivery.inferenceRequests, null);
  assert.deepEqual(
    result.preferredOutputs,
    result.defaultDelivery.originalOutputs,
  );
  await assert.rejects(
    refineDefaultDelivery(base, { language: "ja" }, m.deps),
    /EEXIST/u,
  );
  assert.deepEqual(m.calls, ["prepare", "failed"]);
});

test("cancel during execution preserves draft and closes this round", async (t) => {
  const base = await fixture(t),
    m = mock(),
    controller = new AbortController();
  m.deps.execute = async () => {
    controller.abort();
    controller.signal.throwIfAborted();
  };
  const result = await refineDefaultDelivery(
    base,
    { language: "ja", signal: controller.signal },
    m.deps,
  );
  assert.equal(result.defaultDelivery.status, "cancelled");
  assert.deepEqual(
    result.preferredOutputs,
    result.defaultDelivery.originalOutputs,
  );
  await assert.rejects(
    refineDefaultDelivery(base, { language: "ja" }, m.deps),
    /EEXIST/u,
  );
  assert.deepEqual(m.calls, ["prepare"]);
});

test("pre-cancelled request never reserves or calls a model", async (t) => {
  const base = await fixture(t),
    m = mock(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(
    refineDefaultDelivery(
      base,
      { language: "ja", signal: controller.signal },
      m.deps,
    ),
    /abort/iu,
  );
  assert.deepEqual(m.calls, []);
  assert.deepEqual(await fs.readdir(base.task), []);
});

test("partial transcript delivery points to the actual base index", async (t) => {
  const base = {
    ...(await fixture(t)),
    executionStatus: "partial",
    outputs: [],
  };
  base.outputIndex = path.join(base.task, "TRANSCRIPT_INDEX.md");
  const result = await refineDefaultDelivery(
    base,
    { language: "ja" },
    mock().deps,
  );
  assert.match(
    await fs.readFile(result.outputIndex, "utf8"),
    /\[TRANSCRIPT_INDEX.md\]\(TRANSCRIPT_INDEX.md\)/u,
  );
});

test("shadow failure preserves successful primary refinement with no retry", async (t) => {
  const base = await fixture(t),
    m = mock();
  m.deps.context = async () => {
    throw Error("evidence failure");
  };
  const r = await refineDefaultDelivery(base, { language: "ja" }, m.deps);
  assert.equal(r.defaultDelivery.status, "refined");
  assert.equal(r.defaultDelivery.contextCandidate.status, "failed");
  assert.equal(r.defaultDelivery.inferenceRequests, 8);
  assert(r.preferredOutputs.every((p) => p.startsWith("/candidate/")));
});

test("shadow can be disabled independently without altering primary budget", async (t) => {
  const base = await fixture(t),
    m = mock();
  const r = await refineDefaultDelivery(
    base,
    { language: "ja", contextSeams: false },
    m.deps,
  );
  assert.deepEqual(m.calls, ["prepare", "execute", "assemble"]);
  assert.equal(r.defaultDelivery.contextCandidate.reason, "disabled");
  assert.equal(r.defaultDelivery.inferenceRequests, 8);
});

test("shadow gain never promotes an abstained primary baseline", async (t) => {
  const base = await fixture(t),
    m = mock(0);
  const r = await refineDefaultDelivery(base, { language: "ja" }, m.deps);
  assert.equal(r.defaultDelivery.contextCandidate.status, "candidate");
  assert.deepEqual(r.preferredOutputs, r.defaultDelivery.originalOutputs);
  assert.deepEqual(m.calls, ["prepare", "execute", "assemble", "context"]);
});

test("cancellation during shadow preserves existing primary result and does not continue inference", async (t) => {
  const base = await fixture(t),
    m = mock(),
    controller = new AbortController();
  m.deps.context = async () => {
    controller.abort();
    controller.signal.throwIfAborted();
  };
  const r = await refineDefaultDelivery(
    base,
    { language: "ja", signal: controller.signal },
    m.deps,
  );
  assert.equal(r.defaultDelivery.status, "cancelled");
  assert.equal(r.defaultDelivery.contextCandidate.status, "cancelled");
  assert(r.preferredOutputs.every((p) => p.startsWith("/candidate/")));
  assert.equal(r.defaultDelivery.inferenceRequests, 8);
});
