import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../utils/redisService';

const redisService = new RedisService();

export const requestTracker = async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const apiKey = req.headers['x-api-key'] as string;
  const userId = (req as any).user?.id;

  // Continue with the request
  next();

  // After the request is complete, record metrics
  res.on('finish', async () => {
    if (userId && apiKey) {
      const endTime = Date.now();
      const latency = endTime - startTime;

      try {
        await redisService.recordRequest(userId, apiKey, {
          method: req.method,
          endpoint: req.path,
          statusCode: res.statusCode,
          latency
        });
      } catch (error) {
        console.error('Error recording request metrics:', error);
      }
    }
  });
};
