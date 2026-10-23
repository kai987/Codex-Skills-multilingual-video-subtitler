export interface RepetitionComparableCue {
  id: string;
  start: number;
  end: number;
  text: string;
  style?: "default" | "dialogue" | "thought" | "music" | undefined;
}

export interface RepetitionEvidence {
  normalizedCorePhrase: string;
  occurrences: number;
  contributingSegmentIds: string[];
  suffixVariants: string[];
  repeatedCharacterRatio: number;
}

const EDGE_INTERJECTION =
  "(?:ええ?|ああ?|へ[ぇえ]|まあ|あの|ほら|ねえ|なあ|おお)";
const EDGE_PARTICLE = "(?:え|あれ|へ[ぇえ]|ね|よ|さ|な)";

function stripAssAndMarkup(text: string): string {
  return text
    .replace(/\{[^}]*\}/gu, "")
    .replace(/\\N/giu, "\n")
    .replace(/<[^>]+>/gu, " ");
}

export function normalizeForRepetitionComparison(text: string): string {
  let normalized = stripAssAndMarkup(text)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[♪♫]/gu, " ")
    .trim();
  normalized = normalized
    .replace(
      new RegExp(
        `^[\\s、。，．,.!?！？…「」『』"'’‘（）()［\\][\\]{}]*(?:${EDGE_INTERJECTION})[\\s、。，．,.!?！？…]+`,
        "u",
      ),
      "",
    )
    .replace(
      new RegExp(
        `(?:${EDGE_PARTICLE})[\\s、。，．,.!?！？…「」『』"'’‘（）()［\\][\\]{}]*$`,
        "u",
      ),
      "",
    );
  return normalized.replace(
    /[\s、。，．,.!?！？…「」『』"'’‘（）()［\][\]{}:：;；・ー~～]/gu,
    "",
  );
}

export function normalizeForExactCueComparison(text: string): string {
  return stripAssAndMarkup(text)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[♪♫]/gu, " ")
    .replace(
      /[\s、。，．,.!?！？…「」『』"'’‘（）()［\][\]{}:：;；・ー~～]/gu,
      "",
    );
}

export function countNonOverlappingPhraseOccurrences(
  text: string,
  phrase: string,
): number {
  if (phrase === "") return 0;
  let count = 0;
  let offset = 0;
  while (offset <= text.length - phrase.length) {
    const found = text.indexOf(phrase, offset);
    if (found < 0) break;
    count += 1;
    offset = found + phrase.length;
  }
  return count;
}

export function longestCommonSubstring(left: string, right: string): string {
  const a = Array.from(left);
  const b = Array.from(right);
  if (a.length === 0 || b.length === 0) return "";
  let bestLength = 0;
  let bestEnd = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let leftIndex = 1; leftIndex <= a.length; leftIndex += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let rightIndex = 1; rightIndex <= b.length; rightIndex += 1) {
      if (a[leftIndex - 1] === b[rightIndex - 1]) {
        const length = (previous[rightIndex - 1] ?? 0) + 1;
        current[rightIndex] = length;
        if (length > bestLength) {
          bestLength = length;
          bestEnd = leftIndex;
        }
      }
    }
    previous = current;
  }
  return a.slice(bestEnd - bestLength, bestEnd).join("");
}

function suffixVariant(text: string, core: string): string {
  if (core === "") return text;
  return text.split(core).join("").slice(0, 24);
}

