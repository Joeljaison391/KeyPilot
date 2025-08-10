import { Router, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { logger } from '../utils/logger';

const router = Router();

interface TemplateConfiguration {
  id: string;
  name: string;
  description: string;
  category: string;
  provider: string;
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  requestBody: {
    required: string[];
    optional: string[];
    schema: any;
    example: any;
  };
  responseModel: {
    schema: any;
    example: any;
  };
  curlCommand: string;
  pricing: {
    model: string;
    cost_per_token?: number;
    cost_per_request?: number;
    cost_per_image?: number;
  };
  limits: {
    max_requests_per_day: number;
    max_requests_per_week: number;
    max_tokens_per_day: number;
    max_payload_kb: number;
  };
  scopes: string[];
}

// Predefined template configurations
const PREDEFINED_TEMPLATES: TemplateConfiguration[] = [
  {
    id: 'gemini-chat-completion',
    name: 'Google Gemini Chat Completion',
    description: 'Generate conversational AI responses using Google Gemini Pro',
    category: 'text-generation',
    provider: 'Google',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    requestBody: {
      required: ['contents'],
      optional: ['generationConfig', 'safetySettings'],
      schema: {
        type: 'object',
        properties: {
          contents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                parts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      text: { type: 'string' }
                    }
                  }
                }
              }
            }
          },
          generationConfig: {
            type: 'object',
            properties: {
              temperature: { type: 'number', minimum: 0, maximum: 1 },
              maxOutputTokens: { type: 'number' },
              topP: { type: 'number' },
              topK: { type: 'number' }
            }
          }
        }
      },
      example: {
        contents: [{
          parts: [{
            text: "Write a creative story about a robot learning to paint"
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 800,
          topP: 0.8,
          topK: 10
        }
      }
    },
    responseModel: {
      schema: {
        type: 'object',
        properties: {
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: {
                  type: 'object',
                  properties: {
                    parts: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          text: { type: 'string' }
                        }
                      }
                    }
                  }
                },
                finishReason: { type: 'string' },
                index: { type: 'number' }
              }
            }
          },
          usageMetadata: {
            type: 'object',
            properties: {
              promptTokenCount: { type: 'number' },
              candidatesTokenCount: { type: 'number' },
              totalTokenCount: { type: 'number' }
            }
          }
        }
      },
      example: {
        candidates: [{
          content: {
            parts: [{
              text: "In the quiet corner of an art studio, a robot named Canvas-7 discovered something extraordinary..."
            }]
          },
          finishReason: "STOP",
          index: 0
        }],
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 150,
          totalTokenCount: 162
        }
      }
    },
    curlCommand: `curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [{
      "parts": [{
        "text": "Write a creative story about a robot learning to paint"
      }]
    }],
    "generationConfig": {
      "temperature": 0.7,
      "maxOutputTokens": 800,
      "topP": 0.8,
      "topK": 10
    }
  }'`,
    pricing: {
      model: 'gemini-pro',
      cost_per_token: 0.00025
    },
    limits: {
      max_requests_per_day: 1000,
      max_requests_per_week: 5000,
      max_tokens_per_day: 100000,
      max_payload_kb: 1000
    },
    scopes: ['text', 'chat', 'completion', 'gemini']
  },
  {
    id: 'openai-gpt-chat',
    name: 'OpenAI GPT Chat Completion',
    description: 'Generate AI responses using OpenAI GPT models',
    category: 'text-generation',
    provider: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer YOUR_API_KEY'
    },
    requestBody: {
      required: ['model', 'messages'],
      optional: ['temperature', 'max_tokens', 'top_p', 'frequency_penalty', 'presence_penalty'],
      schema: {
        type: 'object',
        properties: {
          model: { type: 'string', enum: ['gpt-4', 'gpt-3.5-turbo'] },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                content: { type: 'string' }
              }
            }
          },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          max_tokens: { type: 'number' },
          top_p: { type: 'number' }
        }
      },
      example: {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'What is the capital of France?' }
        ],
        temperature: 0.7,
        max_tokens: 150
      }
    },
    responseModel: {
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          object: { type: 'string' },
          created: { type: 'number' },
          model: { type: 'string' },
          choices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'number' },
                message: {
                  type: 'object',
                  properties: {
                    role: { type: 'string' },
                    content: { type: 'string' }
                  }
                },
                finish_reason: { type: 'string' }
              }
            }
          },
          usage: {
            type: 'object',
            properties: {
              prompt_tokens: { type: 'number' },
              completion_tokens: { type: 'number' },
              total_tokens: { type: 'number' }
            }
          }
        }
      },
      example: {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-3.5-turbo-0613',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'The capital of France is Paris.'
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 8,
          total_tokens: 28
        }
      }
    },
    curlCommand: `curl -X POST "https://api.openai.com/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is the capital of France?"}
    ],
    "temperature": 0.7,
    "max_tokens": 150
  }'`,
    pricing: {
      model: 'gpt-3.5-turbo',
      cost_per_token: 0.002
    },
    limits: {
      max_requests_per_day: 500,
      max_requests_per_week: 2000,
      max_tokens_per_day: 50000,
      max_payload_kb: 500
    },
    scopes: ['text', 'chat', 'completion', 'openai', 'gpt']
  },
  {
    id: 'openai-dalle-image',
    name: 'OpenAI DALL-E Image Generation',
    description: 'Generate images from text prompts using DALL-E',
    category: 'image-generation',
    provider: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/images/generations',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer YOUR_API_KEY'
    },
    requestBody: {
      required: ['prompt'],
      optional: ['n', 'size', 'quality', 'style'],
      schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', maxLength: 4000 },
          n: { type: 'number', minimum: 1, maximum: 10 },
          size: { type: 'string', enum: ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'] },
          quality: { type: 'string', enum: ['standard', 'hd'] },
          style: { type: 'string', enum: ['vivid', 'natural'] }
        }
      },
      example: {
        prompt: 'A futuristic city with flying cars at sunset',
        n: 1,
        size: '1024x1024',
        quality: 'standard',
        style: 'vivid'
      }
    },
    responseModel: {
      schema: {
        type: 'object',
        properties: {
          created: { type: 'number' },
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                revised_prompt: { type: 'string' }
              }
            }
          }
        }
      },
      example: {
        created: 1589478378,
        data: [{
          url: 'https://oaidalleapiprodscus.blob.core.windows.net/private/...',
          revised_prompt: 'A futuristic city with flying cars soaring through the sky during a beautiful sunset...'
        }]
      }
    },
    curlCommand: `curl -X POST "https://api.openai.com/v1/images/generations" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "prompt": "A futuristic city with flying cars at sunset",
    "n": 1,
    "size": "1024x1024",
    "quality": "standard",
    "style": "vivid"
  }'`,
    pricing: {
      model: 'dall-e-3',
      cost_per_image: 0.040
    },
    limits: {
      max_requests_per_day: 100,
      max_requests_per_week: 500,
      max_tokens_per_day: 10000,
      max_payload_kb: 50
    },
    scopes: ['image', 'generation', 'dalle', 'openai']
  },
  {
    id: 'anthropic-claude-chat',
    name: 'Anthropic Claude Chat',
    description: 'Conversational AI using Anthropic Claude models',
    category: 'text-generation',
    provider: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'YOUR_API_KEY',
      'anthropic-version': '2023-06-01'
    },
    requestBody: {
      required: ['model', 'max_tokens', 'messages'],
      optional: ['temperature', 'top_p', 'stop_sequences'],
      schema: {
        type: 'object',
        properties: {
          model: { type: 'string', enum: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229'] },
          max_tokens: { type: 'number' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['user', 'assistant'] },
                content: { type: 'string' }
              }
            }
          },
          temperature: { type: 'number', minimum: 0, maximum: 1 }
        }
      },
      example: {
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1000,
        messages: [
          { role: 'user', content: 'Explain quantum computing in simple terms' }
        ],
        temperature: 0.7
      }
    },
    responseModel: {
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          role: { type: 'string' },
          content: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                text: { type: 'string' }
              }
            }
          },
          model: { type: 'string' },
          usage: {
            type: 'object',
            properties: {
              input_tokens: { type: 'number' },
              output_tokens: { type: 'number' }
            }
          }
        }
      },
      example: {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'text',
          text: 'Quantum computing is like having a super-powered calculator that can explore many solutions simultaneously...'
        }],
        model: 'claude-3-sonnet-20240229',
        usage: {
          input_tokens: 15,
          output_tokens: 185
        }
      }
    },
    curlCommand: `curl -X POST "https://api.anthropic.com/v1/messages" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "claude-3-sonnet-20240229",
    "max_tokens": 1000,
    "messages": [
      {"role": "user", "content": "Explain quantum computing in simple terms"}
    ],
    "temperature": 0.7
  }'`,
    pricing: {
      model: 'claude-3-sonnet',
      cost_per_token: 0.003
    },
    limits: {
      max_requests_per_day: 300,
      max_requests_per_week: 1500,
      max_tokens_per_day: 75000,
      max_payload_kb: 800
    },
    scopes: ['text', 'chat', 'completion', 'anthropic', 'claude']
  }
];

