import { logger } from '../../../utils/logger.js';
import { getPubSubClient } from '../client.js';
import { PUBSUB_CONFIG } from '../config.js';
import { recordMetric } from '../../../utils/monitoring.js';

class GmailPublisher {
  constructor() {
    this.topicName = `projects/${process.env.PROJECT_ID}/topics/${PUBSUB_CONFIG.topics.gmail}`;
    this.retrySettings = PUBSUB_CONFIG.retrySettings;
  }

  async initialize() {
    try {
      this.pubsub = await getPubSubClient();
      this.topic = this.pubsub.topic(this.topicName);
      
      logger.info('Gmail publisher initialized', {
        topic: this.topicName,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to initialize Gmail publisher:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Publish Gmail notification
   * @param {import('../types/gmail.js').GmailNotification} notification
   */
  async publish(notification) {
    try {
      if (!this.topic) {
        await this.initialize();
      }

      const data = Buffer.from(JSON.stringify(notification));
      const messageId = await this.topic.publish(data, {
        timestamp: new Date().toISOString()
      });

      logger.info('Gmail notification published', {
        messageId,
        emailAddress: notification.emailAddress,
        historyId: notification.historyId,
        timestamp: new Date().toISOString()
      });

      recordMetric('gmail_notifications_published', 1);
      return messageId;
    } catch (error) {
      logger.error('Failed to publish Gmail notification:', {
        error: error.message,
        stack: error.stack,
        emailAddress: notification.emailAddress,
        historyId: notification.historyId,
        timestamp: new Date().toISOString()
      });

      recordMetric('gmail_notifications_failed', 1);
      throw error;
    }
  }
}

export { GmailPublisher }