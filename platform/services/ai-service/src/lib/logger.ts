import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

export function createLogger(context: string) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: isDevelopment
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    base: { context },
  });
}

export const logger = createLogger('ai-service');
export default logger;
