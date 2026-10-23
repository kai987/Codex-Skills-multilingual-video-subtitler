import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { observeLocalRecoveryPlan } from "../scripts/lib/local-recovery-context-plan.mjs";
import { planLocalRecovery } from "../scripts/lib/vad-local-recovery.mjs";
import {
  recoveryEntry,
  verifyPlanning,
} from "../scripts/subtitle-tool-vad-recovery-entry.mjs";

function fixture() {
  const rows = Array.from({ length: 9 }, (_, i) => ({
    id: `synthetic-${i}`,
    targetStart: 20 + i * 10,
    targetEnd: 21 + i * 10,
    playbackStart: 19 + i * 10,
    playbackEnd: 22 + i * 10,
    state: i === 8 ? "unsupported" : "supported",
  }));
  return {
    triage: { rows },
    baseline: [{ id: "host", start: 19, end: 22, text: "ここに言葉がある" }],
    duration: 120,
    observations: rows.map((r) => ({
      id: r.id,
      sourceIntervals:
        r.state === "unsupported"
          ? []
          : [{ start: r.targetStart, end: r.targetEnd }],
    })),
  };
}
test("uses exact legacy planner order, crops, budgets and deferred list", () => {
  const x = fixture(),
    before = JSON.stringify(x),
    r = observeLocalRecoveryPlan(x);
  assert.deepEqual(
    r.selected,
    planLocalRecovery(x.triage, x.baseline, x.duration),
  );
  assert.equal(r.selectedTargets, 4);
  assert.equal(r.deferredTargets, 4);
  assert.equal(r.plannedRequests, 8);
  assert.equal(r.plannedAudioSeconds, 40);
  assert.equal(r.requestsSaved, 0);
  assert.equal(r.rows.length, 9);
  assert.equal(JSON.stringify(x), before);
});
test("deferred embedded responses stay retained and are not automatically suppressed", () => {
  const r = observeLocalRecoveryPlan(fixture());
  const host = r.rows.find((t) => t.id === "synthetic-0");
  assert.equal(host.scheduling, "deferred");
  assert.equal(host.purpose, "check-existing-cue-and-embedded-response");
  assert.equal(host.missingEmbeddedResponseStillPossible, true);
  assert.equal(host.suppressionAuthorized, false);
  assert.equal(host.retained, true);
});
test("request purposes distinguish between-cue from boundary-crossing checks", () => {
  const x = fixture();
  x.baseline.push(
    { id: "left", start: 28, end: 30, text: "左" },
    { id: "right", start: 31, end: 33, text: "右" },
    { id: "edge", start: 38, end: 40, text: "先行" },
  );
  x.observations[2].sourceIntervals[0].start = 39.5;
  const r = observeLocalRecoveryPlan(x);
  assert.equal(r.rows[1].purpose, "associate-neighboring-utterances");
  assert.equal(r.rows[2].purpose, "check-continuation-and-extra-response");
  assert(
    r.requests
      .filter((q) => q.targetId === "synthetic-1")
      .every((q) => q.purpose === r.rows[1].purpose && !q.dispatchAuthorized),
  );
});
test("planning has no future text consensus and does not read labels", () => {
  const x = fixture(),
    before = observeLocalRecoveryPlan(x);
  x.labels = [{ id: "synthetic-0", text: "人工稿" }];
  x.views = [{ text: "未来の ASR" }];
  x.triage.rows.forEach((r) => {
    r.humanLabel = "noise";
  });
  assert.deepEqual(observeLocalRecoveryPlan(x), before);
  assert.equal(before.rows[1].route, "uncovered-unlocalized-review");
  assert.equal(before.labelsUsed, false);
});
test("all unsupported targets are retained with zero planned requests", () => {
  const x = fixture();
  x.triage.rows.forEach((r) => {
    r.state = "unsupported";
  });
  x.observations.forEach((r) => {
    r.sourceIntervals = [];
  });
  const r = observeLocalRecoveryPlan(x);
  assert.equal(r.plannedRequests, 0);
  assert.equal(r.rows.length, 9);
  assert(r.rows.every((c) => c.retained && c.reviewRequired));
});
test("invalid unsupported times, duplicate targets and missing observations fail", () => {
  const a = fixture();
  a.triage.rows[8].targetStart = NaN;
  assert.throws(() => observeLocalRecoveryPlan(a), /INVALID_TARGET/);
  const b = fixture();
  b.triage.rows[1].id = b.triage.rows[0].id;
  assert.throws(() => observeLocalRecoveryPlan(b), /DUPLICATE_TARGET/);
  const c = fixture();
  c.observations.pop();
  assert.throws(() => observeLocalRecoveryPlan(c), /OBSERVATION_INVENTORY/);
});

