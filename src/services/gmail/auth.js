import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';
import { getSecrets } from '../../utils/secretManager.js';

let oauth2Client = null;

export async function getGmailAuth() {
  try {
    if (oauth2Client) {
      return oauth2Client;
    }

    const secrets = await getSecrets();
    
    oauth2Client = new google.auth.OAuth2(
      secrets.GMAIL_CLIENT_ID,
      secrets.GMAIL_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      refresh_token: secrets.GMAIL_REFRESH_TOKEN
    });

    logger.info('Gmail OAuth2 client initialized successfully');
    return oauth2Client;
  } catch (error) {
    logger.error('Failed to initialize Gmail OAuth2 client:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

export async function verifyGmailAccess() {
  try {
    const auth = await getGmailAuth();
    const gmail = google.gmail({ version: 'v1', auth });
    
    const profile = await gmail.users.getProfile({
      userId: 'me'
    });

    logger.info('Gmail access verified successfully', {
      email: profile.data.emailAddress,
      threadsTotal: profile.data.threadsTotal,
      historyId: profile.data.historyId
    });

    return profile.data;
  } catch (error) {
    logger.error('Failed to verify Gmail access:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}