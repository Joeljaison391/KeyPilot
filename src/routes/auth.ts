import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { StatusCodes } from 'http-status-codes';
import { validateRequest } from '../middleware/validation';
import { config } from '../config/config';
import { redisService } from '../utils/redisService';
import { TokenGenerator } from '../utils/tokenGenerator';
import { EncryptionService } from '../utils/encryption';
import { VectorService } from '../utils/vectorService';
import { TokenValidator } from '../utils/tokenValidator';
import { logger } from '../utils/logger';

const router = Router();

interface LoginRequest {
  userId: string;
  password: string;
}

interface UserSession {
  status: 'active';
  token: string;
  activated_at: number;
}

interface LoginResponse {
  success: boolean;
  token: string;
}

// Login endpoint
router.post('/login',
  validateRequest([
    body('userId')
      .notEmpty()
      .withMessage('userId is required')
      .isLength({ min: 1, max: 50 })
      .withMessage('userId must be between 1 and 50 characters')
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('userId can only contain letters, numbers, underscores, and hyphens'),
    body('password')
      .notEmpty()
      .withMessage('password is required')
  ]),
  async (req: Request, res: Response) => {
    try {
      // Log the raw request for debugging
      logger.info('Login request received:', {
        requestId: req.requestId,
        method: req.method,
        contentType: req.get('Content-Type'),
        bodyKeys: Object.keys(req.body || {}),
        bodyValues: req.body ? Object.entries(req.body).reduce((acc, [key, value]) => {
          acc[key] = key === 'password' ? '[REDACTED]' : value;
          return acc;
        }, {} as any) : {},
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });

      const { userId, password }: LoginRequest = req.body;

      logger.info(`Login attempt for user: ${userId || '[MISSING]'}`, {
        requestId: req.requestId,
        hasUserId: !!userId,
        hasPassword: !!password,
        userIdType: typeof userId,
        passwordType: typeof password,
        userIdLength: userId ? userId.length : 0,
        passwordLength: password ? password.length : 0,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });

      // Step 1: Validate Demo User & Password
      if (!config.demoUsers[userId]) {
        logger.warn(`Invalid user login attempt: ${userId}`, {
          requestId: req.requestId,
        });
        res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          error: 'Invalid credentials',
          message: 'User not found or invalid credentials',
        });
        return;
      }

      if (config.demoUsers[userId] !== password) {
        logger.warn(`Invalid password login attempt for user: ${userId}`, {
          requestId: req.requestId,
        });
        res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          error: 'Invalid credentials',
          message: 'User not found or invalid credentials',
        });
        return;
      }

      // Step 2: Check if User is Already Active
      const existingSession = await redisService.getUserSession(userId);
      
      if (existingSession && existingSession.status === 'active') {
        // Check if session is still valid (Redis TTL will handle expiry automatically)
        const ttl = await redisService.ttl(`user:${userId}`);
        
        if (ttl > 0) {
          logger.warn(`User already active login attempt: ${userId}`, {
            requestId: req.requestId,
            existingToken: existingSession.token,
            remainingTtl: ttl,
          });
          
          res.status(StatusCodes.CONFLICT).json({
            success: false,
            error: 'User already in use',
            message: 'This user is currently active in another session',
            remainingTime: ttl,
          });
          return;
        }
      }

      // Step 3: Issue a Secure API Token
      const token = TokenGenerator.generateSecureToken();
      const activatedAt = Math.floor(Date.now() / 1000); // Unix timestamp

      const sessionData: UserSession = {
        status: 'active',
        token,
        activated_at: activatedAt,
      };

      // Step 4: Set Expiry Timeout (30 minutes TTL)
      await redisService.setUserSession(userId, sessionData, config.session.ttl);

      // Step 4.5: Sync existing API keys with session TTL for automatic cleanup
      try {
        await redisService.syncApiKeysWithSessionTTL(userId);
      } catch (syncError) {
        // Log warning but don't fail login if sync fails
        logger.warn(`Failed to sync API keys with session TTL for user ${userId}:`, syncError);
      }

      logger.info(`User login successful: ${userId}`, {
        requestId: req.requestId,
        token,
        ttl: config.session.ttl,
        activatedAt,
      });

      // Step 5: Respond to the Client
      const response: LoginResponse = {
        success: true,
        token,
      };

      res.status(StatusCodes.OK).json(response);

    } catch (error) {
      logger.error('Login error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        requestId: req.requestId,
      });

      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        message: 'An error occurred during login',
      });
    }
  }
);

// Logout endpoint
router.post('/logout',
  validateRequest([
    body('userId')
      .notEmpty()
      .withMessage('userId is required')
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('userId can only contain letters, numbers, underscores, and hyphens'),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.body;

      logger.info(`Logout attempt for user: ${userId}`, {
        requestId: req.requestId,
      });

      // Delete user session from Redis
      const deletedCount = await redisService.deleteUserSession(userId);

      if (deletedCount === 0) {
        res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          error: 'Session not found',
          message: 'No active session found for this user',
        });
        return;
      }

      logger.info(`User logout successful: ${userId}`, {
        requestId: req.requestId,
      });

      res.status(StatusCodes.OK).json({
        success: true,
        message: 'Logout successful',
      });

    } catch (error) {
      logger.error('Logout error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: req.requestId,
      });

      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        message: 'An error occurred during logout',
      });
    }
  }
);

// Get user status endpoint
router.get('/status/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId || !userId.match(/^[a-zA-Z0-9_-]+$/)) {
      res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Invalid userId format',
      });
      return;
    }

    const session = await redisService.getUserSession(userId);
    const ttl = session ? await redisService.ttl(`user:${userId}`) : -1;

    res.status(StatusCodes.OK).json({
      success: true,
      userId,
      active: !!session && session.status === 'active' && ttl > 0,
      remainingTime: ttl > 0 ? ttl : 0,
      activatedAt: session?.activated_at || null,
    });

  } catch (error) {
    logger.error('Status check error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.requestId,
    });

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Internal server error',
      message: 'An error occurred while checking user status',
    });
  }
});

