import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';

const gmail = google.gmail('v1');

async function getGmailAuth() {
  const secrets = await getSecrets();
  
  const auth = new google.auth.OAuth2(
    secrets.GMAIL_CLIENT_ID,
    secrets.GMAIL_CLIENT_SECRET
  );

  auth.setCredentials({
    refresh_token: secrets.GMAIL_REFRESH_TOKEN
  });

  return auth;
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

    // Stop existing watch if any
    try {
      await gmail.users.stop({
        auth,
        userId: 'me'
      });
      logger.info('Stopped existing watch');
    } catch (error) {
      // Ignore if no watch exists
      logger.info('No existing watch to stop');
    }

    // Set up new watch
    const watchResponse = await gmail.users.watch({
      auth,
      userId: 'me',
      requestBody: {
        topicName: `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`,
        labelIds: ['INBOX']
      }
    });

    logger.info('Watch setup complete', {
      historyId: watchResponse.data.historyId,
      expiration: watchResponse.data.expiration
    });

    return watchResponse.data;
  } catch (error) {
    logger.error('Watch setup failed:', error);
    throw error;
  }
}