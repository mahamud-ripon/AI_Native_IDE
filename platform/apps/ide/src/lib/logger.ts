type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogPayload = Record<string, unknown> | string | number | boolean | null | undefined;

type LogArgs = [LogPayload, string?, ...unknown[]] | [string, ...unknown[]];

function formatArgs(args: unknown[]): unknown[] {
  return args;
}

function log(level: LogLevel, ...args: unknown[]): void {
  const prefix = `[${level.toUpperCase()}]`;
  const method: (...a: unknown[]) => void =
    level === 'debug'
      ? console.debug
      : level === 'info'
        ? console.info
        : level === 'warn'
          ? console.warn
          : console.error;

  method(prefix, ...formatArgs(args));
}

export const logger = {
  debug: (...args: unknown[]) => log('debug', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
};
