import { redisService } from './redisService';
import { logger } from './logger';

export interface TokenValidationResult {
  isValid: boolean;
  userId?: string;
  error?: string;
  remainingTtl?: number;
}

export class TokenValidator {
  /**
   * Validate a user token and return user information
   * @param token - The token to validate
   * @returns Token validation result
   */
  static async validateToken(token: string): Promise<TokenValidationResult> {
    try {
      if (!token || token.length === 0) {
        return {
          isValid: false,
          error: 'Token is required'
        };
      }

      // Get all user sessions to find the one with this token
      const allKeys = await redisService.getAllKeys();
      const userKeys = allKeys.filter(key => key.startsWith('user:') && !key.includes(':keys:'));

      for (const userKey of userKeys) {
        try {
          const sessionData = await redisService.get(userKey);
          if (sessionData) {
            const session = JSON.parse(sessionData);
            
            // Check if this session has the matching token
            if (session.token === token && session.status === 'active') {
              const userId = userKey.replace('user:', '');
              const ttl = await redisService.ttl(userKey);
              
              // Check if session is still valid
              if (ttl > 0) {
                return {
                  isValid: true,
                  userId,
                  remainingTtl: ttl
                };
              } else {
                return {
                  isValid: false,
                  error: 'Token has expired'
                };
              }
            }
          }
        } catch (parseError) {
          logger.warn(`Failed to parse session data for key ${userKey}:`, parseError);
          continue;
        }
      }

      return {
        isValid: false,
        error: 'Invalid or expired token'
      };

    } catch (error) {
      logger.error('Token validation error:', error);
      return {
        isValid: false,
        error: 'Internal server error during token validation'
      };
    }
  }

  /**
   * Extract user ID from token (for optimization, if you implement token-based user lookup)
   * Currently we search through all sessions, but this could be optimized
   * @param token - The token
   * @returns User ID if found
   */
  static async getUserIdFromToken(token: string): Promise<string | null> {
    const result = await this.validateToken(token);
    return result.isValid ? result.userId || null : null;
  }
}
