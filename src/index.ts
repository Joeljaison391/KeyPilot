import App from './app';
import { logger } from './utils/logger';
import { config } from './config/config';

// Handle uncaught exceptions
process.on('uncaughtException', (err: Error) => {
  logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...', err);
  process.exit(1);
});

// Create and start the application
const app = new App();

const server = app.app.listen(config.port, () => {
  logger.info(`🚀 ${config.app.name} v${config.app.version} started`);
  logger.info(`📡 Server running on port ${config.port} in ${config.env} mode`);
  logger.info(`🌍 Environment: ${config.env}`);
  if (config.env === 'development') {
    logger.info(`📋 Health check: http://localhost:${config.port}/health`);
    logger.info(`🔗 API docs: http://localhost:${config.port}/api`);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
  logger.error('UNHANDLED REJECTION! 💥 Shutting down...', err);
  server.close(() => {
    process.exit(1);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('👋 SIGTERM RECEIVED. Shutting down gracefully');
  server.close(() => {
    logger.info('💥 Process terminated!');
  });
});

process.on('SIGINT', () => {
  logger.info('👋 SIGINT RECEIVED. Shutting down gracefully');
  server.close(() => {
    logger.info('💥 Process terminated!');
  });
});
