import { readFile, mkdir, open } from "node:fs/promises";
import path from "node:path";
import {
  NodeProcessRunner,
  c601141AudioViewsSchema,
  type C60114SourceIdentity,
  type C601141Policy,
  type C601141AudioView,
} from "@mvl/shared";
import { hash141, hashed141, header141, id141 } from "./c601141-policy.js";
import { bytesHash141, pcm141, wav141, durableJson141 } from "./c601141-io.js";

export function viewRecipes141(layout: string, channels: number) {
  const mid = channels >= 2 ? "pan=mono|c0=0.5*c0+0.5*c1" : "pan=mono|c0=c0";
  const center =
    layout.includes("5.1") || layout.includes("7.1") ? "pan=mono|c0=FC" : mid;
  const native = channels <= 2 ? mid : "aformat=channel_layouts=mono";
  const tail = "aresample=16000,asetpts=N/SR/TB";
  return [
    { role: "NATIVE_MONO" as const, filterGraph: `${native},${tail}` },
    ...(channels >= 2
      ? [
          { role: "LEFT" as const, filterGraph: `pan=mono|c0=c0,${tail}` },
          { role: "RIGHT" as const, filterGraph: `pan=mono|c0=c1,${tail}` },
        ]
      : []),
    { role: "CENTER_OR_MID" as const, filterGraph: `${center},${tail}` },
    {
      role: "VOICE_BAND_CENTER" as const,
      filterGraph: `${center},aresample=16000,highpass=f=120:p=1,lowpass=f=3800:p=1,acompressor=threshold=0.125:ratio=1.5:attack=5:release=50:makeup=1,asetpts=N/SR/TB`,
    },
  ];
}
/** Structural delay is tested on generated impulses before decoding real data.
 * Amplitude/frequency changes are not described as text/timing evidence. */
