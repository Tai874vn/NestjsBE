import { Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';

type FieldValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, number>;

type ObservabilityFields = Record<string, FieldValue>;

const DEFAULT_OPERATION_WARN_MS = 1_000;

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class OperationTimer {
  private readonly startedAt = performance.now();
  private readonly fields: ObservabilityFields;
  private readonly steps: Record<string, number> = {};

  constructor(
    private readonly logger: Logger,
    private readonly name: string,
    fields: ObservabilityFields = {},
    private readonly warnAfterMs = DEFAULT_OPERATION_WARN_MS,
  ) {
    this.fields = { ...fields };
  }

  async time<T>(step: string, callback: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      return await callback();
    } finally {
      this.steps[step] = roundMs(performance.now() - startedAt);
    }
  }

  annotate(fields: ObservabilityFields): void {
    Object.assign(this.fields, fields);
  }

  end(fields: ObservabilityFields = {}): void {
    this.record('ok', fields);
  }

  fail(error: unknown, fields: ObservabilityFields = {}): void {
    this.record('error', {
      ...fields,
      error: errorMessage(error),
    });
  }

  private record(status: 'ok' | 'error', fields: ObservabilityFields): void {
    const durationMs = roundMs(performance.now() - this.startedAt);
    const payload = {
      event: 'operation',
      operation: this.name,
      status,
      durationMs,
      ...this.fields,
      ...fields,
      steps: this.steps,
    };
    const line = JSON.stringify(payload);

    if (status === 'error') {
      // Keep failed operation timing at warn level so HTTP 5xx errors are logged at ERROR
      // level only once (with requestId and stack) in AllExceptionsFilter.
      this.logger.warn(line);
      return;
    }

    if (durationMs >= this.warnAfterMs) {
      this.logger.warn(line);
      return;
    }

    this.logger.log(line);
  }
}

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger('Observability');

  startOperation(
    name: string,
    fields: ObservabilityFields = {},
    warnAfterMs = DEFAULT_OPERATION_WARN_MS,
  ): OperationTimer {
    return new OperationTimer(this.logger, name, fields, warnAfterMs);
  }

  recordHttp(fields: ObservabilityFields): void {
    const statusCode = Number(fields.statusCode ?? 0);
    const durationMs = Number(fields.durationMs ?? 0);
    const observed = Boolean(fields.observed);
    const slow = durationMs >= DEFAULT_OPERATION_WARN_MS;
    const line = JSON.stringify({ event: 'http_request', ...fields });

    // AllExceptionsFilter is the single logger.error caller for HTTP 5xx failures.
    // Log the structured HTTP telemetry line at log level so 5xx metrics stay visible
    // without emitting a second ERROR log for the same requestId.
    if (statusCode >= 500) {
      this.logger.log(line);
      return;
    }

    if (slow || statusCode >= 400) {
      this.logger.warn(line);
      return;
    }

    if (observed) {
      this.logger.log(line);
    }
  }
}
