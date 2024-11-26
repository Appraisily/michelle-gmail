import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';
import { getGmailAuth } from './auth.js';

const gmail = google.gmail('v1');
const WATCH_EXPIRATION_BUFFER = 24 * 60 * 60 * 1000; // 24 hours before expiration

async function stopExistingWatch(auth) {
  try {
    logger.info('Attempting to stop existing watch');
    await gmail.users.stop({
      auth,
      userId: 'me'
    });
    logger.info('Successfully stopped existing watch');
    return true;
  } catch (error) {
    // If error is 404, it means no watch exists, which is fine
    if (error.code === 404) {
      logger.info('No existing watch to stop');
      return true;
    }
    logger.error('Error stopping existing watch:', error);
    return false;
  }
}

async function createNewWatch(auth) {
  try {
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
    logger.error('Error creating new watch:', error);
    throw error;
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

    // Always stop existing watch first
    const watchStopped = await stopExistingWatch(auth);
    if (!watchStopped) {
      throw new Error('Failed to stop existing watch');
    }

    // Create new watch
    return await createNewWatch(auth);
  } catch (error) {
    logger.error('Watch setup failed:', error);
    throw error;
  }
}

export async function renewWatch() {
  try {
    logger.info('Starting watch renewal process');
    const auth = await getGmailAuth();

    // Stop existing watch
    await stopExistingWatch(auth);

    // Create new watch
    const watchData = await createNewWatch(auth);
    
    logger.info('Watch renewed successfully', {
      historyId: watchData.historyId,
      expiration: new Date(parseInt(watchData.expiration)).toISOString()
    });

    return watchData;
  } catch (error) {
    logger.error('Watch renewal failed:', error);
    throw error;
  }
}