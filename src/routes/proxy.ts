import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { StatusCodes } from 'http-status-codes';
import { validateRequest } from '../middleware/validation';
import { TokenValidator } from '../utils/tokenValidator';
import { IntentProcessor } from '../utils/intentProcessor';
import { SemanticCache } from '../utils/semanticCache';
import { TemplateMatchingService } from '../utils/templateMatching';
import { AccessControlService } from '../utils/accessControl';
import { EncryptionService } from '../utils/encryption';
import { NotificationService } from '../utils/notificationService';
import { redisService } from '../utils/redisService';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Main proxy route - handles intelligent API routing
 */
router.post('/proxy',
  // Add debug middleware to log request body
  (req: Request, _res: Response, next: NextFunction) => {
    logger.info('Proxy route debug info', {
      headers: req.headers,
      bodyType: typeof req.body,
      bodyKeys: req.body ? Object.keys(req.body) : [],
      contentType: req.headers['content-type'],
      body: req.body
    });
    next();
  },
  validateRequest([
    body('token')
      .notEmpty()
      .withMessage('Token is required')
      .isLength({ min: 1, max: 100 })
      .withMessage('Token must be between 1 and 100 characters'),
    body('intent')
      .notEmpty()
      .withMessage('Intent is required')
      .isLength({ min: 1, max: 500 })
      .withMessage('Intent must be between 1 and 500 characters'),
    body('payload')
      .isObject()
      .withMessage('Payload must be an object'),
    body('origin')
      .optional()
      .isURL()
      .withMessage('Origin must be a valid URL'),
  ]),
  async (req: Request, res: Response) => {
    const startTime = Date.now();
    let userId = '';
    let intent = '';
    let matchedTemplate = '';
    let confidence = 0;
    let cached = false;
    let tokensUsed = 0;

    logger.info('Received proxy request', {
        requestId: req.requestId,
        intent: req.body.intent.substring(0, 50),
        origin: req.body.origin,
        payloadSize: JSON.stringify(req.body.payload).length
        });

    console.info('Proxy request received', {
        requestId: req.requestId,
        intent: req.body.intent.substring(0, 50),
        origin: req.body.origin,
        payloadSize: JSON.stringify(req.body.payload).length
    });

    try {
      const { token, intent: rawIntent, payload, origin } = req.body;
      intent = rawIntent;

      logger.info('Proxy request received', {
        requestId: req.requestId,
        intent: intent.substring(0, 50),
        origin,
        payloadSize: JSON.stringify(payload).length
      });

      // Step 1: Token Validation
      const tokenValidation = await TokenValidator.validateToken(token);
      if (!tokenValidation.isValid) {
        res.status(StatusCodes.UNAUTHORIZED).json({
          success: false,
          error: 'Invalid or expired token',
        });
        return;
      }

      userId = tokenValidation.userId!;

      // Step 2: Stream Request Received Event
      await NotificationService.streamRequestReceived(userId, intent, origin);

      // Step 3: Intent Rewriting via Gemini API
      const intentResult = await IntentProcessor.rewriteIntent(intent);
      const processedIntent = intentResult.rewritten;

      if (intentResult.fallback) {
        await NotificationService.notifyIntentRewritingFallback(userId);
      } else if (intentResult.success) {
        await NotificationService.notifyIntentRewritten(userId, intent, processedIntent);
      }

      console.log('Intent processing result', {
        userId,
        originalIntent: intent,
        processedIntent,
        success: intentResult.success,
        fallback: intentResult.fallback
      });

      // Step 4: Semantic Cache Check
      const cacheResult = await SemanticCache.searchCache(userId, processedIntent, payload);
      if (cacheResult.found && cacheResult.entry) {
        cached = true;
        confidence = cacheResult.confidence!;
        matchedTemplate = cacheResult.entry.matched_template;

        logger.info('Cache hit - returning cached response', {
          userId,
          template: matchedTemplate,
          confidence
        });

        console.log('Cache hit - returning cached response', {
          userId,
          template: matchedTemplate,
          confidence
        });

        // Stream completion event
        const latency = Date.now() - startTime;
        await NotificationService.streamRequestCompleted(
          userId, intent, matchedTemplate, confidence, true, latency, 0
        );

        res.status(StatusCodes.OK).json({
          response: cacheResult.entry.response,
          matched_template: matchedTemplate,
          confidence,
          cached: true,
          notices: []
        });
        return;
      }

      // Step 5: Intent-to-Template Matching via Vector Search
      const templateMatch = await TemplateMatchingService.findMatchingTemplate(userId, processedIntent);
      
      if (!templateMatch.found || !templateMatch.match) {
        res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          error: 'No matching API template found for this intent',
          suggestions: await TemplateMatchingService.getTemplateSuggestions(userId, processedIntent, 3)
        });
        return;
      }

      matchedTemplate = templateMatch.match.template;
      confidence = templateMatch.match.confidence;

      // Handle template conflicts
      if (templateMatch.hasConflict && templateMatch.conflictingTemplates) {
        await NotificationService.notifyTemplateConflict(
          userId, 
          processedIntent, 
          templateMatch.conflictingTemplates.map(t => t.template)
        );
      }

      // Step 6: Enforce Access Controls
      const accessValidation = await AccessControlService.validateAccess(
        userId, matchedTemplate, payload, origin
      );

      if (!accessValidation.allowed) {
        const statusCode = accessValidation.error?.includes('limit') 
          ? StatusCodes.TOO_MANY_REQUESTS 
          : StatusCodes.FORBIDDEN;

        res.status(statusCode).json({
          success: false,
          error: accessValidation.error,
          template: matchedTemplate
        });
        return;
      }

      // Step 7: Decrypt API Key
      const apiKeyData = await redisService.getApiKey(userId, matchedTemplate);
      if (!apiKeyData) {
        res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          error: 'API key data not found'
        });
        return;
      }

      logger.info(`Decrypting API key for user ${userId}`, {
        template: matchedTemplate,
        hasEncryptedKey: !!apiKeyData.encrypted_key,
        encryptedKeyStructure: {
          hasEncrypted: !!(apiKeyData.encrypted_key?.encrypted),
          hasIV: !!(apiKeyData.encrypted_key?.iv),
          encryptedLength: apiKeyData.encrypted_key?.encrypted?.length || 0
        }
      });

      const decryptedApiKey = EncryptionService.decrypt(apiKeyData.encrypted_key, token);
      
      logger.info(`API key decryption result`, {
        decryptionSuccessful: !!decryptedApiKey,
        decryptedKeyLength: decryptedApiKey?.length || 0,
        keyPrefix: decryptedApiKey?.substring(0, 10) || 'N/A',
        keyFormat: decryptedApiKey?.startsWith('AIzaSy') ? 'Valid Google API Key Format' : 'Unknown Format'
      });

      // Step 8: Call External API based on template
      let apiResponse: {
        success: boolean;
        data?: any;
        error?: string;
        tokensUsed?: number;
      };

      switch (matchedTemplate) {
        case 'gemini-chat-completion':
            console.log("decryptedApiKey", decryptedApiKey);
          apiResponse = await callGeminiAPI(payload, decryptedApiKey);
          break;
        
        case 'openai-gpt-chat':
          apiResponse = await callOpenAIGPTAPI(payload, decryptedApiKey);
          break;
        
        case 'openai-dalle-image':
          apiResponse = await callOpenAIDALLEAPI(payload, decryptedApiKey);
          break;
        
        case 'anthropic-claude-chat':
          apiResponse = await callAnthropicClaudeAPI(payload, decryptedApiKey);
          break;
        
        default:
          apiResponse = {
            success: false,
            error: `Unsupported template: ${matchedTemplate}. Please use one of: gemini-chat-completion, openai-gpt-chat, openai-dalle-image, anthropic-claude-chat`
          };
      }

      if (!apiResponse.success) {
        res.status(StatusCodes.BAD_GATEWAY).json({
          success: false,
          error: `${matchedTemplate} API call failed`,
          details: apiResponse.error
        });
        return;
      }

      tokensUsed = apiResponse.tokensUsed || 0;

      // Step 9: Store in Semantic Cache
      await SemanticCache.storeInCache(
        userId, processedIntent, payload, apiResponse.data, matchedTemplate, confidence
      );

      // Step 10: Update Usage
      await AccessControlService.updateUsage(userId, matchedTemplate, tokensUsed);

      // Step 11: Stream Request Completed
      const latency = Date.now() - startTime;
      await NotificationService.streamRequestCompleted(
        userId, intent, matchedTemplate, confidence, cached, latency, tokensUsed
      );

      // Step 12: Return Response to Client
      const notices: string[] = [];
      
      if (accessValidation.warningMessage) {
        notices.push(accessValidation.warningMessage);
      }
      
      if (intentResult.success && processedIntent !== intent) {
        notices.push(`✅ Rewritten intent: ${processedIntent}`);
      }

      res.status(StatusCodes.OK).json({
        response: apiResponse.data,
        matched_template: matchedTemplate,
        confidence,
        cached: false,
        latency_ms: latency,
        tokens_used: tokensUsed,
        notices
      });

    } catch (error) {
      logger.error('Proxy request error:', error);
      
      // Stream error event if we have userId
      if (userId) {
        const latency = Date.now() - startTime;
        await NotificationService.streamRequestCompleted(
          userId, intent, matchedTemplate, confidence, cached, latency, tokensUsed
        );
      }

      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        requestId: req.requestId
      });
    }
  }
);

