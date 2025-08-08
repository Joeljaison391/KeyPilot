import { Request, Response, NextFunction } from 'express';
import { TokenValidator } from '../utils/tokenValidator';
import { AppError } from '../utils/AppError';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        [key: string]: any;
      };
    }
  }
}

export const validateToken = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      throw new AppError('Authorization header missing', 401);
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new AppError('Bearer token missing', 401);
    }

    const validationResult = await TokenValidator.validateToken(token);

    if (!validationResult.isValid || !validationResult.userId) {
      throw new AppError(validationResult.error || 'Invalid token', 401);
    }

    req.user = {
      id: validationResult.userId
    };

    next();
  } catch (error) {
    next(error);
  }
};
