import type { GroupedProjectedToken } from "@mvl/shared";

import { machineQualitySemanticHash } from "./evidence-correlation.js";
import type { CoreSpanInterval } from "./core-acoustic-span.js";

export interface ProjectableTokenInput {
  tokenId: string;
  text: string;
  interval: CoreSpanInterval | null;
  mappingVerified: boolean;
  lexical: boolean;
  probability: number | null;
  groupId?: string;
}

function validInterval(
  value: CoreSpanInterval | null,
): value is CoreSpanInterval {
  return (
    value !== null &&
    Number.isFinite(value.start) &&
    Number.isFinite(value.end) &&
    value.start >= 0 &&
    value.end > value.start
  );
}

/**
 * Preserves every decoder child token and its own interval. A caller may give
 * multiple child tokens the same groupId when a decoder word was split into
 * byte-pair pieces. No character-ratio timing is introduced here.
 */
export function groupProjectableTokens(
  tokens: readonly ProjectableTokenInput[],
): GroupedProjectedToken[] {
  const groups: {
    groupId: string;
    tokens: ProjectableTokenInput[];
  }[] = [];
  for (const [index, token] of tokens.entries()) {
    if (!token.lexical) continue;
    const groupId =
      token.groupId ?? `token-group-${String(index).padStart(4, "0")}`;
    const previous = groups.at(-1);
    if (previous?.groupId === groupId) {
      previous.tokens.push(token);
    } else {
      groups.push({ groupId, tokens: [token] });
    }
  }
  return groups.map((group) => {
    const intervals = group.tokens.flatMap((token) =>
      validInterval(token.interval) ? [token.interval] : [],
    );
    const allVerified = group.tokens.every(
      (token) => token.mappingVerified && validInterval(token.interval),
    );
    const someVerified = group.tokens.some(
      (token) => token.mappingVerified && validInterval(token.interval),
    );
    const core = {
      groupId: group.groupId,
      text: group.tokens.map((token) => token.text).join(""),
      interval:
        intervals.length === 0
          ? null
          : {
              start: Math.min(...intervals.map((value) => value.start)),
              end: Math.max(...intervals.map((value) => value.end)),
            },
      childTokenIds: group.tokens.map((token) => token.tokenId),
      childIntervals: group.tokens.map((token) => token.interval),
      mappingStatus: allVerified
        ? ("VERIFIED_CHILDREN" as const)
        : someVerified
          ? ("PARTIAL_CHILDREN" as const)
          : ("UNMAPPED" as const),
    };
    return { ...core, semanticHash: machineQualitySemanticHash(core) };
  });
}

export function candidateIntervalWholeGroup(input: {
  candidateId: string;
  text: string;
  interval: CoreSpanInterval;
}): GroupedProjectedToken {
  const core = {
    groupId: `candidate-interval:${input.candidateId}`,
    text: input.text,
    interval: input.interval,
    childTokenIds: [`candidate-interval:${input.candidateId}`],
    childIntervals: [input.interval],
    mappingStatus: "CANDIDATE_INTERVAL_WHOLE" as const,
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}
