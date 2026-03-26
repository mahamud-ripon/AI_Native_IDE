type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// In production, suppress debug and info logs; in dev, show everything
const MIN_LEVEL: number = import.meta.env.PROD
  ? LOG_LEVELS.warn
  : LOG_LEVELS.debug;

function log(level: LogLevel, ...args: unknown[]): void {
  if (LOG_LEVELS[level] < MIN_LEVEL) return;

  const prefix = `[${level.toUpperCase()}]`;
  const method: (...a: unknown[]) => void =
    level === 'debug'
      ? console.debug
      : level === 'info'
        ? console.info
        : level === 'warn'
          ? console.warn
          : console.error;

  method(prefix, ...args);
}

export const logger = {
  debug: (...args: unknown[]) => log('debug', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
};
