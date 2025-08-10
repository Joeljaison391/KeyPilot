import { redisService } from './redisService';
import { logger } from './logger';

export interface RequestAnalyticsData {
  userId: string;
  intent: string;
  template?: string;
  confidence?: number;
  cached: boolean;
  latencyMs: number;
  tokensUsed: number;
  success: boolean;
  errorType?: 'timeout' | 'failed' | 'unauthorized' | 'not_found';
  timestamp: Date;
}

export class AnalyticsService {
  /**
   * Record a request analytics event
   */
  static async recordRequest(data: RequestAnalyticsData): Promise<void> {
    try {
      const dateStr = data.timestamp.toISOString().split('T')[0]!;
      const userId = data.userId;

      // Parallel analytics updates
      const updates = [
        // Daily request counter
        this.incrementDailyCounter(`analytics:daily_requests:${userId}:${dateStr}`),
        
        // Cache hit/miss tracking
        data.cached 
          ? this.incrementDailyCounter(`analytics:cache_hits:${userId}:${dateStr}`)
          : this.incrementDailyCounter(`analytics:cache_misses:${userId}:${dateStr}`),
        
        // Request status tracking
        this.updateRequestStatus(userId, dateStr, data.success, data.errorType),
        
        // Response time tracking
        this.updateAverageResponseTime(userId, dateStr, data.latencyMs),
        
        // Token usage tracking
        this.updateTokenUsage(userId, dateStr, data.tokensUsed),
        
        // Store in cached requests stream if cached
        data.cached && data.template ? this.recordCachedRequest(data) : Promise.resolve(),
        
        // Store detailed request in activity stream
        this.recordDetailedActivity(data)
      ];

      await Promise.all(updates.filter(Boolean));

      logger.debug('Analytics recorded successfully', {
        userId,
        template: data.template,
        cached: data.cached,
        success: data.success,
        latency: data.latencyMs
      });

    } catch (error) {
      logger.error('Failed to record analytics:', error);
    }
  }

  /**
   * Increment a daily counter with TTL
   */
  private static async incrementDailyCounter(key: string): Promise<void> {
    try {
      // Ensure Redis connection is active
      await redisService.ensureConnection();
      
      await redisService.incr(key);
      // Set 35-day TTL for analytics data
      await redisService.expire(key, 35 * 24 * 60 * 60);
    } catch (error) {
      logger.warn(`Failed to increment counter ${key}:`, error);
    }
  }

  /**
   * Update request status counters
   */
  private static async updateRequestStatus(
    userId: string, 
    dateStr: string, 
    success: boolean, 
    errorType?: string
  ): Promise<void> {
    try {
      if (success) {
        await this.incrementDailyCounter(`analytics:success_requests:${userId}:${dateStr}`);
      } else {
        await this.incrementDailyCounter(`analytics:failed_requests:${userId}:${dateStr}`);
        
        if (errorType === 'timeout') {
          await this.incrementDailyCounter(`analytics:timeout_requests:${userId}:${dateStr}`);
        }
      }
    } catch (error) {
      logger.warn('Failed to update request status:', error);
    }
  }

  /**
   * Update average response time using a moving average approach
   */
  private static async updateAverageResponseTime(
    userId: string, 
    dateStr: string, 
    latencyMs: number
  ): Promise<void> {
    try {
      // Ensure Redis connection is active
      await redisService.ensureConnection();
      
      const avgKey = `analytics:avg_response_time:${userId}:${dateStr}`;
      const countKey = `analytics:daily_requests:${userId}:${dateStr}`;
      
      // Get current values
      const [currentAvg, currentCount] = await Promise.all([
        redisService.get(avgKey),
        redisService.get(countKey)
      ]);
      
      const prevAvg = parseInt(currentAvg || '0', 10);
      const count = parseInt(currentCount || '0', 10);
      
      // Calculate new average: newAvg = (prevAvg * (count-1) + newValue) / count
      let newAvg: number;
      if (count <= 1) {
        newAvg = latencyMs;
      } else {
        newAvg = Math.round((prevAvg * (count - 1) + latencyMs) / count);
      }
      
      await redisService.set(avgKey, newAvg.toString());
      await redisService.expire(avgKey, 35 * 24 * 60 * 60);
      
    } catch (error) {
      logger.warn('Failed to update average response time:', error);
    }
  }