// Get all demo users (for development/testing)
router.get('/demo-users', (_req: Request, res: Response) => {
  if (config.env !== 'development') {
    res.status(StatusCodes.FORBIDDEN).json({
      success: false,
      error: 'Endpoint only available in development mode',
    });
    return;
  }

  (async () => {
    // Get all demo user IDs
    const demoUserIds = Object.keys(config.demoUsers);
    // Check if all demo users are active in Redis
    const activeStatuses = await Promise.all(
      demoUserIds.map(async (userId) => {
        const session = await redisService.getUserSession(userId);
        return session && session.status === 'active';
      })
    );
    const allActive = activeStatuses.length > 0 && activeStatuses.every(Boolean);

    // If all are active, create 3 new demo users and add to config and Redis
    if (allActive) {
  const newUsers: Record<string, string> = {};
      for (let i = 0; i < 3; i++) {
        const newId = `demo${Date.now()}${Math.floor(Math.random()*10000)}`;
        const newPass = Math.random().toString(36).slice(-8);
        newUsers[newId] = newPass;
        // Set a session for the new user (inactive by default, 1 day TTL)
        await redisService.setUserSession(newId, { status: 'inactive', token: '', activated_at: Date.now() }, 24*60*60);
      }
      // Add new users to config.demoUsers (in-memory)
      Object.assign(config.demoUsers, newUsers);
    }

    // Prepare the updated list
    const users = Object.keys(config.demoUsers).map(userId => ({
      userId,
      // Don't expose passwords in response
      passwordHint: `${config.demoUsers[userId]?.substring(0, 2)}***`,
    }));

    res.status(StatusCodes.OK).json({
      success: true,
      demoUsers: users,
      totalUsers: users.length,
      apiInfo: {
        loginEndpoint: 'POST /auth/login',
        demoApiKeyEndpoint: 'POST /auth/demo-api-key',
        loginExample: {
          method: 'POST',
          url: '/auth/login',
          body: {
            userId: 'demo1',
            password: 'pass1'
          }
        },
        demoApiKeyExample: {
          method: 'POST',
          url: '/auth/demo-api-key',
          body: {
            userId: 'demo1',
            token: '<token_from_login_response>'
          }
        }
      }
    });
  })();
});

// Development route to display all Redis data
router.get('/redis-data', async (_req: Request, res: Response) => {
  if (config.env !== 'development') {
    res.status(StatusCodes.FORBIDDEN).json({
      success: false,
      error: 'Endpoint only available in development mode',
    });
    return;
  }

  try {
    // Check Redis connection
    if (!redisService.getConnectionStatus()) {
      res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
        success: false,
        error: 'Redis not connected',
        message: 'Redis service is not available',
      });
      return;
    }

    // Get all keys from Redis
    const allKeys = await redisService.getAllKeys();
    
    if (allKeys.length === 0) {
      res.status(StatusCodes.OK).json({
        success: true,
        message: 'Redis database is empty',
        totalKeys: 0,
        keys: [],
        data: {},
      });
      return;
    }

    // Get data for each key
    const redisData: Record<string, any> = {};
    const keyDetails: Array<{
      key: string;
      type: string;
      ttl: number;
      value: any;
    }> = [];

    for (const key of allKeys) {
      try {
        const value = await redisService.get(key);
        const ttl = await redisService.ttl(key);
        
        let parsedValue = value;
        let valueType = 'string';
        
        // Try to parse JSON
        if (value && typeof value === 'string') {
          try {
            parsedValue = JSON.parse(value);
            valueType = 'json';
          } catch {
            // Keep as string if not valid JSON
            valueType = 'string';
          }
        }

        redisData[key] = {
          value: parsedValue,
          ttl: ttl,
          type: valueType,
        };

        keyDetails.push({
          key,
          type: valueType,
          ttl,
          value: parsedValue,
        });

      } catch (error) {
        logger.error(`Error getting data for key ${key}:`, error);
        redisData[key] = {
          error: 'Failed to retrieve value',
          ttl: -1,
          type: 'error',
        };
      }
    }

    // Separate user sessions for better organization
    const userSessions = keyDetails.filter(item => item.key.startsWith('user:'));
    const otherKeys = keyDetails.filter(item => !item.key.startsWith('user:'));

    // Categorize other data by type for better organization
    const categorizedData = {
      dataframes: otherKeys.filter(k => k.key.startsWith('df:')),
      metadata: otherKeys.filter(k => k.key.startsWith('metadata:')),
      fileData: otherKeys.filter(k => k.key.startsWith('file_data:')),
      metaData: otherKeys.filter(k => k.key.startsWith('meta:')),
      unknown: otherKeys.filter(k => 
        !k.key.startsWith('df:') && 
        !k.key.startsWith('metadata:') && 
        !k.key.startsWith('file_data:') && 
        !k.key.startsWith('meta:') &&
        !k.key.startsWith('data:')
      ),
    };

    res.status(StatusCodes.OK).json({
      success: true,
      timestamp: new Date().toISOString(),
      redisInfo: {
        connected: redisService.getConnectionStatus(),
        totalKeys: allKeys.length,
        userSessions: userSessions.length,
        otherKeys: otherKeys.length,
        dataBreakdown: {
          authSessions: userSessions.length,
          dataframes: categorizedData.dataframes.length,
          metadata: categorizedData.metadata.length,
          fileData: categorizedData.fileData.length,
          metaData: categorizedData.metaData.length,
          unknown: categorizedData.unknown.length,
        }
      },
      userSessions: userSessions.map(session => ({
        userId: session.key.replace('user:', ''),
        key: session.key,
        status: session.value?.status || 'unknown',
        token: session.value?.token || null,
        activatedAt: session.value?.activated_at ? new Date(session.value.activated_at * 1000).toISOString() : null,
        ttl: session.ttl,
        expiresAt: session.ttl > 0 ? new Date(Date.now() + session.ttl * 1000).toISOString() : null,
      })),
      // Only show first 10 items of each category to avoid overwhelming output
      otherData: otherKeys.slice(0, 10),
      dataCategories: {
        dataframes: categorizedData.dataframes.slice(0, 5).map(item => ({
          key: item.key,
          type: item.type,
          ttl: item.ttl,
          hasValue: !!item.value
        })),
        metadata: categorizedData.metadata.slice(0, 5).map(item => ({
          key: item.key,
          type: item.type,
          ttl: item.ttl,
          shape: item.value?.shape || null
        })),
        fileData: categorizedData.fileData.slice(0, 5).map(item => ({
          key: item.key,
          type: item.type,
          ttl: item.ttl,
          keys: item.value ? Object.keys(item.value).slice(0, 5) : []
        })),
      },
      note: "This Redis instance contains data from other applications. Use DELETE /auth/redis-data to clear all data, or filter by key patterns.",
    });

  } catch (error) {
    logger.error('Redis data retrieval error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to retrieve Redis data',
    });
  }
});

