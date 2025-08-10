import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import authRoutes from '../routes/auth';
import { testUtils } from './setup';
import { redisService } from '../utils/redisService';

// Create test app
const app = express();
app.use(express.json());
app.use('/auth', authRoutes);

describe('Authentication Routes', () => {
  describe('POST /auth/login', () => {
    beforeEach(() => {
      // Reset mocks
      jest.clearAllMocks();
    });

    it('should login successfully with valid credentials', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          userId: 'demo001',
          password: 'pass001'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('token');
      expect(typeof response.body.token).toBe('string');
      expect(response.body.token.length).toBeGreaterThan(0);
    });

    it('should reject invalid credentials', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          userId: 'invalid_user',
          password: 'wrong_password'
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Invalid credentials');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'User ID is required'
        })
      );
    });

    it('should validate userId length constraints', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          userId: 'ab', // Too short
          password: 'pass1'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'User ID must be between 3 and 50 characters'
        })
      );
    });

    it('should validate password length constraints', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          userId: 'demo001',
          password: 'ab' // Too short
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Password must be between 3 and 100 characters'
        })
      );
    });

    it('should handle Redis errors gracefully', async () => {
      // Mock Redis to throw an error
      (redisService.set as jest.MockedFunction<typeof redisService.set>)
        .mockRejectedValueOnce(new Error('Redis connection failed'));

      const response = await request(app)
        .post('/auth/login')
        .send({
          userId: 'demo001',
          password: 'pass001'
        });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });
  });

  describe('POST /auth/add-key and PUT /auth/add-key', () => {
    const validApiKeyData = {
      token: testUtils.generateTestToken(),
      template: 'openai-chat',
      key: 'sk-test-1234567890abcdef',
      description: 'Test OpenAI API key for chat completions'
    };

    beforeEach(() => {
      jest.clearAllMocks();
      // Mock successful token validation
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));
    });

    ['POST', 'PUT'].forEach(method => {
      describe(`${method} /auth/add-key`, () => {
        it('should add API key successfully', async () => {
          // Mock that template doesn't exist
          testUtils.mockRedisHgetall({});

          const response = await request(app)
            [method.toLowerCase() as 'post' | 'put']('/auth/add-key')
            .send(validApiKeyData);

          expect(response.status).toBe(201);
          expect(response.body).toHaveProperty('success', true);
          expect(response.body).toHaveProperty('message', 'API key added successfully');
          expect(response.body.keyInfo).toHaveProperty('template', validApiKeyData.template);
        });

        it('should update existing API key', async () => {
          // Mock existing key
          testUtils.mockRedisHgetall({
            key: 'old-key-value',
            description: 'Old description',
            created_at: new Date().toISOString()
          });

          const response = await request(app)
            [method.toLowerCase() as 'post' | 'put']('/auth/add-key')
            .send(validApiKeyData);

          expect(response.status).toBe(200);
          expect(response.body).toHaveProperty('success', true);
          expect(response.body).toHaveProperty('message', 'API key updated successfully');
        });

        it('should validate required fields', async () => {
          const response = await request(app)
            [method.toLowerCase() as 'post' | 'put']('/auth/add-key')
            .send({});

          expect(response.status).toBe(400);
          expect(response.body).toHaveProperty('success', false);
          expect(response.body.errors).toContainEqual(
            expect.objectContaining({
              msg: 'Token is required'
            })
          );
        });

        it('should validate template format', async () => {
          const response = await request(app)
            [method.toLowerCase() as 'post' | 'put']('/auth/add-key')
            .send({
              ...validApiKeyData,
              template: 'invalid template name'
            });

          expect(response.status).toBe(400);
          expect(response.body).toHaveProperty('success', false);
          expect(response.body.errors).toContainEqual(
            expect.objectContaining({
              msg: 'Template must contain only letters, numbers, hyphens, and underscores'
            })
          );
        });

        it('should validate API key format', async () => {
          const response = await request(app)
            [method.toLowerCase() as 'post' | 'put']('/auth/add-key')
            .send({
              ...validApiKeyData,
              key: 'invalid-key'
            });

          expect(response.status).toBe(400);
          expect(response.body).toHaveProperty('success', false);
          expect(response.body.errors).toContainEqual(
            expect.objectContaining({
              msg: 'API key must be between 20 and 200 characters'
            })
          );
        });

        it('should reject invalid token', async () => {
          // Mock invalid token
          testUtils.mockRedisGet(null);

          const response = await request(app)
            [method.toLowerCase() as 'post' | 'put']('/auth/add-key')
            .send(validApiKeyData);

          expect(response.status).toBe(401);
          expect(response.body).toHaveProperty('success', false);
          expect(response.body).toHaveProperty('error', 'Invalid or expired token');
        });

        it('should include retry configuration when provided', async () => {
          testUtils.mockRedisHgetall({});

          const dataWithRetry = {
            ...validApiKeyData,
            retry_enabled: true,
            max_retries: 3,
            retry_backoff_ms: 1000
          };

          const response = await request(app)
            [method.toLowerCase() as 'post' | 'put']('/auth/add-key')
            .send(dataWithRetry);

          expect(response.status).toBe(201);
          expect(response.body.keyInfo).toHaveProperty('retry_enabled', true);
          expect(response.body.keyInfo).toHaveProperty('max_retries', 3);
          expect(response.body.keyInfo).toHaveProperty('retry_backoff_ms', 1000);
        });
      });
    });
  });

  describe('GET /auth/validate', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should validate valid token', async () => {
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));

      const response = await request(app)
        .get('/auth/validate')
        .query({ token: testUtils.generateTestToken() });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('valid', true);
      expect(response.body).toHaveProperty('userId', 'test_user_123');
    });

    it('should reject invalid token', async () => {
      testUtils.mockRedisGet(null);

      const response = await request(app)
        .get('/auth/validate')
        .query({ token: 'invalid_token' });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('valid', false);
    });

    it('should validate token parameter', async () => {
      const response = await request(app)
        .get('/auth/validate');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Token is required'
        })
      );
    });
  });

  describe('DELETE /auth/logout', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should logout successfully', async () => {
      testUtils.mockRedisGet(JSON.stringify({
        userId: 'test_user_123',
        timestamp: Date.now()
      }));

      const response = await request(app)
        .delete('/auth/logout')
        .send({ token: testUtils.generateTestToken() });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message', 'Logout successful');
    });

    it('should handle logout with invalid token', async () => {
      testUtils.mockRedisGet(null);

      const response = await request(app)
        .delete('/auth/logout')
        .send({ token: 'invalid_token' });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Invalid or expired token');
    });

    it('should validate token parameter', async () => {
      const response = await request(app)
        .delete('/auth/logout')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body.errors).toContainEqual(
        expect.objectContaining({
          msg: 'Token is required'
        })
      );
    });
  });
});
