import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { StatusCodes } from 'http-status-codes';
import { validateRequest } from '../middleware/validation';
import { config } from '../config/config';

const router = Router();

// API Info endpoint
router.get('/', (_req: Request, res: Response) => {
  res.status(StatusCodes.OK).json({
    name: config.app.name,
    version: config.app.version,
    description: 'Gateway Service API',
    endpoints: {
      health: '/health',
      api: '/api',
      docs: '/api/docs',
      analytics: {
        patterns: '/api/analytics/patterns/:apiKey',
        usage: '/api/analytics/usage',
        endpoints: '/api/analytics/endpoints',
        rateLimits: '/api/analytics/rate-limits',
        errors: '/api/analytics/errors',
        logs: '/api/analytics/logs',
        performance: '/api/analytics/performance'
      }
    },
    timestamp: new Date().toISOString(),
  });
});

// Sample protected endpoint
router.get('/protected', (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== config.security.apiKey) {
    res.status(StatusCodes.UNAUTHORIZED).json({
      error: 'Invalid or missing API key',
    });
    return;
  }

  res.status(StatusCodes.OK).json({
    message: 'Access granted to protected resource',
    timestamp: new Date().toISOString(),
  });
});

// Sample POST endpoint with validation
router.post('/echo',
  validateRequest([
    body('message')
      .notEmpty()
      .withMessage('Message is required')
      .isLength({ min: 1, max: 500 })
      .withMessage('Message must be between 1 and 500 characters'),
  ]),
  (req: Request, res: Response) => {
    const { message } = req.body;
    
    res.status(StatusCodes.OK).json({
      echo: message,
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
    });
  }
);

// Sample async endpoint
router.get('/async-demo', async (_req: Request, res: Response) => {
  try {
    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    res.status(StatusCodes.OK).json({
      message: 'Async operation completed',
      delay: '1000ms',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: 'Async operation failed',
    });
  }
});

export default router;
