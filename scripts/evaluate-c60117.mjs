import fs from "node:fs";
import path from "node:path";
import {
  parseAss,
  parseSrt,
  parseVtt,
} from "../packages/subtitle-core/dist/index.js";
import { normalizeC601GoldAssTimestamps } from "../packages/video-subtitler/dist/blind-acceptance/gold-evaluation.js";
import {
  evaluateQuality,
  qualityText,
} from "../packages/video-subtitler/dist/machine-quality/experimental-metrics.js";
import {
  referenceClipScope,
  transcriptMetric,
  aggregateTextMetrics,
} from "../packages/video-subtitler/dist/machine-quality/representative-evaluation.js";
import {
  read,
  write,
  oh,
  digest,
  verify,
  freeze,
  walk,
  VARIANTS,
  repo,
} from "./c60117-common.mjs";
const [phase, rootArg, a, b, c] = process.argv.slice(2),
  root = path.resolve(rootArg);
if (phase === "prepare-reference") {
  verify(root, "dataset-freeze.json");
  verify(root, "d-baseline-freeze.json");
  const dest = path.resolve(b);
  fs.mkdirSync(dest);
  // Data preparation is separate from generation; neither partition is returned
  // to a generator. C reference is sealed here, not displayed to development.
  const firstReadAt = new Date().toISOString(),
    bytes = fs.readFileSync(a);
  const normalized = normalizeC601GoldAssTimestamps(bytes.toString());
  const ref = parseAss(normalized.content).map((r, i) => ({
    ...r,
    id: "reference-" + i,
  }));
  const dataset = read(path.join(root, "dataset-selection.json"));
  for (const partition of ["D", "C"]) {
    const clips = dataset.clips
      .filter((x) => x.partition === partition)
      .map((clip) => ({ clip, ...referenceClipScope(clip, ref) }));
    write(path.join(dest, partition + ".reference.json"), {
      version: "c60117-reference-scope-v1",
      partition,
      sourceGoldHash: digest(bytes),
      datasetHash: oh(dataset),
      firstDataPrepReadAt: firstReadAt,
      normalizationCount: normalized.replacementCount,
      clips,
    });
  }
  freeze(dest, "reference-freeze.json", walk(dest));
  console.log(
    "Independent D/C reference scopes sealed; no reference text printed",
  );
} else if (["evaluate-development", "evaluate-confirmation"].includes(phase)) {
  const runName = a,
    referenceFile = path.resolve(b),
    dest = path.resolve(c),
    partition = phase === "evaluate-development" ? "D" : "C";
  verify(root, runName + "-freeze.json");
  verify(root, "evidence-" + partition + "-freeze.json");
  if (partition === "C") {
    verify(root, "final-code-config-freeze.json");
    for (const [p, h] of Object.entries(
      read(path.join(root, "final-code-identity.json")),
    ))
      if (digest(fs.readFileSync(path.join(repo, p))) !== h)
        throw Error("Final code changed before C evaluation");
    // Reserve the single evaluation before reading C. A crash is not a license
    // to alter configuration or run a new confirmation selection.
    write(path.join(root, "confirmation-evaluation-once.json"), {
      runName,
      startedAt: new Date().toISOString(),
    });
  }
  fs.mkdirSync(dest);
  verify(path.dirname(referenceFile), "reference-freeze.json");
  const scope = read(referenceFile),
    dataset = read(path.join(root, "dataset-selection.json"));
  if (scope.partition !== partition || scope.datasetHash !== oh(dataset))
    throw Error("Reference scope mismatch");
  const rows = [];
  for (const s of scope.clips) {
    const byVariant = {},
      cuesByVariant = {};
    for (const variant of VARIANTS) {
      const folder = path.join(root, runName, s.clip.id, variant),
        pkg = read(path.join(folder, "subtitle-package.needs-review.json"));
      const formats = {};
      for (const [ext, parser] of Object.entries({
        srt: parseSrt,
        ass: parseAss,
        vtt: parseVtt,
      })) {
        const cues = parser(
          fs.readFileSync(
            path.join(folder, "machine-candidate." + ext),
            "utf8",
          ),
        ).map((q, i) => ({ ...q, id: pkg.cues[i].id }));
        const m = evaluateQuality(cues, s.units);
        m.normalized.distance =
          m.normalized.S + m.normalized.D + m.normalized.I;
        m.exact.distance = m.exact.S + m.exact.D + m.exact.I;
        formats[ext] = m;
        if (ext === "srt") cuesByVariant[variant] = cues;
      }
      const trace = read(path.join(folder, "stage-trace.json"));
      byVariant[variant] = {
        ...formats.srt,
        formats,
        stages: trace.map((t) => ({
          stageName: t.stageName,
          inputHash: t.inputHash,
          outputHash: t.outputHash,
          inputCharacters: t.inputCharacters,
          outputCharacters: t.outputCharacters,
          changedOperations: t.operations.filter((o) => o.operation !== "KEEP"),
          before: evaluateQuality(t.input, s.units).normalized,
          after: evaluateQuality(t.output, s.units).normalized,
        })),
      };
    }
    const auxRaw = read(path.join(root, "evidence", s.clip.id + "-reazon.json"))
      .raw.results[0];
    const aux = {
      text: auxRaw.text,
      normalized: transcriptMetric(
        auxRaw.text,
        s.units.map((r) => r.text).join(""),
      ),
      exact: transcriptMetric(
        auxRaw.text,
        s.units.map((r) => r.text).join(""),
        false,
      ),
      timing: null,
      timingReason: "POINT_ONLY_NO_INTERVAL_CAPABILITY",
    };
    const p0 = byVariant[VARIANTS[0]],
      p1 = byVariant[VARIANTS[1]],
      p2 = byVariant[VARIANTS[2]];
    const stageLoss = p1.stages.filter(
      (t) =>
        t.outputCharacters < t.inputCharacters &&
        t.after.S + t.after.D + t.after.I >
          t.before.S + t.before.D + t.before.I,
    );
    const causes = [];
    if (!s.preciseEligible)
      causes.push({
        tag: "REFERENCE_OR_MATCHING_AMBIGUITY",
        evidence: s.boundaryCrossingIds,
      });
    if (p0.normalized.distance > 0)
      causes.push({
        tag: "PRIMARY_TEXT_ERROR",
        evidence:
          "fresh P0 versus all intersecting reference units; reference-relative, not independent listening",
      });
    if (stageLoss.length)
      causes.push({
        tag: "DOWNSTREAM_CONTENT_LOSS",
        evidence: stageLoss.map((t) => ({
          stage: t.stageName,
          inputHash: t.inputHash,
          outputHash: t.outputHash,
          operations: t.changedOperations,
        })),
      });
    if (aux.normalized.distance > 0 && p0.normalized.distance > 0)
      causes.push({
        tag: "POOL_INSUFFICIENT",
        evidence:
          "neither whole-clip candidate is reference-exact; does not prove no span-level donor",
      });
    if (!causes.length)
      causes.push({
        tag: "UNKNOWN",
        evidence: "no attributable error under this reference scope",
      });
    const pairs = p1.matches
      .filter((g) => g.timingEligible)
      .flatMap((g) => {
        const q = p2.matches.find(
          (q) =>
            q.timingEligible &&
            oh(q.referenceIds) === oh(g.referenceIds) &&
            oh(q.hypothesisIds) === oh(g.hypothesisIds),
        );
        return q
          ? [
              {
                referenceIds: g.referenceIds,
                hypothesisIds: g.hypothesisIds,
                startDelta: q.startError - g.startError,
                endDelta: q.endError - g.endError,
              },
            ]
          : [];
      });
    const changed = VARIANTS.slice(1).map((v) => ({
      variant: v,
      textChanged:
        qualityText(cuesByVariant[v].map((q) => q.text).join("")) !==
        qualityText(cuesByVariant[VARIANTS[0]].map((q) => q.text).join("")),
      cueDelta: cuesByVariant[v].length - cuesByVariant[VARIANTS[0]].length,
    }));
    rows.push({
      clip: s.clip,
      preciseEligible: s.preciseEligible,
      scopeReason: s.reason,
      boundaryCrossingIds: s.boundaryCrossingIds,
      reference: s.units,
      byVariant,
      aux,
      causes,
      changed,
      pairing: {
        sameSupport: pairs,
        changedMatchingGroups: p2.timing.matchedGroups - pairs.length,
      },
      oracle: {
        scope:
          "whole comparable clip candidate minimum; evaluator only; not composited or emitted",
        normalizedCER: s.preciseEligible
          ? Math.min(p0.normalized.CER, aux.normalized.CER)
          : null,
      },
    });
  }
  const aggregates = {};
  for (const variant of [...VARIANTS, "AUX-second-ASR"]) {
    const get = (r, k) =>
      variant === "AUX-second-ASR" ? r.aux[k] : r.byVariant[variant][k];
    const agg = (rs) =>
      Object.fromEntries(
        ["exact", "normalized"].map((k) => [
          k,
          aggregateTextMetrics(rs.map((r) => get(r, k))),
        ]),
      );
    aggregates[variant] = {
      primaryPrecise: agg(rows.filter((r) => r.preciseEligible)),
      allClipsApproximate: agg(rows),
      strata: Object.fromEntries(
        ["coverage", "machine-risk", "low-risk"].map((s) => [
          s,
          {
            primaryPrecise: agg(
              rows.filter((r) => r.preciseEligible && r.clip.stratum === s),
            ),
            allClipsApproximate: agg(rows.filter((r) => r.clip.stratum === s)),
          },
        ]),
      ),
    };
  }
  write(path.join(dest, "metrics.json"), {
    version: "c60117-evaluation-v1",
    partition,
    claim:
      partition === "C"
        ? "IN_EPISODE_FROZEN_CONFIRMATION"
        : "DEVELOPMENT_KNOWN",
    runName,
    referenceHash: digest(fs.readFileSync(referenceFile)),
    evaluatedAt: new Date().toISOString(),
    ambiguousOrEmptyClips: rows.filter((r) => !r.preciseEligible).length,
    rows,
    aggregates,
    heldout: "HELDOUT_VALIDATION_NOT_RUN",
    machineOnlyReleaseAuthorized: false,
    defaultPromotionAuthorized: false,
  });
  freeze(dest, "evaluation-freeze.json", walk(dest));
  console.log(
    JSON.stringify(
      {
        partition,
        preciseClips: rows.filter((r) => r.preciseEligible).length,
        ambiguous: rows.filter((r) => !r.preciseEligible).length,
        aggregates,
      },
      null,
      2,
    ),
  );
} else
  throw Error(
    "Usage: evaluate-c60117.mjs prepare-reference run Gold.ass isolated-dir | evaluate-development|evaluate-confirmation run runName partition.reference.json new-evaluation-dir",
  );
