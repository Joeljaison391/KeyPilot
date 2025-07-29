import { redisService } from './redisService';
import { VectorService } from './vectorService';
import { logger } from './logger';

interface CacheEntry {
  response: any;
  matched_template: string;
  confidence: number;
  timestamp: string;
  intent: string;
  payload_hash: string;
}

interface CacheSearchResult {
  found: boolean;
  entry?: CacheEntry;
  confidence?: number;
}

export class SemanticCache {
  private static readonly CACHE_PREFIX = 'cache_embeddings';
  private static readonly SIMILARITY_THRESHOLD = 0.93;
  private static readonly CACHE_TTL = 21600; // 6 hours

  /**
   * Search for cached response based on semantic similarity
   */
  static async searchCache(userId: string, intent: string, payload: any): Promise<CacheSearchResult> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}:${userId}`;
      
      // Generate embedding for current request
      const currentEmbedding = VectorService.generateEmbedding(`${intent} ${JSON.stringify(payload)}`);
      
      // Get all cached entries for user
      const cachedEntries = await redisService.hgetall(cacheKey);
      
      let bestMatch: CacheEntry | null = null;
      let bestSimilarity = 0;

      for (const [entryId, entryDataStr] of Object.entries(cachedEntries)) {
        try {
          const entryData: CacheEntry = JSON.parse(entryDataStr as string);
          
          // Generate embedding for cached entry
          const cachedEmbedding = VectorService.generateEmbedding(`${entryData.intent} ${entryData.payload_hash}`);
          
          // Calculate similarity
          const similarity = VectorService.cosineSimilarity(currentEmbedding, cachedEmbedding);
          
          if (similarity > bestSimilarity && similarity >= this.SIMILARITY_THRESHOLD) {
            bestSimilarity = similarity;
            bestMatch = entryData;
          }
        } catch (parseError) {
          logger.warn(`Failed to parse cached entry ${entryId}:`, parseError);
        }
      }

      if (bestMatch && bestSimilarity >= this.SIMILARITY_THRESHOLD) {
        logger.info(`Cache hit for user ${userId}`, {
          intent,
          similarity: bestSimilarity,
          template: bestMatch.matched_template
        });

        return {
          found: true,
          entry: bestMatch,
          confidence: bestSimilarity
        };
      }

      return { found: false };

    } catch (error) {
      logger.error('Semantic cache search error:', error);
      return { found: false };
    }
  }

  /**
   * Store response in semantic cache
   */
  static async storeInCache(
    userId: string,
    intent: string,
    payload: any,
    response: any,
    template: string,
    confidence: number
  ): Promise<void> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}:${userId}`;
      const entryId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const payloadHash = this.hashPayload(payload);
      
      const cacheEntry: CacheEntry = {
        response,
        matched_template: template,
        confidence,
        timestamp: new Date().toISOString(),
        intent,
        payload_hash: payloadHash
      };

      // Store with TTL
      await redisService.hset(cacheKey, entryId, JSON.stringify(cacheEntry));
      await redisService.expire(cacheKey, this.CACHE_TTL);

      logger.info(`Stored response in semantic cache for user ${userId}`, {
        template,
        intent: intent.substring(0, 50),
        entryId
      });

    } catch (error) {
      logger.error('Failed to store in semantic cache:', error);
    }
  }

  /**
   * Create a hash of the payload for comparison
   */
  private static hashPayload(payload: any): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64').substring(0, 32);
  }

  /**
   * Clear cache for a user (optional utility)
   */
  static async clearUserCache(userId: string): Promise<void> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}:${userId}`;
      await redisService.del(cacheKey);
      logger.info(`Cleared semantic cache for user ${userId}`);
    } catch (error) {
      logger.error('Failed to clear user cache:', error);
    }
  }

  /**
   * Check if user has cache entries available
   */
  static async hasCache(userId: string): Promise<boolean> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}:${userId}`;
      const exists = await redisService.exists(cacheKey);
      return exists > 0;
    } catch (error) {
      logger.error('Failed to check cache availability:', error);
      return false;
    }
  }
}