// Development route to clear all Redis data
router.delete('/redis-data', async (_req: Request, res: Response) => {
  if (config.env !== 'development') {
    res.status(StatusCodes.FORBIDDEN).json({
      success: false,
      error: 'Endpoint only available in development mode',
    });
    return;
  }

  try {
    if (!redisService.getConnectionStatus()) {
      res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
        success: false,
        error: 'Redis not connected',
        message: 'Redis service is not available',
      });
      return;
    }

    const clearedCount = await redisService.flushAll();
    
    logger.info('Redis database cleared in development mode', {
      clearedKeys: clearedCount,
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Redis database cleared successfully',
      clearedKeys: clearedCount,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('Redis clear error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to clear Redis data',
    });
  }
});

// Development route to clear only non-authentication data
router.delete('/redis-data/external', async (_req: Request, res: Response) => {
  if (config.env !== 'development') {
    res.status(StatusCodes.FORBIDDEN).json({
      success: false,
      error: 'Endpoint only available in development mode',
    });
    return;
  }

  try {
    if (!redisService.getConnectionStatus()) {
      res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
        success: false,
        error: 'Redis not connected',
        message: 'Redis service is not available',
      });
      return;
    }

    // Get all keys
    const allKeys = await redisService.getAllKeys();
    
    // Filter out user session keys (keep only authentication data)
    const keysToDelete = allKeys.filter(key => !key.startsWith('user:'));
    
    let deletedCount = 0;
    for (const key of keysToDelete) {
      try {
        await redisService.del(key);
        deletedCount++;
      } catch (error) {
        logger.warn(`Failed to delete key ${key}:`, error);
      }
    }
    
    logger.info('External Redis data cleared in development mode', {
      totalKeys: allKeys.length,
      deletedKeys: deletedCount,
      remainingKeys: allKeys.length - deletedCount,
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'External Redis data cleared successfully (authentication sessions preserved)',
      totalKeys: allKeys.length,
      deletedKeys: deletedCount,
      remainingKeys: allKeys.length - deletedCount,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('Redis external clear error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to clear external Redis data',
    });
  }
});

