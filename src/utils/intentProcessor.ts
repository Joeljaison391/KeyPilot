import { logger } from './logger';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

interface IntentRewriteResult {
  rewritten: string;
  success: boolean;
  fallback: boolean;
  original: string;
}

export class IntentProcessor {
  private static readonly GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBDjA2mvHaBf5MwqCeogwuvHHgGqSAmcZM';
  private static readonly GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

  /**
   * Rewrite user intent using Google Gemini API for better semantic routing
   */
  static async rewriteIntent(originalIntent: string): Promise<IntentRewriteResult> {
    try {
      // If no API key is configured, return original intent
      if (!this.GEMINI_API_KEY || this.GEMINI_API_KEY === 'AIzaSyBDjA2mvHaBf5MwqCeogwuvHHgGqSAmcZM') {
        logger.warn('Gemini API key not configured, using original intent');
        return {
          rewritten: originalIntent,
          success: false,
          fallback: true,
          original: originalIntent
        };
      }

      const prompt = `Rewrite the following user intent for semantic API routing. Make it clear, concise, and standardized. Focus on the core action and service needed. Return only the rewritten intent, nothing else.

Original intent: "${originalIntent}"

Rewritten intent:`;

      const requestBody = {
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 100,
          topP: 0.8,
          topK: 10
        }
      };

      const response = await fetch(`${this.GEMINI_API_URL}?key=${this.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      console.log('Gemini API response status:', response.status);
      console.log('Gemini response data:', await response.text());

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as GeminiResponse;
      
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
        throw new Error('Invalid response format from Gemini API');
      }

      const rewrittenIntent = data.candidates[0].content.parts[0].text?.trim() || '';

      // Validate the rewritten intent
      if (!rewrittenIntent || rewrittenIntent.length === 0) {
        throw new Error('Empty response from Gemini API');
      }

      logger.info('Intent successfully rewritten', {
        original: originalIntent.substring(0, 50),
        rewritten: rewrittenIntent.substring(0, 50)
      });

      return {
        rewritten: rewrittenIntent,
        success: true,
        fallback: false,
        original: originalIntent
      };

    } catch (error) {
      logger.error('Intent rewriting failed:', error);
      
      // Fallback to original intent
      return {
        rewritten: originalIntent,
        success: false,
        fallback: true,
        original: originalIntent
      };
    }
  }

  /**
   * Simple rule-based intent normalization as fallback
   */
  static normalizeIntent(intent: string): string {
    const normalized = intent
      .toLowerCase()
      .trim()
      // Common patterns
      .replace(/\b(make|create|generate|build)\b/g, 'generate')
      .replace(/\b(picture|photo|pic)\b/g, 'image')
      .replace(/\b(text|words|content|copy)\b/g, 'text')
      .replace(/\b(openai|chatgpt|gpt)\b/g, 'gpt')
      .replace(/\b(dalle|dall-e|dall e)\b/g, 'dalle')
      // Clean up multiple spaces
      .replace(/\s+/g, ' ')
      .trim();

    return normalized;
  }

  /**
   * Extract key intent features for matching
   */
  static extractIntentFeatures(intent: string): string[] {
    const features: string[] = [];
    const words = intent.toLowerCase().split(/\s+/);
    
    // Action words
    const actions = ['generate', 'create', 'make', 'build', 'analyze', 'process', 'convert', 'translate'];
    const foundActions = words.filter(word => actions.includes(word));
    features.push(...foundActions);

    // Service words  
    const services = ['image', 'text', 'gpt', 'dalle', 'api', 'completion', 'chat'];
    const foundServices = words.filter(word => services.includes(word));
    features.push(...foundServices);

    // Clean and return unique features
    return [...new Set(features)];
  }

  /**
   * Process intent with rewriting for semantic testing playground
   */
  static async processIntent(originalIntent: string): Promise<{
    success: boolean;
    rewrittenIntent?: string;
    fallback: boolean;
    features: string[];
  }> {
    try {
      const rewriteResult = await this.rewriteIntent(originalIntent);
      const features = this.extractIntentFeatures(originalIntent);

      const result: {
        success: boolean;
        rewrittenIntent?: string;
        fallback: boolean;
        features: string[];
      } = {
        success: rewriteResult.success,
        fallback: rewriteResult.fallback,
        features
      };

      if (rewriteResult.success && rewriteResult.rewritten) {
        result.rewrittenIntent = rewriteResult.rewritten;
      }

      return result;

    } catch (error) {
      logger.error('Intent processing error:', error);
      
      return {
        success: false,
        fallback: true,
        features: this.extractIntentFeatures(originalIntent)
      };
    }
  }
}
