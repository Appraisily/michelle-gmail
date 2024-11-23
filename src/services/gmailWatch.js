import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { recordMetric } from '../utils/monitoring.js';
import { initializeGmailAuth } from './gmailAuth.js';

const gmail = google.gmail('v1');
let watchExpiration = null;

export async function stopExistingWatch() {
  try {
    const auth = await initializeGmailAuth();
    await gmail.users.stop({
      auth,
      userId: 'me'
    });
    logger.info('Stopped existing Gmail watch');
    watchExpiration = null;
  } catch (error) {
    if (!error.message.includes('No watch exists')) {
      logger.warn('Error stopping existing watch:', { error: error.message });
    }
  }
}

export async function setupGmailWatch() {
  try {
    const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;
    
    logger.info('Starting Gmail watch setup...', {
      email: 'info@appraisily.com',
      topicName,
      projectId: process.env.PROJECT_ID
    });

    const auth = await initializeGmailAuth();
    
    // Stop any existing watch first
    await stopExistingWatch();

    // Set up the watch request
    const watchRequest = {
      auth,
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX', 'UNREAD'],
        labelFilterBehavior: 'INCLUDE',
      }
    };

    logger.info('Sending watch request', {
      request: JSON.stringify(watchRequest.requestBody)
    });

    const watchResponse = await gmail.users.watch(watchRequest);

    if (!watchResponse.data || !watchResponse.data.historyId) {
      throw new Error('Invalid watch response: No historyId received');
    }

    watchExpiration = watchResponse.data.expiration;

    logger.info('Gmail watch setup successful', {
      historyId: watchResponse.data.historyId,
      expiration: new Date(parseInt(watchExpiration)).toISOString(),
      email: 'info@appraisily.com',
      watchData: JSON.stringify(watchResponse.data)
    });

    // Verify the watch was set up correctly
    const profile = await gmail.users.getProfile({
      auth,
      userId: 'me'
    });

    logger.info('Gmail profile after watch setup', {
      email: profile.data.emailAddress,
      historyId: profile.data.historyId,
      messagesTotal: profile.data.messagesTotal,
      threadsTotal: profile.data.threadsTotal
    });

    recordMetric('gmail_watch_renewals', 1);
    return watchResponse.data;
  } catch (error) {
    logger.error('Failed to setup Gmail watch:', {
      error: error.message,
      stack: error.stack,
      topicName: `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`
    });
    recordMetric('gmail_watch_renewal_failures', 1);
    throw error;
  }
}

export function getWatchExpiration() {
  return watchExpiration;
}

export function isWatchExpiringSoon() {
  if (!watchExpiration) {
    return true;
  }
  // Return true if watch expires in less than 24 hours
  return Date.now() > parseInt(watchExpiration) - 24 * 60 * 60 * 1000;
}