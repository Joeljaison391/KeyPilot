import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  // Generate unique request ID
  req.requestId = uuidv4();

  // Log incoming request
  logger.info('Incoming request', {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    timestamp: new Date().toISOString(),
  });

  // Log response when finished
  const originalSend = res.json;
  res.json = function(body) {
    logger.info('Outgoing response', {
      requestId: req.requestId,
      statusCode: res.statusCode,
      responseTime: Date.now() - res.locals.startTime,
    });
    
    return originalSend.call(this, body);
  };

  // Store start time
  res.locals.startTime = Date.now();

  next();
};