export function analyzeRepetitionWindow(
  cues: readonly RepetitionComparableCue[],
  minimumCoreLength = 8,
): RepetitionEvidence | null {
  const normalized = cues.map((cue) => ({
    id: cue.id,
    text: normalizeForRepetitionComparison(cue.text),
  }));
  const candidates = new Set<string>();
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      const leftText = normalized[left]?.text ?? "";
      const rightText = normalized[right]?.text ?? "";
      const common = longestCommonSubstring(leftText, rightText);
      const commonCharacters = Array.from(common);
      if (commonCharacters.length >= minimumCoreLength) {
        for (
          let start = 0;
          start <= commonCharacters.length - minimumCoreLength;
          start += 1
        ) {
          for (
            let length = minimumCoreLength;
            start + length <= commonCharacters.length;
            length += 1
          ) {
            candidates.add(
              commonCharacters.slice(start, start + length).join(""),
            );
          }
        }
      }
    }
  }
  const totalCharacters = normalized.reduce(
    (total, item) => total + Array.from(item.text).length,
    0,
  );
  const scored = [...candidates].map((candidate) => {
    const occurrencesByCue = normalized.map((item) =>
      countNonOverlappingPhraseOccurrences(item.text, candidate),
    );
    const occurrences = occurrencesByCue.reduce(
      (total, current) => total + current,
      0,
    );
    const contributingCueCount = occurrencesByCue.filter(
      (current) => current > 0,
    ).length;
    const repeatedCharacterRatio =
      totalCharacters === 0
        ? 0
        : Math.min(
            totalCharacters,
            occurrences * Array.from(candidate).length,
          ) / totalCharacters;
    return {
      candidate,
      occurrences,
      contributingCueCount,
      repeatedCharacterRatio,
    };
  });
  const selectedScore = scored.toSorted(
    (left, right) =>
      Number(right.occurrences >= 3) - Number(left.occurrences >= 3) ||
      right.repeatedCharacterRatio - left.repeatedCharacterRatio ||
      right.contributingCueCount - left.contributingCueCount ||
      Array.from(right.candidate).length - Array.from(left.candidate).length ||
      left.candidate.localeCompare(right.candidate),
  )[0];
  if (selectedScore === undefined) return null;
  const selected = selectedScore.candidate;
  const occurrencesByCue = normalized.map((item) =>
    countNonOverlappingPhraseOccurrences(item.text, selected),
  );
  const contributingSegmentIds = normalized.flatMap((item, index) =>
    (occurrencesByCue[index] ?? 0) > 0 ? [item.id] : [],
  );
  const occurrences = occurrencesByCue.reduce(
    (total, current) => total + current,
    0,
  );
  const repeatedCharacters = Math.min(
    totalCharacters,
    occurrences * Array.from(selected).length,
  );
  return {
    normalizedCorePhrase: selected,
    occurrences,
    contributingSegmentIds,
    suffixVariants: [
      ...new Set(
        normalized
          .filter((item) => item.text.includes(selected))
          .map((item) => suffixVariant(item.text, selected)),
      ),
    ],
    repeatedCharacterRatio:
      totalCharacters === 0 ? 0 : repeatedCharacters / totalCharacters,
  };
}

export function isHighContainmentRepetition(
  left: string,
  right: string,
  minimumCoreLength = 8,
  minimumContainment = 0.8,
): boolean {
  const normalizedLeft = normalizeForRepetitionComparison(left);
  const normalizedRight = normalizeForRepetitionComparison(right);
  const common = longestCommonSubstring(normalizedLeft, normalizedRight);
  const coreLength = Array.from(common).length;
  const shorterLength = Math.min(
    Array.from(normalizedLeft).length,
    Array.from(normalizedRight).length,
  );
  return (
    coreLength >= minimumCoreLength &&
    shorterLength > 0 &&
    coreLength / shorterLength >= minimumContainment
  );
}

export function detectSingleCueDuplicateLines(
  cue: RepetitionComparableCue,
): RepetitionEvidence | null {
  const lines = stripAssAndMarkup(cue.text)
    .split(/\r?\n/u)
    .map(normalizeForRepetitionComparison)
    .filter(Boolean);
  if (lines.length < 2 || lines[0] !== lines[1]) return null;
  const core = lines[0] ?? "";
  if (core === "") return null;
  return {
    normalizedCorePhrase: core,
    occurrences: 2,
    contributingSegmentIds: [cue.id],
    suffixVariants: [""],
    repeatedCharacterRatio: 1,
  };
}

