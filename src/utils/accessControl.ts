import { redisService } from './redisService';
import { logger } from './logger';

interface AccessValidation {
  allowed: boolean;
  error?: string;
  warningMessage?: string;
}

interface UsageInfo {
  daily_usage: number;
  weekly_usage: number;
  daily_tokens_used: number;
  max_requests_per_day: number;
  max_requests_per_week: number;
  max_tokens_per_day: number;
  max_payload_kb: number;
}

export class AccessControlService {
  
  /**
   * Validate all access controls for a request
   */
  static async validateAccess(
    userId: string,
    template: string,
    payload: any,
    origin?: string
  ): Promise<AccessValidation> {
    try {
      // Get API key data
      const apiKeyData = await redisService.getApiKey(userId, template);
      
      if (!apiKeyData) {
        return {
          allowed: false,
          error: 'API key not found'
        };
      }

      // 1. Check expiry date
      const expiryValidation = this.validateExpiryDate(apiKeyData.expiry_date);
      if (!expiryValidation.allowed) {
        return expiryValidation;
      }

      // 2. Check payload size
      const payloadValidation = this.validatePayloadSize(payload, apiKeyData.max_payload_kb);
      if (!payloadValidation.allowed) {
        return payloadValidation;
      }

      // 3. Check allowed origins
      const originValidation = this.validateOrigin(origin, apiKeyData.allowed_origins);
      if (!originValidation.allowed) {
        return originValidation;
      }

      // 4. Check usage limits
      const usageValidation = this.validateUsageLimits({
        daily_usage: apiKeyData.daily_usage,
        weekly_usage: apiKeyData.weekly_usage,
        daily_tokens_used: apiKeyData.daily_tokens_used,
        max_requests_per_day: apiKeyData.max_requests_per_day,
        max_requests_per_week: apiKeyData.max_requests_per_week,
        max_tokens_per_day: apiKeyData.max_tokens_per_day,
        max_payload_kb: apiKeyData.max_payload_kb
      });
      
      if (!usageValidation.allowed) {
        return usageValidation;
      }

      return {
        allowed: true,
        ...(usageValidation.warningMessage && { warningMessage: usageValidation.warningMessage })
      };

    } catch (error) {
      logger.error('Access control validation error:', error);
      return {
        allowed: false,
        error: 'Internal server error during access validation'
      };
    }
  }

  /**
   * Validate expiry date
   */
  private static validateExpiryDate(expiryDate?: string | null): AccessValidation {
    if (!expiryDate) {
      return { allowed: true }; // No expiry date set
    }

    const expiry = new Date(expiryDate);
    const now = new Date();

    if (expiry < now) {
      return {
        allowed: false,
        error: 'API key has expired'
      };
    }

    // Warn if expiring within 7 days
    const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry <= 7) {
      return {
        allowed: true,
        warningMessage: `⚠️ API key expires in ${daysUntilExpiry} days`
      };
    }

    return { allowed: true };
  }

  /**
   * Validate payload size
   */
  private static validatePayloadSize(payload: any, maxPayloadKb: number): AccessValidation {
    try {
      const payloadSizeBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      const payloadSizeKb = payloadSizeBytes / 1024;

      if (payloadSizeKb > maxPayloadKb) {
        return {
          allowed: false,
          error: `Payload size (${payloadSizeKb.toFixed(2)}KB) exceeds limit (${maxPayloadKb}KB)`
        };
      }

      // Warn if payload is > 80% of limit
      const usagePercentage = (payloadSizeKb / maxPayloadKb) * 100;
      if (usagePercentage > 80) {
        return {
          allowed: true,
          warningMessage: `⚠️ Large payload: ${usagePercentage.toFixed(1)}% of size limit`
        };
      }

      return { allowed: true };

    } catch (error) {
      logger.error('Payload size validation error:', error);
      return {
        allowed: false,
        error: 'Failed to validate payload size'
      };
    }
  }

  /**
   * Validate request origin
   */
  private static validateOrigin(origin?: string, allowedOrigins?: string[]): AccessValidation {
    // If no allowed origins are specified, allow all origins
    if (!allowedOrigins || allowedOrigins.length === 0) {
      return { allowed: true };
    }

    // If no origin provided but origins are restricted
    if (!origin) {
      return {
        allowed: false,
        error: 'Request origin is required but not provided'
      };
    }

    // Check if origin matches any allowed pattern
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      // Exact match
      if (allowedOrigin === origin) {
        return true;
      }
      
      // Wildcard subdomain match (e.g., *.example.com)
      if (allowedOrigin.startsWith('*.')) {
        const domain = allowedOrigin.substring(2);
        return origin.endsWith(domain);
      }
      
      return false;
    });

    if (!isAllowed) {
      return {
        allowed: false,
        error: `Origin '${origin}' is not in allowed origins list`
      };
    }

    return { allowed: true };
  }

  /**
   * Validate usage limits
   */
  private static validateUsageLimits(usage: UsageInfo): AccessValidation {
    const warnings: string[] = [];

    // Check daily request limit
    if (usage.daily_usage >= usage.max_requests_per_day) {
      return {
        allowed: false,
        error: 'Daily request limit exceeded'
      };
    }

    // Check weekly request limit
    if (usage.weekly_usage >= usage.max_requests_per_week) {
      return {
        allowed: false,
        error: 'Weekly request limit exceeded'
      };
    }

    // Check daily token limit
    if (usage.daily_tokens_used >= usage.max_tokens_per_day) {
      return {
        allowed: false,
        error: 'Daily token limit exceeded'
      };
    }

    // Generate warnings for high usage
    const dailyRequestPercent = (usage.daily_usage / usage.max_requests_per_day) * 100;
    const weeklyRequestPercent = (usage.weekly_usage / usage.max_requests_per_week) * 100;
    const dailyTokenPercent = (usage.daily_tokens_used / usage.max_tokens_per_day) * 100;

    if (dailyRequestPercent >= 90) {
      warnings.push(`⚠️ Near daily request limit: ${dailyRequestPercent.toFixed(1)}% used`);
    } else if (dailyRequestPercent >= 75) {
      warnings.push(`⚠️ High daily usage: ${dailyRequestPercent.toFixed(1)}% used`);
    }

    if (weeklyRequestPercent >= 90) {
      warnings.push(`⚠️ Near weekly request limit: ${weeklyRequestPercent.toFixed(1)}% used`);
    } else if (weeklyRequestPercent >= 75) {
      warnings.push(`⚠️ High weekly usage: ${weeklyRequestPercent.toFixed(1)}% used`);
    }

    if (dailyTokenPercent >= 90) {
      warnings.push(`⚠️ Near daily token limit: ${dailyTokenPercent.toFixed(1)}% used`);
    } else if (dailyTokenPercent >= 75) {
      warnings.push(`⚠️ High token usage: ${dailyTokenPercent.toFixed(1)}% used`);
    }

    return {
      allowed: true,
      ...(warnings.length > 0 && { warningMessage: warnings.join(', ') })
    };
  }

  /**
   * Update usage after a successful request
   */
  static async updateUsage(userId: string, template: string, tokensUsed: number): Promise<void> {
    try {
      // Simple usage update - increment requests and add tokens
      await redisService.updateApiKeyUsage(userId, template, {
        daily_usage: 1,  // increment by 1 request
        weekly_usage: 1, // increment by 1 request
        daily_tokens_used: tokensUsed
      });
      
      logger.debug(`Updated usage for ${userId}:${template}`, {
        tokensUsed
      });

    } catch (error) {
      logger.error('Failed to update usage:', error);
    }
  }
}
