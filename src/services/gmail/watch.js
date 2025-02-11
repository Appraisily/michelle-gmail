import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';
import { getGmailAuth } from './auth.js';

const gmail = google.gmail('v1');
const WATCH_EXPIRATION_BUFFER = 24 * 60 * 60 * 1000; // 24 hours
const WATCH_RENEWAL_INTERVAL = 6 * 60 * 60 * 1000;  // 6 hours
const FORCE_RENEWAL_ON_STARTUP = true;

async function stopExistingWatch(auth) {
  try {
    logger.info('Attempting to stop existing Gmail watch');
    
    await gmail.users.stop({
      auth,
      userId: 'me'
    });

    logger.info('Successfully stopped existing Gmail watch');
    return true;
  } catch (error) {
    // If error is 404, it means no watch exists, which is fine
    if (error.code === 404) {
      logger.info('No existing Gmail watch to stop');
      return true;
    }
    logger.error('Error stopping Gmail watch:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

async function createNewWatch(auth) {
  try {
    logger.info('Creating new Gmail watch');

    const watchResponse = await gmail.users.watch({
      auth,
      userId: 'me',
      requestBody: {
        topicName: `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`,
        labelIds: ['INBOX'],
        labelFilterAction: 'include'
      }
    });

    const expirationDate = new Date(parseInt(watchResponse.data.expiration));
    logger.info('Gmail watch created successfully', {
      historyId: watchResponse.data.historyId,
      expiration: expirationDate.toISOString(),
      expiresIn: Math.floor((expirationDate - Date.now()) / (60 * 60 * 1000)) + ' hours'
    });

    return watchResponse.data;
  } catch (error) {
    logger.error('Error creating Gmail watch:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

export async function setupGmailWatch() {
  try {
    const auth = await getGmailAuth();
    
    // First verify Gmail access
    const profile = await gmail.users.getProfile({
      auth,
      userId: 'me'
    });
    
    logger.info('Gmail profile verified', {
      email: profile.data.emailAddress,
      historyId: profile.data.historyId
    });

    // On startup, force stop any existing watch if configured
    if (FORCE_RENEWAL_ON_STARTUP) {
      logger.info('Forcing Gmail watch renewal during startup');
      await stopExistingWatch(auth);
    }

    // Create new watch
    const watchData = await createNewWatch(auth);

    return watchData;
  } catch (error) {
    logger.error('Gmail watch setup failed:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

export async function renewWatch() {
  try {
    logger.info('Starting Gmail watch renewal process');
    const auth = await getGmailAuth();

    // Always stop existing watch before renewal
    await stopExistingWatch(auth);

    // Create new watch
    const watchData = await createNewWatch(auth);
    
    logger.info('Gmail watch renewed successfully', {
      historyId: watchData.historyId,
      expiration: new Date(parseInt(watchData.expiration)).toISOString()
    });

    return watchData;
  } catch (error) {
    logger.error('Gmail watch renewal failed:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}