// Response interfaces
interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    totalTokenCount: number;
    promptTokenCount: number;
    candidatesTokenCount: number;
  };
}

interface OpenAIGPTResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIDALLEResponse {
  created: number;
  data: Array<{
    url: string;
    revised_prompt?: string;
  }>;
}

interface AnthropicResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Call Google Gemini API
 */
async function callGeminiAPI(payload: any, apiKey: string): Promise<{
  success: boolean;
  data?: any;
  error?: string;
  tokensUsed?: number;
}> {
  try {
    logger.info(`Making Gemini API call`, {
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey?.length || 0,
      apiKeyPrefix: apiKey?.substring(0, 10) || 'N/A',
      isValidFormat: apiKey?.startsWith('AIzaSy') || false,
      payloadKeys: Object.keys(payload || {})
    });

    // Build proper Gemini API request structure
    const requestBody: any = {
      contents: payload.contents || [{
        parts: [{
          text: payload.prompt || payload.message || payload.text || "Hello"
        }]
      }]
    };

    // Add generation config only if specified (Gemini has defaults)
    const generationConfig: any = {};
    
    if (payload.temperature !== undefined) {
      generationConfig.temperature = payload.temperature;
    }
    if (payload.maxOutputTokens !== undefined || payload.max_tokens !== undefined) {
      generationConfig.maxOutputTokens = payload.maxOutputTokens || payload.max_tokens;
    }
    if (payload.topP !== undefined || payload.top_p !== undefined) {
      generationConfig.topP = payload.topP || payload.top_p;
    }
    if (payload.topK !== undefined || payload.top_k !== undefined) {
      generationConfig.topK = payload.topK || payload.top_k;
    }
    if (payload.candidateCount !== undefined) {
      generationConfig.candidateCount = payload.candidateCount;
    }
    if (payload.stopSequences !== undefined || payload.stop_sequences !== undefined) {
      generationConfig.stopSequences = payload.stopSequences || payload.stop_sequences;
    }

    // Only add generationConfig if we have any settings
    if (Object.keys(generationConfig).length > 0) {
      requestBody.generationConfig = generationConfig;
    }

    // Add safety settings if provided
    if (payload.safetySettings) {
      requestBody.safetySettings = payload.safetySettings;
    }

    // Add system instruction if provided
    if (payload.systemInstruction) {
      requestBody.systemInstruction = payload.systemInstruction;
    }

    // Add system instruction if provided
    if (payload.systemInstruction) {
      requestBody.systemInstruction = payload.systemInstruction;
    }

    logger.info('Gemini API request body structure', {
      hasContents: !!requestBody.contents,
      contentsLength: requestBody.contents?.length || 0,
      hasGenerationConfig: !!requestBody.generationConfig,
      generationConfigKeys: requestBody.generationConfig ? Object.keys(requestBody.generationConfig) : []
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Gemini API error response', {
        status: response.status,
        statusText: response.statusText,
        errorBody: errorText
      });
      throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as GeminiResponse;
    
    logger.info('Gemini API success response', {
      hasCandidates: !!data.candidates,
      candidatesCount: data.candidates?.length || 0,
      hasUsageMetadata: !!data.usageMetadata,
      totalTokens: data.usageMetadata?.totalTokenCount || 0
    });
    
    return {
      success: true,
      data,
      tokensUsed: data.usageMetadata?.totalTokenCount || 100
    };

  } catch (error) {
    logger.error('Gemini API call error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Gemini API error'
    };
  }
}

