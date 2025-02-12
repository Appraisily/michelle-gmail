import { logger } from '../../../utils/logger.js';
import { getPubSubClient } from '../client.js';
import { PUBSUB_CONFIG } from '../config.js';
import { recordMetric } from '../../../utils/monitoring.js';

export class GmailSubscriber {
  constructor() {
    this.subscriptionName = `projects/${process.env.PROJECT_ID}/subscriptions/${PUBSUB_CONFIG.subscriptions.gmail}`;
  }

  async initialize() {
    try {
      this.pubsub = await getPubSubClient();
      this.subscription = this.pubsub.subscription(this.subscriptionName);
      
      logger.info('Gmail subscriber initialized', {
        subscription: this.subscriptionName,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to initialize Gmail subscriber:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Start listening for Gmail notifications
   * @param {Function} messageHandler Message handler function
   */
  async listen(messageHandler) {
    try {
      if (!this.subscription) {
        await this.initialize();
      }

      this.subscription.on('message', async (message) => {
        const startTime = Date.now();
        
        try {
          const data = JSON.parse(message.data.toString());
          
          logger.info('Processing Gmail notification', {
            messageId: message.id,
            emailAddress: data.emailAddress,
            historyId: data.historyId,
            timestamp: new Date().toISOString()
          });

          await messageHandler(data);
          message.ack();

          const duration = Date.now() - startTime;
          recordMetric('gmail_notifications_processed', 1);
          recordMetric('gmail_processing_duration', duration);

          logger.info('Gmail notification processed', {
            messageId: message.id,
            duration,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          logger.error('Error processing Gmail notification:', {
            error: error.message,
            stack: error.stack,
            messageId: message.id,
            timestamp: new Date().toISOString()
          });

          recordMetric('gmail_processing_errors', 1);
          message.nack();
        }
      });

      this.subscription.on('error', (error) => {
        logger.error('Gmail subscription error:', {
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        });
        recordMetric('gmail_subscription_errors', 1);
      });

      logger.info('Started listening for Gmail notifications', {
        subscription: this.subscriptionName,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to start Gmail listener:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Stop listening for messages
   */
  async close() {
    if (this.subscription) {
      await this.subscription.close();
      logger.info('Gmail subscriber closed', {
        subscription: this.subscriptionName,
        timestamp: new Date().toISOString()
      });
    }
  }
}