/**
 * Get all predefined templates
 */
router.get('/templates', async (_req: Request, res: Response) => {
  try {
    logger.info('Fetching all predefined templates');

    const templateSummary = PREDEFINED_TEMPLATES.map(template => ({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      provider: template.provider,
      scopes: template.scopes,
      pricing: template.pricing
    }));

    res.status(StatusCodes.OK).json({
      success: true,
      totalTemplates: PREDEFINED_TEMPLATES.length,
      categories: [...new Set(PREDEFINED_TEMPLATES.map(t => t.category))],
      providers: [...new Set(PREDEFINED_TEMPLATES.map(t => t.provider))],
      customNaming: {
        description: "You can create custom template names using these patterns:",
        patterns: {
          "gemini-*": "Google Gemini API (e.g., gemini-creative, gemini-personal, gemini-work)",
          "openai-gpt-*": "OpenAI GPT Chat API (e.g., openai-gpt-personal, openai-chat-work)",
          "openai-dalle-*": "OpenAI DALL-E Image API (e.g., openai-dalle-creative, openai-image-art)",
          "anthropic-*": "Anthropic Claude API (e.g., anthropic-work, claude-personal)",
          "claude-*": "Anthropic Claude API (alternative pattern)"
        },
        examples: [
          "gemini-creative-writing",
          "openai-gpt-coding-assistant", 
          "anthropic-research-helper",
          "gemini-personal-chat"
        ]
      },
      templates: templateSummary
    });

  } catch (error) {
    logger.error('Error fetching templates:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Failed to fetch templates'
    });
  }
});

