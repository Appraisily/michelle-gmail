import { PubSub } from '@google-cloud/pubsub';
import { logger } from '../../utils/logger.js';

let pubsubClient = null;

export async function getPubSubClient() {
  if (!pubsubClient) {
    try {
      pubsubClient = new PubSub({
        projectId: process.env.PROJECT_ID
      });
      
      logger.info('PubSub client initialized');
    } catch (error) {
      logger.error('Failed to initialize PubSub client:', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  return pubsubClient;
}