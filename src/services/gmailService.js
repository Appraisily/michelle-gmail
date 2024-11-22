import { google } from 'googleapis';
import { classifyAndProcessEmail } from './openaiService.js';
import { logEmailProcessing } from './sheetsService.js';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';
import { recordMetric } from '../utils/monitoring.js';

const gmail = google.gmail('v1');
const WATCH_EXPIRATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

let auth = null;

async function getGmailAuth() {
  if (!auth) {
    const secrets = await getSecrets();
    const oauth2Client = new google.auth.OAuth2(
      secrets.GMAIL_CLIENT_ID,
      secrets.GMAIL_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: secrets.GMAIL_REFRESH_TOKEN
    });

    // Verify the credentials work
    try {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      await gmail.users.getProfile({ userId: 'me' });
      logger.info('Gmail credentials verified successfully');
    } catch (error) {
      logger.error('Gmail credentials verification failed:', error);
      throw new Error('Gmail authentication failed');
    }

    auth = oauth2Client;
    logger.info('Gmail authentication initialized successfully');
  }
  return auth;
}

async function stopExistingWatch() {
  try {
    const auth = await getGmailAuth();
    await gmail.users.stop({
      userId: 'me',
      auth
    });
    logger.info('Stopped existing Gmail watch');
  } catch (error) {
    // If no watch exists, that's fine
    if (error.code === 404) {
      logger.info('No existing Gmail watch to stop');
    } else {
      logger.warn('Error stopping existing Gmail watch:', error);
    }
  }
}

export async function renewGmailWatch() {
  try {
    logger.info('Starting Gmail watch renewal process...');
    const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;
    logger.info(`Using Pub/Sub topic: ${topicName}`);
    
    const auth = await getGmailAuth();
    
    // First, check current Gmail profile
    try {
      const profile = await gmail.users.getProfile({
        auth,
        userId: 'me'
      });
      logger.info(`Current Gmail profile historyId: ${profile.data.historyId}`);
    } catch (error) {
      logger.error('Error fetching Gmail profile:', error);
      throw error;
    }

    // Stop any existing watch
    await stopExistingWatch();

    // Set up new watch
    const response = await gmail.users.watch({
      auth,
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
        labelFilterAction: 'include'
      }
    });
    
    const expirationDate = new Date(parseInt(response.data.expiration));
    logger.info('Gmail watch renewed successfully', { 
      historyId: response.data.historyId,
      expiration: expirationDate.toISOString(),
      topicName
    });

    // Verify the watch was set up
    try {
      const labels = await gmail.users.labels.list({
        auth,
        userId: 'me'
      });
      logger.info('Gmail labels verified:', labels.data.labels.map(l => l.name));
    } catch (error) {
      logger.error('Error verifying Gmail labels:', error);
    }

    recordMetric('gmail_watch_renewals', 1);
    return response.data;
  } catch (error) {
    logger.error('Error renewing Gmail watch:', {
      error: error.message,
      code: error.code,
      details: error.response?.data || 'No additional details'
    });
    recordMetric('gmail_watch_renewal_failures', 1);
    throw error;
  }
}

// Rest of the file remains unchanged...