async function diskFixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "context-plan-test-")),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "task"),
    triage = path.join(root, "triage");
  await fs.mkdir(source);
  await fs.mkdir(triage);
  const x = fixture();
  const write = (p, v) => fs.writeFile(p, JSON.stringify(v));
  await write(path.join(triage, "triage.json"), x.triage);
  await write(path.join(triage, "triage-freeze.json"), { synthetic: true });
  await write(path.join(source, "plan.json"), {
    spec: { triage },
    selected: planLocalRecovery(x.triage, x.baseline, x.duration),
    baseline: x.baseline,
    duration: x.duration,
    vadObservations: x.observations,
    referenceUsed: false,
    labelsUsed: false,
  });
  await write(path.join(source, "plan-freeze.json"), { synthetic: true });
  const spec = path.join(root, "spec.json");
  await write(spec, {});
  return { root, source, spec };
}
test("prepare attaches observation automatically before a future authorized run", async (t) => {
  const x = await diskFixture(t);
  let calls = 0;
  const result = await recoveryEntry(["prepare", x.spec, x.root], {
    prepareRecovery: async () => ({ root: x.source, requests: 8 }),
    runRecovery: async () => {
      throw Error("MUST_NOT_DISPATCH");
    },
  });
  assert.equal(result.context.integrity, "passed");
  assert.equal(result.context.actualNewRequests, 0);
  await recoveryEntry(["run", x.source, "--authorize-local"], {
    runRecovery: async (root, authorized) => {
      assert.equal(root, x.source);
      assert.equal(authorized, true);
      calls++;
      return {};
    },
  });
  assert.equal(calls, 1); // stub only; no process/model
});
test("tampered observation blocks dispatch; incomplete sidecar is not ignored", async (t) => {
  const x = await diskFixture(t);
  await recoveryEntry(["prepare", x.spec, x.root], {
    prepareRecovery: async () => ({ root: x.source }),
  });
  await fs.appendFile(
    path.join(x.source, "context-planning/planning.json"),
    " ",
  );
  await assert.rejects(
    recoveryEntry(["run", x.source, "--authorize-local"], {
      runRecovery: async () => {
        throw Error("MUST_NOT_DISPATCH");
      },
    }),
    /OUTPUT_CHANGED/,
  );
  await fs.rename(
    path.join(x.source, "context-planning/freeze.json"),
    path.join(x.root, "saved-freeze.json"),
  );
  await assert.rejects(
    recoveryEntry(["run", x.source, "--authorize-local"], {}),
    /ENOENT/,
  );
});
test("old tasks stay compatible; missing authorization never delegates", async (t) => {
  const x = await diskFixture(t);
  const r = await recoveryEntry(["verify", x.source], {
    verifyRecovery: async () => ({ integrity: "passed" }),
  });
  assert.equal(r.context.mode, "legacy-without-context-observation");
  assert.deepEqual((await fs.readdir(x.source)).sort(), [
    "plan-freeze.json",
    "plan.json",
  ]);
  await assert.rejects(recoveryEntry(["run", x.source], {}), /authorize-local/);
  await assert.rejects(
    recoveryEntry(["run", x.source, "--authorize-local", "extra"], {}),
    /Invalid arguments/,
  );
});
test("offline observation preserves source, replays deterministically and detects source changes", async (t) => {
  const x = await diskFixture(t);
  const before = await fs.readFile(path.join(x.source, "plan.json"));
  const r = await recoveryEntry(
    ["observe", x.source, path.join(x.root, "out")],
    {
      verifyRecovery: async () => ({ integrity: "passed" }),
      runRecovery: async () => {
        throw Error("MUST_NOT_DISPATCH");
      },
    },
  );
  assert.equal((await verifyPlanning(r.root)).integrity, "passed");
  assert.deepEqual(await fs.readFile(path.join(x.source, "plan.json")), before);
  assert.deepEqual((await fs.readdir(x.source)).sort(), [
    "plan-freeze.json",
    "plan.json",
  ]);
  await fs.appendFile(path.join(x.source, "plan.json"), " ");
  await assert.rejects(verifyPlanning(r.root), /SOURCE_CHANGED/);
});
test("observe refuses output under historical task before validation or mutation", async (t) => {
  const x = await diskFixture(t);
  await assert.rejects(
    recoveryEntry(["observe", x.source, path.join(x.source, "nested")], {
      verifyRecovery: async () => {
        throw Error("MUST_NOT_READ");
      },
    }),
    /OUTPUT_INSIDE_SOURCE/,
  );
});
