import express from 'express';
import { RedisService } from '../utils/redisService';
import { AnalyticsService } from '../utils/analyticsService';
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

// Get comprehensive dashboard analytics
router.get('/dashboard', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('User not found', 404);
    }

    const { days = 7 } = req.query;
    const daysNumber = parseInt(days as string, 10);
    
    if (isNaN(daysNumber) || daysNumber < 1 || daysNumber > 30) {
      throw new AppError('Days must be between 1 and 30', 400);
    }

    // Get analytics data from Redis streams and counters
    const [
      dailyRequests,
      avgResponseTimes,
      cacheHitRate,
      recentCachedRequests,
      requestCounts,
      recentActivity,
      dailyTokenUsage,
      weeklyTokenUsage,
      totalTokenUsage
    ] = await Promise.all([
      getDailyRequestCounts(userId, daysNumber),
      getDailyAverageResponseTimes(userId, daysNumber),
      getCacheHitRate(userId, daysNumber),
      getRecentCachedRequests(userId, 3),
      getRequestStatusCounts(userId, daysNumber),
      getRecentActivity(userId, 10),
      AnalyticsService.getDailyTokenUsage(userId, daysNumber),
      AnalyticsService.getWeeklyTokenUsage(userId, Math.ceil(daysNumber / 7)),
      AnalyticsService.getTotalTokenUsage(userId, daysNumber)
    ]);

    const analytics = {
      success: true,
      period: {
        days: daysNumber,
        start_date: new Date(Date.now() - (daysNumber * 24 * 60 * 60 * 1000)).toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0]
      },
      daily_requests: dailyRequests,
      average_response_times: avgResponseTimes,
      cache_performance: {
        hit_rate: cacheHitRate.hitRate,
        total_requests: cacheHitRate.totalRequests,
        cache_hits: cacheHitRate.cacheHits,
        cache_misses: cacheHitRate.cacheMisses
      },
      recent_cached_requests: recentCachedRequests,
      request_status_summary: {
        total_requests: requestCounts.total,
        successful_requests: requestCounts.success,
        failed_requests: requestCounts.failed,
        timeout_requests: requestCounts.timeout,
        success_rate: requestCounts.total > 0 ? Math.round((requestCounts.success / requestCounts.total) * 100 * 100) / 100 : 0
      },
      token_usage: {
        daily_usage: dailyTokenUsage,
        weekly_usage: weeklyTokenUsage,
        total_tokens_used: totalTokenUsage,
        average_tokens_per_request: requestCounts.total > 0 ? Math.round((totalTokenUsage / requestCounts.total) * 100) / 100 : 0
      },
      recent_activity: recentActivity,
      generated_at: new Date().toISOString()
    };

    console.log('Dashboard analytics:', analytics);

    res.json(analytics);

  } catch (error) {
    next(error);
  }
});

// Helper function to get daily request counts
async function getDailyRequestCounts(userId: string, days: number): Promise<Array<{date: string, count: number}>> {
  const dailyData: Array<{date: string, count: number}> = [];
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - (i * 24 * 60 * 60 * 1000));
    const dateStr = date.toISOString().split('T')[0]!;
    const countKey = `analytics:daily_requests:${userId}:${dateStr}`;
    
    try {
      // Ensure Redis connection is active
      await redisService.ensureConnection();
      
      const count = await redisService.get(countKey);
      dailyData.push({
        date: dateStr,
        count: parseInt(count || '0', 10)
      });
    } catch (error) {
      console.warn(`Failed to get daily request count for ${dateStr}:`, error);
      dailyData.push({
        date: dateStr,
        count: 0
      });
    }
  }
  
  return dailyData;
}

// Helper function to get daily average response times
async function getDailyAverageResponseTimes(userId: string, days: number): Promise<Array<{date: string, avg_ms: number, request_count: number}>> {
  const avgData: Array<{date: string, avg_ms: number, request_count: number}> = [];
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - (i * 24 * 60 * 60 * 1000));
    const dateStr = date.toISOString().split('T')[0]!;
    const avgKey = `analytics:avg_response_time:${userId}:${dateStr}`;
    const countKey = `analytics:daily_requests:${userId}:${dateStr}`;
    
    try {
      // Ensure Redis connection is active
      await redisService.ensureConnection();
      
      const avgTime = await redisService.get(avgKey);
      const requestCount = await redisService.get(countKey);
      
      avgData.push({
        date: dateStr,
        avg_ms: parseInt(avgTime || '0', 10),
        request_count: parseInt(requestCount || '0', 10)
      });
    } catch (error) {
      console.warn(`Failed to get average response time for ${dateStr}:`, error);
      avgData.push({
        date: dateStr,
        avg_ms: 0,
        request_count: 0
      });
    }
  }
  
  return avgData;
}

// Helper function to get cache hit rate
async function getCacheHitRate(userId: string, days: number): Promise<{hitRate: number, totalRequests: number, cacheHits: number, cacheMisses: number}> {
  let totalHits = 0;
  let totalMisses = 0;
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - (i * 24 * 60 * 60 * 1000));
    const dateStr = date.toISOString().split('T')[0]!;
    
    try {
      // Ensure Redis connection is active
      await redisService.ensureConnection();
      
      const hitsKey = `analytics:cache_hits:${userId}:${dateStr}`;
      const missesKey = `analytics:cache_misses:${userId}:${dateStr}`;
      
      const hits = await redisService.get(hitsKey);
      const misses = await redisService.get(missesKey);
      
      totalHits += parseInt(hits || '0', 10);
      totalMisses += parseInt(misses || '0', 10);
    } catch (error) {
      console.warn(`Failed to get cache hit rate for ${dateStr}:`, error);
      // Continue with 0 values
    }
  }
  
  const totalRequests = totalHits + totalMisses;
  const hitRate = totalRequests > 0 ? Math.round((totalHits / totalRequests) * 100 * 100) / 100 : 0;
  
  return {
    hitRate,
    totalRequests,
    cacheHits: totalHits,
    cacheMisses: totalMisses
  };
}

// Helper function to get recent cached requests
async function getRecentCachedRequests(userId: string, limit: number): Promise<Array<any>> {
  return AnalyticsService.getRecentCachedRequests(userId, limit);
}

// Helper function to get request status counts
async function getRequestStatusCounts(userId: string, days: number): Promise<{total: number, success: number, failed: number, timeout: number}> {
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalTimeout = 0;
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - (i * 24 * 60 * 60 * 1000));
    const dateStr = date.toISOString().split('T')[0]!;
    
    try {
      // Ensure Redis connection is active
      await redisService.ensureConnection();
      
      const successKey = `analytics:success_requests:${userId}:${dateStr}`;
      const failedKey = `analytics:failed_requests:${userId}:${dateStr}`;
      const timeoutKey = `analytics:timeout_requests:${userId}:${dateStr}`;
      
      const success = await redisService.get(successKey);
      const failed = await redisService.get(failedKey);
      const timeout = await redisService.get(timeoutKey);
      
      totalSuccess += parseInt(success || '0', 10);
      totalFailed += parseInt(failed || '0', 10);
      totalTimeout += parseInt(timeout || '0', 10);
    } catch (error) {
      console.warn(`Failed to get request status counts for ${dateStr}:`, error);
      // Continue with 0 values
    }
  }
  
  return {
    total: totalSuccess + totalFailed + totalTimeout,
    success: totalSuccess,
    failed: totalFailed,
    timeout: totalTimeout
  };
}

// Helper function to get recent activity
async function getRecentActivity(userId: string, limit: number): Promise<Array<any>> {
  return AnalyticsService.getRecentActivity(userId, limit);
}

export default router;
