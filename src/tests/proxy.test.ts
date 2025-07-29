import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import proxyRoutes from '../routes/proxy';
import { testUtils } from './setup';
import { redisService } from '../utils/redisService';

// Mock external API calls
jest.mock('node-fetch', () => jest.fn());

// Create test app
const app = express();
app.use(express.json());
app.use('/api', proxyRoutes);

describe('Proxy Routes', () => {
  describe('POST /api/proxy', () => {
    const validProxyRequest = {
      token: testUtils.generateTestToken(),
      intent: 'generate a creative story about space exploration',
      payload: {
        prompt: 'Write a story about Mars',
        max_tokens: 100
      },
      origin: 'https://testapp.com'
    };

    beforeEach(() => {
      jest.clearAllMocks();
      // Mock successful token validation
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));
    });

    it('should process proxy request successfully with cached response', async () => {
      // Mock cache hit
      testUtils.mockRedisHgetall({
        'generate creative story space exploration': JSON.stringify({
          intent: 'generate creative story space exploration',
          matched_template: 'openai-chat',
          confidence: 0.95,
          timestamp: Date.now(),
          api_response: {
            success: true,
            data: { content: 'A story about Mars exploration...' }
          }
        })
      });

      // Mock API key exists
      (redisService.hgetall as jest.MockedFunction<typeof redisService.hgetall>)
        .mockResolvedValueOnce({
          key: 'sk-test-1234567890abcdef',
          description: 'Test key',
          created_at: new Date().toISOString()
        });

      const response = await request(app)
        .post('/api/proxy')
        .send(validProxyRequest);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('cached', true);
      expect(response.body).toHaveProperty('template', 'openai-chat');
      expect(response.body).toHaveProperty('confidence');
      expect(response.body.data).toHaveProperty('content');
    });

    it('should process proxy request with template matching', async () => {
      // Mock cache miss
      testUtils.mockRedisHgetall({});

      // Mock API key exists
      (redisService.hgetall as jest.MockedFunction<typeof redisService.hgetall>)
        .mockResolvedValueOnce({
          key: 'sk-test-1234567890abcdef',
          description: 'Test key',
          created_at: new Date().toISOString()
        });

      // Mock external API response
      const mockFetch = require('node-fetch');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{
            message: { content: 'Generated story about Mars...' }
          }]
        })
      });

      const response = await request(app)
        .post('/api/proxy')
        .send(validProxyRequest);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('cached', false);
      expect(response.body).toHaveProperty('template');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/proxy')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Token is required'
        })
      );
    });

    it('should validate intent length', async () => {
      const response = await request(app)
        .post('/api/proxy')
        .send({
          ...validProxyRequest,
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

    it('should reject invalid token', async () => {
      testUtils.mockRedisGet(null);

      const response = await request(app)
        .post('/api/proxy')
        .send(validProxyRequest);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Invalid or expired token');
    });

    it('should handle missing API key', async () => {
      // Mock cache miss
      testUtils.mockRedisHgetall({});

      // Mock no API key found
      (redisService.hgetall as jest.MockedFunction<typeof redisService.hgetall>)
        .mockResolvedValueOnce({});

      const response = await request(app)
        .post('/api/proxy')
        .send(validProxyRequest);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'No API key found for template');
    });

    it('should handle external API errors', async () => {
      // Mock cache miss
      testUtils.mockRedisHgetall({});

      // Mock API key exists
      (redisService.hgetall as jest.MockedFunction<typeof redisService.hgetall>)
        .mockResolvedValueOnce({
          key: 'sk-test-1234567890abcdef',
          description: 'Test key',
          created_at: new Date().toISOString()
        });

      // Mock external API error
      const mockFetch = require('node-fetch');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          error: { message: 'Invalid API key' }
        })
      });

      const response = await request(app)
        .post('/api/proxy')
        .send(validProxyRequest);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'API request failed');
    });

    it('should validate origin URL format', async () => {
      const response = await request(app)
        .post('/api/proxy')
        .send({
          ...validProxyRequest,
          origin: 'invalid-url'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Origin must be a valid URL'
        })
      );
    });
  });

  describe('POST /api/proxy/test', () => {
    const validTestRequest = {
      token: testUtils.generateTestToken(),
      intent: 'create an image of a sunset',
      debug_level: 'detailed'
    };

    beforeEach(() => {
      jest.clearAllMocks();
      // Mock successful token validation
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));
    });

    it('should perform semantic testing successfully', async () => {
      const response = await request(app)
        .post('/api/proxy/test')
        .send(validTestRequest);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('semantic_analysis');
      expect(response.body.semantic_analysis).toHaveProperty('intent_processing');
      expect(response.body.semantic_analysis).toHaveProperty('vector_analysis');
      expect(response.body.semantic_analysis).toHaveProperty('template_matching');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/proxy/test')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Token is required'
        })
      );
    });

    it('should validate debug level enum', async () => {
      const response = await request(app)
        .post('/api/proxy/test')
        .send({
          ...validTestRequest,
          debug_level: 'invalid_level'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Debug level must be one of: basic, detailed, verbose'
        })
      );
    });

    it('should reject invalid token', async () => {
      testUtils.mockRedisGet(null);

      const response = await request(app)
        .post('/api/proxy/test')
        .send(validTestRequest);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Invalid or expired token');
    });

    it('should provide detailed analysis in verbose mode', async () => {
      const response = await request(app)
        .post('/api/proxy/test')
        .send({
          ...validTestRequest,
          debug_level: 'verbose'
        });

      expect(response.status).toBe(200);
      expect(response.body.semantic_analysis).toHaveProperty('debug_info');
      expect(response.body.semantic_analysis.debug_info).toHaveProperty('vector_components');
      expect(response.body.semantic_analysis.debug_info).toHaveProperty('similarity_matrix');
    });

    it('should include recommendations for optimization', async () => {
      const response = await request(app)
        .post('/api/proxy/test')
        .send(validTestRequest);

      expect(response.status).toBe(200);
      expect(response.body.semantic_analysis).toHaveProperty('recommendations');
      expect(response.body.semantic_analysis.recommendations).toHaveProperty('primary_match');
      expect(response.body.semantic_analysis.recommendations).toHaveProperty('confidence_level');
      expect(response.body.semantic_analysis.recommendations).toHaveProperty('should_review');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));
    });

    it('should handle Redis connection errors gracefully', async () => {
      // Mock Redis error
      (redisService.hgetall as jest.MockedFunction<typeof redisService.hgetall>)
        .mockRejectedValueOnce(new Error('Redis connection failed'));

      const response = await request(app)
        .post('/api/proxy')
        .send({
          token: testUtils.generateTestToken(),
          intent: 'test intent',
          payload: { test: true }
        });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });

    it('should handle malformed cache data', async () => {
      // Mock malformed cache data
      testUtils.mockRedisHgetall({
        'test intent': 'invalid-json-data'
      });

      // Mock API key exists
      (redisService.hgetall as jest.MockedFunction<typeof redisService.hgetall>)
        .mockResolvedValueOnce({
          key: 'sk-test-1234567890abcdef',
          description: 'Test key',
          created_at: new Date().toISOString()
        });

      const response = await request(app)
        .post('/api/proxy')
        .send({
          token: testUtils.generateTestToken(),
          intent: 'test intent',
          payload: { test: true }
        });

      // Should fall back to template matching since cache data is invalid
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('cached', false);
    });

    it('should handle network timeouts', async () => {
      // Mock cache miss
      testUtils.mockRedisHgetall({});

      // Mock API key exists
      (redisService.hgetall as jest.MockedFunction<typeof redisService.hgetall>)
        .mockResolvedValueOnce({
          key: 'sk-test-1234567890abcdef',
          description: 'Test key',
          created_at: new Date().toISOString()
        });

      // Mock network timeout
      const mockFetch = require('node-fetch');
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const response = await request(app)
        .post('/api/proxy')
        .send({
          token: testUtils.generateTestToken(),
          intent: 'test intent',
          payload: { test: true }
        });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });

    it('should handle very long intents', async () => {
      const longIntent = 'a'.repeat(1000); // Exceeds 500 character limit

      const response = await request(app)
        .post('/api/proxy')
        .send({
          token: testUtils.generateTestToken(),
          intent: longIntent,
          payload: { test: true }
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
