import { logger } from '../../../utils/logger.js';
import { getPubSubClient } from '../client.js';
import { PUBSUB_CONFIG } from '../config.js';
import { recordMetric } from '../../../utils/monitoring.js';

class CRMPublisher {
  constructor() {
    this.topicName = `projects/${process.env.PROJECT_ID}/topics/${PUBSUB_CONFIG.topics.crm}`;
    this.retrySettings = PUBSUB_CONFIG.retrySettings;
  }

  async initialize() {
    try {
      this.pubsub = await getPubSubClient();
      this.topic = this.pubsub.topic(this.topicName);
      
      logger.info('CRM publisher initialized', {
        topic: this.topicName,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to initialize CRM publisher:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Publish CRM message
   * @param {import('../types/crm.js').CRMMessage} message
   * @param {import('../types/crm.js').PublishOptions} [options]
   */
  async publish(message, options = {}) {
    try {
      if (!this.topic) {
        await this.initialize();
      }

      const data = Buffer.from(JSON.stringify(message));
      const messageId = await this.topic.publish(data, {
        ...options,
        timestamp: new Date().toISOString()
      });

      logger.info('CRM message published', {
        messageId,
        type: message.type,
        source: message.source,
        timestamp: new Date().toISOString()
      });

      recordMetric('crm_messages_published', 1);
      return messageId;
    } catch (error) {
      logger.error('Failed to publish CRM message:', {
        error: error.message,
        stack: error.stack,
        type: message.type,
        source: message.source,
        timestamp: new Date().toISOString()
      });

      recordMetric('crm_messages_failed', 1);
      throw error;
    }
  }

  /**
   * Publish batch of CRM messages
   * @param {Array<import('../types/crm.js').CRMMessage>} messages
   * @param {import('../types/crm.js').PublishOptions} [options]
   */
  async publishBatch(messages, options = {}) {
    try {
      if (!this.topic) {
        await this.initialize();
      }

      const publishPromises = messages.map(message => {
        const data = Buffer.from(JSON.stringify(message));
        return this.topic.publish(data, {
          ...options,
          timestamp: new Date().toISOString()
        });
      });

      const messageIds = await Promise.all(publishPromises);

      logger.info('Batch CRM messages published', {
        count: messages.length,
        messageIds,
        timestamp: new Date().toISOString()
      });

      recordMetric('crm_messages_published', messages.length);
      return messageIds;
    } catch (error) {
      logger.error('Failed to publish batch CRM messages:', {
        error: error.message,
        stack: error.stack,
        count: messages.length,
        timestamp: new Date().toISOString()
      });

      recordMetric('crm_messages_failed', messages.length);
      throw error;
    }
  }
}

export { CRMPublisher }