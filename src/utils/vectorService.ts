import { logger } from './logger';

export class VectorService {
  /**
   * Generate a simple embedding vector from text using character frequency
   * Note: For production, you'd want to use a proper embedding service like OpenAI Embeddings
   * @param text - The text to vectorize
   * @returns A normalized vector representation
   */
  static generateEmbedding(text: string): number[] {
    const cleanText = text.toLowerCase().replace(/[^\w\s]/g, '');
    const words = cleanText.split(/\s+/).filter(word => word.length > 0);
    
    // Create a simple bag-of-words vector with common keywords
    const keywords = [
      'image', 'generate', 'text', 'api', 'openai', 'dalle', 'gpt', 'chat',
      'completion', 'model', 'ai', 'machine', 'learning', 'language',
      'vision', 'speech', 'audio', 'file', 'upload', 'download', 'create',
      'edit', 'delete', 'search', 'query', 'data', 'database', 'storage',
      'email', 'message', 'notification', 'payment', 'stripe', 'webhook'
    ];
    
    const vector = new Array(keywords.length).fill(0);
    
    // Count keyword occurrences
    for (const word of words) {
      const index = keywords.indexOf(word);
      if (index !== -1) {
        vector[index]++;
      }
    }
    
    // Add character-based features for better differentiation
    const charVector = new Array(26).fill(0);
    for (const char of cleanText.replace(/\s/g, '')) {
      const charCode = char.charCodeAt(0) - 97; // 'a' = 0
      if (charCode >= 0 && charCode < 26) {
        charVector[charCode]++;
      }
    }
    
    // Combine keyword and character vectors
    const combined = [...vector, ...charVector];
    
    // Normalize the vector
    const magnitude = Math.sqrt(combined.reduce((sum, val) => sum + val * val, 0));
    
    if (magnitude === 0) {
      return combined; // Return zero vector if no features found
    }
    
    return combined.map(val => val / magnitude);
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param vec1 - First vector
   * @param vec2 - Second vector
   * @returns Similarity score between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
   */
  static cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      logger.warn('Vector length mismatch in similarity calculation');
      return 0;
    }

    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      const val1 = vec1[i] ?? 0;
      const val2 = vec2[i] ?? 0;
      
      dotProduct += val1 * val2;
      magnitude1 += val1 * val1;
      magnitude2 += val2 * val2;
    }

    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);

    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0;
    }

    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Find similar descriptions among existing API keys
   * @param newDescription - The new description to check
   * @param existingKeys - Array of existing API key data
   * @param threshold - Similarity threshold (default 0.9)
   * @returns Array of similar keys with their similarity scores
   */
  static findSimilarDescriptions(
    newDescription: string,
    existingKeys: Array<{ template: string; description: string }>,
    threshold = 0.9
  ): Array<{ template: string; description: string; similarity: number }> {
    const newVector = this.generateEmbedding(newDescription);
    const similarities: Array<{ template: string; description: string; similarity: number }> = [];

    for (const key of existingKeys) {
      const existingVector = this.generateEmbedding(key.description);
      const similarity = this.cosineSimilarity(newVector, existingVector);

      if (similarity >= threshold) {
        similarities.push({
          template: key.template,
          description: key.description,
          similarity
        });
      }
    }

    // Sort by similarity (highest first)
    return similarities.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Check if a description conflicts with existing ones
   * @param newDescription - The new description
   * @param existingKeys - Existing API keys
   * @param threshold - Conflict threshold (default 0.9)
   * @returns Conflict information or null if no conflict
   */
  static checkDescriptionConflict(
    newDescription: string,
    existingKeys: Array<{ template: string; description: string }>,
    threshold = 0.9
  ): { hasConflict: boolean; conflictingKey?: string; similarity?: number } {
    const similar = this.findSimilarDescriptions(newDescription, existingKeys, threshold);
    
    if (similar.length > 0 && similar[0]) {
      return {
        hasConflict: true,
        conflictingKey: similar[0].template,
        similarity: similar[0].similarity
      };
    }

    return { hasConflict: false };
  }
}