export async function validateAudioViews141(input: {
  directory: string;
  ffmpeg?: string;
  nativeSampleRate: number;
}) {
  await mkdir(input.directory, { recursive: true });
  const rate = input.nativeSampleRate;
  const frames = rate * 3,
    data = Buffer.alloc(frames * 4);
  const markers = [
    Math.round(rate * 0.25),
    Math.round(rate * 1.5),
    Math.round(rate * 2.75),
  ];
  for (const marker of markers)
    for (let c = 0; c < 2; c++) data.writeInt16LE(25000, marker * 4 + c * 2);
  const original = path.join(input.directory, "stereo-impulses.wav");
  const file = await open(original, "wx");
  try {
    await file.writeFile(wav141(data, rate, 2));
  } finally {
    await file.close();
  }
  const runner = new NodeProcessRunner();
  const results = [];
  for (const recipe of viewRecipes141("stereo", 2)) {
    const output = path.join(
      input.directory,
      `${recipe.role.toLowerCase()}.wav`,
    );
    await runner.run(
      input.ffmpeg ?? "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-n",
        "-i",
        original,
        "-af",
        recipe.filterGraph,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        output,
      ],
      { timeoutMs: 30000 },
    );
    const wave = pcm141(await readFile(output));
    const delays = markers.map((marker) => {
      const expected = Math.round((marker * 16000) / rate);
      let peak = expected,
        amplitude = 0;
      for (let p = expected - 32; p <= expected + 32; p++) {
        const value = Math.abs(wave.pcm.readInt16LE(p * 2));
        if (value > amplitude) {
          amplitude = value;
          peak = p;
        }
      }
      if (!amplitude) throw new Error("C601141_IMPULSE_NOT_FOUND");
      return peak - expected;
    });
    if (
      wave.frames !== 48000 ||
      wave.channels !== 1 ||
      delays.some((v) => v !== 0)
    )
      throw new Error(
        `C601141_UNEXPLAINED_VIEW_DELAY:${recipe.role}:${delays.join(",")}`,
      );
    results.push({
      role: recipe.role,
      frameCount: wave.frames,
      impulsePeakDelays: delays,
      sourceFrameCount: frames,
      rationalMapping: { numerator: rate, denominator: 16000 },
      ptsResetPreservesSourceOrigin: true,
    });
  }
  const controls = hashed141({
    schemaVersion: "1.0.0",
    artifactType: "c6-0-1-14-1-audio-view-synthetic-controls",
    results,
    passed: true,
  });
  await durableJson141(
    path.join(input.directory, "audio-view-synthetic-controls.json"),
    controls,
  );
  return controls;
}
export async function buildAudioViews141(input: {
  sourcePath: string;
  source: C60114SourceIdentity;
  policy: C601141Policy;
  outputDirectory: string;
  ffmpeg?: string;
  ffprobe?: string;
  syntheticValidationHash: string;
}) {
  const runner = new NodeProcessRunner();
  const probe = await runner.run(
    input.ffprobe ?? "ffprobe",
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      input.sourcePath,
    ],
    { timeoutMs: 30000 },
  );
  const metadata = JSON.parse(probe.stdout) as {
    streams: {
      index: number;
      codec_type: string;
      sample_rate?: string;
      channels?: number;
      channel_layout?: string;
      start_time?: string;
      time_base?: string;
    }[];
  };
  const stream = metadata.streams.find(
    (v) =>
      v.codec_type === "audio" && v.index === input.source.audioStreamIndex,
  );
  if (
    !stream ||
    Number(stream.sample_rate) !== input.source.sampleRate ||
    stream.time_base !== input.source.audioTimebase
  )
    throw new Error("C601141_AUDIO_STREAM_IDENTITY_MISMATCH");
  const pts = Number(stream.start_time ?? 0);
  if (!Number.isFinite(pts) || pts < 0)
    throw new Error("C601141_UNRESOLVED_SOURCE_PTS");
  const version = await runner.run(input.ffmpeg ?? "ffmpeg", ["-version"], {
    timeoutMs: 30000,
  });
  const ffmpegIdentity = hash141(version.stdout);
  const layout = stream.channel_layout ?? `${stream.channels ?? 1}channels`;
  const views: C601141AudioView[] = [];
  const pcmSeen = new Map<string, string>();
  await mkdir(input.outputDirectory, { recursive: true });
  for (const recipe of viewRecipes141(layout, stream.channels ?? 1)) {
    const relativePath = `${recipe.role.toLowerCase()}.wav`,
      file = path.join(input.outputDirectory, relativePath);
    const args = [
      "-nostdin",
      "-v",
      "error",
      "-n",
      "-i",
      input.sourcePath,
      "-map",
      `0:${stream.index}`,
      "-vn",
      "-af",
      recipe.filterGraph,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      file,
    ];
    await runner.run(input.ffmpeg ?? "ffmpeg", args, { timeoutMs: 300000 });
    const bytes = await readFile(file),
      wave = pcm141(bytes),
      pcmSha256 = bytesHash141(wave.pcm);
    if (
      wave.channels !== 1 ||
      wave.sampleRate !== 16000 ||
      Math.abs(wave.frames / 16000 + pts - input.source.durationSeconds) > 0.05
    )
      throw new Error("C601141_AUDIO_VIEW_FRAME_OR_DURATION_MISMATCH");
    const viewId = id141("audio-view", [
      input.source.sourceMediaSha256,
      recipe.role,
      pcmSha256,
    ]);
    const duplicateOfViewId = pcmSeen.get(pcmSha256) ?? null;
    if (!duplicateOfViewId) pcmSeen.set(pcmSha256, viewId);
    views.push(
      hashed141({
        viewId,
        role: recipe.role,
        sourceAudioStreamIndex: stream.index,
        nativeSampleRate: input.source.sampleRate,
        nativeChannelLayout: layout,
        sourcePtsStartSeconds: pts,
        filterGraph: recipe.filterGraph,
        decodeCommandIdentity: hash141({
          ffmpegIdentity,
          sourceSha256: input.source.sourceMediaSha256,
          audioStreamIndex: stream.index,
          filterGraph: recipe.filterGraph,
          sampleRate: 16000,
          channels: 1,
          bitDepth: 16,
        }),
        ffmpegIdentity,
        relativePath,
        sampleRate: 16000,
        channels: 1,
        bitDepth: 16,
        frameCount: wave.frames,
        durationSeconds: wave.frames / 16000,
        audioSha256: bytesHash141(bytes),
        pcmSha256,
        timeMapping: {
          sourceStartSample: Math.round(pts * input.source.sampleRate),
          sourceSampleRate: input.source.sampleRate,
          outputSampleRate: 16000,
          numerator: input.source.sampleRate,
          denominator: 16000,
          outputStartSample: 0,
          mappingStatus: "VERIFIED_INTEGER_RATIONAL",
          measuredImpulsePeakDelaySamples: 0,
          syntheticValidationHash: input.syntheticValidationHash,
        },
        duplicateOfViewId,
        detectorEligible: !duplicateOfViewId,
      }),
    );
  }
  return c601141AudioViewsSchema.parse(
    hashed141({
      ...header141(input.policy, input.source),
      artifactType: "machine-source-audio-views-v1",
      views,
      summary: {
        viewCount: views.length,
        uniquePcmViewCount: pcmSeen.size,
        rejectedCount: 0,
      },
    }),
  );
}
