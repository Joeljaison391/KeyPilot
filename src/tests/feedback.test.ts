import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import feedbackRoutes from '../routes/feedback';
import { testUtils } from './setup';
import { redisService } from '../utils/redisService';

// Create test app
const app = express();
app.use(express.json());
app.use('/api', feedbackRoutes);

describe('Feedback Routes', () => {
  describe('POST /api/feedback', () => {
    const validFeedbackRequest = {
      token: testUtils.generateTestToken(),
      intent: 'generate creative story about space',
      matched_template: 'openai-chat',
      feedback_type: 'match_quality',
      rating: 4,
      comments: 'Good match but could be more specific'
    };

    beforeEach(() => {
      jest.clearAllMocks();
      // Mock successful token validation
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));
    });

    it('should submit feedback successfully', async () => {
      const response = await request(app)
        .post('/api/feedback')
        .send(validFeedbackRequest);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message', 'Feedback received successfully');
      expect(response.body).toHaveProperty('feedback_id');
      expect(response.body.feedback_summary).toHaveProperty('rating', 4);
      expect(response.body.feedback_summary).toHaveProperty('feedback_type', 'match_quality');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/feedback')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Token is required'
        })
      );
    });

    it('should validate feedback type enum', async () => {
      const response = await request(app)
        .post('/api/feedback')
        .send({
          ...validFeedbackRequest,
          feedback_type: 'invalid_type'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Feedback type must be one of: match_quality, response_accuracy, system_performance, feature_request, bug_report, general'
        })
      );
    });

    it('should validate rating range', async () => {
      const response = await request(app)
        .post('/api/feedback')
        .send({
          ...validFeedbackRequest,
          rating: 6 // Out of range
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Rating must be between 1 and 5'
        })
      );
    });

    it('should validate intent length', async () => {
      const response = await request(app)
        .post('/api/feedback')
        .send({
          ...validFeedbackRequest,
          intent: 'hi' // Too short
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Intent must be between 3 and 500 characters'
        })
      );
    });

    it('should validate comments length when provided', async () => {
      const response = await request(app)
        .post('/api/feedback')
        .send({
          ...validFeedbackRequest,
          comments: 'a'.repeat(1001) // Too long
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Comments must be between 1 and 1000 characters'
        })
      );
    });

    it('should reject invalid token', async () => {
      testUtils.mockRedisGet(null);

      const response = await request(app)
        .post('/api/feedback')
        .send(validFeedbackRequest);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Invalid or expired token');
    });

    it('should handle feedback without comments', async () => {
      const feedbackWithoutComments = {
        token: testUtils.generateTestToken(),
        intent: 'generate creative story about space',
        matched_template: 'openai-chat',
        feedback_type: 'match_quality',
        rating: 4
      };

      const response = await request(app)
        .post('/api/feedback')
        .send(feedbackWithoutComments);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.feedback_summary).toHaveProperty('has_comments', false);
    });

    it('should track feedback analytics', async () => {
      const response = await request(app)
        .post('/api/feedback')
        .send(validFeedbackRequest);

      expect(response.status).toBe(201);
      
      // Should call Redis operations for analytics
      expect(redisService.hset).toHaveBeenCalled();
      expect(redisService.xadd).toHaveBeenCalled();
    });

    it('should handle Redis storage errors gracefully', async () => {
      // Mock Redis storage error
      (redisService.hset as jest.MockedFunction<typeof redisService.hset>)
        .mockRejectedValueOnce(new Error('Redis storage failed'));

      const response = await request(app)
        .post('/api/feedback')
        .send(validFeedbackRequest);

      // Should still succeed even if Redis storage fails
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('success', true);
    });

    it('should generate unique feedback IDs', async () => {
      const response1 = await request(app)
        .post('/api/feedback')
        .send(validFeedbackRequest);

      const response2 = await request(app)
        .post('/api/feedback')
        .send(validFeedbackRequest);

      expect(response1.body.feedback_id).not.toBe(response2.body.feedback_id);
    });

    it('should include processing time in response', async () => {
      const response = await request(app)
        .post('/api/feedback')
        .send(validFeedbackRequest);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('processing_time_ms');
      expect(typeof response.body.processing_time_ms).toBe('number');
      expect(response.body.processing_time_ms).toBeGreaterThan(0);
    });
  });

  describe('GET /api/feedback-stats', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Mock successful token validation
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));
    });

    it('should retrieve feedback statistics successfully', async () => {
      // Mock feedback data
      const mockFeedbackData = {
        'feedback_1': JSON.stringify({
          feedback_type: 'match_quality',
          rating: 4,
          timestamp: Date.now(),
          template: 'openai-chat'
        }),
        'feedback_2': JSON.stringify({
          feedback_type: 'response_accuracy',
          rating: 5,
          timestamp: Date.now(),
          template: 'openai-dalle'
        })
      };

      testUtils.mockRedisHgetall(mockFeedbackData);

      const response = await request(app)
        .get('/api/feedback-stats')
        .query({
          token: testUtils.generateTestToken()
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('feedback_analytics');
      expect(response.body.feedback_analytics).toHaveProperty('total_feedback');
      expect(response.body.feedback_analytics).toHaveProperty('average_rating');
      expect(response.body.feedback_analytics).toHaveProperty('feedback_by_type');
      expect(response.body.feedback_analytics).toHaveProperty('template_performance');
    });

    it('should validate required token parameter', async () => {
      const response = await request(app)
        .get('/api/feedback-stats');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Token is required'
        })
      );
    });

    it('should reject invalid token', async () => {
      testUtils.mockRedisGet(null);

      const response = await request(app)
        .get('/api/feedback-stats')
        .query({
          token: 'invalid_token'
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Invalid or expired token');
    });

    it('should handle empty feedback data', async () => {
      testUtils.mockRedisHgetall({});

      const response = await request(app)
        .get('/api/feedback-stats')
        .query({
          token: testUtils.generateTestToken()
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.feedback_analytics.total_feedback).toBe(0);
      expect(response.body.feedback_analytics.average_rating).toBe(0);
    });

    it('should calculate accurate statistics', async () => {
      const mockFeedbackData = {
        'feedback_1': JSON.stringify({
          feedback_type: 'match_quality',
          rating: 4,
          timestamp: Date.now(),
          template: 'openai-chat'
        }),
        'feedback_2': JSON.stringify({
          feedback_type: 'match_quality',
          rating: 2,
          timestamp: Date.now(),
          template: 'openai-chat'
        }),
        'feedback_3': JSON.stringify({
          feedback_type: 'response_accuracy',
          rating: 5,
          timestamp: Date.now(),
          template: 'openai-dalle'
        })
      };

      testUtils.mockRedisHgetall(mockFeedbackData);

      const response = await request(app)
        .get('/api/feedback-stats')
        .query({
          token: testUtils.generateTestToken()
        });

      expect(response.status).toBe(200);
      expect(response.body.feedback_analytics.total_feedback).toBe(3);
      expect(response.body.feedback_analytics.average_rating).toBeCloseTo(3.67, 2);
      expect(response.body.feedback_analytics.feedback_by_type).toHaveProperty('match_quality', 2);
      expect(response.body.feedback_analytics.feedback_by_type).toHaveProperty('response_accuracy', 1);
    });

    it('should provide template performance breakdown', async () => {
      const mockFeedbackData = {
        'feedback_1': JSON.stringify({
          feedback_type: 'match_quality',
          rating: 4,
          timestamp: Date.now(),
          template: 'openai-chat'
        }),
        'feedback_2': JSON.stringify({
          feedback_type: 'match_quality',
          rating: 5,
          timestamp: Date.now(),
          template: 'openai-chat'
        })
      };

      testUtils.mockRedisHgetall(mockFeedbackData);

      const response = await request(app)
        .get('/api/feedback-stats')
        .query({
          token: testUtils.generateTestToken()
        });

      expect(response.status).toBe(200);
      expect(response.body.feedback_analytics.template_performance).toHaveProperty('openai-chat');
      expect(response.body.feedback_analytics.template_performance['openai-chat']).toHaveProperty('count', 2);
      expect(response.body.feedback_analytics.template_performance['openai-chat']).toHaveProperty('average_rating', 4.5);
    });

    it('should handle malformed feedback data gracefully', async () => {
      const mockFeedbackData = {
        'feedback_1': 'invalid-json-data',
        'feedback_2': JSON.stringify({
          feedback_type: 'match_quality',
          rating: 4,
          timestamp: Date.now(),
          template: 'openai-chat'
        })
      };

      testUtils.mockRedisHgetall(mockFeedbackData);

      const response = await request(app)
        .get('/api/feedback-stats')
        .query({
          token: testUtils.generateTestToken()
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      // Should filter out invalid entries
      expect(response.body.feedback_analytics.total_feedback).toBe(1);
    });

    it('should include time-based analysis', async () => {
      const now = Date.now();
      const mockFeedbackData = {
        'feedback_1': JSON.stringify({
          feedback_type: 'match_quality',
          rating: 4,
          timestamp: now - 3600000, // 1 hour ago
          template: 'openai-chat'
        }),
        'feedback_2': JSON.stringify({
          feedback_type: 'match_quality',
          rating: 5,
          timestamp: now - 1800000, // 30 minutes ago
          template: 'openai-chat'
        })
      };

      testUtils.mockRedisHgetall(mockFeedbackData);

      const response = await request(app)
        .get('/api/feedback-stats')
        .query({
          token: testUtils.generateTestToken()
        });

      expect(response.status).toBe(200);
      expect(response.body.feedback_analytics).toHaveProperty('recent_feedback_trend');
    });

    it('should handle Redis errors gracefully', async () => {
      (redisService.hgetall as jest.MockedFunction<typeof redisService.hgetall>)
        .mockRejectedValueOnce(new Error('Redis connection failed'));

      const response = await request(app)
        .get('/api/feedback-stats')
        .query({
          token: testUtils.generateTestToken()
        });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });
  });

  describe('Edge Cases and Performance', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));
    });

    it('should handle concurrent feedback submissions', async () => {
      const feedbackPromises = Array.from({ length: 5 }, (_, i) => 
        request(app)
          .post('/api/feedback')
          .send({
            ...{
              token: testUtils.generateTestToken(),
              intent: `test intent ${i}`,
              matched_template: 'openai-chat',
              feedback_type: 'match_quality',
              rating: 4
            }
          })
      );

      const responses = await Promise.all(feedbackPromises);
      
      responses.forEach(response => {
        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('success', true);
      });

      // All feedback IDs should be unique
      const feedbackIds = responses.map(r => r.body.feedback_id);
      const uniqueIds = new Set(feedbackIds);
      expect(uniqueIds.size).toBe(feedbackIds.length);
    });

    it('should handle large feedback datasets in stats', async () => {
      // Generate large mock dataset
      const largeFeedbackData: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        largeFeedbackData[`feedback_${i}`] = JSON.stringify({
          feedback_type: i % 2 === 0 ? 'match_quality' : 'response_accuracy',
          rating: Math.floor(Math.random() * 5) + 1,
          timestamp: Date.now() - (i * 1000),
          template: i % 3 === 0 ? 'openai-chat' : 'openai-dalle'
        });
      }

      testUtils.mockRedisHgetall(largeFeedbackData);

      const response = await request(app)
        .get('/api/feedback-stats')
        .query({
          token: testUtils.generateTestToken()
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.feedback_analytics.total_feedback).toBe(100);
      expect(response.body).toHaveProperty('processing_time_ms');
    });

    it('should validate extremely long intent texts', async () => {
      const veryLongIntent = 'a'.repeat(1000); // Exceeds 500 character limit

      const response = await request(app)
        .post('/api/feedback')
        .send({
          token: testUtils.generateTestToken(),
          intent: veryLongIntent,
          matched_template: 'openai-chat',
          feedback_type: 'match_quality',
          rating: 4
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Intent must be between 3 and 500 characters'
        })
      );
    });
  });
});
