import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

// Logs every API call — method, route, status, duration, and the caller once
// the guard has attached one. Runs regardless of auth outcome (CLAUDE.md #8).
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    res.on('finish', () => {
      const who = req.user?.email ?? 'anonymous';
      console.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms user=${who}`,
      );
    });
    next();
  }
}
