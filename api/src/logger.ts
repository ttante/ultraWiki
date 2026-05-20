import type { NextFunction, Request, Response } from 'express';
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined,
  formatters: {
    level(label) {
      return { level: label };
    }
  }
});

export const httpLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - startedAt;
    const payload = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: ms,
      requestId: req.header('x-request-id') ?? null
    };

    if (res.statusCode >= 500) {
      logger.error(payload, 'request failed');
    } else if (res.statusCode >= 400) {
      logger.warn(payload, 'request warning');
    } else {
      logger.info(payload, 'request completed');
    }
  });

  next();
};
