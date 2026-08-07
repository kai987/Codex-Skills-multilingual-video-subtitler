import path from "node:path";

import {
  atomicWriteJson,
  canonicalAsrSegmentsArtifactSchema,
  readJson,
  transcriptionQualitySchema,
} from "@mvl/shared";

interface Interval {
  start: number;
  end: number;
}

function normalized(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s、。，,.!?！？…]/gu, "");
}

function unionDuration(intervals: readonly Interval[]): number {
  const merged: Interval[] = [];
  for (const interval of intervals.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  )) {
    const previous = merged.at(-1);
    if (previous !== undefined && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged.reduce(
    (sum, interval) => sum + interval.end - interval.start,
    0,
  );
}

function overlapSeconds(left: Interval, right: Interval): number {
  return Math.max(
    0,
    Math.min(left.end, right.end) - Math.max(left.start, right.start),
  );
}

function timingOverlap(
  left: readonly Interval[],
  right: readonly Interval[],
): number {
  const intersection = left.reduce(
    (sum, item) =>
      sum +
      right.reduce(
        (inner, candidate) => inner + overlapSeconds(item, candidate),
        0,
      ),
    0,
  );
  const union =
    unionDuration(left) +
    unionDuration(right) -
    Math.min(intersection, unionDuration(left), unionDuration(right));
  return union <= 0 ? 1 : Math.min(1, intersection / union);
}

async function main(): Promise<void> {
  const [
    cliCanonicalPath,
    serverCanonicalPath,
    cliQualityPath,
    serverQualityPath,
    outputPath,
  ] = process.argv.slice(2);
  if (
    cliCanonicalPath === undefined ||
    serverCanonicalPath === undefined ||
    cliQualityPath === undefined ||
    serverQualityPath === undefined ||
    outputPath === undefined
  ) {
    throw new Error(
      "Usage: npx tsx scripts/asr-segmentation-parity.ts <cli-canonical.json> <server-canonical.json> <cli-quality.json> <server-quality.json> <output.json>",
    );
  }
  const [cli, server, cliQuality, serverQuality] = await Promise.all([
    readJson(path.resolve(cliCanonicalPath)).then((value) =>
      canonicalAsrSegmentsArtifactSchema.parse(value),
    ),
    readJson(path.resolve(serverCanonicalPath)).then((value) =>
      canonicalAsrSegmentsArtifactSchema.parse(value),
    ),
    readJson(path.resolve(cliQualityPath)).then((value) =>
      transcriptionQualitySchema.parse(value),
    ),
    readJson(path.resolve(serverQualityPath)).then((value) =>
      transcriptionQualitySchema.parse(value),
    ),
  ]);
  const cliText = normalized(cli.utterances.map((item) => item.text).join(""));
  const serverText = normalized(
    server.utterances.map((item) => item.text).join(""),
  );
  const maximumLength = Math.max(1, cliText.length, serverText.length);
  let equalCharacters = 0;
  const minimumLength = Math.min(cliText.length, serverText.length);
  for (let index = 0; index < minimumLength; index += 1) {
    if (cliText[index] === serverText[index]) equalCharacters += 1;
  }
  const qualityFindingCount = (quality: typeof cliQuality): number =>
    quality.segments.filter((segment) => segment.reasons.length > 0).length;
  const report = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    cli: {
      sourceAdapter: cli.sourceAdapter,
      rawSegmentCount: cli.rawSegmentCount,
      canonicalUtteranceCount: cli.canonicalUtteranceCount,
      normalizedCanonicalCharacters: cliText.length,
      speechCoverageSeconds: unionDuration(cli.utterances),
      qualityFindingCount: qualityFindingCount(cliQuality),
    },
    server: {
      sourceAdapter: server.sourceAdapter,
      rawSegmentCount: server.rawSegmentCount,
      canonicalUtteranceCount: server.canonicalUtteranceCount,
      normalizedCanonicalCharacters: serverText.length,
      speechCoverageSeconds: unionDuration(server.utterances),
      qualityFindingCount: qualityFindingCount(serverQuality),
    },
    comparison: {
      normalizedCanonicalTextPositionAgreement: equalCharacters / maximumLength,
      canonicalCountDifference: Math.abs(
        cli.canonicalUtteranceCount - server.canonicalUtteranceCount,
      ),
      canonicalCountRatio:
        Math.min(cli.canonicalUtteranceCount, server.canonicalUtteranceCount) /
        Math.max(
          1,
          cli.canonicalUtteranceCount,
          server.canonicalUtteranceCount,
        ),
      timingCoverageOverlap: timingOverlap(cli.utterances, server.utterances),
      qualityFindingDifference: Math.abs(
        qualityFindingCount(cliQuality) - qualityFindingCount(serverQuality),
      ),
    },
  };
  await atomicWriteJson(path.resolve(outputPath), report, { overwrite: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
