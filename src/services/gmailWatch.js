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
      logger.warn('Error stopping existing watch:', { 
        error: error.message,
        stack: error.stack 
      });
    }
  }
}

export async function setupGmailWatch() {
  try {
    const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;
    
    logger.info('Setting up Gmail watch...', {
      email: 'info@appraisily.com',
      topicName,
      projectId: process.env.PROJECT_ID,
      env: process.env.NODE_ENV
    });

    const auth = await initializeGmailAuth();
    
    // First get current profile to check existing watch
    const profile = await gmail.users.getProfile({
      auth,
      userId: 'me'
    });

    logger.info('Retrieved Gmail profile:', {
      email: profile.data.emailAddress,
      historyId: profile.data.historyId,
      messagesTotal: profile.data.messagesTotal,
      threadsTotal: profile.data.threadsTotal,
      rawProfile: JSON.stringify(profile.data)
    });

    // Stop any existing watch
    await stopExistingWatch();

    // Set up the new watch request
    const watchRequest = {
      auth,
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX', 'UNREAD'],
        labelFilterBehavior: 'INCLUDE'
      }
    };

    logger.info('Initiating Gmail watch request:', {
      topicName,
      labelIds: watchRequest.requestBody.labelIds,
      labelFilterBehavior: watchRequest.requestBody.labelFilterBehavior
    });

    const watchResponse = await gmail.users.watch(watchRequest);

    logger.info('Raw watch response:', {
      response: JSON.stringify(watchResponse.data)
    });

    if (!watchResponse.data || !watchResponse.data.historyId) {
      throw new Error('Invalid watch response: No historyId received');
    }

    watchExpiration = watchResponse.data.expiration;

    logger.info('Gmail watch established:', {
      historyId: watchResponse.data.historyId,
      expiration: new Date(parseInt(watchExpiration)).toISOString(),
      email: 'info@appraisily.com',
      topicName,
      watchData: JSON.stringify(watchResponse.data)
    });

    // Verify the watch was set up correctly
    const verifyProfile = await gmail.users.getProfile({
      auth,
      userId: 'me'
    });

    logger.info('Verified Gmail profile after watch:', {
      email: verifyProfile.data.emailAddress,
      historyId: verifyProfile.data.historyId,
      messagesTotal: verifyProfile.data.messagesTotal,
      threadsTotal: verifyProfile.data.threadsTotal,
      rawProfile: JSON.stringify(verifyProfile.data)
    });

    // Test the watch by listing history
    const history = await gmail.users.history.list({
      auth,
      userId: 'me',
      startHistoryId: watchResponse.data.historyId,
      maxResults: 1
    });

    logger.info('Initial history verification:', {
      hasHistory: !!history.data.history,
      historyId: watchResponse.data.historyId,
      nextPageToken: history.data.nextPageToken,
      rawHistory: JSON.stringify(history.data)
    });

    recordMetric('gmail_watch_renewals', 1);
    return watchResponse.data;
  } catch (error) {
    logger.error('Gmail watch setup failed:', {
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