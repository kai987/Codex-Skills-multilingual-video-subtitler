import { InputError } from "@mvl/shared";

export const CTC_VITERBI_POLICY = "mvl-ctc-viterbi-v1" as const;
export const CTC_FRAME_MAPPING_POLICY =
  "wav2vec2-conv-receptive-field-v1" as const;
export const CTC_ALIGNMENT_POLICY = "c5.18.1-local-ctc-boundary-v1" as const;

const LEXICAL_CHARACTER =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Letter}\p{Number}]/u;
const NONSPOKEN_PUNCTUATION = /[\p{Punctuation}\p{Symbol}♪♫♬]+/gu;

export interface CtcNormalizationOperation {
  operation:
    | "nfc"
    | "whitespace-collapse"
    | "remove-display-newline"
    | "remove-nonspoken-punctuation";
  count: number;
}

export function normalizeCtcAlignmentText(input: string): {
  text: string;
  operations: CtcNormalizationOperation[];
  lexicalCharacterDeletionCount: 0;
} {
  const normalized = input.normalize("NFC");
  const newlineCount = (normalized.match(/[\r\n]+/gu) ?? []).length;
  const withSpaces = normalized.replace(/[\r\n]+/gu, " ");
  let punctuationCount = 0;
  const withoutPunctuation = withSpaces.replace(
    NONSPOKEN_PUNCTUATION,
    (value) => {
      for (const character of value) {
        if (LEXICAL_CHARACTER.test(character)) {
          throw new InputError(
            "CTC normalization attempted to delete a lexical character.",
          );
        }
      }
      punctuationCount += Array.from(value).length;
      return " ";
    },
  );
  const collapsed = withoutPunctuation.replace(/\s+/gu, " ").trim();
  const whitespaceCount = Math.max(
    0,
    Array.from(withoutPunctuation).filter((character) => /\s/u.test(character))
      .length - (collapsed === "" ? 0 : collapsed.split(" ").length - 1),
  );
  return {
    text: collapsed.replaceAll(" ", ""),
    operations: [
      {
        operation: "nfc",
        count: normalized === input ? 0 : 1,
      },
      { operation: "remove-display-newline", count: newlineCount },
      {
        operation: "remove-nonspoken-punctuation",
        count: punctuationCount,
      },
      { operation: "whitespace-collapse", count: whitespaceCount },
    ],
    lexicalCharacterDeletionCount: 0,
  };
}

export interface Wav2Vec2FrameMapping {
  sampleRate: 16_000;
  convKernel: number[];
  convStride: number[];
  totalStrideSamples: number;
  receptiveFieldSamples: number;
  expectedFrameCount: number;
  intervals: { startSeconds: number; endSeconds: number }[];
  frameCountFormula: "iterated-valid-convolution-v1";
  frameIntervalPolicy: "receptive-field-clipped-v1";
}

export function wav2Vec2OutputFrameCount(
  inputSamples: number,
  convKernel: readonly number[],
  convStride: readonly number[],
): number {
  if (
    !Number.isInteger(inputSamples) ||
    inputSamples <= 0 ||
    convKernel.length === 0 ||
    convKernel.length !== convStride.length
  ) {
    throw new InputError("Invalid Wav2Vec2 convolution mapping input.");
  }
  let count = inputSamples;
  for (let index = 0; index < convKernel.length; index += 1) {
    const kernel = convKernel[index];
    const stride = convStride[index];
    if (
      kernel === undefined ||
      stride === undefined ||
      !Number.isInteger(kernel) ||
      !Number.isInteger(stride) ||
      kernel <= 0 ||
      stride <= 0
    ) {
      throw new InputError("Invalid Wav2Vec2 convolution kernel or stride.");
    }
    count = Math.floor((count - kernel) / stride) + 1;
    if (count <= 0) return 0;
  }
  return count;
}

