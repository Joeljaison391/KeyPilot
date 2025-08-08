import { RedisClientType } from 'redis';
import { logger } from './logger';
import { config } from '../config/config';

export class QuotaService {
  constructor(private readonly redis: RedisClientType) {}

  private getQuotaKey(userId: string, period: 'daily' | 'monthly'): string {
    const date = new Date();
    const key = period === 'daily' 
      ? `quota:${userId}:${date.getFullYear()}:${date.getMonth() + 1}:${date.getDate()}`
      : `quota:${userId}:${date.getFullYear()}:${date.getMonth() + 1}`;
    return key;
  }

  async incrementUsage(userId: string, tokens: number): Promise<boolean> {
    const dailyKey = this.getQuotaKey(userId, 'daily');
    const monthlyKey = this.getQuotaKey(userId, 'monthly');

    try {
      await this.redis.multi()
        .incrBy(dailyKey, tokens)
        .incrBy(monthlyKey, tokens)
        .expire(dailyKey, 86400) // 24 hours
        .expire(monthlyKey, 2592000) // 30 days
        .exec();

      // Check thresholds and send alerts
      await this.checkQuotaThresholds(userId);
      
      return true;
    } catch (error) {
      logger.error('Error incrementing quota usage:', error);
      return false;
    }
  }

  async checkQuotaThresholds(userId: string): Promise<void> {
    try {
      const [dailyUsage, monthlyUsage] = await Promise.all([
        this.redis.get(this.getQuotaKey(userId, 'daily')),
        this.redis.get(this.getQuotaKey(userId, 'monthly'))
      ]);

      const daily = parseInt(dailyUsage || '0');
      const monthly = parseInt(monthlyUsage || '0');

      // Check against configured thresholds
      for (const threshold of config.quota.alertThresholds) {
        const dailyPercent = (daily / config.quota.daily) * 100;
        const monthlyPercent = (monthly / config.quota.monthly) * 100;

        if (dailyPercent >= threshold || monthlyPercent >= threshold) {
          await this.redis.xAdd(
            `alerts:${userId}`,
            '*',
            {
              type: 'QUOTA_ALERT',
              threshold: threshold.toString(),
              dailyUsage: daily.toString(),
              monthlyUsage: monthly.toString(),
              timestamp: new Date().toISOString()
            }
          );
        }
      }

      // Auto-disable if enabled and quota exceeded
      if (config.quota.autoDisable && 
          (daily >= config.quota.daily || monthly >= config.quota.monthly)) {
        await this.redis.set(`quota:disabled:${userId}`, '1', {
          EX: 86400 // 24 hours
        });
      }
    } catch (error) {
      logger.error('Error checking quota thresholds:', error);
    }
  }

  async isQuotaExceeded(userId: string): Promise<boolean> {
    try {
      const [dailyUsage, monthlyUsage, disabled] = await Promise.all([
        this.redis.get(this.getQuotaKey(userId, 'daily')),
        this.redis.get(this.getQuotaKey(userId, 'monthly')),
        this.redis.get(`quota:disabled:${userId}`)
      ]);

      if (disabled === '1') return true;

      const daily = parseInt(dailyUsage || '0');
      const monthly = parseInt(monthlyUsage || '0');

      return daily >= config.quota.daily || monthly >= config.quota.monthly;
    } catch (error) {
      logger.error('Error checking if quota exceeded:', error);
      return true; // Fail safe
    }
  }

  async getQuotaStatus(userId: string): Promise<{
    daily: { used: number; total: number; };
    monthly: { used: number; total: number; };
    isDisabled: boolean;
  }> {
    try {
      const [dailyUsage, monthlyUsage, disabled] = await Promise.all([
        this.redis.get(this.getQuotaKey(userId, 'daily')),
        this.redis.get(this.getQuotaKey(userId, 'monthly')),
        this.redis.get(`quota:disabled:${userId}`)
      ]);

      return {
        daily: {
          used: parseInt(dailyUsage || '0'),
          total: config.quota.daily
        },
        monthly: {
          used: parseInt(monthlyUsage || '0'),
          total: config.quota.monthly
        },
        isDisabled: disabled === '1'
      };
    } catch (error) {
      logger.error('Error getting quota status:', error);
      throw error;
    }
  }
}
