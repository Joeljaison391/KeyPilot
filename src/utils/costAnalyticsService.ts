import { RedisClientType } from 'redis';
import { logger } from './logger';
import { config } from '../config/config';

export class CostAnalyticsService {
  constructor(private readonly redis: RedisClientType) {}

  async trackTokenUsage(
    userId: string,
    model: string,
    tokens: number,
    timestamp = Date.now()
  ): Promise<void> {
    try {
      const cost = tokens * (config.cost.tokenPricing[model] || 0);

      // Store in time series
      await this.redis.multi()
        .ts.add(`usage:${userId}:tokens`, timestamp, tokens)
        .ts.add(`usage:${userId}:cost`, timestamp, cost)
        .exec();

      // Update aggregated stats
      await this.redis.hIncrBy(
        `stats:${userId}`,
        'totalTokens',
        tokens
      );
      
      await this.redis.hIncrByFloat(
        `stats:${userId}`,
        'totalCost',
        cost
      );

      // Store model-specific stats
      await this.redis.hIncrBy(
        `model:${userId}:${model}`,
        'tokens',
        tokens
      );
      
      await this.redis.hIncrByFloat(
        `model:${userId}:${model}`,
        'cost',
        cost
      );

      // Track hourly usage for trends
      const hourKey = Math.floor(timestamp / 3600000);
      await this.redis.hIncrBy(
        `hourly:${userId}:${hourKey}`,
        'tokens',
        tokens
      );
    } catch (error) {
      logger.error('Error tracking token usage:', error);
      throw error;
    }
  }

  async getCostAnalytics(userId: string, days: number = 30): Promise<{
    totalCost: number;
    totalTokens: number;
    modelBreakdown: Record<string, { tokens: number; cost: number; }>;
    projectedSavings: number;
    recommendations: string[];
  }> {
    try {
      const endTime = Date.now();
      const startTime = endTime - (days * 86400000);

      // Get total stats
      const stats = await this.redis.hGetAll(`stats:${userId}`);

      // Get usage patterns
      const hourlyUsage = await this.getHourlyUsage(userId, startTime, endTime);
      
      // Get model breakdown
      const modelKeys = await this.redis.keys(`model:${userId}:*`);
      const modelStats = await Promise.all(
        modelKeys.map(async (key) => {
          const model = key.split(':')[2];
          if (!model) throw new Error(`Invalid model key format: ${key}`);
          const stats = await this.redis.hGetAll(key);
          return {
            model,
            tokens: parseInt(stats.tokens || '0'),
            cost: parseFloat(stats.cost || '0')
          };
        })
      );

      // Calculate potential savings
      const recommendations = this.analyzeCostPatterns(hourlyUsage, modelStats);
      const projectedSavings = this.calculatePotentialSavings(modelStats);

      return {
        totalCost: parseFloat(stats.totalCost || '0'),
        totalTokens: parseInt(stats.totalTokens || '0'),
        modelBreakdown: modelStats.reduce((acc, curr) => ({
          ...acc,
          [curr.model]: {
            tokens: curr.tokens,
            cost: curr.cost
          }
        }), {}),
        projectedSavings,
        recommendations
      };
    } catch (error) {
      logger.error('Error getting cost analytics:', error);
      throw error;
    }
  }

  private async getHourlyUsage(
    userId: string,
    startTime: number,
    endTime: number
  ): Promise<Array<{ hour: number; tokens: number; }>> {
    const startHour = Math.floor(startTime / 3600000);
    const endHour = Math.floor(endTime / 3600000);
    
    const usage = [];
    for (let hour = startHour; hour <= endHour; hour++) {
      const data = await this.redis.hGetAll(`hourly:${userId}:${hour}`);
      if (data.tokens) {
        usage.push({
          hour,
          tokens: parseInt(data.tokens)
        });
      }
    }
    
    return usage;
  }

  private analyzeCostPatterns(
    hourlyUsage: Array<{ hour: number; tokens: number; }>,
    modelStats: Array<{ model: string; tokens: number; cost: number; }>
  ): string[] {
    const recommendations: string[] = [];

    // Analyze peak usage times
    const peakHours = this.findPeakUsageHours(hourlyUsage);
    if (peakHours.length > 0) {
      recommendations.push(
        `Consider scheduling bulk operations outside peak hours (${peakHours.join(', ')})`
      );
    }

    // Analyze model usage efficiency
    const inefficientModels = modelStats.filter(
      stat => (stat.cost / stat.tokens) > 0.02 // threshold for inefficient usage
    );
    
    if (inefficientModels.length > 0) {
      recommendations.push(
        `Consider using more cost-effective models for: ${
          inefficientModels.map(m => m.model).join(', ')
        }`
      );
    }

    return recommendations;
  }

  private findPeakUsageHours(
    hourlyUsage: Array<{ hour: number; tokens: number; }>
  ): number[] {
    const avgUsage = hourlyUsage.reduce((sum, curr) => sum + curr.tokens, 0) / hourlyUsage.length;
    return hourlyUsage
      .filter(usage => usage.tokens > avgUsage * 1.5)
      .map(usage => usage.hour % 24);
  }

  private calculatePotentialSavings(
    modelStats: Array<{ model: string; tokens: number; cost: number; }>
  ): number {
    return modelStats.reduce((savings, stat) => {
      // Calculate potential savings by using more efficient models
      if (stat.model === 'gpt-4') {
        const gpt35Price = config.cost.tokenPricing['gpt-3.5-turbo'] || 0;
        const potentialGpt35Cost = stat.tokens * gpt35Price;
        savings += stat.cost - potentialGpt35Cost;
      }
      return savings;
    }, 0);
  }
}
