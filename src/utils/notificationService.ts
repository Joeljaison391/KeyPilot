import { redisService } from './redisService';
import { logger } from './logger';

interface NotificationMessage {
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  timestamp: number;
  details?: any;
}

interface StreamEvent {
  event: string;
  user: string;
  timestamp: string;
  [key: string]: any;
}

export class NotificationService {
  private static readonly NOTIFICATION_PREFIX = 'notifications';
  private static readonly STREAM_PREFIX = 'stream:logs';
  private static readonly CHANNEL_PREFIX = 'channel:request';
  private static readonly NOTIFICATION_TTL = 86400; // 24 hours

  /**
   * Add a notification for a user using Redis Streams
   */
  static async addNotification(userId: string, notification: NotificationMessage): Promise<void> {
    try {
      const notificationStreamKey = `${this.NOTIFICATION_PREFIX}:stream:${userId}`;
      
      // Add to Redis Stream with auto-generated ID
      await redisService.xadd(notificationStreamKey, '*', {
        type: notification.type,
        message: notification.message,
        timestamp: notification.timestamp.toString(),
        details: notification.details ? JSON.stringify(notification.details) : ''
      });

      // Set TTL on the stream
      await redisService.expire(notificationStreamKey, this.NOTIFICATION_TTL);

      logger.info(`Added notification for user ${userId}`, {
        type: notification.type,
        message: notification.message.substring(0, 50)
      });

    } catch (error) {
      logger.error('Failed to add notification:', error);
    }
  }

  /**
   * Get notifications for a user from Redis Streams
   */
  static async getUserNotifications(userId: string, limit = 20): Promise<NotificationMessage[]> {
    try {
      const notificationStreamKey = `${this.NOTIFICATION_PREFIX}:stream:${userId}`;
      
      // Read from Redis Stream (latest entries first)
      const streamEntries = await redisService.xrange(notificationStreamKey, '-', '+', limit);
      
      return streamEntries
        .map(entry => {
          try {
            const fields = entry.message || entry[1]; // Redis stream entry format
            return {
              type: fields.type as 'info' | 'warning' | 'error' | 'success',
              message: fields.message,
              timestamp: parseInt(fields.timestamp),
              details: fields.details ? JSON.parse(fields.details) : undefined
            } as NotificationMessage;
          } catch {
            return null;
          }
        })
        .filter((notif): notif is NotificationMessage => notif !== null)
        .reverse() // Most recent first
        .slice(0, limit);

    } catch (error) {
      logger.error('Failed to get user notifications from stream:', error);
      return [];
    }
  }

  /**
   * Stream an event to user logs
   */
  static async streamEvent(userId: string, event: StreamEvent): Promise<void> {
    try {
      const streamKey = `${this.STREAM_PREFIX}:${userId}`;
      
      // Add to Redis Stream
      await redisService.xadd(streamKey, '*', {
        event: event.event,
        user: event.user,
        timestamp: event.timestamp,
        data: JSON.stringify(event)
      });

      logger.debug(`Streamed event for user ${userId}`, {
        event: event.event
      });

    } catch (error) {
      logger.error('Failed to stream event:', error);
    }
  }

  /**
   * Publish real-time event to channel
   */
  static async publishRealtimeEvent(eventType: string, data: any): Promise<void> {
    try {
      const channel = `${this.CHANNEL_PREFIX}:${eventType}`;
      await redisService.publish(channel, JSON.stringify(data));

      logger.debug(`Published real-time event to ${channel}`);

    } catch (error) {
      logger.error('Failed to publish real-time event:', error);
    }
  }

  /**
   * Stream request received event
   */
  static async streamRequestReceived(userId: string, intent: string, origin?: string): Promise<void> {
    const event: StreamEvent = {
      event: 'request:received',
      user: userId,
      intent,
      timestamp: new Date().toISOString(),
      origin
    };

    await this.streamEvent(userId, event);
    await this.publishRealtimeEvent('received', event);
  }

  /**
   * Stream request completed event
   */
  static async streamRequestCompleted(
    userId: string,
    intent: string,
    template: string,
    confidence: number,
    cached: boolean,
    latencyMs: number,
    tokensUsed: number
  ): Promise<void> {
    const event: StreamEvent = {
      event: 'request:completed',
      user: userId,
      intent,
      template,
      confidence,
      cached,
      latency_ms: latencyMs,
      tokens_used: tokensUsed,
      timestamp: new Date().toISOString()
    };

    await this.streamEvent(userId, event);
    await this.publishRealtimeEvent('completed', event);
  }

  /**
   * Add warning notification for intent rewriting fallback
   */
  static async notifyIntentRewritingFallback(userId: string): Promise<void> {
    const notification: NotificationMessage = {
      type: 'warning',
      message: 'Intent rewriting failed. Using original input.',
      timestamp: Date.now()
    };

    await this.addNotification(userId, notification);
  }

  /**
   * Add info notification for successful intent rewriting
   */
  static async notifyIntentRewritten(userId: string, originalIntent: string, rewrittenIntent: string): Promise<void> {
    const notification: NotificationMessage = {
      type: 'info',
      message: `✅ Rewritten intent: ${rewrittenIntent}`,
      timestamp: Date.now(),
      details: {
        original: originalIntent,
        rewritten: rewrittenIntent
      }
    };

    await this.addNotification(userId, notification);
  }

  /**
   * Add warning for near usage limits
   */
  static async notifyNearLimit(userId: string, template: string, limitType: string, percentage: number): Promise<void> {
    const notification: NotificationMessage = {
      type: 'warning',
      message: `⚠️ Near ${limitType} limit: ${percentage}% used for ${template}`,
      timestamp: Date.now(),
      details: {
        template,
        limitType,
        percentage
      }
    };

    await this.addNotification(userId, notification);
  }

  /**
   * Add error notification for template conflicts
   */
  static async notifyTemplateConflict(userId: string, intent: string, conflictingTemplates: string[]): Promise<void> {
    const notification: NotificationMessage = {
      type: 'warning',
      message: `🔄 Multiple templates match intent. Using best match.`,
      timestamp: Date.now(),
      details: {
        intent: intent.substring(0, 50),
        conflictingTemplates
      }
    };

    await this.addNotification(userId, notification);
  }

  /**
   * Add developer-friendly notification for semantic testing playground
   */
  static async notifyDeveloperTest(
    userId: string, 
    originalIntent: string, 
    rewrittenIntent: string, 
    matchedTemplate: string, 
    confidence: number
  ): Promise<void> {
    const notification: NotificationMessage = {
      type: 'info',
      message: `🧪 Semantic test completed: ${matchedTemplate} (${Math.round(confidence * 100)}%)`,
      timestamp: Date.now(),
      details: {
        original_intent: originalIntent.substring(0, 100),
        rewritten_intent: rewrittenIntent.substring(0, 100),
        matched_template: matchedTemplate,
        confidence,
        test_type: 'semantic_playground'
      }
    };

    await this.addNotification(userId, notification);
  }
}