// Add API Key endpoint (POST method)
router.post('/add-key',
  validateRequest([
    body('token')
      .notEmpty()
      .withMessage('token is required')
      .isLength({ min: 8, max: 100 })
      .withMessage('token must be between 8 and 100 characters'),
    body('api_key')
      .notEmpty()
      .withMessage('api_key is required')
      .isLength({ min: 10, max: 500 })
      .withMessage('api_key must be between 10 and 500 characters'),
    body('description')
      .notEmpty()
      .withMessage('description is required')
      .isLength({ min: 5, max: 200 })
      .withMessage('description must be between 5 and 200 characters'),
    body('template')
      .notEmpty()
      .withMessage('template is required')
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('template can only contain letters, numbers, underscores, and hyphens')
      .isLength({ min: 1, max: 50 })
      .withMessage('template must be between 1 and 50 characters'),
    body('max_requests_per_day')
      .optional()
      .isInt({ min: 1, max: 100000 })
      .withMessage('max_requests_per_day must be between 1 and 100000'),
    body('max_requests_per_week')
      .optional()
      .isInt({ min: 1, max: 700000 })
      .withMessage('max_requests_per_week must be between 1 and 700000'),
    body('max_tokens_per_day')
      .optional()
      .isInt({ min: 1, max: 10000000 })
      .withMessage('max_tokens_per_day must be between 1 and 10000000'),
    body('max_payload_kb')
      .optional()
      .isInt({ min: 1, max: 100000 })
      .withMessage('max_payload_kb must be between 1 and 100000'),
    body('expiry_date')
      .optional()
      .isISO8601()
      .withMessage('expiry_date must be a valid ISO 8601 date'),
    body('allowed_origins')
      .optional()
      .isArray()
      .withMessage('allowed_origins must be an array'),
    body('allowed_origins.*')
      .optional()
      .isURL({ require_protocol: true })
      .withMessage('each allowed_origin must be a valid URL'),
    body('scopes')
      .optional()
      .isArray()
      .withMessage('scopes must be an array'),
    body('scopes.*')
      .optional()
      .isLength({ min: 1, max: 50 })
      .withMessage('each scope must be between 1 and 50 characters'),
    body('retry_enabled')
      .optional()
      .isBoolean()
      .withMessage('retry_enabled must be a boolean'),
    body('max_retries')
      .optional()
      .isInt({ min: 0, max: 10 })
      .withMessage('max_retries must be between 0 and 10'),
    body('retry_backoff_ms')
      .optional()
      .isInt({ min: 100, max: 30000 })
      .withMessage('retry_backoff_ms must be between 100 and 30000'),
  ]),
  async (req: Request, res: Response) => {
    try {
      const {
        token,
        api_key,
        description,
        template,
        max_requests_per_day = 1000,
        max_requests_per_week = 5000,
        max_tokens_per_day = 100000,
        max_payload_kb = 1000,
        expiry_date,
        allowed_origins = [],
        scopes = [],
        retry_enabled = false,
        max_retries = 3,
        retry_backoff_ms = 3000
      } = req.body;

      logger.info(`Add API key attempt for template: ${template}`, {
        requestId: req.requestId,
        template,
        description: description.substring(0, 50) + '...',
        method: req.method,
      });

      // Step 1: Validate Token
      const tokenValidation = await TokenValidator.validateToken(token);
      if (!tokenValidation.isValid) {
        logger.warn(`Invalid token in add-key request`, {
          requestId: req.requestId,
          error: tokenValidation.error,
        });
        res.status(StatusCodes.UNAUTHORIZED).json({
          success: false,
          error: 'Invalid or expired token',
          message: tokenValidation.error || 'Token validation failed',
        });
        return;
      }

      const userId = tokenValidation.userId!;

      // Step 2: Check if template already exists
      const existingKey = await redisService.getApiKey(userId, template);
      if (existingKey) {
        logger.warn(`Template already exists for user ${userId}: ${template}`, {
          requestId: req.requestId,
        });
        res.status(StatusCodes.CONFLICT).json({
          success: false,
          error: 'Template already exists',
          message: `An API key with template '${template}' already exists for this user`,
        });
        return;
      }

      // Step 3: Semantic Conflict Detection
      const userApiKeys = await redisService.getUserApiKeys(userId);
      const existingDescriptions = userApiKeys.map(k => ({
        template: k.template,
        description: k.data.description || ''
      }));

      const conflictCheck = VectorService.checkDescriptionConflict(
        description,
        existingDescriptions,
        0.85 // Slightly lower threshold for better UX
      );

      if (conflictCheck.hasConflict) {
        logger.info(`Semantic conflict detected for user ${userId}`, {
          requestId: req.requestId,
          newTemplate: template,
          conflictingTemplate: conflictCheck.conflictingKey,
          similarity: conflictCheck.similarity,
        });
        res.status(StatusCodes.CONFLICT).json({
          success: false,
          error: 'Semantic conflict detected',
          message: `Description is too similar to existing API key '${conflictCheck.conflictingKey}'`,
          similarity: conflictCheck.similarity,
          conflictingTemplate: conflictCheck.conflictingKey,
        });
        return;
      }

      // Step 4: Encrypt the API Key
      if (!EncryptionService.validateKey(token)) {
        res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: 'Invalid encryption key',
          message: 'Token is not suitable for encryption',
        });
        return;
      }

      const encryptedApiKey = EncryptionService.encrypt(api_key, token);

      // Step 5: Prepare Key Metadata
      const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      
      const keyData = {
        description,
        encrypted_key: encryptedApiKey,
        max_requests_per_day,
        max_requests_per_week,
        max_tokens_per_day,
        max_payload_kb,
        expiry_date: expiry_date || null,
        allowed_origins,
        scopes,
        // Retry configuration
        retry_enabled,
        max_retries,
        retry_backoff_ms,
        // Usage tracking
        daily_usage: 0,
        weekly_usage: 0,
        daily_tokens_used: 0,
        last_reset: currentDate,
        created_at: new Date().toISOString(),
        last_modified: new Date().toISOString(),
      };

      // Step 6: Store in Redis with automatic session TTL
      await redisService.setApiKeyWithSessionTTL(userId, template, keyData);

      logger.info(`API key saved successfully for user ${userId}`, {
        requestId: req.requestId,
        template,
        userId,
        scopes,
        hasExpiry: !!expiry_date,
        allowedOrigins: allowed_origins.length,
      });

      // Step 7: Response
      res.status(StatusCodes.CREATED).json({
        success: true,
        message: 'API key saved and encrypted successfully',
        template,
        description,
        limits: {
          max_requests_per_day,
          max_requests_per_week,
          max_tokens_per_day,
          max_payload_kb,
        },
        scopes,
        created_at: keyData.created_at,
      });

    } catch (error) {
      logger.error('Add API key error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        requestId: req.requestId,
      });

      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        message: 'An error occurred while saving the API key',
      });
    }
  }
);

