import { google } from 'googleapis';
import { logger } from '../../utils/logger.js';
import { getGmailAuth } from './auth.js';
import { processMessage } from './message.js';

const gmail = google.gmail('v1');
let lastHistoryId = null;

async function initializeHistoryId(auth) {
  try {
    const profile = await gmail.users.getProfile({
      auth,
      userId: 'me'
    });
    
    lastHistoryId = profile.data.historyId;
    logger.info('Initialized history ID', { historyId: lastHistoryId });
    
    return lastHistoryId;
  } catch (error) {
    logger.error('Failed to initialize history ID:', error);
    throw error;
  }
}

export async function handleWebhook(data) {
  try {
    const auth = await getGmailAuth();
    
    // Decode and validate Pub/Sub message
    if (!data.message?.data) {
      throw new Error('Invalid Pub/Sub message format');
    }

    const decodedData = JSON.parse(Buffer.from(data.message.data, 'base64').toString());
    
    if (!decodedData.historyId) {
      throw new Error('No historyId in notification');
    }

    logger.debug('Received webhook notification', {
      historyId: decodedData.historyId,
      messageId: data.message.messageId,
      publishTime: data.message.publishTime
    });

    // Initialize lastHistoryId if not set
    if (!lastHistoryId) {
      lastHistoryId = await initializeHistoryId(auth);
    }

    // Fetch history since last processed ID
    logger.info('Fetching history', { startHistoryId: lastHistoryId });

    const history = await gmail.users.history.list({
      auth,
      userId: 'me',
      startHistoryId: lastHistoryId,
      maxResults: 100, // Limit results per page
      historyTypes: ['messageAdded'] // Only get new messages
    });

    if (!history.data.history) {
      logger.info('No new history to process');
      return;
    }

    // Process each history item
    for (const item of history.data.history) {
      logger.info('Processing history item', {
        historyId: item.id,
        messageCount: item.messages?.length
      });

      if (!item.messages) continue;

      // Process messages in parallel
      const processPromises = item.messages.map(message => {
        logger.debug('Processing message', {
          messageId: message.id,
          historyId: item.id
        });
        return processMessage(auth, message.id);
      });

      await Promise.all(processPromises);
    }

    // Update lastHistoryId only after successful processing
    lastHistoryId = decodedData.historyId;
    logger.info('Updated history ID', { historyId: lastHistoryId });

  } catch (error) {
    logger.error('Webhook processing failed:', {
      error: error.message,
      stack: error.stack,
      lastHistoryId
    });
    throw error;
  }
}