  /**
   * Update daily token usage for a user
   */
  private static async updateTokenUsage(
    userId: string, 
    dateStr: string, 
    tokensUsed: number
  ): Promise<void> {
    try {
      if (tokensUsed <= 0) return; // No tokens to track
      
      // Ensure Redis connection is active
      await redisService.ensureConnection();
      
      const dailyTokenKey = `analytics:daily_tokens:${userId}:${dateStr}`;
      
      // Increment daily token count
      await redisService.incr(dailyTokenKey);
      const currentTokens = await redisService.get(dailyTokenKey);
      const newTokenCount = (parseInt(currentTokens || '0', 10) - 1) + tokensUsed;
      
      await redisService.set(dailyTokenKey, newTokenCount.toString());
      await redisService.expire(dailyTokenKey, 35 * 24 * 60 * 60); // 35 days retention
      
      // Also track weekly aggregation
      const weekStart = this.getWeekStartDate(new Date(dateStr + 'T00:00:00Z'));
      const weeklyTokenKey = `analytics:weekly_tokens:${userId}:${weekStart}`;
      
      const currentWeeklyTokens = await redisService.get(weeklyTokenKey);
      const newWeeklyCount = (parseInt(currentWeeklyTokens || '0', 10)) + tokensUsed;
      
      await redisService.set(weeklyTokenKey, newWeeklyCount.toString());
      await redisService.expire(weeklyTokenKey, 35 * 24 * 60 * 60); // 35 days retention
      
    } catch (error) {
      logger.warn('Failed to update token usage:', error);
    }
  }

  /**
   * Get the start date of the week (Monday) for a given date
   */
  private static getWeekStartDate(date: Date): string {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    d.setDate(diff);
    return d.toISOString().split('T')[0]!;
  }

  /**
   * Record a cached request in the stream
   */
  private static async recordCachedRequest(data: RequestAnalyticsData): Promise<void> {
    try {
      if (!data.template) return;
      
      const streamKey = `analytics:cached_requests:${data.userId}`;
      
      await redisService.xadd(streamKey, '*', {
        timestamp: data.timestamp.toISOString(),
        intent: data.intent.substring(0, 200), // Truncate long intents
        template: data.template,
        confidence: data.confidence?.toString() || '0',
        response_time_ms: data.latencyMs.toString()
      });

      // Keep only last 100 cached requests per user
      await redisService.xtrim(streamKey, 'MAXLEN', 100);
      
      // Set 7-day TTL for cached requests stream
      await redisService.expire(streamKey, 7 * 24 * 60 * 60);
      
    } catch (error) {
      logger.warn('Failed to record cached request:', error);
    }
  }

  /**
   * Record detailed activity in the stream
   */
  private static async recordDetailedActivity(data: RequestAnalyticsData): Promise<void> {
    try {
      const streamKey = `analytics:activity:${data.userId}`;
      
      const streamData: Record<string, string> = {
        event: data.success ? 'request:success' : 'request:failed',
        timestamp: data.timestamp.toISOString(),
        intent: data.intent.substring(0, 200),
        cached: data.cached.toString(),
        latency_ms: data.latencyMs.toString(),
        tokens_used: data.tokensUsed.toString()
      };

      if (data.template) {
        streamData.template = data.template;
      }
      if (data.confidence !== undefined) {
        streamData.confidence = data.confidence.toString();
      }
      if (data.errorType) {
        streamData.error_type = data.errorType;
      }

      await redisService.xadd(streamKey, '*', streamData);

      // Keep only last 50 activity entries per user
      await redisService.xtrim(streamKey, 'MAXLEN', 50);
      
      // Set 7-day TTL for activity stream
      await redisService.expire(streamKey, 7 * 24 * 60 * 60);
      
    } catch (error) {
      logger.warn('Failed to record detailed activity:', error);
    }
  }

  /**
   * Get recent activity for a user
   */
  static async getRecentActivity(userId: string, limit: number = 10): Promise<Array<any>> {
    try {
      await redisService.ensureConnection();
      const streamKey = `analytics:activity:${userId}`;
      const entries = await redisService.xrevrange(streamKey, '+', '-', limit);
      
      if (!entries || !Array.isArray(entries)) {
        logger.info(`No activity entries found for user ${userId}`);
        return [];
      }
      
      return entries
        .filter((entry: any) => entry && Array.isArray(entry) && entry.length >= 2 && entry[1])
        .map((entry: any) => ({
          id: entry[0],
          event: entry[1].event || 'unknown',
          timestamp: entry[1].timestamp || new Date().toISOString(),
          intent: entry[1].intent || '',
          template: entry[1].template || '',
          confidence: entry[1].confidence ? parseFloat(entry[1].confidence) : undefined,
          cached: entry[1].cached === 'true',
          latency_ms: entry[1].latency_ms ? parseInt(entry[1].latency_ms, 10) : undefined,
          tokens_used: entry[1].tokens_used ? parseInt(entry[1].tokens_used, 10) : undefined,
          error_type: entry[1].error_type
        }));
    } catch (error) {
      logger.error('Failed to get recent activity:', error);
      return [];
    }
  }