/**
 * Get detailed template configuration by ID
 */
router.get('/templates/:templateId', async (req: Request, res: Response) => {
  try {
    const { templateId } = req.params;
    
    logger.info(`Fetching template configuration for: ${templateId}`);

    const template = PREDEFINED_TEMPLATES.find(t => t.id === templateId);
    
    if (!template) {
      res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: 'Template not found',
        availableTemplates: PREDEFINED_TEMPLATES.map(t => t.id)
      });
      return;
    }

    res.status(StatusCodes.OK).json({
      success: true,
      template
    });

  } catch (error) {
    logger.error('Error fetching template details:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Failed to fetch template details'
    });
  }
});

/**
 * Get templates by category
 */
router.get('/templates/category/:category', async (req: Request, res: Response) => {
  try {
    const { category } = req.params;
    
    logger.info(`Fetching templates for category: ${category}`);

    const categoryTemplates = PREDEFINED_TEMPLATES.filter(t => 
      t.category.toLowerCase() === (category || '').toLowerCase()
    );

    if (categoryTemplates.length === 0) {
      res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: 'No templates found for this category',
        availableCategories: [...new Set(PREDEFINED_TEMPLATES.map(t => t.category))]
      });
      return;
    }

    res.status(StatusCodes.OK).json({
      success: true,
      category,
      totalTemplates: categoryTemplates.length,
      templates: categoryTemplates.map(template => ({
        id: template.id,
        name: template.name,
        description: template.description,
        provider: template.provider,
        scopes: template.scopes,
        pricing: template.pricing
      }))
    });

  } catch (error) {
    logger.error('Error fetching templates by category:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Failed to fetch templates by category'
    });
  }
});

/**
 * Get templates by provider
 */
router.get('/templates/provider/:provider', async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    
    logger.info(`Fetching templates for provider: ${provider}`);

    const providerTemplates = PREDEFINED_TEMPLATES.filter(t => 
      t.provider.toLowerCase() === (provider || '').toLowerCase()
    );

    if (providerTemplates.length === 0) {
      res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        error: 'No templates found for this provider',
        availableProviders: [...new Set(PREDEFINED_TEMPLATES.map(t => t.provider))]
      });
      return;
    }

    res.status(StatusCodes.OK).json({
      success: true,
      provider,
      totalTemplates: providerTemplates.length,
      templates: providerTemplates.map(template => ({
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        scopes: template.scopes,
        pricing: template.pricing
      }))
    });

  } catch (error) {
    logger.error('Error fetching templates by provider:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Failed to fetch templates by provider'
    });
  }
});

export default router;
