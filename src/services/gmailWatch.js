import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { recordMetric } from '../utils/monitoring.js';
import { initializeGmailAuth } from './gmailAuth.js';

const gmail = google.gmail('v1');

export async function setupGmailWatch() {
  try {
    const auth = await initializeGmailAuth();
    const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;

    logger.info('Starting Gmail watch setup:', {
      topicName,
      email: 'info@appraisily.com'
    });

    // Stop any existing watch
    try {
      await gmail.users.stop({
        auth,
        userId: 'me'
      });
      logger.info('Stopped existing watch');
    } catch (error) {
      // Ignore if no watch exists
      if (!error.message.includes('No watch exists')) {
        throw error;
      }
    }

    // Set up new watch
    const watchResponse = await gmail.users.watch({
      auth,
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
        labelFilterBehavior: 'INCLUDE'
      }
    });

    if (!watchResponse.data || !watchResponse.data.historyId) {
      throw new Error('Invalid watch response');
    }

    logger.info('Gmail watch established:', {
      historyId: watchResponse.data.historyId,
      expiration: watchResponse.data.expiration,
      email: 'info@appraisily.com',
      response: JSON.stringify(watchResponse.data)
    });

    recordMetric('gmail_watch_renewals', 1);
    return watchResponse.data;
  } catch (error) {
    logger.error('Failed to setup Gmail watch:', error);
    recordMetric('gmail_watch_renewal_failures', 1);
    throw error;
  }
}