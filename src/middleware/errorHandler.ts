import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { logger } from '../utils/logger';
import { AppError } from '../utils/AppError';
import { config } from '../config/config';

interface ErrorResponse {
  error: {
    message: string;
    code: number;
    status: string;
    timestamp: string;
    path: string;
    stack?: string;
  };
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let error = { ...err } as AppError;
  error.message = err.message;

  // Log error
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = new AppError(message, StatusCodes.NOT_FOUND);
  }

  // Mongoose duplicate key
  if (err.name === 'MongoError' && (err as any).code === 11000) {
    const message = 'Duplicate field value entered';
    error = new AppError(message, StatusCodes.BAD_REQUEST);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values((err as any).errors).map((val: any) => val.message).join(', ');
    error = new AppError(message, StatusCodes.BAD_REQUEST);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token. Please log in again!';
    error = new AppError(message, StatusCodes.UNAUTHORIZED);
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Your token has expired! Please log in again.';
    error = new AppError(message, StatusCodes.UNAUTHORIZED);
  }

  const errorResponse: ErrorResponse = {
    error: {
      message: error.message || 'Something went wrong',
      code: error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
      status: 'error',
      timestamp: new Date().toISOString(),
      path: req.path,
    },
  };

  // Include stack trace in development
  if (config.env === 'development' && error.stack) {
    errorResponse.error.stack = error.stack;
  }

  res.status(error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR).json(errorResponse);
};