export function detectCrossCueRepetitionWindows(input: {
  cues: readonly RepetitionComparableCue[];
  minimumCoreLength?: number;
  minimumOccurrences?: number;
  maximumWindowCues?: number;
  maximumWindowSeconds?: number;
}): {
  interval: { start: number; end: number };
  cueIds: string[];
  evidence: RepetitionEvidence;
}[] {
  const minimumCoreLength = input.minimumCoreLength ?? 8;
  const minimumOccurrences = input.minimumOccurrences ?? 3;
  const maximumWindowCues = Math.min(6, input.maximumWindowCues ?? 6);
  const maximumWindowSeconds = input.maximumWindowSeconds ?? 20;
  const sorted = [...input.cues].toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const candidates: {
    interval: { start: number; end: number };
    cueIds: string[];
    evidence: RepetitionEvidence;
  }[] = [];
  for (let start = 0; start < sorted.length; start += 1) {
    for (
      let size = 2;
      size <= maximumWindowCues && start + size <= sorted.length;
      size += 1
    ) {
      const window = sorted.slice(start, start + size);
      const first = window[0];
      const last = window.at(-1);
      if (
        first === undefined ||
        last === undefined ||
        last.end - first.start > maximumWindowSeconds
      ) {
        break;
      }
      const evidence = analyzeRepetitionWindow(window, minimumCoreLength);
      if (
        evidence === null ||
        evidence.occurrences < minimumOccurrences ||
        evidence.contributingSegmentIds.length < 2
      ) {
        continue;
      }
      const contributing = window.filter((cue) =>
        evidence.contributingSegmentIds.includes(cue.id),
      );
      const contributingFirst = contributing[0] ?? first;
      const contributingLast = contributing.at(-1) ?? last;
      candidates.push({
        interval: {
          start: contributingFirst.start,
          end: contributingLast.end,
        },
        cueIds: evidence.contributingSegmentIds,
        evidence,
      });
    }
  }
  return candidates.filter((candidate, index) => {
    return !candidates.some((other, otherIndex) => {
      if (index === otherIndex) return false;
      const sameCore =
        other.evidence.normalizedCorePhrase.includes(
          candidate.evidence.normalizedCorePhrase,
        ) ||
        candidate.evidence.normalizedCorePhrase.includes(
          other.evidence.normalizedCorePhrase,
        );
      const contains =
        other.interval.start <= candidate.interval.start &&
        other.interval.end >= candidate.interval.end;
      const exactDuplicate =
        other.evidence.normalizedCorePhrase ===
          candidate.evidence.normalizedCorePhrase &&
        other.interval.start === candidate.interval.start &&
        other.interval.end === candidate.interval.end &&
        other.cueIds.join("\u0000") === candidate.cueIds.join("\u0000");
      return (
        (exactDuplicate && otherIndex < index) ||
        (sameCore &&
          contains &&
          (other.evidence.occurrences > candidate.evidence.occurrences ||
            other.cueIds.length > candidate.cueIds.length))
      );
    });
  });
}

