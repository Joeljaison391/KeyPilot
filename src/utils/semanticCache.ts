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
  payload: any; // Store the actual payload for better semantic comparison
}

interface CacheSearchResult {
  found: boolean;
  entry?: CacheEntry;
  confidence?: number;
}

export class SemanticCache {
  private static readonly CACHE_PREFIX = 'cache_embeddings';
  private static readonly SIMILARITY_THRESHOLD = 0.85; // Lowered for better matching
  private static readonly CACHE_TTL = 21600; // 6 hours
  private static readonly MAX_CACHE_ENTRIES = 3; // Limit to latest 3 entries per user

  /**
   * Search for cached response based on semantic similarity
   */
  static async searchCache(userId: string, intent: string, payload: any): Promise<CacheSearchResult> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}:${userId}`;
      
      // Generate embedding for current request
      const requestText = `${intent} ${JSON.stringify(payload)}`;
      const currentEmbedding = VectorService.generateEmbedding(requestText);
      
      // Get all cached entries for user
      const cachedEntries = await redisService.hgetall(cacheKey);
      
      if (Object.keys(cachedEntries).length === 0) {
        logger.info(`No cached entries found for user ${userId}`);
        return { found: false };
      }

      let bestMatch: CacheEntry | null = null;
      let bestSimilarity = 0;

      logger.info(`Checking ${Object.keys(cachedEntries).length} cached entries for user ${userId}`);

      for (const [entryId, entryDataStr] of Object.entries(cachedEntries)) {
        try {
          const entryData: CacheEntry = JSON.parse(entryDataStr as string);
          
          // Generate embedding for cached entry using the actual payload
          const cachedText = `${entryData.intent} ${JSON.stringify(entryData.payload || entryData.payload_hash)}`;
          const cachedEmbedding = VectorService.generateEmbedding(cachedText);
          
          // Calculate similarity
          const similarity = VectorService.cosineSimilarity(currentEmbedding, cachedEmbedding);
          
          logger.info(`Cache entry ${entryId} similarity: ${similarity.toFixed(3)}`, {
            cached_intent: entryData.intent.substring(0, 50),
            current_intent: intent.substring(0, 50),
            threshold: this.SIMILARITY_THRESHOLD,
            template: entryData.matched_template
          });
          
          if (similarity > bestSimilarity && similarity >= this.SIMILARITY_THRESHOLD) {
            bestSimilarity = similarity;
            bestMatch = entryData;
          }
        } catch (parseError) {
          logger.warn(`Failed to parse cached entry ${entryId}:`, parseError);
        }
      }

      if (bestMatch && bestSimilarity >= this.SIMILARITY_THRESHOLD) {
        logger.info(`🎯 Cache hit for user ${userId}`, {
          intent: intent.substring(0, 50),
          similarity: bestSimilarity,
          template: bestMatch.matched_template,
          cached_intent: bestMatch.intent.substring(0, 50)
        });

        return {
          found: true,
          entry: bestMatch,
          confidence: bestSimilarity
        };
      }

      logger.info(`❌ No cache hit for user ${userId}`, {
        intent: intent.substring(0, 50),
        best_similarity: bestSimilarity,
        threshold: this.SIMILARITY_THRESHOLD,
        entries_checked: Object.keys(cachedEntries).length
      });

      return { found: false };

    } catch (error) {
      logger.error('Semantic cache search error:', error);
      return { found: false };
    }
  }

  /**
   * Store response in semantic cache (maintain only latest 3 entries)
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
        payload_hash: payloadHash,
        payload
      };

      // Get existing entries
      const existingEntries = await redisService.hgetall(cacheKey);
      const entryKeys = Object.keys(existingEntries);

      // If we already have MAX_CACHE_ENTRIES, remove the oldest one
      if (entryKeys.length >= this.MAX_CACHE_ENTRIES) {
        // Parse timestamps and find oldest entries to remove
        const entriesWithTimestamps = entryKeys.map(key => {
          try {
            const entryData = existingEntries[key];
            if (entryData) {
              const data = JSON.parse(entryData);
              return {
                key,
                timestamp: new Date(data.timestamp).getTime()
              };
            }
            return {
              key,
              timestamp: 0 // Invalid entries will be removed first
            };
          } catch {
            return {
              key,
              timestamp: 0 // Invalid entries will be removed first
            };
          }
        });

        // Sort by timestamp (oldest first) and get entries to remove
        entriesWithTimestamps.sort((a, b) => a.timestamp - b.timestamp);
        const entriesToRemove = entriesWithTimestamps.slice(0, entryKeys.length - this.MAX_CACHE_ENTRIES + 1);

        // Remove old entries
        for (const entry of entriesToRemove) {
          await redisService.hdel(cacheKey, entry.key);
          logger.info(`Removed old cache entry ${entry.key} for user ${userId}`);
        }
      }

      // Store new entry
      await redisService.hset(cacheKey, entryId, JSON.stringify(cacheEntry));
      await redisService.expire(cacheKey, this.CACHE_TTL);

      logger.info(`💾 Stored response in semantic cache for user ${userId}`, {
        template,
        intent: intent.substring(0, 50),
        entryId,
        total_entries: Math.min(entryKeys.length + 1, this.MAX_CACHE_ENTRIES)
      });

    } catch (error) {
      logger.error('Failed to store in semantic cache:', error);
    }
  }

  /**
   * Create a hash of the payload for comparison
   */
  private static hashPayload(payload: any): string {
    // Sort keys to ensure consistent hashing regardless of key order
    const sortedPayload = this.sortObjectKeys(payload);
    return Buffer.from(JSON.stringify(sortedPayload)).toString('base64').substring(0, 32);
  }

  /**
   * Recursively sort object keys for consistent hashing
   */
  private static sortObjectKeys(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sortObjectKeys(item));
    }

    const sortedObj: any = {};
    Object.keys(obj).sort().forEach(key => {
      sortedObj[key] = this.sortObjectKeys(obj[key]);
    });

    return sortedObj;
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
