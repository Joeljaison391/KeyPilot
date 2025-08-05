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
  log: {
    level: string;
    format: string;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  cors: {
    origin: string | string[];
    credentials: boolean;
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

  log: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'combined',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || [
      'http://localhost:3000',
      'http://localhost:4000', 
      'http://localhost:5000',
      'http://localhost:8000',
      'https://keypilot-theta.vercel.app'
    ],
    credentials: process.env.CORS_CREDENTIALS === 'true',
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