export function detectRepeatedCueSequenceWindows(input: {
  cues: readonly RepetitionComparableCue[];
  minimumCoreLength?: number;
  minimumContainment?: number;
  maximumWindowCues?: number;
  maximumWindowSeconds?: number;
}): {
  interval: { start: number; end: number };
  cueIds: string[];
  duplicateCueIds: string[];
  evidence: RepetitionEvidence;
  exactSequence: boolean;
}[] {
  const minimumCoreLength = input.minimumCoreLength ?? 8;
  const minimumContainment = input.minimumContainment ?? 0.8;
  const maximumWindowCues = Math.min(6, input.maximumWindowCues ?? 6);
  const maximumWindowSeconds = input.maximumWindowSeconds ?? 20;
  const sorted = [...input.cues].toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const candidates: {
    interval: { start: number; end: number };
    cueIds: string[];
    duplicateCueIds: string[];
    evidence: RepetitionEvidence;
    exactSequence: boolean;
  }[] = [];

  for (let start = 0; start < sorted.length; start += 1) {
    for (
      let size = 2;
      size <= maximumWindowCues && start + size <= sorted.length;
      size += 1
    ) {
      const window = sorted.slice(start, start + size);
      const first = window[0];
      const last = window.at(-1);
      if (
        first === undefined ||
        last === undefined ||
        last.end - first.start > maximumWindowSeconds
      ) {
        break;
      }
      for (let split = 1; split < window.length; split += 1) {
        const originalBlock = window.slice(0, split);
        const repeatedBlock = window.slice(split);
        const originalText = originalBlock
          .map((cue) => normalizeForExactCueComparison(cue.text))
          .join("");
        const repeatedText = repeatedBlock
          .map((cue) => normalizeForExactCueComparison(cue.text))
          .join("");
        if (originalText === "" || repeatedText === "") continue;
        const common = longestCommonSubstring(originalText, repeatedText);
        const commonLength = Array.from(common).length;
        const longerLength = Math.max(
          Array.from(originalText).length,
          Array.from(repeatedText).length,
        );
        if (
          commonLength < minimumCoreLength ||
          longerLength === 0 ||
          commonLength / longerLength < minimumContainment
        ) {
          continue;
        }
        const exactSequence = originalText === repeatedText;
        if (window.length === 2 && exactSequence) {
          continue;
        }
        const totalCharacters =
          Array.from(originalText).length + Array.from(repeatedText).length;
        candidates.push({
          interval: { start: first.start, end: last.end },
          cueIds: window.map((cue) => cue.id),
          duplicateCueIds: repeatedBlock.map((cue) => cue.id),
          evidence: {
            normalizedCorePhrase: common,
            occurrences: 2,
            contributingSegmentIds: window.map((cue) => cue.id),
            suffixVariants: [
              ...new Set([
                suffixVariant(originalText, common),
                suffixVariant(repeatedText, common),
              ]),
            ],
            repeatedCharacterRatio:
              totalCharacters === 0
                ? 0
                : Math.min(totalCharacters, commonLength * 2) / totalCharacters,
          },
          exactSequence,
        });
      }
    }
  }

  const ranked = candidates.toSorted(
    (left, right) =>
      Number(right.exactSequence) - Number(left.exactSequence) ||
      Array.from(right.evidence.normalizedCorePhrase).length -
        Array.from(left.evidence.normalizedCorePhrase).length ||
      right.evidence.repeatedCharacterRatio -
        left.evidence.repeatedCharacterRatio ||
      right.cueIds.length - left.cueIds.length ||
      left.interval.start - right.interval.start ||
      left.interval.end - right.interval.end,
  );
  const selected: typeof candidates = [];
  for (const candidate of ranked) {
    const duplicateIds = new Set(candidate.duplicateCueIds);
    const redundant = selected.some((accepted) => {
      const intervalsOverlap =
        accepted.interval.start < candidate.interval.end &&
        candidate.interval.start < accepted.interval.end;
      const relatedCore =
        accepted.evidence.normalizedCorePhrase.includes(
          candidate.evidence.normalizedCorePhrase,
        ) ||
        candidate.evidence.normalizedCorePhrase.includes(
          accepted.evidence.normalizedCorePhrase,
        );
      const relatedDuplicateBlock = accepted.duplicateCueIds.some((id) =>
        duplicateIds.has(id),
      );
      return intervalsOverlap && relatedCore && relatedDuplicateBlock;
    });
    if (!redundant) selected.push(candidate);
  }
  return selected.toSorted(
    (left, right) =>
      left.interval.start - right.interval.start ||
      left.interval.end - right.interval.end,
  );
}
