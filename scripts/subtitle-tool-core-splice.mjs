/** Offline suggestion-only assembly. No provider execution or reference input. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { statusBounded } from "./lib/bounded-product.mjs";
import { fileHash, checkFiles, inventory } from "./lib/local-asr-run.mjs";
import { verifyLocalCheck } from "./subtitle-tool-local-acoustic-check.mjs";
import {
  proposeCoreSplice,
  coreSplicePolicy,
} from "./lib/core-splice-policy.mjs";
import {
  mapRaw,
  serializeRecords,
  formats,
} from "../packages/video-subtitler/dist/standalone/bounded.js";
import { safePath } from "../packages/video-subtitler/dist/standalone/recovery.js";

const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const digest = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const save = (p, v) =>
  fs.writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    !relative ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};

export async function loadCoreInput(inputRoot) {
  inputRoot = path.resolve(inputRoot);
  await safePath(inputRoot);
  const freezePath = path.join(inputRoot, "machine-freeze.json");
  await safePath(freezePath);
  const freeze = await json(freezePath),
    freezeHash = await fileHash(freezePath);
  const required = [
    "plan.json",
    "plan-freeze.json",
    "machine-observations.json",
  ];
  if (
    freeze.version !== "bounded-local-acoustic-freeze-v1" ||
    !Array.isArray(freeze.files)
  )
    throw Error("INVALID_MACHINE_FREEZE");
  for (const file of freeze.files) {
    if (
      typeof file.path !== "string" ||
      path.isAbsolute(file.path) ||
      file.path.split(/[\\/]/u).includes("..")
    )
      throw Error("UNSAFE_FROZEN_PATH");
    await safePath(path.join(inputRoot, file.path));
  }
  if (required.some((n) => !freeze.files.some((f) => f.path === n)))
    throw Error("INCOMPLETE_MACHINE_FREEZE");
  await checkFiles(inputRoot, freeze.files);
  const plan = await verifyLocalCheck(inputRoot); // Does not inspect external runtime/model paths.
  if (
    freeze.planHash !== (await fileHash(path.join(inputRoot, "plan.json"))) ||
    plan.referenceUsedForGeneration !== false ||
    plan.automaticApplication !== false
  )
    throw Error("INPUT_LINEAGE_INVALID");
  const targets = [];
  for (const target of plan.targets) {
    const sources = plan.sourceTasks.filter((s) => s.id === target.id);
    if (sources.length !== 1) throw Error("BASELINE_BINDING_AMBIGUOUS");
    const task = path.resolve(sources[0].task);
    await safePath(task);
    for (const name of [
      "bounded-task.json",
      "bounded-plan.json",
      "mapped-records.json",
      "boundary-decisions.json",
      "audio.wav",
    ]) {
      const filename = path.join(task, name),
        binding = plan.sourceFiles.filter((f) => f.path === filename);
      await safePath(filename);
      if (
        binding.length === 0 ||
        binding.some((b) => b.sha256 !== binding[0].sha256) ||
        (await fileHash(filename)) !== binding[0].sha256
      )
        throw Error("BASELINE_CHANGED");
    }
    const state = await statusBounded(task);
    if (
      state.inputHash !== plan.sourceHash ||
      state.plan.audioHash !== plan.sourceAudioHash
    )
      throw Error("SOURCE_IDENTITY_MISMATCH");
    const mapped = await json(path.join(task, "mapped-records.json"));
    if (digest(mapped.effectiveRange) !== digest(state.effectiveRange))
      throw Error("BASELINE_RANGE_MISMATCH");
    const ids = target.records.map((r) => r.recordId);
    for (const selected of target.records) {
      const r = mapped.records.find((r) => r.recordId === selected.recordId);
      if (
        !r ||
        ["text", "sourceStart", "sourceEnd"].some(
          (key) => r[key] !== selected[key],
        )
      )
        throw Error("TARGET_BASELINE_MISMATCH");
    }
    const boundary = await json(path.join(task, "boundary-decisions.json"));
    if (
      target.kind === "seam" &&
      !boundary.decisions.some(
        (d) =>
          d.leftId === ids[0] &&
          d.rightId === ids[1] &&
          d.status === "BOUNDARY_AMBIGUITY",
      )
    )
      throw Error("UNRESOLVED_SEAM_REQUIRED");
    const views = [];
    for (const request of plan.requests.filter(
      (r) => r.targetId === target.id && r.backend === "whisper",
    )) {
      for (const name of [
        "raw.srt",
        "raw.json",
        "mapped-records.json",
        "input.wav",
        "reserved.json",
        "receipt.json",
      ])
        if (!freeze.files.some((f) => f.path === `${request.id}/${name}`))
          throw Error("UNREGISTERED_LOCAL_EVIDENCE");
      const dir = path.join(inputRoot, request.id),
        mappedView = await json(path.join(dir, "mapped-records.json"));
      const raw = await json(path.join(dir, "raw.json"));
      const receipt = await json(path.join(dir, "receipt.json"));
      const reserved = await json(path.join(dir, "reserved.json"));
      if (
        digest(mappedView.request) !== digest(request) ||
        digest(reserved.request) !== digest(request) ||
        receipt.exitCode !== 0 ||
        receipt.signal !== null
      )
        throw Error("LOCAL_REQUEST_BINDING_INVALID");
      const chunk = {
        id: "chunk-0001",
        index: 0,
        coreStart: 0,
        coreEnd: request.frames,
        inputStart: 0,
        inputEnd: request.frames,
        boundary: "tail",
        candidateSamples: [],
      };
      const rawPath = path.join(dir, "raw.srt");
      const records = mapRaw(
        await fs.readFile(rawPath, "utf8"),
        await fileHash(rawPath),
        chunk,
        16000,
        request.start,
        request.end,
        request.id,
      );
      if (
        digest(records) !== digest(mappedView.records) ||
        !Array.isArray(raw.transcription) ||
        raw.transcription.length !== records.length ||
        raw.transcription.some(
          (s, i) =>
            typeof s.text !== "string" ||
            s.text.trim() !== records[i].text.trim() ||
            !Number.isSafeInteger(s.offsets?.from) ||
            !Number.isSafeInteger(s.offsets?.to) ||
            s.offsets.from !== Math.round(records[i].localStart * 1000) ||
            s.offsets.to !== Math.round(records[i].localEnd * 1000),
        )
      )
        throw Error("LOCAL_RAW_MAPPING_CHANGED");
      views.push({ request, records });
    }
    targets.push({
      id: target.id,
      kind: target.kind,
      task,
      effectiveRange: state.effectiveRange,
      records: mapped.records,
      targetRecordIds: ids,
      views,
    });
  }
  return { inputRoot, freezeHash, freeze, plan, targets };
}

export function projectCoreTargets(input) {
  return input.targets.map((target) => {
    const decision =
      target.kind === "seam"
        ? proposeCoreSplice({
            targetId: target.id,
            records: target.records,
            targetRecordIds: target.targetRecordIds,
            views: target.views,
          })
        : {
            status: "ABSTAIN",
            reasons: ["CTC_EMISSION_IS_NOT_DISPLAY_BOUNDARY"],
            proposal: null,
          };
    const candidate = globalThis.structuredClone(target.records);
    let insertedRecordId = null;
    if (decision.status === "PROPOSED") {
      const p = decision.proposal;
      const i = candidate.findIndex((r) => r.recordId === p.sourceRecordIds[0]);
      if (
        i < 0 ||
        candidate[i + 1]?.recordId !== p.sourceRecordIds[1] ||
        p.sourceRecordIds.length !== 2
      )
        throw Error("NON_ATOMIC_CORE_PROPOSAL");
      insertedRecordId = `core-proposal-${digest(p).slice(0, 24)}`;
      candidate.splice(i, 2, {
        recordId: insertedRecordId,
        sourceStart: p.sourceStart,
        sourceEnd: p.sourceEnd,
        text: p.text,
        issues: [],
        provenance: {
          kind: "core-splice-suggestion-only",
          sourceRecordIds: p.sourceRecordIds,
          donorRequestId: p.donorRequestId,
          donorRecordIds: p.donorRecordIds,
          timing: "old-union-envelope-not-realigned",
        },
      });
    }
    const changed =
      decision.status === "PROPOSED"
        ? new Set(decision.proposal.sourceRecordIds)
        : new Set();
    const protectedBefore = target.records.filter(
      (r) => !changed.has(r.recordId),
    );
    const protectedAfter = candidate.filter(
      (r) => r.recordId !== insertedRecordId,
    );
    if (digest(protectedBefore) !== digest(protectedAfter))
      throw Error("PROTECTED_CONTEXT_MUTATED");
    if (candidate.some((r) => r.issues.length))
      throw Error("UNRESOLVED_BASELINE_CANNOT_EXPORT_AS_COMPLETE");
    return {
      id: target.id,
      kind: target.kind,
      effectiveRange: target.effectiveRange,
      baseline: target.records,
      candidate,
      decision,
      insertedRecordId,
      integrity: {
        protectedRecordCount: protectedBefore.length,
        protectedContextHash: digest(protectedBefore),
        protectedContextUnchanged: true,
        baselineCueCount: target.records.length,
        candidateCueCount: candidate.length,
        originalFilesMutated: false,
        proposalOnly: true,
        automaticApplication: false,
        textChanged:
          digest(target.records.map((r) => r.text)) !==
          digest(candidate.map((r) => r.text)),
        timingStructureChanged:
          digest(target.records.map((r) => [r.sourceStart, r.sourceEnd])) !==
          digest(candidate.map((r) => [r.sourceStart, r.sourceEnd])),
        oldOuterEnvelopePreserved: true,
        displayBoundaryValidated: false,
        baselineHash: digest(target.records),
        candidateHash: digest(candidate),
      },
    };
  });
}

export async function replayCoreSplice(inputRoot, outputRoot) {
  const input = await loadCoreInput(inputRoot);
  const software = await Promise.all(
    [
      "subtitle-tool-core-splice.mjs",
      "lib/core-splice-policy.mjs",
      "../packages/video-subtitler/dist/standalone/bounded.js",
    ].map(async (name) => {
      const filename = path.resolve(import.meta.dirname, name);
      return { path: filename, sha256: await fileHash(filename) };
    }),
  );
  outputRoot = path.resolve(outputRoot);
  await safePath(outputRoot, true);
  if (
    [input.inputRoot, ...input.targets.map((t) => t.task)].some((r) =>
      inside(r, outputRoot),
    )
  )
    throw Error("SEPARATE_OUTPUT_REQUIRED");
  const targets = projectCoreTargets(input);
  if (digest(targets) !== digest(projectCoreTargets(input)))
    throw Error("NONDETERMINISTIC_PROJECTION");
  await fs.mkdir(outputRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(outputRoot, "core-splice-"));
  const files = [],
    audio = [];
  for (const target of targets) {
    const dir = path.join(root, target.id);
    await fs.mkdir(dir);
    for (const side of ["baseline", "candidate"]) {
      await save(path.join(dir, `${side}-records.json`), target[side]);
      const projection = serializeRecords(target[side], input.plan.language);
      for (const [ext, bytes] of Object.entries(projection.files)) {
        const filename = `${target.id}/${side}.needs-review.${ext}`;
        await fs.writeFile(path.join(root, filename), bytes, { flag: "wx" });
        const parsed = formats[ext].parse(
          await fs.readFile(path.join(root, filename), "utf8"),
        );
        if (
          parsed.length !== projection.cues.length ||
          parsed.some(
            (r, i) =>
              r.text !== projection.cues[i].text ||
              r.start !== projection.cues[i].start ||
              r.end !== projection.cues[i].end,
          )
        )
          throw Error("SERIALIZATION_LOSS");
        files.push(filename);
      }
    }
    const requests = input.plan.requests.filter(
      (r) => r.targetId === target.id,
    );
    const clip = requests.find((r) => r.id.endsWith("-wide"));
    const relative = `${target.id}/review.wav`;
    await fs.copyFile(
      path.join(input.inputRoot, clip.id, "input.wav"),
      path.join(root, relative),
      fs.constants.COPYFILE_EXCL,
    );
    if ((await fileHash(path.join(root, relative))) !== clip.wavHash)
      throw Error("REVIEW_AUDIO_CHANGED");
    audio.push({
      targetId: target.id,
      path: relative,
      sourceStart: clip.start,
      sourceEnd: clip.end,
      sha256: clip.wavHash,
      sourceRequestId: clip.id,
    });
  }
  const result = {
    version: "core-splice-replay-v1",
    policy: coreSplicePolicy,
    software,
    sourceHash: input.plan.sourceHash,
    inputFreezeHash: input.freezeHash,
    targets,
    audio,
    files,
    deterministicReplay: true,
    newInferenceRequests: 0,
    modelLoads: 0,
    providerProcesses: 0,
    sourceMutations: 0,
    referenceUsed: false,
    previouslyExposedDevelopmentCase: true,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    machineOnlyReleaseAuthorized: false,
  };
  await save(path.join(root, "core-splice.json"), result);
  await checkFiles(input.inputRoot, input.freeze.files);
  for (const file of software)
    if ((await fileHash(file.path)) !== file.sha256)
      throw Error("SOFTWARE_CHANGED_DURING_REPLAY");
  if (
    (await fileHash(path.join(input.inputRoot, "machine-freeze.json"))) !==
    input.freezeHash
  )
    throw Error("INPUT_FREEZE_CHANGED_DURING_REPLAY");
  for (const source of input.plan.sourceFiles)
    if ((await fileHash(source.path)) !== source.sha256)
      throw Error("SOURCE_CHANGED_DURING_REPLAY");
  await save(path.join(root, "machine-freeze.json"), {
    version: "core-splice-freeze-v1",
    inputFreezeHash: input.freezeHash,
    files: await inventory(root),
  });
  return {
    root,
    proposals: targets.filter((t) => t.decision.status === "PROPOSED").length,
    abstentions: targets.filter((t) => t.decision.status === "ABSTAIN").length,
    newInferenceRequests: 0,
    qualityStatus: "needs-review",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  console.log(
    JSON.stringify(await replayCoreSplice(...process.argv.slice(2)), null, 2),
  );
