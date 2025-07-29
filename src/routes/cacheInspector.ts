import { Router, Request, Response } from 'express';
import { body, query } from 'express-validator';
import { StatusCodes } from 'http-status-codes';
import { validateRequest } from '../middleware/validation';
import { TokenValidator } from '../utils/tokenValidator';
import { VectorService } from '../utils/vectorService';
import { redisService } from '../utils/redisService';
import { logger } from '../utils/logger';

const router = Router();

interface CacheInspectorEntry {
  id: string;
  intent: string;
  payload_summary: string;
  matched_template: string;
  confidence: number;
  timestamp: string;
  cache_age_hours: number;
  embedding_preview: number[];
  similarity_cluster?: string;
}

/**
 * Vector Cache Inspector - Shows what semantic payloads are currently cached
 */
router.get('/cache-inspector',
  validateRequest([
    query('token')
      .notEmpty()
      .withMessage('Token is required')
      .isLength({ min: 8, max: 100 })
      .withMessage('Token must be between 8 and 100 characters'),
    query('include_embeddings')
      .optional()
      .isBoolean()
      .withMessage('include_embeddings must be a boolean'),
    query('cluster_analysis')
      .optional()
      .isBoolean()
      .withMessage('cluster_analysis must be a boolean'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('limit must be between 1 and 100'),
  ]),
  async (req: Request, res: Response) => {
    const startTime = Date.now();
    let userId: string = '';

    try {
      const { 
        token, 
        include_embeddings = false, 
        cluster_analysis = false,
        limit = 50 
      } = req.query;

      logger.info('Vector Cache Inspector request', {
        requestId: req.requestId,
        include_embeddings,
        cluster_analysis,
        limit
      });

      // Step 1: Validate Token
      const tokenValidation = await TokenValidator.validateToken(token as string);
      if (!tokenValidation.isValid) {
        res.status(StatusCodes.UNAUTHORIZED).json({
          success: false,
          error: 'Invalid or expired token',
          message: tokenValidation.error
        });
        return;
      }

      userId = tokenValidation.userId!;

      // Step 2: Get All Cache Entries for User
      const cacheKey = `cache_embeddings:${userId}`;
      const cacheEntries = await redisService.hgetall(cacheKey);

      if (Object.keys(cacheEntries).length === 0) {
        res.status(StatusCodes.OK).json({
          success: true,
          message: 'No cached entries found',
          cache_info: {
            total_entries: 0,
            user_id: userId,
            cache_key: cacheKey
          },
          entries: [],
          analysis: null
        });
        return;
      }

      // Step 3: Parse and Process Cache Entries
      const parsedEntries: CacheInspectorEntry[] = [];
      const embeddings: number[][] = [];
      
      for (const [entryId, entryDataStr] of Object.entries(cacheEntries)) {
        try {
          const entryData = JSON.parse(entryDataStr);
          
          // Calculate cache age
          const cacheAge = (Date.now() - new Date(entryData.timestamp).getTime()) / (1000 * 60 * 60);
          
          // Generate embedding for analysis
          const embedding = VectorService.generateEmbedding(
            `${entryData.intent} ${entryData.payload_hash || ''}`
          );
          
          const inspectorEntry: CacheInspectorEntry = {
            id: entryId,
            intent: entryData.intent,
            payload_summary: CacheInspectorHelpers.summarizePayload(entryData),
            matched_template: entryData.matched_template,
            confidence: entryData.confidence,
            timestamp: entryData.timestamp,
            cache_age_hours: Math.round(cacheAge * 100) / 100,
            embedding_preview: include_embeddings ? embedding.slice(0, 10) : embedding.slice(0, 3)
          };

          parsedEntries.push(inspectorEntry);
          if (cluster_analysis) {
            embeddings.push(embedding);
          }

        } catch (parseError) {
          logger.warn(`Failed to parse cache entry ${entryId}:`, parseError);
        }
      }

      // Step 4: Sort by timestamp (newest first) and limit
      parsedEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const limitedEntries = parsedEntries.slice(0, parseInt(limit as string));

      // Step 5: Optional Cluster Analysis
      let clusterAnalysis = null;
      if (cluster_analysis && embeddings.length > 1) {
        clusterAnalysis = await CacheInspectorHelpers.performClusterAnalysis(limitedEntries, embeddings.slice(0, limitedEntries.length));
      }

      // Step 6: Generate Cache Statistics
      const cacheStats = {
        total_entries: parsedEntries.length,
        entries_shown: limitedEntries.length,
        templates_distribution: CacheInspectorHelpers.getTemplateDistribution(parsedEntries),
        confidence_stats: CacheInspectorHelpers.getConfidenceStats(parsedEntries),
        age_distribution: CacheInspectorHelpers.getAgeDistribution(parsedEntries),
        intent_patterns: CacheInspectorHelpers.getIntentPatterns(parsedEntries),
        cache_health: {
          avg_confidence: Math.round(parsedEntries.reduce((sum, e) => sum + e.confidence, 0) / parsedEntries.length * 100) / 100,
          avg_age_hours: Math.round(parsedEntries.reduce((sum, e) => sum + e.cache_age_hours, 0) / parsedEntries.length * 100) / 100,
          stale_entries: parsedEntries.filter(e => e.cache_age_hours > 6).length,
          high_confidence_entries: parsedEntries.filter(e => e.confidence > 0.9).length
        }
      };

      // Step 7: Store Inspector Log
      try {
        await redisService.lpush(`cache:inspector:${userId}`, JSON.stringify({
          timestamp: new Date().toISOString(),
          total_entries: parsedEntries.length,
          analysis_type: cluster_analysis ? 'with_clustering' : 'basic',
          processing_time_ms: Date.now() - startTime
        }));
        await redisService.ltrim(`cache:inspector:${userId}`, 0, 49); // Keep last 50 inspections
      } catch (logError) {
        logger.warn('Failed to log cache inspection:', logError);
      }

      // Step 8: Response
      res.status(StatusCodes.OK).json({
        success: true,
        timestamp: new Date().toISOString(),
        processing_time_ms: Date.now() - startTime,
        cache_info: {
          user_id: userId,
          cache_key: cacheKey,
          redis_ttl: await redisService.ttl(cacheKey)
        },
        statistics: cacheStats,
        entries: limitedEntries,
        cluster_analysis: clusterAnalysis,
        recommendations: CacheInspectorHelpers.generateRecommendations(cacheStats, parsedEntries)
      });

    } catch (error) {
      logger.error('Vector Cache Inspector error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        requestId: req.requestId,
        userId
      });

      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        message: 'An error occurred during cache inspection',
        requestId: req.requestId
      });
    }
  }
);

