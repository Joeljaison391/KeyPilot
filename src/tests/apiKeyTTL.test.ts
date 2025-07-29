import { redisService } from '../utils/redisService';
import { config } from '../config/config';

describe('API Key TTL Tests', () => {
  const testUserId = 'test-user-ttl';
  const testTemplate = 'gemini-chat-completion';

  beforeEach(async () => {
    // Clean up any existing test data
    await redisService.deleteUserSession(testUserId);
    await redisService.deleteApiKey(testUserId, testTemplate);
  });

  afterEach(async () => {
    // Clean up test data
    await redisService.deleteUserSession(testUserId);
    await redisService.deleteApiKey(testUserId, testTemplate);
  });

  it('should automatically cleanup API keys when session expires', async () => {
    // Create a session with short TTL for testing
    const sessionData = {
      status: 'active',
      token: 'test-token',
      activated_at: new Date().toISOString()
    };
    
    // Set session with 2 second TTL
    await redisService.setUserSession(testUserId, sessionData, 2);
    
    // Add API key with session TTL
    const keyData = {
      encrypted_key: 'encrypted-test-key',
      description: 'Test key for TTL',
      template: testTemplate,
      created_at: new Date().toISOString()
    };
    
    await redisService.setApiKeyWithSessionTTL(testUserId, testTemplate, keyData);
    
    // Verify both session and API key exist
    let session = await redisService.getUserSession(testUserId);
    let apiKey = await redisService.getApiKey(testUserId, testTemplate);
    
    expect(session).toBeTruthy();
    expect(apiKey).toBeTruthy();
    
    // Wait for TTL to expire (3 seconds to be safe)
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Verify both session and API key are automatically cleaned up
    session = await redisService.getUserSession(testUserId);
    apiKey = await redisService.getApiKey(testUserId, testTemplate);
    
    expect(session).toBeNull();
    expect(apiKey).toBeNull();
  }, 10000); // 10 second timeout

  it('should sync existing API keys with session TTL on login', async () => {
    // Create API key without TTL (legacy behavior)
    const keyData = {
      encrypted_key: 'encrypted-test-key',
      description: 'Legacy key without TTL',
      template: testTemplate,
      created_at: new Date().toISOString()
    };
    
    await redisService.setApiKey(testUserId, testTemplate, keyData);
    
    // Create session with short TTL
    const sessionData = {
      status: 'active',
      token: 'test-token',
      activated_at: new Date().toISOString()
    };
    
    await redisService.setUserSession(testUserId, sessionData, 2);
    
    // Sync API keys with session TTL
    await redisService.syncApiKeysWithSessionTTL(testUserId);
    
    // Verify API key now has TTL
    const apiKeyTTL = await redisService.ttl(`user:${testUserId}:keys:${testTemplate}`);
    
    expect(apiKeyTTL).toBeGreaterThan(0);
    expect(apiKeyTTL).toBeLessThanOrEqual(2);
  });

  it('should handle getUserApiKeys when keys are expired', async () => {
    // Create session and API key with very short TTL
    const sessionData = {
      status: 'active',
      token: 'test-token',
      activated_at: new Date().toISOString()
    };
    
    await redisService.setUserSession(testUserId, sessionData, 1);
    
    const keyData = {
      encrypted_key: 'encrypted-test-key',
      description: 'Test key',
      template: testTemplate
    };
    
    await redisService.setApiKeyWithSessionTTL(testUserId, testTemplate, keyData);
    
    // Wait for expiry
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // getUserApiKeys should return empty array
    const apiKeys = await redisService.getUserApiKeys(testUserId);
    expect(apiKeys).toEqual([]);
  });
});