// Add API Key endpoint (PUT method - alternative for user convenience)
router.put('/add-key',
  validateRequest([
    body('token')
      .notEmpty()
      .withMessage('token is required')
      .isLength({ min: 8, max: 100 })
      .withMessage('token must be between 8 and 100 characters'),
    body('api_key')
      .notEmpty()
      .withMessage('api_key is required')
      .isLength({ min: 10, max: 500 })
      .withMessage('api_key must be between 10 and 500 characters'),
    body('description')
      .notEmpty()
      .withMessage('description is required')
      .isLength({ min: 5, max: 200 })
      .withMessage('description must be between 5 and 200 characters'),
    body('template')
      .notEmpty()
      .withMessage('template is required')
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('template can only contain letters, numbers, underscores, and hyphens')
      .isLength({ min: 1, max: 50 })
      .withMessage('template must be between 1 and 50 characters'),
    body('max_requests_per_day')
      .optional()
      .isInt({ min: 1, max: 100000 })
      .withMessage('max_requests_per_day must be between 1 and 100000'),
    body('max_requests_per_week')
      .optional()
      .isInt({ min: 1, max: 700000 })
      .withMessage('max_requests_per_week must be between 1 and 700000'),
    body('max_tokens_per_day')
      .optional()
      .isInt({ min: 1, max: 10000000 })
      .withMessage('max_tokens_per_day must be between 1 and 10000000'),
    body('max_payload_kb')
      .optional()
      .isInt({ min: 1, max: 100000 })
      .withMessage('max_payload_kb must be between 1 and 100000'),
    body('expiry_date')
      .optional()
      .isISO8601()
      .withMessage('expiry_date must be a valid ISO 8601 date'),
    body('allowed_origins')
      .optional()
      .isArray()
      .withMessage('allowed_origins must be an array'),
    body('allowed_origins.*')
      .optional()
      .isURL({ require_protocol: true })
      .withMessage('each allowed_origin must be a valid URL'),
    body('scopes')
      .optional()
      .isArray()
      .withMessage('scopes must be an array'),
    body('scopes.*')
      .optional()
      .isLength({ min: 1, max: 50 })
      .withMessage('each scope must be between 1 and 50 characters'),
  ]),
  async (req: Request, res: Response) => {
    // Log that PUT method was used
    logger.info(`PUT method used for add-key, redirecting to POST logic`, {
      requestId: req.requestId,
      template: req.body.template,
    });

    // Use the same logic as POST but add a note about the preferred method
    try {
      const {
        token,
        api_key,
        description,
        template,
        max_requests_per_day = 1000,
        max_requests_per_week = 5000,
        max_tokens_per_day = 100000,
        max_payload_kb = 1000,
        expiry_date,
        allowed_origins = [],
        scopes = []
      } = req.body;

      logger.info(`Add API key attempt for template: ${template}`, {
        requestId: req.requestId,
        template,
        description: description.substring(0, 50) + '...',
        method: req.method,
        note: 'PUT method used instead of POST',
      });

      // Step 1: Validate Token
      const tokenValidation = await TokenValidator.validateToken(token);
      if (!tokenValidation.isValid) {
        logger.warn(`Invalid token in add-key request`, {
          requestId: req.requestId,
          error: tokenValidation.error,
        });
        res.status(StatusCodes.UNAUTHORIZED).json({
          success: false,
          error: 'Invalid or expired token',
          message: tokenValidation.error || 'Token validation failed',
        });
        return;
      }

      const userId = tokenValidation.userId!;

      // Step 2: Check if template already exists
      const existingKey = await redisService.getApiKey(userId, template);
      if (existingKey) {
        logger.warn(`Template already exists for user ${userId}: ${template}`, {
          requestId: req.requestId,
        });
        res.status(StatusCodes.CONFLICT).json({
          success: false,
          error: 'Template already exists',
          message: `An API key with template '${template}' already exists for this user. Use PUT /auth/update-key to update existing keys.`,
          hint: 'For adding new keys, use POST /auth/add-key (preferred) or this PUT endpoint.',
        });
        return;
      }

      // Step 3: Semantic Conflict Detection
      const userApiKeys = await redisService.getUserApiKeys(userId);
      const existingDescriptions = userApiKeys.map(k => ({
        template: k.template,
        description: k.data.description || ''
      }));

      const conflictCheck = VectorService.checkDescriptionConflict(
        description,
        existingDescriptions,
        0.85
      );

      if (conflictCheck.hasConflict) {
        logger.info(`Semantic conflict detected for user ${userId}`, {
          requestId: req.requestId,
          newTemplate: template,
          conflictingTemplate: conflictCheck.conflictingKey,
          similarity: conflictCheck.similarity,
        });
        res.status(StatusCodes.CONFLICT).json({
          success: false,
          error: 'Semantic conflict detected',
          message: `Description is too similar to existing API key '${conflictCheck.conflictingKey}'`,
          similarity: conflictCheck.similarity,
          conflictingTemplate: conflictCheck.conflictingKey,
        });
        return;
      }

      // Step 4: Encrypt the API Key
      if (!EncryptionService.validateKey(token)) {
        res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: 'Invalid encryption key',
          message: 'Token is not suitable for encryption',
        });
        return;
      }

      const encryptedApiKey = EncryptionService.encrypt(api_key, token);

      // Step 5: Prepare Key Metadata
      const currentDate = new Date().toISOString().split('T')[0];
      
      const keyData = {
        description,
        encrypted_key: encryptedApiKey,
        max_requests_per_day,
        max_requests_per_week,
        max_tokens_per_day,
        max_payload_kb,
        expiry_date: expiry_date || null,
        allowed_origins,
        scopes,
        daily_usage: 0,
        weekly_usage: 0,
        daily_tokens_used: 0,
        last_reset: currentDate,
        created_at: new Date().toISOString(),
        last_modified: new Date().toISOString(),
      };

      // Step 6: Store in Redis with automatic session TTL
      await redisService.setApiKeyWithSessionTTL(userId, template, keyData);

      logger.info(`API key saved successfully for user ${userId}`, {
        requestId: req.requestId,
        template,
        userId,
        scopes,
        hasExpiry: !!expiry_date,
        allowedOrigins: allowed_origins.length,
        method: 'PUT',
      });

      // Step 7: Response
      res.status(StatusCodes.CREATED).json({
        success: true,
        message: 'API key saved and encrypted successfully',
        template,
        description,
        limits: {
          max_requests_per_day,
          max_requests_per_week,
          max_tokens_per_day,
          max_payload_kb,
        },
        scopes,
        created_at: keyData.created_at,
        note: 'PUT method accepted for add-key. For RESTful compliance, consider using POST /auth/add-key for creating new resources.',
      });

    } catch (error) {
      logger.error('Add API key error (PUT method):', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        requestId: req.requestId,
      });

      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        message: 'An error occurred while saving the API key',
      });
    }
  }
);

