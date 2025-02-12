import { logger } from '../../../utils/logger.js';
import { getPubSubClient } from '../client.js';
import { PUBSUB_CONFIG } from '../config.js';
import { recordMetric } from '../../../utils/monitoring.js';

export class CRMSubscriber {
  constructor() {
    this.subscriptionName = `projects/${process.env.PROJECT_ID}/subscriptions/${PUBSUB_CONFIG.subscriptions.crm}`;
  }

  async initialize() {
    try {
      this.pubsub = await getPubSubClient();
      this.subscription = this.pubsub.subscription(this.subscriptionName);
      
      logger.info('CRM subscriber initialized', {
        subscription: this.subscriptionName,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to initialize CRM subscriber:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Start listening for CRM messages
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
          
          logger.info('Processing CRM message', {
            messageId: message.id,
            type: data.type,
            source: data.source,
            timestamp: new Date().toISOString()
          });

          await messageHandler(data);
          message.ack();

          const duration = Date.now() - startTime;
          recordMetric('crm_messages_processed', 1);
          recordMetric('crm_processing_duration', duration);

          logger.info('CRM message processed', {
            messageId: message.id,
            duration,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          logger.error('Error processing CRM message:', {
            error: error.message,
            stack: error.stack,
            messageId: message.id,
            timestamp: new Date().toISOString()
          });

          recordMetric('crm_processing_errors', 1);
          message.nack();
        }
      });

      this.subscription.on('error', (error) => {
        logger.error('CRM subscription error:', {
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        });
        recordMetric('crm_subscription_errors', 1);
      });

      logger.info('Started listening for CRM messages', {
        subscription: this.subscriptionName,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to start CRM listener:', {
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
      logger.info('CRM subscriber closed', {
        subscription: this.subscriptionName,
        timestamp: new Date().toISOString()
      });
    }
  }
}