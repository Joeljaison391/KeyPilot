import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '../utils/AppError';

export const validateRequest = (validations: ValidationChain[]) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Run all validations
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    const extractedErrors: Array<{ field: string; message: string }> = [];
    errors.array().forEach(err => {
      if (err.type === 'field') {
        extractedErrors.push({ 
          field: err.path, 
          message: err.msg 
        });
      }
    });

    const errorMessage = extractedErrors
      .map(error => `${error.field}: ${error.message}`)
      .join(', ');

    next(new AppError(`Validation failed: ${errorMessage}`, StatusCodes.BAD_REQUEST));
  };
};

// Common validation middleware
export const validateJson = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.headers['content-type'] && 
      req.headers['content-type'].includes('application/json')) {
    try {
      if (req.body && typeof req.body === 'string') {
        req.body = JSON.parse(req.body);
      }
      next();
    } catch (error) {
      next(new AppError('Invalid JSON format', StatusCodes.BAD_REQUEST));
    }
  } else {
    next();
  }
};