// PUT route to update existing API key
router.put('/update-key',
  validateRequest([
    body('token')
      .notEmpty()
      .withMessage('Token is required')
      .isLength({ min: 8, max: 100 })
      .withMessage('Token must be between 8 and 100 characters'),
    body('template')
      .notEmpty()
      .withMessage('Template is required')
      .isLength({ min: 1, max: 100 })
      .withMessage('Template must be between 1 and 100 characters'),
    body('description')
      .optional()
      .isLength({ min: 10, max: 500 })
      .withMessage('Description must be between 10 and 500 characters'),
    body('max_requests_per_day')
      .optional()
      .isInt({ min: 1, max: 10000 })
      .withMessage('max_requests_per_day must be between 1 and 10000'),
    body('max_requests_per_week')
      .optional()
      .isInt({ min: 1, max: 50000 })
      .withMessage('max_requests_per_week must be between 1 and 50000'),
    body('max_tokens_per_day')
      .optional()
      .isInt({ min: 100, max: 1000000 })
      .withMessage('max_tokens_per_day must be between 100 and 1000000'),
    body('max_payload_kb')
      .optional()
      .isInt({ min: 1, max: 10000 })
      .withMessage('max_payload_kb must be between 1 and 10000 KB'),
    body('expiry_date')
      .optional()
      .isISO8601()
      .withMessage('expiry_date must be a valid ISO 8601 date'),
    body('allowed_origins')
      .optional()
      .isArray()
      .withMessage('allowed_origins must be an array'),
    body('allowed_origins.*')
      .optional()
      .isURL({ require_protocol: true })
      .withMessage('each allowed origin must be a valid URL with protocol'),
    body('scopes')
      .optional()
      .isArray()
      .withMessage('scopes must be an array'),
    body('scopes.*')
      .optional()
      .isLength({ min: 1, max: 50 })
      .withMessage('each scope must be between 1 and 50 characters'),
  ]),
  async (req: Request, res: Response) => {
    try {
      const {
        token,
        template,
        description,
        max_requests_per_day,
        max_requests_per_week,
        max_tokens_per_day,
        max_payload_kb,
        expiry_date,
        allowed_origins,
        scopes
      } = req.body;

      logger.info(`Update API key attempt for template: ${template}`, {
        requestId: req.requestId,
        template,
      });

      // Step 1: Validate Token
      const tokenValidation = await TokenValidator.validateToken(token);
      if (!tokenValidation.isValid) {
        logger.warn(`Invalid token in update-key request`, {
          requestId: req.requestId,
          error: tokenValidation.error,
        });
        res.status(StatusCodes.UNAUTHORIZED).json({
          success: false,
          error: 'Invalid or expired token',
          message: tokenValidation.error || 'Token validation failed',
        });
        return;
      }

      const userId = tokenValidation.userId!;

      // Step 2: Check if template exists
      const existingKey = await redisService.getApiKey(userId, template);
      if (!existingKey) {
        logger.warn(`Template not found for user ${userId}: ${template}`, {
          requestId: req.requestId,
        });
        res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          error: 'API key not found',
          message: `No API key with template '${template}' found for this user`,
        });
        return;
      }

      // Step 3: Semantic Conflict Detection (only if description is being updated)
      if (description && description !== existingKey.description) {
        const userApiKeys = await redisService.getUserApiKeys(userId);
        const existingDescriptions = userApiKeys
          .filter(k => k.template !== template) // Exclude current template
          .map(k => ({
            template: k.template,
            description: k.data.description || ''
          }));

        const conflictCheck = VectorService.checkDescriptionConflict(
          description,
          existingDescriptions,
          0.85
        );

        if (conflictCheck.hasConflict) {
          logger.info(`Semantic conflict detected for user ${userId} during update`, {
            requestId: req.requestId,
            template,
            conflictingTemplate: conflictCheck.conflictingKey,
            similarity: conflictCheck.similarity,
          });
          res.status(StatusCodes.CONFLICT).json({
            success: false,
            error: 'Semantic conflict detected',
            message: `Description is too similar to existing API key '${conflictCheck.conflictingKey}'`,
            similarity: conflictCheck.similarity,
            conflictingTemplate: conflictCheck.conflictingKey,
          });
          return;
        }
      }

      // Step 4: Prepare updated key data
      const updatedKeyData = {
        ...existingKey,
        // Only update fields that are provided
        ...(description !== undefined && { description }),
        ...(max_requests_per_day !== undefined && { max_requests_per_day }),
        ...(max_requests_per_week !== undefined && { max_requests_per_week }),
        ...(max_tokens_per_day !== undefined && { max_tokens_per_day }),
        ...(max_payload_kb !== undefined && { max_payload_kb }),
        ...(expiry_date !== undefined && { expiry_date }),
        ...(allowed_origins !== undefined && { allowed_origins }),
        ...(scopes !== undefined && { scopes }),
        last_modified: new Date().toISOString(),
      };

      // Step 5: Update in Redis with session TTL
      await redisService.setApiKeyWithSessionTTL(userId, template, updatedKeyData);

      logger.info(`API key updated successfully for user ${userId}`, {
        requestId: req.requestId,
        template,
        userId,
        updatedFields: Object.keys(req.body).filter(key => key !== 'token' && key !== 'template'),
      });

      // Step 6: Response
      res.status(StatusCodes.OK).json({
        success: true,
        message: 'API key updated successfully',
        template,
        updated_fields: Object.keys(req.body).filter(key => key !== 'token' && key !== 'template'),
        limits: {
          max_requests_per_day: updatedKeyData.max_requests_per_day,
          max_requests_per_week: updatedKeyData.max_requests_per_week,
          max_tokens_per_day: updatedKeyData.max_tokens_per_day,
          max_payload_kb: updatedKeyData.max_payload_kb,
        },
        scopes: updatedKeyData.scopes,
        last_modified: updatedKeyData.last_modified,
      });

    } catch (error) {
      logger.error('Update API key error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        requestId: req.requestId,
      });

      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        message: 'An error occurred while updating the API key',
      });
    }
  }
);

// DELETE route to remove API key
router.delete('/delete-key',
  validateRequest([
    body('token')
      .notEmpty()
      .withMessage('Token is required')
      .isLength({ min: 8, max: 100 })
      .withMessage('Token must be between 8 and 100 characters'),
    body('template')
      .notEmpty()
      .withMessage('Template is required')
      .isLength({ min: 1, max: 100 })
      .withMessage('Template must be between 1 and 100 characters'),
    body('confirm')
      .optional()
      .isBoolean()
      .withMessage('confirm must be a boolean'),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { token, template, confirm = false } = req.body;

      logger.info(`Delete API key attempt for template: ${template}`, {
        requestId: req.requestId,
        template,
        confirmed: confirm,
      });

      // Step 1: Validate Token
      const tokenValidation = await TokenValidator.validateToken(token);
      if (!tokenValidation.isValid) {
        logger.warn(`Invalid token in delete-key request`, {
          requestId: req.requestId,
          error: tokenValidation.error,
        });
        res.status(StatusCodes.UNAUTHORIZED).json({
          success: false,
          error: 'Invalid or expired token',
          message: tokenValidation.error || 'Token validation failed',
        });
        return;
      }

      const userId = tokenValidation.userId!;

      // Step 2: Check if template exists
      const existingKey = await redisService.getApiKey(userId, template);
      if (!existingKey) {
        logger.warn(`Template not found for user ${userId}: ${template}`, {
          requestId: req.requestId,
        });
        res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          error: 'API key not found',
          message: `No API key with template '${template}' found for this user`,
        });
        return;
      }

      // Step 3: Require confirmation for safety
      if (!confirm) {
        res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: 'Confirmation required',
          message: 'Please set confirm: true to delete this API key',
          key_info: {
            template,
            description: existingKey.description,
            created_at: existingKey.created_at,
            usage: {
              daily_usage: existingKey.daily_usage || 0,
              weekly_usage: existingKey.weekly_usage || 0,
              daily_tokens_used: existingKey.daily_tokens_used || 0,
            }
          }
        });
        return;
      }

      // Step 4: Delete from Redis
      const deleteResult = await redisService.deleteApiKey(userId, template);
      
      if (!deleteResult) {
        logger.error(`Failed to delete API key for user ${userId}: ${template}`, {
          requestId: req.requestId,
        });
        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: 'Delete operation failed',
          message: 'Failed to delete the API key from storage',
        });
        return;
      }

      logger.info(`API key deleted successfully for user ${userId}`, {
        requestId: req.requestId,
        template,
        userId,
        deletedAt: new Date().toISOString(),
      });

      // Step 5: Response
      res.status(StatusCodes.OK).json({
        success: true,
        message: 'API key deleted successfully',
        template,
        deleted_at: new Date().toISOString(),
        final_usage: {
          daily_usage: existingKey.daily_usage || 0,
          weekly_usage: existingKey.weekly_usage || 0,
          daily_tokens_used: existingKey.daily_tokens_used || 0,
        }
      });

    } catch (error) {
      logger.error('Delete API key error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        requestId: req.requestId,
      });

      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        message: 'An error occurred while deleting the API key',
      });
    }
  }
);

