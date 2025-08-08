import express from 'express';
import { RedisService } from '../utils/redisService';
import { validateToken } from '../middleware/auth';
import { AppError } from '../utils/AppError';

const router = express.Router();
const redisService = new RedisService();

// Middleware to ensure user is authenticated
router.use(validateToken);

// Get request patterns for a specific API key
router.get('/patterns/:apiKey', async (req, res, next) => {
  try {
    const { apiKey } = req.params;
    const patterns = await redisService.getRequestPatterns(apiKey);
    res.json({
      success: true,
      data: patterns
    });
  } catch (error) {
    next(new AppError('Failed to fetch request patterns', 500));
  }
});

// Get usage analytics for all API keys of a user
router.get('/usage', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('User not found', 404);
    }
    
    const analytics = await redisService.getUserApiAnalytics(userId);
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    next(error);
  }
});

// Get endpoint popularity metrics
router.get('/endpoints', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('User not found', 404);
    }
    
    const endpointMetrics = await redisService.getEndpointMetrics(userId);
    res.json({
      success: true,
      data: endpointMetrics
    });
  } catch (error) {
    next(error);
  }
});

// Get rate limit status and history
router.get('/rate-limits', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('User not found', 404);
    }
    
    const rateLimitData = await redisService.getRateLimitStats(userId);
    res.json({
      success: true,
      data: rateLimitData
    });
  } catch (error) {
    next(error);
  }
});

// Get error patterns and frequency
router.get('/errors', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('User not found', 404);
    }
    
    const errorAnalytics = await redisService.getErrorAnalytics(userId);
    res.json({
      success: true,
      data: errorAnalytics
    });
  } catch (error) {
    next(error);
  }
});

// Get real-time request logs
router.get('/logs', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('User not found', 404);
    }
    
    const { page = 1, limit = 50 } = req.query;
    const logs = await redisService.getRequestLogs(
      userId, 
      Number(page), 
      Number(limit)
    );
    
    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    next(error);
  }
});

// Get performance metrics
router.get('/performance', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('User not found', 404);
    }
    
    const { timeframe = '24h' } = req.query;
    const metrics = await redisService.getPerformanceMetrics(
      userId,
      String(timeframe)
    );
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    next(error);
  }
});

export default router;
