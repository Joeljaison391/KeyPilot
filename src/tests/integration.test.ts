import request from 'supertest';
import { jest } from '@jest/globals';
import App from '../app';
import { testUtils } from './setup';
import { redisService } from '../utils/redisService';

// Create test app instance
const app = new App().app;

describe('End-to-End Integration Tests', () => {
  describe('Complete User Journey', () => {
    let userToken: string;
    const testUser = testUtils.generateTestUser();

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should complete full user authentication flow', async () => {
      // Step 1: Login
      const loginResponse = await request(app)
        .post('/auth/login')
        .send({
          userId: 'demo1',
          password: 'pass1'
        });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body).toHaveProperty('success', true);
      expect(loginResponse.body).toHaveProperty('token');
      
      userToken = loginResponse.body.token;

      // Step 2: Validate token
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'demo1',
        timestamp: Date.now()
      }));

      const validateResponse = await request(app)
        .get('/auth/validate')
        .query({ token: userToken });

      expect(validateResponse.status).toBe(200);
      expect(validateResponse.body).toHaveProperty('valid', true);
      expect(validateResponse.body).toHaveProperty('userId', 'demo1');

      // Step 3: Logout
      const logoutResponse = await request(app)
        .delete('/auth/logout')
        .send({ token: userToken });

      expect(logoutResponse.status).toBe(200);
      expect(logoutResponse.body).toHaveProperty('success', true);
    });

    it('should complete API key management workflow', async () => {
      userToken = testUtils.generateTestToken();
      
      // Mock token validation
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));

      // Step 1: Add API key
      testUtils.mockRedisHgetall({}); // No existing key

      const addKeyResponse = await request(app)
        .post('/auth/add-key')
        .send({
          token: userToken,
          template: 'openai-chat',
          key: 'sk-test-1234567890abcdef',
          description: 'Test OpenAI API key for chat completions',
          retry_enabled: true,
          max_retries: 3,
          retry_backoff_ms: 1000
        });

      expect(addKeyResponse.status).toBe(201);
      expect(addKeyResponse.body).toHaveProperty('success', true);
      expect(addKeyResponse.body.keyInfo).toHaveProperty('template', 'openai-chat');
      expect(addKeyResponse.body.keyInfo).toHaveProperty('retry_enabled', true);

      // Step 2: Update existing API key
      testUtils.mockRedisHgetall({
        key: 'sk-old-key',
        description: 'Old description',
        created_at: new Date().toISOString()
      });

      const updateKeyResponse = await request(app)
        .put('/auth/add-key')
        .send({
          token: userToken,
          template: 'openai-chat',
          key: 'sk-updated-1234567890abcdef',
          description: 'Updated OpenAI API key'
        });

      expect(updateKeyResponse.status).toBe(200);
      expect(updateKeyResponse.body).toHaveProperty('success', true);
      expect(updateKeyResponse.body).toHaveProperty('message', 'API key updated successfully');
    });

    it('should complete proxy request workflow with caching', async () => {
      userToken = testUtils.generateTestToken();
      
      // Mock token validation
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));

      const proxyRequest = {
        token: userToken,
        intent: 'generate a creative story about artificial intelligence',
        payload: {
          prompt: 'Write a story about AI helping humanity',
          max_tokens: 150
        },
        origin: 'https://testapp.com'
      };

      // Step 1: First request (cache miss)
      testUtils.mockRedisHgetall({}); // No cache

      // Mock API key exists
      (redisService.hgetall as jest.MockedFunction<typeof redisService.hgetall>)
        .mockResolvedValueOnce({
          key: 'sk-test-1234567890abcdef',
          description: 'Test key',
          created_at: new Date().toISOString()
        });

      const firstResponse = await request(app)
        .post('/api/proxy')
        .send(proxyRequest);

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.body).toHaveProperty('success', true);
      expect(firstResponse.body).toHaveProperty('cached', false);
      expect(firstResponse.body).toHaveProperty('template');

      // Step 2: Second request (cache hit)
      testUtils.mockRedisHgetall({
        'generate creative story artificial intelligence': JSON.stringify({
          intent: 'generate creative story artificial intelligence',
          matched_template: 'openai-chat',
          confidence: 0.95,
          timestamp: Date.now(),
          api_response: {
            success: true,
            data: { content: 'A story about AI and humanity...' }
          }
        })
      });

      const secondResponse = await request(app)
        .post('/api/proxy')
        .send(proxyRequest);

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body).toHaveProperty('success', true);
      expect(secondResponse.body).toHaveProperty('cached', true);
      expect(secondResponse.body).toHaveProperty('template', 'openai-chat');
    });

    it('should complete semantic testing workflow', async () => {
      userToken = testUtils.generateTestToken();
      
      // Mock token validation
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));

      const testRequest = {
        token: userToken,
        intent: 'create an artistic image of a futuristic city',
        debug_level: 'detailed'
      };

      const response = await request(app)
        .post('/api/proxy/test')
        .send(testRequest);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('semantic_analysis');
      
      const analysis = response.body.semantic_analysis;
      expect(analysis).toHaveProperty('intent_processing');
      expect(analysis).toHaveProperty('vector_analysis');
      expect(analysis).toHaveProperty('template_matching');
      expect(analysis).toHaveProperty('recommendations');
      expect(analysis.recommendations).toHaveProperty('confidence_level');
    });

    it('should complete feedback submission and analytics workflow', async () => {
      userToken = testUtils.generateTestToken();
      
      // Mock token validation
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));

      // Step 1: Submit feedback
      const feedbackRequest = {
        token: userToken,
        intent: 'generate creative content using AI',
        matched_template: 'openai-chat',
        feedback_type: 'match_quality',
        rating: 4,
        comments: 'Good match, but could be more specific for creative tasks'
      };

      const feedbackResponse = await request(app)
        .post('/api/feedback')
        .send(feedbackRequest);

      expect(feedbackResponse.status).toBe(201);
      expect(feedbackResponse.body).toHaveProperty('success', true);
      expect(feedbackResponse.body).toHaveProperty('feedback_id');
      expect(feedbackResponse.body.feedback_summary).toHaveProperty('rating', 4);

      // Step 2: Get feedback statistics
      const mockFeedbackData = {
        [feedbackResponse.body.feedback_id]: JSON.stringify({
          feedback_type: 'match_quality',
          rating: 4,
          timestamp: Date.now(),
          template: 'openai-chat',
          has_comments: true
        })
      };

      testUtils.mockRedisHgetall(mockFeedbackData);

      const statsResponse = await request(app)
        .get('/api/feedback-stats')
        .query({ token: userToken });

      expect(statsResponse.status).toBe(200);
      expect(statsResponse.body).toHaveProperty('success', true);
      expect(statsResponse.body.feedback_analytics).toHaveProperty('total_feedback', 1);
      expect(statsResponse.body.feedback_analytics).toHaveProperty('average_rating', 4);
    });

    it('should complete cache inspection workflow', async () => {
      userToken = testUtils.generateTestToken();
      
      // Mock token validation
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));

      // Mock cache data with multiple entries
      const mockCacheData = {
        'intent1': JSON.stringify({
          intent: 'generate AI image',
          matched_template: 'openai-dalle',
          confidence: 0.95,
          timestamp: Date.now(),
          embedding: Array.from({ length: 52 }, () => Math.random())
        }),
        'intent2': JSON.stringify({
          intent: 'create AI art',
          matched_template: 'openai-dalle',
          confidence: 0.92,
          timestamp: Date.now(),
          embedding: Array.from({ length: 52 }, () => Math.random())
        }),
        'intent3': JSON.stringify({
          intent: 'write text content',
          matched_template: 'openai-chat',
          confidence: 0.88,
          timestamp: Date.now(),
          embedding: Array.from({ length: 52 }, () => Math.random())
        })
      };

      testUtils.mockRedisHgetall(mockCacheData);

      const response = await request(app)
        .get('/api/cache-inspector')
        .query({
          token: userToken,
          similarity_threshold: 0.8,
          min_cluster_size: 2
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('cache_health');
      expect(response.body.cache_health).toHaveProperty('total_entries', 3);
      expect(response.body).toHaveProperty('clusters');
      expect(response.body).toHaveProperty('recommendations');
      expect(response.body.recommendations).toBeInstanceOf(Array);
    });

    it('should complete intent trends analysis workflow', async () => {
      userToken = testUtils.generateTestToken();
      
      // Mock token validation
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));

      // Mock historical data
      const mockHistoricalData = [
        JSON.stringify({
          intent: 'generate AI images',
          template: 'openai-dalle',
          confidence: 0.95,
          timestamp: new Date(Date.now() - 3600000).toISOString()
        }),
        JSON.stringify({
          intent: 'create AI art',
          template: 'openai-dalle',
          confidence: 0.92,
          timestamp: new Date(Date.now() - 1800000).toISOString()
        }),
        JSON.stringify({
          intent: 'write creative story',
          template: 'openai-chat',
          confidence: 0.89,
          timestamp: new Date(Date.now() - 900000).toISOString()
        })
      ];

      (redisService.lrange as jest.MockedFunction<typeof redisService.lrange>)
        .mockResolvedValueOnce(mockHistoricalData)
        .mockResolvedValueOnce([]);

      const response = await request(app)
        .get('/api/intent-trends')
        .query({
          token: userToken,
          hours_back: 24,
          min_cluster_size: 2
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('trend_analysis');
      expect(response.body.trend_analysis).toHaveProperty('total_intents', 3);
      expect(response.body.trend_analysis).toHaveProperty('clusters');
      expect(response.body.trend_analysis).toHaveProperty('trending_patterns');
      expect(response.body.trend_analysis.trending_patterns).toHaveProperty('rising');
      expect(response.body.trend_analysis.trending_patterns).toHaveProperty('declining');
      expect(response.body.trend_analysis.trending_patterns).toHaveProperty('stable');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should handle authentication failure cascade', async () => {
      const invalidToken = 'invalid_token_12345';

      // All authenticated endpoints should fail with same error
      const endpoints = [
        { method: 'post', path: '/auth/add-key', data: { token: invalidToken, template: 'test', key: 'test-key', description: 'test' } },
        { method: 'get', path: '/auth/validate', query: { token: invalidToken } },
        { method: 'delete', path: '/auth/logout', data: { token: invalidToken } },
        { method: 'post', path: '/api/proxy', data: { token: invalidToken, intent: 'test', payload: {} } },
        { method: 'post', path: '/api/proxy/test', data: { token: invalidToken, intent: 'test' } },
        { method: 'post', path: '/api/feedback', data: { token: invalidToken, intent: 'test', matched_template: 'test', feedback_type: 'match_quality', rating: 3 } },
        { method: 'get', path: '/api/feedback-stats', query: { token: invalidToken } },
        { method: 'get', path: '/api/cache-inspector', query: { token: invalidToken } },
        { method: 'get', path: '/api/intent-trends', query: { token: invalidToken } }
      ];

      testUtils.mockRedisGet(null); // Invalid token

      for (const endpoint of endpoints) {
        let response;
        if (endpoint.method === 'get') {
          response = await request(app)
            .get(endpoint.path)
            .query(endpoint.query || {});
        } else if (endpoint.method === 'post') {
          response = await request(app)
            .post(endpoint.path)
            .send(endpoint.data || {});
        } else if (endpoint.method === 'delete') {
          response = await request(app)
            .delete(endpoint.path)
            .send(endpoint.data || {});
        }

        expect(response?.status).toBe(401);
        expect(response?.body).toHaveProperty('success', false);
        expect(response?.body.error).toContain('Invalid or expired token');
      }
    });

    it('should handle Redis connection failures gracefully', async () => {
      // Mock Redis connection failure
      (redisService.get as jest.MockedFunction<typeof redisService.get>)
        .mockRejectedValue(new Error('Redis connection failed'));

      const loginResponse = await request(app)
        .post('/auth/login')
        .send({
          userId: 'demo1',
          password: 'pass1'
        });

      expect(loginResponse.status).toBe(500);
      expect(loginResponse.body).toHaveProperty('success', false);
      expect(loginResponse.body).toHaveProperty('error', 'Internal server error');
    });

    it('should handle malformed request data', async () => {
      const endpoints = [
        { method: 'post', path: '/auth/login', data: { invalid: 'data' } },
        { method: 'post', path: '/auth/add-key', data: { invalid: 'data' } },
        { method: 'post', path: '/api/proxy', data: { invalid: 'data' } },
        { method: 'post', path: '/api/feedback', data: { invalid: 'data' } }
      ];

      for (const endpoint of endpoints) {
        const response = await request(app)
          .post(endpoint.path)
          .send(endpoint.data);

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('success', false);
        expect(response.body).toHaveProperty('errors');
        expect(response.body.errors).toBeInstanceOf(Array);
      }
    });

    it('should handle concurrent requests properly', async () => {
      // Mock successful authentication
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));

      const token = testUtils.generateTestToken();
      const concurrentRequests = 10;

      // Create concurrent proxy requests
      const requests = Array.from({ length: concurrentRequests }, (_, i) =>
        request(app)
          .post('/api/proxy/test')
          .send({
            token,
            intent: `test intent ${i}`,
            debug_level: 'basic'
          })
      );

      const responses = await Promise.all(requests);

      // All requests should succeed
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('success', true);
        expect(response.body).toHaveProperty('semantic_analysis');
      });

      // Verify request IDs are unique
      const requestIds = responses.map(r => r.body.request_id).filter(Boolean);
      if (requestIds.length > 0) {
        const uniqueIds = new Set(requestIds);
        expect(uniqueIds.size).toBe(requestIds.length);
      }
    });

    it('should maintain data consistency across operations', async () => {
      const token = testUtils.generateTestToken();
      
      // Mock token validation
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));

      // Step 1: Add API key
      testUtils.mockRedisHgetall({});

      await request(app)
        .post('/auth/add-key')
        .send({
          token,
          template: 'consistency-test',
          key: 'sk-consistency-test-key',
          description: 'Consistency test key'
        });

      // Step 2: Use the key in proxy request
      testUtils.mockRedisHgetall({}); // No cache

      // Mock the key exists when proxy tries to use it
      (redisService.hgetall as jest.MockedFunction<typeof redisService.hgetall>)
        .mockResolvedValueOnce({
          key: 'sk-consistency-test-key',
          description: 'Consistency test key',
          created_at: new Date().toISOString()
        });

      const proxyResponse = await request(app)
        .post('/api/proxy')
        .send({
          token,
          intent: 'test consistency',
          payload: { test: true }
        });

      expect(proxyResponse.status).toBe(200);
      expect(proxyResponse.body).toHaveProperty('success', true);

      // Step 3: Submit feedback for the interaction
      const feedbackResponse = await request(app)
        .post('/api/feedback')
        .send({
          token,
          intent: 'test consistency',
          matched_template: 'consistency-test',
          feedback_type: 'system_performance',
          rating: 5
        });

      expect(feedbackResponse.status).toBe(201);
      expect(feedbackResponse.body).toHaveProperty('success', true);
    });
  });

  describe('Performance and Load Testing', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // Mock successful authentication for all performance tests
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));
    });

    it('should handle high-frequency feedback submissions', async () => {
      const token = testUtils.generateTestToken();
      const submissionCount = 20;

      const submissions = Array.from({ length: submissionCount }, (_, i) =>
        request(app)
          .post('/api/feedback')
          .send({
            token,
            intent: `performance test intent ${i}`,
            matched_template: 'openai-chat',
            feedback_type: 'match_quality',
            rating: Math.floor(Math.random() * 5) + 1
          })
      );

      const startTime = Date.now();
      const responses = await Promise.all(submissions);
      const endTime = Date.now();

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('success', true);
      });

      // Performance check: should complete within reasonable time
      const totalTime = endTime - startTime;
      expect(totalTime).toBeLessThan(10000); // Less than 10 seconds

      console.log(`✓ ${submissionCount} concurrent feedback submissions completed in ${totalTime}ms`);
    });

    it('should handle large cache inspection efficiently', async () => {
      const token = testUtils.generateTestToken();

      // Mock large cache dataset
      const largeCacheData: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        largeCacheData[`intent_${i}`] = JSON.stringify({
          intent: `test intent ${i}`,
          matched_template: i % 3 === 0 ? 'openai-chat' : 'openai-dalle',
          confidence: 0.8 + (Math.random() * 0.2),
          timestamp: Date.now() - (i * 1000),
          embedding: Array.from({ length: 52 }, () => Math.random())
        });
      }

      testUtils.mockRedisHgetall(largeCacheData);

      const startTime = Date.now();
      const response = await request(app)
        .get('/api/cache-inspector')
        .query({
          token,
          similarity_threshold: 0.8,
          min_cluster_size: 3
        });
      const endTime = Date.now();

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.cache_health.total_entries).toBe(50);

      const processingTime = endTime - startTime;
      expect(processingTime).toBeLessThan(5000); // Less than 5 seconds

      console.log(`✓ Cache inspection of 50 entries completed in ${processingTime}ms`);
    });
  });
});