// Demo API Key route - provides random API keys for testing
router.get('/demo-api-key',
  async (req: Request, res: Response) => {
    try {
      // Get userId and token from query parameters or headers
      const userId = req.query.userId as string || req.headers['x-user-id'] as string;
      const token = req.query.token as string || req.headers['x-user-token'] as string;
      
      console.log(`Demo API key request for user: ${userId}`);
      logger.info(`Demo API key request for user: ${userId}`, {
        requestId: req.requestId,
        userId,
      });

      // Validate required parameters
      if (!userId || !token) {
        res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: 'Missing parameters',
          message: 'userId and token are required (via query params or headers)',
        });
        return;
      }


      // Step 1: Check if user is a demo user (with auto-expansion logic)
      const demoUserIds = Object.keys(config.demoUsers);
      // Check if all demo users are active
      const activeStatuses = await Promise.all(
        demoUserIds.map(async (id) => {
          const session = await redisService.getUserSession(id);
          return session && session.status === 'active';
        })
      );
      const allActive = activeStatuses.length > 0 && activeStatuses.every(Boolean);
      if (allActive) {
        // Generate 3 new demo users
        const newUsers: Record<string, string> = {};
        for (let i = 0; i < 3; i++) {
          const newId = `demo${Date.now()}${Math.floor(Math.random()*10000)}`;
          const newPass = Math.random().toString(36).slice(-8);
          newUsers[newId] = newPass;
          // Set a session for the new user (inactive by default)
          await redisService.setUserSession(newId, { status: 'inactive', token: '', activated_at: Date.now() }, 24*60*60); // 1 day TTL
        }
        // Add new users to config.demoUsers (in-memory)
        Object.assign(config.demoUsers, newUsers);
        logger.info('Auto-created 3 new demo users:', { newUsers });
      }

      if (!config.demoUsers[userId]) {
        logger.warn(`Non-demo user attempted to get demo API key: ${userId}`, {
          requestId: req.requestId,
        });
        res.status(StatusCodes.FORBIDDEN).json({
          success: false,
          error: 'Access denied',
          message: 'Demo API keys are only available for demo users',
        });
        return;
      }

      // Step 2: Verify user session is active
      const userSession = await redisService.getUserSession(userId);
      if (!userSession || userSession.status !== 'active') {
        logger.warn(`Inactive user attempted to get demo API key: ${userId}`, {
          requestId: req.requestId,
        });
        res.status(StatusCodes.UNAUTHORIZED).json({
          success: false,
          error: 'Session required',
          message: 'Please login first to get demo API keys',
        });
        return;
      }

      // Step 3: Verify the provided token matches the session token
      if (userSession.token !== token) {
        logger.warn(`Invalid token provided for demo API key: ${userId}`, {
          requestId: req.requestId,
        });
        res.status(StatusCodes.UNAUTHORIZED).json({
          success: false,
          error: 'Invalid token',
          message: 'The provided token does not match your active session',
        });
        return;
      }

      // Step 4: Sample API keys for different providers
      const sampleApiKeys = [
        'sk-demo1234567890abcdef1234567890abcdef1234567890abcdef',
        'sk-ant-demo9876543210fedcba9876543210fedcba9876543210fedcba',
        'AIzaSyDemo_1234567890abcdefghijklmnopqrstuvwxyz',
        'sk-img-demo1234567890abcdef1234567890abcdef1234567890',
        'sk-stab-demo9876543210fedcba9876543210fedcba9876543210',
        'hf_demo1234567890abcdefghijklmnopqrstuvwxyz1234567890'
      ];

      // Step 5: Select a random API key
      const randomIndex = Math.floor(Math.random() * sampleApiKeys.length);
      const selectedApiKey = sampleApiKeys[randomIndex];

      // Ensure we have a valid API key
      if (!selectedApiKey) {
        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
          success: false,
          error: 'No API keys available',
          message: 'Unable to generate demo API key at this time',
        });
        return;
      }

      logger.info(`Demo API key provided to user: ${userId}`, {
        requestId: req.requestId,
        keyId: selectedApiKey.substring(0, 10) + '***',
      });

      // Step 6: Response
      res.status(StatusCodes.OK).json({
        success: true,
        apiKey: selectedApiKey
      });

    } catch (error) {
      logger.error('Demo API key generation error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        requestId: req.requestId,
      });

      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        message: 'An error occurred while generating demo API key',
      });
    }
  }
);

