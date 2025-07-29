import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import cacheInspectorRoutes from '../routes/cacheInspector';
import intentTrendsRoutes from '../routes/intentTrends';
import { testUtils } from './setup';
import { redisService } from '../utils/redisService';

// Create test app
const app = express();
app.use(express.json());
app.use('/api', cacheInspectorRoutes);
app.use('/api', intentTrendsRoutes);

describe('Analytics Routes', () => {
  describe('Cache Inspector Routes', () => {
    describe('GET /api/cache-inspector', () => {
      beforeEach(() => {
        jest.clearAllMocks();
        // Mock successful token validation
        testUtils.mockRedisGet(JSON.stringify({
          userId: 'test_user_123',
          timestamp: Date.now()
        }));
      });

      it('should perform cache analysis successfully', async () => {
        // Mock cache data with embeddings
        const mockCacheData = {
          'intent1': JSON.stringify({
            intent: 'generate image with AI',
            matched_template: 'openai-dalle',
            confidence: 0.95,
            timestamp: Date.now(),
            embedding: Array.from({ length: 52 }, () => Math.random())
          }),
          'intent2': JSON.stringify({
            intent: 'create text content',
            matched_template: 'openai-chat',
            confidence: 0.87,
            timestamp: Date.now(),
            embedding: Array.from({ length: 52 }, () => Math.random())
          })
        };

        testUtils.mockRedisHgetall(mockCacheData);

        const response = await request(app)
          .get('/api/cache-inspector')
          .query({
            token: testUtils.generateTestToken(),
            similarity_threshold: 0.8,
            min_cluster_size: 2
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('cache_health');
        expect(response.body.cache_health).toHaveProperty('overall_score');
        expect(response.body.cache_health).toHaveProperty('total_entries');
        expect(response.body).toHaveProperty('clusters');
        expect(response.body).toHaveProperty('recommendations');
      });

      it('should validate required token parameter', async () => {
        const response = await request(app)
          .get('/api/cache-inspector');

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('success', false);
        expect(response.body.errors).toContainEqual(
          expect.objectContaining({
            msg: 'Token is required'
          })
        );
      });

      it('should validate similarity threshold range', async () => {
        testUtils.mockRedisGet(JSON.stringify({
          userId: 'test_user_123',
          timestamp: Date.now()
        }));

        const response = await request(app)
          .get('/api/cache-inspector')
          .query({
            token: testUtils.generateTestToken(),
            similarity_threshold: 1.5 // Invalid range
          });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('success', false);
        expect(response.body.errors).toContainEqual(
          expect.objectContaining({
            msg: 'similarity_threshold must be between 0.5 and 0.99'
          })
        );
      });

      it('should handle empty cache gracefully', async () => {
        testUtils.mockRedisHgetall({});

        const response = await request(app)
          .get('/api/cache-inspector')
          .query({
            token: testUtils.generateTestToken()
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('message', 'No cache entries found for analysis');
        expect(response.body.cache_health.total_entries).toBe(0);
      });

      it('should reject invalid token', async () => {
        testUtils.mockRedisGet(null);

        const response = await request(app)
          .get('/api/cache-inspector')
          .query({
            token: 'invalid_token'
          });

        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('success', false);
        expect(response.body).toHaveProperty('error', 'Invalid or expired token');
      });

      it('should handle Redis errors during cache analysis', async () => {
        (redisService.hgetall as jest.MockedFunction<typeof redisService.hgetall>)
          .mockRejectedValueOnce(new Error('Redis scan failed'));

        const response = await request(app)
          .get('/api/cache-inspector')
          .query({
            token: testUtils.generateTestToken()
          });

        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty('success', false);
        expect(response.body).toHaveProperty('error', 'Internal server error');
      });

      it('should provide clustering recommendations', async () => {
        const mockCacheData = {
          'intent1': JSON.stringify({
            intent: 'generate image',
            matched_template: 'openai-dalle',
            confidence: 0.95,
            timestamp: Date.now(),
            embedding: Array.from({ length: 52 }, () => Math.random())
          })
        };

        testUtils.mockRedisHgetall(mockCacheData);

        const response = await request(app)
          .get('/api/cache-inspector')
          .query({
            token: testUtils.generateTestToken()
          });

        expect(response.status).toBe(200);
        expect(response.body.recommendations).toBeInstanceOf(Array);
        expect(response.body.recommendations.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Intent Trends Routes', () => {
    describe('GET /api/intent-trends', () => {
      beforeEach(() => {
        jest.clearAllMocks();
        // Mock successful token validation
        testUtils.mockRedisGet(JSON.stringify({
          userId: 'test_user_123',
          timestamp: Date.now()
        }));
      });

      it('should analyze intent trends successfully', async () => {
        // Mock historical data
        const mockHistoricalData = [
          JSON.stringify({
            intent: 'generate AI images',
            template: 'openai-dalle',
            confidence: 0.95,
            timestamp: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
          }),
          JSON.stringify({
            intent: 'create text content',
            template: 'openai-chat',
            confidence: 0.87,
            timestamp: new Date(Date.now() - 1800000).toISOString() // 30 minutes ago
          })
        ];

        // Mock Redis calls for historical data collection
        (redisService.lrange as jest.MockedFunction<typeof redisService.lrange>)
          .mockResolvedValueOnce(mockHistoricalData) // stream:logs
          .mockResolvedValueOnce([]); // cache entries

        const response = await request(app)
          .get('/api/intent-trends')
          .query({
            token: testUtils.generateTestToken(),
            hours_back: 24,
            min_cluster_size: 2
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('trend_analysis');
        expect(response.body.trend_analysis).toHaveProperty('total_intents');
        expect(response.body.trend_analysis).toHaveProperty('clusters');
        expect(response.body.trend_analysis).toHaveProperty('trending_patterns');
        expect(response.body.trend_analysis).toHaveProperty('temporal_insights');
      });

      it('should validate required token parameter', async () => {
        const response = await request(app)
          .get('/api/intent-trends');

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('success', false);
        expect(response.body.errors).toContainEqual(
          expect.objectContaining({
            msg: 'Token is required'
          })
        );
      });

      it('should validate hours_back parameter range', async () => {
        testUtils.mockRedisGet(JSON.stringify({
          userId: 'test_user_123',
          timestamp: Date.now()
        }));

        const response = await request(app)
          .get('/api/intent-trends')
          .query({
            token: testUtils.generateTestToken(),
            hours_back: 200 // Exceeds 168 hours limit
          });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('success', false);
        expect(response.body.errors).toContainEqual(
          expect.objectContaining({
            msg: 'hours_back must be between 1 and 168 (7 days)'
          })
        );
      });

      it('should handle insufficient data gracefully', async () => {
        // Mock empty historical data
        (redisService.lrange as jest.MockedFunction<typeof redisService.lrange>)
          .mockResolvedValueOnce([]) // stream:logs
          .mockResolvedValueOnce([]); // cache entries

        const response = await request(app)
          .get('/api/intent-trends')
          .query({
            token: testUtils.generateTestToken()
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('message', 'Insufficient data for trend analysis');
        expect(response.body.data_info).toHaveProperty('total_intents', 0);
        expect(response.body.data_info).toHaveProperty('required_minimum', 2);
      });

      it('should reject invalid token', async () => {
        testUtils.mockRedisGet(null);

        const response = await request(app)
          .get('/api/intent-trends')
          .query({
            token: 'invalid_token'
          });

        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('success', false);
        expect(response.body).toHaveProperty('error', 'Invalid or expired token');
      });

      it('should provide trending pattern categorization', async () => {
        const mockHistoricalData = [
          JSON.stringify({
            intent: 'rising trend intent',
            template: 'openai-chat',
            confidence: 0.9,
            timestamp: new Date(Date.now() - 3600000).toISOString()
          }),
          JSON.stringify({
            intent: 'declining trend intent',
            template: 'openai-dalle',
            confidence: 0.8,
            timestamp: new Date(Date.now() - 7200000).toISOString()
          })
        ];

        (redisService.lrange as jest.MockedFunction<typeof redisService.lrange>)
          .mockResolvedValueOnce(mockHistoricalData)
          .mockResolvedValueOnce([]);

        const response = await request(app)
          .get('/api/intent-trends')
          .query({
            token: testUtils.generateTestToken(),
            min_cluster_size: 1 // Lower threshold for test
          });

        expect(response.status).toBe(200);
        expect(response.body.trend_analysis.trending_patterns).toHaveProperty('rising');
        expect(response.body.trend_analysis.trending_patterns).toHaveProperty('declining');
        expect(response.body.trend_analysis.trending_patterns).toHaveProperty('stable');
      });

      it('should include temporal insights', async () => {
        const mockHistoricalData = [
          JSON.stringify({
            intent: 'test intent',
            template: 'openai-chat',
            confidence: 0.9,
            timestamp: new Date().toISOString()
          })
        ];

        (redisService.lrange as jest.MockedFunction<typeof redisService.lrange>)
          .mockResolvedValueOnce(mockHistoricalData)
          .mockResolvedValueOnce([]);

        const response = await request(app)
          .get('/api/intent-trends')
          .query({
            token: testUtils.generateTestToken(),
            min_cluster_size: 1
          });

        expect(response.status).toBe(200);
        expect(response.body.trend_analysis.temporal_insights).toHaveProperty('peak_hours');
        expect(response.body.trend_analysis.temporal_insights).toHaveProperty('activity_distribution');
        expect(response.body.trend_analysis.temporal_insights).toHaveProperty('intent_velocity');
      });
    });

    describe('GET /api/intent-trends/history', () => {
      beforeEach(() => {
        jest.clearAllMocks();
        testUtils.mockRedisGet(JSON.stringify({
          userId: 'test_user_123',
          timestamp: Date.now()
        }));
      });

      it('should retrieve trend analysis history', async () => {
        const mockHistoryEntries = [
          JSON.stringify({
            timestamp: new Date().toISOString(),
            processing_time_ms: 150,
            total_intents: 25,
            clusters_found: 3,
            top_pattern: 'generate AI content',
            recommendations_count: 4
          })
        ];

        (redisService.lrange as jest.MockedFunction<typeof redisService.lrange>)
          .mockResolvedValueOnce(mockHistoryEntries);

        const response = await request(app)
          .get('/api/intent-trends/history')
          .query({
            token: testUtils.generateTestToken(),
            limit: 10
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('history');
        expect(response.body.history).toBeInstanceOf(Array);
        expect(response.body).toHaveProperty('total_analyses');
      });

      it('should validate limit parameter range', async () => {
        const response = await request(app)
          .get('/api/intent-trends/history')
          .query({
            token: testUtils.generateTestToken(),
            limit: 100 // Exceeds maximum
          });

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('success', false);
        expect(response.body.errors).toContainEqual(
          expect.objectContaining({
            msg: 'limit must be between 1 and 50'
          })
        );
      });

      it('should handle empty history gracefully', async () => {
        (redisService.lrange as jest.MockedFunction<typeof redisService.lrange>)
          .mockResolvedValueOnce([]);

        const response = await request(app)
          .get('/api/intent-trends/history')
          .query({
            token: testUtils.generateTestToken()
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('success', true);
        expect(response.body.history).toEqual([]);
        expect(response.body.total_analyses).toBe(0);
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));
    });

    it('should handle malformed cache data in cache inspector', async () => {
      testUtils.mockRedisHgetall({
        'invalid_entry': 'not-valid-json'
      });

      const response = await request(app)
        .get('/api/cache-inspector')
        .query({
          token: testUtils.generateTestToken()
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      // Should filter out invalid entries
      expect(response.body.cache_health.total_entries).toBe(0);
    });

    it('should handle malformed historical data in intent trends', async () => {
      const mockMalformedData = [
        'invalid-json-data',
        JSON.stringify({
          intent: 'valid intent',
          template: 'openai-chat',
          confidence: 0.9,
          timestamp: new Date().toISOString()
        })
      ];

      (redisService.lrange as jest.MockedFunction<typeof redisService.lrange>)
        .mockResolvedValueOnce(mockMalformedData)
        .mockResolvedValueOnce([]);

      const response = await request(app)
        .get('/api/intent-trends')
        .query({
          token: testUtils.generateTestToken(),
          min_cluster_size: 1
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      // Should filter out invalid entries and process valid ones
      expect(response.body.trend_analysis.total_intents).toBe(1);
    });

    it('should handle Redis connection failures gracefully', async () => {
      (redisService.lrange as jest.MockedFunction<typeof redisService.lrange>)
        .mockRejectedValueOnce(new Error('Redis connection lost'));

      const response = await request(app)
        .get('/api/intent-trends')
        .query({
          token: testUtils.generateTestToken()
        });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });
  });
});