/**
 * Clear Vector Cache for a user (maintenance endpoint)
 */
router.delete('/cache-inspector/clear',
  validateRequest([
    body('token')
      .notEmpty()
      .withMessage('Token is required'),
    body('confirm')
      .isBoolean()
      .withMessage('Confirmation required'),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { token, confirm } = req.body;

      if (!confirm) {
        res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: 'Confirmation required',
          message: 'Set confirm: true to clear cache'
        });
        return;
      }

      const tokenValidation = await TokenValidator.validateToken(token);
      if (!tokenValidation.isValid) {
        res.status(StatusCodes.UNAUTHORIZED).json({
          success: false,
          error: 'Invalid or expired token'
        });
        return;
      }

      const userId = tokenValidation.userId!;
      const cacheKey = `cache_embeddings:${userId}`;
      
      // Get count before deletion
      const entriesCount = Object.keys(await redisService.hgetall(cacheKey)).length;
      
      // Clear cache
      await redisService.del(cacheKey);

      logger.info(`Vector cache cleared for user ${userId}`, {
        entries_cleared: entriesCount,
        requestId: req.requestId
      });

      res.status(StatusCodes.OK).json({
        success: true,
        message: 'Vector cache cleared successfully',
        entries_cleared: entriesCount,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Cache clear error:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

// Helper methods for the class
class CacheInspectorHelpers {
  static summarizePayload(entryData: any): string {
    try {
      if (entryData.payload_hash) {
        return `Hash: ${entryData.payload_hash.substring(0, 8)}...`;
      }
      return 'Unknown payload structure';
    } catch {
      return 'Error reading payload';
    }
  }

  static async performClusterAnalysis(entries: CacheInspectorEntry[], embeddings: number[][]): Promise<any> {
    try {
      // Simple clustering based on cosine similarity
      const clusters: { [key: string]: CacheInspectorEntry[] } = {};
      const clusterThreshold = 0.8;

      for (let i = 0; i < entries.length; i++) {
        const currentEntry = entries[i];
        const currentEmbedding = embeddings[i];
        
        if (!currentEntry || !currentEmbedding) continue;
        
        let clustered = false;
        
        for (const clusterName of Object.keys(clusters)) {
          const clusterNameParts = clusterName.split('_');
          if (clusterNameParts.length > 1) {
            const clusterIndex = parseInt(clusterNameParts[1] || '0');
            const clusterEmbedding = embeddings[clusterIndex];
            
            if (clusterEmbedding) {
              const similarity = VectorService.cosineSimilarity(currentEmbedding, clusterEmbedding);
              
              if (similarity >= clusterThreshold) {
                clusters[clusterName]?.push(currentEntry);
                currentEntry.similarity_cluster = clusterName;
                clustered = true;
                break;
              }
            }
          }
        }

        if (!clustered) {
          const newClusterName = `cluster_${Object.keys(clusters).length}`;
          clusters[newClusterName] = [currentEntry];
          currentEntry.similarity_cluster = newClusterName;
        }
      }

      return {
        total_clusters: Object.keys(clusters).length,
        cluster_distribution: Object.fromEntries(
          Object.entries(clusters).map(([name, items]) => [name, items.length])
        ),
        largest_cluster: Object.keys(clusters).reduce((a, b) => {
          const clusterA = clusters[a];
          const clusterB = clusters[b];
          return (clusterA && clusterB && clusterA.length > clusterB.length) ? a : b;
        }),
        analysis_notes: [
          `Found ${Object.keys(clusters).length} semantic clusters`,
          `Threshold: ${clusterThreshold} cosine similarity`,
          `Largest cluster has ${Math.max(...Object.values(clusters).map(c => c.length))} entries`
        ]
      };

    } catch (error) {
      logger.error('Cluster analysis error:', error);
      return { error: 'Failed to perform cluster analysis' };
    }
  }

  static getTemplateDistribution(entries: CacheInspectorEntry[]): Record<string, number> {
    const distribution: Record<string, number> = {};
    for (const entry of entries) {
      distribution[entry.matched_template] = (distribution[entry.matched_template] || 0) + 1;
    }
    return distribution;
  }

  static getConfidenceStats(entries: CacheInspectorEntry[]): any {
    const confidences = entries.map(e => e.confidence);
    return {
      min: Math.min(...confidences),
      max: Math.max(...confidences),
      avg: Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length * 100) / 100,
      high_confidence_count: confidences.filter(c => c > 0.9).length,
      low_confidence_count: confidences.filter(c => c < 0.7).length
    };
  }

  static getAgeDistribution(entries: CacheInspectorEntry[]): any {
    const ages = entries.map(e => e.cache_age_hours);
    return {
      newest_hours: Math.min(...ages),
      oldest_hours: Math.max(...ages),
      avg_age_hours: Math.round(ages.reduce((a, b) => a + b, 0) / ages.length * 100) / 100,
      fresh_entries: ages.filter(a => a < 1).length,
      stale_entries: ages.filter(a => a > 6).length
    };
  }

  static getIntentPatterns(entries: CacheInspectorEntry[]): any {
    const words: Record<string, number> = {};
    const lengths: number[] = [];

    for (const entry of entries) {
      const intentWords = entry.intent.toLowerCase().split(/\s+/);
      lengths.push(intentWords.length);
      
      for (const word of intentWords) {
        if (word.length > 3) { // Filter out short words
          words[word] = (words[word] || 0) + 1;
        }
      }
    }

    const sortedWords = Object.entries(words)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10);

    return {
      common_words: sortedWords,
      avg_intent_length: Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length),
      intent_variety: Object.keys(words).length
    };
  }

  static generateRecommendations(stats: any, _entries: CacheInspectorEntry[]): string[] {
    const recommendations: string[] = [];

    if (stats.cache_health.stale_entries > stats.total_entries * 0.3) {
      recommendations.push('⚠️ Many stale cache entries - consider clearing old cache');
    }

    if (stats.cache_health.avg_confidence < 0.8) {
      recommendations.push('📊 Low average confidence - review template matching');
    }

    if (stats.total_entries > 100) {
      recommendations.push('🧹 Large cache size - consider implementing auto-cleanup');
    }

    if (Object.keys(stats.templates_distribution).length === 1) {
      recommendations.push('🎯 Only one template in use - consider adding more templates');
    }

    if (recommendations.length === 0) {
      recommendations.push('✅ Cache looks healthy!');
    }

    return recommendations;
  }
}

// Remove the router middleware that was causing issues
export default router;
