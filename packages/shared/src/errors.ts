export type ErrorDetails = Readonly<Record<string, unknown>>;

export class AppError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details: ErrorDetails;

  constructor(
    message: string,
    options: {
      code: string;
      exitCode?: number;
      details?: ErrorDetails;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details ?? {};
  }
}

export class InputError extends AppError {
  constructor(message: string, details?: ErrorDetails) {
    super(message, {
      code: "INVALID_INPUT",
      exitCode: 2,
      ...(details === undefined ? {} : { details }),
    });
  }
}

export class UserActionRequiredError extends AppError {
  constructor(message: string, details?: ErrorDetails) {
    super(message, {
      code: "USER_ACTION_REQUIRED",
      exitCode: 2,
      ...(details === undefined ? {} : { details }),
    });
  }
}

export class OutputExistsError extends AppError {
  constructor(path: string) {
    super(`Refusing to overwrite existing output: ${path}`, {
      code: "OUTPUT_EXISTS",
      exitCode: 3,
      details: { path },
    });
  }
}

export class ExternalProcessError extends AppError {
  constructor(
    executable: string,
    exitCode: number | null,
    stderr: string,
    cause?: unknown,
  ) {
    const excerpt = stderr.trim().slice(-2_000);
    super(
      `${executable} failed${exitCode === null ? "" : ` with exit code ${exitCode}`}.`,
      {
        code: "EXTERNAL_PROCESS_FAILED",
        details: { executable, processExitCode: exitCode, stderr: excerpt },
        cause,
      },
    );
  }
}

export class MissingDependencyError extends AppError {
  constructor(executable: string) {
    super(`Required executable was not found or could not run: ${executable}`, {
      code: "MISSING_DEPENDENCY",
      exitCode: 4,
      details: { executable },
    });
  }
}

export class StageUnavailableError extends AppError {
  constructor(stage: string, availableAfter: string) {
    super(`${stage} is outside the requested phase 1/2 implementation.`, {
      code: "STAGE_NOT_IMPLEMENTED",
      exitCode: 5,
      details: { stage, availableAfter },
    });
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return new AppError(error.message, {
      code: "UNEXPECTED_ERROR",
      cause: error,
    });
  }
  return new AppError("An unknown error occurred.", {
    code: "UNEXPECTED_ERROR",
    details: { value: String(error) },
  });
}
