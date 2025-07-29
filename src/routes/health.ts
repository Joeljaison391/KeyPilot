import { Router, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { config } from '../config/config';
import { redisService } from '../utils/redisService';

const router = Router();

// Health check endpoint
router.get('/', async (_req: Request, res: Response) => {
  // Check Redis connection
  let redisStatus = 'disconnected';
  let redisLatency = -1;
  
  try {
    if (redisService.getConnectionStatus()) {
      const start = Date.now();
      await redisService.ping();
      redisLatency = Date.now() - start;
      redisStatus = 'connected';
    }
  } catch (error) {
    redisStatus = 'error';
  }

  const healthCheck = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: config.app.name,
    version: config.app.version,
    environment: config.env,
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024 * 100) / 100,
      external: Math.round(process.memoryUsage().external / 1024 / 1024 * 100) / 100,
    },
    load: (process as any).loadavg ? (process as any).loadavg() : null,
    redis: {
      status: redisStatus,
      latency: redisLatency > 0 ? `${redisLatency}ms` : null,
    },
  };

  res.status(StatusCodes.OK).json(healthCheck);
});

// Readiness probe
router.get('/ready', (_req: Request, res: Response) => {
  // Add any readiness checks here (database connections, external services, etc.)
  res.status(StatusCodes.OK).json({
    status: 'Ready',
    timestamp: new Date().toISOString(),
  });
});

// Liveness probe
router.get('/live', (_req: Request, res: Response) => {
  res.status(StatusCodes.OK).json({
    status: 'Alive',
    timestamp: new Date().toISOString(),
  });
});

export default router;
