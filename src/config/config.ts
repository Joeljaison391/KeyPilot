import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface Config {
  env: string;
  port: number;
  app: {
    name: string;
    version: string;
  };
  quota: {
    daily: number;
    monthly: number;
    alertThresholds: number[];
    autoDisable: boolean;
  };
  cost: {
    tracking: boolean;
    tokenPricing: Record<string, number>;
    savingsGoal: number;
  };
  rateLimiting: {
    dynamic: boolean;
    baseLimit: number;
    scalingFactor: number;
    priorityLevels: number;
  };
  trends: {
    analysisWindow: number;
    anomalyThreshold: number;
    patternRecognition: boolean;
  };
  fallback: {
    enabled: boolean;
    maxRetries: number;
    backoffMs: number;
    strategy: 'round-robin' | 'priority';
  };
  collaboration: {
    enabled: boolean;
    maxTeamSize: number;
    roleHierarchy: string[];
  };
  templates: {
    versionControl: boolean;
    maxVersions: number;
    autoValidation: boolean;
  };
  log: {
    level: string;
    format: string;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  cors: {
    origin: string | string[] | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void);
    credentials: boolean;
    methods: string[];
    allowedHeaders: string[];
    optionsSuccessStatus: number;
  };
  security: {
    jwtSecret: string;
    apiKey: string;
  };
  healthCheck: {
    endpoint: string;
  };
  redis: {
    url: string;
    cloudUrl: string;
    password: string | undefined;
    tls: boolean;
  };
  session: {
    ttl: number;
    tokenLength: number;
  };
  demoUsers: Record<string, string>;
}

const config: Config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  
  app: {
    name: process.env.APP_NAME || 'gateway-service',
    version: process.env.APP_VERSION || '1.0.0',
  },

  quota: {
    daily: parseInt(process.env.QUOTA_DAILY || '1000', 10),
    monthly: parseInt(process.env.QUOTA_MONTHLY || '25000', 10),
    alertThresholds: [50, 80, 90, 95],
    autoDisable: process.env.QUOTA_AUTO_DISABLE === 'true'
  },

  cost: {
    tracking: true,
    tokenPricing: {
      'gpt-4': 0.03,
      'gpt-3.5-turbo': 0.002,
      'claude-v1': 0.015
    },
    savingsGoal: 20 // 20% savings target
  },

  rateLimiting: {
    dynamic: true,
    baseLimit: parseInt(process.env.RATE_BASE_LIMIT || '100', 10),
    scalingFactor: parseFloat(process.env.RATE_SCALING_FACTOR || '1.5'),
    priorityLevels: 3
  },

  trends: {
    analysisWindow: parseInt(process.env.TREND_WINDOW || '86400', 10), // 24 hours
    anomalyThreshold: parseFloat(process.env.ANOMALY_THRESHOLD || '2.0'),
    patternRecognition: true
  },

  fallback: {
    enabled: true,
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    backoffMs: parseInt(process.env.BACKOFF_MS || '1000', 10),
    strategy: 'priority'
  },

  collaboration: {
    enabled: true,
    maxTeamSize: parseInt(process.env.MAX_TEAM_SIZE || '10', 10),
    roleHierarchy: ['viewer', 'user', 'admin', 'owner']
  },

  templates: {
    versionControl: true,
    maxVersions: parseInt(process.env.MAX_TEMPLATE_VERSIONS || '5', 10),
    autoValidation: true
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'combined',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

cors: {
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:4000', 
        'http://localhost:5000',
        'http://localhost:8000',
        'http://localhost:8001',
        'http://localhost:5174',
        'http://localhost:5173',
        'chrome-extension://amknoiejhlmhancpahfcfcfhllgkpbld',
        'https://keypilot-theta.vercel.app',
        'https://key-pilot-frontend.vercel.app'
      ];
      
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log(`CORS blocked origin: ${origin}`);
        callback(new Error(`Not allowed by CORS. Origin: ${origin}`), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 200
  },


  security: {
    jwtSecret: process.env.JWT_SECRET || 'fallback-secret-change-this',
    apiKey: process.env.API_KEY || 'fallback-api-key',
  },

  healthCheck: {
    endpoint: process.env.HEALTH_CHECK_ENDPOINT || '/health',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://default:OxlMsSWxXn21KlfcvCiOIMy7wnorimPw@redis-19516.c73.us-east-1-2.ec2.redns.redis-cloud.com:19516',
    cloudUrl: process.env.REDIS_CLOUD_URL || 'redis://default:OxlMsSWxXn21KlfcvCiOIMy7wnorimPw@redis-19516.c73.us-east-1-2.ec2.redns.redis-cloud.com:19516',
    password: process.env.REDIS_PASSWORD || 'OxlMsSWxXn21KlfcvCiOIMy7wnorimPw',
    tls: process.env.REDIS_TLS === 'true' || process.env.NODE_ENV === 'production',
  },

  session: {
    ttl: parseInt(process.env.SESSION_TTL || '1800', 10), // 30 minutes
    tokenLength: parseInt(process.env.TOKEN_LENGTH || '16', 10),
  },

  demoUsers: (() => {
    const demoUsersStr = process.env.DEMO_USERS || 'demo1:pass1,demo2:pass2,demo3:pass3';
    const users: Record<string, string> = {};
    demoUsersStr.split(',').forEach(userPass => {
      const [userId, password] = userPass.split(':');
      if (userId && password) {
        users[userId] = password;
      }
    });
    return users;
  })(),
};

// Validate required environment variables in production
if (config.env === 'production') {
  const requiredEnvVars = [
    'JWT_SECRET',
    'API_KEY',
  ];

  const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missingEnvVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  }
}

export { config };