/**
 * Call OpenAI GPT API
 */
async function callOpenAIGPTAPI(payload: any, apiKey: string): Promise<{
  success: boolean;
  data?: any;
  error?: string;
  tokensUsed?: number;
}> {
  try {
    const requestBody = {
      model: payload.model || 'gpt-3.5-turbo',
      messages: payload.messages || [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: payload.prompt || payload.message || payload.text }
      ],
      temperature: payload.temperature || 0.7,
      max_tokens: payload.max_tokens || 150,
      top_p: payload.top_p,
      frequency_penalty: payload.frequency_penalty,
      presence_penalty: payload.presence_penalty,
      ...payload
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI GPT API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as OpenAIGPTResponse;
    
    return {
      success: true,
      data,
      tokensUsed: data.usage?.total_tokens || 0
    };

  } catch (error) {
    logger.error('OpenAI GPT API call error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown OpenAI GPT API error'
    };
  }
}

/**
 * Call OpenAI DALL-E API
 */
async function callOpenAIDALLEAPI(payload: any, apiKey: string): Promise<{
  success: boolean;
  data?: any;
  error?: string;
  tokensUsed?: number;
}> {
  try {
    const requestBody = {
      prompt: payload.prompt || payload.message || payload.text,
      n: payload.n || 1,
      size: payload.size || '1024x1024',
      quality: payload.quality || 'standard',
      style: payload.style || 'vivid',
      ...payload
    };

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI DALL-E API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as OpenAIDALLEResponse;
    
    return {
      success: true,
      data,
      tokensUsed: 100 // Approximate token usage for image generation
    };

  } catch (error) {
    logger.error('OpenAI DALL-E API call error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown OpenAI DALL-E API error'
    };
  }
}