export function buildWav2Vec2FrameMapping(input: {
  inputSamples: number;
  convKernel: readonly number[];
  convStride: readonly number[];
  predictedFrameCount?: number;
}): Wav2Vec2FrameMapping {
  const expectedFrameCount = wav2Vec2OutputFrameCount(
    input.inputSamples,
    input.convKernel,
    input.convStride,
  );
  if (
    input.predictedFrameCount !== undefined &&
    input.predictedFrameCount !== expectedFrameCount
  ) {
    throw new InputError(
      `Wav2Vec2 frame count mismatch: expected ${String(expectedFrameCount)}, received ${String(input.predictedFrameCount)}.`,
    );
  }
  let totalStrideSamples = 1;
  let receptiveFieldSamples = 1;
  for (let index = 0; index < input.convKernel.length; index += 1) {
    const kernel = input.convKernel[index];
    const stride = input.convStride[index];
    if (kernel === undefined || stride === undefined) {
      throw new InputError("Incomplete Wav2Vec2 convolution mapping.");
    }
    receptiveFieldSamples += (kernel - 1) * totalStrideSamples;
    totalStrideSamples *= stride;
  }
  const intervals = Array.from({ length: expectedFrameCount }, (_, frame) => {
    const startSample = frame * totalStrideSamples;
    const endSample = Math.min(
      input.inputSamples,
      startSample + receptiveFieldSamples,
    );
    return {
      startSeconds: startSample / 16_000,
      endSeconds: endSample / 16_000,
    };
  });
  return {
    sampleRate: 16_000,
    convKernel: [...input.convKernel],
    convStride: [...input.convStride],
    totalStrideSamples,
    receptiveFieldSamples,
    expectedFrameCount,
    intervals,
    frameCountFormula: "iterated-valid-convolution-v1",
    frameIntervalPolicy: "receptive-field-clipped-v1",
  };
}

export interface CtcViterbiTokenFrames {
  targetIndex: number;
  tokenId: number;
  startFrame: number;
  endFrameExclusive: number;
  meanPosterior: number;
}

export type CtcViterbiResult =
  | {
      status: "success";
      statePath: number[];
      tokenFrames: CtcViterbiTokenFrames[];
      pathScore: number;
    }
  | {
      status: "no-valid-path" | "invalid-logits";
      statePath: [];
      tokenFrames: [];
      pathScore: null;
    };

function logProbabilityMatrixIsValid(matrix: readonly (readonly number[])[]) {
  if (matrix.length === 0) return false;
  const width = matrix[0]?.length ?? 0;
  return (
    width > 0 &&
    matrix.every(
      (row) =>
        row.length === width && row.every((value) => Number.isFinite(value)),
    )
  );
}

