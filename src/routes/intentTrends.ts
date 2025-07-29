import { Router, Request, Response } from 'express';
import { query } from 'express-validator';
import { StatusCodes } from 'http-status-codes';
import { validateRequest } from '../middleware/validation';
import { TokenValidator } from '../utils/tokenValidator';
import { VectorService } from '../utils/vectorService';
import { redisService } from '../utils/redisService';
import { logger } from '../utils/logger';

const router = Router();

interface IntentRecord {
  intent: string;
  timestamp: string;
  template: string;
  confidence: number;
  embedding?: number[];
  cluster_id?: string;
}

interface TrendCluster {
  id: string;
  center: number[];
  intents: IntentRecord[];
  representative_intent: string;
  growth_rate: number;
  popularity_score: number;
  time_span_hours: number;
}

interface TrendAnalysis {
  total_intents: number;
  time_range: { start: string; end: string };
  clusters: TrendCluster[];
  trending_patterns: {
    rising: string[];
    declining: string[];
    stable: string[];
  };
  temporal_insights: {
    peak_hours: number[];
    activity_distribution: Record<string, number>;
    intent_velocity: number;
  };
  recommendations: string[];
}

/**
 * Intent Trend Analysis - Run vector clustering on historical intents
 */
router.get('/intent-trends',
  validateRequest([
    query('token')
      .notEmpty()
      .withMessage('Token is required')
      .isLength({ min: 8, max: 100 })
      .withMessage('Token must be between 8 and 100 characters'),
    query('hours_back')
      .optional()
      .isInt({ min: 1, max: 168 })
      .withMessage('hours_back must be between 1 and 168 (7 days)'),
    query('min_cluster_size')
      .optional()
      .isInt({ min: 2, max: 50 })
      .withMessage('min_cluster_size must be between 2 and 50'),
    query('similarity_threshold')
      .optional()
      .isFloat({ min: 0.5, max: 0.99 })
      .withMessage('similarity_threshold must be between 0.5 and 0.99'),
  ]),
  async (req: Request, res: Response) => {
    const startTime = Date.now();
    let userId: string = '';

    try {
      const { 
        token, 
        hours_back = 24, 
        min_cluster_size = 3,
        similarity_threshold = 0.8
      } = req.query;

      logger.info('Intent Trend Analysis request', {
        requestId: req.requestId,
        hours_back,
        min_cluster_size,
        similarity_threshold
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

      // Step 2: Collect Historical Intent Data
      const intentRecords = await collectHistoricalIntents(
        userId, 
        parseInt(hours_back as string)
      );

      if (intentRecords.length < 2) {
        res.status(StatusCodes.OK).json({
          success: true,
          message: 'Insufficient data for trend analysis',
          data_info: {
            total_intents: intentRecords.length,
            required_minimum: 2,
            suggestion: 'Use the system more to generate trend data'
          }
        });
        return;
      }

      // Step 3: Generate Embeddings for All Intents
      logger.info(`Generating embeddings for ${intentRecords.length} intents`);
      for (const record of intentRecords) {
        record.embedding = VectorService.generateEmbedding(record.intent);
      }

      // Step 4: Perform Vector Clustering
      const clusters = await performVectorClustering(
        intentRecords,
        parseFloat(similarity_threshold as string),
        parseInt(min_cluster_size as string)
      );

      // Step 5: Analyze Trends and Patterns
      const trendAnalysis = await analyzeTrends(
        intentRecords,
        clusters,
        parseInt(hours_back as string)
      );

      // Step 6: Store Analysis Results
      try {
        await storeAnalysisResults(userId, trendAnalysis, startTime);
      } catch (storageError) {
        logger.warn('Failed to store trend analysis results:', storageError);
      }

      // Step 7: Response
      res.status(StatusCodes.OK).json({
        success: true,
        timestamp: new Date().toISOString(),
        processing_time_ms: Date.now() - startTime,
        analysis_params: {
          user_id: userId,
          hours_back: parseInt(hours_back as string),
          min_cluster_size: parseInt(min_cluster_size as string),
          similarity_threshold: parseFloat(similarity_threshold as string)
        },
        trend_analysis: trendAnalysis,
        data_quality: {
          total_records: intentRecords.length,
          clustered_records: clusters.reduce((sum, c) => sum + c.intents.length, 0),
          unclustered_records: intentRecords.length - clusters.reduce((sum, c) => sum + c.intents.length, 0),
          clustering_efficiency: Math.round((clusters.reduce((sum, c) => sum + c.intents.length, 0) / intentRecords.length) * 100)
        }
      });

    } catch (error) {
      logger.error('Intent Trend Analysis error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        requestId: req.requestId,
        userId
      });

      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        message: 'An error occurred during trend analysis',
        requestId: req.requestId
      });
    }
  }
);

/**
 * Get stored trend analysis results
 */
