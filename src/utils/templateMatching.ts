import { redisService } from './redisService';
import { VectorService } from './vectorService';
import { logger } from './logger';

interface TemplateMatch {
  template: string;
  confidence: number;
  description: string;
}

interface TemplateMatchResult {
  found: boolean;
  match?: TemplateMatch;
  hasConflict: boolean;
  conflictingTemplates?: TemplateMatch[];
}

export class TemplateMatchingService {
  private static readonly TEMPLATE_PREFIX = 'template_embeddings';
  private static readonly MATCH_THRESHOLD = 0.75;
  private static readonly CONFLICT_THRESHOLD = 0.9;

  /**
   * Find the best matching template for a given intent
   */
  static async findMatchingTemplate(userId: string, intent: string): Promise<TemplateMatchResult> {
    try {
      // Get user's API keys (templates)
      const userApiKeys = await redisService.getUserApiKeys(userId);
      
      if (userApiKeys.length === 0) {
        logger.info(`No API keys found for user ${userId} - may have expired with session`);
        return {
          found: false,
          hasConflict: false
        };
      }

      // Generate embedding for the intent
      const intentEmbedding = VectorService.generateEmbedding(intent);
      
      const matches: TemplateMatch[] = [];

      // Calculate similarity with each template
      for (const apiKey of userApiKeys) {
        const templateDescription = apiKey.data.description;
        const templateEmbedding = VectorService.generateEmbedding(templateDescription);
        
        const similarity = VectorService.cosineSimilarity(intentEmbedding, templateEmbedding);
        
        if (similarity >= this.MATCH_THRESHOLD) {
          matches.push({
            template: apiKey.template,
            confidence: similarity,
            description: templateDescription
          });
        }
      }

      // Sort by confidence (highest first)
      matches.sort((a, b) => b.confidence - a.confidence);

      if (matches.length === 0) {
        logger.info(`No matching templates found for intent: ${intent.substring(0, 50)}`);
        return {
          found: false,
          hasConflict: false
        };
      }

      // Check for conflicts (multiple high-confidence matches)
      const highConfidenceMatches = matches.filter(m => m.confidence >= this.CONFLICT_THRESHOLD);
      const hasConflict = highConfidenceMatches.length > 1;

      if (hasConflict) {
        logger.warn(`Multiple template conflicts found for intent: ${intent.substring(0, 50)}`, {
          userId,
          conflictingTemplates: highConfidenceMatches.map(m => ({
            template: m.template,
            confidence: m.confidence
          }))
        });
      }

      const bestMatch = matches[0];
      
      if (!bestMatch) {
        return {
          found: false,
          hasConflict: false
        };
      }
      
      logger.info(`Template match found for user ${userId}`, {
        intent: intent.substring(0, 50),
        template: bestMatch.template,
        confidence: bestMatch.confidence,
        hasConflict
      });

      return {
        found: true,
        match: bestMatch,
        hasConflict,
        conflictingTemplates: hasConflict ? highConfidenceMatches : []
      };

    } catch (error) {
      logger.error('Template matching error:', error);
      return {
        found: false,
        hasConflict: false
      };
    }
  }

  /**
   * Store template embeddings for faster lookup (optional optimization)
   */
  static async storeTemplateEmbeddings(userId: string): Promise<void> {
    try {
      const userApiKeys = await redisService.getUserApiKeys(userId);
      const embeddingsKey = `${this.TEMPLATE_PREFIX}:${userId}`;

      // Clear existing embeddings
      await redisService.del(embeddingsKey);

      // Generate and store embeddings for each template
      for (const apiKey of userApiKeys) {
        const embedding = VectorService.generateEmbedding(apiKey.data.description);
        const embeddingData = {
          template: apiKey.template,
          embedding: JSON.stringify(embedding),
          description: apiKey.data.description,
          updated: new Date().toISOString()
        };

        await redisService.hset(embeddingsKey, apiKey.template, JSON.stringify(embeddingData));
      }

      // Set TTL for embeddings (24 hours)
      await redisService.expire(embeddingsKey, 86400);

      logger.info(`Stored template embeddings for user ${userId}`, {
        templatesCount: userApiKeys.length
      });

    } catch (error) {
      logger.error('Failed to store template embeddings:', error);
    }
  }

  /**
   * Get template suggestions based on partial intent
   */
  static async getTemplateSuggestions(userId: string, partialIntent: string, limit = 5): Promise<TemplateMatch[]> {
    try {
      const userApiKeys = await redisService.getUserApiKeys(userId);
      
      if (userApiKeys.length === 0) {
        return [];
      }

      const intentEmbedding = VectorService.generateEmbedding(partialIntent);
      const suggestions: TemplateMatch[] = [];

      for (const apiKey of userApiKeys) {
        const templateEmbedding = VectorService.generateEmbedding(apiKey.data.description);
        const similarity = VectorService.cosineSimilarity(intentEmbedding, templateEmbedding);
        
        suggestions.push({
          template: apiKey.template,
          confidence: similarity,
          description: apiKey.data.description
        });
      }

      // Sort by confidence and return top suggestions
      return suggestions
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, limit);

    } catch (error) {
      logger.error('Template suggestions error:', error);
      return [];
    }
  }

  /**
   * Find top K matching templates for semantic testing playground
   */
  static async findTopMatches(userId: string, intent: string, topK = 3): Promise<TemplateMatch[]> {
    try {
      const userApiKeys = await redisService.getUserApiKeys(userId);
      
      if (userApiKeys.length === 0) {
        return [];
      }

      const intentEmbedding = VectorService.generateEmbedding(intent);
      const matches: TemplateMatch[] = [];

      // Calculate similarity with each template
      for (const apiKey of userApiKeys) {
        const templateDescription = apiKey.data.description;
        const templateEmbedding = VectorService.generateEmbedding(templateDescription);
        
        const similarity = VectorService.cosineSimilarity(intentEmbedding, templateEmbedding);
        
        matches.push({
          template: apiKey.template,
          confidence: similarity,
          description: templateDescription
        });
      }

      // Sort by confidence (highest first) and return top K
      return matches
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, Math.min(topK, matches.length));

    } catch (error) {
      logger.error('Top matches error:', error);
      return [];
    }
  }
}
