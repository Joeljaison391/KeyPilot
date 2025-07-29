import crypto from 'crypto';
import { logger } from './logger';

export class EncryptionService {
  private static readonly ALGORITHM = 'aes-256-ctr';
  private static readonly IV_LENGTH = 16; // For AES-256-CTR

  /**
   * Encrypt a string using AES-256-CTR with the provided key
   * @param text - The plaintext to encrypt
   * @param key - The encryption key (should be 32 bytes for AES-256)
   * @returns Object containing the encrypted data and IV
   */
  static encrypt(text: string, key: string): { encrypted: string; iv: string } {
    try {
      // Create a 32-byte key from the provided key string
      const keyBuffer = crypto.createHash('sha256').update(key).digest();
      
      // Generate a random IV
      const iv = crypto.randomBytes(this.IV_LENGTH);
      
      // Create cipher
      const cipher = crypto.createCipheriv(this.ALGORITHM, keyBuffer, iv);
      
      // Encrypt the text
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return {
        encrypted,
        iv: iv.toString('hex')
      };
    } catch (error) {
      logger.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt a string using AES-256-CTR
   * @param encryptedData - Object containing encrypted text and IV
   * @param key - The decryption key
   * @returns The decrypted plaintext
   */
  static decrypt(encryptedData: { encrypted: string; iv: string }, key: string): string {
    try {
      // Create a 32-byte key from the provided key string
      const keyBuffer = crypto.createHash('sha256').update(key).digest();
      
      // Convert IV from hex
      const iv = Buffer.from(encryptedData.iv, 'hex');
      
      // Create decipher
      const decipher = crypto.createDecipheriv(this.ALGORITHM, keyBuffer, iv);
      
      // Decrypt the text
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error('Decryption error:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Generate a secure hash of a string for comparison purposes
   * @param text - The text to hash
   * @returns SHA-256 hash in hex format
   */
  static hash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Validate that a key is strong enough for encryption
   * @param key - The key to validate
   * @returns true if key is valid
   */
  static validateKey(key: string): boolean {
    return !!(key && key.length >= 8); // Minimum 8 characters
  }
}
