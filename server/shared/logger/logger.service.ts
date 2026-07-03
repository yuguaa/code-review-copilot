import pino from "pino";
import { appConfig } from "../../config/app.config";

const level = appConfig.logLevel;

export const logger = pino({
  level,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
});

export type AppLogger = {
  debug: (message: string, ...values: unknown[]) => void;
  info: (message: string, ...values: unknown[]) => void;
  warn: (message: string, ...values: unknown[]) => void;
  error: (message: string, ...values: unknown[]) => void;
};

function writeLog(log: pino.Logger, level: keyof AppLogger, message: string, values: unknown[]) {
  if (values.length === 0) {
    log[level](message);
    return;
  }

  if (values.length === 1) {
    const [value] = values;
    if (value instanceof Error) {
      log[level]({ err: value }, message);
      return;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      log[level](value, message);
      return;
    }
    log[level]({ value }, message);
    return;
  }

  log[level]({ values }, message);
}

export function createLogger(module: string) {
  const child = logger.child({ module });

  return {
    debug: (message: string, ...values: unknown[]) => writeLog(child, "debug", message, values),
    info: (message: string, ...values: unknown[]) => writeLog(child, "info", message, values),
    warn: (message: string, ...values: unknown[]) => writeLog(child, "warn", message, values),
    error: (message: string, ...values: unknown[]) => writeLog(child, "error", message, values),
  } satisfies AppLogger;
}

export function logError(log: AppLogger, error: unknown, message: string, extra?: Record<string, unknown>) {
  if (extra) {
    log.error(message, { ...extra, err: error });
    return;
  }
  log.error(message, error);
}

export function logWarn(log: AppLogger, error: unknown, message: string, extra?: Record<string, unknown>) {
  if (extra) {
    log.warn(message, { ...extra, err: error });
    return;
  }
  log.warn(message, error);
}
