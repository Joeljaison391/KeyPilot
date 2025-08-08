import express, { Application, Request, Response, NextFunction } from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { StatusCodes } from 'http-status-codes';
import { config } from './config/config';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import healthRoutes from './routes/health';
import apiRoutes from './routes/api';
import authRoutes from './routes/auth';
import keysRoutes from './routes/keys';
import proxyRoutes from './routes/proxy';
import templatesRoutes from './routes/templates';
import feedbackRoutes from './routes/feedback';
import cacheInspectorRoutes from './routes/cacheInspector';
import intentTrendsRoutes from './routes/intentTrends';
import analyticsRoutes from './routes/analytics';
import { AppError } from './utils/AppError';
import { redisService } from './utils/redisService';
import { requestTracker } from './middleware/requestTracker';

class App {
  public app: Application;

  constructor() {
    this.app = express();
    this.initializeRedis();
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private async initializeRedis(): Promise<void> {
    try {
      await redisService.connect();
      logger.info('Redis connection initialized');
    } catch (error) {
      logger.error('Failed to initialize Redis connection:', error);
      if (config.env === 'production') {
        throw error; // Fail fast in production
      } else {
        logger.warn('Continuing without Redis in development mode');
      }
    }
  }

  private initializeMiddlewares(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));

    // CORS configuration
    this.app.use(cors({
      origin: config.cors.origin,
      credentials: config.cors.credentials,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    // Compression middleware
    this.app.use(compression());

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Serve static files for documentation
    this.app.use('/docs', express.static(path.join(__dirname, '../public')));

    // Request logging
    if (config.env !== 'test') {
      this.app.use(morgan(config.log.format, {
        stream: { write: (message: string) => logger.info(message.trim()) }
      }));
    }

    // Request tracking for analytics
    this.app.use(requestTracker);

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.maxRequests,
      message: {
        error: 'Too many requests from this IP, please try again later.',
        code: StatusCodes.TOO_MANY_REQUESTS
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api', limiter);

    // Custom middleware
    this.app.use(requestLogger);
  }

  private initializeRoutes(): void {
    // Health check routes
    this.app.use('/health', healthRoutes);
    
    // Authentication routes
    this.app.use('/auth', authRoutes);
    
    // API Keys routes
    this.app.use('/keys', keysRoutes);
    
    // Proxy routes (should be before general API routes)
    this.app.use('/api', proxyRoutes);
    
    // Feedback routes
    this.app.use('/api', feedbackRoutes);
    
    // Cache Inspector routes
    this.app.use('/api', cacheInspectorRoutes);
    
    // Intent Trends routes
    this.app.use('/api', intentTrendsRoutes);
    
    // Templates routes
    this.app.use('/api', templatesRoutes);
    
    // Analytics routes
    this.app.use('/api', analyticsRoutes);
    
    // API routes (general API endpoints - should be last in /api namespace)
    this.app.use('/api', apiRoutes);

    // Root endpoint
    this.app.get('/', (_req: Request, res: Response) => {
      res.status(StatusCodes.OK).json({
        message: `${config.app.name} is running`,
        version: config.app.version,
        environment: config.env,
        timestamp: new Date().toISOString()
      });
    });

    // 404 handler
    this.app.all('*', (req: Request, _res: Response, next: NextFunction) => {
      const error = new AppError(
        `Route ${req.originalUrl} not found`,
        StatusCodes.NOT_FOUND
      );
      next(error);
    });
  }

  private initializeErrorHandling(): void {
    this.app.use(errorHandler);
  }

  public listen(): void {
    const port = config.port;
    this.app.listen(port, () => {
      logger.info(`🚀 ${config.app.name} v${config.app.version} started`);
      logger.info(`📡 Server running on port ${port} in ${config.env} mode`);
      logger.info(`🌍 Environment: ${config.env}`);
      if (config.env === 'development') {
        logger.info(`📋 Health check: http://localhost:${port}/health`);
        logger.info(`🔗 API docs: http://localhost:${port}/api`);
      }
    });
  }
}

export default App;
