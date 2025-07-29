import crypto from 'crypto';
import { config } from '../config/config';

export class TokenGenerator {
  /**
   * Generate a cryptographically secure random token
   * @param length - Length of the token (default from config)
   * @returns Hexadecimal token string
   */
  static generateSecureToken(length: number = config.session.tokenLength): string {
    // Generate random bytes and convert to hex
    const randomBytes = crypto.randomBytes(Math.ceil(length / 2));
    return randomBytes.toString('hex').slice(0, length);
  }

  /**
   * Generate a random alphanumeric token
   * @param length - Length of the token
   * @returns Alphanumeric token string
   */
  static generateAlphanumericToken(length: number = config.session.tokenLength): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
  }

  /**
   * Validate token format (hexadecimal)
   * @param token - Token to validate
   * @returns Boolean indicating if token is valid format
   */
  static isValidTokenFormat(token: string): boolean {
    if (!token || typeof token !== 'string') {
      return false;
    }
    
    // Check if token is hexadecimal and has correct length
    const hexPattern = /^[a-f0-9]+$/i;
    return hexPattern.test(token) && token.length === config.session.tokenLength;
  }
}

export { TokenGenerator as default };
