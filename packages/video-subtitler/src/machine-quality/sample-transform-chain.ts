import {
  InputError,
  sampleTransformSchema,
  type SampleTransform,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";

export type SampleBoundary = "start" | "end";

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InputError(`${name} must be a positive safe integer.`, {
      value,
    });
  }
  return value;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InputError(`${name} must be a nonnegative safe integer.`, {
      value,
    });
  }
  return value;
}

function divideRational(
  numerator: bigint,
  denominator: bigint,
  boundary: SampleBoundary,
): bigint {
  if (denominator <= 0n) throw new InputError("Invalid sample-rate ratio.");
  if (boundary === "start") return numerator / denominator;
  return (numerator + denominator - 1n) / denominator;
}

export function secondsToSampleIndex(input: {
  seconds: number;
  sampleRate: number;
  boundary: SampleBoundary;
}): number {
  if (!Number.isFinite(input.seconds) || input.seconds < 0) {
    throw new InputError(
      "Sample conversion requires finite nonnegative seconds.",
    );
  }
  positiveInteger(input.sampleRate, "sampleRate");
  const raw = input.seconds * input.sampleRate;
  const converted =
    input.boundary === "start" ? Math.floor(raw) : Math.ceil(raw);
  return nonnegativeInteger(converted, "sample index");
}

export function sampleIndexToSeconds(
  sample: number,
  sampleRate: number,
): number {
  nonnegativeInteger(sample, "sample");
  positiveInteger(sampleRate, "sampleRate");
  return sample / sampleRate;
}

export function mapChildSampleToParent(input: {
  transform: SampleTransform;
  childSample: number;
  boundary: SampleBoundary;
}): number {
  const transform = sampleTransformSchema.parse(input.transform);
  const childSample = nonnegativeInteger(input.childSample, "childSample");
  if (childSample > transform.childTotalSamples) {
    throw new InputError("Child sample is outside the transform domain.", {
      childSample,
      childTotalSamples: transform.childTotalSamples,
      transformId: transform.transformId,
    });
  }
  const scaled = divideRational(
    BigInt(childSample) * BigInt(transform.conversionNumerator),
    BigInt(transform.conversionDenominator),
    input.boundary,
  );
  const parent = BigInt(transform.childStartSampleInParent) + scaled;
  if (parent > BigInt(transform.childEndSampleInParent)) {
    throw new InputError("Mapped sample escapes the declared parent span.", {
      transformId: transform.transformId,
      childSample,
      mappedParentSample: parent.toString(),
    });
  }
  const numeric = Number(parent);
  if (!Number.isSafeInteger(numeric)) {
    throw new InputError("Mapped sample exceeds safe integer range.");
  }
  return numeric;
}

export function composeSampleChain(input: {
  transforms: readonly SampleTransform[];
  localStartSample: number;
  localEndSample: number;
}): {
  startSample: number;
  endSample: number;
  transformHashes: string[];
} {
  if (input.transforms.length === 0) {
    throw new InputError("A sample transform chain cannot be empty.");
  }
  let start = nonnegativeInteger(input.localStartSample, "localStartSample");
  let end = positiveInteger(input.localEndSample, "localEndSample");
  if (end <= start) throw new InputError("Local sample interval is empty.");
  const transformHashes: string[] = [];
  for (let index = 0; index < input.transforms.length; index += 1) {
    const transform = sampleTransformSchema.parse(input.transforms[index]);
    const previous = input.transforms[index - 1];
    if (
      previous !== undefined &&
      (previous.parentArtifactId !== transform.childArtifactId ||
        previous.parentArtifactSha256 !== transform.childArtifactSha256)
    ) {
      throw new InputError("Sample transform parent/child identity mismatch.", {
        childTransformId: previous.transformId,
        parentTransformId: transform.transformId,
      });
    }
    if (!transform.verified) {
      throw new InputError("Unverified sample transform cannot be composed.", {
        transformId: transform.transformId,
      });
    }
    start = mapChildSampleToParent({
      transform,
      childSample: start,
      boundary: "start",
    });
    end = mapChildSampleToParent({
      transform,
      childSample: end,
      boundary: "end",
    });
    transformHashes.push(transform.semanticHash);
  }
  if (end <= start) {
    throw new InputError("Composed sample interval is empty.");
  }
  return { startSample: start, endSample: end, transformHashes };
}

export function createSampleTransform(input: {
  transformId: string;
  parentArtifactId: string;
  parentArtifactSha256: string;
  childArtifactId: string;
  childArtifactSha256: string;
  parentSampleRate: number;
  childSampleRate: number;
  parentTotalSamples: number;
  childTotalSamples: number;
  childStartSampleInParent: number;
  childEndSampleInParent: number;
  extractionMethod:
    | "direct-source-ffmpeg-sample-trim"
    | "whisper-internal-vad"
    | "nested-recovery-window"
    | "identity";
  ffmpeg: {
    inputSeekPlacement: "none" | "before-input" | "after-input";
    inputSeekSample: number;
    outputTrimStartSample: number;
    outputDurationSamples: number;
    atrimUsed: boolean;
    asetptsReset: boolean;
    resampleUsed: boolean;
    paddingSamples: number;
    commandIdentity: string;
  };
  resamplingIdentity: string;
  verificationReasons: readonly string[];
}): SampleTransform {
  const numerator = positiveInteger(input.parentSampleRate, "parentSampleRate");
  const denominator = positiveInteger(input.childSampleRate, "childSampleRate");
  const core = {
    transformId: input.transformId,
    parentArtifactId: input.parentArtifactId,
    parentArtifactSha256: input.parentArtifactSha256,
    childArtifactId: input.childArtifactId,
    childArtifactSha256: input.childArtifactSha256,
    parentSampleRate: input.parentSampleRate,
    childSampleRate: input.childSampleRate,
    parentTotalSamples: input.parentTotalSamples,
    childTotalSamples: input.childTotalSamples,
    childStartSampleInParent: input.childStartSampleInParent,
    childEndSampleInParent: input.childEndSampleInParent,
    outputLocalZeroSample: 0 as const,
    conversionNumerator: numerator,
    conversionDenominator: denominator,
    roundingPolicy:
      numerator === denominator
        ? ("identity-integer" as const)
        : ("floor-start-ceil-end-rational" as const),
    extractionMethod: input.extractionMethod,
    ffmpeg: input.ffmpeg,
    resamplingIdentity: input.resamplingIdentity,
    verified: true,
    verificationReasons: [...input.verificationReasons],
  };
  return sampleTransformSchema.parse({
    ...core,
    semanticHash: machineQualitySemanticHash(core),
  });
}

export function assertExactSampleSpan(input: {
  transform: SampleTransform;
  actualChildSamples: number;
}): void {
  const transform = sampleTransformSchema.parse(input.transform);
  if (transform.childTotalSamples !== input.actualChildSamples) {
    throw new InputError(
      "Extracted WAV sample count does not match its transform.",
      {
        transformId: transform.transformId,
        expected: transform.childTotalSamples,
        actual: input.actualChildSamples,
      },
    );
  }
  const mapped = composeSampleChain({
    transforms: [transform],
    localStartSample: 0,
    localEndSample: input.actualChildSamples,
  });
  if (
    mapped.startSample !== transform.childStartSampleInParent ||
    mapped.endSample !== transform.childEndSampleInParent
  ) {
    throw new InputError("Sample transform endpoint composition failed.", {
      transformId: transform.transformId,
      mapped,
    });
  }
}