/**
 * Call Anthropic Claude API
 */
async function callAnthropicClaudeAPI(payload: any, apiKey: string): Promise<{
  success: boolean;
  data?: any;
  error?: string;
  tokensUsed?: number;
}> {
  try {
    const requestBody = {
      model: payload.model || 'claude-3-sonnet-20240229',
      max_tokens: payload.max_tokens || 1000,
      messages: payload.messages || [
        { role: 'user', content: payload.prompt || payload.message || payload.text }
      ],
      temperature: payload.temperature || 0.7,
      top_p: payload.top_p,
      stop_sequences: payload.stop_sequences,
      ...payload
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic Claude API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as AnthropicResponse;
    
    return {
      success: true,
      data,
      tokensUsed: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
    };

  } catch (error) {
    logger.error('Anthropic Claude API call error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Anthropic Claude API error'
    };
  }
}

/**
 * Semantic Testing Playground Route
 * Helps developers debug how the system interprets their intent and what template it will match
 */
router.post('/test',
  validateRequest([
    body('token')
      .notEmpty()
      .withMessage('Token is required')
      .isLength({ min: 8, max: 100 })
      .withMessage('Token must be between 8 and 100 characters'),
    body('intent')
      .notEmpty()
      .withMessage('Intent is required')
      .isLength({ min: 1, max: 500 })
      .withMessage('Intent must be between 1 and 500 characters'),
    body('include_rewrite')
      .optional()
      .isBoolean()
      .withMessage('include_rewrite must be a boolean'),
    body('top_k')
      .optional()
      .isInt({ min: 1, max: 10 })
      .withMessage('top_k must be between 1 and 10'),
  ]),
  async (req: Request, res: Response) => {
    const startTime = Date.now();
    let userId: string = '';

    try {
      const { token, intent, include_rewrite = true, top_k = 3 } = req.body;

      logger.info('Semantic testing playground request', {
        requestId: req.requestId,
        intent: intent.substring(0, 100) + (intent.length > 100 ? '...' : ''),
        include_rewrite,
        top_k
      });

      // Step 1: Validate Token
      const tokenValidation = await TokenValidator.validateToken(token);
      if (!tokenValidation.isValid) {
        res.status(StatusCodes.UNAUTHORIZED).json({
          success: false,
          error: 'Invalid or expired token',
          message: tokenValidation.error
        });
        return;
      }

      userId = tokenValidation.userId!;

      // Step 2: Optional Intent Rewriting
      let rewrittenIntent = intent;
      let rewriteUsed = false;

      if (include_rewrite) {
        const intentResult = await IntentProcessor.processIntent(intent);
        if (intentResult.success && intentResult.rewrittenIntent) {
          rewrittenIntent = intentResult.rewrittenIntent;
          rewriteUsed = true;
        }
      }

      // Step 3: Get All User Templates for Semantic Matching
      const userApiKeys = await redisService.getUserApiKeys(userId);
      
      if (userApiKeys.length === 0) {
        res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          error: 'No API templates found',
          message: 'You must have at least one API key/template configured to use semantic testing'
        });
        return;
      }

      // Step 4: Vector Search & Top K Matches
      const templateMatches = await TemplateMatchingService.findTopMatches(
        userId, 
        rewrittenIntent, 
        Math.min(top_k, userApiKeys.length)
      );

      // Step 5: Check for Conflicts
      const conflictThreshold = 0.85;
      const topMatches = templateMatches.map((match: any) => ({
        template: match.template,
        confidence: Math.round(match.confidence * 1000) / 1000, // Round to 3 decimal places
        description: userApiKeys.find(key => key.template === match.template)?.data.description || 'No description',
        scopes: userApiKeys.find(key => key.template === match.template)?.data.scopes || []
      }));

      const intentConflicts = templateMatches
        .filter((match: any) => match.confidence >= conflictThreshold)
        .map((match: any) => match.template);

      // Step 6: Send Developer Notification
      try {
        await NotificationService.notifyDeveloperTest(
          userId,
          intent,
          rewrittenIntent,
          topMatches[0]?.template || 'none',
          topMatches[0]?.confidence || 0
        );
      } catch (notificationError) {
        logger.warn('Failed to send developer notification:', notificationError);
      }

      // Step 7: Log to Debug Stream
      try {
        await redisService.lpush(`stream:debug:${userId}`, JSON.stringify({
          timestamp: new Date().toISOString(),
          event: 'semantic_test',
          original_intent: intent,
          rewritten_intent: rewrittenIntent,
          rewrite_used: rewriteUsed,
          top_matches: topMatches,
          conflicts: intentConflicts,
          processing_time_ms: Date.now() - startTime
        }));

        // Keep only last 100 debug entries
        await redisService.ltrim(`stream:debug:${userId}`, 0, 99);
      } catch (streamError) {
        logger.warn('Failed to log to debug stream:', streamError);
      }

      // Step 8: Response
      const response = {
        success: true,
        timestamp: new Date().toISOString(),
        processing_time_ms: Date.now() - startTime,
        intent_analysis: {
          original: intent,
          rewritten: rewriteUsed ? rewrittenIntent : null,
          rewrite_used: rewriteUsed,
          length: intent.length,
          word_count: intent.split(/\s+/).length
        },
        template_matching: {
          total_templates: userApiKeys.length,
          matches_returned: topMatches.length,
          top_matches: topMatches,
          conflict_threshold: conflictThreshold,
          intent_conflicts: intentConflicts,
          has_conflicts: intentConflicts.length > 1
        },
        recommendations: {
          primary_match: topMatches[0] || null,
          confidence_level: (topMatches[0]?.confidence ?? 0) >= 0.9 ? 'high' : 
                           (topMatches[0]?.confidence ?? 0) >= 0.7 ? 'medium' : 'low',
          should_review: intentConflicts.length > 1 || (topMatches[0]?.confidence || 0) < 0.7,
          suggestions: intentConflicts.length > 1 ? [
            'Multiple templates have high confidence scores - consider refining your intent',
            'Review template descriptions to ensure they are distinct enough'
          ] : (topMatches[0]?.confidence || 0) < 0.7 ? [
            'Low confidence match - consider adding more specific keywords to your intent',
            'Review if your templates cover this use case adequately'
          ] : [
            'Good match found! This intent should route correctly.'
          ]
        },
        debug_info: {
          user_id: userId,
          request_id: req.requestId,
          cache_available: await SemanticCache.hasCache(userId),
          notification_sent: true,
          debug_stream_logged: true
        }
      };

      res.status(StatusCodes.OK).json(response);

    } catch (error) {
      logger.error('Semantic testing playground error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        requestId: req.requestId,
        userId
      });

      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        message: 'An error occurred during semantic testing',
        requestId: req.requestId
      });
    }
  }
);

export default router;
