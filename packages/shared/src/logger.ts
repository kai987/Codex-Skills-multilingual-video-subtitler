export type LogLevel = "debug" | "info" | "warning" | "error";

export interface LogRecord {
  level: LogLevel;
  message: string;
  time: string;
  details?: Readonly<Record<string, unknown>>;
}

export interface Logger {
  log(
    level: LogLevel,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ): void;
}

export class ConsoleLogger implements Logger {
  constructor(
    private readonly json = false,
    private readonly minimumLevel: LogLevel = "info",
  ) {}

  log(
    level: LogLevel,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ): void {
    const priorities: Readonly<Record<LogLevel, number>> = {
      debug: 10,
      info: 20,
      warning: 30,
      error: 40,
    };
    if (priorities[level] < priorities[this.minimumLevel]) return;
    const record: LogRecord = {
      level,
      message,
      time: new Date().toISOString(),
      ...(details === undefined ? {} : { details }),
    };
    const output = this.json
      ? JSON.stringify(record)
      : `[${level}] ${message}${details === undefined ? "" : ` ${JSON.stringify(details)}`}`;
    const sink =
      level === "error" || level === "warning" ? console.error : console.log;
    sink(output);
  }
}

export class MemoryLogger implements Logger {
  readonly records: LogRecord[] = [];

  log(
    level: LogLevel,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ): void {
    this.records.push({
      level,
      message,
      time: new Date().toISOString(),
      ...(details === undefined ? {} : { details }),
    });
  }
}
