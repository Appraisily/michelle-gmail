import { google } from 'googleapis';
import { classifyAndProcessEmail } from './openaiService.js';
import { logEmailProcessing } from './sheetsService.js';
import { logger } from '../utils/logger.js';
import { getSecrets } from '../utils/secretManager.js';
import { recordMetric } from '../utils/monitoring.js';

const gmail = google.gmail('v1');
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

async function verifyPubSubTopic() {
  const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;
  try {
    // Try to send a test message to verify permissions
    const auth = await getGmailAuth();
    await gmail.users.watch({
      auth,
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
        labelFilterAction: 'include'
      }
    });
    logger.info('Pub/Sub topic verification successful');
    return true;
  } catch (error) {
    logger.error('Pub/Sub topic verification failed:', {
      error: error.message,
      code: error.code,
      details: error.response?.data || 'No additional details'
    });
    return false;
  }
}

async function stopExistingWatch() {
  try {
    const auth = await getGmailAuth();
    await gmail.users.stop({
      userId: 'me',
      auth
    });
    logger.info('Stopped existing Gmail watch');
    // Wait a moment to ensure the stop takes effect
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (error) {
    // If no watch exists, that's fine
    if (error.code === 404) {
      logger.info('No existing Gmail watch to stop');
    } else {
      logger.warn('Error stopping existing Gmail watch:', error);
    }
  }
}

async function setupNewWatch() {
  const auth = await getGmailAuth();
  const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;

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
  logger.info('Gmail watch setup successful', {
    historyId: response.data.historyId,
    expiration: expirationDate.toISOString(),
    topicName
  });

  return response.data;
}

async function verifyWatchSetup() {
  try {
    const auth = await getGmailAuth();
    const response = await gmail.users.getProfile({
      auth,
      userId: 'me'
    });
    
    if (response.data.historyId) {
      logger.info('Watch setup verified successfully', {
        historyId: response.data.historyId
      });
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Watch setup verification failed:', error);
    return false;
  }
}

export async function renewGmailWatch() {
  try {
    logger.info('Starting Gmail watch renewal process...');
    const topicName = `projects/${process.env.PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`;
    logger.info(`Using Pub/Sub topic: ${topicName}`);

    // Step 1: Verify Pub/Sub permissions
    const pubsubVerified = await verifyPubSubTopic();
    if (!pubsubVerified) {
      throw new Error('Failed to verify Pub/Sub topic permissions');
    }

    // Step 2: Stop existing watch
    await stopExistingWatch();

    // Step 3: Set up new watch
    const watchData = await setupNewWatch();
    
    // Step 4: Verify watch setup
    const watchVerified = await verifyWatchSetup();
    if (!watchVerified) {
      throw new Error('Failed to verify watch setup');
    }

    recordMetric('gmail_watch_renewals', 1);
    return watchData;
  } catch (error) {
    logger.error('Error in Gmail watch renewal:', {
      error: error.message,
      code: error.code,
      details: error.response?.data || 'No additional details'
    });
    recordMetric('gmail_watch_renewal_failures', 1);
    throw error;
  }
}

// ... rest of the file remains unchanged ...