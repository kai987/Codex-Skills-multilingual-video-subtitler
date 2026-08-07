import { InputError } from "@mvl/shared";

export function parseClock(value: string, line: number): number {
  const match = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/u.exec(
    value.trim(),
  );
  if (match === null) {
    throw new InputError(
      `Invalid subtitle timestamp at line ${line}: ${value}`,
      {
        line,
        value,
      },
    );
  }
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = Number((match[4] ?? "0").padEnd(3, "0").slice(0, 3));
  if (minutes > 59 || seconds > 59) {
    throw new InputError(
      `Out-of-range subtitle timestamp at line ${line}: ${value}`,
      {
        line,
        value,
      },
    );
  }
  return hours * 3_600 + minutes * 60 + seconds + fraction / 1_000;
}

export function parseAssClock(value: string, line: number): number {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})[.](\d{1,2})$/u.exec(value.trim());
  if (match === null) {
    throw new InputError(`Invalid ASS timestamp at line ${line}: ${value}`, {
      line,
      value,
    });
  }
  return (
    Number(match[1]) * 3_600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 100
  );
}

function clockParts(seconds: number): {
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
} {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1_000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1_000);
  const milliseconds = totalMilliseconds % 1_000;
  return { hours, minutes, seconds: wholeSeconds, milliseconds };
}

export function formatSrtClock(seconds: number): string {
  const parts = clockParts(seconds);
  return `${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")}:${String(parts.seconds).padStart(2, "0")},${String(parts.milliseconds).padStart(3, "0")}`;
}

export function formatVttClock(seconds: number): string {
  return formatSrtClock(seconds).replace(",", ".");
}

export function formatAssClock(seconds: number): string {
  const parts = clockParts(seconds);
  const centiseconds = Math.round(parts.milliseconds / 10);
  return `${parts.hours}:${String(parts.minutes).padStart(2, "0")}:${String(parts.seconds).padStart(2, "0")}.${String(Math.min(99, centiseconds)).padStart(2, "0")}`;
}
