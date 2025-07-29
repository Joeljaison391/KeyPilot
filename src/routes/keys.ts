import { Router, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { redisService } from '../utils/redisService';
import { EncryptionService } from '../utils/encryption';
import { TokenValidator } from '../utils/tokenValidator';
import { logger } from '../utils/logger';

const router = Router();

// Get user's API keys
router.get('/my-keys', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Token is required in Authorization header',
      });
      return;
    }

    // Validate token
    const tokenValidation = await TokenValidator.validateToken(token);
    if (!tokenValidation.isValid) {
      res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        error: 'Invalid or expired token',
      });
      return;
    }

    const userId = tokenValidation.userId!;
    const userApiKeys = await redisService.getUserApiKeys(userId);

    // Format the response (without exposing encrypted keys)
    const formattedKeys = userApiKeys.map(k => ({
      template: k.template,
      description: k.data.description,
      scopes: k.data.scopes,
      limits: {
        max_requests_per_day: k.data.max_requests_per_day,
        max_requests_per_week: k.data.max_requests_per_week,
        max_tokens_per_day: k.data.max_tokens_per_day,
        max_payload_kb: k.data.max_payload_kb,
      },
      usage: {
        daily_usage: k.data.daily_usage,
        weekly_usage: k.data.weekly_usage,
        daily_tokens_used: k.data.daily_tokens_used,
        last_reset: k.data.last_reset,
      },
      expiry_date: k.data.expiry_date,
      allowed_origins: k.data.allowed_origins,
      created_at: k.data.created_at,
      last_modified: k.data.last_modified,
    }));

    res.status(StatusCodes.OK).json({
      success: true,
      userId,
      totalKeys: formattedKeys.length,
      apiKeys: formattedKeys,
    });

  } catch (error) {
    logger.error('Get API keys error:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// Test decryption (development only)
router.get('/decrypt-test/:template', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV !== 'development') {
    res.status(StatusCodes.FORBIDDEN).json({
      success: false,
      error: 'Endpoint only available in development mode',
    });
    return;
  }

  try {
    const { template } = req.params;
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || !template) {
      res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        error: 'Token and template are required',
      });
      return;
    }

    // Validate token
    const tokenValidation = await TokenValidator.validateToken(token);
    if (!tokenValidation.isValid) {
      res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        error: 'Invalid or expired token',
      });
      return;
    }

    const userId = tokenValidation.userId!;
    const apiKeyData = await redisService.getApiKey(userId, template);

    if (!apiKeyData) {
      res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: 'API key not found',
      });
      return;
    }

    // Decrypt the API key
    const decryptedKey = EncryptionService.decrypt(apiKeyData.encrypted_key, token);

    res.status(StatusCodes.OK).json({
      success: true,
      template,
      decryptedKey: decryptedKey.substring(0, 10) + '...', // Only show first 10 chars
      encryptedData: apiKeyData.encrypted_key,
    });

  } catch (error) {
    logger.error('Decrypt test error:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Failed to decrypt API key',
    });
  }
});

export default router;
