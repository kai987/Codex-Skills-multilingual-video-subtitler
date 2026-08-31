import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  NodeProcessRunner,
  c601141FingerprintSchema,
  type C601141FingerprintEntry,
  type C601141Policy,
  type C601141AudioViews,
  type C60114LineageReconciliation,
  asrRequestTimelineContractV2Schema,
  machineGlobalTokenTimelineV2Schema,
  machineVadGlobalTimebaseSchema,
} from "@mvl/shared";
import { c60114Id } from "./c60114-policy.js";
import {
  hash141,
  hashed141,
  header141,
  assertHash141,
  required141,
} from "./c601141-policy.js";
import { pcm141, bytesHash141, durableJson141 } from "./c601141-io.js";

interface Retained {
  file: string;
  sha256: string;
  pcmSha256: string;
  frames: number;
  sampleRate: number;
  channels: number;
}
interface LocalBinding {
  requestId: string;
  audioSha256: string;
  localStartSample: number | null;
  localEndSample: number | null;
  sampleRate: number;
  speechPositive: boolean;
  lexical: boolean;
  qualityValid: boolean;
  reasons: string[];
}
export async function indexRetainedAudio141(
  roots: readonly string[],
): Promise<Map<string, Retained>> {
  const files: string[] = [];
  async function walk(root: string) {
    for (const entry of (await readdir(root, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      // Never follow symlinks or parse unrelated JSON/text during a bytes audit.
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".wav"))
        files.push(file);
    }
  }
  for (const root of roots) {
    if (
      /(?:^|[/_-])(gold|human-reviewed|human-review)(?:[/_.-]|$)/iu.test(root)
    )
      throw new Error("C601141_NON_MACHINE_AUDIO_ROOT_FORBIDDEN");
    await walk(await realpath(root));
  }
  const result = new Map<string, Retained>();
  for (const file of files) {
    const bytes = await readFile(file),
      sha256 = bytesHash141(bytes);
    if (result.has(sha256)) continue;
    try {
      const wave = pcm141(bytes);
      result.set(sha256, {
        file,
        sha256,
        pcmSha256: bytesHash141(wave.pcm),
        frames: wave.frames,
        sampleRate: wave.sampleRate,
        channels: wave.channels,
      });
    } catch {
      /* Not a supported retained PCM clip; do not invent decoding parameters. */
    }
  }
  return result;
}
export function legacyBindings141(input: {
  requests: unknown;
  tokens: unknown;
  vad: unknown;
  sourceSha256: string;
}) {
  const requests = asrRequestTimelineContractV2Schema.parse(input.requests);
  const tokens = machineGlobalTokenTimelineV2Schema.parse(input.tokens);
  const vad = machineVadGlobalTimebaseSchema.parse(input.vad);
  if (
    requests.sourceMediaSha256 !== input.sourceSha256 ||
    tokens.sourceMediaSha256 !== input.sourceSha256 ||
    vad.sourceIdentity.sourceMediaSha256 !== input.sourceSha256
  )
    throw new Error("C601141_LEGACY_SOURCE_IDENTITY_MISMATCH");
  const requestMap = new Map(requests.requests.map((v) => [v.requestId, v]));
  const bindings = new Map<string, LocalBinding>();
  for (const token of tokens.tokens) {
    const request = requestMap.get(token.requestId);
    if (!request) continue;
    const qualityValid =
      token.lexical &&
      token.mappingStatus !== "UNTRUSTED" &&
      token.decoderLocalStartSample !== null &&
      token.decoderLocalEndSample !== null &&
      token.decoderLocalEndSample > token.decoderLocalStartSample &&
      token.decoderLocalStartSample >= 0 &&
      token.decoderLocalEndSample <= request.extractedSampleCount &&
      request.tokenTimeBase === "original-audio-local";
    bindings.set(
      c60114Id("evidence", {
        key: "tokenTimeline",
        rawId: token.tokenId,
        family: "TRUSTED_MAPPED_TOKEN",
      }),
      {
        requestId: request.requestId,
        audioSha256: request.extractedAudioSha256,
        localStartSample: token.decoderLocalStartSample,
        localEndSample: token.decoderLocalEndSample,
        sampleRate: request.extractedSampleRate,
        speechPositive: qualityValid,
        lexical: qualityValid && token.text.trim().length > 0,
        qualityValid,
        reasons: qualityValid
          ? ["LOCAL_INTEGER_TOKEN_BOUNDARIES_RETAINED"]
          : ["AUDIO_IDENTITY_CANNOT_REPAIR_UNTRUSTED_TOKEN_QUALITY_OR_CLOCK"],
      },
    );
  }
  for (const segment of vad.vadSegments) {
    const qualityValid =
      segment.vadStartSampleInParent >= 0 &&
      segment.vadEndSampleInParent > segment.vadStartSampleInParent &&
      segment.vadEndSampleInParent <= segment.parentTotalSamples;
    bindings.set(
      c60114Id("evidence", {
        key: "vadTimebase",
        rawId: segment.vadSegmentId,
        family: "MAPPED_VAD",
      }),
      {
        requestId: segment.requestId,
        audioSha256: segment.parentArtifactSha256,
        localStartSample: segment.vadStartSampleInParent,
        localEndSample: segment.vadEndSampleInParent,
        sampleRate: segment.parentSampleRate,
        speechPositive: qualityValid,
        lexical: false,
        qualityValid,
        reasons: ["RETAINED_NATIVE_VAD_CHILD_BOUNDS_NOT_PARENT_ENVELOPE"],
      },
    );
  }
  return { bindings, requestMap };
}
interface Match {
  offset: number;
  score: number;
  residual: number;
  viewId: string;
  exact: boolean;
}
interface Result {
  clipId: string;
  status: C601141FingerprintEntry["status"];
  matches: Match[];
  scoreMargin?: number;
}
export async function reconcileFingerprint141(input: {
  policy: C601141Policy;
  views: C601141AudioViews;
  viewsDirectory: string;
  lineage: C60114LineageReconciliation;
  requests: unknown;
  tokens: unknown;
  vad: unknown;
  audioRoots: string[];
  python: string;
  worker: string;
  outputDirectory: string;
}) {
  assertHash141(input.lineage);
  assertHash141(input.views);
  const { bindings, requestMap } = legacyBindings141({
    requests: input.requests,
    tokens: input.tokens,
    vad: input.vad,
    sourceSha256: input.views.sourceIdentity.sourceMediaSha256,
  });
  const retained = await indexRetainedAudio141(input.audioRoots);
  const quarantined = input.lineage.entries.filter(
    (v) => !v.status.startsWith("VERIFIED"),
  );
  const rows = quarantined.map((row) => {
    const binding = bindings.get(row.evidenceId);
    const request = row.parentRequestIds
      .map((id) => requestMap.get(id))
      .find((v) => v !== undefined);
    const clip = retained.get(
      binding?.audioSha256 ?? request?.extractedAudioSha256 ?? "",
    );
    return { row, binding, clip };
  });
  const candidates = [
    ...new Map(
      rows.flatMap((v) =>
        v.clip ? [[v.clip.pcmSha256, { ...v, clip: v.clip }] as const] : [],
      ),
    ).values(),
  ].sort(
    (a, b) =>
      Number(b.binding?.speechPositive ?? false) -
        Number(a.binding?.speechPositive ?? false) ||
      Number(b.binding?.lexical ?? false) -
        Number(a.binding?.lexical ?? false) ||
      a.clip.frames - b.clip.frames ||
      a.clip.pcmSha256.localeCompare(b.clip.pcmSha256),
  );
  const selected: Retained[] = [];
  let seconds = 0;
  for (const { clip } of candidates)
    if (
      clip.sampleRate === 16000 &&
      clip.channels === 1 &&
      selected.length < input.policy.maxFingerprintClips &&
      seconds + clip.frames / 16000 <= input.policy.maxFingerprintSeconds
    ) {
      selected.push(clip);
      seconds += clip.frames / 16000;
    }
  const workerInput = {
    policy: input.policy.fingerprint,
    views: input.views.views
      .filter((v) => v.detectorEligible)
      .map((v) => ({
        viewId: v.viewId,
        audioPath: path.join(input.viewsDirectory, v.relativePath),
        pcmSha256: v.pcmSha256,
      })),
    clips: selected.map((v) => ({
      clipId: v.pcmSha256,
      audioPath: v.file,
      pcmSha256: v.pcmSha256,
    })),
  };
  const inputFile = path.join(
    input.outputDirectory,
    "fingerprint-search-input.local-only.json",
  );
  await durableJson141(inputFile, workerInput);
  const runner = new NodeProcessRunner();
  const response = await runner.run(
    input.python,
    [input.worker, "--input", inputFile],
    { timeoutMs: 1200000 },
  );
  const decoded = JSON.parse(response.stdout) as {
    controls: { passed: boolean };
    results: Result[];
  };
  if (!decoded.controls.passed)
    throw new Error("C601141_FINGERPRINT_CONTROLS_FAILED");
  await durableJson141(
    path.join(
      input.outputDirectory,
      "fingerprint-search-results.local-only.json",
    ),
    decoded,
  );
  const results = new Map(decoded.results.map((v) => [v.clipId, v]));
  const entries: C601141FingerprintEntry[] = rows.map(
    ({ row, binding, clip }) => {
      const result = clip ? results.get(clip.pcmSha256) : undefined,
        best = result?.matches[0],
        second = result?.matches[1];
      const recovered = result?.status.startsWith("LEGACY_") ?? false;
      const view = best
        ? input.views.views.find((v) => v.viewId === best.viewId)
        : undefined;
      const localValid =
        recovered &&
        binding?.qualityValid === true &&
        binding.localStartSample !== null &&
        binding.localEndSample !== null &&
        binding.sampleRate === 16000 &&
        clip !== undefined &&
        binding.localEndSample <= clip.frames &&
        view !== undefined;
      const nativeInterval =
        localValid && best
          ? {
              startSample:
                view.timeMapping.sourceStartSample +
                Math.round(
                  ((best.offset + required141(binding.localStartSample)) *
                    input.views.sourceIdentity.sampleRate) /
                    16000,
                ),
              endSample:
                view.timeMapping.sourceStartSample +
                Math.round(
                  ((best.offset + required141(binding.localEndSample)) *
                    input.views.sourceIdentity.sampleRate) /
                    16000,
                ),
            }
          : null;
      return hashed141({
        evidenceId: row.evidenceId,
        requestIds: row.parentRequestIds,
        retainedPath: clip?.file ?? null,
        retainedAudioSha256: clip?.sha256 ?? null,
        retainedPcmSha256: clip?.pcmSha256 ?? null,
        clipSeconds: clip ? clip.frames / clip.sampleRate : 0,
        searched: result !== undefined,
        searchScope: "FULL_SOURCE_ONLY" as const,
        searchViewId: best?.viewId ?? null,
        bestOffsetSamples16k: best?.offset ?? null,
        secondOffsetSamples16k: second?.offset ?? null,
        bestScore: best?.score ?? null,
        secondScore: second?.score ?? null,
        scoreMargin: result?.scoreMargin ?? null,
        residual: best?.residual ?? null,
        uniquenessPassed: recovered,
        status:
          result?.status ??
          (!clip
            ? "SOURCE_AUDIO_BYTES_NOT_RETAINED"
            : clip.sampleRate !== 16000 || clip.channels !== 1
              ? "EXTRACTION_CONFIG_UNRESOLVED"
              : "PROVENANCE_STILL_INSUFFICIENT"),
        nativeInterval,
        speechPositive: localValid && binding.speechPositive,
        lexicalEvidenceEligible: localValid && binding.lexical,
        lexicalProvenanceReasons: binding?.reasons ?? [
          "NO_RETAINED_LOCAL_LEXICAL_BOUNDARIES",
        ],
        reasons: [
          !clip
            ? "RETAINED_REQUEST_AUDIO_SHA_NOT_FOUND"
            : !result
              ? "FROZEN_FINGERPRINT_BUDGET_OR_FORMAT_DEFERRED"
              : recovered
                ? "AUDIO_OCCURRENCE_RECOVERED_NOT_LEXICAL_TRUTH"
                : result.status,
          ...(recovered && !localValid
            ? ["RECOVERED_PARENT_AUDIO_IS_NOT_A_SPEECH_INTERVAL"]
            : []),
        ],
      });
    },
  );
  return c601141FingerprintSchema.parse(
    hashed141({
      ...header141(input.policy, input.views.sourceIdentity),
      artifactType: "machine-legacy-audio-fingerprint-reconciliation",
      inputLineageHash: input.lineage.semanticHash,
      viewsHash: input.views.semanticHash,
      syntheticControlsHash: hash141(decoded.controls),
      entries,
      summary: {
        quarantinedEntryCount: entries.length,
        retainedClipCount: candidates.length,
        uniqueSearchedClips: selected.length,
        searchedClipSeconds: seconds,
        recoveredEntries: entries.filter((v) => v.status.startsWith("LEGACY_"))
          .length,
        ambiguousEntries: entries.filter(
          (v) => v.status === "FINGERPRINT_AMBIGUOUS",
        ).length,
        noBytesEntries: entries.filter(
          (v) => v.status === "SOURCE_AUDIO_BYTES_NOT_RETAINED",
        ).length,
        rejectedEntries: entries.filter(
          (v) =>
            !v.status.startsWith("LEGACY_") &&
            v.status !== "SOURCE_AUDIO_BYTES_NOT_RETAINED",
        ).length,
        lexicalEligibleEntries: entries.filter((v) => v.lexicalEvidenceEligible)
          .length,
      },
    }),
  );
}