export function ctcViterbiAlign(input: {
  logProbabilities: readonly (readonly number[])[];
  targetTokenIds: readonly number[];
  blankTokenId: number;
}): CtcViterbiResult {
  if (!logProbabilityMatrixIsValid(input.logProbabilities)) {
    return {
      status: "invalid-logits",
      statePath: [],
      tokenFrames: [],
      pathScore: null,
    };
  }
  const frames = input.logProbabilities.length;
  const vocabularySize = input.logProbabilities[0]?.length ?? 0;
  if (
    !Number.isInteger(input.blankTokenId) ||
    input.blankTokenId < 0 ||
    input.blankTokenId >= vocabularySize ||
    input.targetTokenIds.some(
      (token) =>
        !Number.isInteger(token) || token < 0 || token >= vocabularySize,
    )
  ) {
    throw new InputError(
      "CTC target or blank token is outside the vocabulary.",
    );
  }
  if (input.targetTokenIds.length === 0) {
    return {
      status: "no-valid-path",
      statePath: [],
      tokenFrames: [],
      pathScore: null,
    };
  }
  const minimumFrames =
    input.targetTokenIds.length +
    input.targetTokenIds.slice(1).filter((token, index) => {
      return token === input.targetTokenIds[index];
    }).length;
  if (frames < minimumFrames) {
    return {
      status: "no-valid-path",
      statePath: [],
      tokenFrames: [],
      pathScore: null,
    };
  }
  const states = input.targetTokenIds.length * 2 + 1;
  const labels = Array.from({ length: states }, (_, state) =>
    state % 2 === 0
      ? input.blankTokenId
      : (input.targetTokenIds[(state - 1) / 2] ?? input.blankTokenId),
  );
  let previous = new Float64Array(states);
  previous.fill(Number.NEGATIVE_INFINITY);
  const backPointers = Array.from({ length: frames }, () =>
    new Int32Array(states).fill(-1),
  );
  previous[0] = input.logProbabilities[0]?.[input.blankTokenId] ?? -Infinity;
  if (states > 1) {
    previous[1] =
      input.logProbabilities[0]?.[input.targetTokenIds[0] ?? -1] ?? -Infinity;
  }
  for (let frame = 1; frame < frames; frame += 1) {
    const current = new Float64Array(states);
    current.fill(Number.NEGATIVE_INFINITY);
    for (let state = 0; state < states; state += 1) {
      let bestState = state;
      let bestScore = previous[state] ?? -Infinity;
      const advance = state - 1;
      if (advance >= 0 && (previous[advance] ?? -Infinity) > bestScore) {
        bestState = advance;
        bestScore = previous[advance] ?? -Infinity;
      }
      const skip = state - 2;
      const currentLabel = labels[state];
      const skipAllowed =
        skip >= 0 && state % 2 === 1 && currentLabel !== labels[skip];
      if (skipAllowed && (previous[skip] ?? -Infinity) > bestScore) {
        bestState = skip;
        bestScore = previous[skip] ?? -Infinity;
      }
      const emission =
        input.logProbabilities[frame]?.[currentLabel ?? -1] ?? -Infinity;
      if (Number.isFinite(bestScore) && Number.isFinite(emission)) {
        current[state] = bestScore + emission;
        backPointers[frame]?.set([bestState], state);
      }
    }
    previous = current;
  }
  const candidates = [states - 1, states - 2].filter((state) => state >= 0);
  let finalState = candidates[0] ?? -1;
  for (const candidate of candidates.slice(1)) {
    if (
      (previous[candidate] ?? -Infinity) > (previous[finalState] ?? -Infinity)
    ) {
      finalState = candidate;
    }
  }
  const finalScore = previous[finalState] ?? -Infinity;
  if (!Number.isFinite(finalScore)) {
    return {
      status: "no-valid-path",
      statePath: [],
      tokenFrames: [],
      pathScore: null,
    };
  }
  const statePath = new Array<number>(frames);
  let state = finalState;
  for (let frame = frames - 1; frame >= 0; frame -= 1) {
    statePath[frame] = state;
    if (frame > 0) {
      state = backPointers[frame]?.[state] ?? -1;
      if (state < 0) {
        return {
          status: "no-valid-path",
          statePath: [],
          tokenFrames: [],
          pathScore: null,
        };
      }
    }
  }
  const tokenFrames = input.targetTokenIds.map((tokenId, targetIndex) => {
    const tokenState = targetIndex * 2 + 1;
    const alignedFrames = statePath.flatMap((value, frame) =>
      value === tokenState ? [frame] : [],
    );
    if (alignedFrames.length === 0) {
      throw new InputError("CTC Viterbi backtrack omitted a target token.");
    }
    const posterior = alignedFrames.reduce((sum, frame) => {
      const logProbability =
        input.logProbabilities[frame]?.[tokenId] ?? Number.NEGATIVE_INFINITY;
      return sum + Math.exp(logProbability);
    }, 0);
    return {
      targetIndex,
      tokenId,
      startFrame: alignedFrames[0] ?? 0,
      endFrameExclusive: (alignedFrames.at(-1) ?? 0) + 1,
      meanPosterior: posterior / alignedFrames.length,
    };
  });
  return {
    status: "success",
    statePath,
    tokenFrames,
    pathScore: finalScore / frames,
  };
}

export function collapseCtcGreedyTokens(
  tokenIds: readonly number[],
  blankTokenId: number,
): number[] {
  const collapsed: number[] = [];
  let previous: number | null = null;
  for (const token of tokenIds) {
    if (token !== blankTokenId && token !== previous) collapsed.push(token);
    previous = token;
  }
  return collapsed;
}

export function assessCtcWindowStability(input: {
  narrow: { start: number; end: number } | null;
  expanded: { start: number; end: number } | null;
  thresholdSeconds?: number;
  narrowEdgePinned?: boolean;
  expandedEdgePinned?: boolean;
}): {
  startDeltaSeconds: number | null;
  endDeltaSeconds: number | null;
  startStable: boolean;
  endStable: boolean;
  stable: boolean;
  edgePinned: boolean;
} {
  const threshold = input.thresholdSeconds ?? 0.12;
  const edgePinned =
    input.narrowEdgePinned === true || input.expandedEdgePinned === true;
  if (input.narrow === null || input.expanded === null) {
    return {
      startDeltaSeconds: null,
      endDeltaSeconds: null,
      startStable: false,
      endStable: false,
      stable: false,
      edgePinned,
    };
  }
  const startDeltaSeconds = Math.abs(input.narrow.start - input.expanded.start);
  const endDeltaSeconds = Math.abs(input.narrow.end - input.expanded.end);
  const startStable = startDeltaSeconds <= threshold + 1e-9;
  const endStable = endDeltaSeconds <= threshold + 1e-9;
  return {
    startDeltaSeconds,
    endDeltaSeconds,
    startStable,
    endStable,
    stable: startStable && endStable && !edgePinned,
    edgePinned,
  };
}
