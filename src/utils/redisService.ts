import { createClient, RedisClientType } from 'redis';
import { config } from '../config/config';
import { logger } from './logger';

export class RedisService {
  private client: RedisClientType;
  private isConnected: boolean = false;

  constructor() {
    // Choose Redis URL based on environment
    const redisUrl = this.getRedisUrl();
    
    const clientOptions: any = {
      url: redisUrl,
    };

    // Add password if provided
    if (config.redis.password) {
      clientOptions.password = config.redis.password;
    }

    // Add TLS configuration for cloud Redis
    if (config.redis.tls && config.env === 'production') {
      clientOptions.socket = {
        tls: true,
        rejectUnauthorized: false,
      };
    }

    this.client = createClient(clientOptions);

    // Error handling
    this.client.on('error', (err) => {
      logger.error('Redis Client Error:', err);
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      logger.info('Redis Client Connected');
      this.isConnected = true;
    });

    this.client.on('disconnect', () => {
      logger.warn('Redis Client Disconnected');
      this.isConnected = false;
    });
  }

  private getRedisUrl(): string {
    // Use cloud URL in production if available, otherwise use local URL
    if (config.env === 'production' && config.redis.cloudUrl) {
      return config.redis.cloudUrl;
    }
    return config.redis.url;
  }

