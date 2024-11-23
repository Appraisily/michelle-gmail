import { google } from 'googleapis';
import { logger } from '../utils/logger.js';
import { recordMetric } from '../utils/monitoring.js';
import { initializeGmailAuth } from './gmailAuth.js';

const gmail = google.gmail('v1');
let lastHistoryId = null;

export async function handleWebhook(rawData) {
  try {
    logger.info('Raw webhook data received:', {
      rawData: JSON.stringify(rawData)
    });

    // Extract data from Pub/Sub message
    const message = rawData.message;
    if (!message || !message.data) {
      logger.error('Invalid webhook payload', { rawData: JSON.stringify(rawData) });
      throw new Error('Invalid webhook payload');
    }

    // Decode base64 data
    const decodedString = Buffer.from(message.data, 'base64').toString();
    logger.info('Decoded Pub/Sub data:', { decodedString });

    let data;
    try {
      data = JSON.parse(decodedString);
      logger.info('Parsed notification data:', {
        historyId: data.historyId,
        emailAddress: data.emailAddress,
        data: JSON.stringify(data)
      });
    } catch (error) {
      logger.error('Failed to parse webhook data:', {
        decodedString,
        error: error.message
      });
      throw error;
    }

    if (!data.historyId) {
      logger.error('No historyId in notification', { data: JSON.stringify(data) });
      throw new Error('No historyId in notification');
    }

    const processedCount = await processNewMessages(data.historyId);
    return processedCount;
  } catch (error) {
    logger.error('Error processing webhook:', error);
    throw error;
  }
}

async function processNewMessages(notificationHistoryId) {
  const auth = await initializeGmailAuth();
  
  try {
    logger.info('Processing messages:', {
      lastHistoryId,
      notificationHistoryId,
      email: 'info@appraisily.com'
    });

    // Initialize lastHistoryId if not set
    if (!lastHistoryId) {
      const profile = await gmail.users.getProfile({
        auth,
        userId: 'me'
      });
      lastHistoryId = profile.data.historyId;
      logger.info('Initialized lastHistoryId:', { lastHistoryId });
      return 0;
    }

    // Fetch history
    const historyResponse = await gmail.users.history.list({
      auth,
      userId: 'me',
      startHistoryId: lastHistoryId,
      historyTypes: ['messageAdded']
    });

    logger.info('History response:', {
      hasHistory: !!historyResponse.data.history,
      historyCount: historyResponse.data.history?.length || 0,
      startHistoryId: lastHistoryId,
      endHistoryId: notificationHistoryId
    });

    if (!historyResponse.data.history) {
      logger.info('No new messages');
      return 0;
    }

    let processedCount = 0;
    for (const history of historyResponse.data.history) {
      if (!history.messagesAdded) continue;

      for (const messageAdded of history.messagesAdded) {
        try {
          const messageData = await gmail.users.messages.get({
            auth,
            userId: 'me',
            id: messageAdded.message.id,
            format: 'full'
          });

          logger.info('Retrieved message:', {
            messageId: messageData.data.id,
            threadId: messageData.data.threadId,
            snippet: messageData.data.snippet?.substring(0, 100)
          });

          processedCount++;
          recordMetric('messages_processed', 1);
        } catch (error) {
          logger.error('Failed to process message:', {
            messageId: messageAdded.message.id,
            error: error.message
          });
          recordMetric('message_processing_failures', 1);
        }
      }
    }

    // Update lastHistoryId
    lastHistoryId = notificationHistoryId;
    logger.info('Updated lastHistoryId:', {
      oldHistoryId: lastHistoryId,
      newHistoryId: notificationHistoryId,
      processedCount
    });

    return processedCount;
  } catch (error) {
    logger.error('Failed to process messages:', error);
    throw error;
  }
}