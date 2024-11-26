import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';
import { getGmailAuth } from './auth.js';

const gmail = google.gmail('v1');
const WATCH_EXPIRATION_BUFFER = 24 * 60 * 60 * 1000; // 24 hours before expiration

async function checkExistingWatch(auth) {
  try {
    const profile = await gmail.users.getProfile({
      auth,
      userId: 'me'
    });
    
    return !!profile.data.historyId;
  } catch (error) {
    logger.error('Error checking existing watch:', error);
    return false;
  }
}

export async function setupGmailWatch() {
  try {
    const auth = await getGmailAuth();
    
    // First verify access
    const profile = await gmail.users.getProfile({
      auth,
      userId: 'me'
    });
    
    logger.info('Gmail profile verified', {
      email: profile.data.emailAddress,
      historyId: profile.data.historyId
    });

    // Check if we have an active watch
    const hasActiveWatch = await checkExistingWatch(auth);

    if (hasActiveWatch) {
      logger.info('Active watch exists, checking expiration');
      
      // Get current watch details
      const watchDetails = await gmail.users.watch({
        auth,
        userId: 'me',
        requestBody: {
          topicName: `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`,
          labelIds: ['INBOX']
        }
      });

      const expirationTime = parseInt(watchDetails.data.expiration);
      const now = Date.now();

      // If watch expires in less than 24 hours, renew it
      if (expirationTime - now < WATCH_EXPIRATION_BUFFER) {
        logger.info('Watch expiring soon, stopping existing watch');
        try {
          await gmail.users.stop({
            auth,
            userId: 'me'
          });
        } catch (error) {
          logger.info('No existing watch to stop');
        }
      } else {
        logger.info('Watch is still valid', {
          expiresIn: Math.floor((expirationTime - now) / (60 * 60 * 1000)) + ' hours'
        });
        return watchDetails.data;
      }
    }

    // Set up new watch
    const watchResponse = await gmail.users.watch({
      auth,
      userId: 'me',
      requestBody: {
        topicName: `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`,
        labelIds: ['INBOX'],
        labelFilterAction: 'include'
      }
    });

    logger.info('Watch setup complete', {
      historyId: watchResponse.data.historyId,
      expiration: new Date(parseInt(watchResponse.data.expiration)).toISOString()
    });

    return watchResponse.data;
  } catch (error) {
    logger.error('Watch setup failed:', error);
    throw error;
  }
}

export async function renewWatch() {
  try {
    logger.info('Starting watch renewal process');
    await setupGmailWatch();
    logger.info('Watch renewed successfully');
  } catch (error) {
    logger.error('Watch renewal failed:', error);
    throw error;
  }
}