  async connect(): Promise<void> {
    try {
      if (!this.isConnected) {
        await this.client.connect();
        logger.info(`Connected to Redis: ${this.getRedisUrl()}`);
      }
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.isConnected) {
        await this.client.disconnect();
        logger.info('Disconnected from Redis');
      }
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error(`Error getting key ${key}:`, error);
      throw error;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      logger.error(`Error setting key ${key}:`, error);
      throw error;
    }
  }

  async del(key: string): Promise<number> {
    try {
      return await this.client.del(key);
    } catch (error) {
      logger.error(`Error deleting key ${key}:`, error);
      throw error;
    }
  }

  async exists(key: string): Promise<number> {
    try {
      return await this.client.exists(key);
    } catch (error) {
      logger.error(`Error checking existence of key ${key}:`, error);
      throw error;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      logger.error(`Error getting TTL for key ${key}:`, error);
      throw error;
    }
  }

  async ping(): Promise<string> {
    try {
      return await this.client.ping();
    } catch (error) {
      logger.error('Error pinging Redis:', error);
      throw error;
    }
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  // Specific methods for user session management
  async getUserSession(userId: string): Promise<any | null> {
    try {
      const sessionData = await this.get(`user:${userId}`);
      return sessionData ? JSON.parse(sessionData) : null;
    } catch (error) {
      logger.error(`Error getting user session for ${userId}:`, error);
      throw error;
    }
  }

  async setUserSession(userId: string, sessionData: any, ttlSeconds: number): Promise<void> {
    try {
      await this.set(`user:${userId}`, JSON.stringify(sessionData), ttlSeconds);
    } catch (error) {
      logger.error(`Error setting user session for ${userId}:`, error);
      throw error;
    }
  }

  async deleteUserSession(userId: string): Promise<number> {
    try {
      return await this.del(`user:${userId}`);
    } catch (error) {
      logger.error(`Error deleting user session for ${userId}:`, error);
      throw error;
    }
  }

  // Development methods for debugging
  async getAllKeys(pattern: string = '*'): Promise<string[]> {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      logger.error(`Error getting all keys with pattern ${pattern}:`, error);
      throw error;
    }
  }

  async flushAll(): Promise<string> {
    try {
      return await this.client.flushAll();
    } catch (error) {
      logger.error('Error flushing all Redis data:', error);
      throw error;
    }
  }

  async getKeyType(key: string): Promise<string> {
    try {
      return await this.client.type(key);
    } catch (error) {
      logger.error(`Error getting type for key ${key}:`, error);
      throw error;
    }
  }

  // API Key Management Methods
  async setApiKey(userId: string, template: string, keyData: any, ttlSeconds?: number): Promise<void> {
    try {
      const redisKey = `user:${userId}:keys:${template}`;
      
      if (ttlSeconds) {
        // Set API key with TTL (tied to session expiry)
        await this.client.setEx(redisKey, ttlSeconds, JSON.stringify(keyData));
      } else {
        // Set API key without TTL (legacy behavior)
        await this.client.set(redisKey, JSON.stringify(keyData));
      }
    } catch (error) {
      logger.error(`Error setting API key for user ${userId}, template ${template}:`, error);
      throw error;
    }
  }

  async getApiKey(userId: string, template: string): Promise<any | null> {
    try {
      const redisKey = `user:${userId}:keys:${template}`;
      const data = await this.client.get(redisKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error(`Error getting API key for user ${userId}, template ${template}:`, error);
      return null;
    }
  }

  async getUserApiKeys(userId: string): Promise<Array<{ template: string; data: any }>> {
    try {
      const pattern = `user:${userId}:keys:*`;
      const keys = await this.client.keys(pattern);
      
      const apiKeys: Array<{ template: string; data: any }> = [];
      
      for (const key of keys) {
        try {
          const data = await this.client.get(key);
          if (data) {
            const template = key.split(':').pop() || '';
            apiKeys.push({
              template,
              data: JSON.parse(data)
            });
          }
        } catch (parseError) {
          logger.warn(`Failed to parse API key data for key ${key}:`, parseError);
        }
      }
      
      return apiKeys;
    } catch (error) {
      logger.error(`Error getting API keys for user ${userId}:`, error);
      return [];
    }
  }

  async deleteApiKey(userId: string, template: string): Promise<number> {
    try {
      const redisKey = `user:${userId}:keys:${template}`;
      return await this.client.del(redisKey);
    } catch (error) {
      logger.error(`Error deleting API key for user ${userId}, template ${template}:`, error);
      throw error;
    }
  }

  async updateApiKeyUsage(userId: string, template: string, updates: Partial<{
    daily_usage: number;
    weekly_usage: number;
    daily_tokens_used: number;
    last_reset: string;
  }>): Promise<void> {
    try {
      const redisKey = `user:${userId}:keys:${template}`;
      const existingData = await this.getApiKey(userId, template);
      
      if (!existingData) {
        throw new Error(`API key not found: ${template}`);
      }

      const updatedData = { ...existingData, ...updates };
      await this.client.set(redisKey, JSON.stringify(updatedData));
    } catch (error) {
      logger.error(`Error updating API key usage for user ${userId}, template ${template}:`, error);
      throw error;
    }
  }

  // Sync API key TTL with user session TTL for automatic cleanup
  async syncApiKeysWithSessionTTL(userId: string): Promise<void> {
    try {
      // Get current session TTL
      const sessionTTL = await this.ttl(`user:${userId}`);
      
      if (sessionTTL <= 0) {
        logger.warn(`Session for user ${userId} has already expired or doesn't exist`);
        return;
      }

      // Get all user API keys
      const pattern = `user:${userId}:keys:*`;
      const keys = await this.client.keys(pattern);
      
      // Set TTL for each API key to match session TTL
      for (const key of keys) {
        await this.expire(key, sessionTTL);
      }

      logger.info(`Synced ${keys.length} API keys with session TTL for user ${userId}`, {
        sessionTTL,
        keysUpdated: keys.length
      });

    } catch (error) {
      logger.error(`Error syncing API keys with session TTL for user ${userId}:`, error);
      throw error;
    }
  }

  // Set API key with automatic session TTL
  async setApiKeyWithSessionTTL(userId: string, template: string, keyData: any): Promise<void> {
    try {
      // Get current session TTL
      const sessionTTL = await this.ttl(`user:${userId}`);
      
      if (sessionTTL <= 0) {
        throw new Error(`User session for ${userId} has expired or doesn't exist`);
      }

      // Set API key with same TTL as session
      await this.setApiKey(userId, template, keyData, sessionTTL);
      
      logger.info(`Set API key with session TTL for user ${userId}`, {
        template,
        ttl: sessionTTL
      });

    } catch (error) {
      logger.error(`Error setting API key with session TTL for user ${userId}, template ${template}:`, error);
      throw error;
    }
  }

  // Clean up expired API keys for all users (utility function)
  async cleanupExpiredApiKeys(): Promise<{ cleaned: number; errors: number }> {
    try {
      const pattern = 'user:*:keys:*';
      const keys = await this.client.keys(pattern);
      
      let cleaned = 0;
      let errors = 0;

      for (const key of keys) {
        try {
          const ttl = await this.ttl(key);
          if (ttl === -2) { // Key doesn't exist (already expired)
            cleaned++;
          }
        } catch (error) {
          logger.warn(`Error checking TTL for key ${key}:`, error);
          errors++;
        }
      }

      logger.info(`Cleanup completed`, {
        totalKeysChecked: keys.length,
        keysAlreadyCleaned: cleaned,
        errors
      });

      return { cleaned, errors };

    } catch (error) {
      logger.error('Error during API key cleanup:', error);
      throw error;
    }
  }

  // Hash operations for semantic cache and advanced features
  async hgetall(key: string): Promise<Record<string, string>> {
    try {
      return await this.client.hGetAll(key);
    } catch (error) {
      logger.error(`Error getting hash ${key}:`, error);
      throw error;
    }
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    try {
      return await this.client.hSet(key, field, value);
    } catch (error) {
      logger.error(`Error setting hash field ${key}:${field}:`, error);
      throw error;
    }
  }

  async hget(key: string, field: string): Promise<string | undefined> {
    try {
      return await this.client.hGet(key, field);
    } catch (error) {
      logger.error(`Error getting hash field ${key}:${field}:`, error);
      throw error;
    }
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      logger.error(`Error setting expiry for key ${key}:`, error);
      throw error;
    }
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    try {
      return await this.client.rPush(key, values);
    } catch (error) {
      logger.error(`Error pushing to list ${key}:`, error);
      throw error;
    }
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    try {
      return await this.client.lRange(key, start, stop);
    } catch (error) {
      logger.error(`Error getting list range ${key}:`, error);
      throw error;
    }
  }

  async xadd(key: string, id: string, fields: Record<string, string>): Promise<string> {
    try {
      return await this.client.xAdd(key, id, fields);
    } catch (error) {
      logger.error(`Error adding to stream ${key}:`, error);
      throw error;
    }
  }

  async publish(channel: string, message: string): Promise<number> {
    try {
      return await this.client.publish(channel, message);
    } catch (error) {
      logger.error(`Error publishing to channel ${channel}:`, error);
      throw error;
    }
  }

  async lpop(key: string): Promise<string | null> {
    try {
      return await this.client.lPop(key);
    } catch (error) {
      logger.error(`Error popping from list ${key}:`, error);
      throw error;
    }
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    try {
      return await this.client.lPush(key, values);
    } catch (error) {
      logger.error(`Error left-pushing to list ${key}:`, error);
      throw error;
    }
  }

  async ltrim(key: string, start: number, stop: number): Promise<string> {
    try {
      return await this.client.lTrim(key, start, stop);
    } catch (error) {
      logger.error(`Error trimming list ${key}:`, error);
      throw error;
    }
  }

  async xrange(key: string, start = '-', end = '+', count?: number): Promise<any[]> {
    try {
      const options: any = {};
      if (count) {
        options.COUNT = count;
      }
      return await this.client.xRange(key, start, end, options);
    } catch (error) {
      logger.error(`Error reading stream ${key}:`, error);
      throw error;
    }
  }
}

// Create and export a singleton instance
export const redisService = new RedisService();
