import { jest } from '@jest/globals';

// Mock Redis service for tests
jest.mock('../utils/redisService', () => ({
  redisService: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    hset: jest.fn(),
    hget: jest.fn(),
    hgetall: jest.fn(),
    hdel: jest.fn(),
    hexists: jest.fn(),
    scan: jest.fn(),
    lrange: jest.fn(),
    lpush: jest.fn(),
    ltrim: jest.fn(),
    xadd: jest.fn(),
    xrange: jest.fn(),
    publish: jest.fn(),
    lpop: jest.fn(),
    // Additional methods required by the application
    getUserSession: jest.fn(),
    getAllKeys: jest.fn(),
    setUserSession: jest.fn(),
    delUserSession: jest.fn()
  }
}));

// Import after mocking
import { redisService } from '../utils/redisService';

// Test utilities
export const testUtils = {
  // Mock Redis responses
  mockRedisGet: (value: string | null) => {
    (redisService.get as jest.MockedFunction<typeof redisService.get>).mockResolvedValueOnce(value);
  },
  
  mockRedisHgetall: (value: Record<string, string>) => {
    (redisService.hgetall as jest.MockedFunction<typeof redisService.hgetall>).mockResolvedValueOnce(value);
  },
  
  mockRedisXrange: (entries: any[]) => {
    (redisService.xrange as jest.MockedFunction<typeof redisService.xrange>).mockResolvedValueOnce(entries);
  },
  
  // Generate test tokens
  generateTestToken: () => 'test_token_1234567890abcdef',
  
  // Generate test user data
  generateTestUser: () => ({
    userId: 'test_user_123',
    token: 'test_token_1234567890abcdef'
  }),
  
  // Generate test API key data
  generateTestApiKey: (template: string = 'openai-chat') => ({
    template,
    key: 'sk-test-1234567890abcdef',
    provider: 'openai',
    usage_count: 0,
    created_at: new Date().toISOString()
  }),
  
  // Generate test notification
  generateTestNotification: () => ({
    type: 'info' as const,
    message: 'Test notification',
    timestamp: Date.now(),
    details: { test: true }
  }),
  
  // Clear all Redis mocks
  clearRedisMocks: () => {
    Object.values(redisService).forEach(method => {
      if (jest.isMockFunction(method)) {
        method.mockClear();
      }
    });
  }
};

// Setup test environment
beforeAll(async () => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-key';
  process.env.API_KEY = 'test-api-key';
  process.env.REDIS_URL = 'redis://localhost:6379';
});

afterAll(async () => {
  // Global test cleanup
  await redisService.disconnect();
});

beforeEach(() => {
  // Clear mocks before each test
  jest.clearAllMocks();
  testUtils.clearRedisMocks();
});

afterEach(() => {
  // Cleanup after each test
});