// Development route to get complete user profile and details
router.get('/user-profile/:userId', async (req: Request, res: Response) => {
  // Only available in development mode
  if (config.env !== 'development') {
    res.status(StatusCodes.FORBIDDEN).json({
      success: false,
      error: 'Endpoint only available in development mode',
    });
    return;
  }

  try {
    const { userId } = req.params;

    if (!userId || userId.trim() === '') {
      res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'UserId is required',
        message: 'Please provide a valid userId in the URL parameter',
      });
      return;
    }

    logger.info(`Fetching user profile for development: ${userId}`, {
      requestId: req.requestId,
    });

    // Check Redis connection
    if (!redisService.getConnectionStatus()) {
      res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
        success: false,
        error: 'Redis not connected',
        message: 'Redis service is not available',
      });
      return;
    }

    // Get user session details
    const sessionDetails = await redisService.getUserSession(userId);
    
    // Get all API keys for the user
    const userApiKeys = await redisService.getUserApiKeys(userId);

    // Get all Redis keys related to this user
    const allKeys = await redisService.getAllKeys();
    const userRelatedKeys = allKeys.filter(key => key.includes(userId));

    // Prepare detailed response
    const userProfile = {
      userId,
      profile_generated_at: new Date().toISOString(),
      session_info: sessionDetails ? {
        status: sessionDetails.status,
        token: sessionDetails.token,
        activated_at: sessionDetails.activated_at,
        activation_time: new Date(sessionDetails.activated_at).toISOString(),
        session_duration_minutes: Math.floor((Date.now() - sessionDetails.activated_at) / (1000 * 60)),
        is_active: sessionDetails.status === 'active',
      } : {
        status: 'no_active_session',
        message: 'No active session found for this user',
      },
      api_keys: {
        total_keys: userApiKeys.length,
        keys: userApiKeys.map(keyInfo => ({
          template: keyInfo.template,
          description: keyInfo.data.description,
          scopes: keyInfo.data.scopes || [],
          limits: {
            max_requests_per_day: keyInfo.data.max_requests_per_day,
            max_requests_per_week: keyInfo.data.max_requests_per_week,
            max_tokens_per_day: keyInfo.data.max_tokens_per_day,
            max_payload_kb: keyInfo.data.max_payload_kb,
          },
          usage_stats: {
            daily_usage: keyInfo.data.daily_usage || 0,
            weekly_usage: keyInfo.data.weekly_usage || 0,
            daily_tokens_used: keyInfo.data.daily_tokens_used || 0,
            last_reset: keyInfo.data.last_reset,
          },
          security: {
            has_encrypted_key: !!keyInfo.data.encrypted_key,
            key_length: keyInfo.data.encrypted_key ? keyInfo.data.encrypted_key.length : 0,
            has_expiry: !!keyInfo.data.expiry_date,
            expiry_date: keyInfo.data.expiry_date,
            allowed_origins_count: (keyInfo.data.allowed_origins || []).length,
            allowed_origins: keyInfo.data.allowed_origins || [],
          },
          timestamps: {
            created_at: keyInfo.data.created_at,
            last_modified: keyInfo.data.last_modified,
            age_days: keyInfo.data.created_at ? 
              Math.floor((Date.now() - new Date(keyInfo.data.created_at).getTime()) / (1000 * 60 * 60 * 24)) : 0,
          },
        }))
      },
      redis_storage: {
        total_user_keys: userRelatedKeys.length,
        key_patterns: userRelatedKeys,
        storage_summary: {
          session_keys: userRelatedKeys.filter(key => key.includes('session')).length,
          api_keys: userRelatedKeys.filter(key => key.includes('keys')).length,
          other_keys: userRelatedKeys.filter(key => !key.includes('session') && !key.includes('keys')).length,
        }
      },
      user_activity: {
        has_demo_access: config.demoUsers && userId in config.demoUsers,
        is_demo_user: config.demoUsers && userId in config.demoUsers,
        demo_password_hint: config.demoUsers && userId in config.demoUsers ? 
          `${config.demoUsers[userId]?.substring(0, 2)}***` : null,
      },
      summary: {
        total_api_keys: userApiKeys.length,
        active_session: sessionDetails ? true : false,
        total_daily_usage: userApiKeys.reduce((sum, key) => sum + (key.data.daily_usage || 0), 0),
        total_weekly_usage: userApiKeys.reduce((sum, key) => sum + (key.data.weekly_usage || 0), 0),
        total_tokens_used_today: userApiKeys.reduce((sum, key) => sum + (key.data.daily_tokens_used || 0), 0),
        most_used_scopes: (() => {
          const scopeCount: Record<string, number> = {};
          userApiKeys.forEach(key => {
            (key.data.scopes || []).forEach((scope: string) => {
              scopeCount[scope] = (scopeCount[scope] || 0) + 1;
            });
          });
          return Object.entries(scopeCount)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([scope, count]) => ({ scope, count }));
        })(),
        avg_usage_per_key: userApiKeys.length > 0 ? 
          Math.round(userApiKeys.reduce((sum, key) => sum + (key.data.daily_usage || 0), 0) / userApiKeys.length) : 0,
      }
    };

    // Additional metadata for development insights
    const developmentInsights = {
      redis_health: {
        connection_status: redisService.getConnectionStatus(),
        total_database_keys: allKeys.length,
        user_data_percentage: allKeys.length > 0 ? 
          Math.round((userRelatedKeys.length / allKeys.length) * 100) : 0,
      },
      api_insights: userApiKeys.length > 0 ? {
        newest_key: userApiKeys.reduce((newest, key) => 
          new Date(key.data.created_at || 0) > new Date(newest.data.created_at || 0) ? key : newest
        ).template,
        oldest_key: userApiKeys.reduce((oldest, key) => 
          new Date(key.data.created_at || 0) < new Date(oldest.data.created_at || 0) ? key : oldest
        ).template,
        most_used_key: userApiKeys.reduce((mostUsed, key) => 
          (key.data.daily_usage || 0) > (mostUsed.data.daily_usage || 0) ? key : mostUsed
        ).template,
        unused_keys: userApiKeys.filter(key => (key.data.daily_usage || 0) === 0).length,
      } : null,
    };

    res.status(StatusCodes.OK).json({
      success: true,
      development_mode: true,
      user_profile: userProfile,
      development_insights: developmentInsights,
      request_timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('User profile fetch error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      requestId: req.requestId,
      userId: req.params.userId,
    });

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Internal server error',
      message: 'An error occurred while fetching user profile',
    });
  }
});

export default router;