  /**
   * Get recent cached requests for a user
   */
  static async getRecentCachedRequests(userId: string, limit: number = 3): Promise<Array<any>> {
    try {
      await redisService.ensureConnection();
      const streamKey = `analytics:cached_requests:${userId}`;
      const entries = await redisService.xrevrange(streamKey, '+', '-', limit);
      
      if (!entries || !Array.isArray(entries)) {
        logger.info(`No cached request entries found for user ${userId}`);
        return [];
      }
      
      return entries
        .filter((entry: any) => entry && Array.isArray(entry) && entry.length >= 2 && entry[1])
        .map((entry: any) => ({
          id: entry[0],
          timestamp: entry[1].timestamp || new Date().toISOString(),
          intent: entry[1].intent || '',
          template: entry[1].template || '',
          confidence: parseFloat(entry[1].confidence || '0'),
          response_time_ms: parseInt(entry[1].response_time_ms || '0', 10)
        }));
    } catch (error) {
      logger.error('Failed to get recent cached requests:', error);
      return [];
    }
  }

  /**
   * Get daily token usage for a user over a date range
   */
  static async getDailyTokenUsage(userId: string, days: number = 7): Promise<Array<{date: string, tokens: number}>> {
    try {
      await redisService.ensureConnection();
      const results: Array<{date: string, tokens: number}> = [];
      
      for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0]!;
        
        const tokenKey = `analytics:daily_tokens:${userId}:${dateStr}`;
        const tokens = await redisService.get(tokenKey);
        
        results.push({
          date: dateStr,
          tokens: parseInt(tokens || '0', 10)
        });
      }
      
      return results.reverse(); // Oldest first
    } catch (error) {
      logger.error('Failed to get daily token usage:', error);
      return [];
    }
  }

  /**
   * Get weekly token usage for a user
   */
  static async getWeeklyTokenUsage(userId: string, weeks: number = 4): Promise<Array<{week: string, tokens: number}>> {
    try {
      await redisService.ensureConnection();
      const results: Array<{week: string, tokens: number}> = [];
      
      for (let i = 0; i < weeks; i++) {
        const date = new Date();
        date.setDate(date.getDate() - (i * 7));
        const weekStart = this.getWeekStartDate(date);
        
        const tokenKey = `analytics:weekly_tokens:${userId}:${weekStart}`;
        const tokens = await redisService.get(tokenKey);
        
        results.push({
          week: weekStart,
          tokens: parseInt(tokens || '0', 10)
        });
      }
      
      return results.reverse(); // Oldest first
    } catch (error) {
      logger.error('Failed to get weekly token usage:', error);
      return [];
    }
  }

  /**
   * Get total token usage for a user over a period
   */
  static async getTotalTokenUsage(userId: string, days: number = 7): Promise<number> {
    try {
      const dailyData = await this.getDailyTokenUsage(userId, days);
      return dailyData.reduce((total, day) => total + day.tokens, 0);
    } catch (error) {
      logger.error('Failed to get total token usage:', error);
      return 0;
    }
  }

  /**
   * Clean up old analytics data (should be run periodically)
   */
  static async cleanupOldData(userId: string, daysToKeep: number = 35): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      
      const patterns = [
        `analytics:daily_requests:${userId}:*`,
        `analytics:cache_hits:${userId}:*`,
        `analytics:cache_misses:${userId}:*`,
        `analytics:success_requests:${userId}:*`,
        `analytics:failed_requests:${userId}:*`,
        `analytics:timeout_requests:${userId}:*`,
        `analytics:avg_response_time:${userId}:*`,
        `analytics:daily_tokens:${userId}:*`,
        `analytics:weekly_tokens:${userId}:*`
      ];

      for (const pattern of patterns) {
        const keys = await redisService.keys(pattern);
        for (const key of keys) {
          const datePart = key.split(':').pop();
          if (datePart && new Date(datePart) < cutoffDate) {
            await redisService.del(key);
          }
        }
      }

      logger.info(`Cleaned up old analytics data for user ${userId}`);
    } catch (error) {
      logger.error('Failed to cleanup old analytics data:', error);
    }
  }
}
