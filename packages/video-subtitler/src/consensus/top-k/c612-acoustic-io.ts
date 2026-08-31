import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile, mkdir } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import path from "node:path";
import { z } from "zod";
import {
  c612CtcScoreSchema,
  c612CtcSchema,
  c612RuntimeSchema,
  c612VerifierIdentitySchema,
  c612VerifierVersionsSchema,
  type C61HypothesisUniverse,
  type C611CorrelationObservation,
  type C612Identity,
  type C612CtcScore,
} from "@mvl/shared";
import { artifact, hash, C612_POLICY, c612Defined } from "./c612-policy.js";
import { c61Json } from "../c61-artifact-io.js";
import { independentCtcRepresentations } from "../../machine-quality/independent-ctc-projection.js";
import type {
  C612VadEvidence,
  C612MappedSupport,
} from "./candidate-acoustic-completeness.js";
import { normalizeC61HypothesisText } from "../hypothesis-universe.js";
import type { CorePcmSource } from "./correlation-identity.js";
const execute = promisify(execFile);
export const byteHash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export async function fileHash(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}
export const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export const objects = (v: unknown) => (Array.isArray(v) ? v.map(obj) : []);
const text = (v: unknown) => (typeof v === "string" ? v : null);
export async function readAcousticInputs(taskDirectory: string) {
  const vadFile = path.join(taskDirectory, "machine-vad-global-timebase.json"),
    raw = obj(await c61Json(vadFile)),
    source = obj(raw.sourceIdentity);
  const sourceHash = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(source.sourceMediaSha256);
  const rate = z.number().positive().parse(source.sourceSampleRate);
  const rows = objects(raw.vadSegments);
  const trusted = rows.filter(
    (r) =>
      r.mappingStatus === "VERIFIED" &&
      r.sourceMediaSha256 === sourceHash &&
      typeof r.sourceGlobalStartSample === "number" &&
      typeof r.sourceGlobalEndSample === "number",
  );
  const vad: C612VadEvidence = {
    sourceIdentity: sourceHash,
    verified:
      source.sourceReadOnlyVerified === true &&
      raw.guessedOffsetCount === 0 &&
      trusted.length > 0,
    evidenceHash: await fileHash(vadFile),
    intervals: trusted.map((r) => ({
      start: Number(r.sourceGlobalStartSample) / rate,
      end: Number(r.sourceGlobalEndSample) / rate,
    })),
  };
  const tokenFile = path.join(
    taskDirectory,
    "machine-global-token-timeline-v2.json",
  );
  return {
    vad,
    rawVad: raw,
    tokens: obj(await c61Json(tokenFile)),
    tokensHash: await fileHash(tokenFile),
    paired: obj(
      await c61Json(
        path.join(taskDirectory, "machine-paired-whisper-evidence.json"),
      ),
    ),
    model: obj(
      await c61Json(
        path.join(taskDirectory, "machine-independent-verifier-runtime.json"),
      ),
    ),
  };
}
export function recoverMappedSupport(
  universe: C61HypothesisUniverse,
  identities: readonly C612Identity[],
  raw: Record<string, unknown>,
  evidenceHash: string,
): C612MappedSupport[] {
  const result: C612MappedSupport[] = [];
  for (const identity of identities) {
    if (raw.sourceMediaSha256 !== identity.sourceMediaHash) continue;
    const c = c612Defined(
        universe.candidates.find((c) => c.candidateId === identity.candidateId),
      ),
      event = c612Defined(universe.events.find((e) => e.eventId === c.eventId));
    const tokens = objects(raw.tokens)
      .filter(
        (t) =>
          t.trusted === true &&
          t.lexical === true &&
          t.mappingStatus === "TRUSTED" &&
          Number(t.probability) >=
            C612_POLICY.completeness.minimumTokenPosterior &&
          (t.requestId === c.requestId ||
            t.cueId === c.sourceCandidateId ||
            (c.providerFamily === "CURRENT" &&
              t.cueId === event.finalSpan?.finalCueId)),
      )
      .filter((t) => {
        const interval = obj(t.sourceGlobalInterval);
        return (
          typeof interval.start === "number" &&
          typeof interval.end === "number" &&
          interval.end > interval.start &&
          interval.start >= event.sourceInterval.start - 0.06 &&
          interval.end <= event.sourceInterval.end + 0.06
        );
      })
      .sort(
        (a, b) =>
          Number(obj(a.sourceGlobalInterval).start) -
            Number(obj(b.sourceGlobalInterval).start) ||
          String(a.tokenId).localeCompare(String(b.tokenId)),
      );
    // Exact whole-target match. No nearest-window or unrelated-token borrowing.
    if (
      !tokens.length ||
      normalizeC61HypothesisText(tokens.map((t) => t.text).join("")) !==
        c.normalizedText
    )
      continue;
    result.push({
      candidateId: c.candidateId,
      coverage: 1,
      intervals: tokens.map((t) => ({
        start: Number(obj(t.sourceGlobalInterval).start),
        end: Number(obj(t.sourceGlobalInterval).end),
      })),
      evidenceHashes: [
        evidenceHash,
        ...tokens.flatMap((t) =>
          typeof t.semanticHash === "string" ? [t.semanticHash] : [],
        ),
      ].sort(),
    });
  }
  return result;
}
/** Exact request cache projection, never a broad recursive cache scan. */
export async function recoverDecodeMetadata(
  observations: readonly C611CorrelationObservation[],
  paired: Record<string, unknown>,
  cacheRoot: string,
) {
  const requests = new Map<
    string,
    {
      cache: string;
      audio: string | null;
    }
  >();
  for (const event of objects(paired.events))
    for (const key of ["whisperCoreExact", "whisperCoreContext"]) {
      const row = obj(event[key]);
      if (text(row.requestId) && text(row.cacheKey))
        requests.set(String(row.requestId), {
          cache: String(row.cacheKey),
          audio: text(row.audioSha256),
        });
    }
  const output: C611CorrelationObservation[] = [];
  for (const observation of observations) {
    const request = observation.requestId
      ? requests.get(observation.requestId)
      : undefined;
    if (!request || !/^[a-f0-9]{64}$/.test(request.cache)) {
      output.push(observation);
      continue;
    }
    const cacheFile = path.join(
      cacheRoot,
      "whisper",
      request.cache.slice(0, 2),
      `${request.cache}.json`,
    );
    let cached: Record<string, unknown>;
    try {
      cached = obj(await c61Json(cacheFile));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        output.push(observation);
        continue;
      }
      throw e;
    }
    if (cached.requestIdentity !== request.cache)
      throw new Error("C612_REQUEST_CACHE_IDENTITY_MISMATCH");
    const response = obj(cached.response),
      config = obj(response.request);
    if (
      config.prompt_present !== false ||
      config.language !== "ja" ||
      config.translate !== false
    ) {
      output.push(observation);
      continue;
    }
    output.push({
      ...observation,
      decodeConfigurationHash: hash(config),
      promptPolicyHash: hash({
        promptPresent: false,
        authority: "EXACT_REQUEST_RESPONSE",
      }),
      metadataEvidenceHashes: [
        ...new Set([
          ...observation.metadataEvidenceHashes,
          await fileHash(cacheFile),
        ]),
      ].sort(),
    });
  }
  return output;
}
export async function readSourcePcm(
  source: string,
  expectedHash: string,
): Promise<CorePcmSource> {
  if ((await fileHash(source)) !== expectedHash)
    throw new Error("C612_SOURCE_MEDIA_HASH_MISMATCH");
  const { stdout } = await execute(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      source,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 128 * 1024 * 1024 },
  );
  if (!stdout.length || stdout.length % 2)
    throw new Error("C612_INVALID_SOURCE_PCM");
  return {
    pcm: stdout,
    sampleRate: 16000,
    streamIdentity: "source-audio-stream:0:a:0",
    channelMixPolicy: "ffmpeg-ac1-ar16000-s16le",
    sourceMediaHash: expectedHash,
  };
}
export function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export async function verifierIdentity(
  modelDirectory: string,
  python: string,
  repository: string,
  historical: Record<string, unknown>,
) {
  const expected = obj(historical.modelIdentity),
    names = [
      "config.json",
      "preprocessor_config.json",
      "vocab.json",
      "pytorch_model.bin",
      "special_tokens_map.json",
    ];
  const hashes = await Promise.all(
    names.map((n) => fileHash(path.join(modelDirectory, n))),
  );
  const [
    configSha256,
    preprocessorSha256,
    vocabularySha256,
    modelWeightSha256,
    specialTokensSha256,
  ] = hashes;
  const revision = z.string().min(1).parse(expected.resolvedRevision);
  const snapshot = hash({
    revision,
    configSha256,
    preprocessorSha256,
    vocabularySha256,
    modelWeightSha256,
    specialTokensSha256,
  });
  if (snapshot !== expected.modelSnapshotHash)
    throw new Error("C612_INDEPENDENT_MODEL_SNAPSHOT_MISMATCH");
  const preflight =
    "import json,platform,importlib.metadata as m;print(json.dumps({'python':platform.python_version(),'torch':m.version('torch'),'transformers':m.version('transformers'),'numpy':m.version('numpy'),'scipy':m.version('scipy'),'device':'cpu','precision':'fp32','threads':1}))";
  const runtime = c612VerifierVersionsSchema.parse(
    JSON.parse(
      (
        await execute(python, ["-c", preflight], {
          env: {
            ...process.env,
            HF_HUB_OFFLINE: "1",
            TRANSFORMERS_OFFLINE: "1",
          },
        })
      ).stdout,
    ),
  );
  const worker = path.join(
    repository,
    "scripts/runtime/c612_candidate_ctc_worker.py",
  );
  const workerHash = await fileHash(worker),
    importedWorkerHash = await fileHash(
      path.join(
        repository,
        "scripts/runtime/independent_ctc_discriminator_worker.py",
      ),
    );
  const runtimeIdentityHash = hash({
    runtime,
    workerHash,
    importedWorkerHash,
    modelSnapshotHash: snapshot,
  });
  const modelId = z.string().min(1).parse(expected.modelId);
  return {
    modelId,
    revision,
    snapshot,
    runtimeIdentityHash,
    runtime,
    worker,
    identity: c612VerifierIdentitySchema.parse(
      artifact("machine-c6-1-2-verifier-runtime-identity", {
        modelId,
        modelRevision: revision,
        modelSnapshotHash: snapshot,
        modelFiles: await Promise.all(
          names.map(async (name, i) => ({
            name,
            sha256: c612Defined(hashes[i]),
            bytes: (await stat(path.join(modelDirectory, name))).size,
          })),
        ),
        runtime,
        workerHash,
        importedWorkerHash,
        runtimeIdentityHash,
        networkUsed: false,
        runtimeGoldInputCount: 0,
      }),
    ),
  };
}
const workerScoreSchema = z.object({
  candidateId: z.string(),
  representation: z.enum(["NORMALIZED_DISPLAY", "PRONUNCIATION"]),
  representationHash: z.string(),
  encodedTokenCount: z.number(),
  unknownTokenCount: z.number(),
  coverageRatio: z.number(),
  rawNll: z.number().nullable(),
  nllPerTargetToken: z.number().nullable(),
  acousticFrameCount: z.number(),
  blockers: z.array(z.string()),
  supportedTokens: c612CtcScoreSchema.shape.supportedTokens,
});
export async function scoreExistingCandidates(input: {
  universe: C61HypothesisUniverse;
  identities: readonly C612Identity[];
  pcm: CorePcmSource;
  modelDirectory: string;
  python: string;
  repository: string;
  historical: Record<string, unknown>;
  cache: string;
  allowFresh: boolean;
  replay: boolean;
  onProgress?: (value: string) => void;
}) {
  const model = await verifierIdentity(
    input.modelDirectory,
    input.python,
    input.repository,
    input.historical,
  );
  const eventIds = [...new Set(input.identities.map((r) => r.eventId))].sort();
  if (eventIds.length > C612_POLICY.verifier.maximumAudioRequests)
    throw new Error("C612_VERIFIER_BUDGET_EXCEEDED");
  await mkdir(input.cache, { recursive: true });
  const rows: C612CtcScore[] = [];
  let fresh = 0,
    hits = 0,
    loads = 0;
  const plans = eventIds.map((eventId) => {
    const event = c612Defined(
      input.universe.events.find((e) => e.eventId === eventId),
    );
    const interval = event.sourceInterval,
      pcm = input.pcm.pcm.subarray(
        Math.round(interval.start * 16000) * 2,
        Math.round(interval.end * 16000) * 2,
      );
    const targets = input.identities
      .filter((r) => r.eventId === eventId)
      .map((r) => {
        const c = c612Defined(
          input.universe.candidates.find(
            (x) => x.candidateId === r.candidateId,
          ),
        );
        return {
          candidateId: c.candidateId,
          representations: independentCtcRepresentations({
            displayText: c.displayText,
            ...(c.pronunciationText
              ? { pronunciationText: c.pronunciationText }
              : {}),
          }),
        };
      })
      .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
    const audioHash = byteHash(pcm),
      requestId = hash({
        audioHash,
        targets,
        modelSnapshotHash: model.snapshot,
        runtime: model.runtimeIdentityHash,
        policy: C612_POLICY.verifier,
      });
    return {
      eventId,
      interval,
      pcm,
      audioHash,
      targets,
      requestId,
      file: path.join(input.cache, `${requestId}.json`),
      audio: path.join(input.cache, `${audioHash}.wav`),
    };
  });
  type Plan = (typeof plans)[number];
  const missing: Plan[] = [];
  const project = (plan: Plan, value: unknown) => {
    const cached = obj(value);
    if (
      cached.requestId !== plan.requestId ||
      cached.modelSnapshotHash !== model.snapshot ||
      cached.runtimeIdentityHash !== model.runtimeIdentityHash ||
      cached.audioHash !== plan.audioHash ||
      hash(cached.scores) !== cached.scoresHash
    )
      throw new Error("C612_VERIFIER_CACHE_BINDING");
    const parsed = z.array(c612CtcScoreSchema).parse(cached.scores);
    if (
      hash(parsed.map((s) => s.candidateId).sort()) !==
      hash(plan.targets.map((t) => t.candidateId))
    )
      throw new Error("C612_VERIFIER_CACHE_TARGET_SET");
    for (const r of parsed)
      if (
        r.audioHash !== plan.audioHash ||
        r.runtimeIdentityHash !== model.runtimeIdentityHash ||
        r.modelSnapshotHash !== model.snapshot ||
        hash(r.scoredInterval) !== hash(plan.interval) ||
        r.cacheIdentity !== plan.requestId ||
        !plan.targets
          .find((t) => t.candidateId === r.candidateId)
          ?.representations.some((t) => byteHash(t.text) === r.targetHash)
      )
        throw new Error("C612_VERIFIER_CACHE_SCORE_BINDING");
    rows.push(...parsed);
  };
  for (const plan of plans) {
    try {
      project(plan, await c61Json(plan.file));
      hits++;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      missing.push(plan);
    }
  }
  if (missing.length && !input.allowFresh) {
    if (input.replay) throw new Error("C612_EXACT_REPLAY_CACHE_MISS");
    for (const plan of missing)
      for (const target of plan.targets)
        rows.push(
          c612CtcScoreSchema.parse({
            candidateId: target.candidateId,
            eventId: plan.eventId,
            audioHash: plan.audioHash,
            scoredInterval: plan.interval,
            modelSnapshotHash: model.snapshot,
            runtimeIdentityHash: model.runtimeIdentityHash,
            targetHash: null,
            representation: null,
            rawLoss: null,
            perTokenLoss: null,
            tokenCount: 0,
            vocabularyCoverage: null,
            unknownTokenCount: 0,
            acousticFrameCount: 0,
            status: "UNAVAILABLE",
            reasons: ["EXACT_CANDIDATE_OCCUPANCY_CACHE_MISSING"],
            supportedTokens: [],
            cacheIdentity: null,
          }),
        );
  } else if (missing.length) {
    const child = spawn(
      input.python,
      [model.worker, "--model-directory", input.modelDirectory],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          HF_HUB_OFFLINE: "1",
          TRANSFORMERS_OFFLINE: "1",
          HF_HUB_DISABLE_TELEMETRY: "1",
          TOKENIZERS_PARALLELISM: "false",
        },
      },
    );
    let stderr = "";
    child.stderr.on("data", (b) => {
      stderr = (stderr + String(b)).slice(-3000);
    });
    const messages: unknown[] = [],
      waiters: {
        resolve: (v: unknown) => void;
        reject: (e: Error) => void;
      }[] = [];
    let ended = false;
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const message: unknown = JSON.parse(line);
        const pending = waiters.shift();
        if (pending) pending.resolve(message);
        else messages.push(message);
      } catch {
        child.kill();
      }
    });
    child.on("exit", (code) => {
      ended = true;
      for (const w of waiters.splice(0))
        w.reject(new Error(`C612_VERIFIER_EXIT:${code}:${stderr}`));
    });
    const next = () =>
      messages.length
        ? Promise.resolve(messages.shift())
        : ended
          ? Promise.reject(new Error(`C612_VERIFIER_ENDED:${stderr}`))
          : new Promise<unknown>((resolve, reject) => {
              const timer = setTimeout(() => {
                child.kill();
                reject(new Error("C612_VERIFIER_TIMEOUT"));
              }, 180000);
              waiters.push({
                resolve: (v) => {
                  clearTimeout(timer);
                  resolve(v);
                },
                reject: (e) => {
                  clearTimeout(timer);
                  reject(e);
                },
              });
            });
    try {
      const ready = obj(await next());
      const { type, modelLoads, ...runtime } = ready;
      if (
        type !== "ready" ||
        modelLoads !== 1 ||
        hash(runtime) !== hash(model.runtime)
      )
        throw new Error("C612_VERIFIER_RUNTIME_IDENTITY_MISMATCH");
      loads++;
      for (const plan of missing) {
        if (
          plan.interval.end - plan.interval.start > 30 ||
          plan.targets.length > 12
        )
          throw new Error("C612_VERIFIER_WINDOW_OR_TARGET_BUDGET");
        await writeFile(plan.audio, wav(plan.pcm), { flag: "wx" }).catch(
          (e: unknown) => {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          },
        );
        if ((await fileHash(plan.audio)) !== byteHash(wav(plan.pcm)))
          throw new Error("C612_VERIFIER_AUDIO_CACHE_CONFLICT");
        child.stdin.write(
          `${JSON.stringify({ type: "score-existing", requestId: plan.requestId, audioPath: plan.audio, targets: plan.targets })}\n`,
        );
        const result = obj(await next());
        if (
          result.type !== "scores" ||
          result.requestId !== plan.requestId ||
          result.forwardPasses !== 1
        )
          throw new Error("C612_VERIFIER_RESPONSE_IDENTITY");
        const scores = z
          .array(workerScoreSchema)
          .parse(result.rows)
          .map((r) =>
            c612CtcScoreSchema.parse({
              candidateId: r.candidateId,
              eventId: plan.eventId,
              audioHash: plan.audioHash,
              scoredInterval: plan.interval,
              modelSnapshotHash: model.snapshot,
              runtimeIdentityHash: model.runtimeIdentityHash,
              targetHash: r.representationHash,
              representation: r.representation,
              rawLoss: r.rawNll,
              perTokenLoss: r.nllPerTargetToken,
              tokenCount: r.encodedTokenCount,
              vocabularyCoverage: r.coverageRatio,
              unknownTokenCount: r.unknownTokenCount,
              acousticFrameCount: r.acousticFrameCount,
              status: r.blockers.length ? "UNSCORABLE" : "SCORABLE",
              reasons: r.blockers,
              supportedTokens: r.supportedTokens,
              cacheIdentity: plan.requestId,
            }),
          );
        const envelope = {
          requestId: plan.requestId,
          audioHash: plan.audioHash,
          modelSnapshotHash: model.snapshot,
          runtimeIdentityHash: model.runtimeIdentityHash,
          scores,
          scoresHash: hash(scores),
        };
        project(plan, envelope);
        await writeFile(plan.file, JSON.stringify(envelope), { flag: "wx" });
        fresh++;
        input.onProgress?.(
          `CTC existing-target core ${fresh}/${missing.length}; targets ${scores.length}; no ASR decoding`,
        );
      }
    } finally {
      child.stdin.end(`${JSON.stringify({ type: "shutdown" })}\n`);
      child.kill();
    }
  }
  rows.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  return {
    scores: c612CtcSchema.parse(
      artifact("machine-c6-1-2-candidate-ctc-scores", {
        lowerIsBetter: true,
        rows,
        runtimeGoldInputCount: 0,
      }),
    ),
    runtime: c612RuntimeSchema.parse(
      artifact("machine-c6-1-2-acoustic-completeness-runtime", {
        mode: input.replay
          ? "CACHE_REPLAY"
          : input.allowFresh
            ? "BOUNDED_NON_GENERATIVE_FRESH"
            : "EXACT_CACHE_ONLY",
        modelId: model.modelId,
        modelRevision: model.revision,
        modelSnapshotHash: model.snapshot,
        runtimeIdentityHash: model.runtimeIdentityHash,
        device: "cpu",
        requestBudget: C612_POLICY.verifier.maximumAudioRequests,
        plannedRequests: plans.length,
        actualRequests: fresh + hits,
        freshVerifierInference: fresh,
        verifierCacheHits: hits,
        verifierModelLoads: loads,
        candidateScores: rows.length,
        asrInference: 0,
        asrModelLoads: 0,
        newTranscriptCandidates: 0,
        networkUsed: false,
        runtimeGoldInputCount: 0,
      }),
    ),
    runtimeIdentity: model.identity,
  };
}