router.get('/intent-trends/history',
  validateRequest([
    query('token')
      .notEmpty()
      .withMessage('Token is required'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage('limit must be between 1 and 50'),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { token, limit = 10 } = req.query;

      const tokenValidation = await TokenValidator.validateToken(token as string);
      if (!tokenValidation.isValid) {
        res.status(StatusCodes.UNAUTHORIZED).json({
          success: false,
          error: 'Invalid or expired token'
        });
        return;
      }

      const userId = tokenValidation.userId!;
      const historyKey = `trends:history:${userId}`;
      
      const historyEntries = await redisService.lrange(historyKey, 0, parseInt(limit as string) - 1);
      const parsedHistory = historyEntries.map(entry => {
        try {
          return JSON.parse(entry);
        } catch {
          return null;
        }
      }).filter(Boolean);

      res.status(StatusCodes.OK).json({
        success: true,
        user_id: userId,
        history: parsedHistory,
        total_analyses: parsedHistory.length
      });

    } catch (error) {
      logger.error('Trend history error:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
);

// Helper Functions

async function collectHistoricalIntents(userId: string, hoursBack: number): Promise<IntentRecord[]> {
  const records: IntentRecord[] = [];
  const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

  try {
    // Get from request logs
    const requestLogKey = `stream:logs:${userId}`;
    const logEntries = await redisService.lrange(requestLogKey, 0, -1);

    for (const entryStr of logEntries) {
      try {
        const entry = JSON.parse(entryStr);
        const entryTime = new Date(entry.timestamp);
        
        if (entryTime >= cutoffTime && entry.intent) {
          records.push({
            intent: entry.intent,
            timestamp: entry.timestamp,
            template: entry.template || 'unknown',
            confidence: entry.confidence || 0
          });
        }
      } catch {
        // Skip invalid entries
      }
    }

    // Get from cache entries
    const cacheKey = `cache_embeddings:${userId}`;
    const cacheEntries = await redisService.hgetall(cacheKey);

    for (const [, entryDataStr] of Object.entries(cacheEntries)) {
      try {
        const entryData = JSON.parse(entryDataStr);
        const entryTime = new Date(entryData.timestamp);
        
        if (entryTime >= cutoffTime && entryData.intent) {
          records.push({
            intent: entryData.intent,
            timestamp: entryData.timestamp,
            template: entryData.matched_template || 'unknown',
            confidence: entryData.confidence || 0
          });
        }
      } catch {
        // Skip invalid entries
      }
    }

    // Remove duplicates based on intent and timestamp
    const uniqueRecords = records.filter((record, index, self) =>
      index === self.findIndex(r => r.intent === record.intent && r.timestamp === record.timestamp)
    );

    // Sort by timestamp (newest first)
    uniqueRecords.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    logger.info(`Collected ${uniqueRecords.length} historical intent records for user ${userId}`);
    return uniqueRecords;

  } catch (error) {
    logger.error('Error collecting historical intents:', error);
    return [];
  }
}

async function performVectorClustering(
  records: IntentRecord[], 
  threshold: number, 
  minClusterSize: number
): Promise<TrendCluster[]> {
  const clusters: TrendCluster[] = [];
  const clustered: Set<number> = new Set();

  for (let i = 0; i < records.length; i++) {
    if (clustered.has(i) || !records[i]?.embedding) continue;

    const currentRecord = records[i]!;
    const clusterIntents: IntentRecord[] = [currentRecord];
    clustered.add(i);

    // Find similar intents
    for (let j = i + 1; j < records.length; j++) {
      if (clustered.has(j) || !records[j]?.embedding) continue;

      const similarity = VectorService.cosineSimilarity(
        currentRecord.embedding!,
        records[j]!.embedding!
      );

      if (similarity >= threshold) {
        clusterIntents.push(records[j]!);
        clustered.add(j);
      }
    }

    // Only create cluster if it meets minimum size
    if (clusterIntents.length >= minClusterSize) {
      const cluster = createTrendCluster(clusterIntents, clusters.length);
      clusters.push(cluster);
    }
  }

  logger.info(`Created ${clusters.length} trend clusters from ${records.length} records`);
  return clusters;
}

function createTrendCluster(intents: IntentRecord[], clusterId: number): TrendCluster {
  // Calculate cluster center (average embedding)
  const center = new Array(384).fill(0); // Assuming 384-dimensional embeddings
  for (const intent of intents) {
    if (intent.embedding) {
      for (let i = 0; i < intent.embedding.length; i++) {
        center[i] += intent.embedding[i];
      }
    }
  }
  for (let i = 0; i < center.length; i++) {
    center[i] /= intents.length;
  }

  // Find representative intent (closest to center)
  let representativeIntent = intents[0]?.intent || 'Unknown';
  let minDistance = Infinity;
  
  for (const intent of intents) {
    if (intent.embedding && intent.embedding.length > 0) {
      // Calculate euclidean distance manually
      let sum = 0;
      for (let i = 0; i < Math.min(center.length, intent.embedding.length); i++) {
        const centerVal = center[i] || 0;
        const embeddingVal = intent.embedding[i] || 0;
        const diff = centerVal - embeddingVal;
        sum += diff * diff;
      }
      const distance = Math.sqrt(sum);
      
      if (distance < minDistance) {
        minDistance = distance;
        representativeIntent = intent.intent;
      }
    }
  }

  // Calculate time span
  const timestamps = intents.map(i => new Date(i.timestamp).getTime());
  const timeSpan = (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60);

  // Calculate growth rate (simple linear approximation)
  const sortedByTime = intents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const firstHalf = sortedByTime.slice(0, Math.floor(sortedByTime.length / 2));
  const secondHalf = sortedByTime.slice(Math.floor(sortedByTime.length / 2));
  const growthRate = timeSpan > 0 ? (secondHalf.length - firstHalf.length) / timeSpan : 0;

  return {
    id: `cluster_${clusterId}`,
    center,
    intents,
    representative_intent: representativeIntent,
    growth_rate: Math.round(growthRate * 100) / 100,
    popularity_score: intents.length,
    time_span_hours: Math.round(timeSpan * 100) / 100
  };
}

async function analyzeTrends(
  records: IntentRecord[], 
  clusters: TrendCluster[], 
  hoursBack: number
): Promise<TrendAnalysis> {
  const timestamps = records.map(r => new Date(r.timestamp).getTime());
  const startTime = new Date(Math.min(...timestamps)).toISOString();
  const endTime = new Date(Math.max(...timestamps)).toISOString();

  // Categorize trends
  const rising = clusters.filter(c => c.growth_rate > 0.1).map(c => c.representative_intent);
  const declining = clusters.filter(c => c.growth_rate < -0.1).map(c => c.representative_intent);
  const stable = clusters.filter(c => Math.abs(c.growth_rate) <= 0.1).map(c => c.representative_intent);

  // Temporal analysis
  const hourlyActivity: Record<string, number> = {};
  
  for (const record of records) {
    const hour = new Date(record.timestamp).getHours();
    hourlyActivity[hour] = (hourlyActivity[hour] || 0) + 1;
  }

  // Find peak hours (top 3)
  const sortedHours = Object.entries(hourlyActivity)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 3)
    .map(([hour]) => parseInt(hour));

  const intentVelocity = records.length / hoursBack; // intents per hour

  // Generate recommendations
  const recommendations = generateTrendRecommendations(clusters, records, hoursBack);

  return {
    total_intents: records.length,
    time_range: { start: startTime, end: endTime },
    clusters: clusters.sort((a, b) => b.popularity_score - a.popularity_score), // Sort by popularity
    trending_patterns: {
      rising,
      declining,
      stable
    },
    temporal_insights: {
      peak_hours: sortedHours,
      activity_distribution: hourlyActivity,
      intent_velocity: Math.round(intentVelocity * 100) / 100
    },
    recommendations
  };
}

function generateTrendRecommendations(
  clusters: TrendCluster[], 
  records: IntentRecord[], 
  hoursBack: number
): string[] {
  const recommendations: string[] = [];

  if (clusters.length === 0) {
    recommendations.push('🔍 No clusters found - user intents are very diverse');
    recommendations.push('📊 Consider creating more specific templates for common patterns');
    return recommendations;
  }

  const largestCluster = clusters.reduce((max, cluster) => 
    cluster.popularity_score > max.popularity_score ? cluster : max
  );

  if (largestCluster.popularity_score > records.length * 0.3) {
    recommendations.push(`🎯 Dominant pattern detected: "${largestCluster.representative_intent}"`);
    recommendations.push('💡 Consider optimizing this template for better performance');
  }

  const risingClusters = clusters.filter(c => c.growth_rate > 0.1);
  if (risingClusters.length > 0) {
    recommendations.push(`📈 Rising trend: "${risingClusters[0]?.representative_intent}"`);
    recommendations.push('🚀 Monitor this pattern for potential new template creation');
  }

  const decliningClusters = clusters.filter(c => c.growth_rate < -0.1);
  if (decliningClusters.length > 0) {
    recommendations.push(`📉 Declining pattern: "${decliningClusters[0]?.representative_intent}"`);
    recommendations.push('🔄 Consider updating or removing underused templates');
  }

  if (records.length / hoursBack < 1) {
    recommendations.push('⏰ Low activity detected - encourage more system usage');
  } else if (records.length / hoursBack > 10) {
    recommendations.push('⚡ High activity detected - consider caching optimizations');
  }

  if (recommendations.length === 0) {
    recommendations.push('✅ Trends look balanced and healthy!');
  }

  return recommendations;
}

async function storeAnalysisResults(userId: string, analysis: TrendAnalysis, startTime: number): Promise<void> {
  try {
    const historyKey = `trends:history:${userId}`;
    const analysisRecord = {
      timestamp: new Date().toISOString(),
      processing_time_ms: Date.now() - startTime,
      total_intents: analysis.total_intents,
      clusters_found: analysis.clusters.length,
      top_pattern: analysis.clusters[0]?.representative_intent || 'none',
      recommendations_count: analysis.recommendations.length,
      time_range: analysis.time_range
    };

    await redisService.lpush(historyKey, JSON.stringify(analysisRecord));
    await redisService.ltrim(historyKey, 0, 99); // Keep last 100 analyses
    await redisService.expire(historyKey, 604800); // 7 days TTL

  } catch (error) {
    logger.error('Failed to store analysis results:', error);
    throw error;
  }
}

export default router;
