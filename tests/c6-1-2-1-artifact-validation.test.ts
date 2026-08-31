import { beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dgram from "node:dgram";
import {
  type C6121Map,
  type C6121ProfileMetric,
  c6121MapSchema,
} from "@mvl/shared";
import { c6121Fixture } from "./helpers/c6121-fixture.js";
import { SHA } from "./helpers/c612-fixture.js";
import { c612Defined } from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import { rebindC6121CandidateLabels } from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-label-rebinding.js";
import { retrainC6121Oof } from "../packages/video-subtitler/src/consensus/evaluation-recovery/same-profile-oof-retrainer.js";
import { evaluateC6121Profiles } from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-profile-evaluation.js";
import { compareC6121Modes } from "../packages/video-subtitler/src/consensus/evaluation-recovery/supergroup-coverage.js";
import {
  verifyC6121Metrics,
  sameC6121,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-artifact-validator.js";
import { installC6121OfflineGuard } from "../packages/video-subtitler/src/consensus/evaluation-recovery/offline-runtime-guard.js";
import {
  fraction,
  validateC6121Artifact,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-policy.js";

describe("C6.1.2.1 independent artifact arithmetic validation", () => {
  it("classifies isolated machine and Gold vertices as no mapping, not ambiguous", () => {
    const f = c6121Fixture();
    const gold = [
      ...f.timing().slice(1),
      { id: "isolated-gold", start: 1000, end: 1001 },
    ];
    const map = f.graph(gold).map;
    const comparison = compareC6121Modes({
      frozen: f.frozen,
      gold,
      goldCharacters: new Map(gold.map((c) => [c.id, 1])),
      maps: [map, map, map],
      labels: [[], [], []],
      metrics: [[], [], []],
    });
    for (const mode of comparison.modes) {
      expect(mode.noMappingCount).toBe(2);
      expect(mode.ambiguousCount).toBe(0);
      expect(mode.stableCount + mode.ambiguousCount + mode.noMappingCount).toBe(
        mode.groupCount,
      );
    }
  });
  let map: C6121Map;
  let metrics: C6121ProfileMetric[];
  beforeAll(() => {
    const f = c6121Fixture();
    // One synthetic missing-Gold component exercises unknown accounting.
    map = f.graph(f.timing().slice(1)).map;
    const gold = f
      .timing()
      .slice(1)
      .map((c) => ({ ...c, text: "明日は晴れ" }));
    const labels = rebindC6121CandidateLabels(f.frozen, map, gold, SHA);
    const trained = retrainC6121Oof(f.frozen, map, labels, SHA);
    metrics = evaluateC6121Profiles({
      frozen: f.frozen,
      map,
      gold,
      labels: labels.labels.map((l) => l.label),
      rankings: trained.rankings.rows,
      decisions: trained.decisions.rows,
      track: "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    });
  }, 60000);
  it("independently recomputes all nine profile and fold summaries", () => {
    for (const metric of metrics)
      expect(() => verifyC6121Metrics(metric, map)).not.toThrow();
  });
  it.each([
    "map",
    "Gold-rematch",
    "machine-rematch",
    "unknown-zero",
    "gain",
    "count",
    "coverage",
    "fold",
  ])("rejects %s corruption", (mode) => {
    const metric = structuredClone(c612Defined(metrics[0]));
    const row = c612Defined(metric.groups.find((g) => g.evaluated));
    if (mode === "map") metric.supergroupMapHash = SHA;
    if (mode === "Gold-rematch") row.goldCueIds.push("fake-gold");
    if (mode === "machine-rematch") row.machineGroupIds.push("fake-machine");
    if (mode === "unknown-zero")
      c612Defined(metric.groups.find((g) => !g.evaluated)).normalizedGain = 0;
    if (mode === "gain") row.exactGain = c612Defined(row.exactGain) + 1;
    if (mode === "count") metric.improved++;
    if (mode === "coverage") metric.changedSupergroupCoverage.denominator++;
    if (mode === "fold") c612Defined(metric.folds[0]).unknown++;
    expect(() => verifyC6121Metrics(metric, map)).toThrow();
  });
  it("rejects unknown schema keys and semantic tampering", () => {
    expect(() =>
      c6121MapSchema.parse({ ...map, rawGoldText: "not allowed" }),
    ).toThrow();
    const copy = structuredClone(map);
    c612Defined(copy.groups[0]).machineCueIds.push("new-cue");
    expect(() => validateC6121Artifact(copy)).toThrow();
    expect(() => sameC6121(map, copy, "A_B_CHANGED")).toThrow("A_B_CHANGED");
  });
  it.each([
    [2, 1],
    [-1, 2],
    [1, 0],
    [0, -1],
    [NaN, 1],
    [1, Infinity],
  ])("rejects invalid fraction %s / %s", (n, d) => {
    expect(() => fraction(n, d)).toThrow("C6121_INVALID_COVERAGE_FRACTION");
  });
  it("retains null at zero denominator rather than inventing precision", () => {
    expect(fraction(0, 0)).toEqual({
      numerator: 0,
      denominator: 0,
      ratio: null,
    });
  });
});

it("C6.1.2.1 network guard blocks requests before transport and restores test state", () => {
  const original = {
    fetch: globalThis.fetch,
    request: http.request,
    get: http.get,
    secureRequest: https.request,
    secureGet: https.get,
    connect: Object.getOwnPropertyDescriptor(net.Socket.prototype, "connect"),
    socket: dgram.createSocket,
  };
  const environment = { ...process.env };
  try {
    const guard = installC6121OfflineGuard();
    for (const call of [
      () => fetch("https://example.invalid/"),
      () => http.get("http://example.invalid/"),
      () => https.request("https://example.invalid/"),
      () => new net.Socket().connect(9, "127.0.0.1"),
      () => dgram.createSocket("udp4"),
    ])
      expect(call).toThrow("C6121_RESEARCH_NETWORK_FORBIDDEN");
    expect(guard()).toEqual({
      attemptedNetworkRequests: 5,
      networkUsed: false,
    });
    expect(process.env.HF_HUB_OFFLINE).toBe("1");
  } finally {
    globalThis.fetch = original.fetch;
    http.request = original.request;
    http.get = original.get;
    https.request = original.secureRequest;
    https.get = original.secureGet;
    if (original.connect)
      Object.defineProperty(net.Socket.prototype, "connect", original.connect);
    dgram.createSocket = original.socket;
    for (const key of [
      "HF_HUB_OFFLINE",
      "TRANSFORMERS_OFFLINE",
      "HF_TOKEN",
      "HUGGING_FACE_HUB_TOKEN",
    ]) {
      if (environment[key] === undefined)
        Reflect.deleteProperty(process.env, key);
      else process.env[key] = environment[key];
    }
  }
});
