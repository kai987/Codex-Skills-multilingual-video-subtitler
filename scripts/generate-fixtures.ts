import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeProcessRunner, assertExecutable } from "@mvl/shared";

const runner = new NodeProcessRunner();

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function generate(
  ffmpegPath: string,
  outputPath: string,
  args: readonly string[],
): Promise<void> {
  if (await exists(outputPath)) return;
  await runner.run(ffmpegPath, [...args, "-y", outputPath]);
}

export async function generateFixtures(
  fixtureRoot = path.resolve("tests/fixtures"),
  ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg",
): Promise<string> {
  await assertExecutable(runner, ffmpegPath);
  const output = path.join(fixtureRoot, "generated");
  await mkdir(output, { recursive: true });
  const subtitle = path.join(fixtureRoot, "sample-ja.srt");

  await generate(
    ffmpegPath,
    path.join(output, "embedded-subtitle-sample.mkv"),
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x203040:s=320x180:d=2:r=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=2",
      "-f",
      "srt",
      "-i",
      subtitle,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-map",
      "2:s:0",
      "-c:v",
      "mpeg4",
      "-q:v",
      "8",
      "-c:a",
      "aac",
      "-c:s",
      "srt",
      "-metadata:s:a:0",
      "language=jpn",
      "-metadata:s:s:0",
      "language=jpn",
      "-disposition:s:0",
      "default",
      "-shortest",
    ],
  );

  const basicVideo = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x405060:s=320x180:d=2:r=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:sample_rate=48000:duration=2",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "mpeg4",
    "-q:v",
    "8",
    "-c:a",
    "aac",
    "-shortest",
  ] as const;
  await generate(ffmpegPath, path.join(output, "short-ja-en-video.mp4"), [
    ...basicVideo,
    "-metadata:s:a:0",
    "language=jpn",
  ]);
  await generate(ffmpegPath, path.join(output, "中文 日本語 (sample).mp4"), [
    ...basicVideo,
    "-metadata:s:a:0",
    "language=zho",
  ]);
  await generate(ffmpegPath, path.join(output, "short-sample.mov"), [
    ...basicVideo,
    "-metadata:s:a:0",
    "language=eng",
  ]);
  await generate(ffmpegPath, path.join(output, "short-sample.webm"), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x304050:s=320x180:d=2:r=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=550:sample_rate=48000:duration=2",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libvpx-vp9",
    "-b:v",
    "120k",
    "-c:a",
    "libopus",
    "-shortest",
  ]);
  await generate(ffmpegPath, path.join(output, "multi-audio-sample.mkv"), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x506070:s=320x180:d=2:r=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=48000:duration=2",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-map",
    "2:a:0",
    "-c:v",
    "mpeg4",
    "-q:v",
    "8",
    "-c:a",
    "aac",
    "-metadata:s:a:0",
    "language=jpn",
    "-metadata:s:a:1",
    "language=eng",
    "-shortest",
  ]);

  await generate(ffmpegPath, path.join(output, "adaptive-long-sparse.mp4"), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x202830:s=160x90:d=65:r=1",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=if(lt(t\\,5)\\,0.2*sin(2*PI*440*t)\\,0):s=16000:d=65",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "mpeg4",
    "-q:v",
    "12",
    "-c:a",
    "aac",
    "-metadata:s:a:0",
    "language=jpn",
    "-shortest",
  ]);
  await generate(ffmpegPath, path.join(output, "adaptive-noisy-music.mp4"), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x301820:s=160x90:d=6:r=12",
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=color=pink:amplitude=0.2:d=6:r=16000",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "mpeg4",
    "-q:v",
    "12",
    "-c:a",
    "aac",
    "-metadata:s:a:0",
    "language=jpn",
    "-shortest",
  ]);

  const workerBatchDirectory = path.join(output, "whisper-worker-batch");
  await mkdir(workerBatchDirectory, { recursive: true });
  for (let index = 0; index < 12; index += 1) {
    await generate(
      ffmpegPath,
      path.join(
        workerBatchDirectory,
        `request-${String(index + 1).padStart(2, "0")}.wav`,
      ),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${String(400 + index * 20)}:sample_rate=16000:duration=0.2`,
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
      ],
    );
  }

  const transport = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x180:rate=24:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:sample_rate=48000:duration=2",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "mpeg2video",
    "-c:a",
    "mp2",
    "-f",
    "mpegts",
    "-shortest",
  ] as const;
  await generate(
    ffmpegPath,
    path.join(output, "short-transport-stream.ts"),
    transport,
  );
  await generate(ffmpegPath, path.join(output, "short-transport-stream.m2ts"), [
    ...transport,
    "-mpegts_m2ts_mode",
    "1",
  ]);
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = await generateFixtures();
  console.log(`Synthetic fixtures are ready in ${output}.`);
}
