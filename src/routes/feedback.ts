import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { StatusCodes } from 'http-status-codes';
import { validateRequest } from '../middleware/validation';
import { TokenValidator } from '../utils/tokenValidator';
import { NotificationService } from '../utils/notificationService';
import { redisService } from '../utils/redisService';
import { logger } from '../utils/logger';

const router = Router();

interface FeedbackEntry {
  id: string;
  timestamp: string;
  userId: string;
  intent: string;
  matched_template: string;
  feedback_type: string;
  rating: number;
  comments: string;
  user_agent?: string;
  ip_address?: string;
}

/**
 * Feedback API for LLM fine-tuning and match quality improvement
 */
router.post('/feedback',
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
    body('matched_template')
      .notEmpty()
      .withMessage('Matched template is required')
      .isLength({ min: 1, max: 100 })
      .withMessage('Matched template must be between 1 and 100 characters'),
    body('feedback_type')
      .notEmpty()
      .withMessage('Feedback type is required')
      .isIn(['match_accuracy', 'output_quality', 'performance', 'cache_usage'])
      .withMessage('Feedback type must be one of: match_accuracy, output_quality, performance, cache_usage'),
    body('rating')
      .isInt({ min: 1, max: 5 })
      .withMessage('Rating must be between 1 and 5'),
    body('comments')
      .optional()
      .isLength({ min: 0, max: 1000 })
      .withMessage('Comments must be less than 1000 characters'),
  ]),
  async (req: Request, res: Response) => {
    const startTime = Date.now();
    let userId: string = '';

    try {
      const { 
        token, 
        intent, 
        matched_template, 
        feedback_type, 
        rating, 
        comments = '' 
      } = req.body;

      logger.info('Feedback API request received', {
        requestId: req.requestId,
        feedback_type,
        rating,
        matched_template,
        intent: intent.substring(0, 50) + (intent.length > 50 ? '...' : ''),
        hasComments: comments.length > 0
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

      // Step 2: Create feedback entry
      const feedbackId = `fb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const feedbackEntry: FeedbackEntry = {
        id: feedbackId,
        timestamp: new Date().toISOString(),
        userId,
        intent,
        matched_template,
        feedback_type,
        rating,
        comments,
        user_agent: req.get('User-Agent') || 'unknown',
        ip_address: req.ip || 'unknown'
      };

      // Step 3: Store in user-specific feedback list
      const feedbackKey = `feedback:${userId}`;
      try {
        await redisService.lpush(feedbackKey, JSON.stringify(feedbackEntry));
        
        // Keep only last 500 feedback entries per user
        await redisService.ltrim(feedbackKey, 0, 499);
        
        // Set TTL for feedback data (30 days)
        await redisService.expire(feedbackKey, 2592000);
      } catch (storageError) {
        logger.error('Failed to store feedback in Redis:', storageError);
      }

      // Step 4: Log to feedback stream for analytics using Redis Streams
      try {
        const feedbackStreamKey = `stream:feedback:${userId}`;
        await redisService.xadd(feedbackStreamKey, '*', {
          event: 'feedback_received',
          feedback_id: feedbackId,
          feedback_type,
          rating: rating.toString(),
          template: matched_template,
          intent_length: intent.length.toString(),
          has_comments: comments.length > 0 ? 'true' : 'false',
          timestamp: feedbackEntry.timestamp,
          processing_time_ms: (Date.now() - startTime).toString()
        });

        // Set TTL on the feedback stream (7 days)
        await redisService.expire(feedbackStreamKey, 604800);
      } catch (streamError) {
        logger.warn('Failed to log to feedback stream:', streamError);
      }

      // Step 5: Send notification confirming feedback received
      try {
        await NotificationService.addNotification(userId, {
          type: 'success',
          message: `📝 Feedback received: ${feedback_type} (${rating}/5)`,
          timestamp: Date.now(),
          details: {
            feedback_id: feedbackId,
            feedback_type,
            rating,
            template: matched_template
          }
        });
      } catch (notificationError) {
        logger.warn('Failed to send feedback notification:', notificationError);
      }

      // Step 6: Aggregate feedback for analytics (optional)
      try {
        const aggregateKey = `feedback:aggregate:${feedback_type}`;
        const aggregateData = {
          total_count: 1,
          rating_sum: rating,
          last_updated: new Date().toISOString(),
          template: matched_template
        };

        // Store or update aggregate
        const existingAggregate = await redisService.get(aggregateKey);
        if (existingAggregate) {
          const existing = JSON.parse(existingAggregate);
          aggregateData.total_count = existing.total_count + 1;
          aggregateData.rating_sum = existing.rating_sum + rating;
        }

        await redisService.set(aggregateKey, JSON.stringify(aggregateData), 86400); // 24 hour TTL
      } catch (aggregateError) {
        logger.warn('Failed to update feedback aggregates:', aggregateError);
      }

      // Step 7: Response
      const response = {
        success: true,
        message: 'Thanks for your feedback! It helps improve the system.',
        feedback_id: feedbackId,
        timestamp: feedbackEntry.timestamp,
        processing_time_ms: Date.now() - startTime,
        analytics: {
          feedback_type,
          rating,
          matched_template,
          stored: true,
          notification_sent: true
        }
      };

      logger.info(`Feedback processed successfully for user ${userId}`, {
        requestId: req.requestId,
        feedback_id: feedbackId,
        feedback_type,
        rating,
        template: matched_template
      });

      res.status(StatusCodes.CREATED).json(response);

    } catch (error) {
      logger.error('Feedback API error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        requestId: req.requestId,
        userId
      });

      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        message: 'An error occurred while processing your feedback',
        requestId: req.requestId
      });
    }
  }
);

/**
 * Get feedback statistics for a user (development endpoint)
 */
router.get('/feedback-stats',
  validateRequest([
    body('token')
      .notEmpty()
      .withMessage('Token is required')
      .isLength({ min: 8, max: 100 })
      .withMessage('Token must be between 8 and 100 characters'),
  ]),
  async (req: Request, res: Response) => {
    try {
      const { token } = req.query;

      if (!token || typeof token !== 'string') {
        res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          error: 'Token is required in query parameters'
        });
        return;
      }

      // Validate Token
      const tokenValidation = await TokenValidator.validateToken(token);
      if (!tokenValidation.isValid) {
        res.status(StatusCodes.UNAUTHORIZED).json({
          success: false,
          error: 'Invalid or expired token',
          message: tokenValidation.error
        });
        return;
      }

      const userId = tokenValidation.userId!;

      // Get user feedback entries
      const feedbackKey = `feedback:${userId}`;
      const feedbackEntries = await redisService.lrange(feedbackKey, 0, -1);

      const parsedFeedback = feedbackEntries.map(entry => {
        try {
          return JSON.parse(entry);
        } catch {
          return null;
        }
      }).filter(Boolean) as FeedbackEntry[];

      // Calculate statistics
      const stats = {
        total_feedback: parsedFeedback.length,
        feedback_by_type: {} as Record<string, number>,
        feedback_by_template: {} as Record<string, number>,
        average_rating_by_type: {} as Record<string, number>,
        recent_feedback: parsedFeedback.slice(0, 10), // Last 10 entries
        rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<number, number>
      };

      // Process feedback data
      for (const feedback of parsedFeedback) {
        // Count by type
        stats.feedback_by_type[feedback.feedback_type] = 
          (stats.feedback_by_type[feedback.feedback_type] || 0) + 1;

        // Count by template
        stats.feedback_by_template[feedback.matched_template] = 
          (stats.feedback_by_template[feedback.matched_template] || 0) + 1;

        // Rating distribution
        stats.rating_distribution[feedback.rating] = 
          (stats.rating_distribution[feedback.rating] || 0) + 1;
      }

      // Calculate average ratings by type
      for (const type of Object.keys(stats.feedback_by_type)) {
        const typeFeedback = parsedFeedback.filter(f => f.feedback_type === type);
        const totalRating = typeFeedback.reduce((sum, f) => sum + f.rating, 0);
        stats.average_rating_by_type[type] = 
          typeFeedback.length > 0 ? Math.round((totalRating / typeFeedback.length) * 100) / 100 : 0;
      }

      res.status(StatusCodes.OK).json({
        success: true,
        user_id: userId,
        timestamp: new Date().toISOString(),
        statistics: stats
      });

    } catch (error) {
      logger.error('Feedback stats error:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        requestId: req.requestId
      });

      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: 'Internal server error',
        message: 'An error occurred while retrieving feedback statistics'
      });
    }
  }
);

export default router;
